import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Badge, Form, Loading, Modal, useApi } from '../components/ui.jsx';
import { ROLES } from '../constants.js';

export default function Staff() {
  const { isAdmin, me } = useApp();
  const { data, error, reload } = useApi('/users');
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);
  if (!data) return <Loading error={error} />;

  const fields = (editing) => [
    { name: 'name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Mobile' },
    { name: 'role', label: 'Role', type: 'select', options: ROLES, required: true },
    { name: 'password', label: editing ? 'New password (leave blank to keep)' : 'Password', type: 'password', required: !editing },
    editing && { name: 'active', label: 'Active', type: 'checkbox' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Staff</h1><p className="muted">Hosts, liaisons and coordinators. Liaisons are assigned to look after specific guests.</p></div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setModal({ role: 'liaison' })}>Add staff member</button>}
      </div>
      <section className="card">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th>Guests assigned</th><th /></tr></thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'dim'}>
                <td><strong>{u.name}</strong>{!u.active && <span className="muted small"> (inactive)</span>}</td>
                <td>{u.email}</td>
                <td>{u.phone || '—'}</td>
                <td><Badge tone={u.role === 'admin' ? 'gold' : 'gray'} label={ROLES[u.role]} /></td>
                <td>{u.guest_count ? <Link to={`/guests?host=${u.id}`}>{u.guest_count} guests</Link> : '—'}</td>
                <td>{(isAdmin || u.id === me.id) && <button className="link small" onClick={() => setModal(u)}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {modal && (
        <Modal title={modal.id ? `Edit ${modal.name}` : 'Add staff member'} onClose={close}>
          <Form initial={{ ...modal, active: modal.id ? Boolean(modal.active) : true }} fields={fields(Boolean(modal.id))} onCancel={close}
            onSubmit={async (v) => {
              const body = { ...v };
              if (!body.password) delete body.password;
              if (modal.id) await api.put(`/users/${modal.id}`, body); else await api.post('/users', body);
              reload(); close();
            }} />
        </Modal>
      )}
    </div>
  );
}
