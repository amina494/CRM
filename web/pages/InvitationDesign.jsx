import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Loading } from '../components/ui.jsx';
import { InvitationView } from '../public-pages/Invite.jsx';

// --- Colour contrast (WCAG), mirrored from the server ---------------------
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const readableOn = (hex) => (contrast(hex, '#f1ece9') >= contrast(hex, '#1e1b1a') ? '#f1ece9' : '#1e1b1a');
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');

/** Starting points; every colour can still be changed afterwards. */
const THEMES = [
  { name: 'YAX', background: '#1e1b1a', card: '#fbf9f8', accent: '#ef5f22', heading: '#1e1b1a', text: '#1e1b1a', heading_font: 'IBM Plex Serif' },
  { name: 'Midnight & gold', background: '#14283c', card: '#fffdf7', accent: '#9a7614', heading: '#14283c', text: '#1b2430', heading_font: 'Cormorant Garamond' },
  { name: 'Royal burgundy', background: '#4a1426', card: '#faf6f0', accent: '#a8802f', heading: '#4a1426', text: '#2b1a1f', heading_font: 'Playfair Display' },
  { name: 'Desert sand', background: '#c8b49a', card: '#fffaf2', accent: '#9a5b2e', heading: '#3d2a1c', text: '#3d2a1c', heading_font: 'Cinzel' },
  { name: 'Emerald', background: '#0f3d2e', card: '#f6f1e7', accent: '#b07d3e', heading: '#0f3d2e', text: '#1d2a24', heading_font: 'Libre Baskerville' },
  { name: 'Minimal white', background: '#f3f0ee', card: '#ffffff', accent: '#1e1b1a', heading: '#1e1b1a', text: '#3a3634', heading_font: 'Montserrat' },
];

const COLOUR_FIELDS = [
  ['background', 'Page background', 'Behind the card (hidden by the photo in the photo layout)'],
  ['card', 'Card', 'The invitation card itself'],
  ['accent', 'Accent', 'Logo, small headings, links and the main button'],
  ['heading', 'Headings', 'Guest name, event name, answers'],
  ['text', 'Text', 'Everything else'],
];

