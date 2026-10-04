// The upgrade step must work on a database created before the security
// changes, with real data in it, and be safe to run more than once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, all, get, getDb } from '../server/db.js';

test('upgrades a database created from the previous schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migrate-'));
  const file = path.join(dir, 'old.db');

  // 1. Build a database exactly as the previous version did, with data in it.
  const old = new DatabaseSync(file);
  old.exec(fs.readFileSync(new URL('./fixtures/schema-before-security.sql', import.meta.url), 'utf8'));
  old.exec(`
    INSERT INTO users (id, name, email, role, password_hash) VALUES
      (1, 'Admin', 'a@x.com', 'admin', 'h'), (2, 'Coord', 'c@x.com', 'coordinator', 'h'), (3, 'Liaison', 'l@x.com', 'liaison', 'h');
    INSERT INTO events (id, name, starts_at) VALUES (1, 'Gala', '2030-01-01T19:00'), (2, 'Forum', '2030-02-01T09:00');
    INSERT INTO guests (event_id, first_name, invite_token, host_user_id) VALUES
      (1, 'Ahmed', 'tok-1', 3), (1, 'Sara', 'tok-2', 2), (2, 'John', 'tok-3', NULL);
    INSERT INTO drivers (name, access_token) VALUES ('Khalid', 'drv-1');
    INSERT INTO activity_log (event_id, action) VALUES (1, 'guest.created');
  `);
  old.close();

  // 2. Open it with the new code (twice: the upgrade must be repeatable).
  openDb(file);
  getDb().close();
  openDb(file);

  const cols = (t) => all(`PRAGMA table_info(${t})`).map((c) => c.name);
  for (const [table, col] of [
    ['guests', 'checkin_code'], ['guests', 'backup_host_user_id'], ['drivers', 'token_issued_at'],
    ['users', 'totp_secret'], ['users', 'totp_enabled'], ['users', 'session_epoch'],
    ['activity_log', 'user_id'], ['activity_log', 'ip'], ['events', 'retention_days'], ['events', 'anonymised_at'],
  ]) assert.ok(cols(table).includes(col), `${table}.${col}`);
  for (const t of ['event_members', 'auth_attempts', 'password_resets']) {
    assert.ok(get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t), t);
  }

  // Data is kept, every guest got its own entrance code, nothing else changed.
  const guests = all('SELECT * FROM guests ORDER BY id');
  assert.equal(guests.length, 3);
  assert.deepEqual(guests.map((g) => g.invite_token), ['tok-1', 'tok-2', 'tok-3']);
  assert.ok(guests.every((g) => g.checkin_code && g.checkin_code !== g.invite_token));
  assert.equal(new Set(guests.map((g) => g.checkin_code)).size, 3);
  assert.ok(get('SELECT token_issued_at FROM drivers').token_issued_at);
  assert.equal(get('SELECT retention_days FROM events WHERE id = 1').retention_days, 90);
  assert.equal(get('SELECT COUNT(*) n FROM activity_log').n, 1);

  // Staff keep the access they had: members of every event with their old role. Admins need no rows.
  assert.deepEqual(all('SELECT event_id, user_id, role FROM event_members ORDER BY user_id, event_id').map((m) => Object.values(m)), [
    [1, 2, 'coordinator'], [2, 2, 'coordinator'], [1, 3, 'liaison'], [2, 3, 'liaison'],
  ]);
  getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});
