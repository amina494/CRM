import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { TONE } from '../constants.js';

/** Fetches `path` and re-fetches when it changes. Pass null to skip. */
export function useApi(path, { poll } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const live = useRef(path);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api.get(path);
      if (live.current === path) setState({ data, error: null, loading: false });
    } catch (error) {
      if (live.current === path) setState((s) => ({ ...s, error, loading: false }));
    }
  }, [path]);
  useEffect(() => {
    live.current = path;
    setState((s) => ({ ...s, loading: Boolean(path) }));
    load();
    if (!poll) return undefined;
    const t = setInterval(load, poll);
    return () => clearInterval(t);
  }, [load, path, poll]);
  return { ...state, reload: load };
}

export function Badge({ value, label, tone }) {
  if (!value && !label) return null;
  return <span className={`badge tone-${tone || TONE[value] || 'gray'}`}>{label || value}</span>;
}

export function ServiceBadge({ type }) {
  if (!type) return null;
  return type === 'tanfeethi'
    ? <span className="badge tone-gold">Tanfeethi</span>
    : <span className="badge tone-gray">General</span>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint, span }) {
  return (
    <label className={`field ${span ? `span-${span}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * A form bound to a plain object. `fields` describes inputs:
 *   { name, label, type: 'text'|'select'|'textarea'|'datetime'|'number'|'checkbox', options, span, hint }
 */
export function Form({ initial = {}, fields, onSubmit, submitLabel = 'Save', onCancel, children, extra }) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (name, v) => setValues((s) => ({ ...s, [name]: v }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="form-grid">
        {fields.filter(Boolean).map((f) => (
          <Field key={f.name} label={f.label} hint={f.hint} span={f.span}>
            <Input field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
          </Field>
        ))}
        {extra?.(values, set)}
      </div>
      {children}
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-actions">
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}

function Input({ field: f, value, onChange }) {
  const common = { value: value ?? '', required: f.required, placeholder: f.placeholder, dir: f.dir };
  switch (f.type) {
    case 'select':
      return (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          {!f.required && <option value="">{f.empty || '—'}</option>}
          {Object.entries(f.options || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      );
    case 'textarea':
      return <textarea rows={f.rows || 3} {...common} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime':
      return <input type="datetime-local" {...common} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input type="number" step={f.step || 1} {...common} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'checkbox':
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    default:
      return <input type={f.type || 'text'} {...common} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Searchable multi-select of guests (used for flight/transfer passengers). */
export function GuestPicker({ guests, value = [], onChange }) {
  const [q, setQ] = useState('');
  const selected = new Set(value.map(Number));
  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  };
  const addParty = (g) => {
    const lead = g.party_lead_id || g.id;
    const next = new Set(selected);
    for (const x of guests) if (x.id === lead || x.party_lead_id === lead) next.add(x.id);
    onChange([...next]);
  };
  const list = guests.filter((g) => !q || guestName(g).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="picker">
      <input placeholder="Search guests…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker-chips">
        {guests.filter((g) => selected.has(g.id)).map((g) => (
          <button type="button" key={g.id} className="chip" onClick={() => toggle(g.id)}>{guestName(g)} ×</button>
        ))}
        {!selected.size && <span className="muted">No passengers selected</span>}
      </div>
      <div className="picker-list">
        {list.slice(0, 80).map((g) => (
          <div key={g.id} className={`picker-row ${selected.has(g.id) ? 'on' : ''}`}>
            <label>
              <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} />
              <span>{g.party_lead_id ? '↳ ' : ''}{guestName(g)}</span>
              <span className="muted small">{g.organization || g.relationship || ''}</span>
            </label>
            {(g.companion_count > 0 || g.party_lead_id) && (
              <button type="button" className="link small" onClick={() => addParty(g)}>+ whole party</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export const guestName = (g) => [g.title, g.first_name, g.last_name].filter(Boolean).join(' ');

export function fmtTime(local) {
  if (!local) return '—';
  const [d, t] = local.split('T');
  const date = new Date(`${d}T00:00:00`);
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${t?.slice(0, 5) || ''}`;
}

export function fmtAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ error }) {
  if (error) return <div className="alert alert-error">{error.message}</div>;
  return <div className="loading">Loading…</div>;
}

/** Runs an async action, surfacing errors with alert(). Returns the result. */
export async function act(fn) {
  try {
    return await fn();
  } catch (err) {
    window.alert(err.message);
    return undefined;
  }
}

export const toOptions = (rows, label = (r) => r.name) => Object.fromEntries((rows || []).map((r) => [r.id, label(r)]));
