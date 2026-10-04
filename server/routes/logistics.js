// Accommodation, seating, flights, fleet (vehicles & drivers) and transfers.
//
// Hotels, cars and drivers are shared by all events: anyone signed in can
// read them (for the pick lists), and admins or coordinators of any event can
// change them. Everything else belongs to one event; routes that only carry a
// record id look the event up through that record before checking access.
import { Router } from 'express';
import { all, get, insert, update, run, tx, nowIso, logActivity } from '../db.js';
import { newToken } from '../auth.js';
import { config } from '../config.js';
import {
  assertEvent, eventAccess, forbidden, guestIdsInEvent, isCoordinatorAnywhere, isOwnGuest, notFound, ownGuestClause,
} from '../access.js';
import { driverLinkExpiresAt } from '../services/driverLink.js';
import { applyFlightStatus, setTransferStatus, badRequest } from '../services/tracking.js';

const r = Router();

function requireFleetManager(req, res, next) {
  if (!isCoordinatorAnywhere(req.user)) throw forbidden('Only admins and coordinators can change hotels, cars and drivers');
  next();
}

/** Records shared by all events (hotels, vehicles). */
function sharedCrud(path, table, fields, { orderBy = 'id', required = [] } = {}) {
  r.get(`/${path}`, (req, res) => res.json(all(`SELECT * FROM ${table} ORDER BY ${orderBy}`)));
  r.post(`/${path}`, requireFleetManager, (req, res) => {
    for (const f of required) if (!req.body[f]) throw badRequest(`${f.replace(/_/g, ' ')} is required`);
    res.status(201).json({ id: insert(table, req.body, fields) });
  });
  r.put(`/${path}/:id`, requireFleetManager, (req, res) => {
    update(table, req.params.id, req.body, fields);
    res.json({ ok: true });
  });
  r.delete(`/${path}/:id`, requireFleetManager, (req, res) => {
    run(`DELETE FROM ${table} WHERE id = ?`, req.params.id);
    res.json({ ok: true });
  });
}

/** Loads a record, then checks the caller's role on the event it belongs to. */
function loadInEvent(user, sql, id, min, what) {
  const row = get(sql, id);
  if (!row) throw notFound(`${what} not found`);
  const role = assertEvent(user, row.event_id, min);
  return { row, role };
}

const ownSql = (userId) => ownGuestClause(userId).sql;

// --- Hotels & accommodation -------------------------------------------
sharedCrud('hotels', 'hotels', ['name', 'address', 'phone', 'contact_person', 'contact_phone', 'notes'],
  { orderBy: 'name', required: ['name'] });

const ACCOM_FIELDS = ['hotel_id', 'room_number', 'room_type', 'check_in', 'check_out', 'confirmation_no', 'status', 'notes'];
const ACCOM_SQL = 'SELECT a.*, g.event_id FROM accommodations a JOIN guests g ON g.id = a.guest_id WHERE a.id = ?';

r.get('/events/:eventId/accommodations', eventAccess('viewer'), (req, res) => {
  const own = req.eventRole === 'liaison' ? `AND ${ownSql(req.user.id)}` : '';
  res.json(all(`SELECT a.*, h.name AS hotel_name, g.title, g.first_name, g.last_name, g.category, g.current_status,
      g.party_lead_id, u.name AS host_name
    FROM accommodations a JOIN hotels h ON h.id = a.hotel_id JOIN guests g ON g.id = a.guest_id
    LEFT JOIN users u ON u.id = g.host_user_id
    WHERE g.event_id = ? ${own} ORDER BY h.name, a.room_number, g.first_name`, req.params.eventId));
});

r.post('/accommodations', (req, res) => {
  if (!req.body.guest_id || !req.body.hotel_id) throw badRequest('Guest and hotel are required');
  const g = get('SELECT id, event_id FROM guests WHERE id = ?', req.body.guest_id);
  if (!g) throw notFound('Guest not found');
  assertEvent(req.user, g.event_id, 'coordinator');
  const id = insert('accommodations', { ...req.body, guest_id: g.id }, [...ACCOM_FIELDS, 'guest_id']);
  logActivity({ eventId: g.event_id, guestId: g.id, action: 'accommodation.assigned', req });
  res.status(201).json({ id });
});
r.put('/accommodations/:id', (req, res) => {
  const { row } = loadInEvent(req.user, ACCOM_SQL, req.params.id, 'coordinator', 'Booking');
  update('accommodations', row.id, req.body, ACCOM_FIELDS); // guest_id cannot be moved to another guest
  res.json({ ok: true });
});
r.delete('/accommodations/:id', (req, res) => {
  const { row } = loadInEvent(req.user, ACCOM_SQL, req.params.id, 'coordinator', 'Booking');
  run('DELETE FROM accommodations WHERE id = ?', row.id);
  res.json({ ok: true });
});

