import { Router } from 'express';
import QRCode from 'qrcode';
import { all, get, insert, update, run, tx, logActivity } from '../db.js';
import {
  checkPassword, clearAttempts, clearSessionCookie, createSessionCookie, hashPassword, mustUseTotp, newToken,
  newTotpSecret, readSession, recordAttempt, requireAdmin, requireAuth, sha256, throttled, totpUri, verifyTotp,
} from '../auth.js';
import { accessibleEventIds, assertEvent } from '../access.js';
import { config, isProd } from '../config.js';
import { sendSystemEmail } from '../services/messaging.js';
import { badRequest, notFound } from '../services/tracking.js';

const r = Router();
const MIN = 60 * 1000;
const fullUser = (id) => get('SELECT * FROM users WHERE id = ?', id);
// Compared against when no account matches, so a missing account takes as
// long to reject as a wrong password and emails cannot be probed by timing.
const DUMMY_HASH = hashPassword(newToken(12));

r.get('/setup', (req, res) => {
  res.json({ needsSetup: !get('SELECT id FROM users LIMIT 1') });
});

// First-run: create the initial admin account. Disabled once any user exists.
r.post('/setup', (req, res) => {
  if (get('SELECT id FROM users LIMIT 1')) return res.status(409).json({ error: 'Already set up' });
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 8) throw badRequest('Name, email and a password of 8+ characters are required');
  const id = insert('users', { name, email, role: 'admin', password_hash: hashPassword(password) },
    ['name', 'email', 'role', 'password_hash']);
  const user = fullUser(id);
  createSessionCookie(res, user, mustUseTotp(user) ? 'enrol' : 'full');
  logActivity({ action: 'auth.setup', actor: name, userId: id, req });
  res.json({ id, totp_setup_required: mustUseTotp(user) });
});

// Sign-in. Password guessing is limited to 10 tries per address+email and 25
// per email every 15 minutes; the counters live in the database.
r.post('/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password, code } = req.body;
  const ipKey = `login:${req.ip}|${email}`;
  const emailKey = `login:${email}`;
  if (throttled(ipKey, 10, 15 * MIN) || throttled(emailKey, 25, 15 * MIN)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const fail = (user, reason) => {
    recordAttempt(ipKey);
    recordAttempt(emailKey);
    logActivity({ action: 'auth.login_failed', actor: email || null, userId: user?.id ?? null, details: reason, req });
    return res.status(401).json({ error: 'Invalid email or password' });
  };
  const user = get('SELECT * FROM users WHERE email = ? AND active = 1', email);
  if (!user) {
    checkPassword(password || '', DUMMY_HASH);
    return fail(null, 'unknown account');
  }
  if (!checkPassword(password || '', user.password_hash)) return fail(user, 'wrong password');

  if (user.totp_enabled) {
    if (!code) return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app', totp_required: true });
    const step = verifyTotp(user.totp_secret, code, user.totp_last_step);
    if (!step) {
      recordAttempt(ipKey);
      recordAttempt(emailKey);
      logActivity({ action: 'auth.login_failed', actor: email, userId: user.id, details: 'wrong code', req });
      return res.status(401).json({ error: 'That code is not correct', totp_required: true });
    }
    run('UPDATE users SET totp_last_step = ? WHERE id = ?', step, user.id);
  }
  clearAttempts(ipKey);
  const enrol = !user.totp_enabled && mustUseTotp(user);
  createSessionCookie(res, user, enrol ? 'enrol' : 'full');
  logActivity({ action: 'auth.login', actor: user.name, userId: user.id, req });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, totp_setup_required: enrol });
});

r.post('/auth/logout', (req, res) => {
  const user = readSession(req)?.user;
  if (user) logActivity({ action: 'auth.logout', actor: user.name, userId: user.id, req });
  clearSessionCookie(res);
  res.json({ ok: true });
});

r.get('/auth/me', (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  const { session_epoch, ...user } = session.user;
  res.json({
    ...user,
    totp_setup_required: session.stage !== 'full',
    totp_required_for_role: mustUseTotp(session.user),
    memberships: all('SELECT event_id, role FROM event_members WHERE user_id = ?', user.id),
  });
});

