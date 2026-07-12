const express = require('express');
const { createEvent, listEvents, getEvent, eventSummary, myEvents } = require('../controllers/event.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', listEvents);
router.get('/organiser/mine', requireAuth, requireRole('organiser', 'admin'), myEvents);
router.get('/:id', getEvent);
router.get('/:id/summary', requireAuth, requireRole('organiser', 'admin'), eventSummary);
router.post('/', requireAuth, requireRole('organiser', 'admin'), createEvent);

module.exports = router;
