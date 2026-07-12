-- Ticket Booking System - PostgreSQL schema
-- Run via: node db/migrate.js  (executes this file against DATABASE_URL)

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('customer','organiser','admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Venues (created/managed by admin)
CREATE TABLE IF NOT EXISTS venues (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(160) NOT NULL,
  address       VARCHAR(255),
  rows          INTEGER NOT NULL,       -- seat grid rows
  cols          INTEGER NOT NULL,       -- seat grid columns
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Physical seats in a venue, each assigned a category (Premium / Standard / etc.)
CREATE TABLE IF NOT EXISTS venue_seats (
  id            SERIAL PRIMARY KEY,
  venue_id      INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  row_label     VARCHAR(5) NOT NULL,     -- 'A','B',...
  col_number    INTEGER NOT NULL,
  seat_code     VARCHAR(10) NOT NULL,    -- e.g. 'A1'
  category      VARCHAR(40) NOT NULL DEFAULT 'Standard',
  UNIQUE (venue_id, seat_code)
);

-- Movie / concert events, created by organisers against a venue
CREATE TABLE IF NOT EXISTS events (
  id            SERIAL PRIMARY KEY,
  organiser_id  INTEGER NOT NULL REFERENCES users(id),
  venue_id      INTEGER NOT NULL REFERENCES venues(id),
  title         VARCHAR(200) NOT NULL,
  type          VARCHAR(20) NOT NULL CHECK (type IN ('movie','concert')),
  event_date    DATE NOT NULL,
  event_time    TIME NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-category pricing for an event (Premium: 500, Standard: 250, ...)
CREATE TABLE IF NOT EXISTS event_category_prices (
  id            SERIAL PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category      VARCHAR(40) NOT NULL,
  price         NUMERIC(10,2) NOT NULL,
  UNIQUE (event_id, category)
);

-- One row per (event, venue_seat) = the actual sellable seat for that show.
-- This is the row that carries live status: available / held / booked.
CREATE TABLE IF NOT EXISTS show_seats (
  id             SERIAL PRIMARY KEY,
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_seat_id  INTEGER NOT NULL REFERENCES venue_seats(id),
  status         VARCHAR(20) NOT NULL DEFAULT 'available'
                 CHECK (status IN ('available','held','booked','offered')),
  held_by        INTEGER REFERENCES users(id),
  held_until     TIMESTAMPTZ,
  version        INTEGER NOT NULL DEFAULT 0, -- optimistic concurrency guard
  UNIQUE (event_id, venue_seat_id)
);
CREATE INDEX IF NOT EXISTS idx_show_seats_event ON show_seats(event_id);
CREATE INDEX IF NOT EXISTS idx_show_seats_held_until ON show_seats(held_until) WHERE status = 'held';

-- Confirmed/cancelled bookings
CREATE TABLE IF NOT EXISTS bookings (
  id            SERIAL PRIMARY KEY,
  booking_ref   VARCHAR(20) UNIQUE NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  event_id      INTEGER NOT NULL REFERENCES events(id),
  total_amount  NUMERIC(10,2) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                CHECK (status IN ('confirmed','cancelled')),
  qr_data_url   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at  TIMESTAMPTZ
);

-- Which show_seats belong to which booking
CREATE TABLE IF NOT EXISTS booking_seats (
  booking_id    INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  show_seat_id  INTEGER NOT NULL REFERENCES show_seats(id),
  PRIMARY KEY (booking_id, show_seat_id)
);

-- Waitlist per event+category, FIFO by created_at
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id              SERIAL PRIMARY KEY,
  event_id        INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category        VARCHAR(40) NOT NULL,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting','offered','expired','booked','cancelled')),
  offered_seat_id INTEGER REFERENCES show_seats(id),
  offer_token     VARCHAR(64),
  offer_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waitlist_event_cat ON waitlist_entries(event_id, category, status, created_at);
