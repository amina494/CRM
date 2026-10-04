// Brand colours used outside the web app (invitation emails, wallet passes).
// Keep in sync with --brand / --accent at the top of web/styles.css.
import './config.js'; // loads .env before reading BRAND_* below
export const brand = {
  primary: process.env.BRAND_PRIMARY || '#1e1b1a',
  accent: process.env.BRAND_ACCENT || '#ef5f22',
  onPrimary: '#f1ece9',
  background: '#e7e3e1',
  font: "'IBM Plex Sans', 'IBM Plex Sans Arabic', Arial, sans-serif",
};

/** "#1e1b1a" -> "rgb(30,27,26)" (Apple Wallet's colour format). */
export function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}
