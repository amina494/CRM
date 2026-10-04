import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/setup').then((r) => setNeedsSetup(r.needsSetup)).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (needsSetup) await api.post('/setup', form);
      else await api.post('/auth/login', form);
      onLogin(await api.get('/auth/me'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <span className="brand-mark large" />
        <h1>{needsSetup ? 'Create the admin account' : 'Sign in'}</h1>
        <p className="muted">{needsSetup ? 'This is a fresh install. The first account is the administrator.' : 'Guest management CRM'}</p>
        {needsSetup && (
          <label className="field"><span className="field-label">Full name</span><input required value={form.name} onChange={set('name')} /></label>
        )}
        <label className="field"><span className="field-label">Email</span><input type="email" required autoComplete="username" value={form.email} onChange={set('email')} /></label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" required minLength={needsSetup ? 8 : undefined} autoComplete={needsSetup ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Please wait…' : needsSetup ? 'Create account' : 'Sign in'}</button>
      </form>
    </div>
  );
}
