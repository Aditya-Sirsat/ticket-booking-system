const { pool } = require('../config/db');
const { sendMail } = require('../config/mailer');
const { generateTicketQr, qrDataUrlToBase64 } = require('../utils/qrcode');
const { generateBookingRef } = require('../utils/bookingRef');
const { broadcastSeatUpdate } = require('../realtime/ws');

// Customer joins the waitlist for a category once it's sold out.
async function joinWaitlist(req, res, next) {
  try {
    const { eventId } = req.params;
    const { category } = req.body;
    if (!category) return res.status(400).json({ error: 'category is required' });

    const { rows: availableRows } = await pool.query(
      `SELECT COUNT(*) FROM show_seats ss JOIN venue_seats vs ON vs.id = ss.venue_seat_id
       WHERE ss.event_id = $1 AND vs.category = $2 AND ss.status = 'available'`,
      [eventId, category]
    );
    if (Number(availableRows[0].count) > 0) {
      return res.status(400).json({ error: `${category} still has available seats — book directly instead of waitlisting.` });
    }

    const { rows: existing } = await pool.query(
      `SELECT id FROM waitlist_entries
       WHERE event_id = $1 AND category = $2 AND user_id = $3 AND status IN ('waiting','offered')`,
      [eventId, category, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'You are already on the waitlist for this category' });
    }

    const { rows } = await pool.query(
      `INSERT INTO waitlist_entries (event_id, category, user_id) VALUES ($1,$2,$3) RETURNING *`,
      [eventId, category, req.user.id]
    );
    // Use the row's own id (monotonically increasing) rather than created_at for
    // position ranking — comparing a truncated-precision Date round-tripped through
    // the driver against the DB's full-precision timestamptz could undercount.
    const { rows: position } = await pool.query(
      `SELECT COUNT(*) FROM waitlist_entries
       WHERE event_id = $1 AND category = $2 AND status = 'waiting' AND id <= $3`,
      [eventId, category, rows[0].id]
    );

    res.status(201).json({ waitlistEntry: rows[0], position: Number(position[0].count) });
  } catch (err) {
    next(err);
  }
}

async function myWaitlistEntries(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, e.title, e.event_date FROM waitlist_entries w
       JOIN events e ON e.id = w.event_id
       WHERE w.user_id = $1 ORDER BY w.created_at DESC`,
      [req.user.id]
    );
    res.json({ entries: rows });
  } catch (err) {
    next(err);
  }
}

// Public: view what an offer link points to (before the user logs in / confirms).
async function getOffer(req, res, next) {
  try {
    const { token } = req.params;
    const { rows } = await pool.query(
      `SELECT w.*, e.title, e.event_date, e.event_time
       FROM waitlist_entries w JOIN events e ON e.id = w.event_id
       WHERE w.offer_token = $1`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Offer not found' });
    const offer = rows[0];
    if (offer.status !== 'offered' || new Date(offer.offer_expires_at) < new Date()) {
      return res.status(410).json({ error: 'This offer has expired' });
    }
    res.json({ offer });
  } catch (err) {
    next(err);
  }
}

// Confirms the booking for the specific seat that was offered, within the time limit.
async function confirmOffer(req, res, next) {
  const client = await pool.connect();
  try {
    const { token } = req.params;
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM waitlist_entries WHERE offer_token = $1 FOR UPDATE`,
      [token]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Offer not found' });
    }
    const offer = rows[0];
    if (offer.user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This offer belongs to a different account' });
    }
    if (offer.status !== 'offered' || new Date(offer.offer_expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This offer has expired' });
    }

    const { rows: seatRows } = await client.query(
      `SELECT ss.id, vs.category FROM show_seats ss JOIN venue_seats vs ON vs.id = ss.venue_seat_id
       WHERE ss.id = $1 AND ss.status = 'offered' AND ss.held_by = $2 FOR UPDATE OF ss`,
      [offer.offered_seat_id, req.user.id]
    );
    if (seatRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Seat is no longer available' });
    }
    const seat = seatRows[0];

    const { rows: priceRows } = await client.query(
      `SELECT price FROM event_category_prices WHERE event_id = $1 AND category = $2`,
      [offer.event_id, seat.category]
    );
    const total = priceRows[0] ? Number(priceRows[0].price) : 0;

    const bookingRef = generateBookingRef();
    const qrDataUrl = await generateTicketQr(bookingRef, offer.event_id);

    const { rows: bookingRows } = await client.query(
      `INSERT INTO bookings (booking_ref, user_id, event_id, total_amount, qr_data_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [bookingRef, req.user.id, offer.event_id, total, qrDataUrl]
    );
    await client.query(
      `INSERT INTO booking_seats (booking_id, show_seat_id) VALUES ($1,$2)`,
      [bookingRows[0].id, seat.id]
    );
    await client.query(
      `UPDATE show_seats SET status = 'booked', held_by = NULL, held_until = NULL,
       version = version + 1 WHERE id = $1`,
      [seat.id]
    );
    await client.query(
      `UPDATE waitlist_entries SET status = 'booked' WHERE id = $1`,
      [offer.id]
    );

    const { rows: eventRows } = await client.query('SELECT title, event_date, event_time FROM events WHERE id = $1', [offer.event_id]);
    const event = eventRows[0];

    await client.query('COMMIT');
    broadcastSeatUpdate(offer.event_id, [{ id: seat.id, status: 'booked' }]);

    try {
      // See booking.controller.js for why the QR is attached rather than inlined.
      await sendMail({
        to: req.user.email,
        subject: `Your waitlist seat is confirmed — ${bookingRef}`,
        html: `
          <p>Hi ${req.user.name},</p>
          <p>Your waitlisted seat for <strong>${event.title}</strong> on ${event.event_date} at ${event.event_time} is now confirmed.</p>
          <p><strong>Booking reference:</strong> ${bookingRef}</p>
          <p>Your entry QR code is attached to this email as <strong>ticket-qr.png</strong> — show it at the entrance. You can also view it any time from "My Bookings" in the app.</p>
        `,
        attachments: [{ name: 'ticket-qr.png', content: qrDataUrlToBase64(qrDataUrl) }]
      });
    } catch (mailErr) {
      console.error('Waitlist offer confirmed but ticket email failed to send:', mailErr.message);
    }

    res.status(201).json({ booking: bookingRows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

module.exports = { joinWaitlist, myWaitlistEntries, getOffer, confirmOffer };
