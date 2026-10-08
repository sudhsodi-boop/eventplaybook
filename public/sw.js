/* EventPlaybook service worker — makes the app installable and resilient.
   Strategy:
   - App shell (HTML/CSS/JS/icons): cache-first, so the app opens instantly and
     even loads when briefly offline.
   - API calls (/api/*): network-only (never cached), so data is always fresh and
     you never see stale events/tasks. */
const CACHE = 'eventplaybook-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache API traffic — always hit the network for live, synchronized data.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'You appear to be offline.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  // Only handle GET for the app shell.
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      // Cache same-origin static assets as we fetch them.
      if (res.ok && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
