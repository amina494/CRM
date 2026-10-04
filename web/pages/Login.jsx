import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Logo from '../components/Logo.jsx';

/** Sign in: email + password, then the 6-digit code when the account has one. */
export default function Login({ onLogin }) {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [step, setStep] = useState('password'); // password | code | forgot | forgot-sent
  const [form, setForm] = useState({ name: '', email: '', password: '', code: '' });
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
      if (step === 'forgot') {
        await api.post('/auth/forgot', { email: form.email });
        setStep('forgot-sent');
      } else if (needsSetup) {
        await api.post('/setup', form);
        await onLogin();
      } else {
        await api.post('/auth/login', { email: form.email, password: form.password, code: step === 'code' ? form.code : undefined });
        await onLogin();
      }
    } catch (err) {
      // The server asks for the one-time code only after the password is right.
      if (err.data?.totp_required && step === 'password') {
        setStep('code');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const title = needsSetup ? 'Create the admin account'
    : { password: 'Sign in', code: 'Enter your code', forgot: 'Reset your password', 'forgot-sent': 'Check your email' }[step];

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <Logo height={44} className="login-logo" />
        <h1>{title}</h1>
        {needsSetup && <p className="muted">This is a fresh install. The first account is the administrator.</p>}
        {step === 'code' && <p className="muted">Open your authenticator app and type the 6-digit code for this account.</p>}
        {step === 'forgot' && <p className="muted">Enter your email. If it belongs to an account, we will send a link to choose a new password.</p>}
        {step === 'forgot-sent' && (
          <p>If <strong>{form.email}</strong> has an account, a reset link is on its way. It works once and expires in 30 minutes.
            If no email arrives, ask an administrator to set a new password for you.</p>
        )}

        {needsSetup && (
          <label className="field"><span className="field-label">Full name</span><input required value={form.name} onChange={set('name')} /></label>
        )}
        {(step === 'password' || step === 'forgot') && (
          <label className="field"><span className="field-label">Email</span><input type="email" required autoComplete="username" value={form.email} onChange={set('email')} /></label>
        )}
        {step === 'password' && (
          <label className="field">
            <span className="field-label">Password</span>
            <input type="password" required minLength={needsSetup ? 8 : undefined} autoComplete={needsSetup ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} />
          </label>
        )}
        {step === 'code' && (
          <label className="field">
            <span className="field-label">6-digit code</span>
            <input className="code-input" required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={form.code} onChange={set('code')} />
          </label>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        {step !== 'forgot-sent' && (
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : needsSetup ? 'Create account' : step === 'forgot' ? 'Send reset link' : step === 'code' ? 'Verify' : 'Sign in'}
          </button>
        )}
        {!needsSetup && (
          <div className="login-links">
            {step === 'password' && <button type="button" className="link small" onClick={() => { setError(null); setStep('forgot'); }}>Forgot password?</button>}
            {step !== 'password' && <button type="button" className="link small" onClick={() => { setError(null); setStep('password'); setForm((f) => ({ ...f, code: '' })); }}>Back to sign in</button>}
          </div>
        )}
      </form>
    </div>
  );
}
