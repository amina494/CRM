// Loads realistic demo data. Dates are relative to today so the
// dashboard's "today" boards always have something on them.
//   npm run seed            – seed an empty database
//   npm run seed -- --reset – wipe the database first
import fs from 'node:fs';
import { config } from './config.js';
import { openDb, insert, run, get } from './db.js';
import { hashPassword, newToken } from './auth.js';
import { todayIn } from './services/format.js';
import { recordMovement } from './services/tracking.js';

if (process.argv.includes('--reset') && fs.existsSync(config.dbPath)) {
  for (const f of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) fs.rmSync(f, { force: true });
}
openDb();
if (get('SELECT id FROM users LIMIT 1')) {
  console.log('Database already has data. Run `npm run seed -- --reset` to start over.');
  process.exit(0);
}

const today = todayIn();
const day = (offset, time) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return `${d.toISOString().slice(0, 10)}T${time}`;
};
const add = (table, data) => insert(table, data, Object.keys(data));

// Staff
const admin = add('users', { name: 'Event Admin', email: 'admin@example.com', role: 'admin', password_hash: hashPassword('admin1234'), phone: '+966500000001' });
const sara = add('users', { name: 'Sara Al-Qahtani', email: 'sara@example.com', role: 'liaison', password_hash: hashPassword('liaison1234'), phone: '+966500000002' });
const faisal = add('users', { name: 'Faisal Al-Harbi', email: 'faisal@example.com', role: 'liaison', password_hash: hashPassword('liaison1234'), phone: '+966500000003' });
const noura = add('users', { name: 'Noura Al-Saud', email: 'noura@example.com', role: 'coordinator', password_hash: hashPassword('coord1234'), phone: '+966500000004' });
const omar = add('users', { name: 'Omar Al-Rashed', email: 'viewer@example.com', role: 'viewer', password_hash: hashPassword('viewer1234'), phone: '+966500000005' });
const huda = add('users', { name: 'Huda Al-Mansour', email: 'huda@example.com', role: 'coordinator', password_hash: hashPassword('coord1234'), phone: '+966500000006' });

const event = add('events', {
  name: 'Annual Leadership Gala 2026', name_ar: 'الحفل السنوي للقيادات 2026',
  description: 'An evening celebrating partnership and vision, followed by dinner.',
  description_ar: 'أمسية احتفاء بالشراكة والرؤية يعقبها عشاء.',
  venue: 'Diriyah Arena', venue_ar: 'ساحة الدرعية', venue_address: 'Diriyah, Riyadh, Saudi Arabia',
  venue_lat: 24.7336, venue_lng: 46.5753,
  starts_at: day(1, '19:30'), ends_at: day(1, '23:30'), timezone: 'Asia/Riyadh',
  dress_code: 'Formal / National dress', dress_code_ar: 'رسمي / الزي الوطني',
  rsvp_deadline: day(0, '23:59'), host_name: 'The Organising Committee', host_name_ar: 'اللجنة المنظمة',
});

// Hotels, seating, fleet
const ritz = add('hotels', { name: 'The Ritz-Carlton, Riyadh', address: 'Al Hada Area, Riyadh', phone: '+966112008000', contact_person: 'Guest Relations Desk' });
const fourSeasons = add('hotels', { name: 'Four Seasons Hotel Riyadh', address: 'Kingdom Centre, Riyadh', phone: '+966112115000', contact_person: 'VIP Services' });
const tables = Object.fromEntries([
  ['Head Table', 'Stage', 12], ['Table 1', 'Royal', 10], ['Table 2', 'Royal', 10], ['Table 3', 'Main Hall', 10], ['Table 4', 'Main Hall', 10],
].map(([name, zone, capacity]) => [name, add('seating_tables', { event_id: event, name, zone, capacity })]));

