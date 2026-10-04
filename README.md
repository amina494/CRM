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
- **Cars & drivers**: the fleet. Each driver gets a **private mobile link** (`/d/<token>`, which you can send over WhatsApp from the app). It shows the driver their trips. The driver taps *Start → Picked up → Dropped off*, and the passengers' locations update live (for example, an airport pickup ends with the guest "At hotel"). Drivers can also share their GPS position.
- **Check-in**: scan the QR code from the wallet pass (camera on supported browsers, or a handheld scanner, or type the code). The screen shows the guest's table, seat and host, and you can check in the rest of their party from there too.
- **Outbox**: every message sent, with its delivery status.
- **Staff**: roles are *admin*, *coordinator*, *liaison/host* and *viewer* (read-only).
- **Events**: run several events. Hotels, cars, drivers and staff are shared between them.

## Running it

Requires **Node.js 22.13+** (uses the built-in SQLite, so there are no native dependencies).

```bash
npm install
npm run seed      # optional: demo event with guests, flights, hotels, cars (login admin@example.com / admin1234)
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

In production, set `NODE_ENV=production`, set a strong `SESSION_SECRET` and serve it over HTTPS (behind a reverse proxy such as nginx or Caddy). Back up the SQLite file in `data/` regularly.

## Notes

- **Times** are entered and shown in the event's local time (default `Asia/Riyadh`). Calendar files and wallet passes convert them correctly.
- **Companions**: a plus-one named by the guest becomes a guest record linked to the lead. Staff can add aides, security or family the same way ("Add companion"), and each can have their own room, seat, flight and car.
- **Branding**: YAX orange (`#ef5f22`) with charcoal, set at the top of `web/styles.css` (`--brand`, `--accent`) and in `server/brand.js` for emails and wallet passes. Fonts are IBM Plex Sans / Plex Sans Arabic / Plex Serif. The staff app follows the device's light or dark setting, with an Auto / Light / Dark switch in the sidebar.
- **Privacy**: the public invitation page exposes only what the guest needs (no email, phone or internal notes). Invitation and driver links are random 144-bit tokens, and a driver link can be reset at any time.

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
