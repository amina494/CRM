import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { Loading } from './components/ui.jsx';
import Logo from './components/Logo.jsx';
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
import Audit from './pages/Audit.jsx';
import InvitationDesign from './pages/InvitationDesign.jsx';
import ImportEvent from './pages/ImportEvent.jsx';
import Security from './pages/Security.jsx';
import ResetPassword from './public-pages/ResetPassword.jsx';
import Invite from './public-pages/Invite.jsx';
import DriverPortal from './public-pages/DriverPortal.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  return (
    <Routes>
      <Route path="/i/:token" element={<Invite />} />
      <Route path="/d/:token" element={<DriverPortal />} />
      <Route path="/reset/:token" element={<ResetPassword />} />
      <Route path="/*" element={<StaffApp />} />
    </Routes>
  );
}

// [path, label, icon, who sees it]. The server enforces every rule; hiding
// menu items only keeps the screen tidy.
const NAV = [
  ['/', 'Dashboard', '◧', (c) => c.overview],
  ['/guests', 'Guests & RSVP', '☰', () => true],
  ['/transfers', 'Movements', '➜', () => true],
  ['/flights', 'Flights', '✈', () => true],
  ['/accommodation', 'Accommodation', '⌂', () => true],
  ['/seating', 'Seating', '◎', (c) => c.overview],
  ['/fleet', 'Cars & drivers', '⛟', () => true],
  ['/check-in', 'Check-in', '✓', (c) => c.handle],
  ['/messages', 'Outbox', '✉', (c) => c.overview],
  ['/staff', 'Staff', '☺', () => true],
  ['/events', 'Events', '★', () => true],
  ['/audit', 'Audit trail', '⌕', (c) => c.admin],
];

const RANK = { viewer: 1, liaison: 2, coordinator: 3, admin: 4 };

/** What the signed-in person may do on the selected event. */
function permissions(me, event) {
  const role = event?.my_role || (me?.role === 'admin' ? 'admin' : null);
  const at = (min) => Boolean(role) && RANK[role] >= RANK[min];
  return {
    role,
    admin: me?.role === 'admin',
    manage: at('coordinator'), // add guests, logistics, seating
    handle: at('liaison'), // edit own guests, record movements, check in
    liaison: role === 'liaison',
    overview: Boolean(role) && role !== 'liaison', // dashboard, seating, outbox
    fleet: me?.role === 'admin' || Boolean(me?.memberships?.some((m) => m.role === 'coordinator')),
  };
}

const ROLE_LABEL = { admin: 'Admin', coordinator: 'Coordinator', liaison: 'Liaison / host', viewer: 'Viewer' };

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

  const loadMe = () => api.get('/auth/me').then(setMe).catch(() => setMe(null));
  useEffect(() => { loadMe(); }, []);

  useEffect(() => {
    if (!me || me.totp_setup_required) return;
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
    const chosen = events.find((e) => e.id === eventId);
    if (chosen) return chosen;
    // Default to the next event coming up (or the most recent past one).
    const now = new Date().toISOString().slice(0, 16);
    const upcoming = events.filter((e) => (e.ends_at || e.starts_at || '') >= now)
      .sort((a, b) => (a.starts_at || '').localeCompare(b.starts_at || ''));
    return upcoming[0] || events[0];
  }, [events, eventId]);

  const can = useMemo(() => permissions(me, event), [me, event]);
  const ctx = useMemo(() => ({
    me, meta, event, events, setEventId, reloadEvents: loadEvents, reloadMe: loadMe, can,
    canEdit: can.manage, isAdmin: can.admin,
  }), [me, meta, event, events, can]);

  if (me === undefined) return <Loading />;
  if (!me) return <Login onLogin={loadMe} />;
  // Roles that must use a one-time code set it up before anything else.
  if (me.totp_setup_required) {
    return (
      <Ctx.Provider value={ctx}>
        <div className="setup-gate"><Security forced onDone={loadMe} /></div>
      </Ctx.Provider>
    );
  }
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
            <Logo height={26} className="brand-logo" />
            <div className="brand-sub">Guest management</div>
          </div>
          {events.length > 0 && (
            <select className="event-select" value={event?.id || ''} onChange={(e) => setEventId(Number(e.target.value))}>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          <nav>
            {NAV.filter((n) => n[3](can)).map(([to, label, icon]) => (
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
              <div className="me-role">{ROLE_LABEL[can.role] || 'No access to this event'}</div>
              <NavLink to="/security" className="me-link">Sign-in security</NavLink>
            </div>
            <button className="btn btn-ghost btn-sm on-dark" onClick={logout}>Sign out</button>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">☰</button>
            <Logo height={18} className="brand-logo" />
            <div className="topbar-title">{event?.name || 'No event yet'}</div>
          </header>
          <main className="content">
            {!event && !['/events', '/staff', '/security', '/audit'].includes(location.pathname) && !location.pathname.startsWith('/events/') ? (
              <Navigate to="/events" replace />
            ) : (
              <Routes>
                <Route path="/" element={can.overview ? <Dashboard /> : <Navigate to="/guests" replace />} />
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
                <Route path="/events/import" element={can.admin ? <ImportEvent /> : <Navigate to="/events" replace />} />
                <Route path="/events/:id/design" element={<InvitationDesign />} />
                <Route path="/security" element={<Security />} />
                <Route path="/audit" element={can.admin ? <Audit /> : <Navigate to="/" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
