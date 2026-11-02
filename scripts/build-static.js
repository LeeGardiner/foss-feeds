'use strict';
/* Static build: fetch the feeds once and write a deployable site to OUT_DIR
   (public/ + api/feeds.json). Run on a schedule by
   .github/workflows/publish.yml; no server, no database.

   History: the previous run's published api/feeds.json (PREV_URL) is the only
   state. Items keep their firstSeen time and are dropped RETENTION_DAYS after
   it — by discovery, not publish date, since some feeds carry week-old items
   and pruning by publish date would make them churn in and out. */
const fs = require('fs');
const path = require('path');
const { FEEDS, fetchFeed, loadMock, safeLink, categorize, severity } = require('../lib/feeds');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, process.env.OUT_DIR || 'dist');
const PREV_URL = process.env.PREV_URL || '';
const RETENTION_MS = (Number(process.env.RETENTION_DAYS) || 7) * 86400000;
const MAX_ITEMS = 400;

const STATUS = [];
function log(msg) { STATUS.push({ ts: Date.now(), msg }); console.log(msg); }

const keyOf = (it) => it.source + '|' + (it.link !== '#' ? it.link : it.title);

// The previous build is our own output, but it came back over the network:
// re-clean every field rather than trusting it.
function cleanPrev(x, sources) {
  if (!x || typeof x !== 'object' || !sources.has(x.source)) return null;
  const title = String(x.title || '').slice(0, 500);
  const ts = Number(x.ts), firstSeen = Number(x.firstSeen);
  if (!title || !Number.isFinite(ts) || !Number.isFinite(firstSeen)) return null;
  return { source: x.source, title, link: safeLink(x.link), ts,
    category: categorize(title), severity: severity(title), firstSeen };
}

async function loadPrevious() {
  if (!PREV_URL) { log('no PREV_URL — starting fresh'); return []; }
  const r = await fetch(PREV_URL, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (r.status === 404) { log('no previous build published yet — starting fresh'); return []; }
  if (!r.ok) throw new Error(`previous build HTTP ${r.status}`);
  const prev = await r.json();
  const sources = new Set(FEEDS.map((f) => f.source));
  const items = (Array.isArray(prev.items) ? prev.items : []).map((x) => cleanPrev(x, sources)).filter(Boolean);
  log(`carried over ${items.length} item(s) from the previous build`);
  return items;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

async function main() {
  const now = Date.now();
  let prev;
  try {
    prev = await loadPrevious();
  } catch (e) {
    // Deploying without history would silently drop up to RETENTION_DAYS of
    // items. Fail instead; the next scheduled run retries.
    console.error(`could not load previous build (${e.message}) — aborting so history isn't lost`);
    process.exit(1);
  }

  const byKey = new Map(prev.filter((it) => it.firstSeen >= now - RETENTION_MS).map((it) => [keyOf(it), it]));
  log(`Refreshing ${FEEDS.length} feeds…`);
  let added = 0;
  await Promise.all(FEEDS.map(async (f) => {
    try {
      let n = 0;
      for (const it of await fetchFeed(f)) {
        const k = keyOf(it);
        if (byKey.has(k)) continue;
        byKey.set(k, { source: it.source, title: it.title, link: it.link, ts: it.ts,
          category: it.category, severity: it.severity, firstSeen: now });
        n++;
      }
      added += n;
      log(`✓ ${f.source} — ${n} new item(s)`);
    } catch (e) {
      log(`✗ ${f.source} — ${e.code || e.message || 'fetch failed'}`);
    }
  }));

  let items = [...byKey.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS);
  if (!items.length) {
    items = loadMock();
    log('⚠ live feeds unreachable — showing bundled mock data');
  }
  log(`Done — ${added} new, ${items.length} in buffer`);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  copyDir(path.join(ROOT, 'public'), OUT_DIR);
  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');   // GitHub Pages: serve files as-is
  fs.mkdirSync(path.join(OUT_DIR, 'api'), { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'api', 'feeds.json'), JSON.stringify({
    items, status: STATUS, sources: FEEDS.map((f) => f.source), updated: now,
  }));
  console.log(`wrote ${path.relative(ROOT, OUT_DIR)}/ (${items.length} items)`);
}

// Explicit exit: rss-parser's keep-alive sockets otherwise hold the process open.
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
