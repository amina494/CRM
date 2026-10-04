// Accommodation, seating, flights, fleet (vehicles & drivers) and transfers.
import { Router } from 'express';
import { all, get, insert, update, run, tx, logActivity } from '../db.js';
import { newToken } from '../auth.js';
import { config } from '../config.js';
import { applyFlightStatus, setTransferStatus, badRequest, notFound } from '../services/tracking.js';

const r = Router();

/** Simple CRUD for tables that need no special behaviour. */
function crud(path, table, fields, { orderBy = 'id', required = [], extraCreate = () => ({}) } = {}) {
  r.get(`/${path}`, (req, res) => res.json(all(`SELECT * FROM ${table} ORDER BY ${orderBy}`)));
  r.post(`/${path}`, (req, res) => {
    for (const f of required) if (!req.body[f]) throw badRequest(`${f.replace(/_/g, ' ')} is required`);
    const extra = extraCreate();
    res.status(201).json({ id: insert(table, { ...req.body, ...extra }, [...fields, ...Object.keys(extra)]) });
  });
  r.put(`/${path}/:id`, (req, res) => {
    update(table, req.params.id, req.body, fields);
    res.json({ ok: true });
  });
  r.delete(`/${path}/:id`, (req, res) => {
    run(`DELETE FROM ${table} WHERE id = ?`, req.params.id);
    res.json({ ok: true });
  });
}

// --- Hotels & accommodation -------------------------------------------
crud('hotels', 'hotels', ['name', 'address', 'phone', 'contact_person', 'contact_phone', 'notes'],
  { orderBy: 'name', required: ['name'] });

const ACCOM_FIELDS = ['guest_id', 'hotel_id', 'room_number', 'room_type', 'check_in', 'check_out', 'confirmation_no', 'status', 'notes'];

r.get('/events/:eventId/accommodations', (req, res) => {
  res.json(all(`SELECT a.*, h.name AS hotel_name, g.title, g.first_name, g.last_name, g.category, g.current_status,
      g.party_lead_id, u.name AS host_name
    FROM accommodations a JOIN hotels h ON h.id = a.hotel_id JOIN guests g ON g.id = a.guest_id
    LEFT JOIN users u ON u.id = g.host_user_id
    WHERE g.event_id = ? ORDER BY h.name, a.room_number, g.first_name`, req.params.eventId));
});

