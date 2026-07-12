# Ticket Booking System

A booking platform for movies and concerts covering the full lifecycle of a seat sale:
browsing events, picking seats off a live seat map, holding them for a limited window,
confirming a booking with an emailed QR ticket, and — once an event sells out — joining a
waitlist that reassigns cancelled seats automatically.

The project was built as a single-repo, two-service application: an Express API backed
directly by PostgreSQL, and a React SPA. There is no ORM, no cache layer, no job queue,
and no UI component library. That's not an oversight — it's the central design decision
of the project, explained below.

## Why so few dependencies

The seat-hold and waitlist logic is really just a concurrency and scheduling problem, and
both of those already have a correct, boring solution built into Postgres: row locking
and a `TIMESTAMPTZ` column. Reaching for Redis for hold expiry, or a queue library for the
waitlist, would have meant running (and explaining, and debugging) a second stateful
service to solve something a single `UPDATE ... WHERE status = 'available'` and a
15-second interval sweep already solve correctly. An ORM was left out for the same
reason — the query set here is small and every query benefits from being visible and
auditable in raw SQL rather than reconstructed from a query-builder API. Raw `pg` also
means there is exactly one thing to explain about how the database is talked to, not two.

The frontend skips a UI framework for a related reason: the interesting part of the seat
map — grid layout, per-seat status colouring, live updates — is a handful of CSS rules
and one WebSocket hook, not something a component library would meaningfully simplify.

Email is the one place a third-party service is used at all, and even that avoids adding
a package: instead of `nodemailer` over SMTP, the mailer calls Brevo's HTTP API directly
with `fetch`. This isn't a style preference — most free-tier hosts (Render's free web
service tier included) block outbound SMTP ports (25/465/587) to stop spam abuse, which
makes Gmail/SMTP mail unreachable from a deployed free-tier backend no matter how it's
configured. An HTTPS API call on port 443 goes through the same path as every other
outbound request the server already makes, so it isn't blocked, and it drops a dependency
in the process since Node 18+ ships `fetch` natively.

## What's actually in the repository

```
ticket-booking-system/
├── server/
│   ├── db/
│   │   ├── schema.sql        # table definitions, constraints, indexes
│   │   ├── migrate.js        # applies schema.sql to DATABASE_URL
│   │   └── seedAdmin.js      # creates the first admin account
│   ├── src/
│   │   ├── config/           # db pool, Brevo mailer
│   │   ├── middleware/       # JWT auth, error handler
│   │   ├── controllers/      # one file per resource: auth, venue, event, seat, booking, waitlist
│   │   ├── routes/
│   │   ├── realtime/         # WebSocket seat-map broadcast
│   │   ├── scheduler/        # hold-expiry and waitlist-offer sweepers
│   │   ├── services/         # waitlist assignment logic, shared by cancellation and offer-expiry paths
│   │   └── utils/            # QR code and booking-reference generation
│   └── .env.example
├── client/
│   ├── src/
│   │   ├── pages/            # Login, Register, Events, EventDetail, MyBookings, OrganiserDashboard, ...
│   │   ├── components/       # SeatMap, Navbar, Countdown, ProtectedRoute
│   │   ├── api.js
│   │   └── useSeatSocket.js  # WebSocket hook for live seat-map updates
│   └── .env.example
└── SYSTEM_DESIGN.md
```

## Data model

The schema (`server/db/schema.sql`) is nine tables. The two worth understanding first:

- **`show_seats`** is the live seat map. A venue's physical seats (`venue_seats`) are
  copied into one `show_seats` row per event at event-creation time, and this is the row
  that actually carries a seat's status for that particular show: `available`, `held`,
  `offered`, or `booked`, along with `held_by` and `held_until`. Everything about seat
  concurrency and holds happens against this one table.
- **`waitlist_entries`** is a FIFO queue scoped to `(event_id, category)`. An entry moves
  through `waiting → offered → booked` (or `expired`, if an offer's time limit lapses
  without being claimed, at which point the same seat cascades to the next entry).

The rest — `users`, `venues`, `events`, `event_category_prices`, `bookings`,
`booking_seats` — are what you'd expect from the names. Role (`customer` / `organiser` /
`admin`) is a `CHECK` constraint on `users`, enforced at the middleware layer per route.

