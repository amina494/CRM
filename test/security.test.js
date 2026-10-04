// Security rules: per-event access, liaison scope, check-in codes, driver
// links, one-time codes, password resets, sessions, retention and audit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, get, run } from '../server/db.js';
import { createApp } from '../server/app.js';
import { sha256, totpCode, newTotpSecret } from '../server/auth.js';

let server;
let base;

/** A tiny HTTP client with its own cookie jar, so several people can be signed in at once. */
function client() {
  const c = { cookie: '' };
  c.call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) c.cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  };
  c.login = async (email, password = 'secret123', code) => c.call('POST', '/auth/login', { email, password, code });
  return c;
}

const admin = client();
const anon = client();
const ids = {};

before(async () => {
  openDb(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;

  await admin.call('POST', '/setup', { name: 'Admin', email: 'admin@x.com', password: 'secret123' });
  ids.eventA = (await admin.call('POST', '/events', { name: 'Event A', starts_at: '2030-01-10T19:00' })).data.id;
  ids.eventB = (await admin.call('POST', '/events', { name: 'Event B', starts_at: '2030-02-10T19:00' })).data.id;
  const user = async (name, email, memberships) => (await admin.call('POST', '/users', { name, email, password: 'secret123', memberships })).data.id;
  ids.coordA = await user('Coord A', 'coorda@x.com', [{ event_id: ids.eventA, role: 'coordinator' }]);
  ids.liaisonA = await user('Liaison A', 'liaisona@x.com', [{ event_id: ids.eventA, role: 'liaison' }]);
  ids.coordB = await user('Coord B', 'coordb@x.com', [{ event_id: ids.eventB, role: 'coordinator' }]);

  const guest = async (eventId, data) => (await admin.call('POST', `/events/${eventId}/guests`, data)).data.id;
  ids.hosted = await guest(ids.eventA, { first_name: 'Hosted', last_name: 'Guest', phone: '+966500000001', host_user_id: ids.liaisonA });
  ids.companion = await guest(ids.eventA, { first_name: 'Plus', last_name: 'One', phone: '+966500000002', party_lead_id: ids.hosted, category: 'companion' });
  ids.other = await guest(ids.eventA, { first_name: 'Other', last_name: 'Person', phone: '+966500000003', host_user_id: ids.coordA });
  ids.guestB = await guest(ids.eventB, { first_name: 'Bee', last_name: 'Guest' });
  ids.tableA = (await admin.call('POST', `/events/${ids.eventA}/tables`, { name: 'T1', capacity: 8 })).data.id;
  ids.tableB = (await admin.call('POST', `/events/${ids.eventB}/tables`, { name: 'TB', capacity: 8 })).data.id;
  ids.flightA = (await admin.call('POST', `/events/${ids.eventA}/flights`, { direction: 'arrival', scheduled_at: '2030-01-09T10:00', passenger_ids: [ids.hosted, ids.other] })).data.id;
  ids.driver = (await admin.call('POST', '/drivers', { name: 'Driver One' })).data.id;
  ids.tripA = (await admin.call('POST', `/events/${ids.eventA}/transfers`, {
    kind: 'airport_pickup', scheduled_at: '2030-01-09T10:30', driver_id: ids.driver, passenger_ids: [ids.hosted, ids.other],
  })).data.id;
});
after(() => server.close());

test('security headers are sent and API responses are never cached', async () => {
  const r = await anon.call('GET', '/setup');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('a user from another event cannot read or change a guest, flight, trip or table', async () => {
  const b = client();
  await b.login('coordb@x.com');
  assert.deepEqual((await b.call('GET', '/events')).data.map((e) => e.id), [ids.eventB]);
  for (const [method, path, body] of [
    ['GET', `/guests/${ids.hosted}`],
    ['PUT', `/guests/${ids.hosted}`, { notes: 'x' }],
    ['GET', `/events/${ids.eventA}/guests`],
    ['GET', `/events/${ids.eventA}/flights`],
    ['PUT', `/flights/${ids.flightA}`, { status: 'landed' }],
    ['DELETE', `/flights/${ids.flightA}`],
    ['PUT', `/transfers/${ids.tripA}`, { notes: 'x' }],
    ['POST', `/transfers/${ids.tripA}/status`, { status: 'en_route' }],
    ['PUT', `/tables/${ids.tableA}`, { name: 'Mine' }],
    ['DELETE', `/tables/${ids.tableA}`],
    ['GET', `/events/${ids.eventA}/dashboard`],
  ]) {
    assert.equal((await b.call(method, path, body)).status, 404, `${method} ${path}`);
  }
  assert.equal(get('SELECT name FROM seating_tables WHERE id = ?', ids.tableA).name, 'T1');

  // A coordinator of event A cannot link records from event B into event A.
  const a = client();
  await a.login('coorda@x.com');
  assert.equal((await a.call('PUT', `/flights/${ids.flightA}`, { passenger_ids: [ids.hosted, ids.guestB] })).status, 400);
  assert.equal((await a.call('POST', `/events/${ids.eventA}/transfers`, { kind: 'custom', passenger_ids: [ids.guestB] })).status, 400);
  assert.equal((await a.call('PUT', `/guests/${ids.other}`, { table_id: ids.tableB })).status, 400);
  assert.equal((await a.call('PUT', `/guests/${ids.other}`, { host_user_id: ids.coordB })).status, 400);
  assert.equal((await a.call('PUT', `/guests/${ids.other}`, { party_lead_id: ids.guestB })).status, 400);
  // ...and cannot create or delete events, or delete guests.
  assert.equal((await a.call('POST', '/events', { name: 'New' })).status, 403);
  assert.equal((await a.call('DELETE', `/guests/${ids.other}`)).status, 403);
});

test('a liaison only sees and edits the guests they look after', async () => {
  const l = client();
  await l.login('liaisona@x.com');
  assert.equal((await l.call('GET', `/guests/${ids.other}`)).status, 404);
  assert.equal((await l.call('PUT', `/guests/${ids.other}`, { notes: 'x' })).status, 404);
  assert.equal((await l.call('GET', `/guests/${ids.hosted}`)).status, 200);
  assert.equal((await l.call('GET', `/guests/${ids.companion}`)).status, 200, 'companions of their guests are theirs too');

  const list = (await l.call('GET', `/events/${ids.eventA}/guests`)).data.map((g) => g.id).sort();
  assert.deepEqual(list, [ids.hosted, ids.companion].sort());

  assert.equal((await l.call('PUT', `/guests/${ids.hosted}`, { dietary: 'Vegan' })).status, 200);
  assert.equal((await l.call('PUT', `/guests/${ids.hosted}`, { host_user_id: ids.coordA })).status, 403);
  assert.equal((await l.call('PUT', `/guests/${ids.companion}`, { party_lead_id: null })).status, 403);
  assert.equal((await l.call('POST', `/events/${ids.eventA}/guests`, { first_name: 'X' })).status, 403);
  assert.equal((await l.call('GET', `/events/${ids.eventA}/guests/export.csv`)).status, 403);
  assert.equal((await l.call('GET', `/events/${ids.eventA}/dashboard`)).status, 403);
  assert.equal((await l.call('GET', `/events/${ids.eventA}/tables`)).status, 403);

  // Trips: only theirs, other guests' phone numbers removed, and they may move the trip along.
  const trips = (await l.call('GET', `/events/${ids.eventA}/transfers`)).data;
  assert.equal(trips.length, 1);
  const byId = Object.fromEntries(trips[0].passengers.map((p) => [p.id, p]));
  assert.equal(byId[ids.hosted].phone, '+966500000001');
  assert.equal(byId[ids.other].phone, null);
  assert.equal((await l.call('PUT', `/transfers/${ids.tripA}`, { notes: 'x' })).status, 403);
  assert.equal((await l.call('POST', `/transfers/${ids.tripA}/status`, { status: 'en_route' })).status, 200);

  // Lists never carry the invitation token or the entrance code.
  const listed = (await l.call('GET', `/events/${ids.eventA}/guests`)).data;
  assert.ok(listed.every((g) => !('invite_token' in g) && !('checkin_code' in g)));
  assert.ok((await l.call('GET', `/guests/${ids.hosted}`)).data.invite_url, 'a liaison can open their guest\'s invitation');

  // Driver links are only for people who manage the fleet.
  const drivers = (await l.call('GET', '/drivers')).data;
  assert.ok(drivers.every((d) => !d.portal_url && !d.access_token));
});

test('the entrance code does not open the invitation and the invitation link does not check in', async () => {
  const g = get('SELECT invite_token, checkin_code FROM guests WHERE id = ?', ids.other);
  assert.equal((await anon.call('GET', `/public/invite/${g.checkin_code}`)).status, 404);
  assert.equal((await admin.call('POST', '/check-in', { code: g.invite_token })).status, 404);
  assert.equal((await admin.call('POST', '/check-in', { token: g.invite_token })).status, 404);
  assert.equal((await anon.call('GET', `/public/invite/${g.invite_token}`)).status, 200);
  const ok = await admin.call('POST', '/check-in', { code: g.checkin_code, event_id: ids.eventA });
  assert.equal(ok.status, 200);
  // A coordinator of another event cannot use the code either.
  const b = client();
  await b.login('coordb@x.com');
  assert.equal((await b.call('POST', '/check-in', { code: g.checkin_code })).status, 404);
  // Every guest gets a code, including companions added through an RSVP.
  const lead = get('SELECT invite_token FROM guests WHERE id = ?', ids.hosted).invite_token;
  run('UPDATE guests SET plus_ones_allowed = 1 WHERE id = ?', ids.hosted);
  await anon.call('POST', `/public/invite/${lead}/rsvp`, { status: 'attending', companions: ['Sam Smith'] });
  assert.ok(get("SELECT checkin_code FROM guests WHERE first_name = 'Sam'").checkin_code);
});

test('the driver sees first names and the host contact, never last names or guest phones', async () => {
  const token = get('SELECT access_token FROM drivers WHERE id = ?', ids.driver).access_token;
  const r = await anon.call('GET', `/public/driver/${token}`);
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.data);
  for (const secret of ['Guest', 'Person', '+966500000001', '+966500000003']) assert.ok(!text.includes(secret), `leaked ${secret}`);
  const trip = r.data.transfers.find((t) => t.id === ids.tripA);
  assert.deepEqual(trip.passengers.map((p) => p.first_name).sort(), ['Hosted', 'Other']);
  assert.ok(trip.passengers.every((p) => !('last_name' in p) && !('phone' in p)));
  assert.deepEqual(trip.contacts.map((c) => c.name).sort(), ['Coord A', 'Liaison A']);
});

test('an expired driver link is refused', async () => {
  const id = (await admin.call('POST', '/drivers', { name: 'Old link' })).data.id;
  const token = () => get('SELECT access_token FROM drivers WHERE id = ?', id).access_token;
  assert.equal((await anon.call('GET', `/public/driver/${token()}`)).status, 200);
  // No trips: 7 days after the link was issued.
  run('UPDATE drivers SET token_issued_at = ? WHERE id = ?', new Date(Date.now() - 8 * 864e5).toISOString(), id);
  const expired = await anon.call('GET', `/public/driver/${token()}`);
  assert.equal(expired.status, 410);
  assert.equal(expired.data.error, 'link expired');
  // With trips: 48 hours after the last one.
  run(`INSERT INTO transfers (event_id, kind, scheduled_at, driver_id) VALUES (?, 'custom', '2020-01-01T10:00', ?)`, ids.eventA, id);
  assert.equal((await anon.call('GET', `/public/driver/${token()}`)).status, 410);
  assert.equal((await anon.call('POST', `/public/driver/${token()}/location`, { lat: 1, lng: 1 })).status, 410);
  // Scheduling a new trip brings the link back.
  run(`INSERT INTO transfers (event_id, kind, scheduled_at, driver_id) VALUES (?, 'custom', '2030-01-09T10:00', ?)`, ids.eventA, id);
  assert.equal((await anon.call('GET', `/public/driver/${token()}`)).status, 200);
  // Resetting the link issues a new token and a new issue date.
  await admin.call('POST', `/drivers/${id}/rotate-link`);
  assert.ok(Date.now() - Date.parse(get('SELECT token_issued_at FROM drivers WHERE id = ?', id).token_issued_at) < 60000);
});

test('sign-in needs the one-time code once it is turned on, and a code works only once', async () => {
  const u = client();
  await u.login('coordb@x.com');
  const { secret } = (await u.call('POST', '/auth/totp/setup')).data;
  assert.equal((await u.call('POST', '/auth/totp/enable', { code: '000000' })).status, 400);
  assert.equal((await u.call('POST', '/auth/totp/enable', { code: totpCode(secret) })).status, 200);
  // The enabling code was used at this time step, so wait for the next one.
  const next = totpCode(secret, Math.floor(Date.now() / 30000) + 1);

  const fresh = client();
  const noCode = await fresh.login('coordb@x.com');
  assert.equal(noCode.status, 401);
  assert.equal(noCode.data.totp_required, true);
  assert.equal((await fresh.call('GET', '/auth/me')).status, 401);
  assert.equal((await fresh.login('coordb@x.com', 'secret123', '123456')).status, 401);
  assert.equal((await fresh.login('coordb@x.com', 'secret123', next)).status, 200);
  assert.equal((await fresh.call('GET', '/auth/me')).status, 200);
  assert.equal((await client().login('coordb@x.com', 'secret123', next)).status, 401, 'a code cannot be replayed');
  // An admin can clear it if the phone is lost.
  assert.equal((await admin.call('POST', `/users/${ids.coordB}/reset-totp`)).status, 200);
  assert.equal((await client().login('coordb@x.com')).status, 200);
  assert.ok(newTotpSecret().length >= 32);
});

test('a used or expired password reset link is refused', async () => {
  const token = 'test-reset-token-123';
  run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), ids.liaisonA, Date.now() + 60000);
  assert.equal((await anon.call('POST', '/auth/reset', { token, password: 'newpassword1' })).status, 200);
  assert.equal((await anon.call('POST', '/auth/reset', { token, password: 'another-pass1' })).status, 400, 'used');
  assert.equal((await client().login('liaisona@x.com', 'newpassword1')).status, 200);

  const old = 'expired-reset-token-456';
  run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(old), ids.liaisonA, Date.now() - 1000);
  assert.equal((await anon.call('POST', '/auth/reset', { token: old, password: 'newpassword2' })).status, 400, 'expired');
  assert.equal((await anon.call('POST', '/auth/reset', { token: 'never-issued', password: 'newpassword2' })).status, 400);
  // Asking for a reset never reveals whether the account exists.
  assert.deepEqual((await anon.call('POST', '/auth/forgot', { email: 'nobody@x.com' })).data, { ok: true });
});

