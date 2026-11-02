'use strict';
/* Shared feed logic: used by server.js (self-hosted) and scripts/build-static.js
   (public static build), so both categorise and sanitise identically. */
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

// The "channel ops" — each feed source is a nick in the channel.
const FEEDS = [
  { source: 'TheHackerNews',   url: 'https://feeds.feedburner.com/TheHackersNews' },
  { source: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
  { source: 'KrebsOnSecurity',  url: 'https://krebsonsecurity.com/feed/' },
  { source: 'DarkReading',      url: 'https://www.darkreading.com/rss.xml' },
  { source: 'SANS_ISC',         url: 'https://isc.sans.edu/rssfeed_full.xml' },
  { source: 'CISA',             url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml' },
  { source: 'TheRecord',        url: 'https://therecord.media/feed/' },
  { source: 'Securelist',       url: 'https://securelist.com/feed/' },
  { source: 'Schneier',         url: 'https://www.schneier.com/feed/atom/' },
  { source: 'HelpNetSecurity',  url: 'https://www.helpnetsecurity.com/feed/' },
  { source: 'FullDisclosure',   url: 'https://seclists.org/rss/fulldisclosure.rss' },
  { source: 'oss-security',     url: 'https://seclists.org/rss/oss-sec.rss' },
];

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'FOSS-Feeds/1.0 (+https://github.com/)' },
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

module.exports = { FEEDS, categorize, severity, safeLink, fetchFeed, loadMock };
