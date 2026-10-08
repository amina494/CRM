// Creating an event from the arrivals workbook and the liaison list.
// The workbooks are built here with made-up people; no real data is used.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { openDb, all, get } from '../server/db.js';
import { createApp } from '../server/app.js';
import { flightLegs, personKey, splitName, toTime, normalisePhone } from '../server/services/arrivalsImport.js';

let server;
let base;
function client() {
  const c = { cookie: '' };
  c.call = async (method, path, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(base + path, {
      method,
      headers: { ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...headers },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) c.cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  c.login = (email) => c.call('POST', '/auth/login', { email, password: 'secret123' });
  return c;
}
const admin = client();

const d = (day) => new Date(Date.UTC(2031, 1, day));
const t = (h, m = 0) => new Date(Date.UTC(1899, 11, 30, h, m));

async function workbook(tabs) {
  const wb = new ExcelJS.Workbook();
  for (const { name, rows, hidden } of tabs) {
    const ws = wb.addWorksheet(name, { state: hidden ? 'hidden' : 'visible' });
    for (const r of rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const ARR_HEAD = [null, 'COUNTRY', 'NAME ', 'POSITION', 'TYPE', 'HOTEL', 'ARRIVAL TO AL ULA', 'FLIGHT NUMBER', 'ARRIVAL TIME ', 'CHARTER', 'ATF',
  'DEPARTURE FROM AL ULA', 'FLIGHT NUMBER', 'TIME', 'CHARTER', 'ATF', 'CITY', 'NOTE'];

let arrivals;
let liaisons;
before(async () => {
  openDb(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  await admin.call('POST', '/setup', { name: 'Admin', email: 'admin@x.com', password: 'secret123' });
  const ev = (await admin.call('POST', '/events', { name: 'Gala', starts_at: '2031-01-10T19:00' })).data.id;
  await admin.call('POST', '/users', { name: 'Coord', email: 'coord@x.com', password: 'secret123', memberships: [{ event_id: ev, role: 'coordinator' }] });
  await admin.call('POST', '/hotels', { name: 'Cloud 7' }); // already known: must be reused

  arrivals = await workbook([
    { name: 'ARRIVALS OLD', rows: [ARR_HEAD,
      [1, 'Narnia', 'H.E. Aster Vale', 'Minister of Finance', 'VIP', 'Banyan /Dune Villa', d(5), 'SV 1630', t(15, 50), 'FLIGHT', 'YES', d(9), 'SV 1631', t(16, 45), 'FLIGHT', null, 'Jeddah'],
      [2, 'Narnia', 'Bran Holt', 'Companion of Aster Vale', 'Companion', 'Banyan Tree', d(5), 'SV 1630', t(15, 50), 'FLIGHT', 'YES', d(9), 'SV 1631', t(16, 45), 'FLIGHT', null, 'Jeddah'],
      [3, 'Oz', 'Cora Lind', 'Delegate', 'Delegate', 'Cloud7', d(6), 'XY159', t(12, 25), 'FLIGHT', 'NO', d(10), 'Charter', 'Charter', 'CHARTER B', null, 'Riyadh'],
    ] },
    { name: 'Hidden old list', hidden: true, rows: [ARR_HEAD, [1, 'Oz', 'Ghost Person', 'x', 'VIP', 'Cloud 7', d(5), 'SV 1', t(1), 'FLIGHT', 'NO']] },
    { name: 'LATEST', rows: [ARR_HEAD,
      [1, 'Narnia', 'Aster Vale', 'Minister of Finance', 'VIP', 'Our Habitas', d(5), 'SV 1630', t(15, 50), 'FLIGHT', 'Yes', d(9), 'SV 1631', t(16, 45), 'FLIGHT', null, 'Jeddah', 'Needs a car'],
      [2, 'Oz', 'DORA MAY KITE', 'Speaker', 'Speaker', 'Other', d(6), 'QR1202/SV 1576', t(19, 25), 'FLIGHT', 'Yes', null, null, null, null, null, null],
      [3, 'Oz', 'Evan Kite', 'Spouse', 'Companion', 'Cloud 7 / Bungalow', d(6), 'SV 1576', t(19, 25), 'FLIGHT', 'No', d(10), 'Charter', t(10), 'CHARTER B', null, 'Riyadh'],
    ] },
    { name: 'DEPARTURES', rows: [
      ['Nationality', 'Name', 'Position', 'Type', 'Hotel/Room Type', 'Depature Date from alula ', 'Flight No', 'Departure Time from Alula', 'Charter A/B', 'ATF', 'Stop 1', 'PA', 'Driver'],
      ['Oz', 'Cora Lind', 'Delegate', 'Delegate', 'Cloud7', d(10), null, t(10), 'Charter B', 'NO', 'Riyadh', 'YES', 'YES'],
      ['Oz', 'Dora May Kite', 'Speaker', 'Speaker', null, d(11), 'EK 2411', t(18, 50), 'FLIGHT', null, 'Dubai', null, null],
    ] },
  ]);
  liaisons = await workbook([
    { name: 'LIAISON - ARRIVAL', rows: [
      ['#', 'NAME ', 'POSTION ', 'COUNTRY', 'LIAISON NAME', 'PHONE NUMBER', 'MEDICAL CONDITIONS', 'Passport/\nID No.', 'TRANSPORT TYPE'],
      [1, 'Aster Vale', 'Minister', 'Narnia', 'Hala Noor', 512345678, 'secret medical note', 'P1234567', 'LAND CRUISER'],
      [2, 'Dora Kite', 'Speaker', 'Oz', 'Omar Reef', '0598765432', null, 'P7654321', null],
      [3, 'Nobody Known', 'x', 'Oz', 'Hala Noor', 512345678, null, null, null],
    ] },
    { name: 'LIAISON - DEPARTURE', rows: [
      ['#', 'NAME ', 'POSTION ', 'COUNTRY', 'LIAISON NAME', 'PHONE NUMBER'],
      [1, 'Aster Vale', 'Minister', 'Narnia', 'Sami Lake', 511111111],
    ] },
  ]);
});
after(() => server.close());

const upload = async (c, buf, name) => c.call('POST', '/imports/files', buf, { 'Content-Type': 'application/octet-stream', 'X-File-Name': name });

test('value helpers read the sheet the way the team writes it', () => {
  assert.deepEqual(splitName('H.E. Fo\'an Lan'), { title: 'H.E.', first: 'Fo\'an', last: 'Lan' });
  assert.deepEqual(splitName('Ms.Yanrong Wang'), { title: 'Ms.', first: 'Yanrong', last: 'Wang' });
  assert.deepEqual(splitName('SULTAN AL HABSI'), { title: null, first: 'Sultan', last: 'Al Habsi' });
  assert.equal(splitName('He Lifeng').first, 'He', '"He" is a surname, not H.E.');
  assert.equal(personKey('Mr. Long MA '), personKey('long ma'));
  assert.deepEqual(flightLegs('SV 382/SV1630'), ['SV 382', 'SV 1630']);
  assert.deepEqual(flightLegs('Charter'), []);
  assert.equal(toTime(t(9, 5)), '09:05');
  assert.equal(toTime('01:50:00 to Medinah'), '01:50');
  assert.equal(normalisePhone(512345678), '+966512345678');
  assert.equal(normalisePhone('0598765432'), '+966598765432');
});

test('only admins can import, and only Excel files are accepted', async () => {
  const coord = client(); await coord.login('coord@x.com');
  assert.equal((await upload(coord, arrivals, 'a.xlsx')).status, 403);
  assert.equal((await upload(admin, Buffer.from('name,phone\nA,1'), 'a.csv')).status, 400);
  const other = await upload(admin, arrivals, 'a.xlsx');
  assert.equal((await coord.call('POST', '/imports/preview', { arrivals: other.data.file_id })).status, 403);
});

test('the preview merges tabs (newest wins), links companions and matches liaisons', async () => {
  const a = await upload(admin, arrivals, 'Copy of TEST31 Arrivals.xlsx');
  const l = await upload(admin, liaisons, 'liaisons.xlsx');
  assert.equal(a.status, 201);
  const { status, data } = await admin.call('POST', '/imports/preview', { arrivals: a.data.file_id, liaisons: l.data.file_id });
  assert.equal(status, 200);
  const g = Object.fromEntries(data.guests.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(g).sort(), ['Aster Vale', 'Bran Holt', 'Cora Lind', 'Dora May Kite', 'Evan Kite'].sort(), 'hidden tabs are ignored, duplicates merged');
  assert.equal(g['Aster Vale'].hotel, 'Our Habitas', 'the newer tab wins');
  assert.ok(data.report.conflicts.some((c) => c.guest === 'Aster Vale' && c.field === 'hotel' && c.other === 'Banyan Tree'));
  assert.equal(g['Cora Lind'].hotel, 'Cloud 7', '"Cloud7" and "Cloud 7" are one hotel');
  assert.equal(g['Cora Lind'].departure.mode, 'Charter B');
  assert.ok(g['Cora Lind'].notes.includes('PA: yes'));
  assert.equal(g['Dora May Kite'].hotel, null);
  assert.ok(g['Dora May Kite'].notes.includes('Hotel: Other'));
  assert.equal(g['Dora May Kite'].arrival.flight, 'QR 1202 / SV 1576');
  assert.equal(g['Dora May Kite'].departure.flight, 'EK 2411', 'departure comes from the departures tab');
  assert.equal(g['Bran Holt'].lead, 'Aster Vale', 'companion named in the position');
  assert.equal(g['Evan Kite'].lead, 'Dora May Kite', 'spouse listed just above, same country');
  assert.equal(g['Evan Kite'].relationship, 'Spouse');
  assert.equal(g['Aster Vale'].liaison, 'Hala Noor');
  assert.equal(g['Aster Vale'].backup_liaison, 'Sami Lake', 'a different departure liaison becomes the backup');
  assert.equal(g['Dora May Kite'].liaison, 'Omar Reef', '"Dora Kite" matched by a similar spelling');
  assert.deepEqual(data.report.liaison_unmatched, ['Nobody Known']);
  assert.equal(data.liaisons.find((x) => x.name === 'Hala Noor').phone, '+966512345678');
  assert.ok(g['Aster Vale'].notes.includes('Car: Land Cruiser'));
  assert.equal(JSON.stringify(data).includes('P1234567') || JSON.stringify(data).includes('secret medical'), false, 'passport and medical columns are never read');
  assert.equal(data.suggested.starts_on, '2031-02-05');
  assert.equal(data.suggested.ends_on, '2031-02-11');
  assert.equal(data.suggested.venue, 'Alula', 'from the newest tab'"'"'s "Depature Date from alula" header');
});

test('creating the event writes guests, companions, hotels, flights and liaisons', async () => {
  const a = await upload(admin, arrivals, 'a.xlsx');
  const l = await upload(admin, liaisons, 'l.xlsx');
  const res = await admin.call('POST', '/imports/create', {
    arrivals: a.data.file_id, liaisons: l.data.file_id,
    event: { name: 'Test Summit', venue: 'AlUla', starts_at: '2031-02-05T09:00', ends_at: '2031-02-11T18:00' },
  });
  assert.equal(res.status, 201);
  const id = res.data.event_id;
  const guests = all('SELECT * FROM guests WHERE event_id = ?', id);
  assert.equal(guests.length, 5);
  assert.ok(guests.every((x) => x.rsvp_status === 'attending' && x.source === 'import' && x.checkin_code && x.invite_token));
  const by = (first) => guests.find((x) => x.first_name === first);
  assert.equal(by('Aster').title, 'H.E.');
  assert.equal(by('Dora').last_name, 'May Kite', 'capitals tidied');
  assert.equal(by('Bran').party_lead_id, by('Aster').id);
  assert.equal(by('Bran').category, 'companion');
  assert.equal(get('SELECT name FROM users WHERE id = ?', by('Aster').host_user_id).name, 'Hala Noor');
  assert.equal(get('SELECT name FROM users WHERE id = ?', by('Aster').backup_host_user_id).name, 'Sami Lake');
  const hala = get("SELECT * FROM users WHERE name = 'Hala Noor'");
  assert.match(hala.email, /@liaisons\.invalid$/);
  assert.equal(get('SELECT role FROM event_members WHERE event_id = ? AND user_id = ?', id, hala.id).role, 'liaison');

  assert.equal(all("SELECT id FROM hotels WHERE name = 'Cloud 7'").length, 1, 'existing hotel reused');
  const stay = get('SELECT a.*, h.name AS hotel FROM accommodations a JOIN hotels h ON h.id = a.hotel_id WHERE guest_id = ?', by('Evan').id);
  assert.equal(stay.hotel, 'Cloud 7');
  assert.equal(stay.room_type, 'Bungalow');
  assert.equal(stay.check_in, '2031-02-06T19:25');

  const flights = all('SELECT * FROM flights WHERE event_id = ?', id);
  const sv1630 = flights.find((f) => f.flight_number === 'SV 1630');
  assert.equal(sv1630.service_type, 'tanfeethi');
  assert.equal(sv1630.destination, 'AlUla');
  assert.equal(sv1630.scheduled_at, '2031-02-05T15:50');
  assert.equal(all('SELECT * FROM flight_passengers WHERE flight_id = ?', sv1630.id).length, 2);
  // SV 1576 on the 6th: Dora (Tanfeethi) and Evan (general) are handled separately.
  assert.deepEqual(flights.filter((f) => f.flight_number === 'SV 1576').map((f) => f.service_type).sort(), ['general', 'tanfeethi']);
  const charter = flights.find((f) => f.flight_number === 'Charter B');
  assert.equal(charter.direction, 'departure');
  assert.equal(all('SELECT * FROM flight_passengers WHERE flight_id = ?', charter.id).length, 2);

  // Files are single-use.
  assert.equal((await admin.call('POST', '/imports/preview', { arrivals: a.data.file_id })).status, 400);
});
