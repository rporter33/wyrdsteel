// Fails the build when the initial JS (everything index.html loads eagerly) exceeds budget.
// Lazy chunks (menus) are reported but not counted against the initial budget.
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET_KB = 300;
const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const eager = new Set([...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]));
let initial = 0;
for (const f of readdirSync(join(dist, 'assets'))) {
  if (!f.endsWith('.js')) continue;
  const kb = gzipSync(readFileSync(join(dist, 'assets', f))).length / 1024;
  const isEager = eager.has(`assets/${f}`);
  if (isEager) initial += kb;
  console.log(`${isEager ? 'initial' : 'lazy   '}  ${kb.toFixed(1).padStart(7)} KB  ${f}`);
}
console.log(`initial JS: ${initial.toFixed(1)} KB gzipped (budget ${BUDGET_KB} KB)`);
if (initial > BUDGET_KB) {
  console.error('Initial JS over budget.');
  process.exit(1);
}
