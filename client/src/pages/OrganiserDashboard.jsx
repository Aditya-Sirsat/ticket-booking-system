import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function OrganiserDashboard() {
  const [events, setEvents] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await api.myEvents();
      setEvents(data.events);
      const results = {};
      for (const ev of data.events) {
        try {
          results[ev.id] = await api.eventSummary(ev.id);
        } catch {
          results[ev.id] = null;
        }
      }
      setSummaries(results);
      setLoading(false);
    })();
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h2>My Events — Bookings & Revenue</h2>
      {events.length === 0 && <p>You haven't created any events yet. <Link to="/organiser/create-event">Create one</Link>.</p>}
      <div className="booking-list">
        {events.map((ev) => {
          const s = summaries[ev.id];
          return (
            <div className="card" key={ev.id}>
              <h3><Link to={`/events/${ev.id}`}>{ev.title}</Link></h3>
              <p>{ev.venue_name} · {ev.event_date} at {ev.event_time}</p>
              {s ? (
                <>
                  <p>Confirmed bookings: <strong>{s.confirmedBookings}</strong></p>
                  <p>Revenue: <strong>₹{s.revenue}</strong></p>
                  <p>Seats — {s.seatBreakdown.map((r) => `${r.status}: ${r.count}`).join(', ')}</p>
                  {s.waitlistCounts.length > 0 && (
                    <p>Waitlist — {s.waitlistCounts.map((w) => `${w.category}: ${w.count}`).join(', ')}</p>
                  )}
                </>
              ) : <p>Summary unavailable.</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
