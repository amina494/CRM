import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Logo from '../components/Logo.jsx';

/** Opened from the password-reset email. */
export default function ResetPassword() {
  const { token } = useParams();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password !== again) { setError('The two passwords do not match'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <Logo height={44} className="login-logo" />
        <h1>{done ? 'Password changed' : 'Choose a new password'}</h1>
        {done ? (
          <>
            <p>You can now sign in with your new password. Any other device that was signed in has been signed out.</p>
            <Link className="btn btn-primary btn-block" to="/">Go to sign in</Link>
          </>
        ) : (
          <>
            <label className="field"><span className="field-label">New password (8 or more characters)</span>
              <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <label className="field"><span className="field-label">Type it again</span>
              <input type="password" required minLength={8} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
            <Link className="link small" to="/">Back to sign in</Link>
          </>
        )}
      </form>
    </div>
  );
}
