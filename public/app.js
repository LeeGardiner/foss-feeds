'use strict';
/* FOSS-Feeds — IRC channel front-end.
   Maps RSS sources -> "nicks", feed items -> channel lines. */

// 16-colour IRC palette indices that read well on white
const NICK_COLORS = ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c10', 'c12', 'c13', 'c14'];
function nickColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return 'var(--' + NICK_COLORS[h % NICK_COLORS.length] + ')';
}

// Channels = filtered views over the same item stream.
const CHANNELS = [
  { id: 'status',     name: 'Status',      filter: null },
  { id: 'cybersec',   name: '#cybersec',   filter: () => true },
  { id: 'cve',        name: '#cve',        filter: (it) => it.category === 'cve' },
  { id: 'ransomware', name: '#ransomware', filter: (it) => it.category === 'ransomware' },
  { id: 'breaches',   name: '#breaches',   filter: (it) => it.category === 'breach' },
  { id: 'malware',    name: '#malware',    filter: (it) => it.category === 'malware' },
];
const TOPICS = {
  cybersec:   'Aggregated threat intel — all sources | +ntr',
  cve:        'Vulnerabilities, exploits & CVEs — patch responsibly',
  ransomware: 'Ransomware crews, leaks & extortion ops',
  breaches:   'Data breaches, leaks & exposed records',
  malware:    'Malware, botnets, loaders & stealers',
  status:     'FOSS-Feeds server console',
};