r.post('/accommodations', (req, res) => {
  if (!req.body.guest_id || !req.body.hotel_id) throw badRequest('Guest and hotel are required');
  const id = insert('accommodations', req.body, ACCOM_FIELDS);
  const g = get('SELECT event_id FROM guests WHERE id = ?', req.body.guest_id);
  logActivity({ eventId: g?.event_id, guestId: req.body.guest_id, actor: req.user.name, action: 'accommodation.assigned' });
  res.status(201).json({ id });
});
r.put('/accommodations/:id', (req, res) => {
  update('accommodations', req.params.id, req.body, ACCOM_FIELDS);
  res.json({ ok: true });
});
r.delete('/accommodations/:id', (req, res) => {
  run('DELETE FROM accommodations WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// --- Seating ----------------------------------------------------------
const TABLE_FIELDS = ['name', 'zone', 'capacity', 'notes'];

r.get('/events/:eventId/tables', (req, res) => {
  const tables = all('SELECT * FROM seating_tables WHERE event_id = ? ORDER BY id', req.params.eventId);
  const seated = all(`SELECT id, title, first_name, last_name, category, rsvp_status, table_id, seat_number, party_lead_id
    FROM guests WHERE event_id = ? AND table_id IS NOT NULL ORDER BY CAST(seat_number AS INTEGER), seat_number`, req.params.eventId);
  res.json(tables.map((t) => ({ ...t, guests: seated.filter((g) => g.table_id === t.id) })));
});
r.post('/events/:eventId/tables', (req, res) => {
  if (!req.body.name) throw badRequest('Table name is required');
  res.status(201).json({ id: insert('seating_tables', { ...req.body, event_id: Number(req.params.eventId) }, [...TABLE_FIELDS, 'event_id']) });
});
r.put('/tables/:id', (req, res) => {
  update('seating_tables', req.params.id, req.body, TABLE_FIELDS);
  res.json({ ok: true });
});
r.delete('/tables/:id', (req, res) => {
  run('DELETE FROM seating_tables WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// --- Flights ----------------------------------------------------------
const FLIGHT_FIELDS = ['direction', 'service_type', 'airline', 'flight_number', 'tail_number', 'origin', 'destination',
  'terminal', 'scheduled_at', 'estimated_at', 'status', 'extra_passengers', 'notes'];

const flightPassengers = (flightId) => all(`SELECT g.id, g.title, g.first_name, g.last_name, g.category, g.current_status,
    g.party_lead_id, fp.seat FROM flight_passengers fp JOIN guests g ON g.id = fp.guest_id WHERE fp.flight_id = ?
    ORDER BY g.party_lead_id IS NOT NULL, g.first_name`, flightId);

r.get('/events/:eventId/flights', (req, res) => {
  const flights = all(`SELECT * FROM flights WHERE event_id = ? ORDER BY COALESCE(estimated_at, scheduled_at)`, req.params.eventId);
  res.json(flights.map((f) => ({ ...f, passengers: flightPassengers(f.id) })));
});

function setPassengers(table, key, id, guestIds) {
  if (!Array.isArray(guestIds)) return;
  run(`DELETE FROM ${table} WHERE ${key} = ?`, id);
  for (const g of new Set(guestIds.map(Number))) run(`INSERT INTO ${table} (${key}, guest_id) VALUES (?, ?)`, id, g);
}

r.post('/events/:eventId/flights', (req, res) => {
  const id = tx(() => {
    const fid = insert('flights', { ...req.body, event_id: Number(req.params.eventId) }, [...FLIGHT_FIELDS, 'event_id']);
    setPassengers('flight_passengers', 'flight_id', fid, req.body.passenger_ids);
    return fid;
  });
  res.status(201).json({ id });
});

r.put('/flights/:id', (req, res) => {
  const before = get('SELECT * FROM flights WHERE id = ?', req.params.id);
  if (!before) throw notFound('Flight not found');
  tx(() => {
    update('flights', before.id, req.body, FLIGHT_FIELDS);
    setPassengers('flight_passengers', 'flight_id', before.id, req.body.passenger_ids);
    applyFlightStatus(get('SELECT * FROM flights WHERE id = ?', before.id), before.status, req.user.name);
  });
  res.json({ ok: true });
});

r.delete('/flights/:id', (req, res) => {
  run('DELETE FROM flights WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// --- Fleet ------------------------------------------------------------
crud('vehicles', 'vehicles', ['plate', 'make', 'model', 'color', 'type', 'capacity', 'status', 'notes'],
  { orderBy: 'plate', required: ['plate'] });

const DRIVER_FIELDS = ['name', 'phone', 'license_no', 'languages', 'status', 'notes'];
r.get('/drivers', (req, res) => {
  res.json(all(`SELECT d.*,
      (SELECT COUNT(*) FROM guests g WHERE g.driver_id = d.id) AS dedicated_guests
    FROM drivers d ORDER BY d.name`).map((d) => ({ ...d, portal_url: `${config.publicUrl}/d/${d.access_token}` })));
});
r.post('/drivers', (req, res) => {
  if (!req.body.name) throw badRequest('Driver name is required');
  res.status(201).json({ id: insert('drivers', { ...req.body, access_token: newToken(18) }, [...DRIVER_FIELDS, 'access_token']) });
});
r.put('/drivers/:id', (req, res) => {
  update('drivers', req.params.id, req.body, DRIVER_FIELDS);
  res.json({ ok: true });
});
r.post('/drivers/:id/rotate-link', (req, res) => {
  run('UPDATE drivers SET access_token = ? WHERE id = ?', newToken(18), req.params.id);
  res.json({ ok: true });
});
r.delete('/drivers/:id', (req, res) => {
  run('DELETE FROM drivers WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// --- Transfers / movements --------------------------------------------
const TRANSFER_FIELDS = ['kind', 'pickup', 'dropoff', 'scheduled_at', 'vehicle_id', 'driver_id', 'flight_id', 'notes'];

export const TRANSFER_LIST_SQL = `SELECT t.*, d.name AS driver_name, d.phone AS driver_phone,
    d.last_lat AS driver_lat, d.last_lng AS driver_lng, d.last_seen_at AS driver_seen_at,
    v.plate AS vehicle_plate, TRIM(COALESCE(v.make,'') || ' ' || COALESCE(v.model,'')) AS vehicle_label,
    f.airline AS flight_airline, COALESCE(f.flight_number, f.tail_number) AS flight_number,
    f.service_type AS flight_service, f.status AS flight_status, COALESCE(f.estimated_at, f.scheduled_at) AS flight_time
  FROM transfers t LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN flights f ON f.id = t.flight_id`;

export const transferPassengers = (id) => all(`SELECT g.id, g.title, g.first_name, g.last_name, g.category, g.phone,
    g.current_status FROM transfer_passengers tp JOIN guests g ON g.id = tp.guest_id WHERE tp.transfer_id = ?
    ORDER BY g.party_lead_id IS NOT NULL, g.first_name`, id);

r.get('/events/:eventId/transfers', (req, res) => {
  const where = ['t.event_id = ?'];
  const params = [req.params.eventId];
  if (req.query.date) { where.push('substr(t.scheduled_at, 1, 10) = ?'); params.push(req.query.date); }
  if (req.query.driver_id) { where.push('t.driver_id = ?'); params.push(req.query.driver_id); }
  const rows = all(`${TRANSFER_LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY t.scheduled_at`, ...params);
  res.json(rows.map((t) => ({ ...t, passengers: transferPassengers(t.id) })));
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

r.post('/events/:eventId/transfers', (req, res) => {
  const eventId = Number(req.params.eventId);
  const id = tx(() => {
    const tid = insert('transfers', { ...req.body, event_id: eventId }, [...TRANSFER_FIELDS, 'event_id']);
    setPassengers('transfer_passengers', 'transfer_id', tid, req.body.passenger_ids);
    return tid;
  });
  res.status(201).json({ id, conflicts: conflicts(eventId, req.body, id) });
});

r.put('/transfers/:id', (req, res) => {
  const t = get('SELECT * FROM transfers WHERE id = ?', req.params.id);
  if (!t) throw notFound('Transfer not found');
  tx(() => {
    update('transfers', t.id, req.body, TRANSFER_FIELDS);
    setPassengers('transfer_passengers', 'transfer_id', t.id, req.body.passenger_ids);
  });
  res.json({ ok: true, conflicts: conflicts(t.event_id, { ...t, ...req.body }, t.id) });
});

r.post('/transfers/:id/status', (req, res) => {
  res.json(setTransferStatus(Number(req.params.id), req.body.status, req.user.name));
});

r.delete('/transfers/:id', (req, res) => {
  run('DELETE FROM transfers WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

export default r;
