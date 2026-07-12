import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function MyBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await api.myBookings();
    setBookings(data.bookings);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCancel(bookingId) {
    if (!confirm('Cancel this booking? The seat will be released to the waitlist.')) return;
    await api.cancelBooking(bookingId);
    await load();
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h2>My Bookings</h2>
      {bookings.length === 0 && <p>No bookings yet.</p>}
      <div className="booking-list">
        {bookings.map((b) => (
          <div className="card" key={b.id}>
            <h3>{b.title}</h3>
            <p>{b.event_date} at {b.event_time}</p>
            <p>Ref: <strong>{b.booking_ref}</strong> · ₹{b.total_amount} · Status: {b.status}</p>
            {b.qr_data_url && <img src={b.qr_data_url} alt="QR ticket" width={120} />}
            {b.status === 'confirmed' && (
              <button className="secondary" onClick={() => handleCancel(b.id)}>Cancel booking</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
