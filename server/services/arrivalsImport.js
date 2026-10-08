// Turns an event-operations spreadsheet (the arrivals / departures workbook the
// team already keeps, plus an optional liaison list) into a plan for a new
// event: guests, companions, hotels, flights and liaisons.
//
// The workbooks grow over time, so the same person usually appears on several
// tabs. Tabs further to the right are treated as newer: their values win, and
// older tabs only fill gaps. Every disagreement is reported so someone can
// check it before anything is created. Hidden tabs are ignored.
//
// Only the columns listed in ARRIVAL_COLUMNS / LIAISON_COLUMNS are ever read.
// Passport, visa, ticket and medical columns in these workbooks are skipped.
import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return cellValue(v.richText.map((t) => t.text).join(''));
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return cellValue(v.text);
    return null; // errors such as #REF!
  }
  if (typeof v === 'string') return v.trim() || null;
  return v;
}

/** Reads an .xlsx buffer into [{ name, hidden, rows: [[value, …], …] }]. */
export async function readWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw Object.assign(new Error('This file could not be read as an Excel (.xlsx) workbook'), { status: 400 });
  }
  return wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.from(row.values.slice(1), cellValue);
      if (values.some((v) => v != null)) rows.push(values);
    });
    return { name: ws.name.trim(), hidden: ws.state !== 'visible', rows };
  });
}

// ---------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------

const head = (h) => String(h ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const text = (v) => (v == null ? null : (v instanceof Date ? null : String(v).replace(/\s+/g, ' ').trim()) || null);
const pad = (n) => String(n).padStart(2, '0');

export function toDate(v) {
  if (v instanceof Date && v.getUTCFullYear() > 1900) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  const m = typeof v === 'string' && v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // 05/02/2026, day first
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
}

export function toTime(v) {
  if (v instanceof Date && v.getUTCFullYear() <= 1900) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const m = typeof v === 'string' && v.match(/\b(\d{1,2})[:.](\d{2})\b/);
  return m && Number(m[1]) < 24 ? `${pad(m[1])}:${m[2]}` : null;
}

const TITLE_RE = /^(h\.\s?e\.?|hon\.?|dr\.?|prof\.?|mr\.?|mrs\.?|ms\.?|miss|dg|eng\.?|sheikh|hrh)(\s+|(?<=\.)(?=\S))/i;

/** "H.E. Fo'an Lan" → { title: 'H.E.', first: "Fo'an", last: 'Lan' }. */
export function splitName(raw) {
  let rest = String(raw).replace(/\s+/g, ' ').trim();
  const titles = [];
  for (let m = rest.match(TITLE_RE); m; m = rest.match(TITLE_RE)) {
    titles.push(m[1].trim());
    rest = rest.slice(m[0].length).trim();
  }
  // Names typed in capitals read better in title case.
  if (/\p{Lu}{2}/u.test(rest) && rest === rest.toUpperCase()) {
    rest = rest.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  }
  const [first, ...last] = rest.split(' ');
  return { title: titles.join(' ') || null, first, last: last.join(' ') || null };
}

/** Matching key for a person: no titles, case, spaces or punctuation. */
export function personKey(raw) {
  const { first, last } = splitName(raw);
  return `${first} ${last || ''}`.toLowerCase().normalize('NFKD').replace(/[^\p{L}]/gu, '');
}

const nameTokens = (raw) => {
  const { first, last } = splitName(raw);
  return `${first} ${last || ''}`.toLowerCase().normalize('NFKD').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter((t) => t.length > 1);
};

const CATEGORY = { vvip: 'vvip', vip: 'vip', speaker: 'vip', delegate: 'delegation', delegation: 'delegation', companion: 'companion', media: 'media', press: 'media', staff: 'staff' };
const categoryOf = (type) => CATEGORY[String(type || '').toLowerCase().trim()] || 'general';

const AIRLINES = {
  SV: 'Saudia', XY: 'flynas', F3: 'flyadeal', QR: 'Qatar Airways', EK: 'Emirates', FZ: 'flydubai', EY: 'Etihad',
  ET: 'Ethiopian Airlines', CA: 'Air China', CX: 'Cathay Pacific', BA: 'British Airways', TK: 'Turkish Airlines',
  MS: 'EgyptAir', GF: 'Gulf Air', WY: 'Oman Air', KU: 'Kuwait Airways', RJ: 'Royal Jordanian', LH: 'Lufthansa',
  AF: 'Air France', KL: 'KLM', PK: 'PIA', AI: 'Air India', '6E': 'IndiGo', G9: 'Air Arabia',
};

/** "SV 382/SV1630" → ['SV 382', 'SV 1630']; charter / TBD / '-' give []. */
export function flightLegs(v) {
  const s = text(v);
  if (!s || /^(charter|tbd|tba|-+|n\/?a|no)$/i.test(s)) return [];
  return s.split(/[/,]|\bthen\b/i).map((leg) => leg.trim().toUpperCase()
    .replace(/^([A-Z0-9]{2})\s*-?\s*(\d{1,4}[A-Z]?)$/, '$1 $2')).filter((leg) => leg && !/^CHARTER/.test(leg));
}

function travelMode(v) {
  const s = String(v ?? '').toLowerCase();
  if (/charter\s*a\b/.test(s)) return 'Charter A';
  if (/charter\s*b\b/.test(s)) return 'Charter B';
  if (/private|\bpj\b|jet/.test(s)) return 'Private jet';
  if (/charter|^yes$/.test(s.trim())) return 'Charter';
  if (/flight|^no$/.test(s.trim())) return 'Flight';
  return null;
}

function yesNo(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(y|yes|true|1)$/.test(s) || /^priv/.test(s)) return true; // private jets use the executive terminal
  if (/^(n|no|false|0)$/.test(s)) return false;
  return null;
}

