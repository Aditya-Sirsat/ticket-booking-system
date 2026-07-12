# System Design — Ticket Booking System

## Seat hold and TTL

Every physical seat belonging to a venue (`venue_seats`) is materialised into a
`show_seats` row for each event at the moment that event is created. That row, not the
physical seat, is the single source of truth for a seat's status in a specific show:
`available`, `held`, `offered`, or `booked`. When a customer holds seats, the row is
stamped with `status = 'held'`, `held_by`, and `held_until = now() + SEAT_HOLD_TTL_MINUTES`
(10 minutes by default). There's no separate cache entry or queued job carrying the
expiry — it's a column on the row that's already being read and written anyway, so it
survives a server restart for free and adds no new moving part.

Two things enforce that TTL, on purpose. A sweeper (`expireHolds.js`) runs every 15
seconds, finds every held seat whose `held_until` has passed, flips it back to
`available`, and pushes the change out over WebSocket — the active, background half of
"held seats auto-release on abandonment." But a 15-second sweep interval leaves a window
where a hold has technically expired but hasn't been swept yet, so the
booking-confirmation query independently filters on `held_until > now()`. A customer
can't slip a booking through on an already-expired hold just because the sweeper hasn't
caught up yet. A customer can also release seats explicitly before the TTL lapses, which
takes the same immediate-update-plus-broadcast path.

## Concurrency

The scenario that actually matters here is two customers racing for the same seat at the
same instant. Rather than adding a lock manager or reaching for Redis, the hold and the
booking-confirmation both do their work inside one conditional UPDATE:

```sql
UPDATE show_seats
SET status = 'held', held_by = $user, held_until = $ttl, version = version + 1
WHERE id = ANY($seatIds) AND event_id = $event AND status = 'available'
RETURNING id;
```

Postgres won't let two transactions both flip the same row from `available` to `held` —
the second simply matches zero rows, because by the time it runs the row is no longer
`available`. So the API doesn't need to check-then-act; it compares how many rows it
asked to update against how many came back. If those numbers don't match, some requested
seats were already gone, and the whole hold is rolled back rather than partially granted —
a customer gets every seat they asked for or none of them, and is told which ones were
lost. The `WHERE status = 'available'` clause does the job a lock would otherwise do. The
same pattern — an UPDATE guarded by the status it expects to find — is what confirming
and cancelling a booking both rely on too, so no code path can act on stale status.

## Waitlist auto-assignment

Waitlist entries queue per `(event_id, category)`, ordered by creation. Position is
computed by counting entries with a lower `id` rather than an earlier `created_at` —
`id` is a database-assigned, strictly increasing integer, whereas comparing timestamps
round-tripped through the driver risks precision mismatches between JavaScript's
millisecond `Date` and Postgres's microsecond `timestamptz`, which surfaced as an
off-by-one during testing before the switch.

Whenever a seat frees up — a cancellation, or an expired offer cascading further down the
line — `offerSeatToNextInLine()` runs. It selects the oldest waiting entry for that
category with `FOR UPDATE SKIP LOCKED`, so seats freeing up concurrently across different
cancellations never contend for the same waitlist row. If someone is waiting, their entry
becomes `offered`, tied to that seat with a random token and an `offer_expires_at` (15
minutes by default), and the seat moves to `offered` — distinct from `available`, so
nobody else can pick it up while it's reserved. If nobody is waiting, the seat is simply
released back to `available`. Either way, the seat and the waitlist entry update in the
same transaction, so there's no gap where the seat looks free but the queue hasn't been
consulted.

## Time-limited offers

The offer link resolves to a public preview endpoint and a separate, authenticated
confirm endpoint. Confirming re-checks — inside its own transaction — that the offer
still belongs to the requesting user, is still in `offered` state, and hasn't passed its
expiry, before it's converted into an actual booking with a price lookup, a generated QR
code, and a confirmation email. That re-check matters because the offer could have
expired in the seconds between the customer opening the link and clicking confirm. A
second sweeper (`expireWaitlistOffers.js`) runs on the same 15-second interval as the hold
sweeper, finds offers that lapsed unclaimed, marks them `expired`, and calls
`offerSeatToNextInLine()` again for that same seat — which is what lets an unclaimed offer
cascade down the queue on its own until someone claims it or nobody's left waiting.
