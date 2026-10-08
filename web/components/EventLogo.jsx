import { useEffect, useState } from 'react';

const LIGHT = [241, 236, 233]; // YAX off-white, as used on the sidebar

/**
 * Makes a logo readable on the dark sidebar: a white background is removed,
 * and black or grey parts (usually the lettering) become off-white. Coloured
 * parts are left as they are. Falls back to the original image if anything
 * goes wrong.
 */
async function forDarkBackground(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const at = (x, y) => (y * canvas.width + x) * 4;
  // A white background shows as opaque near-white corners.
  const corners = [at(0, 0), at(canvas.width - 1, 0), at(0, canvas.height - 1), at(canvas.width - 1, canvas.height - 1)];
  const whiteBackground = corners.every((i) => px[i + 3] > 200 && px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const [r, gr, b] = [px[i], px[i + 1], px[i + 2]];
    const max = Math.max(r, gr, b);
    const min = Math.min(r, gr, b);
    const grey = max - min < 40; // no real colour
    if (whiteBackground && grey && min > 225) {
      // Fade near-white out, keeping soft edges.
      px[i + 3] = Math.round(px[i + 3] * Math.min(1, (255 - min) / 30));
    } else if (grey && max < 140) {
      // Dark lettering → off-white; the alpha channel keeps the smooth edges.
      [px[i], px[i + 1], px[i + 2]] = LIGHT;
    }
  }
  g.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The event's logo, adjusted for the dark sidebar and top bar. */
export default function EventLogo({ url, alt = '', className = '' }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    forDarkBackground(url).then((s) => live && setSrc(s)).catch(() => live && setSrc(url));
    return () => { live = false; };
  }, [url]);
  return src ? <img className={className} src={src} alt={alt} /> : <span className={className} aria-hidden />;
}
