'use strict';
const { test, expect } = require('@playwright/test');

const titles = (page) => page.locator('#messages .line .title');

// Every test also fails on any console error, uncaught exception or dialog:
// a Content-Security-Policy violation shows up as a console error, and an
// alert/confirm would mean injected script ran.
test.beforeEach(async ({ page }, testInfo) => {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', async (d) => { problems.push(`dialog: ${d.message()}`); await d.dismiss(); });
  testInfo.problems = problems;
  await page.goto('/');
  await expect(titles(page).first()).toBeVisible();
});

test.afterEach(async ({ page }, testInfo) => {
  expect(await page.evaluate(() => window.__xss), 'injected script ran').toBeUndefined();
  expect(testInfo.problems).toEqual([]);
});

test('renders the channel from the feed data', async ({ page }) => {
  await expect(titles(page)).toHaveCount(5);
  await expect(page.locator('#nickCount')).toHaveText('4 ops, 5 total');
  await expect(page.locator('#nicklist li.muted')).toHaveText('Schneier');
  await expect(page.locator('#sbRight')).toContainText('5 items · 5 here');
  await expect(page.locator('#sbLeft')).toContainText('connected');
});

test('hostile feed content is shown as text, never run', async ({ page }) => {
  const hostile = titles(page).filter({ hasText: 'Hostile' });
  await expect(hostile).toHaveText('<img src=x onerror="window.__xss=1">Hostile <b>headline</b>');
  await expect(page.locator('#messages .title img, #messages .title b, #messages script')).toHaveCount(0);
  await expect(titles(page).filter({ hasText: '<script>' })).toHaveCount(1);
});

test('only http(s) links become clickable', async ({ page }) => {
  const hrefs = await page.locator('#messages a.url').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toHaveLength(5);
  for (const h of hrefs) expect(h === '#' || /^https:\/\//.test(h), `unsafe href: ${h}`).toBe(true);
  expect(hrefs.filter((h) => h === '#')).toHaveLength(2);   // the javascript: and data: links
  for (const a of await page.locator('#messages a.url').all()) {
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(a).toHaveAttribute('rel', /noopener/);
    await expect(a).toHaveAttribute('rel', /noreferrer/);
  }
});

test('channel tabs filter by category', async ({ page }) => {
  await page.locator('#switchbar [data-ch="cve"]').click();
  await expect(page.locator('#chanName')).toHaveText('#cve');
  await expect(titles(page)).toHaveText(['CVE-2026-1111 actively exploited in edge routers']);
  await expect(page.locator('#messages .line.sev-crit')).toHaveCount(1);

  await page.locator('#switchbar [data-ch="ransomware"]').click();
  await expect(titles(page)).toHaveText(['Ransomware gang hits regional hospital chain']);
});

test('clicking a nick queries that source', async ({ page }) => {
  await page.locator('#nicklist li[data-nick="TheRecord"]').click();
  await expect(page.locator('#chanName')).toHaveText('#cybersec [/query TheRecord]');
  await expect(titles(page)).toHaveCount(1);
  await page.locator('#nicklist li[data-nick="TheRecord"]').click();   // toggles back off
  await expect(titles(page)).toHaveCount(5);
});

test('commands work and typed input is never executed', async ({ page }) => {
  const input = page.locator('#input');
  await input.fill('/join #breaches'); await input.press('Enter');
  await expect(page.locator('#chanName')).toHaveText('#breaches');
  await expect(titles(page)).toHaveCount(1);

  await input.fill('/names'); await input.press('Enter');
  await expect(page.locator('#messages')).toContainText('@CISA @TheRecord @BleepingComputer @FullDisclosure @Schneier');

  await input.fill('<img src=x onerror="window.__xss=5">'); await input.press('Enter');
  await expect(page.locator('#messages')).toContainText('<img src=x onerror="window.__xss=5">');
  await expect(page.locator('#messages img')).toHaveCount(0);
});

test('status console shows the build log', async ({ page }) => {
  await page.locator('#switchbar [data-ch="status"]').click();
  await expect(page.locator('#messages')).toContainText('✓ CISA — 1 new item(s)');
  await expect(page.locator('#nickCount')).toHaveText('server console');
});