// --- Seating (coordinators; viewers read-only; not liaisons) ------------
const TABLE_FIELDS = ['name', 'zone', 'capacity', 'notes'];
const TABLE_SQL = 'SELECT * FROM seating_tables WHERE id = ?';

r.get('/events/:eventId/tables', eventAccess('viewer'), (req, res) => {
  if (req.eventRole === 'liaison') throw forbidden('The seating plan is for coordinators');
  const tables = all('SELECT * FROM seating_tables WHERE event_id = ? ORDER BY id', req.params.eventId);
  const seated = all(`SELECT id, title, first_name, last_name, category, rsvp_status, table_id, seat_number, party_lead_id
    FROM guests WHERE event_id = ? AND table_id IS NOT NULL ORDER BY CAST(seat_number AS INTEGER), seat_number`, req.params.eventId);
  res.json(tables.map((t) => ({ ...t, guests: seated.filter((g) => g.table_id === t.id) })));
});
r.post('/events/:eventId/tables', eventAccess('coordinator'), (req, res) => {
  if (!req.body.name) throw badRequest('Table name is required');
  res.status(201).json({ id: insert('seating_tables', { ...req.body, event_id: Number(req.params.eventId) }, [...TABLE_FIELDS, 'event_id']) });
});
r.put('/tables/:id', (req, res) => {
  const { row } = loadInEvent(req.user, TABLE_SQL, req.params.id, 'coordinator', 'Table');
  update('seating_tables', row.id, req.body, TABLE_FIELDS);
  res.json({ ok: true });
});
r.delete('/tables/:id', (req, res) => {
  const { row } = loadInEvent(req.user, TABLE_SQL, req.params.id, 'coordinator', 'Table');
  run('DELETE FROM seating_tables WHERE id = ?', row.id);
  res.json({ ok: true });
});

// --- Flights ----------------------------------------------------------
const FLIGHT_FIELDS = ['direction', 'service_type', 'airline', 'flight_number', 'tail_number', 'origin', 'destination',
  'terminal', 'scheduled_at', 'estimated_at', 'status', 'extra_passengers', 'notes'];
const FLIGHT_SQL = 'SELECT * FROM flights WHERE id = ?';

const flightPassengers = (flightId) => all(`SELECT g.id, g.title, g.first_name, g.last_name, g.category, g.current_status,
    g.party_lead_id, fp.seat FROM flight_passengers fp JOIN guests g ON g.id = fp.guest_id WHERE fp.flight_id = ?
    ORDER BY g.party_lead_id IS NOT NULL, g.first_name`, flightId);

r.get('/events/:eventId/flights', eventAccess('viewer'), (req, res) => {
  const own = req.eventRole === 'liaison'
    ? `AND EXISTS (SELECT 1 FROM flight_passengers fp JOIN guests g ON g.id = fp.guest_id WHERE fp.flight_id = f.id AND ${ownSql(req.user.id)})`
    : '';
  const flights = all(`SELECT f.* FROM flights f WHERE f.event_id = ? ${own}
    ORDER BY COALESCE(f.estimated_at, f.scheduled_at)`, req.params.eventId);
  res.json(flights.map((f) => ({ ...f, passengers: flightPassengers(f.id) })));
});

function setPassengers(table, key, id, guestIds) {
  if (!Array.isArray(guestIds)) return;
  run(`DELETE FROM ${table} WHERE ${key} = ?`, id);
  for (const g of guestIds) run(`INSERT INTO ${table} (${key}, guest_id) VALUES (?, ?)`, id, g);
}

r.post('/events/:eventId/flights', eventAccess('coordinator'), (req, res) => {
  const eventId = Number(req.params.eventId);
  const passengers = guestIdsInEvent(eventId, req.body.passenger_ids);
  const id = tx(() => {
    const fid = insert('flights', { ...req.body, event_id: eventId }, [...FLIGHT_FIELDS, 'event_id']);
    setPassengers('flight_passengers', 'flight_id', fid, passengers);
    return fid;
  });
  res.status(201).json({ id });
});

