// Bilingual (English / Arabic) invitation content.
import { config } from '../config.js';
import { brand } from '../brand.js';
import { escapeHtml, formatEventDate, guestDisplayName } from './format.js';

export const inviteUrl = (guest) => `${config.publicUrl}/i/${guest.invite_token}`;

export function invitationContent(event, guest) {
  const lang = guest.language || 'en';
  const url = inviteUrl(guest);
  const name = guestDisplayName(guest, lang);
  const when = formatEventDate(event.starts_at, lang, event.timezone);
  const deadline = event.rsvp_deadline ? formatEventDate(event.rsvp_deadline, lang, event.timezone) : '';

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
    ].filter(Boolean).join('\n');
    return { subject: `دعوة: ${eventName}`, text, html: htmlLayout('rtl', 'ar', name, text, url, 'الرد على الدعوة') };
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
  ].filter(Boolean).join('\n');
  return { subject: `Invitation: ${event.name}`, text, html: htmlLayout('ltr', 'en', name, text, url, 'View invitation & RSVP') };
}

function htmlLayout(dir, lang, name, text, url, cta) {
  const paragraphs = text.split('\n').slice(1).map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join('');
  return `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:${brand.background};font-family:${brand.font};color:${brand.primary}">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-top:6px solid ${brand.accent}">
<tr><td style="padding:32px 40px 0;text-align:${dir === 'rtl' ? 'right' : 'left'}"><img src="${config.publicUrl}/yax-email-logo.png" width="120" height="42" alt="YAX" style="display:block;border:0;${dir === 'rtl' ? 'margin-left:auto' : ''}"></td></tr>
<tr><td style="padding:24px 40px 32px;text-align:${dir === 'rtl' ? 'right' : 'left'}">
<p style="margin:0 0 20px;font-size:20px">${escapeHtml(text.split('\n')[0])}</p>${paragraphs}
<p style="margin:28px 0 0;text-align:center"><a href="${escapeHtml(url)}" style="background:${brand.primary};color:${brand.onPrimary};padding:14px 28px;text-decoration:none;display:inline-block;font-family:${brand.font};font-size:15px">${escapeHtml(cta)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
}
