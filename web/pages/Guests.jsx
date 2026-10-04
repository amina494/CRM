import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import GuestForm from '../components/GuestForm.jsx';
import { Badge, Empty, Loading, Modal, ServiceBadge, fmtTime, guestName, useApi } from '../components/ui.jsx';
import { CATEGORIES, GUEST_STATUS, INVITE, RSVP } from '../constants.js';

export default function Guests() {
  const { event, canEdit } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState(null);

  const filters = Object.fromEntries(['q', 'rsvp', 'category', 'status', 'host', 'invite'].map((k) => [k, params.get(k) || '']));
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const { data: guests, error, reload } = useApi(`/events/${event.id}/guests${query ? `?${query}` : ''}`);
  const users = useApi(`/events/${event.id}/members`).data?.filter((m) => m.role !== 'viewer') || [];

  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const allIds = useMemo(() => (guests || []).map((g) => g.id), [guests]);
  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => setSelected((s) => (s.size === allIds.length ? new Set() : new Set(allIds)));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Guests & RSVP</h1>
          <p className="muted">{guests ? `${guests.length} guests` : ''}</p>
        </div>
        <div className="actions">
          {canEdit && <a className="btn btn-ghost" href={`/api/events/${event.id}/guests/export.csv`}>Export CSV</a>}
          {canEdit && <button className="btn btn-ghost" onClick={() => setModal('import')}>Import CSV</button>}
          {canEdit && <button className="btn btn-primary" onClick={() => setModal('add')}>Add guest</button>}
        </div>
      </div>

      <div className="filters">
        <input className="search" placeholder="Search name, email, phone, organisation…" defaultValue={filters.q}
          onChange={(e) => setFilter('q', e.target.value)} />
        <Select value={filters.rsvp} onChange={(v) => setFilter('rsvp', v)} options={RSVP} all="All responses" />
        <Select value={filters.category} onChange={(v) => setFilter('category', v)} options={CATEGORIES} all="All categories" />
        <Select value={filters.invite} onChange={(v) => setFilter('invite', v)} options={INVITE} all="Any invitation" />
        <Select value={filters.status} onChange={(v) => setFilter('status', v)} options={GUEST_STATUS} all="Any location" />
        <Select value={filters.host} onChange={(v) => setFilter('host', v)} all="Any host"
          options={{ me: 'My guests', none: 'Unassigned', ...Object.fromEntries(users.map((u) => [u.id, u.name])) }} />
      </div>

      {selected.size > 0 && canEdit && (
        <div className="bulkbar">
          <span>{selected.size} selected</span>
          <button className="btn btn-primary btn-sm" onClick={() => setModal('send')}>Send invitations</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setModal('assign')}>Assign host</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {!guests ? <Loading error={error} /> : !guests.length ? <Empty>No guests match. Add guests or import a CSV.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {canEdit && <th className="check"><input type="checkbox" checked={selected.size === allIds.length} onChange={toggleAll} aria-label="Select all" /></th>}
                <th>Guest</th>
                <th>Category</th>
                <th>Invitation</th>
                <th>RSVP</th>
                <th>Host</th>
                <th>Arrival</th>
                <th>Stay</th>
                <th>Seat</th>
                <th>Car / driver</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id} className={g.party_lead_id ? 'companion-row' : ''} onClick={() => navigate(`/guests/${g.id}`)}>
                  {canEdit && (
                    <td className="check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} aria-label={`Select ${guestName(g)}`} />
                    </td>
                  )}
                  <td>
                    <Link to={`/guests/${g.id}`} className="guest-link" onClick={(e) => e.stopPropagation()}>
                      {g.party_lead_id ? '↳ ' : ''}{guestName(g)}
                    </Link>
                    <div className="muted small">
                      {g.party_lead_id ? `${g.relationship || 'With'} ${g.lead_name}` : [g.position, g.organization].filter(Boolean).join(', ')}
                      {g.companion_count > 0 && ` · +${g.companion_count} in party`}
                    </div>
                  </td>
                  <td><Badge value={g.category} label={CATEGORIES[g.category]} /></td>
                  <td>{g.party_lead_id && g.invite_status === 'not_sent' ? <span className="muted small">With party</span> : <Badge value={g.invite_status} label={INVITE[g.invite_status]} />}</td>
                  <td>
                    <Badge value={g.rsvp_status} label={RSVP[g.rsvp_status]} />
                    {g.rsvp_status === 'attending' && g.rsvp_party_size > 1 && <span className="muted small"> ×{g.rsvp_party_size}</span>}
                  </td>
                  <td className="small">{g.host_name || <span className="muted">—</span>}</td>
                  <td className="small">
                    {g.arrival ? <><ServiceBadge type={g.arrival.service_type} /><div>{g.arrival.flight}</div><div className="muted">{fmtTime(g.arrival.at)}</div></> : <span className="muted">—</span>}
                  </td>
                  <td className="small">{g.stay || <span className="muted">—</span>}</td>
                  <td className="small nowrap">{g.table_name ? `${g.table_name}${g.seat_number ? ` · ${g.seat_number}` : ''}` : <span className="muted">—</span>}</td>
                  <td className="small">
                    {g.vehicle_plate || g.driver_name ? <><div>{g.vehicle_plate}</div><div className="muted">{g.driver_name}</div></> : <span className="muted">—</span>}
                  </td>
                  <td>
                    <Badge value={g.current_status} label={GUEST_STATUS[g.current_status]} />
                    {g.checked_in_at && <div className="small ok">✓ checked in</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'add' && (
        <Modal title="Add guest" onClose={() => setModal(null)} wide>
          <GuestForm onCancel={() => setModal(null)} onSaved={(id) => navigate(`/guests/${id}`)} />
        </Modal>
      )}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'send' && (
        <SendInvitationsModal ids={[...selected]} onClose={() => setModal(null)} onDone={() => { reload(); setSelected(new Set()); }} />
      )}
      {modal === 'assign' && (
        <AssignHostModal ids={[...selected]} users={users} onClose={() => setModal(null)} onDone={() => { reload(); setSelected(new Set()); }} />
      )}
    </div>
  );
}