test('an old session stops working after a password change', async () => {
  const laptop = client();
  const phone = client();
  await laptop.login('coorda@x.com');
  await phone.login('coorda@x.com');
  assert.equal((await phone.call('GET', '/auth/me')).status, 200);
  assert.equal((await laptop.call('PUT', `/users/${ids.coordA}`, { password: 'changed-pass1' })).status, 400, 'needs current password');
  assert.equal((await laptop.call('PUT', `/users/${ids.coordA}`, { password: 'changed-pass1', current_password: 'secret123' })).status, 200);
  assert.equal((await phone.call('GET', '/auth/me')).status, 401, 'other device signed out');
  assert.equal((await laptop.call('GET', '/auth/me')).status, 200, 'the device that changed it stays signed in');
  await laptop.call('PUT', `/users/${ids.coordA}`, { password: 'secret123', current_password: 'changed-pass1' });
});

test('profile views, exports, deletions and check-ins are in the audit trail', async () => {
  const a = client();
  await a.login('coorda@x.com');
  await a.call('GET', `/guests/${ids.other}`);
  await a.call('GET', `/events/${ids.eventA}/guests/export.csv`);
  const extra = (await admin.call('POST', `/events/${ids.eventA}/guests`, { first_name: 'Temp' })).data.id;
  await admin.call('DELETE', `/guests/${extra}`);
  const audit = (await admin.call('GET', `/audit?event_id=${ids.eventA}`)).data.rows;
  const has = (action, userId) => audit.some((x) => x.action === action && (!userId || x.user_id === userId) && x.ip);
  assert.ok(has('guest.viewed', ids.coordA));
  assert.ok(has('guests.exported', ids.coordA));
  assert.ok(has('guest.deleted'));
  assert.ok(has('guest.checked_in'));
  assert.equal((await a.call('GET', '/audit')).status, 403);
});

