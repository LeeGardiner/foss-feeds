'use strict';
/* Assemble a test site: public/ plus tests/fixtures/feeds.json as the data.
   The fixture deliberately skips the build's link sanitising, so the UI tests
   prove the browser-side defences hold on their own. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '.site');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'api'), { recursive: true });
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'feeds.json'), 'utf8'));
data.updated = Date.now();
fs.writeFileSync(path.join(OUT, 'api', 'feeds.json'), JSON.stringify(data));
