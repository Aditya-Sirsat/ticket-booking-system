import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Events() {
  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ type: '', date: '', q: '' });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    const data = await api.listEvents(clean);
    setEvents(data.events);
    setLoading(false);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2>Browse Events</h2>
      <div className="filters">
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
          <option value="">All types</option>
          <option value="movie">Movie</option>
          <option value="concert">Concert</option>
        </select>
        <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />
        <input placeholder="Search title..." value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <button onClick={load}>Search</button>
      </div>

      {loading ? <p>Loading...</p> : (
        <div className="event-grid">
          {events.map((ev) => (
            <Link to={`/events/${ev.id}`} key={ev.id} className="event-card">
              <h3>{ev.title}</h3>
              <p className="tag">{ev.type}</p>
              <p>{ev.venue_name}</p>
              <p>{ev.event_date} at {ev.event_time}</p>
            </Link>
          ))}
          {events.length === 0 && <p>No events match those filters.</p>}
        </div>
      )}
    </div>
  );
}
