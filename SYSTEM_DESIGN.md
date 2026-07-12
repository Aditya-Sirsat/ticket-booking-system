# System Design Write-up — Ticket Booking System

## 1. Seat Hold & TTL Mechanism

Every physical seat in a venue is copied into a `show_seats` row per event (materialized
at event-creation time). This row is the single source of truth for that seat's live
status in that specific show: `available`, `held`, `offered`, or `booked`.

When a customer selects seats and clicks "Hold", the API stamps the row with
`status = 'held'`, `held_by = <user id>`, and `held_until = now() + SEAT_HOLD_TTL_MINUTES`
(default 10 minutes, configurable via environment variable). No separate cache or queue
is used — the expiry timestamp lives directly on the row, so it survives server restarts
and requires no extra infrastructure.

Two things enforce the TTL:

1. **Active enforcement**: a `setInterval` sweeper (`expireHolds.js`) runs every 15
   seconds, finds every `held` seat whose `held_until` has passed, flips it back to
   `available`, and broadcasts the change over WebSocket to anyone viewing that event's
   seat map — this is what makes "held seats are shown as unavailable to other
   customers" and "auto-release on abandonment" work without the customer needing to do
   anything.
2. **Passive enforcement**: when a customer tries to *confirm* a booking, the query that
   reads their held seats explicitly filters `held_until > now()`. So even in the up-to-
   15-second window before the sweeper runs, a booking cannot be confirmed on an
   already-expired hold — the confirm endpoint re-validates freshness itself.

A customer can also explicitly abandon checkout (`/seats/release`), which immediately
frees the seat rather than waiting for the TTL — this updates the seat map in real time
for other customers via the same WebSocket broadcast path.

## 2. Concurrency Protection

The core risk is two customers racing to hold or book the same seat. Rather than
introducing a lock manager or Redis, the system relies on PostgreSQL's native row-level
locking through a single atomic statement:

```sql
UPDATE show_seats
SET status = 'held', held_by = $user, held_until = $ttl, version = version + 1
WHERE id = ANY($seatIds) AND event_id = $event AND status = 'available'
RETURNING id;
```

Postgres guarantees that only one transaction can successfully update a given row from
`available` to `held` — a concurrent second UPDATE targeting the same row blocks until
the first commits, and then simply matches zero rows (because the row is no longer
`available`). The API compares how many rows were actually returned against how many
were requested: if fewer seats were updated than requested, the whole hold is rolled
back (all-or-nothing) and the caller is told exactly which seats were lost. This makes
seat holds atomic per request without needing SELECT ... FOR UPDATE, distributed locks,
or optimistic-retry loops — the `WHERE status = 'available'` clause *is* the lock. The
same pattern (an UPDATE guarded by an expected current status) is reused for
confirming a booking from a held seat and for cancelling one, so no code path can act on
stale seat state. A `version` column is also incremented on every transition, giving a
lightweight audit trail and a hook for future optimistic-concurrency checks on the
client if needed.

## 3. Waitlist Auto-Assignment Flow

Waitlist entries are FIFO per `(event_id, category)`, ordered by `created_at`. Whenever a
seat frees up — either through a booking cancellation or an expired waitlist offer — the
shared `offerSeatToNextInLine()` service is invoked with that seat's event, category, and
id. It:

1. Selects the oldest `waiting` entry for that category with `FOR UPDATE SKIP LOCKED`
   (so concurrent cancellations across different seats never contend for the same
   waitlist row).
2. If someone is waiting, marks their entry `offered`, attaches the specific seat id and
   a random offer token, sets `offer_expires_at = now() + WAITLIST_OFFER_TTL_MINUTES`
   (default 15 minutes), and flips the seat's status to `offered` (visually distinct from
   `available` on the seat map, and not directly bookable by anyone else).
3. Emails the waitlisted customer a link containing the offer token.
4. If nobody is waiting, the seat is simply released back to `available` for normal
   direct booking.

## 4. Time-Limited Offer Handling

The offer link (`/waitlist-offer/:token`) resolves to a public read endpoint (to preview
the offer) and an authenticated confirm endpoint. Confirming re-validates, inside a
transaction, that the offer is still `offered`, unexpired, and belongs to the
authenticated user before converting it into a real booking (price lookup, QR
generation, email) — the same all-or-nothing guard pattern as regular booking. A second
sweeper (`expireWaitlistOffers.js`) runs every 15 seconds, finds offers whose
`offer_expires_at` has passed and were never confirmed, marks them `expired`, and
recursively calls `offerSeatToNextInLine()` again for the same seat — cascading the seat
down the queue automatically until someone claims it or the queue is empty.
