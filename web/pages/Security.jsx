import { useState } from 'react';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { Loading, useApi } from '../components/ui.jsx';

/**
 * Sign-in security: set up or turn off the one-time code, change password.
 * With `forced`, this is the only screen shown until the code is set up.
 */
export default function Security({ forced = false, onDone }) {
  const { me: ctxMe, reloadMe } = useApp() || {};
  const meApi = useApi(forced ? '/auth/me' : null);
  const me = ctxMe || meApi.data;
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [off, setOff] = useState({ password: '', code: '' });
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const refresh = async () => { await (onDone || reloadMe)?.(); };

  if (!me) return <Loading />;

  const run = async (fn) => {
    setError(null);
    setMessage(null);
    try { await fn(); } catch (err) { setError(err.message); }
  };

  const start = () => run(async () => setSetup(await api.post('/auth/totp/setup')));
  const enable = (e) => { e.preventDefault(); run(async () => {
    await api.post('/auth/totp/enable', { code });
    setSetup(null);
    setCode('');
    setMessage('Done. From now on you will be asked for a code from your app when you sign in.');
    await refresh();
  }); };
  const disable = (e) => { e.preventDefault(); run(async () => {
    const r = await api.post('/auth/totp/disable', off);
    setOff({ password: '', code: '' });
    setMessage('The one-time code is turned off.');
    // Roles that must use a code are taken straight back to setting up a new one.
    if (r.totp_setup_required) setMessage('Set up the code again on your new phone to continue.');
    await refresh();
  }); };
  const changePassword = (e) => { e.preventDefault(); run(async () => {
    if (pw.next !== pw.again) throw new Error('The two new passwords do not match');
    await api.put(`/users/${me.id}`, { password: pw.next, current_password: pw.current });
    setPw({ current: '', next: '', again: '' });
    setMessage('Password changed. Any other device that was signed in has been signed out.');
  }); };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>Sign-in security</h1>
          {forced && <p className="muted">Your role needs a one-time code to sign in. Set it up now to continue. It takes about a minute.</p>}
        </div>
        {forced && <button className="btn btn-ghost" onClick={async () => { await api.post('/auth/logout'); window.location.href = '/'; }}>Sign out</button>}
      </div>
      {message && <div className="alert alert-ok">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <section className="card">
        <h2>One-time code</h2>
        {me.totp_enabled ? (
          <>
            <p>Your account is protected with a code from an authenticator app.</p>
            {!forced && (me.totp_required_for_role ? (
              <p className="muted small">Your role requires a code. If you turn it off you will be asked to set up a new one straight away, for example on a new phone.</p>
            ) : null)}
            <form className="form" onSubmit={disable}>
              <div className="form-grid">
                <label className="field"><span className="field-label">Your password</span>
                  <input type="password" required autoComplete="current-password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} /></label>
                <label className="field"><span className="field-label">Current 6-digit code</span>
                  <input required inputMode="numeric" autoComplete="one-time-code" value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} /></label>
              </div>
              <div className="form-actions"><button className="btn btn-ghost">Turn off the code</button></div>
            </form>
          </>
        ) : !setup ? (
          <>
            <p>A one-time code means that a stolen password alone is not enough to sign in. You need an authenticator app on your phone,
              such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
            <div className="form-actions"><button className="btn btn-primary" onClick={start}>Set up a code</button></div>
          </>
        ) : (
          <form className="form" onSubmit={enable}>
            <ol className="steps">
              <li>Open your authenticator app and choose <strong>Add account</strong> / <strong>Scan QR code</strong>.</li>
              <li>Scan this code:
                <div className="totp-qr"><img src={setup.qr} alt="QR code for your authenticator app" width="220" height="220" /></div>
                <details><summary className="small">Can't scan? Type this key instead</summary><code className="totp-secret">{setup.secret.match(/.{1,4}/g).join(' ')}</code></details>
              </li>
              <li>Type the 6-digit code the app now shows:
                <input className="code-input" required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
              </li>
            </ol>
            <div className="form-actions"><button className="btn btn-primary">Turn on</button></div>
          </form>
        )}
      </section>

      {!forced && (
        <section className="card">
          <h2>Change password</h2>
          <form className="form" onSubmit={changePassword}>
            <div className="form-grid">
              <label className="field span-2"><span className="field-label">Current password</span>
                <input type="password" required autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
              <label className="field"><span className="field-label">New password (8+ characters)</span>
                <input type="password" required minLength={8} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
              <label className="field"><span className="field-label">Type it again</span>
                <input type="password" required minLength={8} autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></label>
            </div>
            <div className="form-actions"><button className="btn btn-primary">Change password</button></div>
          </form>
        </section>
      )}
    </div>
  );
}
