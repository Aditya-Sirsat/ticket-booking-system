const express = require('express');
const {
  joinWaitlist, myWaitlistEntries, getOffer, confirmOffer
} = require('../controllers/waitlist.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/events/:eventId/join', requireAuth, joinWaitlist);
router.get('/mine', requireAuth, myWaitlistEntries);
router.get('/offer/:token', getOffer);
router.post('/offer/:token/confirm', requireAuth, confirmOffer);

module.exports = router;
