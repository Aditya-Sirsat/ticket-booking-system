# 🎟️ Ticket Booking System

A full-stack ticket booking platform for movies and concerts: visual seat maps with live
availability, time-limited seat holds that auto-release on checkout abandonment, a
waitlist with automatic seat re-assignment on cancellation, and QR-code email tickets on
every confirmed booking.

Built with a deliberately small dependency footprint:

- **Backend**: Node.js, Express, PostgreSQL (raw `pg`, no ORM), `ws` (WebSocket) for live
  seat-map updates, `jsonwebtoken` + `bcryptjs` for auth, `qrcode` for tickets,
  `nodemailer` for email. Seat-hold and waitlist-offer expiry are handled with plain
  `setInterval` sweepers — no Redis, no job queue, no extra services required.
- **Frontend**: React + Vite + `react-router-dom`. No UI kit — plain CSS.

---

## 1. Project Structure

```
ticket-booking-system/
├── server/                  # Express API
│   ├── db/
│   │   ├── schema.sql       # Full DB schema (tables, constraints, indexes)
│   │   ├── migrate.js       # Applies schema.sql to DATABASE_URL
│   │   └── seedAdmin.js     # Creates the first admin account
│   ├── src/
│   │   ├── config/          # db pool, mailer
│   │   ├── middleware/      # auth (JWT), error handler
│   │   ├── controllers/     # route handlers (business logic)
│   │   ├── routes/          # express routers
│   │   ├── realtime/        # WebSocket seat-map broadcast
│   │   ├── scheduler/       # hold-expiry + waitlist-offer sweepers
│   │   ├── services/        # shared waitlist assignment logic
│   │   ├── utils/           # QR code, booking ref generators
│   │   └── index.js         # app entry point
│   ├── .env.example
│   └── package.json
├── client/                  # React (Vite) SPA
│   ├── src/
│   │   ├── pages/           # Login, Register, Events, EventDetail, MyBookings, ...
│   │   ├── components/      # SeatMap, Navbar, Countdown, ProtectedRoute
│   │   ├── api.js           # fetch wrapper for the backend API
│   │   └── useSeatSocket.js # WebSocket hook for live seat updates
│   ├── .env.example
│   └── package.json
├── SYSTEM_DESIGN.md         # Deliverable #4 — design write-up
└── README.md                # This file
```

---

## 2. Data Model (DB Schema)

See [`server/db/schema.sql`](server/db/schema.sql) for the authoritative schema. Summary:

| Table                     | Purpose                                                                 |
|---------------------------|--------------------------------------------------------------------------|
| `users`                   | Customers, organisers, admins (role-based). Passwords hashed with bcrypt.|
| `venues`                  | Admin-managed venues with a `rows x cols` seat grid.                    |
| `venue_seats`             | Physical seats in a venue, each with a `category` (Premium/Standard...).|
| `events`                  | Movie/concert listings created by organisers against a venue.          |
| `event_category_prices`   | Per-category ticket price for an event.                                |
| `show_seats`              | **The live seat map** — one row per (event, seat), carrying status: `available` / `held` / `offered` / `booked`, `held_by`, `held_until`.|
| `bookings`                | Confirmed/cancelled bookings, with `booking_ref` and QR data URL.       |
| `booking_seats`           | Join table: which seats belong to which booking.                       |
| `waitlist_entries`        | FIFO queue per (event, category) with offer token + expiry.            |

Full explanation of the seat-hold TTL, concurrency protection, and waitlist
auto-assignment/offer-expiry cascade is in **[SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)**.

---

## 3. Local Setup Guide

### Prerequisites
- Node.js 18+
- A PostgreSQL database (local install, or a free-tier hosted one — see §5)

### 3.1 Backend

```bash
cd server
cp .env.example .env
# edit .env: set DATABASE_URL, JWT_SECRET, SMTP_* (see §4 for email setup)
npm install
npm run migrate      # creates all tables
node db/seedAdmin.js admin@example.com "Site Admin" "SomeStrongPassword123"
npm run dev          # starts on http://localhost:4000
```

### 3.2 Frontend

```bash
cd client
cp .env.example .env
# defaults already point at http://localhost:4000 — edit if your API runs elsewhere
npm install
npm run dev           # starts on http://localhost:5173
```

### 3.3 Try it out
1. Open http://localhost:5173, register as an **organiser**.
2. Log in as the **admin** account you seeded, go to "Create Venue", make a small venue
   (e.g. 4 rows x 6 seats, 1 premium row).
3. Log back in as the organiser, go to "Create Event", pick the venue, set prices per
   category.