const vehicles = [
  ['RUH 1001', 'Mercedes-Benz', 'S-Class', 'Black', 'sedan', 3],
  ['RUH 1002', 'Mercedes-Benz', 'S-Class', 'Black', 'sedan', 3],
  ['RUH 2001', 'Cadillac', 'Escalade', 'Black', 'suv', 6],
  ['RUH 2002', 'GMC', 'Yukon Denali', 'White', 'suv', 6],
  ['RUH 3001', 'Mercedes-Benz', 'V-Class', 'Black', 'van', 7],
].map(([plate, make, model, color, type, capacity]) => add('vehicles', { plate, make, model, color, type, capacity }));
const drivers = [
  ['Abdullah Al-Mutairi', '+966551110001', 'Arabic, English'],
  ['Khalid Al-Shehri', '+966551110002', 'Arabic, English'],
  ['Omar Al-Zahrani', '+966551110003', 'Arabic, English, French'],
  ['Majed Al-Dossary', '+966551110004', 'Arabic'],
].map(([name, phone, languages]) => add('drivers', { name, phone, languages, access_token: newToken(18), token_issued_at: new Date().toISOString() }));

// Guests
function guest(data) {
  return add('guests', { event_id: event, invite_token: newToken(18), checkin_code: newToken(12), ...data });
}
const sent = { invite_status: 'sent', invited_at: new Date(Date.now() - 6 * 864e5).toISOString() };
const attending = (n = 1) => ({ ...sent, invite_status: 'opened', opened_at: new Date(Date.now() - 5 * 864e5).toISOString(), rsvp_status: 'attending', rsvp_party_size: n, rsvp_at: new Date(Date.now() - 4 * 864e5).toISOString() });

const minister = guest({ title: 'H.E.', first_name: 'Ahmed', last_name: 'Al-Rashid', name_ar: 'معالي أحمد الراشد', category: 'vvip', language: 'ar', organization: 'Ministry of Culture', position: 'Minister', nationality: 'Saudi', phone: '+966500100100', email: 'office.alrashid@example.com', plus_ones_allowed: 2, host_user_id: sara, backup_host_user_id: faisal, table_id: tables['Head Table'], seat_number: '1', vehicle_id: vehicles[0], driver_id: drivers[0], ...attending(3) });
const ministerAide = guest({ first_name: 'Yousef', last_name: 'Al-Qahtani', category: 'companion', party_lead_id: minister, relationship: 'Chief of Staff', language: 'ar', host_user_id: sara, table_id: tables['Table 1'], seat_number: '1', rsvp_status: 'attending' });
const ministerSecurity = guest({ first_name: 'Turki', last_name: 'Al-Anazi', category: 'staff', party_lead_id: minister, relationship: 'Security', language: 'ar', host_user_id: sara, rsvp_status: 'attending' });

const ceo = guest({ title: 'Mr.', first_name: 'James', last_name: 'Whitfield', category: 'vip', organization: 'Northbridge Capital', position: 'CEO', nationality: 'British', email: 'j.whitfield@example.com', phone: '+447700900123', plus_ones_allowed: 1, host_user_id: faisal, table_id: tables['Head Table'], seat_number: '4', vehicle_id: vehicles[2], driver_id: drivers[2], ...attending(2) });
const ceoSpouse = guest({ title: 'Mrs.', first_name: 'Eleanor', last_name: 'Whitfield', category: 'companion', party_lead_id: ceo, relationship: 'Spouse', host_user_id: faisal, table_id: tables['Head Table'], seat_number: '5', rsvp_status: 'attending', dietary: 'Vegetarian' });

const ambassador = guest({ title: 'H.E.', first_name: 'Marie', last_name: 'Laurent', category: 'vip', organization: 'Embassy of France', position: 'Ambassador', nationality: 'French', email: 'ambassade@example.com', phone: '+966500200200', plus_ones_allowed: 1, host_user_id: sara, table_id: tables['Head Table'], seat_number: '2', vehicle_id: vehicles[1], driver_id: drivers[1], ...attending(1) });

