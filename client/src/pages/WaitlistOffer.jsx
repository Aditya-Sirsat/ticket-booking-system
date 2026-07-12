import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import Countdown from '../components/Countdown.jsx';

export default function WaitlistOffer() {
  const { token } = useParams();
  const { user } = useAuth();
  const [offer, setOffer] = useState(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(null);

  async function load() {
    try {
      const data = await api.getOffer(token);
      setOffer(data.offer);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirm() {
    try {
      const data = await api.confirmOffer(token);
      setConfirmed(data.booking);
    } catch (err) {
      setError(err.message);
    }
  }

  if (error) return <div className="card"><p className="error">{error}</p></div>;
  if (confirmed) {
    return (
      <div className="card">
        <h2>Seat confirmed! 🎉</h2>
        <p>Reference: <strong>{confirmed.booking_ref}</strong></p>
        <p>Check your email for the QR code ticket.</p>
      </div>
    );
  }
  if (!offer) return <p>Loading...</p>;

  return (
    <div className="card">
      <h2>Your waitlist seat is ready!</h2>
      <p>{offer.title} on {offer.event_date} at {offer.event_time}</p>
      <p>Category: {offer.category}</p>
      <p>Offer expires in <Countdown expiresAt={offer.offer_expires_at} onExpire={() => setError('This offer has expired.')} /></p>
      {!user ? (
        <p className="hint">Please log in with the account that joined the waitlist to confirm this seat.</p>
      ) : (
        <button onClick={handleConfirm}>Confirm my booking</button>
      )}
    </div>
  );
}
