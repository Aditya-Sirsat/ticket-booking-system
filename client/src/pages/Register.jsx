import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'customer' });
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const data = await api.register(form);
      login(data.token, data.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card centered-form">
      <h2>Register</h2>
      {error && <p className="error">{error}</p>}
      <form onSubmit={handleSubmit}>
        <label>Name</label>
        <input value={form.name} onChange={(e) => update('name', e.target.value)} required />
        <label>Email</label>
        <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
        <label>Password</label>
        <input type="password" value={form.password} onChange={(e) => update('password', e.target.value)} required minLength={6} />
        <label>I am a...</label>
        <select value={form.role} onChange={(e) => update('role', e.target.value)}>
          <option value="customer">Customer (book tickets)</option>
          <option value="organiser">Organiser (create events)</option>
        </select>
        <button type="submit">Register</button>
      </form>
      <p>Already have an account? <Link to="/login">Login</Link></p>
      <p className="hint">Note: Admin accounts (venue management) are created by the project owner via a seed script, not through this form.</p>
    </div>
  );
}
