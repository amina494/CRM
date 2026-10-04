import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let db;

export function openDb(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  migrate(db);
  return db;
}

const randomCode = (bytes) => crypto.randomBytes(bytes).toString('base64url');

/**
 * Upgrades an existing database in place. Every step is safe to run again:
 * a column is only added when it is missing, and backfills only touch rows
 * that still need a value.
 */
function migrate(d) {
  const has = (table, col) => d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  const add = (table, col, ddl) => { if (!has(table, col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); };

  d.exec('BEGIN');
  try {
    // 1. Check-in code, separate from the invitation link.
    add('guests', 'checkin_code', 'TEXT');
    const fill = d.prepare('UPDATE guests SET checkin_code = ? WHERE id = ?');
    for (const g of d.prepare('SELECT id FROM guests WHERE checkin_code IS NULL').all()) fill.run(randomCode(12), g.id);
    d.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_checkin ON guests(checkin_code)');

    // 2. Backup host, and event membership for staff who existed before memberships did.
    add('guests', 'backup_host_user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
    const firstMembershipRun = !has('users', 'session_epoch');

    // 3. Driver links expire.
    add('drivers', 'token_issued_at', 'TEXT');
    d.prepare('UPDATE drivers SET token_issued_at = ? WHERE token_issued_at IS NULL').run(new Date().toISOString());

    // 4. Sign-in: one-time codes and session invalidation.
    add('users', 'totp_secret', 'TEXT');
    add('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
    add('users', 'totp_last_step', 'INTEGER NOT NULL DEFAULT 0');
    add('users', 'session_epoch', 'INTEGER NOT NULL DEFAULT 0');

    // 5. Audit detail and retention.
    add('activity_log', 'user_id', 'INTEGER');
    add('activity_log', 'ip', 'TEXT');
    add('events', 'retention_days', 'INTEGER NOT NULL DEFAULT 90');
    add('events', 'anonymised_at', 'TEXT');
    // 6. Per-event invitation design (colours, fonts, wording), as JSON.
    add('events', 'design', 'TEXT');
    d.exec('CREATE INDEX IF NOT EXISTS idx_activity_guest ON activity_log(guest_id, created_at)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at)');

    // Staff created before per-event access keep the access they had: each
    // non-admin becomes a member of every existing event with their role.
    if (firstMembershipRun) {
      d.exec(`INSERT OR IGNORE INTO event_members (event_id, user_id, role)
        SELECT e.id, u.id, u.role FROM events e CROSS JOIN users u WHERE u.role != 'admin'`);
    }
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export function getDb() {
  if (!db) openDb();
  return db;
}

export const all = (sql, ...params) => getDb().prepare(sql).all(...params);
export const get = (sql, ...params) => getDb().prepare(sql).get(...params);
export const run = (sql, ...params) => getDb().prepare(sql).run(...params);

export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

/** Build an INSERT from a plain object, keeping only allowed columns. */
export function insert(table, data, allowed) {
  const cols = Object.keys(data).filter((k) => allowed.includes(k) && data[k] !== undefined);
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  const info = run(sql, ...cols.map((c) => norm(data[c])));
  return Number(info.lastInsertRowid);
}

/** Build an UPDATE from a plain object, keeping only allowed columns. */
export function update(table, id, data, allowed) {
  const cols = Object.keys(data).filter((k) => allowed.includes(k) && data[k] !== undefined);
  if (!cols.length) return 0;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  return Number(run(sql, ...cols.map((c) => norm(data[c])), id).changes);
}

// Empty strings from forms become NULL; booleans become 0/1.
function norm(v) {
  if (v === '') return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export const nowIso = () => new Date().toISOString();

/**
 * Writes one line to the audit trail. Pass `req` to record who did it and
 * from where; `actor` overrides the name for non-staff actors (guest, driver).
 */
export function logActivity({ eventId = null, guestId = null, actor = null, action, details = null, req = null, userId = null }) {
  run(
    'INSERT INTO activity_log (event_id, guest_id, actor, action, details, user_id, ip) VALUES (?,?,?,?,?,?,?)',
    eventId, guestId, actor ?? req?.user?.name ?? null, action, details, userId ?? req?.user?.id ?? null, req?.ip ?? null,
  );
}
