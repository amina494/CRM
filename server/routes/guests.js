import { Router } from 'express';
import { parse as parseCsv } from 'csv-parse/sync';
import { all, get, insert, update, run, tx, nowIso, logActivity } from '../db.js';
import { newToken } from '../auth.js';
import {
  assertEvent, assertLinksInEvent, eventAccess, forbidden, guestIdsInEvent, loadGuest, ownGuestClause,
} from '../access.js';
import { sendMessage } from '../services/messaging.js';
import { invitationContent, inviteUrl } from '../services/invitations.js';
import { recordMovement, badRequest, notFound } from '../services/tracking.js';

const r = Router();

export const GUEST_FIELDS = [
  'title', 'first_name', 'last_name', 'name_ar', 'email', 'phone', 'organization', 'position', 'nationality',
  'category', 'language', 'party_lead_id', 'relationship', 'plus_ones_allowed', 'dietary', 'notes',
  'host_user_id', 'backup_host_user_id', 'table_id', 'seat_number', 'vehicle_id', 'driver_id',
  'rsvp_status', 'rsvp_party_size', 'rsvp_message',
];

// Who looks after a guest is decided by coordinators, not by the liaison.
const LIAISON_LOCKED = ['host_user_id', 'backup_host_user_id', 'party_lead_id'];

/** A fresh code for the entrance QR: separate from the invitation link. */
export const newCheckinCode = () => newToken(12);

const GUEST_LIST_SQL = `
  SELECT g.*,
    u.name AS host_name, u.phone AS host_phone, bu.name AS backup_host_name,
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
  LEFT JOIN users bu ON bu.id = g.backup_host_user_id
  LEFT JOIN seating_tables st ON st.id = g.table_id
  LEFT JOIN vehicles v ON v.id = g.vehicle_id
  LEFT JOIN drivers d ON d.id = g.driver_id
  LEFT JOIN guests lead ON lead.id = g.party_lead_id`;

// The invitation token and entrance code are secrets: they are never sent in
// lists, and the invitation link is only given to people who may act on it.
export const maskLinks = (text) => (text ? text.replace(/https?:\/\/\S+\/i\/[\w-]+/g, '[invitation link]') : text);

function splitArrival(row) {
  const { invite_token: _t, checkin_code: _c, ...safe } = row;
  if (!safe.arrival) return { ...safe, arrival: null };
  const [service_type, flight, at] = safe.arrival.split('|');
  return { ...safe, arrival: { service_type, flight, at } };
}

r.get('/events/:eventId/guests', eventAccess('viewer'), (req, res) => {
  const { q, rsvp, category, status, host, invite } = req.query;
  const where = ['g.event_id = ?'];
  const params = [req.params.eventId];
  // Liaisons only ever see the guests they look after.
  if (req.eventRole === 'liaison') where.push(ownGuestClause(req.user.id).sql);
  if (q) {
    where.push(`(g.first_name || ' ' || COALESCE(g.last_name,'') || ' ' || COALESCE(g.name_ar,'') || ' ' ||
      COALESCE(g.email,'') || ' ' || COALESCE(g.phone,'') || ' ' || COALESCE(g.organization,'')) LIKE ?`);
    params.push(`%${q}%`);
  }
  for (const [col, val] of [['rsvp_status', rsvp], ['category', category], ['current_status', status], ['invite_status', invite]]) {
    if (val) { where.push(`g.${col} = ?`); params.push(val); }
  }
  if (host === 'me') { where.push('(g.host_user_id = ? OR g.backup_host_user_id = ?)'); params.push(req.user.id, req.user.id); }
  else if (host === 'none') where.push('g.host_user_id IS NULL');
  else if (host) { where.push('g.host_user_id = ?'); params.push(host); }

  const rows = all(`${GUEST_LIST_SQL} WHERE ${where.join(' AND ')}
    ORDER BY CASE COALESCE(lead.category, g.category) WHEN 'vvip' THEN 0 WHEN 'vip' THEN 1 WHEN 'delegation' THEN 2 ELSE 3 END,
             COALESCE(g.party_lead_id, g.id), g.party_lead_id IS NOT NULL, g.first_name`, ...params);
  res.json(rows.map(splitArrival));
});

function createGuest(eventId, data, source = 'staff') {
  if (!data.first_name?.trim()) throw badRequest('First name is required');
  assertLinksInEvent(eventId, data);
  return insert('guests', { ...data, event_id: eventId, invite_token: newToken(18), checkin_code: newCheckinCode(), source },
    [...GUEST_FIELDS, 'event_id', 'invite_token', 'checkin_code', 'source']);
}

r.post('/events/:eventId/guests', eventAccess('coordinator'), (req, res) => {
  const id = createGuest(Number(req.params.eventId), req.body);
  logActivity({ eventId: Number(req.params.eventId), guestId: id, action: 'guest.created', req });
  res.status(201).json({ id });
});

// CSV import. Header names are matched case-insensitively against guest
// fields; common aliases ("name", "mobile", "company") are understood too.
const CSV_ALIASES = {
  name: 'full_name', 'full name': 'full_name', mobile: 'phone', whatsapp: 'phone', company: 'organization',
  'first name': 'first_name', 'last name': 'last_name', 'arabic name': 'name_ar', type: 'category', table: 'table_name',
};
r.post('/events/:eventId/guests/import', eventAccess('coordinator'), (req, res) => {
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
  logActivity({ eventId, action: 'guests.imported', details: `${created} guests`, req });
  res.json({ created, errors });
});

