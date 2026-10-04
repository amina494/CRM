import { localToDate } from './format.js';

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);

/** Builds an iCalendar file for the event so guests can add it to their calendar. */
export function eventIcs(event, guest, inviteUrl) {
  const start = localToDate(event.starts_at, event.timezone);
  const end = localToDate(event.ends_at, event.timezone) || (start && new Date(start.getTime() + 3 * 3600e3));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Guest CRM//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${event.id}-guest-${guest.id}@guest-crm`,
    `DTSTAMP:${stamp(new Date())}`,
    start && `DTSTART:${stamp(start)}`,
    end && `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(event.name)}`,
    event.venue && `LOCATION:${esc([event.venue, event.venue_address].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${esc([event.description, `Invitation: ${inviteUrl}`].filter(Boolean).join('\n\n'))}`,
    `URL:${inviteUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n') + '\r\n';
}
