// Unauthenticated endpoints, protected by unguessable tokens:
//   /api/public/invite/:token  – the guest's invitation, RSVP and wallet passes
//   /api/public/driver/:token  – a driver's trip sheet and status updates
import { Router } from 'express';
import QRCode from 'qrcode';
import { all, get, insert, run, tx, nowIso, logActivity } from '../db.js';
import { newToken } from '../auth.js';
import { config } from '../config.js';
import { applePass, googleSaveUrl, walletStatus, WalletNotConfigured } from '../services/wallet.js';
import { eventIcs } from '../services/ics.js';
import { inviteUrl } from '../services/invitations.js';
import { setTransferStatus, badRequest, notFound } from '../services/tracking.js';
import { todayIn, localToDate } from '../services/format.js';
import { TRANSFER_LIST_SQL, transferPassengers } from './logistics.js';

const r = Router();

function loadInvite(token) {
  const guest = get('SELECT * FROM guests WHERE invite_token = ?', token);
  if (!guest) throw notFound('Invitation not found');
  const event = get('SELECT * FROM events WHERE id = ?', guest.event_id);
  return { guest, event };
}

const extrasFor = (guest) => ({
  inviteUrl: inviteUrl(guest),
  tableName: guest.table_id ? get('SELECT name FROM seating_tables WHERE id = ?', guest.table_id)?.name : null,
});

r.get('/invite/:token', (req, res) => {
  const { guest, event } = loadInvite(req.params.token);
  if (!guest.opened_at) {
    run("UPDATE guests SET opened_at = ?, invite_status = 'opened' WHERE id = ?", nowIso(), guest.id);
    logActivity({ eventId: event.id, guestId: guest.id, actor: 'guest', action: 'invitation.opened' });
  }
  const companions = all("SELECT first_name, last_name, relationship FROM guests WHERE party_lead_id = ? AND source = 'rsvp' ORDER BY id", guest.id);
  const { tableName } = extrasFor(guest);
  res.json({
    org: config.orgName,
    event: {
      name: event.name, name_ar: event.name_ar, description: event.description, description_ar: event.description_ar,
      venue: event.venue, venue_ar: event.venue_ar, venue_address: event.venue_address,
      venue_lat: event.venue_lat, venue_lng: event.venue_lng, starts_at: event.starts_at, ends_at: event.ends_at,
      timezone: event.timezone, dress_code: event.dress_code, dress_code_ar: event.dress_code_ar,
      rsvp_deadline: event.rsvp_deadline, host_name: event.host_name, host_name_ar: event.host_name_ar,
    },
    guest: {
      title: guest.title, first_name: guest.first_name, last_name: guest.last_name, name_ar: guest.name_ar,
      language: guest.language, plus_ones_allowed: guest.plus_ones_allowed, rsvp_status: guest.rsvp_status,
      rsvp_party_size: guest.rsvp_party_size, rsvp_message: guest.rsvp_message, dietary: guest.dietary,
      is_companion: Boolean(guest.party_lead_id), table: tableName, seat: guest.seat_number,
    },
    companions,
    rsvp_closed: rsvpClosed(event),
    wallet: walletStatus(),
  });
});

const rsvpClosed = (event) => Boolean(event.rsvp_deadline && localToDate(event.rsvp_deadline, event.timezone) < new Date());

