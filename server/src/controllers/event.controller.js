const { pool } = require('../config/db');

/**
 * Organiser creates a movie/concert listing against a venue, with per-category pricing.
 * Also materializes a `show_seats` row for every physical seat in the venue —
 * this is what carries live available/held/booked status for this specific show.
 */
async function createEvent(req, res, next) {
  const client = await pool.connect();
  try {
    const { title, type, venueId, eventDate, eventTime, prices } = req.body;
    if (!title || !type || !venueId || !eventDate || !eventTime || !Array.isArray(prices) || prices.length === 0) {
      return res.status(400).json({ error: 'title, type, venueId, eventDate, eventTime, prices[] are required' });
    }
    if (!['movie', 'concert'].includes(type)) {
      return res.status(400).json({ error: "type must be 'movie' or 'concert'" });
    }

    await client.query('BEGIN');
    const { rows: eventRows } = await client.query(
      `INSERT INTO events (organiser_id, venue_id, title, type, event_date, event_time)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, venueId, title, type, eventDate, eventTime]
    );
    const event = eventRows[0];

    for (const p of prices) {
      await client.query(
        `INSERT INTO event_category_prices (event_id, category, price) VALUES ($1,$2,$3)`,
        [event.id, p.category, p.price]
      );
    }

    const { rows: venueSeats } = await client.query(
      `SELECT id FROM venue_seats WHERE venue_id = $1`,
      [venueId]
    );
    if (venueSeats.length === 0) {
      throw Object.assign(new Error('Venue has no seats configured'), { status: 400 });
    }
    const values = [];
    const params = [];
    let p = 1;
    for (const seat of venueSeats) {
      values.push(`($${p++}, $${p++})`);
      params.push(event.id, seat.id);
    }
    await client.query(
      `INSERT INTO show_seats (event_id, venue_seat_id) VALUES ${values.join(',')}`,
      params
    );

    await client.query('COMMIT');
    res.status(201).json({ event });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// Public browse/filter: by type, date, title search
async function listEvents(req, res, next) {
  try {
    const { type, date, q } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;

    if (type) { conditions.push(`e.type = $${p++}`); params.push(type); }
    if (date) { conditions.push(`e.event_date = $${p++}`); params.push(date); }
    if (q) { conditions.push(`e.title ILIKE $${p++}`); params.push(`%${q}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT e.*, v.name AS venue_name, v.address AS venue_address
       FROM events e JOIN venues v ON v.id = e.venue_id
       ${where}
       ORDER BY e.event_date ASC, e.event_time ASC`,
      params
    );
    res.json({ events: rows });
  } catch (err) {
    next(err);
  }
}

async function getEvent(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT e.*, v.name AS venue_name, v.address AS venue_address, v.rows, v.cols
       FROM events e JOIN venues v ON v.id = e.venue_id WHERE e.id = $1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    const { rows: prices } = await pool.query(
      `SELECT category, price FROM event_category_prices WHERE event_id = $1`,
      [id]
    );
    res.json({ event: rows[0], prices });
  } catch (err) {
    next(err);
  }
}

// Organiser: booking summary + revenue for one of their events
async function eventSummary(req, res, next) {
  try {
    const { id } = req.params;
    const { rows: ownerCheck } = await pool.query('SELECT organiser_id FROM events WHERE id = $1', [id]);
    if (ownerCheck.length === 0) return res.status(404).json({ error: 'Event not found' });
    if (ownerCheck[0].organiser_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your event' });
    }

    const { rows: revenueRows } = await pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS revenue, COUNT(*) AS confirmed_bookings
       FROM bookings WHERE event_id = $1 AND status = 'confirmed'`,
      [id]
    );
    const { rows: seatBreakdown } = await pool.query(
      `SELECT status, COUNT(*) FROM show_seats WHERE event_id = $1 GROUP BY status`,
      [id]
    );
    const { rows: waitlistCounts } = await pool.query(
      `SELECT category, COUNT(*) FROM waitlist_entries WHERE event_id = $1 AND status = 'waiting' GROUP BY category`,
      [id]
    );
    res.json({
      revenue: Number(revenueRows[0].revenue),
      confirmedBookings: Number(revenueRows[0].confirmed_bookings),
      seatBreakdown,
      waitlistCounts
    });
  } catch (err) {
    next(err);
  }
}

// Organiser: list only the events they created (for their dashboard)
async function myEvents(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, v.name AS venue_name FROM events e JOIN venues v ON v.id = e.venue_id
       WHERE e.organiser_id = $1 ORDER BY e.event_date DESC`,
      [req.user.id]
    );
    res.json({ events: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { createEvent, listEvents, getEvent, eventSummary, myEvents };