const NO_HOTEL = /^(other|no need|not registered|none|-+|n\/?a|hotel|tbd|tba)$/i;
const compact = (s) => s.toLowerCase().replace(/[^\p{L}\d]/gu, '');

/** "Habitas /Alcove / King Bed - 45 SQM" → { hotel: 'Habitas', room: 'Alcove / King Bed - 45 SQM' }. */
function splitHotel(v) {
  const s = text(v);
  if (!s) return null;
  if (NO_HOTEL.test(s)) return { hotel: null, note: `Hotel: ${s}` };
  const [name, ...room] = s.split('/').map((x) => x.trim()).filter(Boolean);
  const own = name.match(/^(.*?)\s+by (his |her |their )?own$/i);
  return own ? { hotel: own[1], room: room.join(' / ') || null, note: 'Own booking' }
    : { hotel: name, room: room.join(' / ') || null };
}

export function normalisePhone(v) {
  if (v == null) return null;
  let s = String(v).replace(/[^\d+]/g, '');
  if (!s) return null;
  if (/^5\d{8}$/.test(s)) s = `+966${s}`;
  else if (/^05\d{8}$/.test(s)) s = `+966${s.slice(1)}`;
  else if (/^9665\d{8}$/.test(s)) s = `+${s}`;
  else if (/^00/.test(s)) s = `+${s.slice(2)}`;
  return s;
}

// ---------------------------------------------------------------------------
// Arrivals workbook
// ---------------------------------------------------------------------------

/**
 * Works out which column holds what. Columns before the first "departure"
 * header describe the arrival; columns after it describe the departure, so
 * repeated headers such as "FLIGHT NUMBER" and "TIME" land in the right place.
 */
