'use strict';
/* Feed logic for the static build: loads and validates feeds.json, fetches
   and normalises items, and categorises them from their headlines. */
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

const FEEDS_FILE = path.join(__dirname, '..', 'feeds.json');

// The "channel ops" — each feed source is a nick in the channel. Edit
// feeds.json, not this file. A bad entry fails the build loudly rather than
// silently dropping a feed.
function loadFeeds(file = FEEDS_FILE) {
  let list;
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`feeds.json: ${e.message}`); }
  if (!Array.isArray(list) || !list.length) throw new Error('feeds.json: expected a non-empty array');
  const names = new Set();
  list.forEach((f, i) => {
    const at = `feeds.json entry ${i + 1}`;
    if (!f || typeof f.source !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/.test(f.source)) {
      throw new Error(`${at}: "source" must be 1-32 characters of letters, digits, _ . or -`);
    }
    if (names.has(f.source.toLowerCase())) throw new Error(`${at}: duplicate source "${f.source}"`);
    names.add(f.source.toLowerCase());
    let u;
    try { u = new URL(f.url); } catch { throw new Error(`${at} (${f.source}): "url" is not a valid URL`); }
    if (u.protocol !== 'https:') throw new Error(`${at} (${f.source}): "url" must use https`);
  });
  return list.map((f) => ({ source: f.source, url: f.url }));
}

const FEEDS = loadFeeds();

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'FOSS-Feeds/1.0 (+https://github.com/LeeGardiner/foss-feeds)' },
});

function categorize(title = '') {
  const t = title.toLowerCase();
  if (/cve-\d{4}-\d+/i.test(title)) return 'cve';
  if (/\b(zero[- ]?day|0-day|exploit|vulnerab|unpatched|rce|privilege escalation|sql injection)\b/.test(t)) return 'cve';
  if (/\b(ransom|lockbit|blackcat|alphv|clop|encrypt(ed|s|ion)?)\b/.test(t)) return 'ransomware';
  if (/\b(breach|leak(ed|s)?|stolen|exposed|exfiltrat|million (records|users|accounts|customers))\b/.test(t)) return 'breach';
  if (/\b(malware|trojan|botnet|backdoor|loader|stealer|\brat\b|spyware|rootkit)\b/.test(t)) return 'malware';
  return 'news';
}

function severity(title = '') {
  const t = title.toLowerCase();
  if (/\b(critical|actively exploited|in the wild|zero[- ]?day|0-day|emergency|cvss\s*(9|10))\b/.test(t)) return 'crit';
  if (/cve-\d{4}-\d+/i.test(title) || /\b(high severity|exploit|patch now)\b/.test(t)) return 'warn';
  return 'info';
}

// Feed links are third-party input (Full Disclosure / oss-security are open
// mailing lists): only plain http(s) URLs survive, so a `javascript:` or
// `data:` link can never become a clickable href in the UI.
function safeLink(u) {
  try {
    const x = new URL(String(u || '').trim());
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '#';
  } catch {
    return '#';
  }
}

// Fetch one feed -> normalised items (newest 20). Throws on fetch/parse failure.
async function fetchFeed(f) {
  const feed = await parser.parseURL(f.url);
  return (feed.items || []).slice(0, 20).map((it) => {
    const raw = it.link || it.guid || '#';
    let ts = it.isoDate ? Date.parse(it.isoDate) : (it.pubDate ? Date.parse(it.pubDate) : Date.now());
    if (isNaN(ts)) ts = Date.now();
    const title = (it.title || '(no title)').trim();
    return {
      key: f.source + '|' + (raw || it.title),   // raw link: keeps dedup keys stable across versions
      source: f.source, title, link: safeLink(raw), ts,
      category: categorize(title), severity: severity(title),
    };
  });
}

function loadMock() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'mock.json'), 'utf8'));
    return raw.map((x) => ({
      source: x.source,
      title: x.title,
      link: safeLink(x.link),
      ts: x.iso ? Date.parse(x.iso) : Date.now(),
      category: x.category || categorize(x.title),
      severity: severity(x.title),
      mock: true,
    }));
  } catch (e) {
    return [];
  }
}

module.exports = { FEEDS, loadFeeds, categorize, severity, safeLink, fetchFeed, loadMock };
