// Who may see and change what.
//
//   admin        every event, everything
//   coordinator  everything inside the events they are a member of, except
//                deleting guests or the event itself
//   liaison      only the guests they host (or back up) in their events:
//                view, edit contact details, record movements, check in
//   viewer       read-only inside their events
//
// Every rule is enforced here, on the server. The web app hides buttons a
// person cannot use, but hiding is a convenience and never the protection.
import { all, get } from './db.js';

export const RANK = { viewer: 1, liaison: 2, coordinator: 3, admin: 4 };

export function forbidden(msg = 'You do not have access to this') {
  return Object.assign(new Error(msg), { status: 403 });
}
export function notFound(msg = 'Not found') {
  return Object.assign(new Error(msg), { status: 404 });
}
function badRequest(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

/** The user's role on one event: 'admin', a membership role, or null. */
export function eventRole(user, eventId) {
  if (!user) return null;
  if (user.role === 'admin') return 'admin';
  const id = Number(eventId);
  if (!Number.isInteger(id)) return null;
  return get('SELECT role FROM event_members WHERE event_id = ? AND user_id = ?', id, user.id)?.role || null;
}

/** Ids of the events this user may open (null means all of them). */
export function accessibleEventIds(user) {
  if (user.role === 'admin') return null;
  return all('SELECT event_id FROM event_members WHERE user_id = ?', user.id).map((r) => r.event_id);
}

/** True for admins and for coordinators of at least one event. */
export function isCoordinatorAnywhere(user) {
  if (user.role === 'admin') return true;
  return Boolean(get("SELECT 1 FROM event_members WHERE user_id = ? AND role = 'coordinator'", user.id));
}

/**
 * Throws unless the user holds at least `min` on the event. Someone with no
 * access at all gets "not found", so event ids cannot be probed.
 */
export function assertEvent(user, eventId, min = 'viewer') {
  const role = eventRole(user, eventId);
  if (!role) throw notFound('Event not found');
  if (RANK[role] < RANK[min]) {
    throw forbidden(role === 'viewer' ? 'Your role is read-only' : 'Your role does not allow this');
  }
  return role;
}

/** Express middleware form of assertEvent for routes with an event id in the URL. */
export const eventAccess = (min = 'viewer', param = 'eventId') => (req, res, next) => {
  req.eventRole = assertEvent(req.user, req.params[param], min);
  next();
};

/** Guests a liaison looks after: hosted or backed up by them, plus those guests' companions. */
const OWN_GUEST_SQL = `(g.host_user_id = :u OR g.backup_host_user_id = :u OR g.party_lead_id IN
  (SELECT l.id FROM guests l WHERE l.host_user_id = :u OR l.backup_host_user_id = :u))`;

export function ownGuestClause(userId) {
  return { sql: OWN_GUEST_SQL.replaceAll(':u', String(Number(userId))) };
}

export function isOwnGuest(user, guest) {
  if (guest.host_user_id === user.id || guest.backup_host_user_id === user.id) return true;
  if (!guest.party_lead_id) return false;
  const lead = get('SELECT host_user_id, backup_host_user_id FROM guests WHERE id = ?', guest.party_lead_id);
  return Boolean(lead && (lead.host_user_id === user.id || lead.backup_host_user_id === user.id));
}

/**
 * Loads a guest and checks the caller may act on them.
 * @param mode 'read'   – anyone on the event; liaisons only for their own guests
 *             'handle' – liaison (own guests) or coordinator: edits, movements
 *             'manage' – coordinator or admin
 */
export function loadGuest(user, guestId, mode = 'read') {
  const guest = get('SELECT * FROM guests WHERE id = ?', guestId);
  if (!guest) throw notFound('Guest not found');
  const role = eventRole(user, guest.event_id);
  if (!role) throw notFound('Guest not found');
  if (role === 'liaison' && !isOwnGuest(user, guest)) throw notFound('Guest not found');
  if (mode === 'manage' && RANK[role] < RANK.coordinator) throw forbidden('Your role does not allow this');
  if (mode === 'handle' && RANK[role] < RANK.liaison) throw forbidden('Your role is read-only');
  return { guest, role };
}

/**
 * Checks that every id is a guest of this event and returns the cleaned list.
 * Ids from another event (or that do not exist) are refused rather than
 * silently dropped, so a wrong booking is noticed instead of half-saved.
 * Passing something that is not an array returns it unchanged ("not sent").
 */
export function guestIdsInEvent(eventId, ids) {
  if (!Array.isArray(ids)) return ids;
  const wanted = [...new Set(ids.map(Number))];
  if (wanted.some((n) => !Number.isInteger(n))) throw badRequest('Unknown guest');
  if (!wanted.length) return [];
  const rows = all(`SELECT id FROM guests WHERE event_id = ? AND id IN (${wanted.map(() => '?').join(',')})`, eventId, ...wanted);
  if (rows.length !== wanted.length) throw badRequest('Some of the selected guests are not on this event');
  return wanted;
}

/** Refuses a link to a guest, table or host that belongs to another event. */
export function assertLinksInEvent(eventId, { party_lead_id: lead, table_id: table, host_user_id: host, backup_host_user_id: backup } = {}) {
  if (lead != null && lead !== '' && !get('SELECT 1 FROM guests WHERE id = ? AND event_id = ?', lead, eventId)) {
    throw badRequest('The party lead is not on this event');
  }
  if (table != null && table !== '' && !get('SELECT 1 FROM seating_tables WHERE id = ? AND event_id = ?', table, eventId)) {
    throw badRequest('That table belongs to another event');
  }
  for (const [label, uid] of [['host', host], ['backup host', backup]]) {
    if (uid == null || uid === '') continue;
    const ok = get(`SELECT 1 FROM users u WHERE u.id = ? AND u.active = 1 AND (u.role = 'admin'
      OR EXISTS (SELECT 1 FROM event_members m WHERE m.user_id = u.id AND m.event_id = ? AND m.role IN ('coordinator','liaison')))`, uid, eventId);
    if (!ok) throw badRequest(`The ${label} must be a coordinator or liaison on this event`);
  }
}

export const atLeast = (role, min) => Boolean(role) && RANK[role] >= RANK[min];
