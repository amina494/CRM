import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Badge, Empty, Form, GuestPicker, Loading, Modal, ServiceBadge, act, fmtAgo, fmtTime, guestName, toOptions, useApi } from '../components/ui.jsx';
import { TONE, GUEST_STATUS, TRANSFER_KIND, TRANSFER_STATUS } from '../constants.js';

const NEXT = { scheduled: ['en_route', 'Driver en route'], en_route: ['picked_up', 'Picked up'], picked_up: ['completed', 'Dropped off'] };
const localToday = () => new Date().toLocaleDateString('en-CA');

export default function Transfers() {
  const { event, canEdit, can } = useApp();
  const [date, setDate] = useState(localToday());
  const transfers = useApi(`/events/${event.id}/transfers${date ? `?date=${date}` : ''}`, { poll: 20000 });
  const guests = useApi(`/events/${event.id}/guests`).data;
  const flights = useApi(`/events/${event.id}/flights`).data;
  const vehicles = useApi('/vehicles').data;
  const drivers = useApi('/drivers').data;
  const [modal, setModal] = useState(null);
  const [warning, setWarning] = useState(null);
  const close = () => setModal(null);

  const shift = (days) => {
    const d = new Date(`${date || localToday()}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(d.toLocaleDateString('en-CA'));
  };
  const setStatus = (t, status) => act(async () => {
    await api.post(`/transfers/${t.id}/status`, { status });
    transfers.reload();
  });

  const ready = guests && flights && vehicles && drivers;
  const fields = ready ? [
    { name: 'kind', label: 'Trip type', type: 'select', options: TRANSFER_KIND, required: true },
    { name: 'scheduled_at', label: 'Pickup time', type: 'datetime', required: true },
    { name: 'pickup', label: 'Pickup location', placeholder: 'RUH Executive Terminal' },
    { name: 'dropoff', label: 'Drop-off location', placeholder: 'Hotel, venue…' },
    { name: 'vehicle_id', label: 'Car', type: 'select', options: toOptions(vehicles, (v) => `${v.plate} · ${v.make || ''} ${v.model || ''} (${v.capacity} seats)`) },
    { name: 'driver_id', label: 'Driver', type: 'select', options: toOptions(drivers, (d) => `${d.name}${d.status === 'off_duty' ? ' (off duty)' : ''}`) },
    { name: 'flight_id', label: 'Linked flight', type: 'select', span: 2, options: toOptions(flights, (f) => `${f.direction === 'arrival' ? '↓' : '↑'} ${f.flight_number || f.tail_number || 'Flight'} · ${fmtTime(f.estimated_at || f.scheduled_at)} · ${f.service_type}`) },
    { name: 'notes', label: 'Notes for driver', type: 'textarea', span: 2 },
  ] : [];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Movements</h1><p className="muted">Every trip, car and driver – updates live as drivers report in</p></div>
        <div className="actions">
          <div className="segmented">
            <button onClick={() => shift(-1)} disabled={!date}>‹</button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button onClick={() => shift(1)} disabled={!date}>›</button>
            <button className={!date ? 'on' : ''} onClick={() => setDate(date ? '' : localToday())}>{date ? 'All days' : 'One day'}</button>
          </div>
          {canEdit && <button className="btn btn-primary" disabled={!ready} onClick={() => setModal({ kind: 'airport_pickup', scheduled_at: `${date || localToday()}T09:00`, passenger_ids: [] })}>Schedule trip</button>}
        </div>
      </div>

      {warning && <div className="alert alert-warn">{warning} <button className="link" onClick={() => setWarning(null)}>dismiss</button></div>}

      {!transfers.data ? <Loading error={transfers.error} /> : !transfers.data.length ? <Empty>No trips {date ? 'on this day' : 'scheduled'}.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Time</th><th>Trip</th><th>Passengers</th><th>Flight</th><th>Car</th><th>Driver</th><th>Status</th><th /></tr></thead>
            <tbody>
              {transfers.data.map((t) => (
                <tr key={t.id} className={t.status === 'cancelled' ? 'dim' : ''}>
                  <td className="nowrap"><strong>{t.scheduled_at?.slice(11, 16)}</strong>{!date && <div className="muted small">{fmtTime(t.scheduled_at).split(' ').slice(0, 2).join(' ')}</div>}</td>
                  <td>{TRANSFER_KIND[t.kind]}<div className="muted small">{t.pickup || '?'} → {t.dropoff || '?'}</div></td>
                  <td className="small">
                    {t.passengers.map((p) => (
                      <div key={p.id} className="nowrap"><Link to={`/guests/${p.id}`}>{guestName(p)}</Link> <span className={`dot tone-${TONE[p.current_status]}`} title={GUEST_STATUS[p.current_status]} /></div>
                    ))}
                  </td>
                  <td className="small">
                    {t.flight_number ? <><strong>{t.flight_number}</strong> <ServiceBadge type={t.flight_service} /><div className="muted">{t.flight_time?.slice(11, 16)} · {t.flight_status}</div></> : '—'}
                  </td>
                  <td className="small">{t.vehicle_plate || <span className="warn">No car</span>}<div className="muted">{t.vehicle_label}</div></td>
                  <td className="small">
                    {t.driver_name ? <>{t.driver_name}<div>{t.driver_phone && <a href={`tel:${t.driver_phone}`}>{t.driver_phone}</a>}</div>
                      {t.driver_lat != null && <a className="muted" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${t.driver_lat},${t.driver_lng}`}>📍 {fmtAgo(t.driver_seen_at)}</a>}</>
                      : <span className="warn">No driver</span>}
                  </td>
                  <td>
                    <Badge value={t.status} label={TRANSFER_STATUS[t.status]} />
                    <div className="muted small">
                      {t.completed_at ? `done ${fmtAgo(t.completed_at)}` : t.picked_up_at ? `picked up ${fmtAgo(t.picked_up_at)}` : t.started_at ? `left ${fmtAgo(t.started_at)}` : ''}
                    </div>
                  </td>
                  <td className="row-actions">
                    {can.handle && NEXT[t.status] && <button className="btn btn-primary btn-sm" onClick={() => setStatus(t, NEXT[t.status][0])}>{NEXT[t.status][1]}</button>}
                    {canEdit && <button className="link small" onClick={() => setModal({ ...t, passenger_ids: t.passengers.map((p) => p.id) })}>Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && ready && (
        <Modal title={modal.id ? 'Edit trip' : 'Schedule trip'} onClose={close} wide>
          <Form initial={modal} fields={fields} onCancel={close}
            extra={(v, set) => (
              <div className="field span-2">
                <span className="field-label">
                  Passengers
                  {v.flight_id && <button type="button" className="link small" onClick={() => {
                    const f = flights.find((x) => x.id === Number(v.flight_id));
                    if (f) set('passenger_ids', f.passengers.map((p) => p.id));
                  }}> · copy from flight</button>}
                  {v.passenger_ids?.length === 1 && <button type="button" className="link small" onClick={() => {
                    const g = guests.find((x) => x.id === Number(v.passenger_ids[0]));
                    if (g?.vehicle_id) set('vehicle_id', g.vehicle_id);
                    if (g?.driver_id) set('driver_id', g.driver_id);
                  }}> · use guest’s dedicated car & driver</button>}
                </span>
                <GuestPicker guests={guests} value={v.passenger_ids} onChange={(ids) => set('passenger_ids', ids)} />
              </div>
            )}
            onSubmit={async (v) => {
              const r = modal.id ? await api.put(`/transfers/${modal.id}`, v) : await api.post(`/events/${event.id}/transfers`, v);
              if (r.conflicts?.length) {
                setWarning(`Heads up: this car or driver has ${r.conflicts.length} other trip(s) within an hour (${r.conflicts.map((c) => c.scheduled_at.slice(11, 16)).join(', ')}).`);
              }
              transfers.reload(); close();
            }}>
            {modal.id && (
              <div className="link-row">
                {modal.status !== 'cancelled' && <button type="button" className="link small danger" onClick={() => { setStatus(modal, 'cancelled'); close(); }}>Cancel trip</button>}
                <button type="button" className="link small danger" onClick={() => act(async () => {
                  if (!window.confirm('Delete this trip?')) return;
                  await api.del(`/transfers/${modal.id}`); transfers.reload(); close();
                })}>Delete</button>
              </div>
            )}
          </Form>
        </Modal>
      )}
    </div>
  );
}
