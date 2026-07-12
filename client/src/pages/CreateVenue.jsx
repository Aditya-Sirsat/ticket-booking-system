import React, { useState } from 'react';
import { api } from '../api.js';

export default function CreateVenue() {
  const [form, setForm] = useState({ name: '', address: '', rows: 8, cols: 10, premiumRows: 2 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const categoryRules = form.premiumRows > 0
        ? [{ fromRow: 1, toRow: Number(form.premiumRows), category: 'Premium' }]
        : [];
      const data = await api.createVenue({
        name: form.name,
        address: form.address,
        rows: Number(form.rows),
        cols: Number(form.cols),
        categoryRules
      });
      setResult(data.venue);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card centered-form">
      <h2>Create Venue (Admin)</h2>
      {error && <p className="error">{error}</p>}
      {result ? (
        <p>✅ Venue "{result.name}" created with {form.rows * form.cols} seats.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <label>Venue name</label>
          <input value={form.name} onChange={(e) => update('name', e.target.value)} required />
          <label>Address</label>
          <input value={form.address} onChange={(e) => update('address', e.target.value)} />
          <label>Rows</label>
          <input type="number" min={1} max={50} value={form.rows} onChange={(e) => update('rows', e.target.value)} required />
          <label>Seats per row</label>
          <input type="number" min={1} max={50} value={form.cols} onChange={(e) => update('cols', e.target.value)} required />
          <label>Front rows marked "Premium" (0 to skip)</label>
          <input type="number" min={0} value={form.premiumRows} onChange={(e) => update('premiumRows', e.target.value)} />
          <button type="submit">Create Venue</button>
        </form>
      )}
    </div>
  );
}
