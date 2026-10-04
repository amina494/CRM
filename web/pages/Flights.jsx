import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Badge, Empty, Form, GuestPicker, Loading, Modal, ServiceBadge, act, fmtTime, guestName, useApi } from '../components/ui.jsx';
import { FLIGHT_STATUS, GUEST_STATUS, SERVICE, TONE } from '../constants.js';

const FIELDS = [
  { name: 'direction', label: 'Direction', type: 'select', options: { arrival: 'Arrival', departure: 'Departure' }, required: true },
  { name: 'service_type', label: 'Service', type: 'select', options: SERVICE, required: true, hint: 'Tanfeethi = executive / private terminal with protocol handling' },
  { name: 'airline', label: 'Airline / operator', placeholder: 'Saudia, Private (G650)…' },
  { name: 'flight_number', label: 'Flight number', placeholder: 'SV 123' },
  { name: 'tail_number', label: 'Tail number (private)', placeholder: 'HZ-ABC' },
  { name: 'terminal', label: 'Terminal', placeholder: 'Terminal 5, Executive terminal…' },
  { name: 'origin', label: 'From' },
  { name: 'destination', label: 'To' },
  { name: 'scheduled_at', label: 'Scheduled (local)', type: 'datetime' },
  { name: 'estimated_at', label: 'Estimated / actual', type: 'datetime' },
  { name: 'status', label: 'Status', type: 'select', options: FLIGHT_STATUS, required: true, hint: 'Departed / landed updates every passenger’s location' },
  { name: 'extra_passengers', label: 'Others on board (not on guest list)', placeholder: 'Security detail ×2, crew…' },
  { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
];

export default function Flights() {
  const { event, canEdit } = useApp();
  const flights = useApi(`/events/${event.id}/flights`, { poll: 60000 });
  const guests = useApi(`/events/${event.id}/guests`).data;
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState('arrival');
  const close = () => setModal(null);

  if (!flights.data) return <Loading error={flights.error} />;
  const list = flights.data.filter((f) => !filter || f.direction === filter);

  const quickStatus = (f, status) => act(async () => {
    await api.put(`/flights/${f.id}`, { status });
    flights.reload();
  });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Flights</h1><p className="muted">Arrivals and departures, Tanfeethi and general</p></div>
        <div className="actions">
          <div className="segmented">
            {[['arrival', 'Arrivals'], ['departure', 'Departures'], ['', 'All']].map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          {canEdit && <button className="btn btn-primary" onClick={() => setModal({ direction: filter || 'arrival', service_type: 'general', status: 'scheduled', destination: filter === 'departure' ? '' : 'Riyadh (RUH)', passenger_ids: [] })}>Add flight</button>}
        </div>
      </div>

      {!list.length ? <Empty>No flights yet.</Empty> : (
        <div className="flight-list">
          {list.map((f) => (
            <section className={`card flight ${f.service_type}`} key={f.id}>
              <div className="flight-main">
                <div className="flight-time">
                  <div className="big">{(f.estimated_at || f.scheduled_at)?.slice(11, 16) || '—'}</div>
                  <div className="muted small">{fmtTime(f.estimated_at || f.scheduled_at).split(' ').slice(0, 2).join(' ')}</div>
                  {f.estimated_at && f.scheduled_at && f.estimated_at !== f.scheduled_at && <div className="small warn">sched. {f.scheduled_at.slice(11, 16)}</div>}
                </div>
                <div className="flight-info">
                  <div className="flight-title">
                    <strong>{f.flight_number || f.tail_number || 'Flight'}</strong>
                    <span className="muted">{f.airline}</span>
                    <ServiceBadge type={f.service_type} />
                    <Badge value={f.status} label={FLIGHT_STATUS[f.status]} />
                  </div>
                  <div className="small">{f.origin || '—'} → {f.destination || '—'} {f.terminal && <span className="muted">· {f.terminal}</span>}</div>
                  <div className="passengers">
                    {f.passengers.map((p) => (
                      <Link key={p.id} to={`/guests/${p.id}`} className="chip">
                        {guestName(p)} <span className={`dot tone-${TONE[p.current_status]}`} title={GUEST_STATUS[p.current_status]} />
                      </Link>
                    ))}
                    {f.extra_passengers && <span className="chip muted">{f.extra_passengers}</span>}
                    {!f.passengers.length && !f.extra_passengers && <span className="muted small">No passengers</span>}
                  </div>
                </div>
                {canEdit && (
                  <div className="flight-actions">
                    {f.status === 'scheduled' || f.status === 'delayed' ? <button className="btn btn-ghost btn-sm" onClick={() => quickStatus(f, 'departed')}>Departed</button> : null}
                    {f.direction === 'arrival' && f.status !== 'landed' && f.status !== 'cancelled' && <button className="btn btn-primary btn-sm" onClick={() => quickStatus(f, 'landed')}>Landed</button>}
                    <button className="link small" onClick={() => setModal({ ...f, passenger_ids: f.passengers.map((p) => p.id) })}>Edit</button>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {modal && guests && (
        <Modal title={modal.id ? 'Edit flight' : 'Add flight'} onClose={close} wide>
          <Form initial={modal} fields={FIELDS} onCancel={close}
            extra={(v, set) => (
              <div className="field span-2">
                <span className="field-label">Passengers (who is flying together)</span>
                <GuestPicker guests={guests} value={v.passenger_ids} onChange={(ids) => set('passenger_ids', ids)} />
              </div>
            )}
            onSubmit={async (v) => {
              if (modal.id) await api.put(`/flights/${modal.id}`, v); else await api.post(`/events/${event.id}/flights`, v);
              flights.reload(); close();
            }}>
            {modal.id && <button type="button" className="link small danger" onClick={() => act(async () => {
              if (!window.confirm('Delete this flight?')) return;
              await api.del(`/flights/${modal.id}`); flights.reload(); close();
            })}>Delete flight</button>}
          </Form>
        </Modal>
      )}
    </div>
  );
}
