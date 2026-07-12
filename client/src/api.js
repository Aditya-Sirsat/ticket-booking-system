const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders()
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  me: () => request('/api/auth/me'),

  listVenues: () => request('/api/venues'),
  createVenue: (payload) => request('/api/venues', { method: 'POST', body: payload }),

  listEvents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/events${qs ? `?${qs}` : ''}`);
  },
  getEvent: (id) => request(`/api/events/${id}`),
  createEvent: (payload) => request('/api/events', { method: 'POST', body: payload }),
  eventSummary: (id) => request(`/api/events/${id}/summary`),
  myEvents: () => request('/api/events/organiser/mine'),

  getSeatMap: (eventId) => request(`/api/events/${eventId}/seats`),
  holdSeats: (eventId, showSeatIds) =>
    request(`/api/events/${eventId}/seats/hold`, { method: 'POST', body: { showSeatIds } }),
  releaseSeats: (eventId, showSeatIds) =>
    request(`/api/events/${eventId}/seats/release`, { method: 'POST', body: { showSeatIds } }),

  createBooking: (payload) => request('/api/bookings', { method: 'POST', body: payload }),
  myBookings: () => request('/api/bookings/mine'),
  cancelBooking: (id) => request(`/api/bookings/${id}/cancel`, { method: 'POST' }),

  joinWaitlist: (eventId, category) =>
    request(`/api/waitlist/events/${eventId}/join`, { method: 'POST', body: { category } }),
  myWaitlist: () => request('/api/waitlist/mine'),
  getOffer: (token) => request(`/api/waitlist/offer/${token}`),
  confirmOffer: (token) => request(`/api/waitlist/offer/${token}/confirm`, { method: 'POST' })
};
