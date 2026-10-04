// Live movement tracking. Every guest status change goes through
// recordMovement so the guest's current status and their history stay in sync.
// Flight and transfer status changes cascade to every passenger on board.
import { all, get, run, nowIso, tx } from '../db.js';

export const GUEST_STATUSES = ['not_arrived', 'in_flight', 'landed', 'in_transit', 'at_hotel', 'at_venue', 'out', 'departed'];
export const TRANSFER_STATUSES = ['scheduled', 'en_route', 'picked_up', 'completed', 'cancelled'];
export const FLIGHT_STATUSES = ['scheduled', 'delayed', 'departed', 'landed', 'cancelled'];

export function recordMovement(guestId, { status, location = null, note = null, transferId = null, by = null }) {
  if (!GUEST_STATUSES.includes(status)) throw badRequest(`Unknown status "${status}"`);
  const at = nowIso();
  run(
    'INSERT INTO movements (guest_id, status, location, note, transfer_id, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?)',
    guestId, status, location, note, transferId, by, at,
  );
  run(
    `UPDATE guests SET current_status = ?, current_location = COALESCE(?, current_location),
       status_updated_at = ?, updated_at = ? WHERE id = ?`,
    status, location, at, at, guestId,
  );
}

const transferPassengerIds = (id) =>
  all('SELECT guest_id FROM transfer_passengers WHERE transfer_id = ?', id).map((r) => r.guest_id);

/** Where a guest ends up once a transfer of this kind completes. */
function arrivalStatus(kind) {
  return { airport_pickup: 'at_hotel', airport_dropoff: 'departed', to_venue: 'at_venue', from_venue: 'at_hotel' }[kind] || 'out';
}

export function setTransferStatus(transferId, status, by) {
  if (!TRANSFER_STATUSES.includes(status)) throw badRequest(`Unknown transfer status "${status}"`);
  const t = get('SELECT * FROM transfers WHERE id = ?', transferId);
  if (!t) throw notFound('Transfer not found');
  const at = nowIso();
  tx(() => {
    const stampCol = { en_route: 'started_at', picked_up: 'picked_up_at', completed: 'completed_at' }[status];
    run(`UPDATE transfers SET status = ?${stampCol ? `, ${stampCol} = ?` : ''} WHERE id = ?`,
      ...(stampCol ? [status, at, transferId] : [status, transferId]));

    const guests = transferPassengerIds(transferId);
    if (status === 'picked_up') {
      for (const g of guests) {
        recordMovement(g, { status: 'in_transit', location: `${t.pickup || 'Pickup'} → ${t.dropoff || ''}`.trim(), transferId, by, note: 'Picked up' });
      }
    } else if (status === 'completed') {
      for (const g of guests) {
        recordMovement(g, { status: arrivalStatus(t.kind), location: t.dropoff, transferId, by, note: 'Dropped off' });
      }
    }

    if (t.driver_id) {
      const driverStatus = status === 'en_route' || status === 'picked_up' ? 'on_duty' : 'available';
      run("UPDATE drivers SET status = ? WHERE id = ? AND status != 'off_duty'", driverStatus, t.driver_id);
    }
    if (t.vehicle_id) {
      const vehicleStatus = status === 'en_route' || status === 'picked_up' ? 'in_use' : 'available';
      run("UPDATE vehicles SET status = ? WHERE id = ? AND status != 'maintenance'", vehicleStatus, t.vehicle_id);
    }
  });
  return get('SELECT * FROM transfers WHERE id = ?', transferId);
}

/** Cascades flight status to passengers (departed → in flight, landed → landed). */
export function applyFlightStatus(flight, previousStatus, by) {
  if (flight.status === previousStatus) return;
  const passengers = all('SELECT guest_id FROM flight_passengers WHERE flight_id = ?', flight.id).map((r) => r.guest_id);
  const label = [flight.airline, flight.flight_number || flight.tail_number].filter(Boolean).join(' ');
  for (const g of passengers) {
    if (flight.direction === 'arrival' && flight.status === 'departed') {
      recordMovement(g, { status: 'in_flight', location: `${label} from ${flight.origin || '—'}`, by, note: 'Flight departed' });
    } else if (flight.direction === 'arrival' && flight.status === 'landed') {
      recordMovement(g, { status: 'landed', location: flight.terminal || flight.destination, by, note: `${label} landed` });
    } else if (flight.direction === 'departure' && flight.status === 'departed') {
      recordMovement(g, { status: 'departed', location: `${label} to ${flight.destination || '—'}`, by, note: 'Flight departed' });
    }
  }
}

export function badRequest(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}
export function notFound(msg = 'Not found') {
  return Object.assign(new Error(msg), { status: 404 });
}
