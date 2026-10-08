// Creating an event from the operations spreadsheet (admins only).
//
//   POST /api/imports/files            raw .xlsx body → { file_id }
//   POST /api/imports/preview          { arrivals, liaisons? } → what would be created
//   POST /api/imports/create           { arrivals, liaisons?, event } → { event_id }
//
// Uploaded workbooks are kept in memory only, for the person who uploaded
// them, and are dropped after 30 minutes or once the event is created. They
// are never written to disk.
import express, { Router } from 'express';
import { all, get, insert, run, tx, logActivity } from '../db.js';
import { hashPassword, newToken, requireAdmin } from '../auth.js';
import { newCheckinCode } from './guests.js';
import { EVENT_FIELDS } from './events.js';
import { readWorkbook, buildPlan } from '../services/arrivalsImport.js';
import { badRequest } from '../services/tracking.js';

const r = Router();
const TTL = 30 * 60 * 1000;
const MAX_PER_USER = 6;
const files = new Map(); // id → { userId, name, tabs, expires }

function sweep() {
  const now = Date.now();
  for (const [id, f] of files) if (f.expires < now) files.delete(id);
}

r.post('/imports/files', requireAdmin, express.raw({ type: () => true, limit: '15mb' }), async (req, res) => {
  sweep();
  const buf = req.body;
  // .xlsx files are zip archives, which start with "PK".
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw badRequest('Please choose an Excel workbook (.xlsx)');
  }
  const tabs = await readWorkbook(buf);
  const mine = [...files].filter(([, f]) => f.userId === req.user.id);
  for (const [id] of mine.slice(0, Math.max(0, mine.length - MAX_PER_USER + 1))) files.delete(id);
  const id = newToken(12);
  let name = String(req.get('x-file-name') || 'workbook.xlsx');
  try { name = decodeURIComponent(name); } catch { /* keep as sent */ }
  name = name.slice(0, 200);
  files.set(id, { userId: req.user.id, name, tabs, expires: Date.now() + TTL });
  res.status(201).json({ file_id: id, name, tabs: tabs.map((t) => ({ name: t.name, hidden: t.hidden, rows: t.rows.length })) });
});

function fileFor(req, id, label) {
  sweep();
  const f = id && files.get(String(id));
  if (!f || f.userId !== req.user.id) throw badRequest(`The ${label} file has expired. Please choose it again.`);
  return f;
}

function planFor(req) {
  const arrivals = fileFor(req, req.body.arrivals, 'arrivals');
  const liaisons = req.body.liaisons ? fileFor(req, req.body.liaisons, 'liaison') : null;
  return { plan: buildPlan(arrivals.tabs, liaisons?.tabs || null), arrivals, liaisons };
}

const legText = (l) => (l ? { date: l.date, time: l.time, flight: l.legs.join(' / ') || null, mode: l.mode, tanfeethi: l.atf } : null);

r.post('/imports/preview', requireAdmin, (req, res) => {
  const { plan, arrivals } = planFor(req);
  const liaisonName = new Map(plan.liaisons.map((l) => [l.key, l.name]));
  const leadName = new Map(plan.guests.map((g) => [g.key, g.name]));
  const existingHotels = new Set(all('SELECT name FROM hotels').map((h) => h.name.toLowerCase()));
  const existingUsers = all('SELECT name, phone FROM users');
  res.json({
    file_name: arrivals.name,
    suggested: plan.suggested,
    counts: {
      guests: plan.guests.length,
      companions: plan.guests.filter((g) => g.lead_key).length,
      flights: plan.flights.length,
      tanfeethi_flights: plan.flights.filter((f) => f.tanfeethi).length,
      hotels: plan.hotels.length,
      new_hotels: plan.hotels.filter((h) => !existingHotels.has(h.toLowerCase())).length,
      rooms: plan.guests.filter((g) => g.hotel).length,
      liaisons: plan.liaisons.length,
      new_liaisons: plan.liaisons.filter((l) => !findUser(existingUsers, l)).length,
      guests_with_liaison: plan.guests.filter((g) => g.liaison).length,
    },
    hotels: plan.hotels,
    liaisons: plan.liaisons.map(({ name, phone, guests }) => ({ name, phone, guests })),
    guests: plan.guests.map((g) => ({
      name: g.name, nationality: g.nationality, position: g.position, type: g.type, category: g.category,
      hotel: g.hotel, room_type: g.room_type, arrival: legText(g.arrival), departure: legText(g.departure),
      lead: g.lead_key ? leadName.get(g.lead_key) : null, relationship: g.relationship,
      liaison: g.liaison ? liaisonName.get(g.liaison) : null,
      backup_liaison: g.backup_liaison ? liaisonName.get(g.backup_liaison) : null,
      notes: g.notes,
    })),
    report: plan.report,
  });
});

function findUser(users, l) {
  const key = l.key;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}]/gu, '');
  return users.find((u) => norm(u.name) === key || (l.phone && u.phone && u.phone.replace(/[^\d]/g, '') === l.phone.replace(/[^\d]/g, '')));
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\d]+/gu, '.').replace(/^\.|\.$/g, '').replace(/[^\x20-\x7e]/g, '') || 'liaison';

