import { useState } from 'react';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Empty, Form, Modal, act, fmtTime } from '../components/ui.jsx';

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
  const { events, event, setEventId, reloadEvents, isAdmin, canEdit } = useApp();
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Events</h1><p className="muted">Each event has its own guest list, seating, flights and trips. Hotels, cars, drivers and staff are shared.</p></div>
        {canEdit && <button className="btn btn-primary" onClick={() => setModal({ timezone: 'Asia/Riyadh' })}>New event</button>}
      </div>
      {!events.length && <Empty>Create your first event to get started.</Empty>}
      <div className="event-cards">
        {events.map((e) => (
          <section key={e.id} className={`card event-card ${event?.id === e.id ? 'current' : ''}`}>
            <h2>{e.name}</h2>
            {e.name_ar && <div className="arabic muted">{e.name_ar}</div>}
            <p className="small">{fmtTime(e.starts_at)} · {e.venue || 'Venue TBC'}</p>
            <p className="small muted">{e.guest_count} guests</p>
            <div className="link-row">
              {event?.id === e.id ? <span className="badge tone-green">Current</span> : <button className="btn btn-ghost btn-sm" onClick={() => setEventId(e.id)}>Switch to this event</button>}
              {canEdit && <button className="link small" onClick={() => setModal(e)}>Edit</button>}
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
          <Form initial={modal} fields={FIELDS} onCancel={close} onSubmit={async (v) => {
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
    </div>
  );
}
