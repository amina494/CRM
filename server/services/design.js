// Per-event invitation design: colours, fonts, layout, logo and wording.
// Everything is checked against fixed lists so a design can never inject
// code into the invitation page, the email or a wallet pass.
import { get } from '../db.js';

export const HEADING_FONTS = {
  'IBM Plex Serif': '400;500;600;700',
  'Playfair Display': '400;500;600;700',
  'Cormorant Garamond': '400;500;600;700',
  'Libre Baskerville': '400;700',
  Lora: '400;500;600;700',
  Cinzel: '400;500;600;700',
  'IBM Plex Sans': '400;500;600;700',
  Montserrat: '400;500;600;700',
};
export const ARABIC_FONTS = {
  'IBM Plex Sans Arabic': '400;500;600;700',
  'Noto Kufi Arabic': '400;500;600;700',
  'Noto Naskh Arabic': '400;500;600;700',
  Amiri: '400;700',
  Tajawal: '400;500;700',
  Cairo: '400;500;600;700',
  'Reem Kufi': '400;500;600;700',
};

/** The YAX look every event starts with. */
export const DEFAULT_DESIGN = Object.freeze({
  layout: 'card', // 'card' = card on a coloured background; 'photo' = cover photo fills the page
  background: '#1e1b1a',
  card: '#fbf9f8',
  accent: '#ef5f22',
  heading: '#1e1b1a',
  text: '#1e1b1a',
  heading_font: 'IBM Plex Serif',
  arabic_font: 'IBM Plex Sans Arabic',
  logo: 'yax', // 'yax' | 'custom' | 'none'
  kicker_en: '',
  kicker_ar: '',
  closing_en: '',
  closing_ar: '',
});

const COLOURS = ['background', 'card', 'accent', 'heading', 'text'];
const TEXTS = { kicker_en: 80, kicker_ar: 80, closing_en: 400, closing_ar: 400 };

function badRequest(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

/** Checks a design sent by staff and returns only known, valid values. */
export function cleanDesign(input = {}) {
  const out = {};
  for (const c of COLOURS) {
    if (input[c] === undefined) continue;
    const v = String(input[c]).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(v)) throw badRequest(`The ${c} colour must look like #ef5f22`);
    out[c] = v;
  }
  if (input.layout !== undefined) {
    if (!['card', 'photo'].includes(input.layout)) throw badRequest('Unknown layout');
    out.layout = input.layout;
  }
  if (input.logo !== undefined) {
    if (!['yax', 'custom', 'none'].includes(input.logo)) throw badRequest('Unknown logo choice');
    out.logo = input.logo;
  }
  if (input.heading_font !== undefined) {
    if (!(input.heading_font in HEADING_FONTS)) throw badRequest('Unknown heading font');
    out.heading_font = input.heading_font;
  }
  if (input.arabic_font !== undefined) {
    if (!(input.arabic_font in ARABIC_FONTS)) throw badRequest('Unknown Arabic font');
    out.arabic_font = input.arabic_font;
  }
  for (const [k, max] of Object.entries(TEXTS)) {
    if (input[k] === undefined || input[k] === null) continue;
    const v = String(input[k]).trim();
    if (v.length > max) throw badRequest(`Keep that text under ${max} characters`);
    out[k] = v;
  }
  return out;
}

export const assetUrl = (id) => (id ? `/api/public/assets/${id}` : null);

/**
 * Recognises an uploaded image by its first bytes (not by what the browser
 * claims), so only real PNG, JPEG or WebP photos are ever stored and served.
 * SVG is refused on purpose: it can carry scripts.
 */
export function imageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** The design an event's invitation uses: saved choices over the YAX defaults, plus image links. */
export function resolveDesign(event) {
  let saved = {};
  try { saved = event.design ? JSON.parse(event.design) : {}; } catch { saved = {}; }
  const d = { ...DEFAULT_DESIGN, ...cleanDesignSafe(saved) };
  const asset = (kind) => get('SELECT id FROM event_assets WHERE event_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1', event.id, kind)?.id;
  const cover = asset('cover');
  const logo = asset('logo');
  return {
    ...d,
    cover_url: assetUrl(cover),
    logo_url: assetUrl(logo),
    // Without a photo the photo layout falls back to the card; without an upload, "own logo" falls back to YAX.
    layout: d.layout === 'photo' && !cover ? 'card' : d.layout,
    logo: d.logo === 'custom' && !logo ? 'yax' : d.logo,
    on_accent: readableOn(d.accent),
    on_background: readableOn(d.background),
  };
}

function cleanDesignSafe(saved) {
  try { return cleanDesign(saved); } catch { return {}; }
}

// --- Colour contrast (WCAG) --------------------------------------------
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** Off-white or charcoal, whichever reads better on this colour. */
export const readableOn = (hex) => (contrast(hex, '#f1ece9') >= contrast(hex, '#1e1b1a') ? '#f1ece9' : '#1e1b1a');

