-- Guest CRM schema. All times are stored as ISO-8601 strings in the
-- event's local time (e.g. "2026-11-12T19:30"), except audit timestamps
-- (created_at / recorded_at / sent_at) which are UTC ISO strings.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'coordinator'
                CHECK (role IN ('admin','coordinator','liaison','viewer')),
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  description     TEXT,
  description_ar  TEXT,
  venue           TEXT,
  venue_ar        TEXT,
  venue_address   TEXT,
  venue_lat       REAL,
  venue_lng       REAL,
  starts_at       TEXT,
  ends_at         TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  dress_code      TEXT,
  dress_code_ar   TEXT,
  rsvp_deadline   TEXT,
  host_name       TEXT,
  host_name_ar    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS hotels (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  address        TEXT,
  phone          TEXT,
  contact_person TEXT,
  contact_phone  TEXT,
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS seating_tables (
  id        INTEGER PRIMARY KEY,
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  zone      TEXT,
  capacity  INTEGER NOT NULL DEFAULT 10,
  notes     TEXT
);

CREATE TABLE IF NOT EXISTS drivers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  license_no  TEXT,
  languages   TEXT,
  status      TEXT NOT NULL DEFAULT 'available'
              CHECK (status IN ('available','on_duty','off_duty')),
  access_token TEXT NOT NULL UNIQUE,
  last_lat    REAL,
  last_lng    REAL,
  last_seen_at TEXT,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS vehicles (
  id        INTEGER PRIMARY KEY,
  plate     TEXT NOT NULL,
  make      TEXT,
  model     TEXT,
  color     TEXT,
  type      TEXT NOT NULL DEFAULT 'sedan'
            CHECK (type IN ('sedan','suv','van','bus','limousine','other')),
  capacity  INTEGER NOT NULL DEFAULT 3,
  status    TEXT NOT NULL DEFAULT 'available'
            CHECK (status IN ('available','in_use','maintenance')),
  notes     TEXT
);

CREATE TABLE IF NOT EXISTS guests (
  id                INTEGER PRIMARY KEY,
  event_id          INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title             TEXT,
  first_name        TEXT NOT NULL,
  last_name         TEXT,
  name_ar           TEXT,
  email             TEXT,
  phone             TEXT,
  organization      TEXT,
  position          TEXT,
  nationality       TEXT,
  category          TEXT NOT NULL DEFAULT 'general'
                    CHECK (category IN ('vvip','vip','delegation','media','general','companion','staff')),
  language          TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
  party_lead_id     INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  relationship      TEXT,
  plus_ones_allowed INTEGER NOT NULL DEFAULT 0,
  dietary           TEXT,
  notes             TEXT,
  source            TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','import','rsvp')),

  -- Internal ownership & logistics
  host_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  table_id          INTEGER REFERENCES seating_tables(id) ON DELETE SET NULL,
  seat_number       TEXT,
  vehicle_id        INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id         INTEGER REFERENCES drivers(id) ON DELETE SET NULL,

  -- Invitation & RSVP
  invite_token      TEXT NOT NULL UNIQUE,
  invite_status     TEXT NOT NULL DEFAULT 'not_sent'
                    CHECK (invite_status IN ('not_sent','sent','opened','failed')),
  invited_at        TEXT,
  opened_at         TEXT,
  rsvp_status       TEXT NOT NULL DEFAULT 'pending'
                    CHECK (rsvp_status IN ('pending','attending','declined','tentative')),
  rsvp_at           TEXT,
  rsvp_party_size   INTEGER,
  rsvp_message      TEXT,
  checked_in_at     TEXT,

  -- Live tracking
  current_status    TEXT NOT NULL DEFAULT 'not_arrived'
                    CHECK (current_status IN ('not_arrived','in_flight','landed','in_transit',
                                              'at_hotel','at_venue','out','departed')),
  current_location  TEXT,
  status_updated_at TEXT,

  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_guests_event ON guests(event_id);
CREATE INDEX IF NOT EXISTS idx_guests_lead ON guests(party_lead_id);

CREATE TABLE IF NOT EXISTS accommodations (
  id               INTEGER PRIMARY KEY,
  guest_id         INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  hotel_id         INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_number      TEXT,
  room_type        TEXT,
  check_in         TEXT,
  check_out        TEXT,
  confirmation_no  TEXT,
  status           TEXT NOT NULL DEFAULT 'reserved'
                   CHECK (status IN ('reserved','checked_in','checked_out','cancelled')),
  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_accom_guest ON accommodations(guest_id);

-- service_type: 'tanfeethi' = executive / private aviation terminal with protocol
-- handling; 'general' = commercial flight through the general terminal.
CREATE TABLE IF NOT EXISTS flights (
  id               INTEGER PRIMARY KEY,
  event_id         INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL DEFAULT 'arrival' CHECK (direction IN ('arrival','departure')),
  service_type     TEXT NOT NULL DEFAULT 'general' CHECK (service_type IN ('tanfeethi','general')),
  airline          TEXT,
  flight_number    TEXT,
  tail_number      TEXT,
  origin           TEXT,
  destination      TEXT,
  terminal         TEXT,
  scheduled_at     TEXT,
  estimated_at     TEXT,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','delayed','departed','landed','cancelled')),
  extra_passengers TEXT,
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS flight_passengers (
  flight_id INTEGER NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  guest_id  INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  seat      TEXT,
  PRIMARY KEY (flight_id, guest_id)
);

CREATE TABLE IF NOT EXISTS transfers (
  id            INTEGER PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'custom'
                CHECK (kind IN ('airport_pickup','airport_dropoff','to_venue','from_venue','custom')),
  pickup        TEXT,
  dropoff       TEXT,
  scheduled_at  TEXT,
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id     INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  flight_id     INTEGER REFERENCES flights(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','en_route','picked_up','completed','cancelled')),
  started_at    TEXT,
  picked_up_at  TEXT,
  completed_at  TEXT,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS transfer_passengers (
  transfer_id INTEGER NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  guest_id    INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  PRIMARY KEY (transfer_id, guest_id)
);

-- Movement history: every status change for a guest, from staff, drivers or system.
CREATE TABLE IF NOT EXISTS movements (
  id          INTEGER PRIMARY KEY,
  guest_id    INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  location    TEXT,
  note        TEXT,
  transfer_id INTEGER REFERENCES transfers(id) ON DELETE SET NULL,
  recorded_by TEXT,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_guest ON movements(guest_id, recorded_at);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY,
  guest_id    INTEGER REFERENCES guests(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('email','whatsapp','sms')),
  recipient   TEXT NOT NULL,
  subject     TEXT,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('sent','logged','failed')),
  error       TEXT,
  provider_id TEXT,
  sent_by     TEXT,
  sent_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY,
  event_id   INTEGER,
  guest_id   INTEGER,
  actor      TEXT,
  action     TEXT NOT NULL,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_event ON activity_log(event_id, created_at);

-- ---------------------------------------------------------------------
-- Security additions. New COLUMNS on the tables above are added by
-- migrate() in db.js so that existing databases are upgraded in place.
-- ---------------------------------------------------------------------

-- Which staff may work on which event, and in what capacity. Admins see
-- every event and need no rows here.
CREATE TABLE IF NOT EXISTS event_members (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL DEFAULT 'liaison' CHECK (role IN ('coordinator','liaison','viewer')),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_members_user ON event_members(user_id);

-- Failed sign-in and password-reset attempts, kept in the database so the
-- throttle survives a restart.
CREATE TABLE IF NOT EXISTS auth_attempts (
  key TEXT NOT NULL,
  at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts ON auth_attempts(key, at);

-- Images for an event's invitation design (cover photo, own logo). Kept in
-- the database so a backup of the one file includes them. The id is random,
-- because the invitation page shows them without signing in.
CREATE TABLE IF NOT EXISTS event_assets (
  id         TEXT PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('cover','logo')),
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_event_assets_event ON event_assets(event_id, kind);

-- One-time password reset links. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
