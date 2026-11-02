'use strict';
// UI tests run against fixture data (tests/fixtures/feeds.json), not the live
// feeds, so results are the same on every run.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8099;

module.exports = defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  // 127.0.0.1, not localhost: preview.js binds IPv4 only, and localhost can resolve to ::1
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/make-site.js && node scripts/preview.js',
    url: `http://127.0.0.1:${PORT}/`,
    env: { OUT_DIR: 'tests/.site', PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
