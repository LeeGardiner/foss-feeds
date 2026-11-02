'use strict';
/* Local preview of the built site: serves dist/ on http://localhost:8080.
   Zero dependencies, read-only, bound to localhost. Run `npm run build` first. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', process.env.OUT_DIR || 'dist');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`No site in ${ROOT} — run \`npm run build\` first.`);
  process.exit(1);
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(ROOT, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }   // no ../ escapes
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8',
      'Cache-Control': 'no-cache' }).end(body);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Preview: http://localhost:${PORT}/`));
