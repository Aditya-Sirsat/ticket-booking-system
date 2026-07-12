const express = require('express');
const { createBooking, myBookings, cancelBooking } = require('../controllers/booking.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.post('/', createBooking);
router.get('/mine', myBookings);
router.post('/:id/cancel', cancelBooking);

module.exports = router;
