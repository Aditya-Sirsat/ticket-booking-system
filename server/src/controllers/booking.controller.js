const { pool } = require('../config/db');
const { sendMail } = require('../config/mailer');
const { generateTicketQr, qrDataUrlToBase64 } = require('../utils/qrcode');
const { generateBookingRef } = require('../utils/bookingRef');
const { broadcastSeatUpdate } = require('../realtime/ws');
const { offerSeatToNextInLine } = require('../services/waitlistService');

/**
 * Confirms a booking from seats the customer currently holds. Only seats held BY
 * THIS user (and not yet expired) can be confirmed — this is what prevents someone
 * from "confirming" a seat someone else is holding.
 */
async function createBooking(req, res, next) {
  const client = await pool.connect();
  try {
    const { eventId, showSeatIds } = req.body;
    if (!eventId || !Array.isArray(showSeatIds) || showSeatIds.length === 0) {
      return res.status(400).json({ error: 'eventId and showSeatIds[] are required' });
    }

    await client.query('BEGIN');

    // Lock and validate: seats must be held by this user and not expired.
    const { rows: seats } = await client.query(
      `SELECT ss.id, vs.category
       FROM show_seats ss JOIN venue_seats vs ON vs.id = ss.venue_seat_id
       WHERE ss.id = ANY($1::int[]) AND ss.event_id = $2
         AND ss.status = 'held' AND ss.held_by = $3 AND ss.held_until > now()
       FOR UPDATE OF ss`,
      [showSeatIds, eventId, req.user.id]
    );
    if (seats.length !== showSeatIds.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'One or more seat holds have expired. Please reselect your seats.' });
    }

    // Price lookup per category
    const { rows: prices } = await client.query(
      `SELECT category, price FROM event_category_prices WHERE event_id = $1`,
      [eventId]
    );
    const priceMap = Object.fromEntries(prices.map((p) => [p.category, Number(p.price)]));
    const total = seats.reduce((sum, s) => sum + (priceMap[s.category] || 0), 0);

    const bookingRef = generateBookingRef();
    const qrDataUrl = await generateTicketQr(bookingRef, eventId);

    const { rows: bookingRows } = await client.query(
      `INSERT INTO bookings (booking_ref, user_id, event_id, total_amount, qr_data_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [bookingRef, req.user.id, eventId, total, qrDataUrl]
    );
    const booking = bookingRows[0];

    for (const seatId of showSeatIds) {
      await client.query(
        `INSERT INTO booking_seats (booking_id, show_seat_id) VALUES ($1,$2)`,
        [booking.id, seatId]
      );
    }

    await client.query(
      `UPDATE show_seats SET status = 'booked', held_by = NULL, held_until = NULL,
       version = version + 1 WHERE id = ANY($1::int[])`,
      [showSeatIds]
    );

    const { rows: eventRows } = await client.query('SELECT title, event_date, event_time FROM events WHERE id = $1', [eventId]);
    const event = eventRows[0];

    await client.query('COMMIT');

    broadcastSeatUpdate(eventId, showSeatIds.map((id) => ({ id, status: 'booked' })));

    // The booking is already committed at this point — an email hiccup must never
    // turn a successful booking into an error response for the customer.
    try {
      // The QR travels as a real attachment, not an inline <img src="data:...">. Brevo's
      // API doesn't support inline (CID) images, and webmail clients like Gmail strip
      // data: URIs out of the HTML body — either path renders as a broken image icon.
      // A plain attachment is the one form every client actually displays/downloads.
      await sendMail({
        to: req.user.email,
        subject: `Your ticket for ${event.title} — ${bookingRef}`,
        html: `
          <p>Hi ${req.user.name},</p>
          <p>Your booking for <strong>${event.title}</strong> on ${event.event_date} at ${event.event_time} is confirmed.</p>
          <p><strong>Booking reference:</strong> ${bookingRef}</p>
          <p><strong>Total paid:</strong> ${total}</p>
          <p>Your entry QR code is attached to this email as <strong>ticket-qr.png</strong> — show it at the entrance. You can also view it any time from "My Bookings" in the app.</p>
        `,
        attachments: [{ name: 'ticket-qr.png', content: qrDataUrlToBase64(qrDataUrl) }]
      });
    } catch (mailErr) {
      console.error('Booking confirmed but ticket email failed to send:', mailErr.message);
    }

    res.status(201).json({ booking: { ...booking, seats } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

async function myBookings(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, e.title, e.event_date, e.event_time
       FROM bookings b JOIN events e ON e.id = b.event_id
       WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json({ bookings: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * Cancels a confirmed booking. Frees each seat and, for each seat's category,
 * offers it to the longest-waiting person on that category's waitlist (if any).
 */
async function cancelBooking(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');

    const { rows: bookingRows } = await client.query(
      `SELECT * FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, req.user.id]
    );
    if (bookingRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    const booking = bookingRows[0];
    if (booking.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Booking already cancelled' });
    }

    const { rows: seatRows } = await client.query(
      `SELECT ss.id, vs.category FROM booking_seats bs
       JOIN show_seats ss ON ss.id = bs.show_seat_id
       JOIN venue_seats vs ON vs.id = ss.venue_seat_id
       WHERE bs.booking_id = $1`,
      [id]
    );

    await client.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1`,
      [id]
    );

    const seatUpdates = [];
    for (const seat of seatRows) {
      const nextEntry = await offerSeatToNextInLine(client, booking.event_id, seat.category, seat.id);
      seatUpdates.push({ id: seat.id, status: nextEntry ? 'offered' : 'available' });
    }

    await client.query('COMMIT');
    broadcastSeatUpdate(booking.event_id, seatUpdates);
    res.json({ cancelled: true, bookingId: booking.id });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

module.exports = { createBooking, myBookings, cancelBooking };