export default function InvitationDesign() {
  const { id } = useParams();
  const { events, meta } = useApp();
  const event = events.find((e) => e.id === Number(id));
  const [loaded, setLoaded] = useState(null);
  const [v, setV] = useState(null);
  const [saved, setSaved] = useState(null);
  const [lang, setLang] = useState('en');
  const [state, setState] = useState('invite');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const coverInput = useRef(null);
  const logoInput = useRef(null);

  const apply = (design) => {
    const values = { ...design };
    setV(values);
    setSaved(JSON.stringify(strip(values)));
  };

  useEffect(() => {
    api.get(`/events/${id}/design`).then((r) => { setLoaded(r); apply(r.design); }).catch(setError);
  }, [id]);

  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const dirty = v && saved !== JSON.stringify(strip(v));

  // The preview shows exactly what guests would see with the current, unsaved choices.
  const preview = useMemo(() => {
    if (!v || !event) return null;
    const ok = (k) => (isHex(v[k]) ? v[k] : loaded.defaults[k]);
    const design = {
      ...v,
      background: ok('background'), card: ok('card'), accent: ok('accent'), heading: ok('heading'), text: ok('text'),
      layout: v.layout === 'photo' && !v.cover_url ? 'card' : v.layout,
      logo: v.logo === 'custom' && !v.logo_url ? 'yax' : v.logo,
    };
    design.on_accent = readableOn(design.accent);
    design.on_background = readableOn(design.background);
    return {
      org: meta?.org || 'YAX',
      event,
      guest: {
        title: 'H.E.', first_name: 'Ahmed', last_name: 'Al-Rashid', name_ar: 'معالي أحمد الراشد', language: lang,
        plus_ones_allowed: 1, rsvp_status: state === 'accepted' ? 'attending' : 'pending', rsvp_party_size: 2,
        table: 'Head Table', seat: '1',
      },
      companions: state === 'accepted' ? [{ first_name: 'Sara', last_name: 'Al-Rashid' }] : [],
      rsvp_closed: false,
      wallet: { apple: true, google: true },
      design,
    };
  }, [v, event, lang, state, loaded, meta]);

  if (error && !v) return <div className="page"><div className="alert alert-error">{error.message}</div></div>;
  if (!v || !event) return <Loading />;

  const warnings = [];
  if (isHex(v.heading) && isHex(v.card) && contrast(v.heading, v.card) < 4.5) warnings.push('Headings are hard to read on the card colour.');
  if (isHex(v.text) && isHex(v.card) && contrast(v.text, v.card) < 4.5) warnings.push('Text is hard to read on the card colour.');
  if (isHex(v.accent) && isHex(v.card) && contrast(v.accent, v.card) < 3) warnings.push('The accent colour is faint on the card, so small headings and links may be hard to see.');
  const invalid = COLOUR_FIELDS.filter(([k]) => !isHex(v[k])).map(([, label]) => label);

  const run = async (fn, done) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await fn();
      if (r?.design) apply(r.design);
      if (done) setMessage(done);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(() => api.put(`/events/${id}/design`, strip(v)), 'Design saved. Guests see it the next time they open their invitation, and new invitation emails use it.');
  const reset = () => {
    if (!window.confirm('Go back to the YAX style? Your colours, fonts, wording and uploaded images for this event will be removed.')) return;
    run(() => api.put(`/events/${id}/design`, { reset: true }), 'Back to the YAX style.');
  };
  const upload = (kind) => async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError(new Error('Please choose an image under 5 MB.')); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError(new Error('Please choose a PNG, JPEG or WebP image.')); return; }
    await run(async () => {
      // Save pending choices first, so the upload does not lose them.
      if (dirty) await api.put(`/events/${id}/design`, strip(v));
      const res = await fetch(`/api/events/${id}/design/image/${kind}`, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      // Uploading a logo means "use our own logo".
      return kind === 'logo' ? api.put(`/events/${id}/design`, { logo: 'custom' }) : data;
    }, kind === 'cover' ? 'Cover photo saved.' : 'Logo saved.');
  };
  const removeImage = (kind) => run(async () => {
    if (dirty) await api.put(`/events/${id}/design`, strip(v));
    return api.del(`/events/${id}/design/image/${kind}`);
  }, kind === 'cover' ? 'Cover photo removed.' : 'Logo removed.');

  return (
    <div className="page design-page">
      <Link to="/events" className="link small">← Events</Link>
      <div className="page-head">
        <div>
          <h1>Invitation design</h1>
          <p className="muted">{event.name}. Changes show in the preview straight away; guests see them once you save.</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={reset} disabled={busy}>Reset to YAX style</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty || invalid.length > 0}>{busy ? 'Saving…' : dirty ? 'Save design' : 'Saved'}</button>
        </div>
      </div>
      {message && <div className="alert alert-ok">{message}</div>}
      {error && <div className="alert alert-error">{error.message}</div>}

      <div className="design-layout">
        <div className="design-controls">
          <section className="card">
            <h2>Start from a theme</h2>
            <div className="theme-grid">
              {THEMES.map((th) => (
                <button key={th.name} type="button" className="theme-swatch" onClick={() => setV((s) => { const { name: _n, ...colours } = th; return { ...s, ...colours }; })}>
                  <span className="swatch-stack" style={{ background: th.background }}>
                    <span style={{ background: th.card }}><i style={{ background: th.accent }} /><b style={{ background: th.heading }} /></span>
                  </span>
                  <span className="small">{th.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Layout and photo</h2>
            <div className="segmented wide">
              <button type="button" className={v.layout === 'card' ? 'on' : ''} onClick={() => set('layout', 'card')}>Card on colour</button>
              <button type="button" className={v.layout === 'photo' ? 'on' : ''} onClick={() => set('layout', 'photo')}>Card on photo</button>
            </div>
            <p className="small muted">{v.layout === 'photo' ? 'Your cover photo fills the page behind the card, slightly darkened.' : 'Your cover photo, if any, appears as a banner at the top of the card.'}</p>
            <div className="image-row">
              {v.cover_url ? <img src={v.cover_url} alt="Cover" className="image-thumb wide" /> : <div className="image-thumb wide empty">No cover photo</div>}
              <div className="image-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => coverInput.current.click()} disabled={busy}>{v.cover_url ? 'Replace photo' : 'Upload cover photo'}</button>
                {v.cover_url && <button type="button" className="link small danger" onClick={() => removeImage('cover')}>Remove</button>}
                <span className="field-hint">PNG, JPEG or WebP, up to 5 MB. A wide photo (about 1600 × 900) works best.</span>
              </div>
              <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload('cover')} />
            </div>
            {v.layout === 'photo' && !v.cover_url && <div className="alert alert-info">Upload a cover photo to use this layout. Until then the card shows on the background colour.</div>}
          </section>

          <section className="card">
            <h2>Colours</h2>
            <div className="colour-grid">
              {COLOUR_FIELDS.map(([k, label, hint]) => (
                <label key={k} className="colour-field">
                  <input type="color" value={isHex(v[k]) ? v[k] : '#000000'} onChange={(e) => set(k, e.target.value)} aria-label={label} />
                  <span>
                    <span className="field-label">{label}</span>
                    <input className="hex-input" value={v[k] || ''} onChange={(e) => set(k, e.target.value.trim())} maxLength={7} spellCheck={false} />
                    <span className="field-hint">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {invalid.length > 0 && <div className="alert alert-error">Colours must look like #ef5f22: {invalid.join(', ')}.</div>}
            {warnings.map((w) => <div key={w} className="alert alert-warn">{w}</div>)}
          </section>

          <section className="card">
            <h2>Fonts</h2>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Headings (English)</span>
                <select value={v.heading_font} onChange={(e) => set('heading_font', e.target.value)}>
                  {loaded.fonts.heading.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <span className="font-sample" style={{ fontFamily: `'${v.heading_font}', serif` }}>Annual Leadership Gala</span>
              </label>
              <label className="field">
                <span className="field-label">Arabic</span>
                <select value={v.arabic_font} onChange={(e) => set('arabic_font', e.target.value)}>
                  {loaded.fonts.arabic.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <span className="font-sample" dir="rtl" style={{ fontFamily: `'${v.arabic_font}', sans-serif` }}>الحفل السنوي للقيادات</span>
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Logo</h2>
            <div className="segmented wide">
              {[['yax', 'YAX logo'], ['custom', 'Our own logo'], ['none', 'No logo']].map(([k, label]) => (
                <button key={k} type="button" className={v.logo === k ? 'on' : ''} onClick={() => (k === 'custom' && !v.logo_url ? logoInput.current.click() : set('logo', k))}>{label}</button>
              ))}
            </div>
            {v.logo === 'custom' && (
              <div className="image-row">
                {v.logo_url ? <img src={v.logo_url} alt="Logo" className="image-thumb" /> : <div className="image-thumb empty">No logo</div>}
                <div className="image-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => logoInput.current.click()} disabled={busy}>{v.logo_url ? 'Replace logo' : 'Upload logo'}</button>
                  {v.logo_url && <button type="button" className="link small danger" onClick={() => removeImage('logo')}>Remove</button>}
                  <span className="field-hint">A PNG with a transparent background looks best, and is also used on Apple Wallet passes.</span>
                </div>
              </div>
            )}
            <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload('logo')} />
          </section>

          <section className="card">
            <h2>Wording</h2>
            <p className="small muted">Leave empty to use the standard wording. The event name, host, date, venue and dress code are set on the event itself.</p>
            <div className="form-grid">
              <label className="field"><span className="field-label">Top line (English)</span>
                <input value={v.kicker_en || ''} maxLength={80} placeholder="You are cordially invited" onChange={(e) => set('kicker_en', e.target.value)} /></label>
              <label className="field"><span className="field-label">Top line (Arabic)</span>
                <input dir="rtl" value={v.kicker_ar || ''} maxLength={80} placeholder="تتشرف بدعوتكم" onChange={(e) => set('kicker_ar', e.target.value)} /></label>
              <label className="field"><span className="field-label">Closing note (English)</span>
                <textarea rows={3} value={v.closing_en || ''} maxLength={400} placeholder="Optional, e.g. We look forward to welcoming you." onChange={(e) => set('closing_en', e.target.value)} /></label>
              <label className="field"><span className="field-label">Closing note (Arabic)</span>
                <textarea dir="rtl" rows={3} value={v.closing_ar || ''} maxLength={400} placeholder="اختياري" onChange={(e) => set('closing_ar', e.target.value)} /></label>
            </div>
          </section>

          <p className="small muted">Also follows this design: the invitation email (colours, cover photo, logo, top line and closing note) and the colours of Apple and Google Wallet passes.</p>
        </div>

        <aside className="design-preview">
          <div className="preview-bar">
            <div className="segmented">
              <button className={state === 'invite' ? 'on' : ''} onClick={() => setState('invite')}>Invitation</button>
              <button className={state === 'accepted' ? 'on' : ''} onClick={() => setState('accepted')}>After accepting</button>
            </div>
            <div className="segmented">
              <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
              <button className={lang === 'ar' ? 'on' : ''} onClick={() => setLang('ar')}>العربية</button>
            </div>
          </div>
          <div className="phone-frame">
            <InvitationView key={`${state}-${lang}`} data={preview} lang={lang} setLang={setLang} token="preview" preview />
          </div>
          <p className="small muted">Preview with a sample guest. Buttons here do nothing.</p>
        </aside>
      </div>
    </div>
  );
}

// Only the fields staff choose; image links and computed colours come from the server.
const DESIGN_KEYS = ['layout', 'background', 'card', 'accent', 'heading', 'text', 'heading_font', 'arabic_font', 'logo', 'kicker_en', 'kicker_ar', 'closing_en', 'closing_ar'];
function strip(v) {
  return Object.fromEntries(DESIGN_KEYS.map((k) => [k, v[k] ?? '']));
}
