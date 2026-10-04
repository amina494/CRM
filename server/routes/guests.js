import { Router } from 'express';
import { parse as parseCsv } from 'csv-parse/sync';
import { all, get, insert, update, run, tx, nowIso, logActivity } from '../db.js';
import { newToken } from '../auth.js';
import { sendMessage } from '../services/messaging.js';
import { invitationContent, inviteUrl } from '../services/invitations.js';
import { recordMovement, badRequest, notFound } from '../services/tracking.js';

const r = Router();

export const GUEST_FIELDS = [
  'title', 'first_name', 'last_name', 'name_ar', 'email', 'phone', 'organization', 'position', 'nationality',
  'category', 'language', 'party_lead_id', 'relationship', 'plus_ones_allowed', 'dietary', 'notes',
  'host_user_id', 'table_id', 'seat_number', 'vehicle_id', 'driver_id',
  'rsvp_status', 'rsvp_party_size', 'rsvp_message',
];

const GUEST_LIST_SQL = `
  SELECT g.*,
    u.name AS host_name,
    st.name AS table_name,
    v.plate AS vehicle_plate, TRIM(COALESCE(v.make,'') || ' ' || COALESCE(v.model,'')) AS vehicle_label,
    d.name AS driver_name, d.phone AS driver_phone,
    lead.first_name || ' ' || COALESCE(lead.last_name, '') AS lead_name,
    (SELECT COUNT(*) FROM guests c WHERE c.party_lead_id = g.id) AS companion_count,
    (SELECT h.name || COALESCE(' · ' || a.room_number, '') FROM accommodations a JOIN hotels h ON h.id = a.hotel_id
       WHERE a.guest_id = g.id AND a.status != 'cancelled' ORDER BY a.check_in DESC LIMIT 1) AS stay,
    (SELECT f.service_type || '|' || COALESCE(f.airline || ' ', '') || COALESCE(f.flight_number, f.tail_number, '')
              || '|' || COALESCE(f.estimated_at, f.scheduled_at, '')
       FROM flight_passengers fp JOIN flights f ON f.id = fp.flight_id
       WHERE fp.guest_id = g.id AND f.direction = 'arrival' ORDER BY f.scheduled_at LIMIT 1) AS arrival
  FROM guests g
  LEFT JOIN users u ON u.id = g.host_user_id
  LEFT JOIN seating_tables st ON st.id = g.table_id
  LEFT JOIN vehicles v ON v.id = g.vehicle_id
  LEFT JOIN drivers d ON d.id = g.driver_id
  LEFT JOIN guests lead ON lead.id = g.party_lead_id`;

function splitArrival(row) {
  if (!row.arrival) return { ...row, arrival: null };
  const [service_type, flight, at] = row.arrival.split('|');
  return { ...row, arrival: { service_type, flight, at } };
}

r.get('/events/:eventId/guests', (req, res) => {
  const { q, rsvp, category, status, host, invite } = req.query;
  const where = ['g.event_id = ?'];
  const params = [req.params.eventId];
  if (q) {
    where.push(`(g.first_name || ' ' || COALESCE(g.last_name,'') || ' ' || COALESCE(g.name_ar,'') || ' ' ||
      COALESCE(g.email,'') || ' ' || COALESCE(g.phone,'') || ' ' || COALESCE(g.organization,'')) LIKE ?`);
    params.push(`%${q}%`);
  }
  for (const [col, val] of [['rsvp_status', rsvp], ['category', category], ['current_status', status], ['invite_status', invite]]) {
    if (val) { where.push(`g.${col} = ?`); params.push(val); }
  }
  if (host === 'me') { where.push('g.host_user_id = ?'); params.push(req.user.id); }
  else if (host === 'none') where.push('g.host_user_id IS NULL');
  else if (host) { where.push('g.host_user_id = ?'); params.push(host); }

  const rows = all(`${GUEST_LIST_SQL} WHERE ${where.join(' AND ')}
    ORDER BY CASE COALESCE(lead.category, g.category) WHEN 'vvip' THEN 0 WHEN 'vip' THEN 1 WHEN 'delegation' THEN 2 ELSE 3 END,
             COALESCE(g.party_lead_id, g.id), g.party_lead_id IS NOT NULL, g.first_name`, ...params);
  res.json(rows.map(splitArrival));
});