4. Register a **customer** account, open the event, select seats on the visual seat map,
   hold them, and confirm — check your inbox (or server logs, if SMTP isn't configured)
   for the QR ticket email.
5. Open the same event in a second browser/incognito window as a different customer to
   see live seat-map updates (held/booked seats update instantly via WebSocket).

---

## 4. Email (QR ticket) Setup

Email is sent via **Brevo's HTTP API**, not SMTP. This is a deliberate choice: most
free-tier hosts (Render, Heroku, etc.) block outbound SMTP ports (25/465/587) to prevent
spam abuse, which makes Gmail/SMTP mail unreachable from a free web service. Brevo's API
travels over HTTPS (port 443) — the same port all your other outbound traffic already
uses — so it works everywhere, including free hosting tiers.

1. Create a free account at [brevo.com](https://www.brevo.com) (300 emails/day, no card
   required).
2. Go to **Senders, Domains & Dedicated IPs → Senders** and add/verify the email address
   you want tickets to be sent from (Brevo emails you a verification link — click it).
3. Go to **Settings → SMTP & API → API Keys**, click **Generate a new API key**, and copy
   it.
4. Set these environment variables:
   ```
   BREVO_API_KEY=<the key you just generated>
   BREVO_SENDER_EMAIL=<the address you verified in step 2>
   BREVO_SENDER_NAME=Ticket Booking
   ```

If `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` are left blank, the server **does not fail** — it
logs a warning and skips sending, so you can still test the booking flow without email
set up.

---

## 5. API Reference

Base URL: `http://localhost:4000` (or your deployed backend URL). All authenticated
routes expect `Authorization: Bearer <token>`.

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | – | `{ name, email, password, role }` (`role`: customer/organiser) |
| POST | `/api/auth/login` | – | `{ email, password }` → `{ token, user }` |
| GET | `/api/auth/me` | ✅ | Returns the decoded JWT payload |

### Venues (Admin)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/venues` | – | List all venues |
| GET | `/api/venues/:id/seats` | – | List physical seats + categories |
| POST | `/api/venues` | admin | `{ name, address, rows, cols, categoryRules[] }` |

### Events
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/events?type=&date=&q=` | – | Browse/filter events |
| GET | `/api/events/:id` | – | Event details + category prices |
| GET | `/api/events/organiser/mine` | organiser | Events created by the caller |
| GET | `/api/events/:id/summary` | organiser/admin | Revenue + booking + waitlist counts |
| POST | `/api/events` | organiser/admin | `{ title, type, venueId, eventDate, eventTime, prices[] }` |

### Seats (live seat map)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/events/:eventId/seats` | – | Full seat map with live status |
| POST | `/api/events/:eventId/seats/hold` | customer | `{ showSeatIds[] }` — atomic hold with TTL |
| POST | `/api/events/:eventId/seats/release` | customer | `{ showSeatIds[] }` — abandon checkout |

### Bookings
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/bookings` | customer | `{ eventId, showSeatIds[] }` — confirms held seats, emails QR ticket |
| GET | `/api/bookings/mine` | customer | Booking history |
| POST | `/api/bookings/:id/cancel` | customer | Cancels + triggers waitlist offer |

### Waitlist
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/waitlist/events/:eventId/join` | customer | `{ category }` — only allowed when sold out |
| GET | `/api/waitlist/mine` | customer | My waitlist entries |
| GET | `/api/waitlist/offer/:token` | – | View a time-limited offer |
| POST | `/api/waitlist/offer/:token/confirm` | customer | Claims the offered seat before it expires |

### Real-time
WebSocket at `ws(s)://<host>/ws?eventId=<id>` pushes `{ type: 'seat_update', seats: [...] }`
whenever any seat in that event changes status (held, released, booked, offered).

---

## 6. Deployment (GitHub → Render + Vercel)

This project is submitted via **GitHub only** (see repo root — no Google Drive zip).

High-level plan: backend + Postgres on **Render** (supports always-on Node processes and
WebSockets on the free/starter tier), frontend on **Vercel**. Railway is a fine
alternative to Render if you prefer it — the steps are nearly identical.

Detailed step-by-step deployment instructions — including exactly where **you** need to
create accounts, click buttons, and paste values — are in the message accompanying this
project, since they involve live third-party dashboards that change over time.

---

## 7. Known Limitations / Notes

- Real-time seat updates are in-process (`ws` with an in-memory room map). This is
  correct and sufficient for a single backend instance. Horizontally scaling to multiple
  backend instances would require a pub/sub layer (e.g. Redis) to fan out WebSocket
  broadcasts across processes — intentionally out of scope to keep dependencies minimal.
- Payments are out of scope per the assignment brief (no payment gateway is integrated);
  `total_amount` is calculated and stored but not charged.
- Admin accounts are seeded via `db/seedAdmin.js` rather than self-registered, since the
  brief only asks for organiser/customer self-registration.