function Select({ value, onChange, options, all }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

export function SendInvitationsModal({ ids, onClose, onDone }) {
  const { event, meta } = useApp();
  const [channels, setChannels] = useState(['email', 'whatsapp']);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggle = (c) => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(`/events/${event.id}/invitations/send`, { guest_ids: ids, channels });
      setResults(r.results);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const label = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS' };
  return (
    <Modal title={`Send invitations (${ids.length})`} onClose={onClose}>
      {!results ? (
        <>
          <p>Each guest receives a personal link to RSVP, add their pass to Apple / Google Wallet, and save the date to their calendar. Messages go out in the guest's language (English or Arabic).</p>
          <div className="channel-list">
            {Object.entries(label).map(([c, l]) => (
              <label key={c} className="channel">
                <input type="checkbox" checked={channels.includes(c)} onChange={() => toggle(c)} />
                <span>{l}</span>
                {meta?.channels && !meta.channels[c] && <span className="muted small">not connected – will be logged to the outbox only</span>}
              </label>
            ))}
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !channels.length} onClick={send}>{busy ? 'Sending…' : 'Send now'}</button>
          </div>
        </>
      ) : (
        <>
          <table className="table compact">
            <tbody>
              {results.map((r) => (
                <tr key={r.guest_id}>
                  <td>{r.name}</td>
                  <td>{r.outcomes.map((o) => (
                    <span key={o.channel} title={o.error || ''} className={`badge tone-${{ sent: 'green', logged: 'blue', failed: 'red', skipped: 'gray' }[o.status]}`}>
                      {label[o.channel]}: {o.status}
                    </span>
                  ))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
        </>
      )}
    </Modal>
  );
}

function AssignHostModal({ ids, users, onClose, onDone }) {
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    for (const id of ids) await api.put(`/guests/${id}`, { host_user_id: host || null });
    onDone();
    onClose();
  }
  return (
    <Modal title={`Assign host to ${ids.length} guests`} onClose={onClose}>
      <label className="field">
        <span className="field-label">Host / liaison</span>
        <select value={host} onChange={(e) => setHost(e.target.value)}>
          <option value="">— Unassigned —</option>
          {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Assign</button>
      </div>
    </Modal>
  );
}

const SAMPLE_CSV = `title,first name,last name,arabic name,email,mobile,company,position,category,language,plus_ones_allowed,table
H.E.,Ahmed,Al-Rashid,معالي أحمد الراشد,office@example.com,+966500000000,Ministry,Minister,vvip,ar,2,Head Table
Mr.,John,Smith,,john@example.com,+447700900000,Acme,CEO,vip,en,1,Table 1`;

function ImportModal({ onClose, onDone }) {
  const { event } = useApp();
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setError(null);
    try {
      const r = await api.post(`/events/${event.id}/guests/import`, { csv });
      setResult(r);
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }

  const onFile = async (e) => {
    const f = e.target.files[0];
    if (f) setCsv(await f.text());
  };

  return (
    <Modal title="Import guests from CSV" onClose={onClose} wide>
      {result ? (
        <>
          <div className="alert alert-ok">Imported {result.created} guests.</div>
          {result.errors.length > 0 && (
            <div className="alert alert-error">
              {result.errors.map((e) => <div key={e.row}>Row {e.row}: {e.error}</div>)}
            </div>
          )}
          <div className="form-actions"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
        </>
      ) : (
        <>
          <p>Upload a CSV or paste it below. The first row must be headers. Recognised columns: title, first name, last name, name (full), arabic name, email, mobile/phone, company/organization, position, nationality, category (vvip, vip, delegation, media, general), language (en/ar), plus_ones_allowed, table, dietary, notes.</p>
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
          <textarea rows={10} className="mono" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE_CSV} />
          <button className="link small" onClick={() => setCsv(SAMPLE_CSV)}>Use sample</button>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={!csv.trim()} onClick={run}>Import</button>
          </div>
        </>
      )}
    </Modal>
  );
}
