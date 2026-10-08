import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import Logo from '../components/Logo.jsx';

const T = {
  en: {
    invited: 'You are cordially invited', dear: 'Dear', invites: 'cordially invites you to',
    when: 'Date & time', where: 'Venue', dress: 'Dress code', map: 'Open in Maps',
    rsvp: 'Will you attend?', yes: 'Joyfully accept', no: 'Regretfully decline', maybe: 'Not sure yet',
    companions: (n) => `You may bring up to ${n} guest${n > 1 ? 's' : ''}. Please enter their full names.`, companion: 'Guest name',
    addCompanion: '+ Add a guest', dietary: 'Dietary requirements or accessibility needs', message: 'Message to the host (optional)',
    send: 'Send response', sending: 'Sending…', change: 'Change my response', by: 'Kindly respond by',
    thanks: { attending: 'Thank you — we look forward to welcoming you.', declined: 'Thank you for letting us know. You will be missed.', tentative: 'Thank you. Please confirm when you can.' },
    yourResponse: 'Your response', closed: 'The RSVP deadline has passed. Please contact your host to make changes.',
    pass: 'Your entry pass', passHint: 'Show this code at the entrance.', apple: 'Add to Apple Wallet', google: 'Save to Google Wallet',
    calendar: 'Add to calendar', table: 'Table', seat: 'Seat', notFound: 'This invitation link is not valid.', lang: 'العربية',
    statusLabel: { attending: 'Attending', declined: 'Declined', tentative: 'Tentative' },
  },
  ar: {
    invited: 'تتشرف بدعوتكم', dear: '', invites: 'يتشرف بدعوتكم لحضور',
    when: 'التاريخ والوقت', where: 'المكان', dress: 'اللباس', map: 'فتح في الخرائط',
    rsvp: 'هل ستشرفوننا بالحضور؟', yes: 'سأحضر بكل سرور', no: 'أعتذر عن الحضور', maybe: 'لم أقرر بعد',
    companions: (n) => `يمكنكم اصطحاب ${n} من المرافقين. يرجى كتابة أسمائهم كاملة.`, companion: 'اسم المرافق',
    addCompanion: '+ إضافة مرافق', dietary: 'متطلبات غذائية أو احتياجات خاصة', message: 'رسالة إلى المضيف (اختياري)',
    send: 'إرسال الرد', sending: 'جارٍ الإرسال…', change: 'تعديل الرد', by: 'نرجو التكرم بالرد قبل',
    thanks: { attending: 'شكراً لكم، نتطلع لاستقبالكم.', declined: 'شكراً لإبلاغنا، سنفتقد حضوركم.', tentative: 'شكراً لكم، نرجو تأكيد الحضور حال تمكنكم.' },
    yourResponse: 'ردكم', closed: 'انتهت مهلة الرد. يرجى التواصل مع المضيف لأي تعديل.',
    pass: 'بطاقة الدخول', passHint: 'يرجى إبراز هذا الرمز عند الدخول.', apple: 'إضافة إلى Apple Wallet', google: 'حفظ في Google Wallet',
    calendar: 'إضافة إلى التقويم', table: 'الطاولة', seat: 'المقعد', notFound: 'رابط الدعوة غير صالح.', lang: 'English',
    statusLabel: { attending: 'سأحضر', declined: 'أعتذر', tentative: 'لم أقرر' },
  },
};

// Event times are venue-local strings; format them without timezone conversion.
function fmt(local, lang) {
  if (!local) return '';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(`${local}:00Z`));
}

export default function Invite() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lang, setLang] = useState('en');

  const load = () => api.get(`/public/invite/${token}`).then((d) => { setData(d); return d; }).catch(setError);
  useEffect(() => { load().then((d) => d && setLang(d.guest.language || 'en')); }, [token]);
  useEffect(() => { document.documentElement.lang = lang; document.title = data?.event.name || 'Invitation'; }, [lang, data]);

  if (error) return <div className="invite-page"><div className="invite-card"><p>{T[lang].notFound}</p></div></div>;
  if (!data) return <div className="invite-page"><div className="loading">…</div></div>;
  return <InvitationView data={data} lang={lang} setLang={setLang} token={token} onReload={load} />;
}

