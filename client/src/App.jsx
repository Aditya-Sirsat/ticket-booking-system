import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './AuthContext.jsx';
import Navbar from './components/Navbar.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

import Events from './pages/Events.jsx';
import EventDetail from './pages/EventDetail.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import MyBookings from './pages/MyBookings.jsx';
import WaitlistOffer from './pages/WaitlistOffer.jsx';
import CreateEvent from './pages/CreateEvent.jsx';
import CreateVenue from './pages/CreateVenue.jsx';
import OrganiserDashboard from './pages/OrganiserDashboard.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Navbar />
      <main className="container">
        <Routes>
          <Route path="/" element={<Events />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/waitlist-offer/:token" element={<WaitlistOffer />} />

          <Route path="/my-bookings" element={
            <ProtectedRoute roles={['customer']}><MyBookings /></ProtectedRoute>
          } />
          <Route path="/organiser/create-event" element={
            <ProtectedRoute roles={['organiser', 'admin']}><CreateEvent /></ProtectedRoute>
          } />
          <Route path="/organiser/dashboard" element={
            <ProtectedRoute roles={['organiser', 'admin']}><OrganiserDashboard /></ProtectedRoute>
          } />
          <Route path="/admin/create-venue" element={
            <ProtectedRoute roles={['admin']}><CreateVenue /></ProtectedRoute>
          } />

          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </AuthProvider>
  );
}
