import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * Emits sw.js listing every file the build produced, so the whole game installs on first visit
 * and runs offline. The cache name carries a hash of that list: a new deploy installs beside the
 * old one and the old cache is dropped once the new worker takes over.
 */
export function offline(publicFiles: string[]): Plugin {
  return {
    name: 'wyrdsteel-offline',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = ['./', ...publicFiles, ...Object.keys(bundle).filter((f) => !f.endsWith('.map'))].map((f) => (f === './' ? f : `./${f}`));
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker(version, files) });
    },
  };
}

function worker(version: string, files: string[]): string {
  return `// Generated at build time. Cache-first for the game's own files; everything else goes to the network.
const CACHE = 'wyrdsteel-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('wyrdsteel-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Pages: the cached shell, so the game opens with no network at all.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./', { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
`;
}
