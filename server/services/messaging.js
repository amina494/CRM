// Outbound messaging: email (SMTP via nodemailer) and WhatsApp/SMS (Twilio).
// Unconfigured channels are "logged": the message is stored in the outbox
// with status 'logged' so nothing is lost and staff can see what would go out.
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { run } from '../db.js';

let transport;
function mailer() {
  if (!config.smtp.host) return null;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

export function channelStatus() {
  const t = config.twilio;
  return {
    email: Boolean(config.smtp.host),
    whatsapp: Boolean(t.accountSid && t.authToken && t.whatsappFrom),
    sms: Boolean(t.accountSid && t.authToken && t.smsFrom),
  };
}

async function twilioSend(from, to, body) {
  const t = config.twilio;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Twilio error ${res.status}`);
  return data.sid;
}

/**
 * Sends one message and records it in the outbox.
 * @returns {{status: 'sent'|'logged'|'failed', error?: string}}
 */
export async function sendMessage({ guestId, channel, to, subject, text, html, sentBy }) {
  const ready = channelStatus()[channel];
  let status = 'logged';
  let error = null;
  let providerId = null;
  if (ready) {
    try {
      if (channel === 'email') {
        const info = await mailer().sendMail({ from: config.smtp.from, to, subject, text, html });
        providerId = info.messageId;
      } else if (channel === 'whatsapp') {
        const dest = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
        providerId = await twilioSend(config.twilio.whatsappFrom, dest, text);
      } else {
        providerId = await twilioSend(config.twilio.smsFrom, to, text);
      }
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = err.message;
    }
  }
  run(
    `INSERT INTO messages (guest_id, channel, recipient, subject, body, status, error, provider_id, sent_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    guestId ?? null, channel, to, subject ?? null, text, status, error, providerId, sentBy ?? null,
  );
  return { status, error };
}
