# 📡 FOSS-Feeds

A **cybersecurity RSS aggregator** with an unapologetically **old-school IRC channel** UI. Feed sources show up as "nicks" in the channel, headlines arrive as chat lines, and you filter by category by joining different channels.

It runs entirely on GitHub: Actions fetches the feeds every 15 minutes and publishes a static site to GitHub Pages. No server, no database, no hosting bill. **Make your own copy in about five minutes, with your own feeds.**

**Live:** <https://leegardiner.github.io/foss-feeds/>

![FOSS-Feeds screenshot](docs/screenshot.png)

> It's an RSS reader in a trench coat pretending to be an IRC client. The "server", "channels" and "nicks" are all painted over a feed parser; there is no actual IRC protocol involved.

## Features

- **12 cybersecurity feeds** out of the box (The Hacker News, BleepingComputer, Krebs, Dark Reading, SANS ISC, CISA, The Record, Securelist, Schneier, Help Net Security, Full Disclosure, oss-security), configured in one file.
- **IRC channel UI**: white buffer, colour-coded nicks, a nicklist of "ops", a switchbar of channels, and working `/commands` (`/join`, `/query`, `/names`, `/clear`, `/refresh`, `/topic`).
- **Auto-categorisation**: each item is tagged `cve` / `ransomware` / `breach` / `malware` / `news` with a severity (`crit` / `warn` / `info`) from its headline, giving you `#cve`, `#ransomware`, `#breaches` and `#malware` channels for free.
- **7 days of history** with no database: each build carries forward the previous build's items.
- **Free to run**: GitHub Actions and Pages cost nothing for public repositories.

## Make your own

1. **Copy the repo.** Click **Use this template → Create a new repository** (recommended: you get a clean history, and scheduled workflows work straight away). Or fork it, then open your fork's **Actions** tab and enable workflows, which GitHub disables on forks.
2. **Turn on Pages.** In your repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Choose your feeds.** Edit [`feeds.json`](feeds.json) (see below) and commit.
4. **Publish.** **Actions → Publish → Run workflow** for the first build. After that it rebuilds every 15 minutes by itself.

Your site appears at `https://<your-username>.github.io/<repo-name>/`.

Two things to tidy in your copy: replace `@LeeGardiner` in [`.github/CODEOWNERS`](.github/CODEOWNERS) with your own username (or delete the file), and keep the repo **public**, because CodeQL code scanning is only free on public repositories (delete [`codeql.yml`](.github/workflows/codeql.yml) if you go private).

## Choosing feeds

[`feeds.json`](feeds.json) is a list of sources:

```json
[
  { "source": "TheHackerNews",    "url": "https://feeds.feedburner.com/TheHackersNews" },
  { "source": "BleepingComputer", "url": "https://www.bleepingcomputer.com/feed/" }
]
```

- `source` is the nick shown in the channel: 1–32 letters, digits, `_`, `.` or `-`, unique.
- `url` is any RSS or Atom feed, and must be `https`.

The build checks the file and fails with a clear message if an entry is wrong, so a typo can't silently drop a feed. Any topic works, but the channel categories are tuned for security headlines; for other topics, most items will land in `#cybersec` as `news` (the keyword rules are `categorize()` and `severity()` in [`lib/feeds.js`](lib/feeds.js)).

## Run it locally

Needs Node 22 or newer.

```bash
git clone https://github.com/<you>/<repo>.git && cd <repo>
npm ci
npm run check      # validate feeds.json and the lockfile
npm run build      # fetch the feeds -> dist/
npm run preview    # http://localhost:8080
```

UI tests (Playwright, real Chromium, fixture data rather than live feeds):

```bash
npx playwright install chromium   # once
npm run test:ui
```

## How it works

```
                 ┌──────── previous api/feeds.json (7-day history) ────────┐
                 ▼                                                         │
RSS feeds ──Actions cron (15 min)──> scripts/build-static.js ──> dist/ ──> GitHub Pages
                                                                           │
                                     browser ──poll (30 s)──> IRC UI ◄─────┘
```

- `scripts/build-static.js` fetches every feed in `feeds.json`, de-duplicates against the previous build, drops items first seen more than `RETENTION_DAYS` (default 7) ago, and writes `dist/api/feeds.json` next to the front-end in [`public/`](public/).
- If the previous build can't be downloaded, the build fails rather than publishing a site with its history wiped; the next scheduled run tries again.
- The page polls `api/feeds.json` every 30 seconds, so new items appear without a reload. GitHub may start scheduled runs a few minutes late when it's busy.
- GitHub turns off schedules in public repos with no activity for 60 days. If yours stops updating, re-enable it from the **Actions** tab.

## Security

- Feed content is third-party input: titles are HTML-escaped, and only `http(s)` links are ever rendered, so a `javascript:` link in a feed can't become clickable.
- The page ships a strict Content-Security-Policy (as a `<meta>` tag, since GitHub Pages can't send custom headers). No external scripts, styles, fonts or trackers.
- Every PR and push runs:
  - **Secrets**: [gitleaks](https://github.com/gitleaks/gitleaks) over the full git history ([`security.yml`](.github/workflows/security.yml)), plus GitHub secret scanning with push protection.
  - **Dependencies**: a lockfile check (every package from `registry.npmjs.org` over https with a sha512 hash, so a PR can't quietly repoint one), `npm audit` on the locked tree, GitHub dependency review on PRs, and Dependabot alerts and security updates.
  - **Browser**: [Playwright](https://playwright.dev/) UI tests feed the page deliberately hostile data (HTML in headlines, `javascript:` and `data:` links) and fail if anything executes, any unsafe link is rendered, or the page logs a single error, CSP violations included.
  - **Code**: [CodeQL](https://codeql.github.com/) security-extended analysis of the JavaScript and the workflows ([`codeql.yml`](.github/workflows/codeql.yml)).

## Maintenance

- **Dependabot** ([`.github/dependabot.yml`](.github/dependabot.yml)) opens weekly update PRs for the npm packages and the GitHub Actions.
- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) validates `feeds.json`, runs a real build and serves it. Patch/minor Dependabot PRs that pass are queued for auto-merge and land as soon as the code owner approves; major bumps wait for a human.
- `main` is protected: changes land only through pull requests with green checks and a code-owner review.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE) © 2026 Lee Gardiner. A nostalgia tribute; not affiliated with any IRC client or network. Headlines and links belong to their publishers; FOSS-Feeds shows titles and links only, never article text.
