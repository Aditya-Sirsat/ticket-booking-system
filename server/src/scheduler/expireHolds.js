const { pool } = require('../config/db');
const { broadcastSeatUpdate } = require('../realtime/ws');

const SWEEP_INTERVAL_MS = 15 * 1000; // check every 15 seconds

// Releases any 'held' seat whose held_until has passed (checkout abandonment),
// grouped by event so we can broadcast one seat-map update per event.
async function sweepExpiredHolds() {
  const client = await pool.connect();
  try {
    const { rows: expired } = await client.query(
      `SELECT id, event_id FROM show_seats
       WHERE status = 'held' AND held_until IS NOT NULL AND held_until < now()`
    );
    if (expired.length === 0) return;

    const ids = expired.map((r) => r.id);
    await client.query(
      `UPDATE show_seats SET status = 'available', held_by = NULL, held_until = NULL,
       version = version + 1 WHERE id = ANY($1::int[])`,
      [ids]
    );

    const byEvent = {};
    for (const row of expired) {
      byEvent[row.event_id] = byEvent[row.event_id] || [];
      byEvent[row.event_id].push(row.id);
    }
    for (const [eventId, seatIds] of Object.entries(byEvent)) {
      broadcastSeatUpdate(eventId, seatIds.map((id) => ({ id, status: 'available' })));
    }
  } catch (err) {
    console.error('Error sweeping expired holds:', err.message);
  } finally {
    client.release();
  }
}

function startHoldExpiryScheduler() {
  setInterval(sweepExpiredHolds, SWEEP_INTERVAL_MS);
  console.log(`⏱  Seat hold expiry sweeper running every ${SWEEP_INTERVAL_MS / 1000}s`);
}

module.exports = { startHoldExpiryScheduler };
