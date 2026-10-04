import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, get } from '../server/db.js';
import { createApp } from '../server/app.js';

let server;
let base;
let cookie = '';

async function call(method, path, body, { auth = true, raw = false } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && auth) cookie = setCookie.split(';')[0];
  if (raw) return res;
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

before(async () => {
  openDb(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

let eventId;
let leadId;
let leadToken;

test('first-run setup creates an admin, then locks', async () => {
  assert.equal((await call('GET', '/setup')).data.needsSetup, true);
  assert.equal((await call('GET', '/events', null, { auth: false })).status, 401);
  const r = await call('POST', '/setup', { name: 'Admin', email: 'a@x.com', password: 'secret123' });
  assert.equal(r.status, 200);
  assert.equal((await call('POST', '/setup', { name: 'B', email: 'b@x.com', password: 'secret123' })).status, 409);
  assert.equal((await call('POST', '/auth/login', { email: 'a@x.com', password: 'wrong' }, { auth: false })).status, 401);
  assert.equal((await call('GET', '/auth/me')).data.role, 'admin');
});

test('events and guests', async () => {
  eventId = (await call('POST', '/events', { name: 'Gala', starts_at: '2030-01-10T19:00', rsvp_deadline: '2030-01-05T23:59', venue: 'Hall' })).data.id;
  await call('POST', `/events/${eventId}/tables`, { name: 'Table 1', capacity: 8 });
  const r = await call('POST', `/events/${eventId}/guests`, { first_name: 'Ahmed', last_name: 'Ali', email: 'ahmed@x.com', phone: '+966500000000', category: 'vip', plus_ones_allowed: 1 });
  assert.equal(r.status, 201);
  leadId = r.data.id;
  leadToken = get('SELECT invite_token FROM guests WHERE id = ?', leadId).invite_token;
  assert.equal((await call('POST', `/events/${eventId}/guests`, { first_name: '' })).status, 400);
  assert.equal((await call('POST', `/events/${eventId}/guests`, { first_name: 'X', category: 'nonsense' })).status, 400);
});

test('CSV import understands aliases and table names', async () => {
  const csv = 'Name,Mobile,Company,Category,Language,Table\nSara Al Harbi,+966511111111,Acme,VIP,Arabic,Table 1\n,,,,,\nJohn Smith,,Beta,bogus,en,';
  const r = await call('POST', `/events/${eventId}/guests/import`, { csv });
  assert.equal(r.data.created, 1);
  assert.deepEqual(r.data.errors.map((e) => e.row), [4]); // bogus category rejected, blank row skipped
  const sara = get("SELECT * FROM guests WHERE first_name = 'Sara'");
  assert.equal(sara.last_name, 'Al Harbi');
  assert.equal(sara.language, 'ar');
  assert.ok(sara.table_id);
});

test('sending invitations without a provider logs them to the outbox', async () => {
  const r = await call('POST', `/events/${eventId}/invitations/send`, { guest_ids: [leadId], channels: ['email', 'whatsapp'] });
  assert.deepEqual(r.data.results[0].outcomes.map((o) => o.status), ['logged', 'logged']);
  assert.equal(get('SELECT invite_status FROM guests WHERE id = ?', leadId).invite_status, 'sent');
  const msgs = (await call('GET', `/events/${eventId}/messages`)).data;
  assert.equal(msgs.length, 2);
  assert.match(msgs[0].body, new RegExp(`/i/${leadToken}`));
});

test('guest RSVP flow with companions', async () => {
  const inv = await call('GET', `/public/invite/${leadToken}`, null, { auth: false });
  assert.equal(inv.data.guest.first_name, 'Ahmed');
  assert.equal(inv.data.guest.email, undefined, 'private fields are not exposed');
  assert.equal(get('SELECT invite_status FROM guests WHERE id = ?', leadId).invite_status, 'opened');

  // Wallet pass is only for accepted invitations.
  assert.equal((await call('GET', `/public/invite/${leadToken}/pass.pkpass`, null, { auth: false })).status, 400);

  const tooMany = await call('POST', `/public/invite/${leadToken}/rsvp`, { status: 'attending', companions: ['A B', 'C D'] }, { auth: false });
  assert.equal(tooMany.status, 400);

  await call('POST', `/public/invite/${leadToken}/rsvp`, { status: 'attending', companions: ['Mona Ali'], dietary: 'Vegan' }, { auth: false });
  const lead = get('SELECT * FROM guests WHERE id = ?', leadId);
  assert.equal(lead.rsvp_status, 'attending');
  assert.equal(lead.rsvp_party_size, 2);
  const mona = get('SELECT * FROM guests WHERE party_lead_id = ?', leadId);
  assert.equal(mona.first_name, 'Mona');

  // Resubmitting keeps the same companion record (and anything staff arranged for her).
  await call('POST', `/public/invite/${leadToken}/rsvp`, { status: 'attending', companions: ['mona  ali'] }, { auth: false });
  assert.equal(get('SELECT id FROM guests WHERE party_lead_id = ?', leadId).id, mona.id);

  // Wallet not configured in tests → clear 503, calendar always works.
  assert.equal((await call('GET', `/public/invite/${leadToken}/pass.pkpass`, null, { auth: false })).status, 503);
  const ics = await call('GET', `/public/invite/${leadToken}/event.ics`, null, { auth: false, raw: true });
  assert.match(await ics.text(), /DTSTART:20300110T160000Z/); // 19:00 Riyadh = 16:00 UTC

  assert.equal((await call('GET', '/public/invite/nope', null, { auth: false })).status, 404);
});

test('flight landing and transfers update guest locations', async () => {
  const companionId = get('SELECT id FROM guests WHERE party_lead_id = ?', leadId).id;
  const flightId = (await call('POST', `/events/${eventId}/flights`, {
    direction: 'arrival', service_type: 'tanfeethi', tail_number: 'HZ-ABC', scheduled_at: '2030-01-09T15:00', passenger_ids: [leadId, companionId],
  })).data.id;
  await call('PUT', `/flights/${flightId}`, { status: 'landed' });
  assert.equal(get('SELECT current_status FROM guests WHERE id = ?', companionId).current_status, 'landed');

  const hotel = (await call('POST', '/hotels', { name: 'Ritz' })).data.id;
  await call('POST', '/accommodations', { guest_id: leadId, hotel_id: hotel, room_number: '101' });
  const vehicle = (await call('POST', '/vehicles', { plate: 'ABC 123' })).data.id;
  const driver = (await call('POST', '/drivers', { name: 'Khalid' })).data.id;
  const t = await call('POST', `/events/${eventId}/transfers`, {
    kind: 'airport_pickup', pickup: 'Executive terminal', dropoff: 'Ritz', scheduled_at: '2030-01-09T15:30',
    vehicle_id: vehicle, driver_id: driver, flight_id: flightId, passenger_ids: [leadId, companionId],
  });
  // A second trip 20 minutes later for the same driver is flagged.
  const clash = await call('POST', `/events/${eventId}/transfers`, { kind: 'custom', scheduled_at: '2030-01-09T15:50', driver_id: driver });
  assert.equal(clash.data.conflicts.length, 1);

  // The driver works from their private link.
  const token = get('SELECT access_token FROM drivers WHERE id = ?', driver).access_token;
  const sheet = await call('GET', `/public/driver/${token}`, null, { auth: false });
  assert.ok(sheet.data.transfers.some((x) => x.id === t.data.id));
  await call('POST', `/public/driver/${token}/transfers/${t.data.id}/status`, { status: 'picked_up' }, { auth: false });
  assert.equal(get('SELECT current_status FROM guests WHERE id = ?', leadId).current_status, 'in_transit');
  assert.equal(get('SELECT status FROM drivers WHERE id = ?', driver).status, 'on_duty');
  await call('POST', `/public/driver/${token}/transfers/${t.data.id}/status`, { status: 'completed' }, { auth: false });
  const lead = get('SELECT * FROM guests WHERE id = ?', leadId);
  assert.equal(lead.current_status, 'at_hotel');
  assert.equal(lead.current_location, 'Ritz');
  assert.equal(get('SELECT status FROM vehicles WHERE id = ?', vehicle).status, 'available');

  // Another driver's link cannot touch this trip.
  const other = (await call('POST', '/drivers', { name: 'Other' })).data.id;
  const otherToken = get('SELECT access_token FROM drivers WHERE id = ?', other).access_token;
  assert.equal((await call('POST', `/public/driver/${otherToken}/transfers/${t.data.id}/status`, { status: 'en_route' }, { auth: false })).status, 404);

  const detail = (await call('GET', `/guests/${leadId}`)).data;
  assert.equal(detail.flights[0].service_type, 'tanfeethi');
  assert.match(detail.flights[0].co_passengers, /Mona/);
  assert.equal(detail.accommodations[0].hotel_name, 'Ritz');
  assert.ok(detail.movements.length >= 3);
});

test('door check-in by invitation code', async () => {
  const first = await call('POST', '/check-in', { token: `http://host/i/${leadToken}`, event_id: eventId });
  assert.equal(first.data.already, false);
  assert.equal(first.data.party.length, 1);
  assert.equal(get('SELECT current_status FROM guests WHERE id = ?', leadId).current_status, 'at_venue');
  assert.equal((await call('POST', '/check-in', { token: leadToken })).data.already, true);
  assert.equal((await call('POST', '/check-in', { token: 'bad' })).status, 404);
});

test('viewers are read-only and only admins manage staff', async () => {
  await call('POST', '/users', { name: 'Viewer', email: 'v@x.com', password: 'secret123', role: 'viewer' });
  const adminCookie = cookie;
  await call('POST', '/auth/login', { email: 'v@x.com', password: 'secret123' });
  assert.equal((await call('GET', `/events/${eventId}/guests`)).status, 200);
  assert.equal((await call('POST', `/events/${eventId}/guests`, { first_name: 'Nope' })).status, 403);
  cookie = adminCookie;
  const dash = (await call('GET', `/events/${eventId}/dashboard`)).data;
  assert.equal(dash.totals.checked_in, 1);
  assert.equal(dash.rsvp.attending, 2);
});
