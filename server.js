'use strict';
const express = require('express');
const path = require('path');
const Datastore = require('@seald-io/nedb');
const { FEEDS, fetchFeed, loadMock } = require('./lib/feeds');

const PORT = process.env.PORT || 3004;
const REFRESH_MS = (Number(process.env.REFRESH_MIN) || 5) * 60 * 1000;
// Base URL used in ntfy alert click-throughs (set to your reverse-proxy host).
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// ── ntfy push alerts (scheduled) ────────────────────────────────────────
// Model: feeds are fetched continuously, but pushes are *scheduled* —
//   • crit/warn items queue up as they're discovered;
//   • a batched "flush" push goes out every ALERT_EVERY_MIN, but only inside
//     the ALERT_WINDOW (09:00–17:30 local);
//   • a morning briefing at SUMMARY_AT covers everything from overnight.
const NTFY_URL = process.env.NTFY_URL || '';
const ALERT_LEVELS = (process.env.ALERT_LEVELS || 'crit,warn').split(',').map((s) => s.trim());
const WIN_START = process.env.ALERT_WINDOW_START || '09:00';
const WIN_END = process.env.ALERT_WINDOW_END || '17:30';
const ALERT_EVERY_MS = (Number(process.env.ALERT_EVERY_MIN) || 15) * 60 * 1000;
const SUMMARY_AT = process.env.SUMMARY_AT || '09:00';
const SUMMARY_LOOKBACK_H = Number(process.env.SUMMARY_LOOKBACK_H) || 16;

// ── Persistence (embedded NoSQL — @seald-io/nedb) ───────────────────────
// Durable store so overnight items AND queued-but-unsent alerts survive a
// container restart. Memory stays the fast read-path; the DB is the truth.
const DATA_DIR = process.env.DATA_DIR || '/data';
const RETENTION_MS = (Number(process.env.RETENTION_DAYS) || 7) * 86400000;
const itemsDb = new Datastore({ filename: path.join(DATA_DIR, 'items.db') });
const metaDb = new Datastore({ filename: path.join(DATA_DIR, 'meta.db') });

let pendingAlerts = [];     // crit/warn items (each carrying .key) awaiting flush
let META = { initialised: false, lastSummaryDate: '', lastFlushTs: 0 };

