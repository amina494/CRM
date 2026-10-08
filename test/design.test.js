// Per-event invitation design: access, validation, images, email and reset.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, get } from '../server/db.js';
import { createApp } from '../server/app.js';

let server;
let base;
function client() {
  const c = { cookie: '' };
  c.call = async (method, path, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(base + path, {
      method,
      headers: { ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...headers },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) c.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  c.login = (email) => c.call('POST', '/auth/login', { email, password: 'secret123' });
  return c;
}
const admin = client();
const anon = client();
const ids = {};
// The smallest valid PNG (1×1 pixel).
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201a2d54a1b0000000049454e44ae426082', 'hex');

before(async () => {
  openDb(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  await admin.call('POST', '/setup', { name: 'Admin', email: 'admin@x.com', password: 'secret123' });
  ids.a = (await admin.call('POST', '/events', { name: 'Gala', starts_at: '2030-01-10T19:00' })).data.id;
  ids.b = (await admin.call('POST', '/events', { name: 'Other', starts_at: '2030-02-10T19:00' })).data.id;
  const user = (name, email, memberships) => admin.call('POST', '/users', { name, email, password: 'secret123', memberships });
  await user('Coord', 'coord@x.com', [{ event_id: ids.a, role: 'coordinator' }]);
  await user('Liaison', 'liaison@x.com', [{ event_id: ids.a, role: 'liaison' }]);
  await user('Viewer', 'viewer@x.com', [{ event_id: ids.a, role: 'viewer' }]);
  await user('Coord B', 'coordb@x.com', [{ event_id: ids.b, role: 'coordinator' }]);
  ids.guest = (await admin.call('POST', `/events/${ids.a}/guests`, { first_name: 'Ahmed', email: 'a@x.com' })).data.id;
  ids.token = get('SELECT invite_token FROM guests WHERE id = ?', ids.guest).invite_token;
});
after(() => server.close());

test('only coordinators of the event (and admins) can change its invitation design', async () => {
  const coord = client(); await coord.login('coord@x.com');
  const liaison = client(); await liaison.login('liaison@x.com');
  const viewer = client(); await viewer.login('viewer@x.com');
  const other = client(); await other.login('coordb@x.com');
  assert.equal((await coord.call('GET', `/events/${ids.a}/design`)).data.design.accent, '#ef5f22', 'starts as YAX');
  assert.equal((await coord.call('PUT', `/events/${ids.a}/design`, { accent: '#b8901f', heading_font: 'Cinzel' })).status, 200);
  assert.equal((await liaison.call('PUT', `/events/${ids.a}/design`, { accent: '#000000' })).status, 403);
  assert.equal((await viewer.call('PUT', `/events/${ids.a}/design`, { accent: '#000000' })).status, 403);
  assert.equal((await other.call('PUT', `/events/${ids.a}/design`, { accent: '#000000' })).status, 404);
  assert.equal((await other.call('PUT', `/events/${ids.a}/design/image/cover`, PNG, { 'Content-Type': 'image/png' })).status, 404);
  const d = (await anon.call('GET', `/public/invite/${ids.token}`)).data.design;
  assert.equal(d.accent, '#b8901f');
  assert.equal(d.heading_font, 'Cinzel');
  assert.equal(d.card, '#fbf9f8', 'unchanged values keep the YAX default');
});

test('bad colours, unknown fonts and options are refused', async () => {
  for (const body of [{ accent: 'red' }, { card: '#fff' }, { background: 'url(x)' }, { heading_font: 'Comic Sans' },
    { arabic_font: '"><script>' }, { layout: 'fancy' }, { logo: 'yes' }, { kicker_en: 'x'.repeat(81) }]) {
    assert.equal((await admin.call('PUT', `/events/${ids.a}/design`, body)).status, 400, JSON.stringify(body).slice(0, 40));
  }
});

test('only real PNG, JPEG or WebP images are accepted, and they are served to the invitation', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await admin.call('PUT', `/events/${ids.a}/design/image/cover`, svg, { 'Content-Type': 'image/png' })).status, 400);
  assert.equal((await admin.call('PUT', `/events/${ids.a}/design/image/cover`, Buffer.from('GIF89a........'), { 'Content-Type': 'image/gif' })).status, 400);
  assert.equal((await admin.call('PUT', `/events/${ids.a}/design/image/poster`, PNG, { 'Content-Type': 'image/png' })).status, 400);
  const up = await admin.call('PUT', `/events/${ids.a}/design/image/cover`, PNG, { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200);
  const url = up.data.design.cover_url;
  assert.match(url, /^\/api\/public\/assets\/[\w-]{20,}$/);
  const img = await anon.call('GET', url.replace('/api', ''));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(img.data.equals(PNG));
  // A new upload replaces the old image.
  const again = await admin.call('PUT', `/events/${ids.a}/design/image/cover`, PNG, { 'Content-Type': 'image/png' });
  assert.notEqual(again.data.design.cover_url, url);
  assert.equal((await anon.call('GET', url.replace('/api', ''))).status, 404);
  assert.equal(get('SELECT COUNT(*) n FROM event_assets WHERE event_id = ?', ids.a).n, 1);
});

test('the photo layout and own logo fall back gracefully without their images', async () => {
  await admin.call('PUT', `/events/${ids.b}/design`, { layout: 'photo', logo: 'custom' });
  const d = (await admin.call('GET', `/events/${ids.b}/design`)).data.design;
  assert.equal(d.layout, 'card');
  assert.equal(d.logo, 'yax');
});

test('the invitation email follows the design, and wording is escaped', async () => {
  await admin.call('PUT', `/events/${ids.a}/design`, { card: '#fffaf2', kicker_en: 'Save the <date>', closing_en: 'See you <b>soon</b>' });
  const mail = (await admin.call('GET', `/guests/${ids.guest}/invitation-preview`)).data;
  assert.ok(mail.html.includes('#b8901f'), 'accent colour');
  assert.ok(mail.html.includes('#fffaf2'), 'card colour');
  assert.ok(mail.html.includes('/api/public/assets/'), 'cover photo');
  assert.ok(mail.html.includes('Save the &lt;date&gt;'));
  assert.ok(!mail.html.includes('<b>soon</b>'));
  assert.ok(mail.text.includes('See you <b>soon</b>'), 'the plain-text version keeps the words');
});

test('reset goes back to the YAX style and removes uploaded images', async () => {
  const r = await admin.call('PUT', `/events/${ids.a}/design`, { reset: true });
  assert.equal(r.data.design.accent, '#ef5f22');
  assert.equal(r.data.design.cover_url, null);
  assert.equal(get('SELECT COUNT(*) n FROM event_assets WHERE event_id = ?', ids.a).n, 0);
  assert.equal(get('SELECT design FROM events WHERE id = ?', ids.a).design, null);
});

test('the staff screens take the selected event\'s colours and logo, readable in light and dark', async () => {
  const { contrast } = await import('../server/services/design.js');
  const theme = async () => (await admin.call('GET', '/events')).data.find((e) => e.id === ids.b).theme;
  assert.equal(await theme(), null, 'an event without a design keeps the YAX look');
  await admin.call('PUT', `/events/${ids.b}/design`, { accent: '#2f80bf', background: '#eef5f4' });
  const t = await theme();
  assert.equal(t.light.accent, '#2f80bf');
  assert.ok(contrast(t.light.ink, '#ffffff') >= 4.5, 'links and buttons readable on white');
  assert.ok(contrast(t.dark.ink, '#1d1a19') >= 4.5, 'and on the dark screens');
  assert.ok(t.light.bg, 'a light page background tints the app');
  assert.equal(t.logo_url, null);
  await admin.call('PUT', `/events/${ids.b}/design/image/logo`, PNG, { 'Content-Type': 'image/png' });
  await admin.call('PUT', `/events/${ids.b}/design`, { logo: 'custom' });
  assert.match((await theme()).logo_url, /^\/api\/public\/assets\//);
  await admin.call('PUT', `/events/${ids.b}/design`, { reset: true });
  assert.equal(await theme(), null, 'reset brings the YAX look back');
});
