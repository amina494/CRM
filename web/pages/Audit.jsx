import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { Empty, Loading, useApi } from '../components/ui.jsx';

const PAGE = 100;

/** Admin-only list of who did what, when and from where. */
export default function Audit() {
  const { events } = useApp();
  const users = useApi('/users').data || [];
  const [f, setF] = useState({ user_id: '', event_id: '', action: '', q: '', from: '', to: '' });
  const [offset, setOffset] = useState(0);
  const set = (k) => (e) => { setOffset(0); setF((s) => ({ ...s, [k]: e.target.value })); };

  const params = new URLSearchParams(Object.entries({
    ...f,
    from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : '',
    to: f.to ? new Date(new Date(`${f.to}T00:00:00`).getTime() + 864e5).toISOString() : '',
    limit: PAGE, offset,
  }).filter(([, v]) => v !== '' && v != null));
  const { data, error } = useApi(`/audit?${params}`);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Audit trail</h1><p className="muted">Sign-ins, guest views, exports, changes, deletions and check-ins, with the person and network address.</p></div>
      </div>
      <div className="filters">
        <input className="search" placeholder="Search names and details…" value={f.q} onChange={set('q')} />
        <select value={f.user_id} onChange={set('user_id')}>
          <option value="">Anyone</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={f.event_id} onChange={set('event_id')}>
          <option value="">Any event</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={f.action} onChange={set('action')}>
          <option value="">Any action</option>
          {(data?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="date-filter">From <input type="date" value={f.from} onChange={set('from')} /></label>
        <label className="date-filter">To <input type="date" value={f.to} onChange={set('to')} /></label>
      </div>
      {!data ? <Loading error={error} /> : !data.rows.length ? <Empty>Nothing matches.</Empty> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Guest</th><th>Event</th><th>Details</th><th>Address</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="no-click">
                    <td className="nowrap small">{new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td className="small">{r.actor || '—'}</td>
                    <td><code className="small">{r.action}</code></td>
                    <td className="small">{r.guest_id ? <Link to={`/guests/${r.guest_id}`}>{[r.guest_title, r.first_name, r.last_name].filter(Boolean).join(' ') || `#${r.guest_id}`}</Link> : '—'}</td>
                    <td className="small">{r.event_name || '—'}</td>
                    <td className="small">{r.details || ''}</td>
                    <td className="small muted">{r.ip || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted small">{offset + 1}–{offset + data.rows.length} of {data.total}</span>
            <button className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Newer</button>
            <button className="btn btn-ghost btn-sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Older</button>
          </div>
        </>
      )}
    </div>
  );
}
