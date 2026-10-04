import { Link } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { Badge, Empty, Loading, useApi } from '../components/ui.jsx';

export default function Messages() {
  const { event, meta } = useApp();
  const { data, error } = useApi(`/events/${event.id}/messages`);
  const off = meta ? Object.entries(meta.channels).filter(([, on]) => !on).map(([c]) => c) : [];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Outbox</h1><p className="muted">Every invitation and message sent from the CRM.</p></div></div>
      {off.length > 0 && (
        <div className="alert alert-info">
          Not connected: <strong>{off.join(', ')}</strong>. Messages on these channels are recorded here as “logged” but not delivered.
          Configure SMTP (email) and Twilio (WhatsApp/SMS) in the server <code>.env</code> to send for real.
        </div>
      )}
      {!data ? <Loading error={error} /> : !data.length ? <Empty>Nothing sent yet.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Guest</th><th>Channel</th><th>To</th><th>Message</th><th>Status</th><th>By</th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap small">{new Date(m.sent_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td><Link to={`/guests/${m.guest_id}`}>{m.first_name} {m.last_name}</Link></td>
                  <td>{m.channel}</td>
                  <td className="small">{m.recipient}</td>
                  <td className="small"><details><summary>{m.subject || m.body.slice(0, 40)}</summary><pre className="message-preview">{m.body}</pre></details></td>
                  <td><Badge tone={{ sent: 'green', logged: 'blue', failed: 'red' }[m.status]} label={m.status} />{m.error && <div className="small warn">{m.error}</div>}</td>
                  <td className="small">{m.sent_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