export function arrivalColumns(header) {
  const cols = {};
  let phase = 'arr';
  const set = (field, i) => { if (cols[field] === undefined) cols[field] = i; };
  header.forEach((raw, i) => {
    const h = head(raw);
    if (!h) return;
    if (/^DEPA/.test(h)) phase = 'dep';
    else if (/^ARRIVAL/.test(h) && !/SAUDI/.test(h)) phase = 'arr';
    if (h === 'NAME') set('name', i);
    else if (/^(COUNTRY|NATIONALITY)$/.test(h)) set('country', i);
    else if (/^POS(I)?TION$/.test(h)) set('position', i);
    else if (h === 'TYPE') set('type', i);
    else if (/^HOTEL/.test(h)) set('hotel', i);
    else if (/TIME/.test(h) && !/SAUDI/.test(h)) set(`${phase}_time`, i);
    else if (/^(ARRIVAL|DEPA)/.test(h) && !/SAUDI/.test(h)) set(`${phase}_date`, i);
    else if (/^FLIGHT/.test(h)) set(`${phase}_flight`, i);
    else if (/^CHARTER/.test(h)) set(`${phase}_mode`, i);
    else if (h === 'ATF' || h === 'TANFEETHI') set(`${phase}_atf`, i);
    else if (/^(CITY|STOP 1)$/.test(h)) set('dep_city', i);
    else if (/^ROOMS? NOTES?$/.test(h)) set('room_note', i);
    else if (/^NOTES?$/.test(h)) set('note', i);
    else if (h === 'PA') set('pa', i);
    else if (h === 'DRIVER') set('driver', i);
  });
  return cols;
}

const headerIndex = (rows) => rows.slice(0, 5).findIndex((r) => r.some((v) => head(v) === 'NAME'));

/** "ARRIVAL TO AL ULA" → "Al Ula": where the event is. */
function placeFrom(header) {
  for (const raw of header) {
    const m = head(raw).match(/^(?:ARRIVAL TO|DEPARTURE FROM|DEPATURE DATE FROM)\s+(.+)$/);
    if (m && !/SAUDI/.test(m[1])) return m[1].toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  }
  return null;
}

function readArrivalTab(tab) {
  const hi = headerIndex(tab.rows);
  if (hi < 0) return null;
  const cols = arrivalColumns(tab.rows[hi]);

  if (cols.arr_date === undefined && cols.dep_date === undefined) return null;
  const get = (row, f) => (cols[f] === undefined ? null : row[cols[f]] ?? null);
  const records = [];
  tab.rows.slice(hi + 1).forEach((row, n) => {
    const name = text(get(row, 'name'));
    if (!name || head(name) === 'NAME') return;
    const leg = (p) => {
      const legs = flightLegs(get(row, `${p}_flight`));
      const date = toDate(get(row, `${p}_date`));
      const time = toTime(get(row, `${p}_time`));
      const mode = travelMode(get(row, `${p}_mode`)) || (/charter/i.test(String(get(row, `${p}_flight`) ?? get(row, `${p}_date`) ?? '')) ? 'Charter' : null);
      const atf = yesNo(get(row, `${p}_atf`));
      if (!date && !legs.length && !time && !mode) return null;
      return { date, time, legs, mode, atf };
    };
    records.push({
      tab: tab.name, row: hi + n + 2, name,
      country: text(get(row, 'country')), position: text(get(row, 'position')), type: text(get(row, 'type')),
      hotel: splitHotel(get(row, 'hotel')),
      arrival: cols.arr_date !== undefined ? leg('arr') : null,
      departure: cols.dep_date !== undefined ? leg('dep') : null,
      city: text(get(row, 'dep_city')),
      note: text(get(row, 'note')), room_note: text(get(row, 'room_note')),
      pa: yesNo(get(row, 'pa')), driver: yesNo(get(row, 'driver')),
    });
  });
  return records;
}

const legLabel = (l) => (l ? [l.date, l.time, l.legs.join('/') || l.mode].filter(Boolean).join(' ') : '');
// "SV 1631" and "SV 1631/SV 389" describe the same trip; so do "Charter" and "Charter B".
const sameLegs = (a, b) => !a.length || !b.length || a.every((x) => b.includes(x)) || b.every((x) => a.includes(x));
const sameMode = (a, b) => !a || !b || a === b || (/^Charter/.test(a) && /^Charter/.test(b) && (a === 'Charter' || b === 'Charter'));
const sameLeg = (a, b) => sameLegs(a.legs, b.legs) && (!a.date || !b.date || a.date === b.date)
  && (sameMode(a.mode, b.mode) || (a.legs.length > 0 && b.legs.length > 0));