/** Loads the Google fonts a design uses (only fonts from the fixed lists). */
const FONT_WEIGHTS = {
  'IBM Plex Serif': '400;500;600;700', 'Playfair Display': '400;500;600;700', 'Cormorant Garamond': '400;500;600;700',
  'Libre Baskerville': '400;700', Lora: '400;500;600;700', Cinzel: '400;500;600;700', 'IBM Plex Sans': '400;500;600;700',
  Montserrat: '400;500;600;700', 'IBM Plex Sans Arabic': '400;500;600;700', 'Noto Kufi Arabic': '400;500;600;700',
  'Noto Naskh Arabic': '400;500;600;700', Amiri: '400;700', Tajawal: '400;500;700', Cairo: '400;500;600;700', 'Reem Kufi': '400;500;600;700',
};
export function useDesignFonts(design) {
  useEffect(() => {
    for (const font of [design?.heading_font, design?.arabic_font]) {
      if (!font || !FONT_WEIGHTS[font]) continue;
      const id = `font-${font.replace(/\s+/g, '-')}`;
      if (document.getElementById(id)) continue;
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}:wght@${FONT_WEIGHTS[font]}&display=swap`;
      document.head.appendChild(link);
    }
  }, [design?.heading_font, design?.arabic_font]);
}

/** The design as CSS variables on the page (colours are checked by the server). */
export function designStyle(d) {
  if (!d) return undefined;
  return {
    '--inv-bg': d.background,
    '--inv-card': d.card,
    '--inv-accent': d.accent,
    '--inv-heading': d.heading,
    '--inv-text': d.text,
    '--inv-on-accent': d.on_accent,
    '--inv-on-bg': d.on_background,
    '--inv-font-heading': ['IBM Plex Sans', 'Montserrat'].includes(d.heading_font)
      ? `'${d.heading_font}', 'Helvetica Neue', Arial, sans-serif` : `'${d.heading_font}', Georgia, serif`,
    '--inv-font-ar': `'${d.arabic_font}', 'IBM Plex Sans Arabic', sans-serif`,
    ...(d.layout === 'photo' && d.cover_url && {
      backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), url("${d.cover_url}")`,
    }),
  };
}

/**
 * The invitation itself. Used by the guest's page and, with `preview`, by the
 * design editor (nothing is sent; the RSVP buttons only change the preview).
 */
export function InvitationView({ data, lang, setLang, token, onReload, preview = false }) {
  const [editing, setEditing] = useState(false);
  const d = data.design;
  useDesignFonts(d);
  const t = T[lang];

  const { event: e, guest: g, wallet } = data;
  const ar = lang === 'ar';
  const pick = (en, arV) => (ar && arV) || en;
  const name = ar && g.name_ar ? g.name_ar : [g.title, g.first_name, g.last_name].filter(Boolean).join(' ');
  const responded = g.rsvp_status !== 'pending';
  const showForm = !data.rsvp_closed && (!responded || editing);
  const base = `/api/public/invite/${token}`;
  const ua = navigator.userAgent;
  const isApple = /iPhone|iPad|Macintosh/.test(ua);
  const isAndroid = /Android/.test(ua);
  const kicker = (ar ? d?.kicker_ar : d?.kicker_en) || t.invited;
  const closing = ar ? d?.closing_ar : d?.closing_en;
  const layout = d?.layout || 'card';

  return (
    <div className={`invite-page layout-${layout} ${preview ? 'is-preview' : ''}`} dir={ar ? 'rtl' : 'ltr'} style={designStyle(d)}>
      <button className="lang-toggle" onClick={() => setLang(ar ? 'en' : 'ar')}>{t.lang}</button>
      <article className="invite-card">
        {layout === 'card' && d?.cover_url && <img className="invite-cover" src={d.cover_url} alt="" />}
        <div className="invite-body">
          {(!d || d.logo === 'yax') && <Logo height={30} className="invite-logo" />}
          {d?.logo === 'custom' && <img className="invite-own-logo" src={d.logo_url} alt={data.org} />}
          <p className="invite-kicker">{kicker}</p>
          <p className="invite-guest">{t.dear} {name}</p>
          <p className="invite-host">{pick(e.host_name, e.host_name_ar) || data.org} {t.invites}</p>
          <h1 className="invite-title">{pick(e.name, e.name_ar)}</h1>
          {pick(e.description, e.description_ar) && <p className="invite-desc">{pick(e.description, e.description_ar)}</p>}

          <dl className="invite-details">
            <div><dt>{t.when}</dt><dd>{fmt(e.starts_at, lang)}</dd></div>
            {e.venue && (
              <div>
                <dt>{t.where}</dt>
                <dd>{pick(e.venue, e.venue_ar)}{e.venue_address && <><br /><span className="muted">{e.venue_address}</span></>}
                  {(e.venue_lat != null || e.venue_address) && (
                    <><br /><a target="_blank" rel="noreferrer" href={e.venue_lat != null ? `https://maps.google.com/?q=${e.venue_lat},${e.venue_lng}` : `https://maps.google.com/?q=${encodeURIComponent(e.venue_address)}`}>{t.map}</a></>
                  )}
                </dd>
              </div>
            )}
            {e.dress_code && <div><dt>{t.dress}</dt><dd>{pick(e.dress_code, e.dress_code_ar)}</dd></div>}
          </dl>

          <section className="invite-rsvp">
            {showForm ? (
              <RsvpForm t={t} guest={g} companions={data.companions} token={token} preview={preview} deadline={e.rsvp_deadline && fmt(e.rsvp_deadline, lang)}
                onDone={() => { setEditing(false); onReload?.(); }} />
            ) : (
              <div className="rsvp-done">
                <p className="invite-kicker">{t.yourResponse}</p>
                <p className="rsvp-status">{t.statusLabel[g.rsvp_status] || '—'}{g.rsvp_status === 'attending' && g.rsvp_party_size > 1 ? ` (${g.rsvp_party_size})` : ''}</p>
                {responded && <p>{t.thanks[g.rsvp_status]}</p>}
                {data.companions.length > 0 && <p className="muted">{data.companions.map((c) => [c.first_name, c.last_name].filter(Boolean).join(' ')).join(' · ')}</p>}
                {data.rsvp_closed ? <p className="muted small">{t.closed}</p> : <button className="invite-link-btn" onClick={() => setEditing(true)}>{t.change}</button>}
              </div>
            )}
          </section>

          {g.rsvp_status === 'attending' && (
            <section className="invite-pass">
              <p className="invite-kicker">{t.pass}</p>
              {preview ? <div className="invite-qr invite-qr-sample" aria-label="QR code" /> : <img className="invite-qr" src={`${base}/qr.svg`} alt="QR code" width="180" height="180" />}
              <p className="muted small">{t.passHint}</p>
              {(g.table || g.seat) && (
                <div className="invite-seat">
                  {g.table && <div><span>{t.table}</span><strong>{g.table}</strong></div>}
                  {g.seat && <div><span>{t.seat}</span><strong>{g.seat}</strong></div>}
                </div>
              )}
              <div className="wallet-buttons">
                {(preview || (wallet.apple && !isAndroid)) && <a className="wallet-btn apple" href={preview ? undefined : `${base}/pass.pkpass`}>{t.apple}</a>}
                {(preview || (wallet.google && !isApple)) && <a className="wallet-btn google" href={preview ? undefined : `${base}/google-wallet`}>{t.google}</a>}
                <a className="wallet-btn cal" href={preview ? undefined : `${base}/event.ics`}>{t.calendar}</a>
              </div>
            </section>
          )}

          {closing && <p className="invite-closing">{closing}</p>}
        </div>
      </article>
    </div>
  );
}

