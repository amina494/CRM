// Apple Wallet (.pkpass) and Google Wallet ("Save to Google Wallet") passes.
//
// Both need credentials from the respective platform; when they are not
// configured the functions throw a WalletNotConfigured error and the API
// returns 503 with a clear explanation, while the rest of the CRM works.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { PKPass, PassType } from 'passkit-generator';
import { config } from '../config.js';
import { rgb } from '../brand.js';
import { get } from '../db.js';
import { contrast, resolveDesign } from './design.js';
import { guestDisplayName, localToDate, formatEventDate } from './format.js';

export class WalletNotConfigured extends Error {}

export function walletStatus() {
  const a = config.appleWallet;
  const g = config.googleWallet;
  return {
    apple: Boolean(a.passTypeIdentifier && a.teamIdentifier && a.signerCertPath && a.signerKeyPath && a.wwdrPath),
    google: Boolean(g.issuerId && g.serviceAccountPath),
  };
}

// YAX icon and wordmark, rendered from web/public/yax-icon.svg and web/assets/yax-wordmark.svg.
// logo*.png is off-white (for dark pass colours), logo-dark*.png charcoal (for light ones).
const ASSETS = new URL('../assets/wallet/', import.meta.url);
const fileCache = new Map();
const asset = (f) => {
  if (!fileCache.has(f)) fileCache.set(f, fs.readFileSync(new URL(f, ASSETS)));
  return fileCache.get(f);
};

/** Pass images for this event's design: the YAX icon, plus its logo choice. */
function passImages(event, design) {
  const files = { 'icon.png': asset('icon.png'), 'icon@2x.png': asset('icon@2x.png'), 'icon@3x.png': asset('icon@3x.png') };
  if (design.logo === 'none') return files;
  if (design.logo === 'custom') {
    // Apple Wallet only takes PNG; another format falls back to the YAX logo.
    const own = get("SELECT mime, data FROM event_assets WHERE event_id = ? AND kind = 'logo'", event.id);
    if (own?.mime === 'image/png') return { ...files, 'logo.png': Buffer.from(own.data), 'logo@2x.png': Buffer.from(own.data) };
  }
  const dark = design.on_background === '#1e1b1a' ? '-dark' : '';
  return { ...files, 'logo.png': asset(`logo${dark}.png`), 'logo@2x.png': asset(`logo${dark}@2x.png`), 'logo@3x.png': asset(`logo${dark}@3x.png`) };
}

/** Pass colours: the design's background, readable text, and the accent for labels when it stands out enough. */
function passColours(design) {
  const label = contrast(design.accent, design.background) >= 3 ? design.accent : design.on_background;
  return { background: design.background, foreground: design.on_background, label };
}

function passDetails(event, guest, extra) {
  const lang = guest.language || 'en';
  return {
    guestName: guestDisplayName(guest, lang),
    eventName: (lang === 'ar' && event.name_ar) || event.name,
    venue: (lang === 'ar' && event.venue_ar) || event.venue || '',
    when: formatEventDate(event.starts_at, lang, event.timezone),
    table: extra.tableName ? `${extra.tableName}${guest.seat_number ? ` · ${guest.seat_number}` : ''}` : '',
    partySize: guest.rsvp_party_size || 1,
  };
}

