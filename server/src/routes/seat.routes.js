const express = require('express');
const { getSeatMap, holdSeats, releaseSeats } = require('../controllers/seat.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.get('/', getSeatMap);
router.post('/hold', requireAuth, holdSeats);
router.post('/release', requireAuth, releaseSeats);

module.exports = router;