r.get('/events/:eventId/guests/export.csv', eventAccess('coordinator'), (req, res) => {
  const rows = all(`${GUEST_LIST_SQL} WHERE g.event_id = ? ORDER BY g.id`, req.params.eventId).map(splitArrival);
  logActivity({ eventId: Number(req.params.eventId), action: 'guests.exported', details: `${rows.length} guests`, req });
  const cols = ['id', 'title', 'first_name', 'last_name', 'name_ar', 'email', 'phone', 'organization', 'position',
    'category', 'lead_name', 'relationship', 'rsvp_status', 'rsvp_party_size', 'invite_status', 'host_name', 'backup_host_name',
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
  const { role } = loadGuest(req.user, req.params.id, 'read');
  const raw = get(`${GUEST_LIST_SQL} WHERE g.id = ?`, req.params.id);
  const guest = splitArrival(raw);
  const viewer = role === 'viewer';
  logActivity({ eventId: guest.event_id, guestId: guest.id, action: 'guest.viewed', req });
  const leadId = guest.party_lead_id || guest.id;
  res.json({
    ...guest,
    my_role: role,
    invite_url: viewer ? null : inviteUrl(raw),
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
    messages: all('SELECT * FROM messages WHERE guest_id = ? ORDER BY sent_at DESC LIMIT 50', guest.id)
      .map((m) => (viewer ? { ...m, body: maskLinks(m.body) } : m)),
    activity: all('SELECT * FROM activity_log WHERE guest_id = ? ORDER BY created_at DESC LIMIT 50', guest.id),
  });
});

r.put('/guests/:id', (req, res) => {
  const { guest: g, role } = loadGuest(req.user, req.params.id, 'handle');
  const differs = (k) => k in req.body && String(req.body[k] ?? '') !== String(g[k] ?? '');
  if (role === 'liaison') {
    const locked = LIAISON_LOCKED.filter(differs);
    if (locked.length) throw forbidden('Only a coordinator can change who hosts a guest or which party they are in');
  }
  if (req.body.party_lead_id && Number(req.body.party_lead_id) === g.id) throw badRequest('A guest cannot be their own party lead');
  const links = Object.fromEntries(['party_lead_id', 'table_id', 'host_user_id', 'backup_host_user_id'].filter(differs).map((k) => [k, req.body[k]]));
  assertLinksInEvent(g.event_id, links);
  const data = { ...req.body, updated_at: nowIso() };
  if (data.rsvp_status && data.rsvp_status !== g.rsvp_status) data.rsvp_at = nowIso();
  update('guests', g.id, data, [...GUEST_FIELDS, 'updated_at', 'rsvp_at']);
  const changed = Object.keys(req.body).filter((k) => GUEST_FIELDS.includes(k) && String(req.body[k] ?? '') !== String(g[k] ?? ''));
  if (changed.length) {
    logActivity({ eventId: g.event_id, guestId: g.id, action: 'guest.updated', details: changed.join(', '), req });
  }
  res.json({ ok: true });
});

r.delete('/guests/:id', (req, res) => {
  const { guest: g, role } = loadGuest(req.user, req.params.id, 'manage');
  if (role !== 'admin') throw forbidden('Only an admin can delete a guest');
  run('DELETE FROM guests WHERE id = ?', g.id);
  logActivity({ eventId: g.event_id, action: 'guest.deleted', details: `#${g.id} ${[g.first_name, g.last_name].filter(Boolean).join(' ')}`, req });
  res.json({ ok: true });
});

r.post('/guests/:id/movements', (req, res) => {
  const { guest: g } = loadGuest(req.user, req.params.id, 'handle');
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
  const { guest: g } = loadGuest(req.user, req.params.id, 'handle');
  res.json(checkIn(g, req));
});

// Door check-in. Looks up the entrance code only: the invitation link can
// never be used to check someone in, and the entrance code cannot open the
// invitation.
r.post('/check-in', (req, res) => {
  const code = String(req.body.code ?? req.body.token ?? '').trim();
  const found = code && get('SELECT id, event_id FROM guests WHERE checkin_code = ?', code);
  if (!found) throw notFound('No guest matches this code');
  if (req.body.event_id && Number(req.body.event_id) !== found.event_id) {
    assertEvent(req.user, found.event_id); // say "different event" only to people on that event
    throw badRequest('This pass is for a different event');
  }
  const { guest: g } = loadGuest(req.user, found.id, 'handle');
  res.json(checkIn(g, req));
});

function checkIn(g, req) {
  const already = Boolean(g.checked_in_at);
  if (!already) {
    tx(() => {
      run('UPDATE guests SET checked_in_at = ? WHERE id = ?', nowIso(), g.id);
      recordMovement(g.id, { status: 'at_venue', location: 'Venue', note: 'Checked in', by: req.user.name });
      logActivity({ eventId: g.event_id, guestId: g.id, action: 'guest.checked_in', req });
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
  const { guest: g } = loadGuest(req.user, req.params.id, 'handle');
  const event = get('SELECT * FROM events WHERE id = ?', g.event_id);
  res.json({ ...invitationContent(event, g), url: inviteUrl(g) });
});

// Send invitations to many guests over the chosen channels.
r.post('/events/:eventId/invitations/send', eventAccess('coordinator'), async (req, res) => {
  const eventId = Number(req.params.eventId);
  const { channels = ['email'] } = req.body;
  const ids = guestIdsInEvent(eventId, Array.isArray(req.body.guest_ids) ? req.body.guest_ids : []);
  if (!ids.length) throw badRequest('Select at least one guest');
  if (!channels.every((c) => ['email', 'whatsapp', 'sms'].includes(c))) throw badRequest('Unknown channel');
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
    logActivity({ eventId, guestId: g.id, action: 'invitation.sent',
      details: outcomes.map((o) => `${o.channel}:${o.status}`).join(', '), req });
    results.push({ guest_id: g.id, name: `${g.first_name} ${g.last_name || ''}`.trim(), outcomes });
  }
  res.json({ results });
});

export default r;
