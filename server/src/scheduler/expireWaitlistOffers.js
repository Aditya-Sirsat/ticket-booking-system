const { pool } = require('../config/db');
const { offerSeatToNextInLine } = require('../services/waitlistService');
const { broadcastSeatUpdate } = require('../realtime/ws');

const SWEEP_INTERVAL_MS = 15 * 1000;

// Finds waitlist offers whose time-limited link has expired without being claimed,
// marks them expired, and cascades the seat to the next person in the waitlist queue.
async function sweepExpiredOffers() {
  const client = await pool.connect();
  try {
    const { rows: expiredOffers } = await client.query(
      `SELECT id, event_id, category, offered_seat_id FROM waitlist_entries
       WHERE status = 'offered' AND offer_expires_at IS NOT NULL AND offer_expires_at < now()`
    );
    if (expiredOffers.length === 0) return;

    for (const offer of expiredOffers) {
      await client.query('BEGIN');
      try {
        await client.query(
          `UPDATE waitlist_entries SET status = 'expired' WHERE id = $1`,
          [offer.id]
        );
        const nextEntry = await offerSeatToNextInLine(
          client,
          offer.event_id,
          offer.category,
          offer.offered_seat_id
        );
        await client.query('COMMIT');
        broadcastSeatUpdate(offer.event_id, [
          { id: offer.offered_seat_id, status: nextEntry ? 'offered' : 'available' }
        ]);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error cascading expired waitlist offer:', err.message);
      }
    }
  } catch (err) {
    console.error('Error sweeping expired waitlist offers:', err.message);
  } finally {
    client.release();
  }
}

function startWaitlistOfferScheduler() {
  setInterval(sweepExpiredOffers, SWEEP_INTERVAL_MS);
  console.log(`⏱  Waitlist offer expiry sweeper running every ${SWEEP_INTERVAL_MS / 1000}s`);
}

module.exports = { startWaitlistOfferScheduler };