`SYSTEM_DESIGN.md` covers the seat-hold TTL, concurrency handling, and waitlist
cascade in detail — that reasoning isn't repeated here.

## API surface

All authenticated routes expect `Authorization: Bearer <token>`.

| Area | Method & path | Auth | Notes |
|---|---|---|---|
| Auth | `POST /api/auth/register` | – | `{ name, email, password, role }`, role is customer or organiser |
| Auth | `POST /api/auth/login` | – | Returns `{ token, user }` |
| Auth | `GET /api/auth/me` | ✅ | Decoded JWT payload |
| Venues | `GET /api/venues` | – | List venues |
| Venues | `GET /api/venues/:id/seats` | – | Physical seats + categories |
| Venues | `POST /api/venues` | admin | `{ name, address, rows, cols, categoryRules[] }` |
| Events | `GET /api/events?type=&date=&q=` | – | Browse / filter |
| Events | `GET /api/events/:id` | – | Details + category prices |
| Events | `GET /api/events/organiser/mine` | organiser | Events the caller created |
| Events | `GET /api/events/:id/summary` | organiser/admin | Revenue, confirmed bookings, seat-status breakdown, waiting counts |
| Events | `POST /api/events` | organiser/admin | `{ title, type, venueId, eventDate, eventTime, prices[] }` |
| Seats | `GET /api/events/:eventId/seats` | – | Full seat map with live status |
| Seats | `POST /api/events/:eventId/seats/hold` | customer | `{ showSeatIds[] }`, atomic, TTL-bound |
| Seats | `POST /api/events/:eventId/seats/release` | customer | `{ showSeatIds[] }`, explicit checkout abandonment |
| Bookings | `POST /api/bookings` | customer | Confirms held seats, emails QR ticket |
| Bookings | `GET /api/bookings/mine` | customer | Booking history |
| Bookings | `POST /api/bookings/:id/cancel` | customer | Cancels, triggers a waitlist offer if anyone is waiting |
| Waitlist | `POST /api/waitlist/events/:eventId/join` | customer | `{ category }`, rejected if that category isn't actually sold out |
| Waitlist | `GET /api/waitlist/mine` | customer | Caller's waitlist entries |
| Waitlist | `GET /api/waitlist/offer/:token` | – | Preview a time-limited offer |
| Waitlist | `POST /api/waitlist/offer/:token/confirm` | customer | Claims the offered seat before it expires |

Real-time updates travel over `ws(s)://<host>/ws?eventId=<id>` as
`{ type: 'seat_update', seats: [...] }` messages, pushed whenever any seat in that event
changes status — held, released, booked, or offered.

## Environment variables

`server/.env.example` and `client/.env.example` list every variable the app reads; there
are no undocumented ones. Worth calling out specifically:

- `SEAT_HOLD_TTL_MINUTES` / `WAITLIST_OFFER_TTL_MINUTES` — both default to sensible
  values (10 and 15) but are fully configurable without touching code, since they're read
  at request time, not baked into a query.
- `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` — if left unset, the mailer logs a warning and
  skips the send rather than throwing, so the booking flow (hold → confirm → cancel →
  waitlist offer) can be exercised end to end without an email account configured.

## What's deliberately out of scope

- Horizontally scaling the WebSocket layer across multiple backend instances would need
  a pub/sub broadcaster (Redis, typically) to fan messages out across processes. A single
  instance holds the seat-map rooms in memory, which is correct and sufficient for the
  scale this brief describes, so that layer was left out rather than added speculatively.
- Payment processing isn't part of the brief — `total_amount` is computed and stored per
  booking, but no payment gateway is wired in.
- Admin accounts are seeded via `server/db/seedAdmin.js` rather than self-registered,
  since the brief only calls for customer and organiser self-registration; venue creation
  is an admin-only action by design.

## Repository hygiene

`node_modules/`, `.env`/`.env.local`, build output (`dist/`, `.next/`, `out/`), and editor
folders are excluded via `.gitignore` in both `server/` and `client/`. Nothing in the
tracked history is a build artifact or a secret — confirmed with `git ls-files` before
this was pushed.
