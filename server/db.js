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
  return db;
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

export function logActivity({ eventId = null, guestId = null, actor = null, action, details = null }) {
  run(
    'INSERT INTO activity_log (event_id, guest_id, actor, action, details) VALUES (?,?,?,?,?)',
    eventId, guestId, actor, action, details,
  );
}
