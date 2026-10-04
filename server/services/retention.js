// Data retention: after an event is over, personal details of its guests are
// removed ("anonymised") while the numbers (headcount, RSVPs, check-ins) stay.
import { all, get, run, tx, nowIso } from '../db.js';
import { newToken } from '../auth.js';
import { localToDate } from './format.js';

const DAY = 24 * 60 * 60 * 1000;

/** When the event's guest data may be removed: its end (or start) + retention_days. */
export function retentionDueAt(event) {
  const end = localToDate(event.ends_at || event.starts_at, event.timezone);
  if (!end) return null;
  return new Date(end.getTime() + (event.retention_days ?? 90) * DAY);
}

const guestIds = (eventId) => all('SELECT id FROM guests WHERE event_id = ?', eventId).map((r) => r.id);
const inList = (ids) => (ids.length ? ids.join(',') : 'NULL'); // ids are integers from the database

export function retentionSummary(event) {
  const due = retentionDueAt(event);
  const ids = guestIds(event.id);
  const n = (sql) => get(sql).n;
  return {
    retention_days: event.retention_days,
    ends_at: event.ends_at || event.starts_at,
    due_at: due?.toISOString() ?? null,
    is_due: Boolean(due && due <= new Date()),
    anonymised_at: event.anonymised_at,
    would_remove: {
      guests_personal_details: ids.length,
      messages: n(`SELECT COUNT(*) n FROM messages WHERE guest_id IN (${inList(ids)})`),
      movements: n(`SELECT COUNT(*) n FROM movements WHERE guest_id IN (${inList(ids)})`),
      activity_details: n(`SELECT COUNT(*) n FROM activity_log WHERE guest_id IN (${inList(ids)}) AND details IS NOT NULL`),
    },
    kept: ['number of guests', 'categories', 'RSVP answers and party sizes', 'check-in times', 'tables, hotels, flights and trips (without names)'],
  };
}

/** Removes guests' personal details for one event. Irreversible. */
export function anonymiseEvent(event) {
  const ids = guestIds(event.id);
  const list = inList(ids);
  tx(() => {
    for (const id of ids) {
      run(`UPDATE guests SET title = NULL, first_name = 'Guest', last_name = ?, name_ar = NULL, email = NULL, phone = NULL,
          organization = NULL, position = NULL, nationality = NULL, relationship = NULL, dietary = NULL, notes = NULL,
          rsvp_message = NULL, current_location = NULL, invite_token = ?, checkin_code = ?, updated_at = ?
        WHERE id = ?`, `#${id}`, newToken(18), newToken(12), nowIso(), id);
    }
    run(`DELETE FROM messages WHERE guest_id IN (${list})`);
    run(`DELETE FROM movements WHERE guest_id IN (${list})`);
    run(`UPDATE activity_log SET details = NULL WHERE guest_id IN (${list})`);
    // Free-text fields that may contain names.
    run(`UPDATE accommodations SET notes = NULL, confirmation_no = NULL WHERE guest_id IN (${list})`);
    run('UPDATE flights SET extra_passengers = NULL, notes = NULL WHERE event_id = ?', event.id);
    run('UPDATE transfers SET notes = NULL WHERE event_id = ?', event.id);
    run('UPDATE events SET anonymised_at = ? WHERE id = ?', nowIso(), event.id);
  });
  return ids.length;
}