export function applePass(event, guest, extra = {}) {
  if (!walletStatus().apple) {
    throw new WalletNotConfigured('Apple Wallet is not configured. Set APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_SIGNER_CERT, APPLE_SIGNER_KEY and APPLE_WWDR_CERT.');
  }
  const a = config.appleWallet;
  const d = passDetails(event, guest, extra);
  const design = resolveDesign(event);
  const colours = passColours(design);
  const pass = new PKPass(
    passImages(event, design),
    {
      wwdr: fs.readFileSync(a.wwdrPath),
      signerCert: fs.readFileSync(a.signerCertPath),
      signerKey: fs.readFileSync(a.signerKeyPath),
      signerKeyPassphrase: a.signerKeyPassphrase,
    },
    {
      formatVersion: 1,
      passTypeIdentifier: a.passTypeIdentifier,
      teamIdentifier: a.teamIdentifier,
      serialNumber: `event-${event.id}-guest-${guest.id}`, // identifies the pass; not a secret
      organizationName: config.orgName,
      description: d.eventName,
      backgroundColor: rgb(colours.background),
      foregroundColor: rgb(colours.foreground),
      labelColor: rgb(colours.label),
    },
  );

  const t = new PassType('eventTicket');
  t.primaryFields.push({ key: 'guest', label: 'GUEST', value: d.guestName });
  t.secondaryFields.push({ key: 'event', label: 'EVENT', value: d.eventName }, { key: 'when', label: 'DATE', value: d.when });
  if (d.venue) t.auxiliaryFields.push({ key: 'venue', label: 'VENUE', value: d.venue });
  if (d.table) t.auxiliaryFields.push({ key: 'table', label: 'TABLE', value: d.table });
  t.headerFields.push({ key: 'party', label: 'PARTY', value: String(d.partySize) });
  t.backFields.push(
    { key: 'invite', label: 'Invitation', value: extra.inviteUrl || '' },
    ...(event.dress_code ? [{ key: 'dress', label: 'Dress code', value: event.dress_code }] : []),
    ...(event.venue_address ? [{ key: 'address', label: 'Address', value: event.venue_address }] : []),
  );
  pass.types.push(t);

  // The entrance code only checks the guest in; it cannot open the invitation.
  pass.setBarcodes({ message: guest.checkin_code, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' });
  const start = localToDate(event.starts_at, event.timezone);
  if (start) pass.setRelevantDate(start);
  if (event.venue_lat != null && event.venue_lng != null) {
    pass.setLocations({ latitude: event.venue_lat, longitude: event.venue_lng, relevantText: d.eventName });
  }
  return pass.getAsBuffer();
}

/** Returns the https://pay.google.com/gp/v/save/<jwt> URL for the guest's pass. */
export function googleSaveUrl(event, guest, extra = {}) {
  if (!walletStatus().google) {
    throw new WalletNotConfigured('Google Wallet is not configured. Set GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_SERVICE_ACCOUNT.');
  }
  const sa = JSON.parse(fs.readFileSync(config.googleWallet.serviceAccountPath, 'utf8'));
  const issuer = config.googleWallet.issuerId;
  const d = passDetails(event, guest, extra);
  const classId = `${issuer}.event-${event.id}`;
  const design = resolveDesign(event);
  const start = localToDate(event.starts_at, event.timezone);
  const end = localToDate(event.ends_at, event.timezone);

  const eventTicketClass = {
    id: classId,
    issuerName: config.orgName,
    reviewStatus: 'UNDER_REVIEW',
    eventName: { defaultValue: { language: 'en-US', value: event.name },
      ...(event.name_ar && { translatedValues: [{ language: 'ar', value: event.name_ar }] }) },
    ...(event.venue && { venue: {
      name: { defaultValue: { language: 'en-US', value: event.venue } },
      address: { defaultValue: { language: 'en-US', value: event.venue_address || event.venue } },
    } }),
    ...(start && { dateTime: { start: start.toISOString(), ...(end && { end: end.toISOString() }) } }),
    hexBackgroundColor: design.background,
    ...(design.cover_url && { heroImage: { sourceUri: { uri: `${config.publicUrl}${design.cover_url}` } } }),
  };
  const eventTicketObject = {
    id: `${issuer}.event-${event.id}-guest-${guest.id}`,
    classId,
    state: 'ACTIVE',
    ticketHolderName: d.guestName,
    barcode: { type: 'QR_CODE', value: guest.checkin_code },
    ...(d.table && { seatInfo: { seat: { defaultValue: { language: 'en-US', value: d.table } } } }),
    linksModuleData: extra.inviteUrl ? { uris: [{ uri: extra.inviteUrl, description: 'Invitation' }] } : undefined,
  };

  const claims = {
    iss: sa.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [config.publicUrl],
    payload: { eventTicketClasses: [eventTicketClass], eventTicketObjects: [eventTicketObject] },
  };
  return `https://pay.google.com/gp/v/save/${signJwtRs256(claims, sa.private_key)}`;
}

function signJwtRs256(claims, privateKey) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
  const sig = crypto.createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url');
  return `${input}.${sig}`;
}
