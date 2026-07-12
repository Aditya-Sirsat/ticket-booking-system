const express = require('express');
const { createVenue, listVenues, getVenueSeats } = require('../controllers/venue.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', listVenues); // public: organisers need to pick a venue when creating events
router.get('/:id/seats', getVenueSeats);
router.post('/', requireAuth, requireRole('admin'), createVenue);

module.exports = router;