function createGuest(eventId, data, source = 'staff') {
  if (!data.first_name?.trim()) throw badRequest('First name is required');
  return insert('guests', { ...data, event_id: eventId, invite_token: newToken(18), source },
    [...GUEST_FIELDS, 'event_id', 'invite_token', 'source']);
}

r.post('/events/:eventId/guests', (req, res) => {
  const id = createGuest(Number(req.params.eventId), req.body);
  logActivity({ eventId: Number(req.params.eventId), guestId: id, actor: req.user.name, action: 'guest.created' });
  res.status(201).json({ id });
});

// CSV import. Header names are matched case-insensitively against guest
// fields; common aliases ("name", "mobile", "company") are understood too.
const CSV_ALIASES = {
  name: 'full_name', 'full name': 'full_name', mobile: 'phone', whatsapp: 'phone', company: 'organization',
  'first name': 'first_name', 'last name': 'last_name', 'arabic name': 'name_ar', type: 'category', table: 'table_name',
};
r.post('/events/:eventId/guests/import', (req, res) => {
  const eventId = Number(req.params.eventId);
  const csv = req.body.csv;
  if (!csv?.trim()) throw badRequest('CSV content is required');
  const records = parseCsv(csv, { columns: (h) => h.map((x) => {
    const k = x.trim().toLowerCase();
    return CSV_ALIASES[k] || k.replace(/\s+/g, '_');
  }), skip_empty_lines: true, trim: true, bom: true });
  const tables = Object.fromEntries(all('SELECT id, name FROM seating_tables WHERE event_id = ?', eventId)
    .map((t) => [t.name.toLowerCase(), t.id]));

  const errors = [];
  let created = 0;
  tx(() => {
    records.forEach((rec, i) => {
      if (Object.values(rec).every((v) => !v)) return; // blank spreadsheet row
      const data = { ...rec };
      if (data.full_name && !data.first_name) {
        const [first, ...rest] = data.full_name.split(/\s+/);
        data.first_name = first;
        data.last_name = rest.join(' ');
      }
      if (data.category) data.category = data.category.toLowerCase();
      if (data.language) data.language = data.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
      if (data.table_name) data.table_id = tables[data.table_name.toLowerCase()];
      try {
        createGuest(eventId, data, 'import');
        created++;
      } catch (err) {
        errors.push({ row: i + 2, error: err.message });
      }
    });
  });
  logActivity({ eventId, actor: req.user.name, action: 'guests.imported', details: `${created} guests` });
  res.json({ created, errors });
});