// --- One-time code (authenticator app) ---------------------------------
// These work with a signed-in session at any stage, so someone who has just
// been told to set up a code can do so.
function anySession(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  req.user = session.user;
  req.sessionStage = session.stage;
  next();
}

r.post('/auth/totp/setup', anySession, async (req, res) => {
  const user = fullUser(req.user.id);
  if (user.totp_enabled) throw badRequest('A sign-in code is already set up. Turn it off first to replace it.');
  const secret = newTotpSecret();
  run('UPDATE users SET totp_secret = ? WHERE id = ?', secret, user.id);
  const uri = totpUri(user, secret);
  res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
});

r.post('/auth/totp/enable', anySession, (req, res) => {
  const user = fullUser(req.user.id);
  if (user.totp_enabled) throw badRequest('A sign-in code is already set up');
  const step = verifyTotp(user.totp_secret, req.body.code);
  if (!step) throw badRequest('That code is not correct. Check the time on your phone and try again.');
  run('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', step, user.id);
  createSessionCookie(res, user, 'full');
  logActivity({ action: 'auth.totp_enabled', req });
  res.json({ ok: true });
});

r.post('/auth/totp/disable', requireAuth, (req, res) => {
  const user = fullUser(req.user.id);
  if (!user.totp_enabled) throw badRequest('No sign-in code is set up');
  if (!checkPassword(req.body.password || '', user.password_hash)) throw badRequest('Password is not correct');
  const step = verifyTotp(user.totp_secret, req.body.code, user.totp_last_step);
  if (!step) throw badRequest('That code is not correct');
  run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?', user.id);
  // Roles that must use a code are sent straight back to set a new one up.
  if (mustUseTotp(user)) createSessionCookie(res, user, 'enrol');
  logActivity({ action: 'auth.totp_disabled', req });
  res.json({ ok: true, totp_setup_required: mustUseTotp(user) });
});

