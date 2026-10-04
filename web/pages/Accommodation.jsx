import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Badge, Empty, Form, Loading, Modal, act, fmtTime, guestName, toOptions, useApi } from '../components/ui.jsx';
import { ACCOM_STATUS, GUEST_STATUS } from '../constants.js';

const HOTEL_FIELDS = [
  { name: 'name', label: 'Hotel name', required: true, span: 2 },
  { name: 'address', label: 'Address', span: 2 },
  { name: 'phone', label: 'Phone' },
  { name: 'contact_person', label: 'Contact person' },
  { name: 'contact_phone', label: 'Contact phone' },
  { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
];

export default function Accommodation() {
  const { event, canEdit } = useApp();
  const hotels = useApi('/hotels');
  const stays = useApi(`/events/${event.id}/accommodations`);
  const guests = useApi(`/events/${event.id}/guests`).data;
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);
  const reload = () => { hotels.reload(); stays.reload(); };

  if (!hotels.data || !stays.data) return <Loading error={hotels.error || stays.error} />;

  const housed = new Set(stays.data.filter((s) => s.status !== 'cancelled').map((s) => s.guest_id));
  const unhoused = (guests || []).filter((g) => g.rsvp_status === 'attending' && !housed.has(g.id));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Accommodation</h1><p className="muted">Rooming list for {event.name}</p></div>
        {canEdit && (
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => setModal({ hotel: {} })}>Add hotel</button>
            <button className="btn btn-primary" onClick={() => setModal({ stay: {} })} disabled={!hotels.data.length}>Book a room</button>
          </div>
        )}
      </div>

      {unhoused.length > 0 && (
        <div className="alert alert-warn">
          <strong>{unhoused.length} attending guests have no room:</strong>{' '}
          {unhoused.map((g, i) => (
            <span key={g.id}>{i > 0 && ', '}<button className="link" onClick={() => setModal({ stay: { guest_id: g.id } })}>{guestName(g)}</button></span>
          ))}
        </div>
      )}

      {!hotels.data.length && <Empty>Add the hotels you are using first.</Empty>}
      {hotels.data.map((h) => {
        const rows = stays.data.filter((s) => s.hotel_id === h.id);
        return (
          <section className="card" key={h.id}>
            <div className="card-head">
              <div>
                <h2>{h.name}</h2>
                <div className="muted small">{[h.address, h.phone, h.contact_person && `${h.contact_person} ${h.contact_phone || ''}`].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="actions">
                <span className="muted small">{rows.filter((r) => r.status !== 'cancelled').length} guests</span>
                {canEdit && <button className="link small" onClick={() => setModal({ hotel: h })}>Edit hotel</button>}
              </div>
            </div>
            {!rows.length ? <Empty>No bookings.</Empty> : (
              <table className="table compact">
                <thead><tr><th>Room</th><th>Guest</th><th>Host</th><th>Check-in</th><th>Check-out</th><th>Conf.</th><th>Booking</th><th>Guest now</th><th /></tr></thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.room_number || '—'}</strong><div className="muted small">{s.room_type}</div></td>
                      <td><Link to={`/guests/${s.guest_id}`}>{s.party_lead_id ? '↳ ' : ''}{guestName(s)}</Link></td>
                      <td className="small">{s.host_name || '—'}</td>
                      <td className="nowrap">{fmtTime(s.check_in)}</td>
                      <td className="nowrap">{fmtTime(s.check_out)}</td>
                      <td className="small">{s.confirmation_no || '—'}</td>
                      <td>
                        {canEdit ? (
                          <select className="inline-select" value={s.status} onChange={(e) => act(async () => { await api.put(`/accommodations/${s.id}`, { status: e.target.value }); reload(); })}>
                            {Object.entries(ACCOM_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        ) : <Badge value={s.status} label={ACCOM_STATUS[s.status]} />}
                      </td>
                      <td><Badge value={s.current_status} label={GUEST_STATUS[s.current_status]} /></td>
                      <td>{canEdit && <button className="link small" onClick={() => setModal({ stay: s })}>Edit</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      {modal?.hotel && (
        <Modal title={modal.hotel.id ? 'Edit hotel' : 'Add hotel'} onClose={close}>
          <Form initial={modal.hotel} fields={HOTEL_FIELDS} onCancel={close} onSubmit={async (v) => {
            if (modal.hotel.id) await api.put(`/hotels/${modal.hotel.id}`, v); else await api.post('/hotels', v);
            reload(); close();
          }}>
            {modal.hotel.id && <button type="button" className="link small danger" onClick={() => act(async () => {
              if (!window.confirm('Delete this hotel and all its bookings?')) return;
              await api.del(`/hotels/${modal.hotel.id}`); reload(); close();
            })}>Delete hotel</button>}
          </Form>
        </Modal>
      )}
      {modal?.stay && guests && (
        <Modal title={modal.stay.id ? 'Edit booking' : 'Book a room'} onClose={close}>
          <Form initial={{ status: 'reserved', check_in: event.starts_at?.slice(0, 10) ? `${event.starts_at.slice(0, 10)}T14:00` : '', ...modal.stay }}
            fields={[
              { name: 'guest_id', label: 'Guest', type: 'select', required: true, span: 2, options: toOptions(guests, (g) => `${g.party_lead_id ? '↳ ' : ''}${guestName(g)}`) },
              { name: 'hotel_id', label: 'Hotel', type: 'select', required: true, span: 2, options: toOptions(hotels.data) },
              { name: 'room_number', label: 'Room number', hint: 'Use the same room for guests sharing' },
              { name: 'room_type', label: 'Room type' },
              { name: 'check_in', label: 'Check-in', type: 'datetime' },
              { name: 'check_out', label: 'Check-out', type: 'datetime' },
              { name: 'confirmation_no', label: 'Confirmation no.' },
              { name: 'status', label: 'Status', type: 'select', options: ACCOM_STATUS, required: true },
              { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
            ]}
            onCancel={close}
            onSubmit={async (v) => {
              if (modal.stay.id) await api.put(`/accommodations/${modal.stay.id}`, v); else await api.post('/accommodations', v);
              reload(); close();
            }}>
            {modal.stay.id && <button type="button" className="link small danger" onClick={() => act(async () => {
              await api.del(`/accommodations/${modal.stay.id}`); reload(); close();
            })}>Remove booking</button>}
          </Form>
        </Modal>
      )}
    </div>
  );
}