test('viewers can read guests but never get a link that acts as the guest', async () => {
  await admin.call('POST', '/users', { name: 'View A', email: 'viewa@x.com', password: 'secret123', memberships: [{ event_id: ids.eventA, role: 'viewer' }] });
  await admin.call('POST', `/events/${ids.eventA}/invitations/send`, { guest_ids: [ids.other], channels: ['email', 'sms'] });
  const v = client();
  await v.login('viewa@x.com');
  const profile = (await v.call('GET', `/guests/${ids.other}`)).data;
  assert.equal(profile.invite_url, null);
  assert.ok(!('invite_token' in profile) && !('checkin_code' in profile));
  const token = get('SELECT invite_token FROM guests WHERE id = ?', ids.other).invite_token;
  const outbox = JSON.stringify((await v.call('GET', `/events/${ids.eventA}/messages`)).data);
  assert.ok(outbox.includes('[invitation link]') && !outbox.includes(token));
  assert.ok(!JSON.stringify(profile.messages).includes(token));
});

test('guest data can be anonymised only by an admin, only when due, with the event name typed', async () => {
  const id = (await admin.call('POST', '/events', { name: 'Old Gala', starts_at: '2030-05-01T19:00', ends_at: '2030-05-01T23:00' })).data.id;
  const g = (await admin.call('POST', `/events/${id}/guests`, { first_name: 'Layla', last_name: 'Private', email: 'l@x.com', phone: '+9665', rsvp_status: 'attending' })).data.id;
  const before = get('SELECT invite_token, checkin_code FROM guests WHERE id = ?', g);
  assert.equal((await admin.call('GET', `/events/${id}/retention`)).data.is_due, false);
  assert.equal((await admin.call('POST', `/events/${id}/anonymise`, { confirm: 'Old Gala' })).status, 400, 'not due yet');

  await admin.call('PUT', `/events/${id}`, { starts_at: '2020-05-01T19:00', ends_at: '2020-05-01T23:00', retention_days: 30 });
  const summary = (await admin.call('GET', `/events/${id}/retention`)).data;
  assert.equal(summary.is_due, true);
  assert.equal(summary.would_remove.guests_personal_details, 1);
  assert.equal((await admin.call('POST', `/events/${id}/anonymise`, { confirm: 'wrong' })).status, 400);
  const coord = client();
  await coord.login('coorda@x.com');
  assert.equal((await coord.call('POST', `/events/${id}/anonymise`, { confirm: 'Old Gala' })).status, 403);

  assert.equal((await admin.call('POST', `/events/${id}/anonymise`, { confirm: 'Old Gala' })).status, 200);
  const after = get('SELECT * FROM guests WHERE id = ?', g);
  assert.equal(after.first_name, 'Guest');
  assert.equal(after.email, null);
  assert.equal(after.phone, null);
  assert.notEqual(after.invite_token, before.invite_token);
  assert.notEqual(after.checkin_code, before.checkin_code);
  assert.equal(after.rsvp_status, 'attending', 'counts are kept');
  assert.equal(get('SELECT COUNT(*) n FROM guests WHERE event_id = ?', id).n, 1);
  assert.ok(get('SELECT anonymised_at FROM events WHERE id = ?', id).anonymised_at);
  assert.equal((await admin.call('POST', `/events/${id}/anonymise`, { confirm: 'Old Gala' })).status, 400, 'only once');
});
