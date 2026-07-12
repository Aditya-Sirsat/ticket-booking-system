const { pool } = require('../config/db');

/**
 * Admin creates a venue with a row x col seat grid. `categoryMap` optionally
 * assigns categories to row ranges, e.g.:
 *   { rows: 8, cols: 10, categoryRules: [
 *       { fromRow: 1, toRow: 2, category: 'Premium' },
 *       { fromRow: 3, toRow: 8, category: 'Standard' }
 *   ]}
 * Rows not covered by a rule default to 'Standard'.
 */
async function createVenue(req, res, next) {
  const client = await pool.connect();
  try {
    const { name, address, rows, cols, categoryRules } = req.body;
    if (!name || !rows || !cols) {
      return res.status(400).json({ error: 'name, rows and cols are required' });
    }
    if (rows > 50 || cols > 50) {
      return res.status(400).json({ error: 'rows and cols must each be 50 or fewer' });
    }

    await client.query('BEGIN');
    const { rows: venueRows } = await client.query(
      `INSERT INTO venues (name, address, rows, cols, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, address || null, rows, cols, req.user.id]
    );
    const venue = venueRows[0];

    const rules = Array.isArray(categoryRules) ? categoryRules : [];
    const categoryForRow = (rowIndex) => {
      const match = rules.find((r) => rowIndex >= r.fromRow && rowIndex <= r.toRow);
      return match ? match.category : 'Standard';
    };

    const rowLabelFor = (i) => String.fromCharCode(64 + i); // 1 -> 'A', 2 -> 'B'...

    const values = [];
    const params = [];
    let p = 1;
    for (let r = 1; r <= rows; r++) {
      const label = rowLabelFor(r);
      const category = categoryForRow(r);
      for (let c = 1; c <= cols; c++) {
        const seatCode = `${label}${c}`;
        values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
        params.push(venue.id, label, c, seatCode, category);
      }
    }
    await client.query(
      `INSERT INTO venue_seats (venue_id, row_label, col_number, seat_code, category) VALUES ${values.join(',')}`,
      params
    );

    await client.query('COMMIT');
    res.status(201).json({ venue });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

async function listVenues(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM venues ORDER BY created_at DESC');
    res.json({ venues: rows });
  } catch (err) {
    next(err);
  }
}

async function getVenueSeats(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM venue_seats WHERE venue_id = $1 ORDER BY row_label, col_number`,
      [id]
    );
    res.json({ seats: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { createVenue, listVenues, getVenueSeats };
