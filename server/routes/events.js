import express, { Router } from 'express';
import { all, get, insert, update, run, tx, logActivity } from '../db.js';
import { newToken } from '../auth.js';
import { requireAdmin } from '../auth.js';
import { accessibleEventIds, assertEvent, eventRole, forbidden } from '../access.js';
import { todayIn } from '../services/format.js';
import { retentionSummary, anonymiseEvent } from '../services/retention.js';
import { maskLinks } from './guests.js';
import {
  ARABIC_FONTS, DEFAULT_DESIGN, HEADING_FONTS, cleanDesign, imageType, resolveDesign, staffTheme,
} from '../services/design.js';
import { badRequest, notFound } from '../services/tracking.js';

const r = Router();

export const EVENT_FIELDS = [
  'name', 'name_ar', 'description', 'description_ar', 'venue', 'venue_ar', 'venue_address', 'venue_lat', 'venue_lng',
  'starts_at', 'ends_at', 'timezone', 'dress_code', 'dress_code_ar', 'rsvp_deadline', 'host_name', 'host_name_ar',
];

/** Dashboard, activity and outbox: everyone on the event except liaisons. */
function assertOverview(user, eventId) {
  const role = assertEvent(user, eventId);
  if (role === 'liaison') throw forbidden('This overview is for coordinators');
  return role;
}

