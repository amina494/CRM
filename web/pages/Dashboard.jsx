import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, BedDouble, Car, CheckCheck, ChevronRight, Hourglass, Mail, MailWarning, Armchair,
  PlaneLanding, PlaneTakeoff, UserX, Users,
} from 'lucide-react';
import { useApp } from '../App.jsx';
import { Badge, CountUp, Loading, ServiceBadge, fmtAgo, fmtTime, useApi } from '../components/ui.jsx';
import { CATEGORIES, FLIGHT_STATUS, GUEST_STATUS, RSVP, TONE, TRANSFER_KIND, TRANSFER_STATUS } from '../constants.js';

export default function Dashboard() {
  const { event, me } = useApp();
  const { data, error } = useApi(`/events/${event.id}/dashboard`, { poll: 30000 });
  if (!data) return <Loading error={error} />;
  const { rsvp, invites, status, category, totals } = data;
  const invited = (invites.sent || 0) + (invites.opened || 0);
  const attending = rsvp.attending || 0;
  const pct = (n, of) => Math.round(((n || 0) / Math.max(of || 0, 1)) * 100);

  return (
    <div className="page dash">
      <div className="page-head">
        <div>
          <h1 className="greeting">{greeting()}, {me?.name?.split(' ')[0] || 'there'}</h1>
          <p className="muted">{event.name} · {fmtTime(event.starts_at)} · {event.venue || 'Venue TBC'}</p>
        </div>
        <div className="actions">
          <Link className="btn btn-ghost pill" to="/check-in"><CheckCheck size={16} /> Check-in</Link>
          <Link className="btn btn-primary pill" to="/guests"><Users size={16} /> Manage guests</Link>
        </div>
      </div>

      <div className="dash-top">
        <section className="hero-card">
          <div className="hero-head">
            <span className="hero-chip">Attending</span>
            <span className="hero-pct">{pct(attending, totals.guests)}% confirmed</span>
          </div>
          <div className="hero-num"><CountUp value={attending} /><span>of {totals.guests || 0} guests</span></div>
          <div className="hero-track"><span className="hero-fill" style={{ width: `${pct(attending, totals.guests)}%` }} /></div>
          <div className="hero-mini">
            <span>{rsvp.tentative || 0} tentative</span>
            <span>{rsvp.pending || 0} pending</span>
            <span>{rsvp.declined || 0} declined</span>
            <span>{invites.not_sent || 0} not invited</span>
          </div>
          <div className="hero-foot">
            <div><small>Expected headcount</small><strong><CountUp value={totals.expected_headcount || 0} /></strong></div>
            <div><small>Checked in</small><strong><CountUp value={totals.checked_in || 0} /></strong></div>
            <Link to="/guests?rsvp=attending" className="hero-btn">View list <ArrowUpRight size={15} /></Link>
          </div>
        </section>

        <div className="tiles">
          <Tile icon={Users} label="Guests on list" value={totals.guests} sub={`${category.vvip || 0} VVIP · ${category.vip || 0} VIP`} to="/guests" />
          <Tile icon={Mail} label="Invitations sent" value={invited} sub={`${pct(invites.opened, invited)}% opened`} tone="up" to="/guests?invite=sent" />
          <Tile icon={Hourglass} label="Awaiting reply" value={(rsvp.pending || 0) + (rsvp.tentative || 0)} sub={`${rsvp.declined || 0} declined`} tone="warn" to="/guests?rsvp=pending" />
          <Tile icon={PlaneLanding} label="Arrived" value={['landed', 'in_transit', 'at_hotel', 'at_venue', 'out'].reduce((s, k) => s + (status[k] || 0), 0)} sub={`${status.in_flight || 0} in the air now`} to="/flights" />
        </div>
      </div>

      <div className="dash-mid">
        <section className="card chart-card">
          <div className="card-head">
            <div>
              <h2>Arrivals &amp; departures</h2>
              <p className="muted small">Passengers on flights, by day</p>
            </div>
            <div className="legend">
              <span><i className="lg-arr" />Arrivals</span>
              <span><i className="lg-dep" />Departures</span>
            </div>
          </div>
          <TravelChart rows={data.travelByDay || []} today={data.today} />
        </section>

        <section className="card attention-card">
          <div className="card-head"><h2>Needs attention</h2></div>
          <div className="attention">
            <Attention n={totals.without_host} icon={UserX} to="/guests?host=none">guests without a host</Attention>
            <Attention n={totals.unhoused} icon={BedDouble} to="/accommodation">attending, no room</Attention>
            <Attention n={totals.attending_unseated} icon={Armchair} to="/seating">attending, no seat</Attention>
            <Attention n={invites.not_sent} icon={Mail} to="/guests?invite=not_sent">not yet invited</Attention>
            <Attention n={invites.failed} icon={MailWarning} to="/guests?invite=failed" tone="bad">invitations failed</Attention>
            {!totals.without_host && !totals.unhoused && !totals.attending_unseated && !invites.not_sent && !invites.failed && (
              <div className="all-set"><CheckCheck size={20} /> All set. Nothing outstanding.</div>
            )}
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Responses</h2>
          <Split data={rsvp} labels={RSVP} />
          <h3 className="mt">By category</h3>
          <Split data={category} labels={CATEGORIES} />
        </section>
        <section className="card">
          <h2>Where everyone is</h2>
          <Split data={status} labels={GUEST_STATUS} />
          <h3 className="mt">Latest movements</h3>
          {!data.recentMovements.length ? <p className="empty">No movements recorded yet.</p> : (
            <ul className="moves">
              {data.recentMovements.slice(0, 6).map((m) => (
                <li key={m.id}>
                  <span className={`dot tone-${TONE[m.status] || 'gray'}`} />
                  <Link to={`/guests/${m.guest_id}`}>{[m.title, m.first_name, m.last_name].filter(Boolean).join(' ')}</Link>
                  <span className="muted small">{GUEST_STATUS[m.status]}{m.location ? ` · ${m.location}` : ''}</span>
                  <span className="muted small right">{fmtAgo(m.recorded_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <TodayBoard flights={data.flightsToday} trips={data.transfersToday} />
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Tile({ icon: Icon, label, value, sub, tone, to }) {
  return (
    <Link to={to} className="tile">
      <div className="tile-top">
        <span className="tile-label">{label}</span>
        <span className="tile-icon"><Icon size={17} /></span>
      </div>
      <div className="tile-value"><CountUp value={value ?? 0} /></div>
      {sub && <span className={`tile-sub ${tone || ''}`}>{sub}</span>}
    </Link>
  );
}

/** Bars for arrivals (orange) and departures (charcoal) on each day, gaps filled in. */
function TravelChart({ rows, today }) {
  const days = useMemo(() => {
    if (!rows.length) return [];
    const by = Object.fromEntries(rows.map((r) => [r.day, r]));
    const out = [];
    const d = new Date(`${rows[0].day}T00:00:00Z`);
    const end = new Date(`${rows[rows.length - 1].day}T00:00:00Z`);
    while (d <= end && out.length < 14) {
      const key = d.toISOString().slice(0, 10);
      out.push({ day: key, arrivals: by[key]?.arrivals || 0, departures: by[key]?.departures || 0 });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }, [rows]);
  if (!days.length) return <p className="empty">No flights with passengers yet.</p>;
  const peak = Math.max(1, ...days.flatMap((d) => [d.arrivals, d.departures]));
  const max = peak <= 4 ? 4 : Math.ceil(peak / 4) * 4; // a round top so the guide lines land on whole numbers
  const ticks = [max, max * 0.75, max / 2, max / 4, 0];
  const pctOf = (v) => `${(v / max) * 100}%`;
  return (
    <div className="chart">
      <div className="chart-area">
        {ticks.map((t) => <div key={t} className="chart-grid" style={{ bottom: pctOf(t) }}><span>{t}</span></div>)}
        <div className="chart-cols">
          {days.map((d, i) => (
            <div className={`chart-day ${d.day === today ? 'is-today' : ''}`} key={d.day} style={{ '--i': i }}>
              <span className="bar arr" style={{ height: pctOf(d.arrivals) }}><b>{d.arrivals} in</b></span>
              <span className="bar dep" style={{ height: pctOf(d.departures) }}><b>{d.departures} out</b></span>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-xs">
        {days.map((d) => (
          <span key={d.day} className={d.day === today ? 'is-today' : ''}>
            {d.day === today ? 'Today' : new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
          </span>
        ))}
      </div>
    </div>
  );
}

function Attention({ n, icon: Icon, to, tone, children }) {
  if (!n) return null;
  return (
    <Link to={to} className={`attn ${tone || ''}`}>
      <span className="attn-icon"><Icon size={17} /></span>
      <span className="attn-n">{n}</span>
      <span className="attn-text">{children}</span>
      <ChevronRight size={17} className="attn-go" />
    </Link>
  );
}

/** One rounded bar split into coloured segments, with a legend underneath. */
function Split({ data, labels }) {
  const entries = Object.entries(labels).filter(([k]) => data[k]);
  const total = entries.reduce((s, [k]) => s + data[k], 0);
  if (!entries.length) return <p className="empty">No data yet.</p>;
  return (
    <div className="split">
      <div className="split-bar">
        {entries.map(([k, label]) => (
          <span key={k} className={`split-seg bar-fill tone-${TONE[k] || 'gray'}`} style={{ flexGrow: data[k] }} title={`${label}: ${data[k]}`} />
        ))}
      </div>
      <div className="split-legend">
        {entries.map(([k, label]) => (
          <span key={k} className="split-item">
            <i className={`dot tone-${TONE[k] || 'gray'}`} />
            <span>{label}</span>
            <strong>{data[k]}</strong>
            <span className="muted small">{Math.round((data[k] / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Today's flights and trips in one list, with pill filters. */
function TodayBoard({ flights, trips }) {
  const [tab, setTab] = useState('all');
  const rows = [
    ...flights.map((f) => ({
      key: `f${f.id}`, kind: 'flight', at: (f.estimated_at || f.scheduled_at || '').slice(11, 16),
      icon: f.direction === 'arrival' ? PlaneLanding : PlaneTakeoff,
      title: <><strong>{f.flight_number || f.tail_number}</strong> {f.direction === 'arrival' ? `from ${f.origin || '—'}` : `to ${f.destination || '—'}`}</>,
      meta: <><ServiceBadge type={f.service_type} /> {f.passenger_count} pax</>,
      status: <Badge value={f.status} label={FLIGHT_STATUS[f.status]} />, to: '/flights',
    })),
    ...trips.map((t) => ({
      key: `t${t.id}`, kind: 'trip', at: t.scheduled_at?.slice(11, 16) || '',
      icon: Car,
      title: <><strong>{TRANSFER_KIND[t.kind]}</strong> {t.passenger_names || '—'}</>,
      meta: <span className="muted">{t.driver_name || 'No driver'} · {t.vehicle_plate || 'No car'}</span>,
      status: <Badge value={t.status} label={TRANSFER_STATUS[t.status]} />, to: '/transfers',
    })),
  ].filter((r) => tab === 'all' || r.kind === tab).sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section className="card today-card">
      <div className="card-head">
        <div>
          <h2>Today</h2>
          <p className="muted small">{flights.length} flights · {trips.length} trips</p>
        </div>
        <div className="pills" role="tablist">
          {[['all', 'All'], ['flight', 'Flights'], ['trip', 'Trips']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </div>
      {!rows.length ? <p className="empty">Nothing scheduled today.</p> : (
        <div className="today-list">
          {rows.map(({ key, at, icon: Icon, title, meta, status, to }) => (
            <Link key={key} to={to} className="today-row">
              <span className="today-time">{at}</span>
              <span className="today-icon"><Icon size={17} /></span>
              <span className="today-main"><span className="today-title">{title}</span><span className="today-meta">{meta}</span></span>
              <span className="today-status">{status}</span>
              <ChevronRight size={17} className="attn-go" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