function toDisplay(d) {
  return { source: d.source, title: d.title, link: d.link, ts: d.ts, category: d.category, severity: d.severity };
}
async function saveMeta() {
  await metaDb.updateAsync({ _id: 'state' }, { $set: { ...META, _id: 'state' } }, { upsert: true });
}
async function markFlushed(keys) {
  if (keys.length) await itemsDb.updateAsync({ key: { $in: keys } }, { $set: { flushed: true } }, { multi: true });
}
// Boot: hydrate ITEMS / dedup set / pending alerts / meta from disk.
async function initStore() {
  await itemsDb.loadDatabaseAsync();
  await metaDb.loadDatabaseAsync();
  await itemsDb.ensureIndexAsync({ fieldName: 'key', unique: true });
  await itemsDb.removeAsync({ discoveredAt: { $lt: Date.now() - RETENTION_MS } }, { multi: true });

  const m = await metaDb.findOneAsync({ _id: 'state' });
  if (m) META = { initialised: !!m.initialised, lastSummaryDate: m.lastSummaryDate || '', lastFlushTs: m.lastFlushTs || 0 };

  const docs = await itemsDb.findAsync({});
  docs.forEach((d) => seen.add(d.key));
  ITEMS = docs.map(toDisplay).sort((a, b) => b.ts - a.ts).slice(0, 400);
  pendingAlerts = docs.filter((d) => d.alertable && !d.flushed).map((d) => ({ ...toDisplay(d), key: d.key }));
  logLine(`store: ${docs.length} items on disk, ${pendingAlerts.length} unsent alert(s) recovered`);
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
function nowParts() {
  const d = new Date();                                  // TZ env => local wall clock
  return { min: d.getHours() * 60 + d.getMinutes(), date: d.toLocaleDateString('en-CA') };
}
function inWindow(min) { return min >= toMin(WIN_START) && min <= toMin(WIN_END); }
function ascii(s, n) { return String(s).replace(/[^\x20-\x7E]/g, '').slice(0, n || 120); }
function fmt(it) { return `${it.severity === 'crit' ? '[!] ' : '• '}${it.source}: ${it.title}`; }

async function sendNtfy(title, body, priority, tags, clickUrl) {
  if (!NTFY_URL) return;
  try {
    const headers = { Title: ascii(title), Priority: priority, Tags: tags };
    if (clickUrl) headers.Click = clickUrl;
    const r = await fetch(NTFY_URL, { method: 'POST', headers, body });
    if (!r.ok) logLine(`ntfy push HTTP ${r.status}`);
  } catch (e) {
    logLine('ntfy push failed: ' + (e.message || e));
  }
}

// Send the queued crit/warn items as one batched push (or a single direct one).
async function flushAlerts() {
  if (!NTFY_URL || !pendingAlerts.length) return;
  const batch = pendingAlerts.slice(0, 30);
  pendingAlerts = pendingAlerts.slice(batch.length);   // keep any overflow for next flush
  META.lastFlushTs = Date.now();
  const crit = batch.filter((i) => i.severity === 'crit');
  const warn = batch.filter((i) => i.severity === 'warn');

  if (batch.length === 1) {
    const it = batch[0]; const isC = it.severity === 'crit';
    await sendNtfy(`${isC ? 'CRITICAL' : 'Alert'}: ${it.source}`, `${it.title}\n\n${it.link}`,
      isC ? 'urgent' : 'high', isC ? 'rotating_light,skull' : 'warning', it.link);
  } else {
    const body = batch.slice(0, 12).map(fmt).join('\n') +
      (batch.length > 12 ? `\n…and ${batch.length - 12} more` : '');
    await sendNtfy(`${batch.length} cyber alerts: ${crit.length} crit, ${warn.length} warn`,
      body, crit.length ? 'urgent' : 'high', crit.length ? 'rotating_light' : 'warning', PUBLIC_URL);
  }
  await markFlushed(batch.map((i) => i.key));   // persist "sent" so a restart won't re-send
  await saveMeta();
  logLine(`📲 flush: ${crit.length} crit + ${warn.length} warn pushed`);
}

// Morning briefing: digest of everything that landed overnight.
async function morningSummary() {
  const since = Date.now() - SUMMARY_LOOKBACK_H * 3600 * 1000;
  const overnight = ITEMS.filter((i) => i.ts >= since);
  const byCat = {};
  overnight.forEach((i) => { byCat[i.category] = (byCat[i.category] || 0) + 1; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${n}`).join('  ') || 'nothing new';
  const flagged = overnight.filter((i) => i.severity === 'crit' || i.severity === 'warn').slice(0, 8);
  const body =
    `${overnight.length} new items in the last ${SUMMARY_LOOKBACK_H}h\n${cats}\n` +
    (flagged.length ? `\nNeeds attention:\n${flagged.map(fmt).join('\n')}` : '\nNo crit/warn items overnight.');
  await sendNtfy(`Cyber briefing - ${overnight.length} overnight`, body, 'default', 'sunrise,newspaper', PUBLIC_URL);
  // briefing covers the overnight backlog — mark it all sent on disk
  await itemsDb.updateAsync({ alertable: true, flushed: false }, { $set: { flushed: true } }, { multi: true });
  pendingAlerts = [];
  META.lastFlushTs = Date.now();
  await saveMeta();
  logLine(`📲 morning briefing sent — ${overnight.length} items, ${flagged.length} flagged`);
}

// Runs every minute: decides whether to send a briefing or a 15-min flush.
async function schedulerTick() {
  if (!NTFY_URL || !META.initialised) return;
  const { min, date } = nowParts();
  const sumMin = toMin(SUMMARY_AT);
  // Morning briefing: once per day, only if we're within 2h after the set time
  if (date !== META.lastSummaryDate && min >= sumMin && min < sumMin + 120) {
    META.lastSummaryDate = date;
    await morningSummary();
    return;
  }
  // Batched flush every ALERT_EVERY_MIN, but only inside the active window
  if (inWindow(min) && pendingAlerts.length && Date.now() - META.lastFlushTs >= ALERT_EVERY_MS) {
    await flushAlerts();
  }
}

let ITEMS = [];   // merged feed items, newest first
let STATUS = [];  // server/connection log (the "Status" window)
let UPDATED = 0;
const seen = new Set();

function logLine(msg) { STATUS.push({ ts: Date.now(), msg }); }

async function fetchAll() {
  logLine(`Refreshing ${FEEDS.length} feeds…`);
  const initial = !META.initialised;   // first-ever population => suppress backfill alerts
  const fresh = [];
  await Promise.all(FEEDS.map(async (f) => {
    try {
      let n = 0;
      (await fetchFeed(f)).forEach((it) => {
        if (seen.has(it.key)) return;
        seen.add(it.key);
        fresh.push({
          ...it,
          alertable: ALERT_LEVELS.includes(it.severity),
          flushed: initial ? true : !ALERT_LEVELS.includes(it.severity),   // backfill => already "sent"
          discoveredAt: Date.now(),
        });
        n++;
      });
      logLine(`✓ ${f.source} — ${n} new item(s)`);
    } catch (e) {
      logLine(`✗ ${f.source} — ${e.code || e.message || 'fetch failed'}`);
    }
  }));

  // Persist new docs and mirror into memory
  let added = 0;
  for (const doc of fresh) {
    try { await itemsDb.insertAsync(doc); }
    catch (e) { continue; }   // unique-key clash (stale seen) — skip silently
    ITEMS.push(toDisplay(doc));
    if (!initial && doc.alertable) pendingAlerts.push({ ...toDisplay(doc), key: doc.key });
    added++;
  }

  if (added > 0) {
    ITEMS = ITEMS.filter((x) => !x.mock);   // real data landed — drop bundled placeholders
  } else if (ITEMS.length === 0) {
    ITEMS = loadMock();
    logLine('⚠ live feeds unreachable — showing bundled mock data');
  }

  await itemsDb.removeAsync({ discoveredAt: { $lt: Date.now() - RETENTION_MS } }, { multi: true });
  ITEMS.sort((a, b) => b.ts - a.ts);
  ITEMS = ITEMS.slice(0, 400);
  STATUS = STATUS.slice(-250);
  UPDATED = Date.now();
  logLine(`Done — ${added} new, ${ITEMS.length} in buffer, ${pendingAlerts.length} pending`);

  if (initial) {
    META.initialised = true;
    META.lastFlushTs = Date.now();
    const { min, date } = nowParts();
    // Booting at/after briefing time marks today done so a redeploy doesn't fire
    // a surprise briefing on the backfill. Booting before 09:00 still gets it.
    if (min >= toMin(SUMMARY_AT)) META.lastSummaryDate = date;
    await saveMeta();
    logLine(NTFY_URL
      ? `ntfy armed — ${ALERT_LEVELS.join('+')} flushed every ${ALERT_EVERY_MS / 60000}m in ${WIN_START}-${WIN_END}, briefing ${SUMMARY_AT} (backfill suppressed)`
      : 'ntfy alerts disabled (no NTFY_URL set)');
  } else if (added && pendingAlerts.length) {
    logLine(`queued alerts — ${pendingAlerts.length} pending for next flush`);
  }
}

// Same policy as the <meta> CSP in public/index.html. Inline style attributes carry
// the nick colours, hence 'unsafe-inline' for styles only — never for scripts.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => { res.set(SECURITY_HEADERS); next(); });
// no-cache so rapid front-end iterations show up without a hard refresh
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.get('/health', (_req, res) => res.json({ ok: true, items: ITEMS.length, updated: UPDATED }));
// .json path matches the static build; the bare path stays for older front-ends
app.get(['/api/feeds.json', '/api/feeds'], (_req, res) => res.json({
  items: ITEMS,
  status: STATUS,
  sources: FEEDS.map((f) => f.source),
  updated: UPDATED,
}));

app.listen(PORT, async () => {
  console.log(`FOSS-Feeds listening on :${PORT}`);
  try { await initStore(); } catch (e) { logLine('store init failed: ' + (e.message || e)); }
  if (ITEMS.length === 0) ITEMS = loadMock();   // instant content while first fetch runs
  UPDATED = Date.now();
  logLine('Connecting to feeds…');
  fetchAll().catch((e) => logLine('fetch error: ' + e.message));
  setInterval(() => fetchAll().catch((e) => logLine('fetch error: ' + e.message)), REFRESH_MS);
  setInterval(() => schedulerTick().catch((e) => logLine('scheduler error: ' + e.message)), 60 * 1000);
});
