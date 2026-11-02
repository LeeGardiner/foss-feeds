# Contributing

Thanks for helping. FOSS-Feeds is deliberately small: a build script, one runtime dependency, and a plain HTML/CSS/JS front-end with no framework or bundler. Changes that keep it that way are the easiest to accept.

## Getting set up

```bash
git clone https://github.com/<you>/<fork>.git && cd <fork>
npm ci
npm run build && npm run preview   # http://localhost:8080
```

Node 22 or newer. The front-end lives in [`public/`](public/); edit it and re-run `npm run build` to see changes (or copy `public/*` over `dist/` if you don't want to re-fetch the feeds).

## Making a change

1. Branch from `main` and keep the PR to one topic.
2. Run `npm run check && npm run build && npm run test:ui` before pushing (`npx playwright install chromium` once, first).
3. Front-end change? Add or update a test in [`tests/ui.spec.js`](tests/ui.spec.js). It runs against [`tests/fixtures/feeds.json`](tests/fixtures/feeds.json), which includes hostile entries on purpose: keep them.
4. Open a PR describing what changed and why. A screenshot helps for anything visual.

Every PR runs the CI build, the UI tests, gitleaks, the lockfile check, `npm audit`, dependency review and CodeQL. All must pass, and the code owner reviews before merge.

## Ground rules

- **No new runtime dependencies** without a good reason in the PR. Every package is supply-chain risk on a site that rebuilds itself every 15 minutes.
- **Treat feed content as hostile.** Escape anything rendered from a feed, and keep links restricted to `http(s)`.
- **No external resources** in the page (CDNs, fonts, analytics). The Content-Security-Policy blocks them anyway.
- **Suggesting a feed for the default list?** It should be a reputable security source with a stable `https` RSS/Atom URL.

## Reporting a security issue

Please don't open a public issue for a vulnerability. Use GitHub's **Security → Report a vulnerability** on the repository instead.
