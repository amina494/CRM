import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Badge, guestName } from '../components/ui.jsx';
import { CATEGORIES } from '../constants.js';

/** Door check-in: scan the QR code on the guest's wallet pass or type the code. */
export default function CheckIn() {
  const { event, can } = useApp();
  const canEdit = can.handle;
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const inputRef = useRef(null);
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  async function submit(token) {
    if (!token) return;
    setError(null);
    try {
      setResult(await api.post('/check-in', { code: token, event_id: event.id }));
      setCode('');
    } catch (err) {
      setResult(null);
      setError(err.message);
    }
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (!scanning) return undefined;
    let stream;
    let stop = false;
    let last = '';
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        while (!stop) {
          const codes = await detector.detect(videoRef.current).catch(() => []);
          const value = codes[0]?.rawValue;
          if (value && value !== last) { last = value; await submit(value); }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (err) {
        setError(`Camera unavailable: ${err.message}`);
        setScanning(false);
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [scanning]);

  const g = result?.guest;
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>Check-in</h1><p className="muted">Scan the QR code on the guest's wallet pass or invitation page. It holds an entrance code that only works here: it cannot open the guest's invitation.</p></div></div>
      {!canEdit ? <div className="alert alert-warn">Your role is read-only.</div> : (
        <section className="card">
          <form className="checkin-form" onSubmit={(e) => { e.preventDefault(); submit(code.trim()); }}>
            <input ref={inputRef} autoFocus placeholder="Scan or type the entrance code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn btn-primary">Check in</button>
            {canScan && <button type="button" className="btn btn-ghost" onClick={() => setScanning((s) => !s)}>{scanning ? 'Stop camera' : 'Use camera'}</button>}
          </form>
          {scanning && <video ref={videoRef} className="scanner" muted playsInline />}
        </section>
      )}
      {error && <div className="alert alert-error big-alert">{error}</div>}
      {g && (
        <section className={`card checkin-result ${result.already ? 'already' : 'fresh'}`}>
          <div className="checkin-status">{result.already ? 'Already checked in' : 'Welcome ✓'}</div>
          <h2><Link to={`/guests/${g.id}`}>{guestName(g)}</Link></h2>
          {g.name_ar && <div className="arabic">{g.name_ar}</div>}
          <div className="badges"><Badge value={g.category} label={CATEGORIES[g.category]} /></div>
          <div className="checkin-seat">
            <div><span className="muted small">Table</span><strong>{g.table_name || '—'}</strong></div>
            <div><span className="muted small">Seat</span><strong>{g.seat_number || '—'}</strong></div>
            <div><span className="muted small">Party</span><strong>{g.rsvp_party_size || 1}</strong></div>
          </div>
          <div className="small">Host: <strong>{g.host_name || 'Unassigned'}</strong>{g.lead_name && <> · With {g.lead_name}</>}</div>
          {g.dietary && <div className="small warn">Dietary: {g.dietary}</div>}
          {result.party.length > 0 && (
            <div className="checkin-party">
              <div className="muted small">Same party</div>
              {result.party.map((p) => (
                <div key={p.id} className="checkin-party-row">
                  <span>{guestName(p)} <span className="muted small">{p.relationship}</span></span>
                  {p.checked_in_at ? <span className="small ok">✓ in</span> : canEdit && (
                    <button className="btn btn-ghost btn-sm" onClick={async () => {
                      await api.post(`/guests/${p.id}/check-in`);
                      setResult((r) => ({ ...r, party: r.party.map((x) => (x.id === p.id ? { ...x, checked_in_at: new Date().toISOString() } : x)) }));
                    }}>Check in</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
