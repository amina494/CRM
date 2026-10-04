import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import {
  checkPassword, clearSessionCookie, createSessionCookie, hashPassword, requireAdmin, requireAuth, sessionUser,
} from '../auth.js';
import { badRequest } from '../services/tracking.js';

const r = Router();

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
  createSessionCookie(res, id);
  res.json({ id });
});

// Throttle password guessing: 10 failures per IP+email per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;

r.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  const key = `${req.ip}|${String(email || '').toLowerCase()}`;
  const now = Date.now();
  const recent = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const user = get('SELECT * FROM users WHERE email = ? AND active = 1', email || '');
  if (!user || !checkPassword(password || '', user.password_hash)) {
    failures.set(key, [...recent, now]);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  failures.delete(key);
  createSessionCookie(res, user.id);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

r.post('/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

r.get('/auth/me', (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  res.json(user);
});

// --- Staff management --------------------------------------------------
const USER_FIELDS = ['name', 'email', 'phone', 'role', 'active'];

r.get('/users', requireAuth, (req, res) => {
  res.json(all(`SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
      (SELECT COUNT(*) FROM guests g WHERE g.host_user_id = u.id) AS guest_count
    FROM users u ORDER BY u.active DESC, u.name`));
});

r.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { password, ...data } = req.body;
  if (!password || password.length < 8) throw badRequest('Password must be at least 8 characters');
  const id = insert('users', { ...data, password_hash: hashPassword(password) }, [...USER_FIELDS, 'password_hash']);
  res.status(201).json({ id });
});

r.put('/users/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const self = req.user.id === id;
  if (!self && req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const { password, ...data } = req.body;
  // Non-admins may only change their own contact details and password.
  const fields = req.user.role === 'admin' ? USER_FIELDS : ['name', 'phone'];
  if (self && req.user.role === 'admin' && (data.role && data.role !== 'admin' || data.active === false)) {
    throw badRequest('You cannot demote or deactivate your own account');
  }
  update('users', id, data, fields);
  if (password) {
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), id);
  }
  res.json({ ok: true });
});

export default r;
