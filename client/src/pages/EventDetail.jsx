import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { useSeatSocket } from '../useSeatSocket.js';
import SeatMap from '../components/SeatMap.jsx';
import Countdown from '../components/Countdown.jsx';

export default function EventDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [prices, setPrices] = useState([]);
  const [seats, setSeats] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [holdExpiresAt, setHoldExpiresAt] = useState(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState(null);

  async function loadAll() {
    const [eventData, seatData] = await Promise.all([api.getEvent(id), api.getSeatMap(id)]);
    setEvent(eventData.event);
    setPrices(eventData.prices);
    setSeats(seatData.seats);
  }

  useEffect(() => { loadAll(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSeatUpdate = useCallback((updatedSeats) => {
    setSeats((prev) => {
      const map = new Map(prev.map((s) => [s.show_seat_id, s]));
      for (const u of updatedSeats) {
        const existing = map.get(u.id);
        if (existing) map.set(u.id, { ...existing, status: u.status });
      }
      return Array.from(map.values());
    });
  }, []);
  useSeatSocket(id, onSeatUpdate);

  function toggleSeat(seat) {
    if (!user) return navigate('/login');
    setError('');
    setSelectedIds((prev) =>
      prev.includes(seat.show_seat_id)
        ? prev.filter((sid) => sid !== seat.show_seat_id)
        : [...prev, seat.show_seat_id]
    );
  }

  async function handleHold() {
    if (selectedIds.length === 0) return;
    try {
      const data = await api.holdSeats(id, selectedIds);
      setHoldExpiresAt(data.holdExpiresAt);
    } catch (err) {
      setError(err.message);
      await loadAll();
      setSelectedIds([]);
    }
  }

  async function handleAbandon() {
    if (selectedIds.length === 0) return;
    await api.releaseSeats(id, selectedIds);
    setSelectedIds([]);
    setHoldExpiresAt(null);
    await loadAll();
  }

  async function handleConfirm() {
    setConfirming(true);
    setError('');
    try {
      const data = await api.createBooking({ eventId: Number(id), showSeatIds: selectedIds });
      setConfirmedBooking(data.booking);
      setSelectedIds([]);
      setHoldExpiresAt(null);
    } catch (err) {
      setError(err.message);
      await loadAll();
    } finally {
      setConfirming(false);
    }
  }

  async function handleJoinWaitlist(category) {
    try {
      const data = await api.joinWaitlist(id, category);
      alert(`Joined the ${category} waitlist — you're position #${data.position}.`);
    } catch (err) {
      alert(err.message);
    }
  }

  if (!event) return <p>Loading...</p>;

  const categorySoldOut = {};
  for (const p of prices) {
    categorySoldOut[p.category] = !seats.some(
      (s) => s.category === p.category && s.status === 'available'
    );
  }

  if (confirmedBooking) {
    return (
      <div className="card">
        <h2>Booking confirmed! 🎉</h2>
        <p>Reference: <strong>{confirmedBooking.booking_ref}</strong></p>
        <p>A confirmation email with your QR code ticket has been sent.</p>
        {confirmedBooking.qr_data_url && <img src={confirmedBooking.qr_data_url} alt="QR ticket" width={200} />}
      </div>
    );
  }

  return (
    <div>
      <h2>{event.title}</h2>
      <p>{event.venue_name} · {event.event_date} at {event.event_time}</p>

      <div className="prices">
        {prices.map((p) => (
          <span key={p.category} className="price-pill">
            {p.category}: ₹{p.price}
            {categorySoldOut[p.category] && user?.role === 'customer' && (
              <button className="link-btn" onClick={() => handleJoinWaitlist(p.category)}>Join waitlist</button>
            )}
          </span>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <SeatMap seats={seats} selectedIds={selectedIds} onToggleSeat={toggleSeat} />

      {user?.role === 'customer' && (
        <div className="checkout-bar">
          <p>Selected: {selectedIds.length} seat(s)</p>
          {!holdExpiresAt ? (
            <button disabled={selectedIds.length === 0} onClick={handleHold}>Hold seats</button>
          ) : (
            <>
              <p>Hold expires in <Countdown expiresAt={holdExpiresAt} onExpire={() => { setHoldExpiresAt(null); setSelectedIds([]); loadAll(); }} /></p>
              <button onClick={handleConfirm} disabled={confirming}>Confirm booking</button>
              <button onClick={handleAbandon} className="secondary">Abandon checkout</button>
            </>
          )}
        </div>
      )}
      {!user && <p className="hint">Log in as a customer to select and book seats.</p>}
    </div>
  );
}
