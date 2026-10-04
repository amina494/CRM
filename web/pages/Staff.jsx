import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Badge, Loading, Modal, act, useApi } from '../components/ui.jsx';

const EVENT_ROLES = { coordinator: 'Coordinator', liaison: 'Liaison / host', viewer: 'Viewer (read-only)' };
const ROLE_HELP = {
  coordinator: 'Everything on the event: guests, invitations, logistics, seating.',
  liaison: 'Only the guests they host or back up (and their companions).',
  viewer: 'Can look at the event but not change anything.',
};

export default function Staff() {
  const { isAdmin, me, events } = useApp();
  const { data, error, reload } = useApi('/users');
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);
  if (!data) return <Loading error={error} />;

  const resetCode = (u) => act(async () => {
    if (!window.confirm(`Clear ${u.name}'s one-time code? They will be signed out and asked to set up a new one (for example on a new phone).`)) return;
    await api.post(`/users/${u.id}/reset-totp`);
    reload();
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Staff</h1>
          <p className="muted">{isAdmin ? 'Give each person access to the events they work on, with a role per event.' : 'Colleagues on your events.'}</p>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setModal({ admin: false, active: true, memberships: [] })}>Add staff member</button>}
      </div>
      <section className="card">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Name</th>{isAdmin && <th>Email</th>}<th>Mobile</th><th>Access</th><th>Guests hosted</th>{isAdmin && <th>One-time code</th>}<th /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'dim'}>
                  <td><strong>{u.name}</strong>{!u.active && <span className="muted small"> (inactive)</span>}</td>
                  {isAdmin && <td>{u.email}</td>}
                  <td>{u.phone || '—'}</td>
                  <td>
                    {u.role === 'admin' ? <Badge tone="gold" label="Admin – all events" /> : u.memberships.length ? (
                      <div className="badges">{u.memberships.map((m) => <Badge key={m.event_id} tone="gray" label={`${m.event_name}: ${EVENT_ROLES[m.role].split(' ')[0]}`} />)}</div>
                    ) : <span className="muted small">No events</span>}
                  </td>
                  <td>{u.guest_count ? <Link to={`/guests?host=${u.id}`}>{u.guest_count} guests</Link> : '—'}</td>
                  {isAdmin && <td>{u.totp_enabled ? <Badge tone="green" label="On" /> : <span className="muted small">Off</span>}</td>}
                  <td className="row-actions">
                    {isAdmin && u.totp_enabled ? <button className="link small" onClick={() => resetCode(u)}>Reset code</button> : null}
                    {isAdmin && <button className="link small" onClick={() => setModal({ ...u, admin: u.role === 'admin', active: Boolean(u.active) })}>Edit</button>}
                    {!isAdmin && u.id === me.id && <Link className="link small" to="/security">Change password</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {modal && <StaffModal person={modal} events={events} self={modal.id === me.id} onClose={close} onSaved={() => { reload(); close(); }} />}
    </div>
  );
}

function StaffModal({ person, events, self, onClose, onSaved }) {
  const editing = Boolean(person.id);
  const [v, setV] = useState({
    name: person.name || '', email: person.email || '', phone: person.phone || '', admin: person.admin, active: person.active,
    password: '', current_password: '',
    access: Object.fromEntries((person.memberships || []).map((m) => [m.event_id, m.role])),
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const setAccess = (eventId, role) => setV((s) => ({ ...s, access: { ...s.access, [eventId]: role } }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: v.name, email: v.email, phone: v.phone, role: v.admin ? 'admin' : 'staff', active: v.active,
      memberships: v.admin ? [] : Object.entries(v.access).filter(([, role]) => role).map(([eventId, role]) => ({ event_id: Number(eventId), role })),
    };
    if (v.password) body.password = v.password;
    if (v.password && self) body.current_password = v.current_password;
    try {
      if (editing) await api.put(`/users/${person.id}`, body); else await api.post('/users', body);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Edit ${person.name}` : 'Add staff member'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span className="field-label">Full name</span><input required value={v.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="field"><span className="field-label">Email (used to sign in)</span><input type="email" required value={v.email} onChange={(e) => set('email', e.target.value)} /></label>
          <label className="field"><span className="field-label">Mobile</span><input value={v.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <label className="field"><span className="field-label">{editing ? 'New password (leave blank to keep)' : 'Password (8+ characters)'}</span>
            <input type="password" required={!editing} minLength={8} autoComplete="new-password" value={v.password} onChange={(e) => set('password', e.target.value)} /></label>
          {self && v.password && (
            <label className="field span-2"><span className="field-label">Your current password</span>
              <input type="password" required autoComplete="current-password" value={v.current_password} onChange={(e) => set('current_password', e.target.value)} /></label>
          )}
          <label className="field checkbox-field span-2">
            <span><input type="checkbox" checked={v.admin} disabled={self} onChange={(e) => set('admin', e.target.checked)} /> Administrator</span>
            <span className="field-hint">Admins see every event, manage staff, delete guests and events, and can read the audit trail.</span>
          </label>
          {editing && !self && (
            <label className="field checkbox-field span-2">
              <span><input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Account active</span>
              <span className="field-hint">Turning this off signs the person out everywhere.</span>
            </label>
          )}
        </div>

        {!v.admin && (
          <div>
            <h3>Event access</h3>
            {!events.length && <p className="muted small">Create an event first.</p>}
            <div className="access-list">
              {events.map((e) => (
                <div key={e.id} className="access-row">
                  <span className="access-event">{e.name}</span>
                  <select value={v.access[e.id] || ''} onChange={(ev) => setAccess(e.id, ev.target.value)}>
                    <option value="">No access</option>
                    {Object.entries(EVENT_ROLES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                  <span className="muted small">{ROLE_HELP[v.access[e.id]] || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