r.put('/flights/:id', (req, res) => {
  const { row: before } = loadInEvent(req.user, FLIGHT_SQL, req.params.id, 'coordinator', 'Flight');
  const passengers = guestIdsInEvent(before.event_id, req.body.passenger_ids);
  tx(() => {
    update('flights', before.id, req.body, FLIGHT_FIELDS);
    setPassengers('flight_passengers', 'flight_id', before.id, passengers);
    applyFlightStatus(get(FLIGHT_SQL, before.id), before.status, req.user.name);
  });
  res.json({ ok: true });
});

r.delete('/flights/:id', (req, res) => {
  const { row } = loadInEvent(req.user, FLIGHT_SQL, req.params.id, 'coordinator', 'Flight');
  run('DELETE FROM flights WHERE id = ?', row.id);
  res.json({ ok: true });
});

// --- Fleet ------------------------------------------------------------
sharedCrud('vehicles', 'vehicles', ['plate', 'make', 'model', 'color', 'type', 'capacity', 'status', 'notes'],
  { orderBy: 'plate', required: ['plate'] });

const DRIVER_FIELDS = ['name', 'phone', 'license_no', 'languages', 'status', 'notes'];

// Driver links are only shown to people who manage the fleet.
r.get('/drivers', (req, res) => {
  const manager = isCoordinatorAnywhere(req.user);
  res.json(all(`SELECT d.*, (SELECT COUNT(*) FROM guests g WHERE g.driver_id = d.id) AS dedicated_guests
    FROM drivers d ORDER BY d.name`).map(({ access_token: token, ...d }) => ({
    ...d,
    ...(manager && { portal_url: `${config.publicUrl}/d/${token}`, link_expires_at: driverLinkExpiresAt(d).toISOString() }),
  })));
});
r.post('/drivers', requireFleetManager, (req, res) => {
  if (!req.body.name) throw badRequest('Driver name is required');
  res.status(201).json({ id: insert('drivers', { ...req.body, access_token: newToken(18), token_issued_at: nowIso() },
    [...DRIVER_FIELDS, 'access_token', 'token_issued_at']) });
});
r.put('/drivers/:id', requireFleetManager, (req, res) => {
  update('drivers', req.params.id, req.body, DRIVER_FIELDS);
  res.json({ ok: true });
});
r.post('/drivers/:id/rotate-link', requireFleetManager, (req, res) => {
  run('UPDATE drivers SET access_token = ?, token_issued_at = ? WHERE id = ?', newToken(18), nowIso(), req.params.id);
  logActivity({ action: 'driver.link_reset', details: `driver #${req.params.id}`, req });
  res.json({ ok: true });
});
r.delete('/drivers/:id', requireFleetManager, (req, res) => {
  run('DELETE FROM drivers WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// --- Transfers / movements --------------------------------------------
const TRANSFER_FIELDS = ['kind', 'pickup', 'dropoff', 'scheduled_at', 'vehicle_id', 'driver_id', 'flight_id', 'notes'];
const TRANSFER_SQL = 'SELECT * FROM transfers WHERE id = ?';

export const TRANSFER_LIST_SQL = `SELECT t.*, d.name AS driver_name, d.phone AS driver_phone,
    d.last_lat AS driver_lat, d.last_lng AS driver_lng, d.last_seen_at AS driver_seen_at,
    v.plate AS vehicle_plate, TRIM(COALESCE(v.make,'') || ' ' || COALESCE(v.model,'')) AS vehicle_label,
    f.airline AS flight_airline, COALESCE(f.flight_number, f.tail_number) AS flight_number,
    f.service_type AS flight_service, f.status AS flight_status, COALESCE(f.estimated_at, f.scheduled_at) AS flight_time
  FROM transfers t LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN flights f ON f.id = t.flight_id`;

export const transferPassengers = (id) => all(`SELECT g.id, g.title, g.first_name, g.last_name, g.category, g.phone,
    g.current_status, g.host_user_id, g.backup_host_user_id, g.party_lead_id
  FROM transfer_passengers tp JOIN guests g ON g.id = tp.guest_id WHERE tp.transfer_id = ?
  ORDER BY g.party_lead_id IS NOT NULL, g.first_name`, id);

/** Passenger list for staff: liaisons only see phone numbers of their own guests. */
function passengersFor(user, role, transferId) {
  return transferPassengers(transferId).map(({ host_user_id: h, backup_host_user_id: b, ...p }) => {
    if (role === 'liaison' && !isOwnGuest(user, { ...p, host_user_id: h, backup_host_user_id: b })) return { ...p, phone: null };
    return p;
  });
}

r.get('/events/:eventId/transfers', eventAccess('viewer'), (req, res) => {
  const where = ['t.event_id = ?'];
  const params = [req.params.eventId];
  if (req.query.date) { where.push('substr(t.scheduled_at, 1, 10) = ?'); params.push(req.query.date); }
  if (req.query.driver_id) { where.push('t.driver_id = ?'); params.push(req.query.driver_id); }
  if (req.eventRole === 'liaison') {
    where.push(`EXISTS (SELECT 1 FROM transfer_passengers tp JOIN guests g ON g.id = tp.guest_id WHERE tp.transfer_id = t.id AND ${ownSql(req.user.id)})`);
  }
  const rows = all(`${TRANSFER_LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY t.scheduled_at`, ...params);
  res.json(rows.map((t) => ({ ...t, passengers: passengersFor(req.user, req.eventRole, t.id) })));
});

/** Warns when the same driver or vehicle is booked within 60 minutes of another transfer. */
function conflicts(eventId, body, excludeId = 0) {
  if (!body.scheduled_at || (!body.driver_id && !body.vehicle_id)) return [];
  return all(`SELECT id, scheduled_at, pickup, dropoff, driver_id, vehicle_id FROM transfers
    WHERE event_id = ? AND id != ? AND status NOT IN ('completed','cancelled')
      AND ((driver_id IS NOT NULL AND driver_id = ?) OR (vehicle_id IS NOT NULL AND vehicle_id = ?))
      AND ABS(julianday(scheduled_at) - julianday(?)) * 24 * 60 < 60`,
  eventId, excludeId, body.driver_id || null, body.vehicle_id || null, body.scheduled_at);
}

function assertFlightInEvent(eventId, flightId) {
  if (flightId && !get('SELECT 1 FROM flights WHERE id = ? AND event_id = ?', flightId, eventId)) {
    throw badRequest('That flight belongs to another event');
  }
}

r.post('/events/:eventId/transfers', eventAccess('coordinator'), (req, res) => {
  const eventId = Number(req.params.eventId);
  assertFlightInEvent(eventId, req.body.flight_id);
  const passengers = guestIdsInEvent(eventId, req.body.passenger_ids);
  const id = tx(() => {
    const tid = insert('transfers', { ...req.body, event_id: eventId }, [...TRANSFER_FIELDS, 'event_id']);
    setPassengers('transfer_passengers', 'transfer_id', tid, passengers);
    return tid;
  });
  res.status(201).json({ id, conflicts: conflicts(eventId, req.body, id) });
});

r.put('/transfers/:id', (req, res) => {
  const { row: t } = loadInEvent(req.user, TRANSFER_SQL, req.params.id, 'coordinator', 'Trip');
  assertFlightInEvent(t.event_id, req.body.flight_id);
  const passengers = guestIdsInEvent(t.event_id, req.body.passenger_ids);
  tx(() => {
    update('transfers', t.id, req.body, TRANSFER_FIELDS);
    setPassengers('transfer_passengers', 'transfer_id', t.id, passengers);
  });
  res.json({ ok: true, conflicts: conflicts(t.event_id, { ...t, ...req.body }, t.id) });
});

// Coordinators can move any trip along; a liaison can for trips carrying one of their guests.
r.post('/transfers/:id/status', (req, res) => {
  const { row: t, role } = loadInEvent(req.user, TRANSFER_SQL, req.params.id, 'liaison', 'Trip');
  if (role === 'liaison') {
    const carriesOwn = get(`SELECT 1 FROM transfer_passengers tp JOIN guests g ON g.id = tp.guest_id
      WHERE tp.transfer_id = ? AND ${ownSql(req.user.id)}`, t.id);
    if (!carriesOwn) throw notFound('Trip not found');
  }
  res.json(setTransferStatus(t.id, req.body.status, req.user.name));
});

r.delete('/transfers/:id', (req, res) => {
  const { row } = loadInEvent(req.user, TRANSFER_SQL, req.params.id, 'coordinator', 'Trip');
  run('DELETE FROM transfers WHERE id = ?', row.id);
  res.json({ ok: true });
});

export default r;