/** Newest record with a value for this part wins; older ones fill its gaps. */
function mergeLeg(records, part, conflicts, who) {
  const withLeg = records.filter((r) => r[part]);
  if (!withLeg.length) return null;
  const chosen = { ...withLeg.at(-1)[part] };
  const from = withLeg.at(-1).tab;
  for (const older of withLeg.slice(0, -1).reverse()) {
    const o = older[part];
    if (!sameLeg(chosen, o)) {
      if (conflicts.some((c) => c.guest === who && c.field === part && c.other === legLabel(o))) continue;
      conflicts.push({ guest: who, field: part, chosen: legLabel(chosen), chosen_tab: from, other: legLabel(o), other_tab: older.tab });
      continue;
    }
    for (const k of ['date', 'time', 'mode', 'atf']) if (chosen[k] == null && o[k] != null) chosen[k] = o[k];
    if (chosen.mode === 'Charter' && /^Charter ./.test(o.mode || '')) chosen.mode = o.mode;
    if (!chosen.legs.length && o.legs.length) chosen.legs = o.legs;
  }
  return chosen;
}

function newestValue(records, pick, conflicts, who, field, label = (v) => v) {
  const vals = records.map((r) => ({ v: pick(r), tab: r.tab })).filter((x) => x.v != null);
  if (!vals.length) return null;
  const chosen = vals.at(-1);
  const seen = new Set([compact(label(chosen.v))]);
  for (const o of vals.slice(0, -1).reverse()) {
    const key = compact(label(o.v));
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ guest: who, field, chosen: label(chosen.v), chosen_tab: chosen.tab, other: label(o.v), other_tab: o.tab });
  }
  return chosen.v;
}

/** Groups spelling variants of a hotel ("Cloud7", "Cloud 7"; "Habitas", "Our Habitas"). */
function canonicalHotels(names) {
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  const groups = [];
  for (const [n, c] of [...counts].sort((a, b) => b[1] - a[1])) {
    const k = compact(n);
    const g = groups.find((x) => x.keys.some((y) => y === k || (Math.min(y.length, k.length) >= 5 && (y.includes(k) || k.includes(y)))));
    if (g) { g.keys.push(k); g.names.push(n); } else groups.push({ name: n, keys: [k], names: [n], count: c });
  }
  const map = new Map();
  for (const g of groups) {
    // Prefer the longest common spelling ("Our Habitas" over "Habitas").
    const best = g.names.reduce((a, b) => (counts.get(b) >= counts.get(a) / 3 && b.length > a.length ? b : a));
    for (const n of g.names) map.set(n, best);
  }
  return map;
}

const COMPANION_RE = /companion|spouse|wife|husband|accompan/i;
const STOP_WORDS = new Set(['companion', 'of', 'to', 'the', 'his', 'her', 'mr', 'mrs', 'ms', 'dr', 'he', 'minister', 'governor', 'spouse', 'spouses', 'wife', 'husband', 'and', 'director', 'executive', 'office']);