function RsvpForm({ t, guest, companions: existing, token, deadline, onDone, preview }) {
  const [status, setStatus] = useState(guest.rsvp_status === 'pending' ? '' : guest.rsvp_status);
  const [companions, setCompanions] = useState(existing.map((c) => [c.first_name, c.last_name].filter(Boolean).join(' ')));
  const [dietary, setDietary] = useState(guest.dietary || '');
  const [message, setMessage] = useState(guest.rsvp_message || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (preview) return; // the design preview never sends anything
    setBusy(true);
    setError(null);
    try {
      await api.post(`/public/invite/${token}/rsvp`, { status, companions: companions.filter((c) => c.trim()), dietary, message });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2 className="rsvp-q">{t.rsvp}</h2>
      {deadline && <p className="muted small">{t.by} {deadline}</p>}
      <div className="rsvp-choices">
        {[['attending', t.yes], ['declined', t.no], ['tentative', t.maybe]].map(([k, label]) => (
          <button type="button" key={k} className={`rsvp-choice ${status === k ? 'on' : ''}`} onClick={() => setStatus(k)}>{label}</button>
        ))}
      </div>
      {status === 'attending' && (
        <div className="rsvp-extra">
          {guest.plus_ones_allowed > 0 && (
            <>
              <p className="small">{t.companions(guest.plus_ones_allowed)}</p>
              {companions.map((c, i) => (
                <input key={i} value={c} placeholder={t.companion} onChange={(e) => setCompanions((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))} />
              ))}
              {companions.length < guest.plus_ones_allowed && (
                <button type="button" className="invite-link-btn" onClick={() => setCompanions((cs) => [...cs, ''])}>{t.addCompanion}</button>
              )}
            </>
          )}
          <input value={dietary} placeholder={t.dietary} onChange={(e) => setDietary(e.target.value)} />
        </div>
      )}
      {status && <textarea rows={2} value={message} placeholder={t.message} onChange={(e) => setMessage(e.target.value)} />}
      {error && <p className="invite-error">{error}</p>}
      <button className="invite-submit" disabled={!status || busy}>{busy ? t.sending : t.send}</button>
    </form>
  );
}
