require('dotenv').config();

// Defensive: log unexpected async errors instead of letting the process crash and
// take down every in-flight request (e.g. a stray SMTP timeout not caught somewhere).
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const express = require('express');
const cors = require('cors');
const http = require('http');

const errorHandler = require('./middleware/errorHandler');
const { attachWebsocketServer } = require('./realtime/ws');
const { startHoldExpiryScheduler } = require('./scheduler/expireHolds');
const { startWaitlistOfferScheduler } = require('./scheduler/expireWaitlistOffers');

const authRoutes = require('./routes/auth.routes');
const venueRoutes = require('./routes/venue.routes');
const eventRoutes = require('./routes/event.routes');
const seatRoutes = require('./routes/seat.routes');
const bookingRoutes = require('./routes/booking.routes');
const waitlistRoutes = require('./routes/waitlist.routes');

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'ticket-booking-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/events/:eventId/seats', seatRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/waitlist', waitlistRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
attachWebsocketServer(server);

server.listen(PORT, () => {
  console.log(`🎟️  Ticket Booking API listening on port ${PORT}`);
  startHoldExpiryScheduler();
  startWaitlistOfferScheduler();
});
