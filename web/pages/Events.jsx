import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Empty, Form, Loading, Modal, act, fmtTime, useApi } from '../components/ui.jsx';

const FIELDS = [
  { name: 'name', label: 'Event name', required: true },
  { name: 'name_ar', label: 'Event name (Arabic)', dir: 'rtl' },
  { name: 'host_name', label: 'Hosted by', hint: 'Appears in the invitation: “… cordially invites you”' },
  { name: 'host_name_ar', label: 'Hosted by (Arabic)', dir: 'rtl' },
  { name: 'starts_at', label: 'Starts', type: 'datetime', required: true },
  { name: 'ends_at', label: 'Ends', type: 'datetime' },
  { name: 'rsvp_deadline', label: 'RSVP deadline', type: 'datetime' },
  { name: 'timezone', label: 'Time zone', placeholder: 'Asia/Riyadh', hint: 'All times are entered in this local time' },
  { name: 'venue', label: 'Venue' },
  { name: 'venue_ar', label: 'Venue (Arabic)', dir: 'rtl' },
  { name: 'venue_address', label: 'Venue address', span: 2 },
  { name: 'venue_lat', label: 'Venue latitude', type: 'number', step: 'any', hint: 'Lets the wallet pass pop up near the venue' },
  { name: 'venue_lng', label: 'Venue longitude', type: 'number', step: 'any' },
  { name: 'dress_code', label: 'Dress code' },
  { name: 'dress_code_ar', label: 'Dress code (Arabic)', dir: 'rtl' },
  { name: 'description', label: 'Description', type: 'textarea', span: 2 },
  { name: 'description_ar', label: 'Description (Arabic)', type: 'textarea', span: 2, dir: 'rtl' },
];

export default function Events() {
  const { events, event, setEventId, reloadEvents, isAdmin } = useApp();
  const [modal, setModal] = useState(null);
  const [retention, setRetention] = useState(null);
  const close = () => setModal(null);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Events</h1><p className="muted">Each event has its own guest list, seating, flights and trips. Hotels, cars, drivers and staff are shared.</p></div>
        {isAdmin && (
          <div className="link-row" style={{ marginTop: 0 }}>
            <Link className="btn btn-ghost" to="/events/import">Import from spreadsheet</Link>
            <button className="btn btn-primary" onClick={() => setModal({ timezone: 'Asia/Riyadh', retention_days: 90 })}>New event</button>
          </div>
        )}
      </div>
      {!events.length && <Empty>Create your first event to get started.</Empty>}
      <div className="event-cards">
        {events.map((e) => (
          <section key={e.id} className={`card event-card ${event?.id === e.id ? 'current' : ''}`}>
            <h2>{e.name}</h2>
            {e.name_ar && <div className="arabic muted">{e.name_ar}</div>}
            <p className="small">{fmtTime(e.starts_at)} · {e.venue || 'Venue TBC'}</p>
            <p className="small muted">{e.guest_count} guests · your role: {e.my_role}</p>
            {e.anonymised_at && <p className="small"><span className="badge tone-gray">Guest data removed {new Date(e.anonymised_at).toLocaleDateString('en-GB')}</span></p>}
            <div className="link-row">
              {event?.id === e.id ? <span className="badge tone-green">Current</span> : <button className="btn btn-ghost btn-sm" onClick={() => setEventId(e.id)}>Switch to this event</button>}
              {['admin', 'coordinator'].includes(e.my_role) && <button className="link small" onClick={() => setModal(e)}>Edit</button>}
              {['admin', 'coordinator'].includes(e.my_role) && !e.anonymised_at && <Link className="link small" to={`/events/${e.id}/design`}>Invitation design</Link>}
              {['admin', 'coordinator'].includes(e.my_role) && !e.anonymised_at && <button className="link small" onClick={() => setRetention(e)}>Data retention</button>}
              {isAdmin && <button className="link small danger" onClick={() => act(async () => {
                if (!window.confirm(`Delete “${e.name}” and its entire guest list? This cannot be undone.`)) return;
                await api.del(`/events/${e.id}`);
                await reloadEvents();
              })}>Delete</button>}
            </div>
          </section>
        ))}
      </div>
      {modal && (
        <Modal title={modal.id ? 'Edit event' : 'New event'} onClose={close} wide>
          <Form initial={modal} fields={isAdmin ? [...FIELDS, RETENTION_FIELD] : FIELDS} onCancel={close} onSubmit={async (v) => {
            if (modal.id) await api.put(`/events/${modal.id}`, v);
            else {
              const { id } = await api.post('/events', v);
              setEventId(id);
            }
            await reloadEvents();
            close();
          }} />
        </Modal>
      )}
      {retention && <RetentionModal event={retention} isAdmin={isAdmin} onClose={() => setRetention(null)} onDone={async () => { setRetention(null); await reloadEvents(); }} />}
    </div>
  );
}

const RETENTION_FIELD = {
  name: 'retention_days', label: 'Keep guest details for (days after the event)', type: 'number', span: 2,
  hint: 'After this, an admin can remove names, contact details, notes and messages. Counts are kept. Default 90.',
};

/** Shows when guest data is due for removal and lets an admin remove it. */
function RetentionModal({ event, isAdmin, onClose, onDone }) {
  const { data, error } = useApi(`/events/${event.id}/retention`);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/events/${event.id}/anonymise`, { confirm });
      await onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Data retention – ${event.name}`} onClose={onClose}>
      {!data ? <Loading error={error} /> : (
        <>
          <p>Guest details are kept for <strong>{data.retention_days} days</strong> after the event
            {data.due_at ? <>, so they can be removed from <strong>{new Date(data.due_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.</> : '. Set the event dates first.'}</p>
          <h3>What would be removed</h3>
          <ul className="small">
            <li>Names, email, phone, organisation, notes and RSVP messages of {data.would_remove.guests_personal_details} guests</li>
            <li>{data.would_remove.messages} sent messages and {data.would_remove.movements} movement records</li>
            <li>Details of {data.would_remove.activity_details} activity entries about these guests</li>
            <li>Invitation links and entrance codes stop working</li>
          </ul>
          <h3>What is kept</h3>
          <p className="small">{data.kept.join(', ')}.</p>
          {!data.is_due ? (
            <div className="alert alert-info">Not due yet. Nothing can be removed before the date above.</div>
          ) : !isAdmin ? (
            <div className="alert alert-info">This is due. An admin can remove the data.</div>
          ) : (
            <>
              <div className="alert alert-warn">This cannot be undone. Export the guest list first if you need a copy.</div>
              <label className="field"><span className="field-label">Type the event name <strong>{event.name}</strong> to confirm</span>
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
              {err && <div className="alert alert-error">{err}</div>}
              <div className="form-actions">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" disabled={busy || confirm.trim() !== event.name.trim()} onClick={run}>{busy ? 'Removing…' : 'Remove guest data'}</button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
