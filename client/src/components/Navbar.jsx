import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="navbar">
      <Link to="/" className="brand">🎟️ Ticket Booking</Link>
      <div className="nav-links">
        <Link to="/">Events</Link>
        {user?.role === 'customer' && <Link to="/my-bookings">My Bookings</Link>}
        {(user?.role === 'organiser' || user?.role === 'admin') && <Link to="/organiser/dashboard">My Events</Link>}
        {(user?.role === 'organiser' || user?.role === 'admin') && <Link to="/organiser/create-event">Create Event</Link>}
        {user?.role === 'admin' && <Link to="/admin/create-venue">Create Venue</Link>}
        {user ? (
          <>
            <span className="user-pill">{user.name} ({user.role})</span>
            <button onClick={() => { logout(); navigate('/'); }}>Logout</button>
          </>
        ) : (
          <>
            <Link to="/login">Login</Link>
            <Link to="/register">Register</Link>
          </>
        )}
      </div>
    </nav>
  );
}
