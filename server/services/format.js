// Formatting helpers shared by invitations, wallet passes and calendar files.

export function guestDisplayName(g, lang = g.language || 'en') {
  if (lang === 'ar' && g.name_ar) return g.name_ar;
  return [g.title, g.first_name, g.last_name].filter(Boolean).join(' ');
}

/** "2026-11-12T19:30" (venue local time) -> Date in UTC using the event timezone. */
export function localToDate(local, timeZone = 'Asia/Riyadh') {
  if (!local) return null;
  const [d, t = '00:00'] = local.split('T');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m] = t.split(':').map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, m);
  // Find the timezone offset at that instant and correct for it.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (asIfUtc - guess));
}

export function formatEventDate(local, lang = 'en', timeZone = 'Asia/Riyadh') {
  const date = localToDate(local, timeZone);
  if (!date) return '';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(date);
}

/** Today's date (YYYY-MM-DD) in the given timezone. */
export function todayIn(timeZone = 'Asia/Riyadh') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
