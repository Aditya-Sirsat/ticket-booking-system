import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function CreateEvent() {
  const [venues, setVenues] = useState([]);
  const [form, setForm] = useState({ title: '', type: 'movie', venueId: '', eventDate: '', eventTime: '' });
  const [venueSeats, setVenueSeats] = useState([]);
  const [prices, setPrices] = useState({});
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.listVenues().then((data) => setVenues(data.venues));
  }, []);

  async function handleVenueChange(venueId) {
    setForm((f) => ({ ...f, venueId }));
    if (!venueId) { setVenueSeats([]); return; }
    const seatsRes = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/venues/${venueId}/seats`);
    const data = await seatsRes.json();
    const categories = Array.from(new Set(data.seats.map((s) => s.category)));
    setVenueSeats(categories);
    const defaults = {};
    categories.forEach((c) => { defaults[c] = defaults[c] || ''; });
    setPrices(defaults);
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const priceList = Object.entries(prices).map(([category, price]) => ({ category, price: Number(price) }));
      if (priceList.some((p) => !p.price)) {
        setError('Please set a price for every seat category.');
        return;
      }
      const data = await api.createEvent({
        title: form.title,
        type: form.type,
        venueId: Number(form.venueId),
        eventDate: form.eventDate,
        eventTime: form.eventTime,
        prices: priceList
      });
      setCreated(data.event);
    } catch (err) {
      setError(err.message);
    }
  }

  if (created) {
    return (
      <div className="card">
        <h2>Event created! 🎉</h2>
        <p>"{created.title}" is now live for bookings.</p>
        <button onClick={() => navigate(`/events/${created.id}`)}>View event page</button>
      </div>
    );
  }

  return (
    <div className="card centered-form">
      <h2>Create Event (Organiser)</h2>
      {error && <p className="error">{error}</p>}
      <form onSubmit={handleSubmit}>
        <label>Title</label>
        <input value={form.title} onChange={(e) => update('title', e.target.value)} required />
        <label>Type</label>
        <select value={form.type} onChange={(e) => update('type', e.target.value)}>
          <option value="movie">Movie</option>
          <option value="concert">Concert</option>
        </select>
        <label>Venue</label>
        <select value={form.venueId} onChange={(e) => handleVenueChange(e.target.value)} required>
          <option value="">Select a venue...</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.rows}x{v.cols} seats)</option>)}
        </select>
        <label>Date</label>
        <input type="date" value={form.eventDate} onChange={(e) => update('eventDate', e.target.value)} required />
        <label>Time</label>
        <input type="time" value={form.eventTime} onChange={(e) => update('eventTime', e.target.value)} required />

        {venueSeats.length > 0 && (
          <fieldset>
            <legend>Pricing per category</legend>
            {venueSeats.map((cat) => (
              <div key={cat}>
                <label>{cat}</label>
                <input
                  type="number"
                  min={0}
                  value={prices[cat] || ''}
                  onChange={(e) => setPrices((p) => ({ ...p, [cat]: e.target.value }))}
                  required
                />
              </div>
            ))}
          </fieldset>
        )}

        <button type="submit" disabled={!form.venueId}>Create Event</button>
      </form>
    </div>
  );
}
