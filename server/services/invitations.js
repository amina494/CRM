// Bilingual (English / Arabic) invitation content.
import { config } from '../config.js';
import { brand } from '../brand.js';
import { headingStack, resolveDesign } from './design.js';
import { escapeHtml, formatEventDate, guestDisplayName } from './format.js';

export const inviteUrl = (guest) => `${config.publicUrl}/i/${guest.invite_token}`;

export function invitationContent(event, guest) {
  const lang = guest.language || 'en';
  const url = inviteUrl(guest);
  const name = guestDisplayName(guest, lang);
  const when = formatEventDate(event.starts_at, lang, event.timezone);
  const deadline = event.rsvp_deadline ? formatEventDate(event.rsvp_deadline, lang, event.timezone) : '';
  const design = resolveDesign(event);
  const kicker = lang === 'ar' ? design.kicker_ar : design.kicker_en;
  const closing = lang === 'ar' ? design.closing_ar : design.closing_en;

  if (lang === 'ar') {
    const eventName = event.name_ar || event.name;
    const venue = event.venue_ar || event.venue || '';
    const host = event.host_name_ar || event.host_name || config.orgName;
    const text = [
      `${name}،`,
      `يتشرف ${host} بدعوتكم لحضور ${eventName}`,
      when && `الموعد: ${when}`,
      venue && `المكان: ${venue}`,
      `للرد على الدعوة وإضافتها إلى المحفظة: ${url}`,
      deadline && `نرجو التكرم بالرد قبل ${deadline}`,
      closing,
    ].filter(Boolean).join('\n');
    return { subject: `دعوة: ${eventName}`, text, html: htmlLayout('rtl', 'ar', text, url, 'الرد على الدعوة', design, kicker) };
  }

  const host = event.host_name || config.orgName;
  const text = [
    `Dear ${name},`,
    `${host} cordially invites you to ${event.name}.`,
    when && `When: ${when}`,
    event.venue && `Where: ${event.venue}`,
    event.dress_code && `Dress code: ${event.dress_code}`,
    `Please RSVP and add your pass to your wallet: ${url}`,
    deadline && `Kindly respond by ${deadline}.`,
    closing,
  ].filter(Boolean).join('\n');
  return { subject: `Invitation: ${event.name}`, text, html: htmlLayout('ltr', 'en', text, url, 'View invitation & RSVP', design, kicker) };
}

// Email follows the event's invitation design. Email apps ignore web fonts,
// so the chosen heading font is named first with safe fallbacks after it.
function htmlLayout(dir, lang, text, url, cta, d, kicker) {
  const align = dir === 'rtl' ? 'right' : 'left';
  const abs = (u) => `${config.publicUrl}${u}`;
  const headFont = escapeHtml(lang === 'ar' ? `'${d.arabic_font}', Tahoma, Arial, sans-serif` : headingStack(d.heading_font));
  const bodyFont = escapeHtml(lang === 'ar' ? `'${d.arabic_font}', Tahoma, Arial, sans-serif` : brand.font);
  const logoSrc = d.logo === 'custom' ? abs(d.logo_url) : d.logo === 'yax' ? abs('/yax-email-logo.png') : null;
  const lines = text.split('\n');
  const paragraphs = lines.slice(1).map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join('');
  return `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:${d.background};font-family:${bodyFont};color:${d.text}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${d.background}"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:${d.card};border-top:6px solid ${d.accent}">
${d.cover_url ? `<tr><td><img src="${escapeHtml(abs(d.cover_url))}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>` : ''}
${logoSrc ? `<tr><td style="padding:32px 40px 0;text-align:${align}"><img src="${escapeHtml(logoSrc)}" height="42" alt="${escapeHtml(config.orgName)}" style="display:inline-block;height:42px;width:auto;border:0"></td></tr>` : ''}
<tr><td style="padding:24px 40px 32px;text-align:${align}">
${kicker ? `<p style="margin:0 0 10px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${d.accent}">${escapeHtml(kicker)}</p>` : ''}
<p style="margin:0 0 20px;font-size:22px;font-family:${headFont};color:${d.heading}">${escapeHtml(lines[0])}</p>${paragraphs}
<p style="margin:28px 0 0;text-align:center"><a href="${escapeHtml(url)}" style="background:${d.accent};color:${d.on_accent};padding:14px 28px;text-decoration:none;display:inline-block;font-family:${bodyFont};font-size:15px;font-weight:600">${escapeHtml(cta)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
}
