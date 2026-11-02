'use strict';
/* Lockfile guard: every package must come from the public npm registry over
   https and carry an integrity hash. Catches a PR that quietly repoints a
   package at another host (or a git URL / tarball) inside package-lock.json,
   which is easy to miss in review. Zero dependencies on purpose. */
const fs = require('fs');
const path = require('path');

const LOCK = path.join(__dirname, '..', 'package-lock.json');
const REGISTRY = 'https://registry.npmjs.org/';

const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
if (lock.lockfileVersion < 2) {
  console.error(`package-lock.json: lockfileVersion ${lock.lockfileVersion} not supported (need 2+)`);
  process.exit(1);
}

const problems = [];
let checked = 0;
for (const [key, pkg] of Object.entries(lock.packages || {})) {
  if (key === '' || pkg.link) continue;   // the project itself / workspace links
  checked++;
  const name = key.replace(/^.*node_modules\//, '');
  if (typeof pkg.resolved !== 'string' || !pkg.resolved.startsWith(REGISTRY)) {
    problems.push(`${name}: resolved from ${pkg.resolved || '(nowhere)'}, not ${REGISTRY}`);
  }
  if (typeof pkg.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+=*$/.test(pkg.integrity)) {
    problems.push(`${name}: missing or non-sha512 integrity hash`);
  }
}

if (problems.length) {
  console.error(`package-lock.json: ${problems.length} problem(s):\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`package-lock.json OK: ${checked} packages, all from ${REGISTRY} with sha512 integrity`);
