import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import GuestForm from '../components/GuestForm.jsx';
import { Badge, Empty, Form, Loading, Modal, ServiceBadge, act, fmtAgo, fmtTime, guestName, toOptions, useApi } from '../components/ui.jsx';
import {
  ACCOM_STATUS, CATEGORIES, FLIGHT_STATUS, GUEST_STATUS, INVITE, RSVP, TRANSFER_KIND, TRANSFER_STATUS,
} from '../constants.js';
import { SendInvitationsModal } from './Guests.jsx';

export default function GuestDetail() {
  const { id } = useParams();
  const { canEdit } = useApp();
  const navigate = useNavigate();
  const { data: g, error, reload } = useApi(`/guests/${id}`);
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);

  if (!g) return <Loading error={error} />;

  const copyLink = async () => {
    await navigator.clipboard?.writeText(g.invite_url);
    window.alert('Invitation link copied');
  };
  const remove = () => act(async () => {
    if (!window.confirm(`Delete ${guestName(g)}? This also removes their stays and history.`)) return;
    await api.del(`/guests/${g.id}`);
    navigate('/guests');
  });
  const checkIn = () => act(async () => { await api.post(`/guests/${g.id}/check-in`); reload(); });

  return (
    <div className="page">
      <Link to="/guests" className="link small">← All guests</Link>
      <div className="page-head">
        <div>
          <h1>{guestName(g)} {g.name_ar && <span className="arabic muted">{g.name_ar}</span>}</h1>
          <div className="badges">
            <Badge value={g.category} label={CATEGORIES[g.category]} />
            <Badge value={g.rsvp_status} label={`RSVP: ${RSVP[g.rsvp_status]}`} />
            <Badge value={g.current_status} label={GUEST_STATUS[g.current_status]} />
            {g.checked_in_at && <Badge tone="green" label={`Checked in ${fmtAgo(g.checked_in_at)}`} />}
          </div>
          <p className="muted">{[g.position, g.organization, g.nationality].filter(Boolean).join(' · ')}</p>
        </div>
        {canEdit && (
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => setModal('edit')}>Edit</button>
            <button className="btn btn-ghost" onClick={() => setModal('send')}>Send invitation</button>
            {!g.checked_in_at && <button className="btn btn-ghost" onClick={checkIn}>Check in</button>}
            <button className="btn btn-primary" onClick={() => setModal('status')}>Update location</button>
          </div>
        )}
      </div>

      <div className="grid-3">
        <section className="card">
          <h2>Contact</h2>
          <dl className="dl">
            <dt>Mobile</dt><dd>{g.phone ? <a href={`tel:${g.phone}`}>{g.phone}</a> : '—'}{g.phone && <> · <a href={`https://wa.me/${g.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a></>}</dd>
            <dt>Email</dt><dd>{g.email ? <a href={`mailto:${g.email}`}>{g.email}</a> : '—'}</dd>
            <dt>Language</dt><dd>{g.language === 'ar' ? 'Arabic' : 'English'}</dd>
            <dt>Dietary</dt><dd>{g.dietary || '—'}</dd>
            <dt>Host</dt><dd><strong>{g.host_name || <span className="warn">Unassigned</span>}</strong></dd>
          </dl>
          {g.notes && <div className="note">{g.notes}</div>}
        </section>

        <section className="card">
          <h2>Invitation & RSVP</h2>
          <dl className="dl">
            <dt>Invitation</dt><dd><Badge value={g.invite_status} label={INVITE[g.invite_status]} /> {g.invited_at && <span className="muted small">sent {fmtAgo(g.invited_at)}</span>}</dd>
            <dt>Opened</dt><dd>{g.opened_at ? fmtAgo(g.opened_at) : '—'}</dd>
            <dt>Response</dt><dd><Badge value={g.rsvp_status} label={RSVP[g.rsvp_status]} /> {g.rsvp_at && <span className="muted small">{fmtAgo(g.rsvp_at)}</span>}</dd>
            <dt>Party size</dt><dd>{g.rsvp_party_size ?? '—'} <span className="muted small">(+{g.plus_ones_allowed} allowed)</span></dd>
            {g.rsvp_message && <><dt>Message</dt><dd>“{g.rsvp_message}”</dd></>}
          </dl>
          <div className="link-row">
            <a className="btn btn-ghost btn-sm" href={g.invite_url} target="_blank" rel="noreferrer">Open invitation</a>
            <button className="btn btn-ghost btn-sm" onClick={copyLink}>Copy link</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal('preview')}>Preview message</button>
          </div>
        </section>

        <section className="card">
          <h2>Seating & transport</h2>
          <dl className="dl">
            <dt>Table</dt><dd>{g.table_name ? <strong>{g.table_name}{g.seat_number ? ` · seat ${g.seat_number}` : ''}</strong> : <span className="warn">Not seated</span>}</dd>
            <dt>Car</dt><dd>{g.vehicle_plate ? `${g.vehicle_plate} · ${g.vehicle_label}` : '—'}</dd>
            <dt>Driver</dt><dd>{g.driver_name ? <>{g.driver_name} {g.driver_phone && <a href={`tel:${g.driver_phone}`}>{g.driver_phone}</a>}</> : '—'}</dd>
          </dl>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Party</h2>
            {canEdit && !g.party_lead_id && <button className="btn btn-ghost btn-sm" onClick={() => setModal('companion')}>Add companion</button>}
          </div>
          {g.party_lead_id && <p className="small muted">Travelling with the party of <Link to={`/guests/${g.party_lead_id}`}>{g.lead_name}</Link> ({g.relationship || 'companion'})</p>}
          {!g.party.length ? <Empty>Travelling alone.</Empty> : (
            <ul className="list">
              {g.party.map((p) => (
                <li key={p.id}>
                  <Link to={`/guests/${p.id}`}>{guestName(p)}</Link>
                  <span className="muted small"> {p.party_lead_id ? p.relationship || 'Companion' : 'Party lead'}</span>
                  <span className="right"><Badge value={p.current_status} label={GUEST_STATUS[p.current_status]} /></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Where now</h2>
            <span className="muted small">{g.status_updated_at && `updated ${fmtAgo(g.status_updated_at)}`}</span>
          </div>
          <div className="now">
            <Badge value={g.current_status} label={GUEST_STATUS[g.current_status]} />
            <span>{g.current_location || ''}</span>
          </div>
          {!g.movements.length ? <Empty>No movements yet.</Empty> : (
            <ul className="timeline">
              {g.movements.map((m) => (
                <li key={m.id}>
                  <Badge value={m.status} label={GUEST_STATUS[m.status]} />
                  <span>{m.location}{m.note && <span className="muted"> – {m.note}</span>}</span>
                  <span className="muted small right">{m.recorded_by} · {new Date(m.recorded_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Accommodation</h2>
          {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ stay: {} })}>Add stay</button>}
        </div>
        {!g.accommodations.length ? <Empty>No hotel booked.</Empty> : (
          <table className="table compact">
            <thead><tr><th>Hotel</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Confirmation</th><th>Status</th><th /></tr></thead>
            <tbody>
              {g.accommodations.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.hotel_name}</strong><div className="muted small">{a.hotel_phone}</div></td>
                  <td>{a.room_number || '—'} <span className="muted small">{a.room_type}</span></td>
                  <td>{fmtTime(a.check_in)}</td>
                  <td>{fmtTime(a.check_out)}</td>
                  <td>{a.confirmation_no || '—'}</td>
                  <td><Badge value={a.status} label={ACCOM_STATUS[a.status]} /></td>
                  <td>{canEdit && <button className="link small" onClick={() => setModal({ stay: a })}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Flights</h2><Link to="/flights" className="link small">Manage flights</Link></div>
        {!g.flights.length ? <Empty>No flights recorded. Add one on the Flights page.</Empty> : (
          <table className="table compact">
            <thead><tr><th /><th>Flight</th><th>Route</th><th>Time</th><th>Service</th><th>Flying with</th><th>Status</th></tr></thead>
            <tbody>
              {g.flights.map((f) => (
                <tr key={f.id}>
                  <td>{f.direction === 'arrival' ? 'Arrival' : 'Departure'}</td>
                  <td><strong>{f.flight_number || f.tail_number}</strong><div className="muted small">{f.airline}</div></td>
                  <td className="small">{f.origin} → {f.destination}<div className="muted">{f.terminal}</div></td>
                  <td className="nowrap">{fmtTime(f.estimated_at || f.scheduled_at)}{f.estimated_at && f.estimated_at !== f.scheduled_at && <div className="muted small">sched. {fmtTime(f.scheduled_at)}</div>}</td>
                  <td><ServiceBadge type={f.service_type} /></td>
                  <td className="small">{[f.co_passengers, f.extra_passengers].filter(Boolean).join(', ') || '—'}</td>
                  <td><Badge value={f.status} label={FLIGHT_STATUS[f.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Trips</h2><Link to="/transfers" className="link small">Movements board</Link></div>
        {!g.transfers.length ? <Empty>No trips scheduled.</Empty> : (
          <table className="table compact">
            <thead><tr><th>Time</th><th>Trip</th><th>Car</th><th>Driver</th><th>Status</th></tr></thead>
            <tbody>
              {g.transfers.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap">{fmtTime(t.scheduled_at)}</td>
                  <td>{TRANSFER_KIND[t.kind]}<div className="muted small">{t.pickup} → {t.dropoff}</div></td>
                  <td className="small">{t.vehicle_plate || '—'}<div className="muted">{t.vehicle_label}</div></td>
                  <td className="small">{t.driver_name || '—'}<div className="muted">{t.driver_phone}</div></td>
                  <td><Badge value={t.status} label={TRANSFER_STATUS[t.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Messages</h2>
          {!g.messages.length ? <Empty>Nothing sent yet.</Empty> : (
            <ul className="list">
              {g.messages.map((m) => (
                <li key={m.id}>
                  <Badge tone={{ sent: 'green', logged: 'blue', failed: 'red' }[m.status]} label={`${m.channel}: ${m.status}`} />
                  <span className="small">{m.subject || m.body.slice(0, 50)}</span>
                  <span className="muted small right">{fmtAgo(m.sent_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Activity</h2>
          {!g.activity.length ? <Empty>No activity.</Empty> : (
            <ul className="list">
              {g.activity.map((a) => (
                <li key={a.id}>
                  <span className="small">{a.action.replace('.', ' ')}{a.details && <span className="muted"> – {a.details}</span>}</span>
                  <span className="muted small right">{a.actor} · {fmtAgo(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && <button className="link small danger mt" onClick={remove}>Delete guest</button>}
        </section>
      </div>

      {modal === 'edit' && (
        <Modal title={`Edit ${guestName(g)}`} onClose={close} wide>
          <GuestForm guest={g} onCancel={close} onSaved={() => { close(); reload(); }} />
        </Modal>
      )}
      {modal === 'companion' && (
        <Modal title={`Add companion to ${guestName(g)}`} onClose={close} wide>
          <GuestForm defaultLead={g.id} onCancel={close} onSaved={() => { close(); reload(); }} />
        </Modal>
      )}
      {modal === 'send' && <SendInvitationsModal ids={[g.id]} onClose={close} onDone={reload} />}
      {modal === 'preview' && <PreviewModal guestId={g.id} onClose={close} />}
      {modal === 'status' && <StatusModal guest={g} onClose={close} onDone={reload} />}
      {modal?.stay && <StayModal guest={g} stay={modal.stay} onClose={close} onDone={reload} />}
    </div>
  );
}

function PreviewModal({ guestId, onClose }) {
  const { data } = useApi(`/guests/${guestId}/invitation-preview`);
  return (
    <Modal title="Invitation preview" onClose={onClose} wide>
      {!data ? <Loading /> : (
        <>
          <p className="small muted">Subject: <strong>{data.subject}</strong></p>
          <h3>Email</h3>
          <iframe title="Email preview" className="email-preview" srcDoc={data.html} sandbox="" />
          <h3 className="mt">WhatsApp / SMS</h3>
          <pre className="message-preview">{data.text}</pre>
        </>
      )}
    </Modal>
  );
}

export function StatusModal({ guest, onClose, onDone }) {
  const fields = [
    { name: 'status', label: 'Status', type: 'select', options: GUEST_STATUS, required: true },
    { name: 'location', label: 'Location', placeholder: 'e.g. Ritz-Carlton lobby, Terminal 5' },
    { name: 'note', label: 'Note', type: 'textarea', span: 2 },
    ...(!guest.party_lead_id && guest.party.length ? [{ name: 'include_party', label: `Apply to whole party (${guest.party.length + 1} people)`, type: 'checkbox', span: 2 }] : []),
  ];
  return (
    <Modal title={`Update location – ${guestName(guest)}`} onClose={onClose}>
      <Form initial={{ status: guest.current_status, location: '', include_party: true }} fields={fields} submitLabel="Record"
        onCancel={onClose} onSubmit={async (v) => { await api.post(`/guests/${guest.id}/movements`, v); onDone(); onClose(); }} />
    </Modal>
  );
}

function StayModal({ guest, stay, onClose, onDone }) {
  const hotels = useApi('/hotels').data;
  if (!hotels) return null;
  const fields = [
    { name: 'hotel_id', label: 'Hotel', type: 'select', options: toOptions(hotels), required: true, span: 2, hint: hotels.length ? '' : 'Add hotels on the Accommodation page first' },
    { name: 'room_number', label: 'Room number' },
    { name: 'room_type', label: 'Room type', placeholder: 'Suite, Deluxe King…' },
    { name: 'check_in', label: 'Check-in', type: 'datetime' },
    { name: 'check_out', label: 'Check-out', type: 'datetime' },
    { name: 'confirmation_no', label: 'Confirmation no.' },
    { name: 'status', label: 'Status', type: 'select', options: ACCOM_STATUS, required: true },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  async function submit(v) {
    if (stay.id) await api.put(`/accommodations/${stay.id}`, v);
    else await api.post('/accommodations', { ...v, guest_id: guest.id });
    onDone();
    onClose();
  }
  return (
    <Modal title={stay.id ? 'Edit stay' : `Book a stay for ${guestName(guest)}`} onClose={onClose}>
      <Form initial={{ status: 'reserved', ...stay }} fields={fields} onSubmit={submit} onCancel={onClose}>
        {stay.id && (
          <button type="button" className="link small danger" onClick={() => act(async () => {
            await api.del(`/accommodations/${stay.id}`); onDone(); onClose();
          })}>Remove this stay</button>
        )}
      </Form>
    </Modal>
  );
}
