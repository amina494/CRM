import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Guests from './pages/Guests.jsx';
import GuestDetail from './pages/GuestDetail.jsx';
import Accommodation from './pages/Accommodation.jsx';
import Seating from './pages/Seating.jsx';
import Flights from './pages/Flights.jsx';
import Transfers from './pages/Transfers.jsx';
import Fleet from './pages/Fleet.jsx';
import CheckIn from './pages/CheckIn.jsx';
import Messages from './pages/Messages.jsx';
import Staff from './pages/Staff.jsx';
import Events from './pages/Events.jsx';
import Invite from './public-pages/Invite.jsx';
import DriverPortal from './public-pages/DriverPortal.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  return (
    <Routes>
      <Route path="/i/:token" element={<Invite />} />
      <Route path="/d/:token" element={<DriverPortal />} />
      <Route path="/*" element={<StaffApp />} />
    </Routes>
  );
}

const NAV = [
  ['/', 'Dashboard', '◧'],
  ['/guests', 'Guests & RSVP', '☰'],
  ['/transfers', 'Movements', '➜'],
  ['/flights', 'Flights', '✈'],
  ['/accommodation', 'Accommodation', '⌂'],
  ['/seating', 'Seating', '◎'],
  ['/fleet', 'Cars & drivers', '⛟'],
  ['/check-in', 'Check-in', '✓'],
  ['/messages', 'Outbox', '✉'],
  ['/staff', 'Staff', '☺'],
  ['/events', 'Events', '★'],
];

function StaffApp() {
  const [me, setMe] = useState(undefined);
  const [meta, setMeta] = useState(null);
  const [events, setEvents] = useState(null);
  const [eventId, setEventIdState] = useState(() => Number(localStorage.getItem('eventId')) || null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  }, [theme]);
  const location = useLocation();
  const navigate = useNavigate();

  const loadEvents = async () => {
    const list = await api.get('/events');
    setEvents(list);
    return list;
  };

  useEffect(() => {
    api.get('/auth/me').then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!me) return;
    api.get('/meta').then(setMeta).catch(() => {});
    loadEvents();
  }, [me]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const setEventId = (id) => {
    setEventIdState(id);
    localStorage.setItem('eventId', String(id));
  };

  const event = useMemo(() => {
    if (!events?.length) return null;
    return events.find((e) => e.id === eventId) || events[0];
  }, [events, eventId]);

  const ctx = useMemo(() => ({
    me, meta, event, events, setEventId, reloadEvents: loadEvents,
    canEdit: me?.role !== 'viewer', isAdmin: me?.role === 'admin',
  }), [me, meta, event, events]);

  if (me === undefined) return <Loading />;
  if (!me) return <Login onLogin={setMe} />;
  if (!events) return <Loading />;

  const logout = async () => {
    await api.post('/auth/logout');
    setMe(null);
    navigate('/');
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="brand">
            <span className="brand-mark" />
            <div>
              <div className="brand-name">{meta?.org || 'Guest CRM'}</div>
              <div className="brand-sub">Guest management</div>
            </div>
          </div>
          {events.length > 0 && (
            <select className="event-select" value={event?.id || ''} onChange={(e) => setEventId(Number(e.target.value))}>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          <nav>
            {NAV.map(([to, label, icon]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon" aria-hidden>{icon}</span>{label}
              </NavLink>
            ))}
          </nav>
          <div className="theme-switch" role="group" aria-label="Theme">
            {[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, label]) => (
              <button key={k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{label}</button>
            ))}
          </div>
          <div className="sidebar-foot">
            <div className="me">
              <div className="me-name">{me.name}</div>
              <div className="me-role">{me.role}</div>
            </div>
            <button className="btn btn-ghost btn-sm on-dark" onClick={logout}>Sign out</button>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">☰</button>
            <div className="topbar-title">{event?.name || 'No event yet'}</div>
          </header>
          <main className="content">
            {!event && location.pathname !== '/events' && location.pathname !== '/staff' ? (
              <Navigate to="/events" replace />
            ) : (
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/guests" element={<Guests />} />
                <Route path="/guests/:id" element={<GuestDetail />} />
                <Route path="/transfers" element={<Transfers />} />
                <Route path="/flights" element={<Flights />} />
                <Route path="/accommodation" element={<Accommodation />} />
                <Route path="/seating" element={<Seating />} />
                <Route path="/fleet" element={<Fleet />} />
                <Route path="/check-in" element={<CheckIn />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/staff" element={<Staff />} />
                <Route path="/events" element={<Events />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