// --- Password reset by email -------------------------------------------
r.post('/auth/forgot', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const ipKey = `forgot:${req.ip}`;
  const emailKey = `forgot:${email}`;
  // The answer is the same whether or not the account exists.
  const done = () => res.json({ ok: true });
  if (!email || throttled(ipKey, 5, 15 * MIN) || throttled(emailKey, 3, 60 * MIN)) return done();
  recordAttempt(ipKey);
  recordAttempt(emailKey);
  const user = get('SELECT * FROM users WHERE email = ? AND active = 1', email);
  if (!user) return done();

  const token = newToken(32);
  run('DELETE FROM password_resets WHERE user_id = ?', user.id);
  run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), user.id, Date.now() + 30 * MIN);
  const link = `${config.publicUrl}/reset/${token}`;
  let sent = false;
  try {
    sent = await sendSystemEmail({
      to: user.email,
      subject: `${config.orgName}: reset your password`,
      text: `Hello ${user.name},\n\nUse this link to choose a new password. It works once and expires in 30 minutes.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
    });
  } catch (err) {
    console.error('Password reset email failed:', err.message);
  }
  // Without a mail server there is nowhere to send the link. In development it
  // is printed in the server log; in production an admin sets a new password.
  if (!sent && !isProd) console.log(`[dev] Password reset link for ${user.email}: ${link}`);
  logActivity({ action: 'auth.reset_requested', actor: user.name, userId: user.id, details: sent ? 'emailed' : 'email not configured', req });
  done();
});

r.post('/auth/reset', (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < 8) throw badRequest('Password must be at least 8 characters');
  const row = get('SELECT * FROM password_resets WHERE token_hash = ?', sha256(String(token || '')));
  if (!row || row.used_at || row.expires_at < Date.now()) throw badRequest('This reset link is no longer valid. Ask for a new one.');
  const user = get('SELECT * FROM users WHERE id = ? AND active = 1', row.user_id);
  if (!user) throw badRequest('This reset link is no longer valid. Ask for a new one.');
  tx(() => {
    // Bumping session_epoch signs out every device that was signed in.
    run('UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?', hashPassword(password), user.id);
    run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', Date.now(), row.token_hash);
  });
  clearAttempts(`login:${user.email.toLowerCase()}`);
  logActivity({ action: 'auth.password_reset', actor: user.name, userId: user.id, req });
  res.json({ ok: true });
});

// --- Staff management --------------------------------------------------
const USER_FIELDS = ['name', 'email', 'phone', 'role', 'active'];
const MEMBER_ROLES = ['coordinator', 'liaison', 'viewer'];

// Admins see every account. Everyone else sees only the colleagues who share
// an event with them, without email addresses.
r.get('/users', requireAuth, (req, res) => {
  const memberships = all(`SELECT m.user_id, m.event_id, m.role, e.name AS event_name
    FROM event_members m JOIN events e ON e.id = m.event_id ORDER BY e.starts_at DESC`);
  const forUser = (id) => memberships.filter((m) => m.user_id === id);
  if (req.user.role === 'admin') {
    return res.json(all(`SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.totp_enabled,
        (SELECT COUNT(*) FROM guests g WHERE g.host_user_id = u.id) AS guest_count
      FROM users u ORDER BY u.active DESC, u.name`).map((u) => ({ ...u, memberships: forUser(u.id) })));
  }
  const mine = accessibleEventIds(req.user);
  if (!mine.length) return res.json([]);
  const marks = mine.map(() => '?').join(',');
  res.json(all(`SELECT DISTINCT u.id, u.name, u.phone, u.role, u.active,
      (SELECT COUNT(*) FROM guests g WHERE g.host_user_id = u.id AND g.event_id IN (${marks})) AS guest_count
    FROM users u LEFT JOIN event_members m ON m.user_id = u.id
    WHERE u.role = 'admin' OR m.event_id IN (${marks}) ORDER BY u.active DESC, u.name`, ...mine, ...mine)
    .map((u) => ({ ...u, memberships: forUser(u.id).filter((m) => mine.includes(m.event_id)) })));
});

// People who can be assigned as a host on this event.
r.get('/events/:eventId/members', requireAuth, (req, res) => {
  assertEvent(req.user, req.params.eventId);
  res.json(all(`SELECT u.id, u.name, u.phone, u.active, COALESCE(m.role, 'admin') AS role
    FROM users u LEFT JOIN event_members m ON m.user_id = u.id AND m.event_id = ?
    WHERE u.active = 1 AND (m.event_id IS NOT NULL OR u.role = 'admin') ORDER BY u.name`, req.params.eventId));
});

// What a staff member can do is decided per event. Their account-wide role
// is kept equal to the highest of their event roles; it is only used to
// decide who must sign in with a one-time code.
function syncAccountRole(userId) {
  const u = fullUser(userId);
  if (!u || u.role === 'admin') return;
  const rows = all('SELECT role FROM event_members WHERE user_id = ?', userId).map((x) => x.role);
  const role = ['coordinator', 'liaison', 'viewer'].find((x) => rows.includes(x)) || 'viewer';
  if (role !== u.role) run('UPDATE users SET role = ? WHERE id = ?', role, userId);
}

function setMemberships(userId, memberships) {
  if (Array.isArray(memberships)) {
    run('DELETE FROM event_members WHERE user_id = ?', userId);
    for (const m of memberships) {
      if (!MEMBER_ROLES.includes(m.role)) throw badRequest('Unknown event role');
      if (!get('SELECT id FROM events WHERE id = ?', m.event_id)) throw badRequest('Unknown event');
      run('INSERT OR REPLACE INTO event_members (event_id, user_id, role) VALUES (?,?,?)', m.event_id, userId, m.role);
    }
  }
  syncAccountRole(userId);
}

r.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { password, memberships, ...data } = req.body;
  if (!password || password.length < 8) throw badRequest('Password must be at least 8 characters');
  if (data.email) data.email = String(data.email).trim().toLowerCase();
  // An account is either an admin or staff; staff roles are set per event.
  data.role = data.role === 'admin' ? 'admin' : 'viewer';
  const id = tx(() => {
    const uid = insert('users', { ...data, password_hash: hashPassword(password) }, [...USER_FIELDS, 'password_hash']);
    setMemberships(uid, memberships);
    return uid;
  });
  logActivity({ action: 'user.created', details: `${data.name} (${data.role === 'admin' ? 'admin' : 'staff'})`, req });
  res.status(201).json({ id });
});

r.put('/users/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const self = req.user.id === id;
  const admin = req.user.role === 'admin';
  if (!self && !admin) return res.status(403).json({ error: 'Admins only' });
  const target = fullUser(id);
  if (!target) throw notFound('User not found');
  const { password, current_password: currentPassword, memberships, ...data } = req.body;
  // Non-admins may only change their own contact details and password.
  const fields = admin ? USER_FIELDS : ['name', 'phone'];
  if (self && admin && (data.role && data.role !== 'admin' || data.active === false)) {
    throw badRequest('You cannot demote or deactivate your own account');
  }
  if (data.email) data.email = String(data.email).trim().toLowerCase();
  if (data.role !== undefined) data.role = data.role === 'admin' ? 'admin' : (target.role === 'admin' ? 'viewer' : target.role);
  if (password) {
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');
    // Changing your own password needs the current one, so an unattended
    // signed-in screen cannot be used to take over the account.
    if (self && !checkPassword(currentPassword || '', target.password_hash)) throw badRequest('Your current password is not correct');
  }
  tx(() => {
    update('users', id, data, fields);
    if (admin) setMemberships(id, memberships);
    else syncAccountRole(id);
    if (password) run('UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?', hashPassword(password), id);
    // Deactivating or changing a role also signs the person out everywhere.
    else if (admin && (data.active === false || (data.role && data.role !== target.role))) {
      run('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?', id);
    }
  });
  if (password && self) createSessionCookie(res, fullUser(id));
  const what = [password && 'password', admin && Array.isArray(memberships) && 'event access',
    ...Object.keys(data).filter((k) => fields.includes(k) && String(data[k] ?? '') !== String(target[k] ?? ''))].filter(Boolean);
  if (what.length) logActivity({ action: 'user.updated', details: `${target.name}: ${what.join(', ')}`, req });
  res.json({ ok: true });
});

// An admin can clear someone's sign-in code if they lose their phone.
r.post('/users/:id/reset-totp', requireAuth, requireAdmin, (req, res) => {
  const target = fullUser(req.params.id);
  if (!target) throw notFound('User not found');
  run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0, session_epoch = session_epoch + 1 WHERE id = ?', target.id);
  logActivity({ action: 'user.totp_reset', details: target.name, req });
  res.json({ ok: true });
});

// --- Audit trail (admins) ----------------------------------------------
r.get('/audit', requireAuth, requireAdmin, (req, res) => {
  const { user_id: userId, guest_id: guestId, event_id: eventId, action, from, to, q } = req.query;
  const where = [];
  const params = [];
  if (userId) { where.push('a.user_id = ?'); params.push(userId); }
  if (guestId) { where.push('a.guest_id = ?'); params.push(guestId); }
  if (eventId) { where.push('a.event_id = ?'); params.push(eventId); }
  if (action) { where.push('a.action LIKE ?'); params.push(`${action}%`); }
  if (from) { where.push('a.created_at >= ?'); params.push(from); }
  if (to) { where.push('a.created_at < ?'); params.push(to); }
  if (q) { where.push("(COALESCE(a.actor,'') || ' ' || COALESCE(a.details,'') || ' ' || COALESCE(g.first_name,'') || ' ' || COALESCE(g.last_name,'')) LIKE ?"); params.push(`%${q}%`); }
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const sql = `FROM activity_log a LEFT JOIN guests g ON g.id = a.guest_id LEFT JOIN events e ON e.id = a.event_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  res.json({
    total: get(`SELECT COUNT(*) AS n ${sql}`, ...params).n,
    rows: all(`SELECT a.*, g.title AS guest_title, g.first_name, g.last_name, e.name AS event_name ${sql}
      ORDER BY a.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset),
    actions: all('SELECT DISTINCT action FROM activity_log ORDER BY action').map((x) => x.action),
  });
});

export default r;
