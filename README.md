# Guest CRM

A guest management CRM for VIP events: invitations and RSVPs, Apple and Google Wallet passes, and the full internal logistics picture for every guest: host, hotel, seat, flight (Tanfeethi or general), car, driver and live movements.

## What it does

**For guests (public, bilingual English / Arabic)**
- A personal invitation page (`/i/<token>`) with event details, a map link and the dress code.
- RSVP: accept, decline or "not sure yet", name any plus-ones (up to the guest's allowance), dietary needs and a message to the host. Guests can change their answer until the RSVP deadline.
- After accepting, the guest gets a QR entry pass with **Add to Apple Wallet**, **Save to Google Wallet** and **Add to calendar** (.ics). The pass shows their table and seat.

**For staff**
- **Dashboard**: response breakdown, headcount, where everyone is right now, today's flights and trips, and a "needs attention" list (no host, no room, no seat, not invited, failed sends).
- **Guests & RSVP**: filter by response, category (VVIP, VIP, delegation, media…), invitation status, location or host ("My guests"). Party members are listed under their lead. Bulk-send invitations by email, WhatsApp or SMS in each guest's language, bulk-assign hosts, and import or export CSV.
- **Guest profile**: everything on one screen: contact, assigned host, invitation and RSVP history, party (who they travel with), hotel bookings, flights and who else is on them, seat, dedicated car and driver, trips, a movement timeline, messages and an audit trail.
- **Movements**: the trip board for the day. Each trip has passengers, a car, a driver and an optional linked flight. You get a warning when a car or driver is double-booked within an hour.
- **Flights**: arrivals and departures, marked as **Tanfeethi** (executive terminal, protocol handling) or **General** (commercial). Marking a flight *departed* or *landed* updates every passenger's location automatically.
- **Accommodation**: hotels and a rooming list, with check-in/out status. Attending guests without a room are flagged.
- **Seating**: tables and seats. Click "Seat" next to a guest, then click a table.
- **Cars & drivers**: the fleet. Each driver gets a **private mobile link** (`/d/<token>`, which you can send over WhatsApp from the app). It shows the driver their trips. The driver taps *Start → Picked up → Dropped off*, and the passengers' locations update live (for example, an airport pickup ends with the guest "At hotel"). Drivers can also share their GPS position. The link shows passengers by title and first name only, with their host as the contact, and stops working 48 hours after the driver's last trip.
- **Check-in**: scan the QR code from the wallet pass or invitation page (camera on supported browsers, or a handheld scanner, or type the code). The QR holds a separate *entrance code* that can only check the guest in; it cannot open their invitation. The screen shows the guest's table, seat and host, and you can check in the rest of their party from there too.
- **Outbox**: every message sent, with its delivery status.
- **Staff**: each person is given access to specific events, with a role per event (see *Security* below). Admins see everything.
- **Audit trail** (admins): who signed in, viewed or exported guests, changed, deleted or checked in, from which address.
- **Events**: run several events. Hotels, cars, drivers and staff are shared between them.

## Running it

Requires **Node.js 22.13+** (uses the built-in SQLite, so there are no native dependencies).

```bash
npm install
npm run seed      # optional: demo data and one account per role (listed when it finishes)
npm run build     # build the web app
npm start         # http://localhost:3000
```

For development, `npm run dev` runs the API with auto-reload and the Vite dev server on http://localhost:5173.

Without seed data, the first visit asks you to create the admin account.

Run the tests with `npm test`.

## Configuration

Copy `.env.example` to `.env`. Only `PUBLIC_URL` and `SESSION_SECRET` matter at first. Every integration is optional: if a channel isn't configured, its messages are recorded in the Outbox as "logged" rather than sent, so you can try the full workflow before connecting anything.

| Integration | What you need |
|---|---|
| Email | Any SMTP account (`SMTP_*`) |
| WhatsApp / SMS | A Twilio account and WhatsApp sender (`TWILIO_*`). Note that WhatsApp requires an approved template for messages that start a conversation. |
| Apple Wallet | An Apple Developer account, a Pass Type ID certificate exported as PEM (cert + key) and Apple's WWDR certificate (`APPLE_*`) |
| Google Wallet | A Google Pay & Wallet Console issuer ID and a service-account JSON key with Wallet access (`GOOGLE_WALLET_*`) |

In production, set `NODE_ENV=production`, set a strong `SESSION_SECRET` and serve it over HTTPS (behind a reverse proxy such as nginx or Caddy). If there is a reverse proxy, set `TRUST_PROXY=1` (one per proxy in front of the app) so sign-in limits and the audit trail see real visitor addresses; leave it at `0` when people reach the app directly. Back up the SQLite file in `data/` regularly.

## Security

**Who can do what.** Access is given per event. An account is either an *admin* (every event) or *staff*, and staff get a role on each event they work on:

| | Admin | Coordinator | Liaison / host | Viewer |
|---|---|---|---|---|
| See the event | all events | their events | their events | their events |
| Guests | all, delete | all (no delete) | only guests they host or back up, and those guests' companions | all, read-only |
| Add, import, export guests, send invitations | ✓ | ✓ | – | – |
| Change who hosts a guest or their party | ✓ | ✓ | – | – |
| Dashboard, seating, outbox | ✓ | ✓ | – | read-only |
| Hotels, flights, trips | ✓ | ✓ | rows with their guests; can move their guests' trips along | read-only |
| Shared hotels, cars, drivers; driver links | ✓ | ✓ (any event) | – | – |
| Create/delete events, manage staff, audit, data clean-up | ✓ | – | – | – |

Every rule is enforced by the server; the web app only hides what a person cannot use.

**Sign-in.** Sessions last 12 hours and renew while you work. Changing or resetting a password signs out every other device. Ten wrong passwords for an email from one address (or 25 from anywhere) pause sign-in for 15 minutes. *Forgot password* emails a link that works once and expires after 30 minutes; without a mail server, an admin sets a new password instead (in development the link is printed in the server log).

**One-time codes.** Anyone can turn on a code from an authenticator app under *Sign-in security*. With `REQUIRE_2FA=true` (the default when `NODE_ENV=production`) admins and coordinators must set one up the first time they sign in. If someone loses their phone, an admin uses *Reset code* on the Staff screen.

**Links and codes given to outsiders.**
- *Invitation link* (`/i/…`): opens the invitation and RSVP. It cannot check anyone in.
- *Entrance code* (the QR on the pass): checks the guest in at the door, only for staff on that event. It cannot open the invitation.
- *Driver link* (`/d/…`): passengers by title and first name, the host's phone as contact, no guest phone numbers. It expires 48 hours after the driver's last trip (or 7 days after it was issued if there are no trips). *Reset driver link* issues a new one.

**Retention.** Each event keeps guest details for a number of days after it ends (90 by default, set by an admin on the Events screen). After that, an admin can open *Data retention*, see exactly what would be removed and type the event name to remove names, contact details, notes, messages and movement history. Counts (guests, RSVPs, check-ins) are kept.

**Forged requests from other websites.** The sign-in cookie is `SameSite=Lax`, so other sites cannot send it with their form posts, and the API only accepts JSON, which a plain cross-site form cannot send. No extra token is needed.

**Upgrading an existing database.** The new columns and tables are added automatically on start. Staff who existed before become members of every existing event with their previous role, so nobody loses access; review them on the Staff screen. Wallet passes downloaded before the upgrade carry the old code and will not scan: guests should add the pass again from their invitation.

## Notes

- **Times** are entered and shown in the event's local time (default `Asia/Riyadh`). Calendar files and wallet passes convert them correctly.
- **Companions**: a plus-one named by the guest becomes a guest record linked to the lead. Staff can add aides, security or family the same way ("Add companion"), and each can have their own room, seat, flight and car.
- **Branding**: the YAX wordmark is a vector traced from the official logo (`web/assets/yax-wordmark.svg`, drawn in the current text colour; app icon in `web/public/yax-icon.svg`; wallet pass and email PNGs in `server/assets/wallet/` and `web/public/`). Colours are YAX orange (`#ef5f22`) and off-white (`#f1ece9`) with charcoal, set at the top of `web/styles.css` (`--brand`, `--accent`) and in `server/brand.js` for emails and wallet passes. Fonts are IBM Plex Sans / Plex Sans Arabic / Plex Serif. The staff app follows the device's light or dark setting, with an Auto / Light / Dark switch in the sidebar.
- **Privacy**: the public invitation page exposes only what the guest needs (no email, phone or internal notes). Invitation and driver links are random 144-bit tokens; entrance codes are random 96-bit codes.

## Project layout

```
server/            Express API (node:sqlite)
  schema.sql       database schema
  routes/          auth & staff, events, guests & invitations, logistics, public (guest + driver)
  services/        messaging, wallet passes, invitation content, tracking (movement cascade), ics
  seed.js          demo data
web/               React app (Vite)
  pages/           staff screens
  public-pages/    guest invitation, driver trip sheet
test/              API tests (node:test)
```
