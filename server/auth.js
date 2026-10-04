import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { get, run } from './db.js';

const COOKIE = 'crm_session';
// Sessions last 12 hours and are renewed while the person keeps working.
const MAX_AGE_MS = 1000 * 60 * 60 * 12;
const RENEW_AFTER_MS = 1000 * 60 * 30;

const sign = (payload) =>
  crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

/**
 * @param stage 'full' for a normal session, or 'enrol' for someone who must
 *   set up their one-time code before they can use anything else.
 */
export function createSessionCookie(res, user, stage = 'full') {
  const payload = Buffer.from(JSON.stringify({
    uid: user.id, ep: user.session_epoch || 0, st: stage, iat: Date.now(), exp: Date.now() + MAX_AGE_MS,
  })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https://'),
    maxAge: MAX_AGE_MS,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

const USER_COLS = 'id, name, email, phone, role, active, totp_enabled, session_epoch';

/** Returns { user, stage, issuedAt } for a valid session cookie, else null. */
export function readSession(req) {
  const raw = readCookie(req);
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  if (!data.exp || data.exp < Date.now()) return null;
  const user = get(`SELECT ${USER_COLS} FROM users WHERE id = ? AND active = 1`, data.uid);
  // A password change or reset bumps session_epoch, which signs out every older session.
  if (!user || (user.session_epoch || 0) !== (data.ep || 0)) return null;
  return { user, stage: data.st || 'full', issuedAt: data.iat || 0 };
}

export function sessionUser(req) {
  return readSession(req)?.user || null;
}

/** Staff who must sign in with a one-time code when REQUIRE_2FA is on. */
export function mustUseTotp(user) {
  if (!config.require2fa) return false;
  if (user.role === 'admin' || user.role === 'coordinator') return true;
  return Boolean(get("SELECT 1 FROM event_members WHERE user_id = ? AND role = 'coordinator'", user.id));
}

/** Requires a signed-in staff member with a full session. */
export function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  if (session.stage !== 'full') {
    return res.status(403).json({ error: 'Set up your sign-in code to continue', totp_setup_required: true });
  }
  req.user = session.user;
  if (Date.now() - session.issuedAt > RENEW_AFTER_MS) createSessionCookie(res, session.user);
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compareSync(pw, hash);
export const newToken = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// --- Throttling (stored in the database so a restart does not reset it) ---

/** True when `key` has reached `limit` attempts within the window. */
export function throttled(key, limit, windowMs) {
  const since = Date.now() - windowMs;
  return get('SELECT COUNT(*) AS n FROM auth_attempts WHERE key = ? AND at > ?', key, since).n >= limit;
}
export function recordAttempt(key) {
  run('INSERT INTO auth_attempts (key, at) VALUES (?, ?)', key, Date.now());
  // Housekeeping: nothing older than a day is ever consulted.
  run('DELETE FROM auth_attempts WHERE at < ?', Date.now() - 24 * 60 * 60 * 1000);
}
export function clearAttempts(key) {
  run('DELETE FROM auth_attempts WHERE key = ?', key);
}

// --- One-time codes (TOTP, RFC 6238: the standard authenticator apps use) ---

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

function base32Decode(s) {
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/**
 * Checks a 6-digit code, allowing one step (30 seconds) of clock drift either
 * way. Returns the matching time step, or 0 when the code is wrong or has
 * already been used (`lastStep`), so a code cannot be replayed.
 */
export function verifyTotp(secret, code, lastStep = 0) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!secret || !/^\d{6}$/.test(clean)) return 0;
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastStep) continue;
    const expected = totpCode(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return 0;
}

export const totpUri = (user, secret) =>
  `otpauth://totp/${encodeURIComponent(`${config.orgName}:${user.email}`)}?secret=${secret}&issuer=${encodeURIComponent(config.orgName)}`;
