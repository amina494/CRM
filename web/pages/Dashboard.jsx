import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { Badge, Empty, Loading, ServiceBadge, fmtAgo, fmtTime, useApi } from '../components/ui.jsx';
import { CATEGORIES, FLIGHT_STATUS, GUEST_STATUS, RSVP, TONE, TRANSFER_KIND, TRANSFER_STATUS } from '../constants.js';

export default function Dashboard() {
  const { event } = useApp();
  const { data, error } = useApi(`/events/${event.id}/dashboard`, { poll: 30000 });
  if (!data) return <Loading error={error} />;
  const { rsvp, invites, status, category, totals } = data;
  const invited = (invites.sent || 0) + (invites.opened || 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{fmtTime(event.starts_at)} · {event.venue || 'Venue TBC'}</p>
        </div>
        <div className="actions">
          <Link className="btn btn-ghost" to="/check-in">Check-in</Link>
          <Link className="btn btn-primary" to="/guests">Manage guests</Link>
        </div>
      </div>

      <div className="stats">
        <Stat label="Guests on list" value={totals.guests} />
        <Stat label="Invitations sent" value={invited} sub={`${invites.opened || 0} opened`} />
        <Stat label="Attending" value={rsvp.attending || 0} sub={`Headcount ${totals.expected_headcount || 0}`} tone="green" />
        <Stat label="Awaiting reply" value={(rsvp.pending || 0) + (rsvp.tentative || 0)} sub={`${rsvp.declined || 0} declined`} tone="amber" />
        <Stat label="Checked in" value={totals.checked_in || 0} tone="blue" />
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Response breakdown</h2>
          <Bars data={rsvp} labels={RSVP} total={totals.guests} />
          <h3 className="mt">By category</h3>
          <Bars data={category} labels={CATEGORIES} total={totals.guests} />
        </section>
        <section className="card">
          <h2>Where everyone is</h2>
          <Bars data={status} labels={GUEST_STATUS} total={totals.guests} />
          <h3 className="mt">Needs attention</h3>
          <ul className="todo">
            <Todo n={totals.without_host} to="/guests?host=none">guests without an assigned host</Todo>
            <Todo n={totals.unhoused} to="/accommodation">attending guests without accommodation</Todo>
            <Todo n={totals.attending_unseated} to="/seating">attending guests without a seat</Todo>
            <Todo n={invites.not_sent} to="/guests?invite=not_sent">guests not yet invited</Todo>
            <Todo n={invites.failed} to="/guests?invite=failed">invitations that failed to send</Todo>
          </ul>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Flights today</h2><Link to="/flights" className="link">All flights</Link></div>
          {!data.flightsToday.length ? <Empty>No flights today.</Empty> : (
            <table className="table compact">
              <tbody>
                {data.flightsToday.map((f) => (
                  <tr key={f.id}>
                    <td className="nowrap">{(f.estimated_at || f.scheduled_at)?.slice(11, 16)}</td>
                    <td><strong>{f.flight_number || f.tail_number}</strong> <span className="muted small">{f.direction === 'arrival' ? `from ${f.origin || '—'}` : `to ${f.destination || '—'}`}</span></td>
                    <td><ServiceBadge type={f.service_type} /></td>
                    <td>{f.passenger_count} pax</td>
                    <td><Badge value={f.status} label={FLIGHT_STATUS[f.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Trips today</h2><Link to="/transfers" className="link">Movements board</Link></div>
          {!data.transfersToday.length ? <Empty>No trips scheduled today.</Empty> : (
            <table className="table compact">
              <tbody>
                {data.transfersToday.map((t) => (
                  <tr key={t.id}>
                    <td className="nowrap">{t.scheduled_at?.slice(11, 16)}</td>
                    <td>
                      <div>{TRANSFER_KIND[t.kind]}: {t.passenger_names || '—'}</div>
                      <div className="muted small">{t.driver_name || 'No driver'} · {t.vehicle_plate || 'No car'}</div>
                    </td>
                    <td><Badge value={t.status} label={TRANSFER_STATUS[t.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Latest movements</h2>
        {!data.recentMovements.length ? <Empty>No movements recorded yet.</Empty> : (
          <ul className="timeline">
            {data.recentMovements.map((m) => (
              <li key={m.id}>
                <Badge value={m.status} label={GUEST_STATUS[m.status]} />
                <Link to={`/guests/${m.guest_id}`}>{[m.title, m.first_name, m.last_name].filter(Boolean).join(' ')}</Link>
                {m.location && <span className="muted"> · {m.location}</span>}
                <span className="muted small right">{m.recorded_by} · {fmtAgo(m.recorded_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? 0}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Bars({ data, labels, total }) {
  const entries = Object.entries(labels).filter(([k]) => data[k]);
  if (!entries.length) return <Empty>No data yet.</Empty>;
  return (
    <div className="bars">
      {entries.map(([k, label]) => (
        <div className="bar-row" key={k}>
          <span className="bar-label">{label}</span>
          <span className="bar-track"><span className={`bar-fill tone-${TONE[k] || 'gray'}`} style={{ width: `${(data[k] / Math.max(total, 1)) * 100}%` }} /></span>
          <span className="bar-value">{data[k]}</span>
        </div>
      ))}
    </div>
  );
}

function Todo({ n, to, children }) {
  if (!n) return null;
  return <li><Link to={to}><strong>{n}</strong> {children}</Link></li>;
}