r.get('/events/:eventId/guests/export.csv', (req, res) => {
  const rows = all(`${GUEST_LIST_SQL} WHERE g.event_id = ? ORDER BY g.id`, req.params.eventId).map(splitArrival);
  const cols = ['id', 'title', 'first_name', 'last_name', 'name_ar', 'email', 'phone', 'organization', 'position',
    'category', 'lead_name', 'relationship', 'rsvp_status', 'rsvp_party_size', 'invite_status', 'host_name',
    'table_name', 'seat_number', 'stay', 'arrival', 'vehicle_plate', 'driver_name', 'current_status',
    'current_location', 'checked_in_at', 'dietary', 'notes'];
  const cell = (v) => {
    if (v && typeof v === 'object') v = `${v.service_type} ${v.flight} ${v.at}`;
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="guests.csv"');
  res.send('﻿' + [cols.join(','), ...rows.map((row) => cols.map((c) => cell(row[c])).join(','))].join('\n'));
});

// Full guest profile with everything staff need on one screen.
r.get('/guests/:id', (req, res) => {
  const row = get(`${GUEST_LIST_SQL} WHERE g.id = ?`, req.params.id);
  if (!row) throw notFound('Guest not found');
  const guest = splitArrival(row);
  const leadId = guest.party_lead_id || guest.id;
  res.json({
    ...guest,
    invite_url: inviteUrl(guest),
    party: all(`SELECT id, title, first_name, last_name, relationship, category, rsvp_status, current_status, party_lead_id
      FROM guests WHERE (id = ? OR party_lead_id = ?) AND id != ? ORDER BY party_lead_id IS NOT NULL, first_name`,
      leadId, leadId, guest.id),
    accommodations: all(`SELECT a.*, h.name AS hotel_name, h.address AS hotel_address, h.phone AS hotel_phone
      FROM accommodations a JOIN hotels h ON h.id = a.hotel_id WHERE a.guest_id = ? ORDER BY a.check_in`, guest.id),
    flights: all(`SELECT f.*, fp.seat,
        (SELECT GROUP_CONCAT(g2.first_name || ' ' || COALESCE(g2.last_name,''), ', ')
           FROM flight_passengers p2 JOIN guests g2 ON g2.id = p2.guest_id
           WHERE p2.flight_id = f.id AND p2.guest_id != ?) AS co_passengers
      FROM flight_passengers fp JOIN flights f ON f.id = fp.flight_id WHERE fp.guest_id = ? ORDER BY f.scheduled_at`,
      guest.id, guest.id),
    transfers: all(`SELECT t.*, d.name AS driver_name, d.phone AS driver_phone, v.plate AS vehicle_plate,
        TRIM(COALESCE(v.make,'') || ' ' || COALESCE(v.model,'')) AS vehicle_label
      FROM transfer_passengers tp JOIN transfers t ON t.id = tp.transfer_id
      LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE tp.guest_id = ? ORDER BY t.scheduled_at`, guest.id),
    movements: all('SELECT * FROM movements WHERE guest_id = ? ORDER BY recorded_at DESC LIMIT 100', guest.id),
    messages: all('SELECT * FROM messages WHERE guest_id = ? ORDER BY sent_at DESC LIMIT 50', guest.id),
    activity: all('SELECT * FROM activity_log WHERE guest_id = ? ORDER BY created_at DESC LIMIT 50', guest.id),
  });
});

r.put('/guests/:id', (req, res) => {
  const g = get('SELECT * FROM guests WHERE id = ?', req.params.id);
  if (!g) throw notFound('Guest not found');
  if (req.body.party_lead_id && Number(req.body.party_lead_id) === g.id) throw badRequest('A guest cannot be their own party lead');
  const data = { ...req.body, updated_at: nowIso() };
  if (data.rsvp_status && data.rsvp_status !== g.rsvp_status) data.rsvp_at = nowIso();
  update('guests', g.id, data, [...GUEST_FIELDS, 'updated_at', 'rsvp_at']);
  const changed = Object.keys(req.body).filter((k) => GUEST_FIELDS.includes(k) && String(req.body[k] ?? '') !== String(g[k] ?? ''));
  if (changed.length) {
    logActivity({ eventId: g.event_id, guestId: g.id, actor: req.user.name, action: 'guest.updated', details: changed.join(', ') });
  }
  res.json({ ok: true });
});

r.delete('/guests/:id', (req, res) => {
  run('DELETE FROM guests WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

r.post('/guests/:id/movements', (req, res) => {
  const g = get('SELECT id, event_id FROM guests WHERE id = ?', req.params.id);
  if (!g) throw notFound('Guest not found');
  const { status, location, note, include_party } = req.body;
  tx(() => {
    const ids = include_party
      ? all('SELECT id FROM guests WHERE id = ? OR party_lead_id = ?', g.id, g.id).map((x) => x.id)
      : [g.id];
    for (const id of ids) recordMovement(id, { status, location, note, by: req.user.name });
  });
  res.json({ ok: true });
});

r.post('/guests/:id/check-in', (req, res) => {
  const g = get('SELECT * FROM guests WHERE id = ?', req.params.id);
  if (!g) throw notFound('Guest not found');
  res.json(checkIn(g, req.user.name));
});

r.post('/check-in', (req, res) => {
  const token = String(req.body.token || '').trim().replace(/^.*\/i\//, '');
  const g = get('SELECT * FROM guests WHERE invite_token = ?', token);
  if (!g) throw notFound('No guest matches this code');
  if (req.body.event_id && Number(req.body.event_id) !== g.event_id) throw badRequest('This invitation is for a different event');
  res.json(checkIn(g, req.user.name));
});

function checkIn(g, by) {
  const already = Boolean(g.checked_in_at);
  if (!already) {
    tx(() => {
      run('UPDATE guests SET checked_in_at = ? WHERE id = ?', nowIso(), g.id);
      recordMovement(g.id, { status: 'at_venue', location: 'Venue', note: 'Checked in', by });
      logActivity({ eventId: g.event_id, guestId: g.id, actor: by, action: 'guest.checked_in' });
    });
  }
  const guest = get(`${GUEST_LIST_SQL} WHERE g.id = ?`, g.id);
  const leadId = g.party_lead_id || g.id;
  const party = all(`SELECT id, title, first_name, last_name, relationship, checked_in_at FROM guests
    WHERE (id = ? OR party_lead_id = ?) AND id != ? AND rsvp_status != 'declined' ORDER BY party_lead_id IS NOT NULL, first_name`,
  leadId, leadId, g.id);
  return { already, guest: splitArrival(guest), party };
}

r.get('/guests/:id/invitation-preview', (req, res) => {
  const g = get('SELECT * FROM guests WHERE id = ?', req.params.id);
  if (!g) throw notFound('Guest not found');
  const event = get('SELECT * FROM events WHERE id = ?', g.event_id);
  res.json({ ...invitationContent(event, g), url: inviteUrl(g) });
});

// Send invitations to many guests over the chosen channels.
r.post('/events/:eventId/invitations/send', async (req, res) => {
  const eventId = Number(req.params.eventId);
  const { guest_ids: ids = [], channels = ['email'] } = req.body;
  if (!ids.length) throw badRequest('Select at least one guest');
  const event = get('SELECT * FROM events WHERE id = ?', eventId);
  if (!event) throw notFound('Event not found');

  const results = [];
  for (const id of ids) {
    const g = get('SELECT * FROM guests WHERE id = ? AND event_id = ?', id, eventId);
    if (!g) continue;
    const content = invitationContent(event, g);
    const outcomes = [];
    for (const channel of channels) {
      const to = channel === 'email' ? g.email : g.phone;
      if (!to) { outcomes.push({ channel, status: 'skipped', error: `No ${channel === 'email' ? 'email' : 'phone'}` }); continue; }
      const out = await sendMessage({ guestId: g.id, channel, to, subject: content.subject, text: content.text, html: content.html, sentBy: req.user.name });
      outcomes.push({ channel, ...out });
    }
    const delivered = outcomes.some((o) => o.status === 'sent' || o.status === 'logged');
    const failed = outcomes.length && outcomes.every((o) => o.status === 'failed');
    if (delivered) {
      run(`UPDATE guests SET invite_status = CASE WHEN invite_status = 'opened' THEN 'opened' ELSE 'sent' END,
           invited_at = ? WHERE id = ?`, nowIso(), g.id);
    } else if (failed) {
      run("UPDATE guests SET invite_status = 'failed' WHERE id = ? AND invite_status = 'not_sent'", g.id);
    }
    logActivity({ eventId, guestId: g.id, actor: req.user.name, action: 'invitation.sent',
      details: outcomes.map((o) => `${o.channel}:${o.status}`).join(', ') });
    results.push({ guest_id: g.id, name: `${g.first_name} ${g.last_name || ''}`.trim(), outcomes });
  }
  res.json({ results });
});

export default r;