const delegationLead = guest({ title: 'Dr.', first_name: 'Hiroshi', last_name: 'Tanaka', category: 'delegation', organization: 'Japan Trade Delegation', position: 'Head of Delegation', nationality: 'Japanese', email: 'h.tanaka@example.com', phone: '+81312345678', plus_ones_allowed: 3, host_user_id: faisal, table_id: tables['Table 2'], seat_number: '1', ...attending(4) });
const delegation = ['Kenji Sato', 'Yuki Nakamura', 'Aiko Watanabe'].map((n, i) => {
  const [first, last] = n.split(' ');
  return guest({ first_name: first, last_name: last, category: 'delegation', party_lead_id: delegationLead, relationship: 'Delegate', host_user_id: faisal, table_id: tables['Table 2'], seat_number: String(i + 2), rsvp_status: 'attending' });
});

const others = [
  ['Dr.', 'Layla', 'Al-Faisal', 'د. ليلى الفيصل', 'vip', 'ar', 'King Saud University', 'Dean', noura, 'attending'],
  ['Mr.', 'Omar', 'Haddad', null, 'general', 'en', 'Gulf Media Group', 'Editor-in-Chief', noura, 'attending'],
  ['Ms.', 'Sophia', 'Chen', null, 'media', 'en', 'Asia Business Daily', 'Correspondent', noura, 'tentative'],
  ['Eng.', 'Saad', 'Al-Ghamdi', 'م. سعد الغامدي', 'general', 'ar', 'NEOM', 'Director', faisal, 'attending'],
  ['Mr.', 'Daniel', 'Okafor', null, 'general', 'en', 'Lagos Ventures', 'Partner', null, 'declined'],
  ['Ms.', 'Reem', 'Al-Otaibi', 'أ. ريم العتيبي', 'general', 'ar', 'Ministry of Investment', 'Advisor', sara, 'pending'],
  ['Mr.', 'Lucas', 'Moreau', null, 'general', 'en', 'Moreau & Fils', 'Founder', null, 'pending'],
  ['Prof.', 'Nadia', 'Rahman', null, 'vip', 'en', 'Oxford University', 'Professor', noura, 'attending'],
];
const otherIds = others.map(([title, first, last, ar, category, language, org, position, host, rsvp], i) =>
  guest({
    title, first_name: first, last_name: last, name_ar: ar, category, language, organization: org, position,
    email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@example.com`, phone: `+9665003000${10 + i}`,
    host_user_id: host, ...(rsvp === 'pending' ? (i % 2 ? {} : sent) : { ...attending(1), rsvp_status: rsvp, rsvp_party_size: rsvp === 'attending' ? 1 : 0 }),
    ...(rsvp === 'attending' ? { table_id: tables[i % 2 ? 'Table 3' : 'Table 4'], seat_number: String(i + 1) } : {}),
  }));
const layla = otherIds[0];
const nadia = otherIds[7];

// Accommodation
const stay = (guestId, hotel, room, type, inDay = 0, outDay = 3, status = 'reserved') => add('accommodations', {
  guest_id: guestId, hotel_id: hotel, room_number: room, room_type: type, check_in: day(inDay, '14:00'),
  check_out: day(outDay, '12:00'), confirmation_no: `CNF-${1000 + guestId}`, status,
});
stay(minister, ritz, '1801', 'Royal Suite', -1, 2, 'checked_in');
stay(ministerAide, ritz, '1803', 'Deluxe King', -1, 2, 'checked_in');
stay(ministerSecurity, ritz, '1804', 'Deluxe King', -1, 2, 'checked_in');
stay(ceo, fourSeasons, '2901', 'Kingdom Suite');
stay(ceoSpouse, fourSeasons, '2901', 'Kingdom Suite');
stay(ambassador, fourSeasons, '2405', 'Premier Room');
stay(delegationLead, ritz, '1502', 'Executive Suite');
delegation.forEach((g, i) => stay(g, ritz, String(1510 + i), 'Deluxe Twin'));
stay(nadia, fourSeasons, '2210', 'Deluxe Room');

// Flights
const flight = (data, passengers) => {
  const id = add('flights', { event_id: event, ...data });
  for (const g of passengers) add('flight_passengers', { flight_id: id, guest_id: g });
  return id;
};
const ceoFlight = flight({ direction: 'arrival', service_type: 'tanfeethi', airline: 'Private (Gulfstream G650)', tail_number: 'G-NBCP', origin: 'London Farnborough (FAB)', destination: 'Riyadh (RUH)', terminal: 'Executive Terminal (Tanfeethi)', scheduled_at: day(0, '15:40'), status: 'departed' }, [ceo, ceoSpouse]);
const delegationFlight = flight({ direction: 'arrival', service_type: 'general', airline: 'Saudia', flight_number: 'SV 881', origin: 'Tokyo Narita (NRT)', destination: 'Riyadh (RUH)', terminal: 'Terminal 3', scheduled_at: day(0, '06:10'), status: 'landed' }, [delegationLead, ...delegation]);
flight({ direction: 'arrival', service_type: 'general', airline: 'Air France', flight_number: 'AF 528', origin: 'Paris CDG', destination: 'Riyadh (RUH)', terminal: 'Terminal 1', scheduled_at: day(0, '18:25'), estimated_at: day(0, '18:55'), status: 'delayed' }, [ambassador]);
flight({ direction: 'arrival', service_type: 'general', airline: 'British Airways', flight_number: 'BA 263', origin: 'London Heathrow (LHR)', destination: 'Riyadh (RUH)', terminal: 'Terminal 1', scheduled_at: day(1, '07:05'), status: 'scheduled' }, [nadia]);
flight({ direction: 'departure', service_type: 'tanfeethi', airline: 'Private (Gulfstream G650)', tail_number: 'G-NBCP', origin: 'Riyadh (RUH)', destination: 'London Farnborough (FAB)', terminal: 'Executive Terminal (Tanfeethi)', scheduled_at: day(3, '11:00'), status: 'scheduled' }, [ceo, ceoSpouse]);

// Transfers
const transfer = (data, passengers) => {
  const id = add('transfers', { event_id: event, ...data });
  for (const g of passengers) add('transfer_passengers', { transfer_id: id, guest_id: g });
  return id;
};
const delegationPickup = transfer({ kind: 'airport_pickup', pickup: 'RUH Terminal 3', dropoff: 'The Ritz-Carlton, Riyadh', scheduled_at: day(0, '06:30'), vehicle_id: vehicles[4], driver_id: drivers[3], flight_id: delegationFlight }, [delegationLead, ...delegation]);
transfer({ kind: 'airport_pickup', pickup: 'RUH Executive Terminal', dropoff: 'Four Seasons Hotel Riyadh', scheduled_at: day(0, '15:40'), vehicle_id: vehicles[2], driver_id: drivers[2], flight_id: ceoFlight }, [ceo, ceoSpouse]);
transfer({ kind: 'airport_pickup', pickup: 'RUH Terminal 1', dropoff: 'Four Seasons Hotel Riyadh', scheduled_at: day(0, '19:00'), vehicle_id: vehicles[1], driver_id: drivers[1] }, [ambassador]);
transfer({ kind: 'to_venue', pickup: 'The Ritz-Carlton, Riyadh', dropoff: 'Diriyah Arena', scheduled_at: day(1, '18:45'), vehicle_id: vehicles[0], driver_id: drivers[0] }, [minister, ministerAide]);
transfer({ kind: 'to_venue', pickup: 'Four Seasons Hotel Riyadh', dropoff: 'Diriyah Arena', scheduled_at: day(1, '18:50'), vehicle_id: vehicles[2], driver_id: drivers[2] }, [ceo, ceoSpouse]);
transfer({ kind: 'to_venue', pickup: 'The Ritz-Carlton, Riyadh', dropoff: 'Diriyah Arena', scheduled_at: day(1, '18:40'), vehicle_id: vehicles[4], driver_id: drivers[3] }, [delegationLead, ...delegation]);
transfer({ kind: 'airport_pickup', pickup: 'RUH Terminal 1', dropoff: 'Four Seasons Hotel Riyadh', scheduled_at: day(1, '07:30'), vehicle_id: vehicles[3] }, [nadia]);

// Movement history
for (const g of [minister, ministerAide, ministerSecurity]) {
  recordMovement(g, { status: 'at_hotel', location: 'The Ritz-Carlton, Riyadh', note: 'Arrived yesterday', by: 'Sara Al-Qahtani' });
}
for (const g of [ceo, ceoSpouse]) recordMovement(g, { status: 'in_flight', location: 'Private (Gulfstream G650) G-NBCP from London Farnborough', by: 'System' });
for (const g of [delegationLead, ...delegation]) {
  recordMovement(g, { status: 'landed', location: 'RUH Terminal 3', note: 'SV 881 landed', by: 'System' });
  recordMovement(g, { status: 'in_transit', location: 'RUH Terminal 3 → The Ritz-Carlton, Riyadh', transferId: delegationPickup, by: 'Driver Majed Al-Dossary' });
  recordMovement(g, { status: 'at_hotel', location: 'The Ritz-Carlton, Riyadh', transferId: delegationPickup, by: 'Driver Majed Al-Dossary' });
}
run("UPDATE transfers SET status = 'completed', started_at = ?, picked_up_at = ?, completed_at = ? WHERE id = ?",
  new Date(Date.now() - 5 * 3600e3).toISOString(), new Date(Date.now() - 4.5 * 3600e3).toISOString(), new Date(Date.now() - 4 * 3600e3).toISOString(), delegationPickup);
recordMovement(layla, { status: 'not_arrived', note: 'Local guest – driving herself', by: 'Noura Al-Saud' });

// Who works on which event, and as what.
for (const [user, role] of [[noura, 'coordinator'], [sara, 'liaison'], [faisal, 'liaison'], [omar, 'viewer']]) {
  add('event_members', { event_id: event, user_id: user, role });
}

// A second event that only Huda (and admins) can see.
const retreat = add('events', {
  name: 'Board Retreat 2026', starts_at: day(30, '09:00'), ends_at: day(32, '17:00'), venue: 'AlUla', timezone: 'Asia/Riyadh',
});
add('event_members', { event_id: retreat, user_id: huda, role: 'coordinator' });
for (const [first, last] of [['Khalid', 'Al-Faisal'], ['Mona', 'Al-Harbi']]) {
  add('guests', { event_id: retreat, first_name: first, last_name: last, invite_token: newToken(18), checkin_code: newToken(12), host_user_id: huda });
}

// A past event whose guest data is due for removal (for the retention screen).
const past = add('events', {
  name: 'Spring Reception 2026', starts_at: day(-200, '19:00'), ends_at: day(-200, '23:00'), venue: 'Riyadh', timezone: 'Asia/Riyadh', retention_days: 90,
});
for (const [first, last] of [['Fahad', 'Al-Otaibi'], ['Rania', 'Haddad'], ['Peter', 'Lang']]) {
  add('guests', { event_id: past, first_name: first, last_name: last, email: `${first.toLowerCase()}@example.com`, invite_token: newToken(18), checkin_code: newToken(12), rsvp_status: 'attending', checked_in_at: new Date(Date.now() - 200 * 864e5).toISOString() });
}

console.log(`Seeded demo data for "Annual Leadership Gala 2026" (event ${event}), plus "Board Retreat 2026" and a past "Spring Reception 2026".`);
console.log('Sign in as:');
console.log('  admin@example.com   / admin1234    admin (all events)');
console.log('  noura@example.com   / coord1234    coordinator, Gala');
console.log('  sara@example.com    / liaison1234  liaison, Gala (hosts the Minister\'s party)');
console.log('  faisal@example.com  / liaison1234  liaison, Gala');
console.log('  viewer@example.com  / viewer1234   viewer, Gala (read-only)');
console.log('  huda@example.com    / coord1234    coordinator, Board Retreat only');
void admin;
