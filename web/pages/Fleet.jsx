import { useState } from 'react';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Badge, Empty, Form, Loading, Modal, act, fmtAgo, useApi } from '../components/ui.jsx';
import { DRIVER_STATUS, VEHICLE_STATUS, VEHICLE_TYPES } from '../constants.js';

const VEHICLE_FIELDS = [
  { name: 'plate', label: 'Plate', required: true },
  { name: 'type', label: 'Type', type: 'select', options: VEHICLE_TYPES, required: true },
  { name: 'make', label: 'Make' },
  { name: 'model', label: 'Model' },
  { name: 'color', label: 'Colour' },
  { name: 'capacity', label: 'Passenger seats', type: 'number', required: true },
  { name: 'status', label: 'Status', type: 'select', options: VEHICLE_STATUS, required: true },
  { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
];
const DRIVER_FIELDS = [
  { name: 'name', label: 'Name', required: true },
  { name: 'phone', label: 'Mobile', placeholder: '+9665…' },
  { name: 'license_no', label: 'Licence no.' },
  { name: 'languages', label: 'Languages' },
  { name: 'status', label: 'Status', type: 'select', options: DRIVER_STATUS, required: true },
  { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
];

export default function Fleet() {
  const { canEdit } = useApp();
  const vehicles = useApi('/vehicles');
  const drivers = useApi('/drivers', { poll: 30000 });
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);

  if (!vehicles.data || !drivers.data) return <Loading error={vehicles.error || drivers.error} />;

  const save = async (kind, v) => {
    const id = modal.data.id;
    if (id) await api.put(`/${kind}/${id}`, v); else await api.post(`/${kind}`, v);
    (kind === 'vehicles' ? vehicles : drivers).reload();
    close();
  };
  const copy = async (text) => { await navigator.clipboard?.writeText(text); window.alert('Link copied'); };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Cars & drivers</h1><p className="muted">Each driver gets a private mobile link to see their trips and report pickups and drop-offs.</p></div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Drivers</h2>
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'drivers', data: { status: 'available' } })}>Add driver</button>}
        </div>
        {!drivers.data.length ? <Empty>No drivers yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Driver</th><th>Mobile</th><th>Languages</th><th>Dedicated to</th><th>Last location</th><th>Status</th><th>Driver link</th><th /></tr></thead>
            <tbody>
              {drivers.data.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong><div className="muted small">{d.license_no}</div></td>
                  <td>{d.phone ? <a href={`tel:${d.phone}`}>{d.phone}</a> : '—'}</td>
                  <td className="small">{d.languages || '—'}</td>
                  <td className="small">{d.dedicated_guests ? `${d.dedicated_guests} guest(s)` : '—'}</td>
                  <td className="small">{d.last_lat != null ? <a target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${d.last_lat},${d.last_lng}`}>📍 {fmtAgo(d.last_seen_at)}</a> : '—'}</td>
                  <td><Badge value={d.status} label={DRIVER_STATUS[d.status]} /></td>
                  <td className="nowrap">
                    <button className="link small" onClick={() => copy(d.portal_url)}>Copy</button>
                    {d.phone && <> · <a className="link small" target="_blank" rel="noreferrer"
                      href={`https://wa.me/${d.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Your trip sheet: ${d.portal_url}`)}`}>WhatsApp</a></>}
                    {' · '}<a className="link small" href={d.portal_url} target="_blank" rel="noreferrer">Open</a>
                  </td>
                  <td>{canEdit && <button className="link small" onClick={() => setModal({ kind: 'drivers', data: d })}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Cars</h2>
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'vehicles', data: { type: 'sedan', capacity: 3, status: 'available' } })}>Add car</button>}
        </div>
        {!vehicles.data.length ? <Empty>No cars yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Plate</th><th>Car</th><th>Type</th><th>Seats</th><th>Status</th><th>Notes</th><th /></tr></thead>
            <tbody>
              {vehicles.data.map((v) => (
                <tr key={v.id}>
                  <td><strong>{v.plate}</strong></td>
                  <td>{[v.color, v.make, v.model].filter(Boolean).join(' ')}</td>
                  <td>{VEHICLE_TYPES[v.type]}</td>
                  <td>{v.capacity}</td>
                  <td><Badge value={v.status} label={VEHICLE_STATUS[v.status]} /></td>
                  <td className="small muted">{v.notes}</td>
                  <td>{canEdit && <button className="link small" onClick={() => setModal({ kind: 'vehicles', data: v })}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {modal && (
        <Modal title={`${modal.data.id ? 'Edit' : 'Add'} ${modal.kind === 'vehicles' ? 'car' : 'driver'}`} onClose={close}>
          <Form initial={modal.data} fields={modal.kind === 'vehicles' ? VEHICLE_FIELDS : DRIVER_FIELDS} onCancel={close}
            onSubmit={(v) => save(modal.kind, v)}>
            {modal.data.id && (
              <div className="link-row">
                {modal.kind === 'drivers' && <button type="button" className="link small" onClick={() => act(async () => {
                  if (!window.confirm('Issue a new link? The old one stops working immediately.')) return;
                  await api.post(`/drivers/${modal.data.id}/rotate-link`); drivers.reload(); close();
                })}>Reset driver link</button>}
                <button type="button" className="link small danger" onClick={() => act(async () => {
                  if (!window.confirm('Delete? Trips and guests assigned to it will be unassigned.')) return;
                  await api.del(`/${modal.kind}/${modal.data.id}`);
                  (modal.kind === 'vehicles' ? vehicles : drivers).reload(); close();
                })}>Delete</button>
              </div>
            )}
          </Form>
        </Modal>
      )}
    </div>
  );
}