function companionTarget(position) {
  const m = String(position || '').match(/(?:companion|accompan\w*)\s*(?:of|to|for|:)?\s*(.+)$/i);
  if (!m) return [];
  return m[1].toLowerCase().normalize('NFKD').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

// ---------------------------------------------------------------------------
// Liaison workbook
// ---------------------------------------------------------------------------

export function liaisonColumns(header) {
  const cols = {};
  header.forEach((raw, i) => {
    const h = head(raw);
    const set = (f) => { if (cols[f] === undefined) cols[f] = i; };
    if (h === 'NAME') set('name');
    else if (h === 'LIAISON NAME') set('liaison');
    else if (/^(PHONE|MOBILE)/.test(h)) set('phone');
    else if (h === 'TRANSPORT TYPE' || h === 'CAR TYPE') set('car');
  });
  return cols;
}

function readLiaisonTabs(tabs) {
  const out = [];
  for (const tab of tabs) {
    if (tab.hidden) continue;
    const hi = headerIndex(tab.rows);
    if (hi < 0) continue;
    const cols = liaisonColumns(tab.rows[hi]);
    if (cols.name === undefined || cols.liaison === undefined) continue;
    const departure = /DEPART/i.test(tab.name);
    for (const row of tab.rows.slice(hi + 1)) {
      const guest = text(row[cols.name]);
      const liaison = text(row[cols.liaison]);
      if (!guest || head(guest) === 'NAME') continue;
      out.push({
        tab: tab.name, departure, guest, liaison,
        phone: cols.phone === undefined ? null : normalisePhone(row[cols.phone]),
        car: cols.car === undefined ? null : text(row[cols.car]),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

const titleCase = (s) => (s && s.length > 4 && s === s.toUpperCase() && /\p{Lu}{2}/u.test(s)
  ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : s);

/**
 * Builds the import plan from the arrivals workbook and, optionally, the
 * liaison workbook. Nothing is written to the database here.
 */
export function buildPlan(arrivalTabs, liaisonTabs = null) {
  const places = [];
  const used = [];
  const skipped = [];
  const records = [];
  arrivalTabs.forEach((tab) => {
    if (tab.hidden) { skipped.push({ tab: tab.name, reason: 'hidden' }); return; }
    const recs = readArrivalTab(tab);
    if (!recs) { skipped.push({ tab: tab.name, reason: tab.rows.length ? 'no name and travel columns' : 'empty' }); return; }
    used.push({ tab: tab.name, rows: recs.length });
    const place = placeFrom(tab.rows[headerIndex(tab.rows)]);
    if (place) places.push(place);
    records.push(...recs);
  });
  if (!records.length) {
    throw Object.assign(new Error('No guests found. The sheet needs a NAME column and arrival or departure columns.'), { status: 400 });
  }

  const byKey = new Map();
  for (const r of records) {
    const k = personKey(r.name);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }

  const hotelNames = canonicalHotels(records.map((r) => r.hotel?.hotel).filter(Boolean));
  const conflicts = [];
  const guests = [];
  for (const [key, recs] of byKey) {
    const latest = recs.at(-1);
    const who = latest.name;
    const nm = splitName(who);
    const pick = (f) => [...recs].reverse().map((r) => r[f]).find((v) => v != null) ?? null;
    const hotel = newestValue(recs, (r) => (r.hotel?.hotel ? { ...r.hotel, hotel: hotelNames.get(r.hotel.hotel) } : null), conflicts, who, 'hotel', (h) => h.hotel);
    const hotelNotes = recs.map((r) => r.hotel?.note).filter(Boolean);
    const arrival = mergeLeg(recs, 'arrival', conflicts, who);
    const departure = mergeLeg(recs, 'departure', conflicts, who);
    if (departure && departure.atf == null && arrival) departure.atf = arrival.atf;
    const type = pick('type');
    const position = pick('position');
    const notes = [];
    if (type && !/^(vip|delegate|companion)$/i.test(type)) notes.push(`Type: ${type}`);
    if (recs.some((r) => r.pa)) notes.push('PA: yes');
    if (recs.some((r) => r.driver)) notes.push('Driver: yes');
    if (!hotel && hotelNotes.length) notes.push(hotelNotes.at(-1));
    else if (hotel && hotelNotes.includes('Own booking')) notes.push('Hotel: own booking');
    for (const n of new Set(recs.map((r) => r.note).filter(Boolean))) notes.push(n);
    guests.push({
      // A title written on any tab ("H.E.") is kept even if the newest tab left it out.
      key, name: who, title: nm.title || [...recs].reverse().map((r) => splitName(r.name).title).find(Boolean) || null, first_name: nm.first, last_name: nm.last,
      nationality: titleCase(pick('country')), position, type, category: categoryOf(type),
      hotel: hotel?.hotel || null, room_type: hotel?.room || null,
      room_note: [...new Set(recs.map((r) => r.room_note).filter(Boolean))].join('; ') || null,
      arrival, departure, city: pick('city'),
      notes, tabs: [...new Set(recs.map((r) => r.tab))],
      relationship: null, lead_key: null, lead_how: null, liaison: null, backup_liaison: null,
    });
  }

  // Companions: "companion of Johnson", "Companion to Minister Lan", "Spouse".
  const byGuestKey = new Map(guests.map((g) => [g.key, g]));
  const leads = guests.filter((g) => g.category !== 'companion' && !COMPANION_RE.test(g.position || ''));
  const linked = [];
  const unlinked = [];
  for (const g of guests) {
    const isCompanion = g.category === 'companion' || COMPANION_RE.test(g.position || '');
    if (!isCompanion) continue;
    g.category = 'companion';
    g.relationship = /spouse|wife|husband/i.test(g.position || '') ? 'Spouse' : 'Companion';
    const wanted = companionTarget(g.position);
    let found = [];
    let how = null;
    if (wanted.length) {
      found = leads.filter((l) => nameTokens(l.name).some((t) => wanted.includes(t)));
      if (found.length > 1) found = found.filter((l) => l.nationality && l.nationality === g.nationality);
      how = `named in position ("${g.position}")`;
    }
    if (!found.length) {
      // Next best: the row just above on the newest tab, from the same country.
      const rec = byKey.get(g.key).at(-1);
      const above = records.filter((r) => r.tab === rec.tab && r.row < rec.row).at(-1);
      const lead = above && byGuestKey.get(personKey(above.name));
      if (lead && leads.includes(lead) && lead.nationality && lead.nationality === g.nationality) {
        found = [lead];
        how = `listed just above on "${rec.tab}"`;
      }
    }
    if (found.length === 1) {
      g.lead_key = found[0].key;
      g.lead_how = how;
      linked.push({ guest: g.name, lead: found[0].name, how });
    } else {
      unlinked.push({ guest: g.name, position: g.position, candidates: found.map((f) => f.name) });
    }
  }

  // Liaisons. On a tab named "departure" the liaison becomes the backup host.
  const liaisons = new Map();
  const liaisonUnmatched = [];
  const liaisonSimilar = [];
  if (liaisonTabs) {
    const rows = readLiaisonTabs(liaisonTabs);
    if (!rows.length) {
      throw Object.assign(new Error('No liaison list found. It needs NAME and LIAISON NAME columns on a visible tab.'), { status: 400 });
    }
    const unmatched = new Set();
    const similar = [];
    const findGuest = (name) => {
      const exact = byGuestKey.get(personKey(name));
      if (exact) return exact;
      // "Abdullah Fahad Bin Zaraah" on the liaison list, "Abdullah bin Zaraah" on the arrivals.
      const t = nameTokens(name);
      const hits = guests.filter((g) => {
        const u = nameTokens(g.name);
        const [a, b] = t.length <= u.length ? [t, u] : [u, t];
        return a.length >= 2 && a.every((x) => b.includes(x));
      });
      if (hits.length !== 1) return null;
      if (!similar.some((x) => x.listed === name)) similar.push({ listed: name, matched: hits[0].name });
      return hits[0];
    };
    for (const r of rows) {
      const g = findGuest(r.guest);
      if (!g) { unmatched.add(r.guest); continue; }
      if (r.car) g.car = titleCase(r.car);
      if (!r.liaison) continue;
      const lk = personKey(r.liaison);
      const l = liaisons.get(lk) || { key: lk, name: titleCase(r.liaison), phone: null, guests: 0 };
      if (r.phone) l.phone = r.phone;
      liaisons.set(lk, l);
      if (r.departure) {
        if (g.liaison !== lk) g.backup_liaison = lk;
      } else {
        g.liaison = lk;
      }
    }
    for (const g of guests) {
      // Only a departure liaison: they become the main host.
      if (!g.liaison && g.backup_liaison) { g.liaison = g.backup_liaison; g.backup_liaison = null; }
      if (g.backup_liaison === g.liaison) g.backup_liaison = null;
      if (g.liaison) liaisons.get(g.liaison).guests += 1;
      if (g.car) g.notes.push(`Car: ${g.car}`);
    }
    liaisonUnmatched.push(...unmatched);
    liaisonSimilar.push(...similar);
  }

  // Flights: one per direction, day, flight and time, split by Tanfeethi so
  // protocol passengers can be handled separately from the rest.
  const flights = new Map();
  const addFlight = (g, direction) => {
    const leg = g[direction];
    if (!leg?.date) return;
    const label = leg.legs.length ? (direction === 'arrival' ? leg.legs.at(-1) : leg.legs[0]) : (leg.mode && leg.mode !== 'Flight' ? leg.mode : null);
    if (!label) return;
    const tanfeethi = Boolean(leg.atf);
    const k = [direction, leg.date, label, leg.time || '', tanfeethi].join('|');
    if (!flights.has(k)) {
      const code = label.split(' ')[0];
      flights.set(k, {
        direction, date: leg.date, time: leg.time, label, tanfeethi,
        airline: leg.legs.length ? (AIRLINES[code] || null) : (leg.mode === 'Private jet' ? 'Private jet' : 'Charter'),
        mode: leg.mode, guests: [], destinations: new Set(), vias: new Set(),
      });
    }
    const f = flights.get(k);
    f.guests.push(g.key);
    if (direction === 'departure' && g.city) f.destinations.add(titleCase(g.city));
    if (leg.legs.length > 1) f.vias.add(leg.legs.join(' → '));
    g[`${direction}_flight`] = k;
  };
  for (const g of guests) {
    for (const p of ['arrival', 'departure']) {
      addFlight(g, p);
      const leg = g[p];
      if (leg && !g[`${p}_flight`] && (leg.date || leg.time)) {
        g.notes.push(`${p === 'arrival' ? 'Arrival' : 'Departure'}: ${[leg.date, leg.time, leg.mode].filter(Boolean).join(' ')} (no flight number)`);
      }
    }
  }

  // The event window is where most travel dates fall; a stray "2016" is a typo
  // to check rather than the start of the event.
  const all = guests.flatMap((g) => [g.arrival?.date, g.departure?.date]).filter(Boolean).sort();
  const median = all.length ? Date.parse(all[Math.floor(all.length / 2)]) : 0;
  const near = (d) => Math.abs(Date.parse(d) - median) <= 45 * 864e5;
  const dates = all.filter(near);
  const oddDates = guests.flatMap((g) => ['arrival', 'departure']
    .filter((p) => g[p]?.date && !near(g[p].date)).map((p) => ({ guest: g.name, field: p, date: g[p].date })));
  const possibleDuplicates = [];
  for (let i = 0; i < guests.length; i++) {
    for (let j = i + 1; j < guests.length; j++) {
      const a = nameTokens(guests[i].name);
      const b = nameTokens(guests[j].name);
      const [s, l] = a.length <= b.length ? [a, b] : [b, a];
      if (s.length >= 2 && s.every((t) => l.includes(t))) possibleDuplicates.push([guests[i].name, guests[j].name]);
    }
  }

  return {
    guests,
    flights: [...flights.values()].map((f) => ({ ...f, destinations: [...f.destinations], vias: [...f.vias] })),
    hotels: [...new Set(guests.map((g) => g.hotel).filter(Boolean))].sort(),
    liaisons: [...liaisons.values()].sort((a, b) => a.name.localeCompare(b.name)),
    suggested: { starts_on: dates[0] || null, ends_on: dates.at(-1) || null, venue: places.at(-1) || null },
    report: {
      tabs_used: used,
      tabs_skipped: skipped,
      conflicts,
      companions_linked: linked,
      companions_unlinked: unlinked,
      possible_duplicates: possibleDuplicates,
      no_arrival: guests.filter((g) => !g.arrival_flight).map((g) => g.name),
      no_departure: guests.filter((g) => !g.departure_flight).map((g) => g.name),
      no_hotel: guests.filter((g) => !g.hotel).map((g) => g.name),
      liaison_unmatched: [...new Set(liaisonUnmatched)],
      liaison_similar: liaisonSimilar,
      odd_dates: oddDates,
      no_liaison: liaisonTabs ? guests.filter((g) => !g.liaison).map((g) => g.name) : [],
    },
  };
}
