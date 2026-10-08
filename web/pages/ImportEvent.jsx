import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';

async function upload(file) {
  const res = await fetch('/api/imports/files', {
    method: 'POST', body: file, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

const day = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const legText = (l) => (l ? [day(l.date), l.time, l.flight || l.mode].filter(Boolean).join(' · ') : '—');
const guessName = (file) => String(file || '').replace(/\.xlsx$/i, '').replace(/^copy of /i, '')
  .replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' – ').replace(/\b(arrivals?|departures?|ula|sheet)\b/gi, '').replace(/[\s–]+$/g, '').trim();

/** Admins: create an event from the arrivals workbook and the liaison list. */
export default function ImportEvent() {
  const { setEventId, reloadEvents } = useApp();
  const navigate = useNavigate();
  const [files, setFiles] = useState({ arrivals: null, liaisons: null });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [ev, setEv] = useState(null);

  const choose = (kind) => async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(kind); setError(null); setPreview(null);
    try {
      const up = await upload(file);
      setFiles((f) => ({ ...f, [kind]: up }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
      e.target.value = '';
    }
  };

  const check = async () => {
    setBusy('preview'); setError(null);
    try {
      const p = await api.post('/imports/preview', { arrivals: files.arrivals.file_id, liaisons: files.liaisons?.file_id });
      setPreview(p);
      setEv({
        name: guessName(files.arrivals.name), venue: p.suggested.venue || '', timezone: 'Asia/Riyadh',
        starts_at: p.suggested.starts_on ? `${p.suggested.starts_on}T09:00` : '',
        ends_at: p.suggested.ends_on ? `${p.suggested.ends_on}T18:00` : '',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy('create'); setError(null);
    try {
      const out = await api.post('/imports/create', { arrivals: files.arrivals.file_id, liaisons: files.liaisons?.file_id, event: ev });
      await reloadEvents();
      setEventId(out.event_id);
      navigate('/guests');
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="small"><Link to="/events" className="link">← Events</Link></p>
          <h1>Import an event from a spreadsheet</h1>
          <p className="muted">Creates a new event with its guests, companions, hotels, flights and liaisons. Nothing is saved until you press <strong>Create event</strong>.</p>
        </div>
      </div>

      <div className="grid-2">
        <FileCard
          title="1. Arrivals and departures" required file={files.arrivals} busy={busy === 'arrivals'} onChange={choose('arrivals')}
          hint="The workbook with NAME, HOTEL and the arrival / departure columns. Every visible tab is read; tabs further right count as newer. Hidden tabs are ignored."
        />
        <FileCard
          title="2. Liaison list (optional)" file={files.liaisons} busy={busy === 'liaisons'} onChange={choose('liaisons')}
          hint="Needs NAME and LIAISON NAME columns (PHONE NUMBER too, if you have it). On a tab named “departure”, the liaison becomes the backup host. Only names, phone numbers and car type are read: passport, visa and medical columns are ignored."
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-primary" disabled={!files.arrivals || busy} onClick={check}>
          {busy === 'preview' ? 'Checking…' : preview ? 'Check again' : 'Check the files'}
        </button>
      </div>

      {preview && ev && <Preview preview={preview} ev={ev} setEv={setEv} busy={busy} onCreate={create} />}
    </div>
  );
}

function FileCard({ title, hint, file, busy, onChange, required }) {
  return (
    <section className="card import-file">
      <h2>{title}</h2>
      <p className="small muted">{hint}</p>
      <label className="btn btn-ghost">
        {busy ? 'Reading…' : file ? 'Choose a different file' : 'Choose .xlsx file'}
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={onChange} required={required} />
      </label>
      {file && (
        <p className="small">
          <strong>{file.name}</strong><br />
          <span className="muted">{file.tabs.filter((t) => !t.hidden).length} visible tabs{file.tabs.some((t) => t.hidden) ? `, ${file.tabs.filter((t) => t.hidden).length} hidden` : ''}</span>
        </p>
      )}
    </section>
  );
}

function Preview({ preview, ev, setEv, busy, onCreate }) {
  const { counts, report } = preview;
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? preview.guests.filter((g) => [g.name, g.nationality, g.hotel, g.liaison, g.position].join(' ').toLowerCase().includes(q)) : preview.guests;
  }, [filter, preview.guests]);
  const field = (name, label, type = 'text') => (
    <label className="field"><span className="field-label">{label}</span>
      <input type={type} value={ev[name] || ''} onChange={(e) => setEv({ ...ev, [name]: e.target.value })} /></label>
  );
  const checks = [
    report.conflicts.length && `${report.conflicts.length} disagreements between tabs`,
    report.odd_dates.length && `${report.odd_dates.length} dates that look wrong`,
    report.possible_duplicates.length && `${report.possible_duplicates.length} possible duplicates`,
    report.companions_unlinked.length && `${report.companions_unlinked.length} companions not linked`,
    report.liaison_unmatched.length && `${report.liaison_unmatched.length} names on the liaison list not found`,
  ].filter(Boolean);

  return (
    <>
      <div className="stats import-stats">
        <Stat label="Guests" value={counts.guests} sub={`${counts.companions} linked to the guest they travel with`} />
        <Stat label="Flights" value={counts.flights} sub={`${counts.tanfeethi_flights} Tanfeethi`} />
        <Stat label="Hotel stays" value={counts.rooms} sub={`${counts.hotels} hotels (${counts.new_hotels} new)`} />
        <Stat label="Liaisons" value={counts.liaisons} sub={`${counts.guests_with_liaison} guests assigned · ${counts.new_liaisons} new accounts`} />
      </div>

      {checks.length > 0 && (
        <div className="alert alert-warn">
          <strong>Please check:</strong> {checks.join(' · ')}. Details are below. You can import now and fix these in the CRM afterwards.
        </div>
      )}

      <section className="card">
        <h2>The event</h2>
        <div className="grid-2">
          {field('name', 'Event name')}
          {field('venue', 'Venue')}
          {field('starts_at', 'Starts', 'datetime-local')}
          {field('ends_at', 'Ends', 'datetime-local')}
        </div>
        <p className="small muted">Dates are suggested from the travel dates in the sheet. You can change these and add the Arabic name, address and dress code later under Events → Edit.</p>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy || !ev.name?.trim()} onClick={onCreate}>
            {busy === 'create' ? 'Creating…' : `Create event with ${counts.guests} guests`}
          </button>
        </div>
      </section>

      <Details title={`Disagreements between tabs (${report.conflicts.length})`} empty="None." count={report.conflicts.length} open={report.conflicts.length > 0 && report.conflicts.length <= 40}
        note="The newer tab (further right) was used. Check these in the CRM after importing.">
        {(
          <table className="table compact"><thead><tr><th>Guest</th><th>What</th><th>Used</th><th>Also says</th></tr></thead>
            <tbody>{report.conflicts.map((c, i) => (
              <tr key={i}><td>{c.guest}</td><td>{c.field}</td><td>{c.chosen}<div className="small muted">{c.chosen_tab}</div></td><td>{c.other}<div className="small muted">{c.other_tab}</div></td></tr>
            ))}</tbody></table>
        )}
      </Details>

      {report.odd_dates.length > 0 && (
        <Details title={`Dates that look wrong (${report.odd_dates.length})`} open note="These are far from the other travel dates, usually a typo. They are imported as written.">
          <ul className="small">{report.odd_dates.map((d, i) => <li key={i}>{d.guest}: {d.field} on {d.date}</li>)}</ul>
        </Details>
      )}

      <Details title={`Possible duplicates (${report.possible_duplicates.length})`} empty="None found." count={report.possible_duplicates.length}
        note="Different spellings of what may be the same person. Both are imported; delete the extra one in the CRM if they are the same.">
        <ul className="small">{report.possible_duplicates.map(([a, b], i) => <li key={i}>{a} · {b}</li>)}</ul>
      </Details>

      <Details title={`Companions (${report.companions_linked.length} linked, ${report.companions_unlinked.length} not linked)`}
        note="Linked companions appear under the guest they travel with. Link the others with Edit on the guest after importing.">
        {report.companions_linked.length > 0 && <><h3>Linked</h3><ul className="small">{report.companions_linked.map((c, i) => <li key={i}><strong>{c.guest}</strong> with {c.lead} <span className="muted">({c.how})</span></li>)}</ul></>}
        {report.companions_unlinked.length > 0 && <><h3>Not linked</h3><ul className="small">{report.companions_unlinked.map((c, i) => <li key={i}><strong>{c.guest}</strong> <span className="muted">{c.position}</span></li>)}</ul></>}
      </Details>

      {preview.liaisons.length > 0 && (
        <Details title={`Liaisons (${preview.liaisons.length})`}
          note="Each liaison gets a staff account with the Liaison role on this event. The list has no emails, so they cannot sign in until you add their email and a password on the Staff screen. Their phone number is shown to drivers as the contact.">
          <table className="table compact"><thead><tr><th>Liaison</th><th>Mobile</th><th>Guests</th></tr></thead>
            <tbody>{preview.liaisons.map((l) => <tr key={l.name}><td>{l.name}</td><td>{l.phone || '—'}</td><td>{l.guests}</td></tr>)}</tbody></table>
          {report.liaison_similar.length > 0 && <p className="small">Matched by a similar spelling: {report.liaison_similar.map((s) => `${s.listed} → ${s.matched}`).join('; ')}.</p>}
          {report.liaison_unmatched.length > 0 && <p className="small"><strong>On the liaison list but not in the arrivals sheet</strong> (not imported, add them by hand if needed): {report.liaison_unmatched.join(', ')}.</p>}
        </Details>
      )}

      <Details title={`Missing details (${report.no_arrival.length} without an arrival flight, ${report.no_departure.length} without a departure flight, ${report.no_hotel.length} without a hotel)`}
        note="Imported without that part. Where the sheet gave a date or time but no flight number, it is kept in the guest's notes.">
        <p className="small"><strong>No arrival flight:</strong> {report.no_arrival.join(', ') || '—'}</p>
        <p className="small"><strong>No departure flight:</strong> {report.no_departure.join(', ') || '—'}</p>
        <p className="small"><strong>No hotel:</strong> {report.no_hotel.join(', ') || '—'}</p>
      </Details>

      <Details title="Tabs read" note="Tabs further right are treated as newer.">
        <ul className="small">
          {report.tabs_used.map((t) => <li key={t.tab}>{t.tab}: {t.rows} rows</li>)}
          {report.tabs_skipped.map((t) => <li key={t.tab} className="muted">{t.tab}: skipped ({t.reason})</li>)}
        </ul>
      </Details>

      <section className="card">
        <div className="page-head"><h2>Guests ({preview.guests.length})</h2>
          <input className="import-filter" placeholder="Filter by name, country, hotel or liaison" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <div className="table-scroll">
          <table className="table compact">
            <thead><tr><th>Guest</th><th>Type</th><th>Hotel</th><th>Arrival</th><th>Departure</th><th>Liaison</th></tr></thead>
            <tbody>{shown.map((g) => (
              <tr key={g.name}>
                <td>{g.lead && <span className="muted">↳ </span>}<strong>{g.name}</strong>
                  <div className="small muted">{[g.nationality, g.position].filter(Boolean).join(' · ')}</div>
                  {g.lead && <div className="small muted">{g.relationship} of {g.lead}</div>}</td>
                <td>{g.type || '—'}</td>
                <td>{g.hotel || '—'}{g.room_type && <div className="small muted">{g.room_type}</div>}</td>
                <td>{legText(g.arrival)}{g.arrival?.tanfeethi && <div><span className="badge tone-amber">Tanfeethi</span></div>}</td>
                <td>{legText(g.departure)}{g.departure?.tanfeethi && <div><span className="badge tone-amber">Tanfeethi</span></div>}</td>
                <td>{g.liaison || '—'}{g.backup_liaison && <div className="small muted">Departure: {g.backup_liaison}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, sub }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div>;
}

function Details({ title, note, empty, count, open, children }) {
  return (
    <details className="card import-details" open={open}>
      <summary><strong>{title}</strong></summary>
      {note && count !== 0 && <p className="small muted">{note}</p>}
      {count === 0 ? <p className="small">{empty}</p> : children}
    </details>
  );
}