r.post('/invite/:token/rsvp', (req, res) => {
  const { guest, event } = loadInvite(req.params.token);
  if (rsvpClosed(event)) throw badRequest('The RSVP deadline has passed. Please contact your host.');
  const { status, message, dietary } = req.body;
  if (!['attending', 'declined', 'tentative'].includes(status)) throw badRequest('Please choose a response');
  const companions = (Array.isArray(req.body.companions) ? req.body.companions : [])
    .map((c) => String(c || '').trim()).filter(Boolean);
  if (status === 'attending' && companions.length > guest.plus_ones_allowed) {
    throw badRequest(`You may bring up to ${guest.plus_ones_allowed} guest(s)`);
  }
  tx(() => {
    const partySize = status === 'attending' ? 1 + companions.length : 0;
    run(`UPDATE guests SET rsvp_status = ?, rsvp_at = ?, rsvp_party_size = ?, rsvp_message = ?,
        dietary = COALESCE(?, dietary), updated_at = ? WHERE id = ?`,
    status, nowIso(), partySize, message || null, dietary || null, nowIso(), guest.id);

    // Companions named in the RSVP become guests in this party. Existing
    // RSVP-created companions with the same name are kept (with any logistics
    // staff already arranged); ones no longer listed are removed.
    const existing = all("SELECT id, first_name, last_name FROM guests WHERE party_lead_id = ? AND source = 'rsvp'", guest.id);
    const key = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const wanted = status === 'attending' ? companions : [];
    const keep = new Set();
    for (const name of wanted) {
      const match = existing.find((c) => !keep.has(c.id) && key(`${c.first_name} ${c.last_name || ''}`) === key(name));
      if (match) { keep.add(match.id); continue; }
      const [first, ...rest] = name.split(/\s+/);
      insert('guests', {
        event_id: event.id, first_name: first, last_name: rest.join(' ') || null, category: 'companion',
        party_lead_id: guest.id, relationship: 'Plus-one', language: guest.language, source: 'rsvp',
        rsvp_status: 'attending', rsvp_at: nowIso(), invite_token: newToken(18), host_user_id: guest.host_user_id,
      }, ['event_id', 'first_name', 'last_name', 'category', 'party_lead_id', 'relationship', 'language', 'source',
        'rsvp_status', 'rsvp_at', 'invite_token', 'host_user_id']);
    }
    for (const c of existing) if (!keep.has(c.id)) run('DELETE FROM guests WHERE id = ?', c.id);
    logActivity({ eventId: event.id, guestId: guest.id, actor: 'guest', action: `rsvp.${status}`,
      details: companions.length ? `with ${companions.join(', ')}` : null });
  });
  res.json({ ok: true });
});

function sendWalletError(res, err) {
  if (err instanceof WalletNotConfigured) return res.status(503).json({ error: err.message });
  throw err;
}

r.get('/invite/:token/pass.pkpass', (req, res) => {
  const { guest, event } = loadInvite(req.params.token);
  if (guest.rsvp_status !== 'attending') throw badRequest('Please accept the invitation first');
  try {
    const buf = applePass(event, guest, extrasFor(guest));
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="invitation-${guest.id}.pkpass"`);
    res.send(buf);
  } catch (err) {
    sendWalletError(res, err);
  }
});

r.get('/invite/:token/google-wallet', (req, res) => {
  const { guest, event } = loadInvite(req.params.token);
  if (guest.rsvp_status !== 'attending') throw badRequest('Please accept the invitation first');
  try {
    res.redirect(googleSaveUrl(event, guest, extrasFor(guest)));
  } catch (err) {
    sendWalletError(res, err);
  }
});

r.get('/invite/:token/event.ics', (req, res) => {
  const { guest, event } = loadInvite(req.params.token);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="invitation.ics"');
  res.send(eventIcs(event, guest, inviteUrl(guest)));
});

r.get('/invite/:token/qr.svg', async (req, res) => {
  const { guest } = loadInvite(req.params.token);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(await QRCode.toString(guest.invite_token, { type: 'svg', margin: 1, color: { dark: '#14283c' } }));
});

// --- Driver portal ----------------------------------------------------
function loadDriver(token) {
  const driver = get('SELECT * FROM drivers WHERE access_token = ?', token);
  if (!driver) throw notFound('Link not valid');
  return driver;
}

r.get('/driver/:token', (req, res) => {
  const d = loadDriver(req.params.token);
  // Today's and upcoming transfers that are not finished, plus today's finished ones.
  const today = todayIn();
  const transfers = all(`${TRANSFER_LIST_SQL} WHERE t.driver_id = ? AND t.status != 'cancelled'
      AND (substr(t.scheduled_at, 1, 10) >= ? OR t.status IN ('en_route','picked_up'))
    ORDER BY t.scheduled_at LIMIT 50`, d.id, today);
  const dedicated = all(`SELECT g.id, g.title, g.first_name, g.last_name, g.phone, g.current_status, g.current_location
    FROM guests g WHERE g.driver_id = ? ORDER BY g.first_name`, d.id);
  res.json({
    driver: { name: d.name, status: d.status },
    today,
    transfers: transfers.map((t) => ({ ...t, passengers: transferPassengers(t.id) })),
    dedicated,
  });
});

r.post('/driver/:token/transfers/:id/status', (req, res) => {
  const d = loadDriver(req.params.token);
  const t = get('SELECT * FROM transfers WHERE id = ? AND driver_id = ?', req.params.id, d.id);
  if (!t) throw notFound('Transfer not found');
  res.json(setTransferStatus(t.id, req.body.status, `Driver ${d.name}`));
});

r.post('/driver/:token/location', (req, res) => {
  const d = loadDriver(req.params.token);
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw badRequest('Invalid coordinates');
  run('UPDATE drivers SET last_lat = ?, last_lng = ?, last_seen_at = ? WHERE id = ?', lat, lng, nowIso(), d.id);
  res.json({ ok: true });
});

export default r;
