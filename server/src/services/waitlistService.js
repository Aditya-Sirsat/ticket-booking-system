const { pool } = require('../config/db');
const { sendMail } = require('../config/mailer');
const { generateOfferToken } = require('../utils/bookingRef');
const { broadcastSeatUpdate } = require('../realtime/ws');

const OFFER_TTL_MIN = Number(process.env.WAITLIST_OFFER_TTL_MINUTES || 15);

/**
 * Called whenever a seat becomes free (cancellation, or a previous offer expiring
 * without being claimed). Finds the longest-waiting waitlist entry for this
 * event+category and offers them this specific seat with a time-limited link.
 * If nobody is waiting, the seat is simply left 'available'.
 */
async function offerSeatToNextInLine(client, eventId, category, showSeatId) {
  const { rows: candidates } = await client.query(
    `SELECT id, user_id FROM waitlist_entries
     WHERE event_id = $1 AND category = $2 AND status = 'waiting'
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [eventId, category]
  );

  if (candidates.length === 0) {
    // Nobody waiting — leave seat available for direct booking.
    await client.query(
      `UPDATE show_seats SET status = 'available', held_by = NULL, held_until = NULL,
       version = version + 1 WHERE id = $1`,
      [showSeatId]
    );
    return null;
  }

  const entry = candidates[0];
  const token = generateOfferToken();
  const expiresAt = new Date(Date.now() + OFFER_TTL_MIN * 60 * 1000);

  await client.query(
    `UPDATE waitlist_entries
     SET status = 'offered', offered_seat_id = $1, offer_token = $2, offer_expires_at = $3
     WHERE id = $4`,
    [showSeatId, token, expiresAt, entry.id]
  );

  await client.query(
    `UPDATE show_seats SET status = 'offered', held_by = $1, held_until = $2,
     version = version + 1 WHERE id = $3`,
    [entry.user_id, expiresAt, showSeatId]
  );

  const { rows: userRows } = await client.query('SELECT email, name FROM users WHERE id = $1', [entry.user_id]);
  const { rows: eventRows } = await client.query('SELECT title FROM events WHERE id = $1', [eventId]);
  const user = userRows[0];
  const event = eventRows[0];

  if (user) {
    const link = `${process.env.CLIENT_URL}/waitlist-offer/${token}`;
    try {
      await sendMail({
        to: user.email,
        subject: `A seat is available for ${event ? event.title : 'your event'}!`,
        html: `
          <p>Hi ${user.name},</p>
          <p>A ${category} seat has opened up for <strong>${event ? event.title : 'the event'}</strong>.</p>
          <p>This offer is reserved for you for <strong>${OFFER_TTL_MIN} minutes</strong>.
          Complete your booking here:</p>
          <p><a href="${link}">${link}</a></p>
          <p>If you don't complete the booking in time, the seat will be offered to the next person on the waitlist.</p>
        `
      });
    } catch (mailErr) {
      // The offer itself is already committed by the caller's transaction — a mail
      // hiccup must not break the seat-reassignment flow (cancellation/expiry sweep).
      console.error('Waitlist offer created but notification email failed to send:', mailErr.message);
    }
  }

  return entry;
}

module.exports = { offerSeatToNextInLine, OFFER_TTL_MIN };
