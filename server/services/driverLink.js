// Driver links stop working once they are no longer needed.
import { all } from '../db.js';
import { localToDate } from './format.js';

const HOUR = 60 * 60 * 1000;

/**
 * 48 hours after the driver's last (non-cancelled) trip, or 7 days after the
 * link was issued when the driver has no trips. Scheduling a new trip
 * therefore extends the link automatically.
 */
export function driverLinkExpiresAt(driver) {
  let last = null;
  for (const t of all(`SELECT t.scheduled_at, e.timezone FROM transfers t JOIN events e ON e.id = t.event_id
      WHERE t.driver_id = ? AND t.status != 'cancelled' AND t.scheduled_at IS NOT NULL`, driver.id)) {
    const d = localToDate(t.scheduled_at, t.timezone);
    if (d && (!last || d > last)) last = d;
  }
  if (last) return new Date(last.getTime() + 48 * HOUR);
  const issued = Date.parse(driver.token_issued_at || '') || 0;
  return new Date(issued + 7 * 24 * HOUR);
}
