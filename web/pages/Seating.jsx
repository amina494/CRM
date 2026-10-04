import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Badge, Empty, Form, Loading, Modal, act, guestName, useApi } from '../components/ui.jsx';
import { CATEGORIES, RSVP } from '../constants.js';

const TABLE_FIELDS = [
  { name: 'name', label: 'Table name', required: true },
  { name: 'zone', label: 'Zone / area', placeholder: 'Stage, Royal, Main hall…' },
  { name: 'capacity', label: 'Seats', type: 'number', required: true },
  { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
];

export default function Seating() {
  const { event, canEdit } = useApp();
  const tables = useApi(`/events/${event.id}/tables`);
  const guests = useApi(`/events/${event.id}/guests`);
  const [modal, setModal] = useState(null);
  const [seatFor, setSeatFor] = useState(null);
  const close = () => setModal(null);
  const reload = () => { tables.reload(); guests.reload(); };

  if (!tables.data || !guests.data) return <Loading error={tables.error || guests.error} />;

  const unseated = guests.data.filter((g) => !g.table_id && g.rsvp_status !== 'declined');
  const seated = tables.data.reduce((n, t) => n + t.guests.length, 0);
  const capacity = tables.data.reduce((n, t) => n + t.capacity, 0);

  const assign = (guestId, tableId, seat) => act(async () => {
    await api.put(`/guests/${guestId}`, { table_id: tableId || null, seat_number: seat ?? null });
    reload();
  });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Seating</h1><p className="muted">{seated} seated of {capacity} seats · {unseated.length} not yet seated</p></div>
        {canEdit && <button className="btn btn-primary" onClick={() => setModal({ capacity: 10 })}>Add table</button>}
      </div>

      <div className="seating-layout">
        <aside className="card unseated">
          <h2>Not seated</h2>
          {!unseated.length ? <Empty>Everyone has a seat.</Empty> : (
            <ul className="list">
              {unseated.map((g) => (
                <li key={g.id} className={seatFor?.id === g.id ? 'selected' : ''}>
                  <div>
                    <Link to={`/guests/${g.id}`}>{g.party_lead_id ? '↳ ' : ''}{guestName(g)}</Link>
                    <div className="small"><Badge value={g.category} label={CATEGORIES[g.category]} /> <Badge value={g.rsvp_status} label={RSVP[g.rsvp_status]} /></div>
                  </div>
                  {canEdit && <button className="btn btn-ghost btn-sm right" onClick={() => setSeatFor(seatFor?.id === g.id ? null : g)}>{seatFor?.id === g.id ? 'Cancel' : 'Seat'}</button>}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="tables-grid">
          {seatFor && <div className="alert alert-info span-all">Choose a table for <strong>{guestName(seatFor)}</strong>.</div>}
          {!tables.data.length && <Empty>No tables yet.</Empty>}
          {tables.data.map((t) => {
            const full = t.guests.length >= t.capacity;
            return (
              <section key={t.id} className={`card table-card ${seatFor && !full ? 'droppable' : ''}`}
                onClick={() => {
                  if (!seatFor || full) return;
                  const used = new Set(t.guests.map((x) => String(x.seat_number)));
                  let seat = 1;
                  while (used.has(String(seat))) seat++;
                  assign(seatFor.id, t.id, String(seat));
                  setSeatFor(null);
                }}>
                <div className="card-head">
                  <div>
                    <h2>{t.name}</h2>
                    <div className="muted small">{t.zone}</div>
                  </div>
                  <span className={`badge tone-${full ? 'red' : 'gray'}`}>{t.guests.length}/{t.capacity}</span>
                </div>
                <ol className="seats">
                  {t.guests.map((g) => (
                    <li key={g.id}>
                      <span className="seat-no">{g.seat_number || '·'}</span>
                      <Link to={`/guests/${g.id}`} onClick={(e) => e.stopPropagation()}>{guestName(g)}</Link>
                      {canEdit && (
                        <span className="right seat-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="link small" onClick={() => {
                            const s = window.prompt('Seat number', g.seat_number || '');
                            if (s !== null) assign(g.id, t.id, s);
                          }}>seat</button>
                          <button className="link small danger" onClick={() => assign(g.id, null, null)}>remove</button>
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
                {canEdit && <button className="link small" onClick={(e) => { e.stopPropagation(); setModal(t); }}>Edit table</button>}
              </section>
            );
          })}
        </div>
      </div>

      {modal && (
        <Modal title={modal.id ? 'Edit table' : 'Add table'} onClose={close}>
          <Form initial={modal} fields={TABLE_FIELDS} onCancel={close} onSubmit={async (v) => {
            if (modal.id) await api.put(`/tables/${modal.id}`, v); else await api.post(`/events/${event.id}/tables`, v);
            reload(); close();
          }}>
            {modal.id && <button type="button" className="link small danger" onClick={() => act(async () => {
              await api.del(`/tables/${modal.id}`); reload(); close();
            })}>Delete table (guests become unseated)</button>}
          </Form>
        </Modal>
      )}
    </div>
  );
}
