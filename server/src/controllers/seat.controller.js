const { pool } = require('../config/db');
const { broadcastSeatUpdate } = require('../realtime/ws');

const HOLD_TTL_MIN = Number(process.env.SEAT_HOLD_TTL_MINUTES || 10);

// Full seat map for an event: seat code, category, row/col, and live status.
async function getSeatMap(req, res, next) {
  try {
    const { eventId } = req.params;
    const { rows } = await pool.query(
      `SELECT ss.id AS show_seat_id, ss.status, ss.held_until,
              vs.seat_code, vs.row_label, vs.col_number, vs.category
       FROM show_seats ss
       JOIN venue_seats vs ON vs.id = ss.venue_seat_id
       WHERE ss.event_id = $1
       ORDER BY vs.row_label, vs.col_number`,
      [eventId]
    );
    res.json({ seats: rows, holdTtlMinutes: HOLD_TTL_MIN });
  } catch (err) {
    next(err);
  }
}

/**
 * Places a hold on 1+ seats for the current customer. This is the concurrency-critical
 * path: two customers racing for the same seat must never both succeed.
 *
 * Strategy: a single atomic UPDATE with `WHERE status = 'available'` — Postgres row
 * locking guarantees only one concurrent request can flip a given row from
 * 'available' to 'held'. We request all seatIds in one UPDATE; if the number of rows
 * actually updated is less than requested, some seats were already taken, so we roll
 * back the whole transaction (all-or-nothing hold) and report which seats were lost.
 */
async function holdSeats(req, res, next) {
  const client = await pool.connect();
  try {
    const { eventId } = req.params;
    const { showSeatIds } = req.body;
    if (!Array.isArray(showSeatIds) || showSeatIds.length === 0) {
      return res.status(400).json({ error: 'showSeatIds[] is required' });
    }

    const heldUntil = new Date(Date.now() + HOLD_TTL_MIN * 60 * 1000);

    await client.query('BEGIN');
    const { rows: updated } = await client.query(
      `UPDATE show_seats
       SET status = 'held', held_by = $1, held_until = $2, version = version + 1
       WHERE id = ANY($3::int[]) AND event_id = $4 AND status = 'available'
       RETURNING id`,
      [req.user.id, heldUntil, showSeatIds, eventId]
    );

    if (updated.length !== showSeatIds.length) {
      await client.query('ROLLBACK');
      const updatedIds = new Set(updated.map((r) => r.id));
      const unavailable = showSeatIds.filter((id) => !updatedIds.has(id));
      return res.status(409).json({
        error: 'Some seats are no longer available',
        unavailableSeatIds: unavailable
      });
    }

    await client.query('COMMIT');
    broadcastSeatUpdate(eventId, updated.map((r) => ({ id: r.id, status: 'held' })));
    res.json({ heldSeatIds: updated.map((r) => r.id), holdExpiresAt: heldUntil });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// Explicit release when a customer abandons checkout before the TTL sweep runs.
async function releaseSeats(req, res, next) {
  try {
    const { eventId } = req.params;
    const { showSeatIds } = req.body;
    if (!Array.isArray(showSeatIds) || showSeatIds.length === 0) {
      return res.status(400).json({ error: 'showSeatIds[] is required' });
    }
    const { rows } = await pool.query(
      `UPDATE show_seats SET status = 'available', held_by = NULL, held_until = NULL,
       version = version + 1
       WHERE id = ANY($1::int[]) AND event_id = $2 AND status = 'held' AND held_by = $3
       RETURNING id`,
      [showSeatIds, eventId, req.user.id]
    );
    broadcastSeatUpdate(eventId, rows.map((r) => ({ id: r.id, status: 'available' })));
    res.json({ releasedSeatIds: rows.map((r) => r.id) });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSeatMap, holdSeats, releaseSeats };