r.post('/imports/create', requireAdmin, (req, res) => {
  const { plan, arrivals, liaisons } = planFor(req);
  const ev = req.body.event || {};
  if (!String(ev.name || '').trim()) throw badRequest('Event name is required');

  const here = String(ev.venue || '').trim() || null; // flights arrive at and leave from the event's location
  const result = tx(() => {
    const eventId = insert('events', { timezone: 'Asia/Riyadh', ...ev, name: String(ev.name).trim() }, EVENT_FIELDS);

    // Hotels are shared between events: reuse one with the same name.
    const hotelIds = new Map();
    for (const name of plan.hotels) {
      const found = get('SELECT id FROM hotels WHERE lower(name) = lower(?)', name);
      hotelIds.set(name, found ? found.id : insert('hotels', { name }, ['name']));
    }

    // Liaisons become staff accounts with the liaison role on this event. The
    // list has no emails, so each gets a placeholder address and a random
    // password: nobody can sign in as them until an admin sets real details.
    const users = all('SELECT id, name, phone FROM users');
    const userIds = new Map();
    let newUsers = 0;
    for (const l of plan.liaisons) {
      let uid = findUser(users, l)?.id;
      if (!uid) {
        let email = `${slug(l.name)}@liaisons.invalid`;
        for (let n = 2; get('SELECT 1 FROM users WHERE email = ?', email); n++) email = `${slug(l.name)}.${n}@liaisons.invalid`;
        uid = insert('users', { name: l.name, email, phone: l.phone, role: 'liaison', password_hash: hashPassword(newToken(24)) },
          ['name', 'email', 'phone', 'role', 'password_hash']);
        users.push({ id: uid, name: l.name, phone: l.phone });
        newUsers += 1;
      }
      run('INSERT OR IGNORE INTO event_members (event_id, user_id, role) VALUES (?,?,?)', eventId, uid, 'liaison');
      const u = get('SELECT role FROM users WHERE id = ?', uid);
      if (u.role === 'viewer') run("UPDATE users SET role = 'liaison' WHERE id = ?", uid);
      userIds.set(l.key, uid);
    }

    // Guests, leads first so companions can point at them.
    const guestIds = new Map();
    const ordered = [...plan.guests].sort((a, b) => Number(Boolean(a.lead_key)) - Number(Boolean(b.lead_key)));
    for (const g of ordered) {
      guestIds.set(g.key, insert('guests', {
        event_id: eventId, title: g.title, first_name: g.first_name, last_name: g.last_name,
        nationality: g.nationality, position: g.position, category: g.category,
        party_lead_id: g.lead_key ? guestIds.get(g.lead_key) ?? null : null, relationship: g.relationship,
        notes: g.notes.join('\n') || null, source: 'import', rsvp_status: 'attending',
        host_user_id: g.liaison ? userIds.get(g.liaison) : null,
        backup_host_user_id: g.backup_liaison ? userIds.get(g.backup_liaison) : null,
        invite_token: newToken(18), checkin_code: newCheckinCode(),
      }, ['event_id', 'title', 'first_name', 'last_name', 'nationality', 'position', 'category', 'party_lead_id',
        'relationship', 'notes', 'source', 'rsvp_status', 'host_user_id', 'backup_host_user_id', 'invite_token', 'checkin_code']));
    }

    for (const g of plan.guests) {
      if (!g.hotel) continue;
      const inDate = g.arrival?.date;
      const outDate = g.departure?.date;
      insert('accommodations', {
        guest_id: guestIds.get(g.key), hotel_id: hotelIds.get(g.hotel), room_type: g.room_type,
        check_in: inDate ? `${inDate}T${g.arrival.time || '14:00'}` : null,
        check_out: outDate ? `${outDate}T${g.departure.time || '12:00'}` : null,
        notes: g.room_note,
      }, ['guest_id', 'hotel_id', 'room_type', 'check_in', 'check_out', 'notes']);
    }

    for (const f of plan.flights) {
      const notes = [];
      if (!f.time) notes.push('Time to be confirmed');
      if (f.vias.length) notes.push(`Connections: ${f.vias.join('; ')}`);
      if (f.mode && f.mode !== 'Flight' && f.label !== f.mode) notes.push(f.mode);
      const fid = insert('flights', {
        event_id: eventId, direction: f.direction, service_type: f.tanfeethi ? 'tanfeethi' : 'general',
        airline: f.airline, flight_number: f.label,
        origin: f.direction === 'departure' ? here : null,
        destination: f.direction === 'arrival' ? here : (f.destinations.join(' / ') || null),
        terminal: f.tanfeethi ? 'Tanfeethi' : null,
        scheduled_at: `${f.date}T${f.time || '00:00'}`, notes: notes.join('\n') || null,
      }, ['event_id', 'direction', 'service_type', 'airline', 'flight_number', 'origin', 'destination', 'terminal', 'scheduled_at', 'notes']);
      for (const k of f.guests) run('INSERT OR IGNORE INTO flight_passengers (flight_id, guest_id) VALUES (?,?)', fid, guestIds.get(k));
    }

    return { eventId, guests: guestIds.size, flights: plan.flights.length, hotels: hotelIds.size, liaisons: userIds.size, newUsers };
  });

  files.delete(String(req.body.arrivals));
  if (req.body.liaisons) files.delete(String(req.body.liaisons));
  logActivity({
    eventId: result.eventId, action: 'event.imported', req,
    details: `${arrivals.name}${liaisons ? ` + ${liaisons.name}` : ''}: ${result.guests} guests, ${result.flights} flights, ${result.liaisons} liaisons`,
  });
  res.status(201).json({ event_id: result.eventId, ...result });
});

export default r;
