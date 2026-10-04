import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';

const KIND = { airport_pickup: 'Airport pickup', airport_dropoff: 'Airport drop-off', to_venue: 'To venue', from_venue: 'From venue', custom: 'Trip' };
const STATUS = { scheduled: 'Scheduled', en_route: 'On the way', picked_up: 'Passengers on board', completed: 'Completed', cancelled: 'Cancelled' };
const NEXT = { scheduled: ['en_route', 'Start – heading to pickup'], en_route: ['picked_up', 'Passengers picked up'], picked_up: ['completed', 'Passengers dropped off'] };
const maps = (place) => `https://maps.google.com/?q=${encodeURIComponent(place)}`;

/** Mobile trip sheet for a driver, opened from their private link. */
export default function DriverPortal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(null);
  const watchId = useRef(null);
  const lastSent = useRef(0);

  const load = () => api.get(`/public/driver/${token}`).then(setData).catch(setError);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [token]);
  useEffect(() => { document.title = 'Trip sheet'; }, []);

  useEffect(() => {
    if (!sharing) return undefined;
    if (!navigator.geolocation) { setSharing(false); return undefined; }
    watchId.current = navigator.geolocation.watchPosition((pos) => {
      if (Date.now() - lastSent.current < 20000) return;
      lastSent.current = Date.now();
      api.post(`/public/driver/${token}/location`, { lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {});
    }, () => setSharing(false), { enableHighAccuracy: true });
    return () => navigator.geolocation.clearWatch(watchId.current);
  }, [sharing, token]);

  async function advance(t, status) {
    setBusy(t.id);
    try {
      await api.post(`/public/driver/${token}/transfers/${t.id}/status`, { status });
      await load();
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="driver-page"><p className="driver-empty">This link is not valid. Please contact the operations desk.</p></div>;
  if (!data) return <div className="driver-page"><p className="driver-empty">Loading…</p></div>;

  const active = data.transfers.filter((t) => t.status !== 'completed');
  const done = data.transfers.filter((t) => t.status === 'completed');

  return (
    <div className="driver-page">
      <header className="driver-head">
        <div>
          <div className="driver-hello">Hello, {data.driver.name}</div>
          <div className="driver-sub">{active.length} trip{active.length === 1 ? '' : 's'} to do</div>
        </div>
        <button className={`driver-share ${sharing ? 'on' : ''}`} onClick={() => setSharing((s) => !s)}>
          {sharing ? '● Sharing location' : 'Share my location'}
        </button>
      </header>

      {!active.length && <p className="driver-empty">No trips assigned right now.</p>}
      {active.map((t) => (
        <section key={t.id} className={`driver-trip status-${t.status}`}>
          <div className="driver-trip-top">
            <span className="driver-time">{t.scheduled_at?.slice(11, 16)}</span>
            <span className="driver-date">{t.scheduled_at?.slice(0, 10) === data.today ? 'Today' : t.scheduled_at?.slice(0, 10)}</span>
            <span className="driver-kind">{KIND[t.kind]}</span>
            <span className="driver-status">{STATUS[t.status]}</span>
          </div>
          {t.flight_number && (
            <div className="driver-flight">
              ✈ {t.flight_number} {t.flight_service === 'tanfeethi' ? '· Executive (Tanfeethi) terminal' : ''} · {t.flight_status}
              {t.flight_time && ` · ${t.flight_time.slice(11, 16)}`}
            </div>
          )}
          <div className="driver-route">
            <a href={maps(t.pickup || '')} target="_blank" rel="noreferrer"><span>From</span>{t.pickup || '—'}</a>
            <a href={maps(t.dropoff || '')} target="_blank" rel="noreferrer"><span>To</span>{t.dropoff || '—'}</a>
          </div>
          <div className="driver-pax">
            {t.passengers.map((p) => (
              <div key={p.id}>
                <strong>{[p.title, p.first_name, p.last_name].filter(Boolean).join(' ')}</strong>
                {p.phone && <a href={`tel:${p.phone}`}>Call</a>}
              </div>
            ))}
          </div>
          {t.vehicle_plate && <div className="driver-car">Car: {t.vehicle_plate} {t.vehicle_label}</div>}
          {t.notes && <div className="driver-notes">{t.notes}</div>}
          {NEXT[t.status] && (
            <button className="driver-action" disabled={busy === t.id} onClick={() => advance(t, NEXT[t.status][0])}>
              {busy === t.id ? '…' : NEXT[t.status][1]}
            </button>
          )}
        </section>
      ))}

      {done.length > 0 && (
        <>
          <h2 className="driver-section">Completed</h2>
          {done.map((t) => (
            <div key={t.id} className="driver-done">{t.scheduled_at?.slice(11, 16)} · {KIND[t.kind]} · {t.passengers.map((p) => p.first_name).join(', ')}</div>
          ))}
        </>
      )}

      {data.dedicated.length > 0 && (
        <>
          <h2 className="driver-section">Your guests</h2>
          {data.dedicated.map((g) => (
            <div key={g.id} className="driver-done">
              <strong>{[g.title, g.first_name, g.last_name].filter(Boolean).join(' ')}</strong>
              {g.current_location && ` · ${g.current_location}`}
              {g.phone && <> · <a href={`tel:${g.phone}`}>Call</a></>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
