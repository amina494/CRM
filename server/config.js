// Central configuration, read from environment variables (see .env.example).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so the app runs without extra dependencies.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const env = process.env;

export const config = {
  root,
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dbPath: env.DATABASE_PATH || path.join(root, 'data', 'crm.db'),
  sessionSecret: env.SESSION_SECRET || 'dev-insecure-secret-change-me',
  orgName: env.ORG_NAME || 'Guest Relations',

  smtp: {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM || 'Guest Relations <no-reply@example.com>',
  },

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    smsFrom: env.TWILIO_SMS_FROM,
    whatsappFrom: env.TWILIO_WHATSAPP_FROM, // e.g. "whatsapp:+14155238886"
  },

  appleWallet: {
    passTypeIdentifier: env.APPLE_PASS_TYPE_ID,
    teamIdentifier: env.APPLE_TEAM_ID,
    signerCertPath: env.APPLE_SIGNER_CERT,
    signerKeyPath: env.APPLE_SIGNER_KEY,
    signerKeyPassphrase: env.APPLE_SIGNER_KEY_PASSPHRASE,
    wwdrPath: env.APPLE_WWDR_CERT,
  },

  googleWallet: {
    issuerId: env.GOOGLE_WALLET_ISSUER_ID,
    serviceAccountPath: env.GOOGLE_WALLET_SERVICE_ACCOUNT,
  },
};

export const isProd = env.NODE_ENV === 'production';