let DATA = { items: [], status: [], sources: [], updated: 0 };
let active = 'cybersec';
let nickFilter = null;                 // click a nick to /query just that source
const activity = {};                   // channel id -> 'msg' | 'hl'
let lastCounts = {};                   // channel id -> item count (for activity dots)
const seenLines = new Set();           // for highlight-on-new

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
function clock(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function clockS(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function host(src) { return src.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10); }

// ── Rendering ──────────────────────────────────────────────────────────
function itemsFor(ch) {
  const def = CHANNELS.find((c) => c.id === ch);
  if (!def || !def.filter) return [];
  let list = DATA.items.filter(def.filter);
  if (nickFilter) list = list.filter((it) => it.source === nickFilter);
  return list.slice().sort((a, b) => a.ts - b.ts);   // oldest first, like a scrollback
}

function renderMessages() {
  const box = $('messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  let html = '';

  if (active === 'status') {
    html += `<div class="line srv"><span class="ts">[${clockS(Date.now())}]</span> *** Now talking on the FOSS-Feeds console</div>`;
    DATA.status.forEach((s) => {
      html += `<div class="line srv"><span class="ts">[${clockS(s.ts)}]</span> -feeds- ${esc(s.msg)}</div>`;
    });
  } else {
    const topic = TOPICS[active] || '';
    html += `<div class="line srv"><span class="ts">[${clockS(DATA.updated || Date.now())}]</span> *** Topic for <b>${chanName()}</b>: ${esc(topic)}</div>`;
    const srcs = [...new Set(itemsFor(active).map((i) => i.source))];
    srcs.slice(0, 12).forEach((s) => {
      html += `<div class="line evt"><span class="ts">[${clock(DATA.updated || Date.now())}]</span> *** <b style="color:${nickColor(s)}">${esc(s)}</b> (rss@${host(s)}.feeds) has joined ${chanName()}</div>`;
    });

    const items = itemsFor(active);
    if (!items.length) {
      html += `<div class="line srv"><span class="ts">[${clock(Date.now())}]</span> -feeds- no items in this channel yet — waiting for the next refresh…</div>`;
    }
    items.forEach((it) => {
      const id = it.source + '|' + it.link;
      const isNew = !seenLines.has(id);
      const sev = it.severity === 'crit' ? ' sev-crit' : it.severity === 'warn' ? ' sev-warn' : '';
      const hl = isNew && DATA.updated ? ' highlight' : '';
      const tag = it.category !== 'news' ? ` <span class="cat">[${it.category}]</span>` : '';
      html += `<div class="line${sev}${hl}">` +
        `<span class="ts">[${clock(it.ts)}]</span> ` +
        `<span class="arrow">&lt;</span>` +
        `<span class="nick" style="color:${nickColor(it.source)}" data-nick="${esc(it.source)}">${esc(it.source)}</span>` +
        `<span class="arrow">&gt;</span> ` +
        `<span class="title">${esc(it.title)}</span>${tag} ` +
        `<a class="url" href="${esc(httpOnly(it.link))}" target="_blank" rel="noopener noreferrer">${esc(shortUrl(it.link))}</a>` +
        `</div>`;
    });
  }

  box.innerHTML = html;
  if (atBottom) box.scrollTop = box.scrollHeight;
  if (DATA.updated) DATA.items.forEach((it) => seenLines.add(it.source + '|' + it.link));
}

// Belt and braces: the build already strips non-http(s) links.
function httpOnly(u) { return /^https?:\/\//i.test(String(u)) ? u : '#'; }
function shortUrl(u) {
  try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? '…' : ''); }
  catch { return u; }
}
function chanName() { const d = CHANNELS.find((c) => c.id === active); return d ? d.name : active; }

function renderNicklist() {
  const ul = $('nicklist');
  if (active === 'status') {
    ul.innerHTML = '';
    $('nickCount').textContent = 'server console';
    return;
  }
  const def = CHANNELS.find((c) => c.id === active);
  const counts = {};
  DATA.items.filter(def.filter || (() => true)).forEach((it) => { counts[it.source] = (counts[it.source] || 0) + 1; });
  const present = DATA.sources.filter((s) => counts[s]);
  const absent = DATA.sources.filter((s) => !counts[s]);
  present.sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  absent.sort((a, b) => a.localeCompare(b));

  let html = '';
  present.forEach((s) => {
    const sel = nickFilter === s ? ' style="background:#000080;color:#fff"' : '';
    html += `<li data-nick="${esc(s)}"${sel}><span class="op">@</span><span style="color:${nickColor(s)}">${esc(s)}</span> <span style="color:var(--c14);font-weight:normal">(${counts[s]})</span></li>`;
  });
  absent.forEach((s) => {
    html += `<li class="muted" data-nick="${esc(s)}">${esc(s)}</li>`;
  });
  ul.innerHTML = html;
  $('nickCount').textContent = `${present.length} op${present.length !== 1 ? 's' : ''}, ${DATA.sources.length} total`;
}

function renderSwitchbar() {
  const bar = $('switchbar');
  bar.innerHTML = CHANNELS.map((c) => {
    const cls = ['', c.id === active ? 'active' : '',
      activity[c.id] === 'hl' ? 'activity' : activity[c.id] === 'msg' ? 'act-msg' : ''].join(' ').trim();
    return `<button data-ch="${c.id}" class="${cls}">${esc(c.name)}</button>`;
  }).join('');
}

function renderTopic() {
  $('chanName').textContent = chanName() + (nickFilter ? ` [/query ${nickFilter}]` : '');
  $('topicText').textContent = TOPICS[active] || '';
}

function renderStatusbar() {
  const n = active === 'status' ? DATA.status.length : itemsFor(active).length;
  $('sbRight').textContent = `${DATA.items.length} items · ${active === 'status' ? DATA.status.length + ' log' : n + ' here'} · ${clockS(Date.now())}`;
  $('sbLeft').innerHTML = DATA.updated
    ? `●&nbsp;connected · last refresh ${clockS(DATA.updated)}`
    : '○&nbsp;connecting…';
  $('lag').textContent = 'lag ' + (Math.random() * 0.2 + 0.02).toFixed(2) + 's';
}

function renderAll() {
  renderMessages(); renderNicklist(); renderSwitchbar(); renderTopic(); renderStatusbar();
}

// ── Data polling ───────────────────────────────────────────────────────
async function poll() {
  try {
    // Per-minute cache-buster: GitHub Pages' CDN caches files for ~10 minutes
    // and ignores the browser's no-store.
    const r = await fetch('api/feeds.json?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
    const fresh = await r.json();
    CHANNELS.forEach((c) => {
      if (!c.filter) return;
      const cnt = fresh.items.filter(c.filter).length;
      if (lastCounts[c.id] != null && cnt > lastCounts[c.id] && c.id !== active) {
        const gainedCrit = fresh.items.filter(c.filter).some((i) => i.severity === 'crit');
        activity[c.id] = gainedCrit ? 'hl' : 'msg';
      }
      lastCounts[c.id] = cnt;
    });
    DATA = fresh;
    renderAll();
  } catch (e) {
    $('sbLeft').innerHTML = '○&nbsp;disconnected — retrying…';
  }
}

// ── Command input (a few real /commands for fun) ───────────────────────
function handleInput(raw) {
  const text = raw.trim();
  if (!text) return;
  const box = $('messages');
  if (text[0] === '/') {
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd.toLowerCase()) {
      case 'help':
        echo('srv', 'Commands: /join #chan · /query <Source> · /close · /names · /clear · /refresh · /topic');
        echo('srv', 'Channels: ' + CHANNELS.filter((c) => c.filter).map((c) => c.name).join(' '));
        break;
      case 'join': {
        const id = arg.replace(/^#/, '').toLowerCase();
        if (CHANNELS.some((c) => c.id === id)) switchTo(id);
        else echo('srv', `No such channel: ${arg}`);
        break;
      }
      case 'query': case 'q': {
        const src = DATA.sources.find((s) => s.toLowerCase() === arg.toLowerCase());
        if (src) { nickFilter = src; renderAll(); echo('srv', `Now querying <${src}> — /close to clear`); }
        else echo('srv', `No such nick: ${arg}`);
        break;
      }
      case 'close': case 'part': nickFilter = null; renderAll(); break;
      case 'names':
        echo('srv', '[' + chanName() + '] ' + DATA.sources.map((s) => '@' + s).join(' '));
        break;
      case 'clear': box.innerHTML = ''; break;
      case 'refresh': case 'reload':
        echo('srv', 'Requesting feed refresh on next server cycle…'); poll();
        break;
      case 'topic': echo('srv', `Topic for ${chanName()}: ${TOPICS[active]}`); break;
      default: echo('srv', `Unknown command: /${cmd} — try /help`);
    }
  } else {
    echo('me', text);
  }
}
function echo(kind, text) {
  const box = $('messages');
  const ts = clock(Date.now());
  const nick = $('myNick') ? $('myNick').textContent : 'you';
  let h;
  if (kind === 'me') h = `<div class="line"><span class="ts">[${ts}]</span> <span class="arrow">&lt;</span><span class="nick" style="color:var(--c4)">${esc(nick)}</span><span class="arrow">&gt;</span> ${esc(text)}</div>`;
  else h = `<div class="line srv"><span class="ts">[${ts}]</span> -feeds- ${esc(text)}</div>`;
  box.insertAdjacentHTML('beforeend', h);
  box.scrollTop = box.scrollHeight;
}

// ── Wiring ─────────────────────────────────────────────────────────────
function switchTo(id) { active = id; nickFilter = null; activity[id] = null; renderAll(); }

document.addEventListener('click', (e) => {
  const sw = e.target.closest('[data-ch]');
  if (sw) { switchTo(sw.dataset.ch); return; }
  const nk = e.target.closest('[data-nick]');
  if (nk) {
    const s = nk.dataset.nick;
    nickFilter = (nickFilter === s) ? null : s;
    if (active === 'status') active = 'cybersec';
    renderAll();
    return;
  }
  const tb = e.target.closest('[data-cmd]');
  if (tb) {
    const c = tb.dataset.cmd;
    if (c === 'reload') poll();
    else if (c === 'clear') $('messages').innerHTML = '';
    else if (c === 'channels') switchTo('cybersec');
  }
});

$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { handleInput(e.target.value); e.target.value = ''; }
});

renderAll();
poll();
setInterval(poll, 30000);
setInterval(renderStatusbar, 1000);