// Only the events this person works on, with their role on each.
r.get('/events', (req, res) => {
  const ids = accessibleEventIds(req.user);
  if (ids && !ids.length) return res.json([]);
  const rows = all(`SELECT e.*, (SELECT COUNT(*) FROM guests g WHERE g.event_id = e.id) AS guest_count
    FROM events e ${ids ? `WHERE e.id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY e.starts_at DESC`, ...(ids || []));
  res.json(rows.map(({ design, ...e }) => ({ ...e, my_role: eventRole(req.user, e.id), theme: staffTheme({ ...e, design }) })));
});

r.post('/events', requireAdmin, (req, res) => {
  if (!req.body.name) throw badRequest('Event name is required');
  const id = insert('events', req.body, [...EVENT_FIELDS, 'retention_days']);
  logActivity({ eventId: id, action: 'event.created', details: req.body.name, req });
  res.status(201).json({ id });
});

r.get('/events/:id', (req, res) => {
  const role = assertEvent(req.user, req.params.id);
  const e = get('SELECT * FROM events WHERE id = ?', req.params.id);
  if (!e) throw notFound('Event not found');
  res.json({ ...e, my_role: role });
});

r.put('/events/:id', (req, res) => {
  const role = assertEvent(req.user, req.params.id, 'coordinator');
  // How long guest data is kept is a policy decision, so only admins change it.
  const fields = role === 'admin' ? [...EVENT_FIELDS, 'retention_days'] : EVENT_FIELDS;
  if (role === 'admin' && req.body.retention_days != null && !(Number(req.body.retention_days) >= 0)) {
    throw badRequest('Retention must be zero or more days');
  }
  update('events', req.params.id, req.body, fields);
  res.json({ ok: true });
});

r.delete('/events/:id', requireAdmin, (req, res) => {
  const e = get('SELECT name FROM events WHERE id = ?', req.params.id);
  if (!e) throw notFound('Event not found');
  run('DELETE FROM events WHERE id = ?', req.params.id);
  logActivity({ action: 'event.deleted', details: e.name, req });
  res.json({ ok: true });
});

// --- Invitation design (coordinators of the event, and admins) ---------
r.get('/events/:id/design', (req, res) => {
  assertEvent(req.user, req.params.id, 'coordinator');
  const e = get('SELECT * FROM events WHERE id = ?', req.params.id);
  res.json({ design: resolveDesign(e), defaults: DEFAULT_DESIGN, fonts: { heading: Object.keys(HEADING_FONTS), arabic: Object.keys(ARABIC_FONTS) } });
});

r.put('/events/:id/design', (req, res) => {
  assertEvent(req.user, req.params.id, 'coordinator');
  const e = get('SELECT * FROM events WHERE id = ?', req.params.id);
  if (req.body.reset) {
    tx(() => {
      run('UPDATE events SET design = NULL WHERE id = ?', e.id);
      run('DELETE FROM event_assets WHERE event_id = ?', e.id);
    });
    logActivity({ eventId: e.id, action: 'event.design_reset', req });
    return res.json({ design: resolveDesign({ ...e, design: null }) });
  }
  let saved = {};
  try { saved = e.design ? JSON.parse(e.design) : {}; } catch { saved = {}; }
  const next = { ...saved, ...cleanDesign(req.body) };
  run('UPDATE events SET design = ? WHERE id = ?', JSON.stringify(next), e.id);
  logActivity({ eventId: e.id, action: 'event.design_updated', req });
  res.json({ design: resolveDesign({ ...e, design: JSON.stringify(next) }) });
});

// The image arrives as the raw request body (PNG, JPEG or WebP, up to 5 MB).
const rawImage = express.raw({ type: () => true, limit: '5mb' });
r.put('/events/:id/design/image/:kind', rawImage, (req, res) => {
  assertEvent(req.user, req.params.id, 'coordinator');
  const { kind } = req.params;
  if (!['cover', 'logo'].includes(kind)) throw badRequest('Unknown image');
  const mime = imageType(req.body);
  if (!mime) throw badRequest('Please upload a PNG, JPEG or WebP image');
  const id = newToken(18);
  tx(() => {
    run('DELETE FROM event_assets WHERE event_id = ? AND kind = ?', req.params.id, kind);
    run('INSERT INTO event_assets (id, event_id, kind, mime, data) VALUES (?,?,?,?,?)', id, req.params.id, kind, mime, req.body);
  });
  logActivity({ eventId: Number(req.params.id), action: `event.design_${kind}_uploaded`, details: `${Math.round(req.body.length / 1024)} KB`, req });
  const e = get('SELECT * FROM events WHERE id = ?', req.params.id);
  res.json({ design: resolveDesign(e) });
});

r.delete('/events/:id/design/image/:kind', (req, res) => {
  assertEvent(req.user, req.params.id, 'coordinator');
  run('DELETE FROM event_assets WHERE event_id = ? AND kind = ?', req.params.id, req.params.kind);
  const e = get('SELECT * FROM events WHERE id = ?', req.params.id);
  res.json({ design: resolveDesign(e) });
});

// --- Retention ---------------------------------------------------------
r.get('/events/:id/retention', (req, res) => {
  assertEvent(req.user, req.params.id, 'coordinator');
  const e = get('SELECT * FROM events WHERE id = ?', req.params.id);
  res.json(retentionSummary(e));
});

r.post('/events/:id/anonymise', requireAdmin, (req, res) => {
  const e = get('SELECT * FROM events WHERE id = ?', req.params.id);
  if (!e) throw notFound('Event not found');
  const summary = retentionSummary(e);
  if (e.anonymised_at) throw badRequest('This event has already been anonymised');
  if (!summary.is_due) throw badRequest(`Guest data for this event is kept until ${summary.due_at ? new Date(summary.due_at).toDateString() : 'the event has a date'}`);
  if (String(req.body.confirm || '').trim() !== e.name.trim()) throw badRequest('Type the event name exactly to confirm');
  const n = anonymiseEvent(e);
  logActivity({ eventId: e.id, action: 'event.anonymised', details: `${n} guests`, req });
  res.json({ ok: true, guests: n });
});

r.get('/events/:id/dashboard', (req, res) => {
  const id = req.params.id;
  assertOverview(req.user, id);
  const event = get('SELECT * FROM events WHERE id = ?', id);
  const today = todayIn(event.timezone);
  const count = (rows, key) => Object.fromEntries(rows.map((x) => [x[key], x.n]));

  const rsvp = count(all('SELECT rsvp_status, COUNT(*) n FROM guests WHERE event_id = ? GROUP BY rsvp_status', id), 'rsvp_status');
  const invites = count(all('SELECT invite_status, COUNT(*) n FROM guests WHERE event_id = ? GROUP BY invite_status', id), 'invite_status');
  const status = count(all('SELECT current_status, COUNT(*) n FROM guests WHERE event_id = ? GROUP BY current_status', id), 'current_status');
  const category = count(all('SELECT category, COUNT(*) n FROM guests WHERE event_id = ? GROUP BY category', id), 'category');
  const totals = get(`SELECT COUNT(*) AS guests,
      SUM(CASE WHEN rsvp_status = 'attending' THEN COALESCE(rsvp_party_size, 1) ELSE 0 END) AS expected_headcount,
      SUM(checked_in_at IS NOT NULL) AS checked_in,
      SUM(host_user_id IS NULL AND rsvp_status != 'declined') AS without_host,
      SUM(table_id IS NULL AND rsvp_status = 'attending') AS attending_unseated
    FROM guests WHERE event_id = ?`, id);
  const unhoused = get(`SELECT COUNT(*) n FROM guests g WHERE g.event_id = ? AND g.rsvp_status = 'attending'
      AND NOT EXISTS (SELECT 1 FROM accommodations a WHERE a.guest_id = g.id AND a.status != 'cancelled')`, id).n;

  const flightsToday = all(`SELECT f.*, (SELECT COUNT(*) FROM flight_passengers p WHERE p.flight_id = f.id) AS passenger_count
    FROM flights f WHERE f.event_id = ? AND substr(COALESCE(f.estimated_at, f.scheduled_at), 1, 10) = ?
    ORDER BY COALESCE(f.estimated_at, f.scheduled_at)`, id, today);
  const transfersToday = all(`SELECT t.*, d.name AS driver_name, v.plate AS vehicle_plate,
      (SELECT GROUP_CONCAT(g.first_name || ' ' || COALESCE(g.last_name, ''), ', ')
         FROM transfer_passengers tp JOIN guests g ON g.id = tp.guest_id WHERE tp.transfer_id = t.id) AS passenger_names
    FROM transfers t LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
    WHERE t.event_id = ? AND substr(t.scheduled_at, 1, 10) = ? ORDER BY t.scheduled_at`, id, today);
  const recentMovements = all(`SELECT m.*, g.first_name, g.last_name, g.title FROM movements m
    JOIN guests g ON g.id = m.guest_id WHERE g.event_id = ? ORDER BY m.recorded_at DESC LIMIT 15`, id);

  res.json({ event, today, rsvp, invites, status, category, totals: { ...totals, unhoused },
    flightsToday, transfersToday, recentMovements });
});

r.get('/events/:id/activity', (req, res) => {
  assertOverview(req.user, req.params.id);
  res.json(all(`SELECT a.*, g.first_name, g.last_name FROM activity_log a LEFT JOIN guests g ON g.id = a.guest_id
    WHERE a.event_id = ? ORDER BY a.created_at DESC LIMIT 200`, req.params.id));
});

r.get('/events/:id/messages', (req, res) => {
  const role = assertOverview(req.user, req.params.id);
  const rows = all(`SELECT m.*, g.first_name, g.last_name FROM messages m JOIN guests g ON g.id = m.guest_id
    WHERE g.event_id = ? ORDER BY m.sent_at DESC LIMIT 500`, req.params.id);
  // Viewers can read the outbox but not use the guests' invitation links.
  res.json(role === 'viewer' ? rows.map((m) => ({ ...m, body: maskLinks(m.body) })) : rows);
});

export default r;
