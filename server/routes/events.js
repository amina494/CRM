import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { requireAdmin } from '../auth.js';
import { todayIn } from '../services/format.js';
import { badRequest, notFound } from '../services/tracking.js';

const r = Router();

export const EVENT_FIELDS = [
  'name', 'name_ar', 'description', 'description_ar', 'venue', 'venue_ar', 'venue_address', 'venue_lat', 'venue_lng',
  'starts_at', 'ends_at', 'timezone', 'dress_code', 'dress_code_ar', 'rsvp_deadline', 'host_name', 'host_name_ar',
];

r.get('/events', (req, res) => {
  res.json(all(`SELECT e.*, (SELECT COUNT(*) FROM guests g WHERE g.event_id = e.id) AS guest_count
    FROM events e ORDER BY e.starts_at DESC`));
});

r.post('/events', (req, res) => {
  if (!req.body.name) throw badRequest('Event name is required');
  res.status(201).json({ id: insert('events', req.body, EVENT_FIELDS) });
});

r.get('/events/:id', (req, res) => {
  const e = get('SELECT * FROM events WHERE id = ?', req.params.id);
  if (!e) throw notFound('Event not found');
  res.json(e);
});

r.put('/events/:id', (req, res) => {
  update('events', req.params.id, req.body, EVENT_FIELDS);
  res.json({ ok: true });
});

r.delete('/events/:id', requireAdmin, (req, res) => {
  run('DELETE FROM events WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

r.get('/events/:id/dashboard', (req, res) => {
  const id = req.params.id;
  const event = get('SELECT * FROM events WHERE id = ?', id);
  if (!event) throw notFound('Event not found');
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
  res.json(all(`SELECT a.*, g.first_name, g.last_name FROM activity_log a LEFT JOIN guests g ON g.id = a.guest_id
    WHERE a.event_id = ? ORDER BY a.created_at DESC LIMIT 200`, req.params.id));
});

r.get('/events/:id/messages', (req, res) => {
  res.json(all(`SELECT m.*, g.first_name, g.last_name FROM messages m JOIN guests g ON g.id = m.guest_id
    WHERE g.event_id = ? ORDER BY m.sent_at DESC LIMIT 500`, req.params.id));
});

export default r;
