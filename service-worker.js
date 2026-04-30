// QueryCast service worker. Hand-written per Stack Lock — no Workbox.
// Strategy: cache-first for static shell, network-first for /api/* and Google API hosts.

const CACHE_NAME = 'querycast-v1-stage1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon-32.png',
  '/js/main.js',
  '/js/storage.js',
  '/js/defaults.js',
  '/js/config.js',
  '/js/inapp-browser-gate.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first for our serverless API and any Google host. Caching auth
  // requests would be unsafe; caching API data is handled inside IndexedDB.
  const isLive =
    url.pathname.startsWith('/api/') ||
    url.hostname.endsWith('googleapis.com') ||
    url.hostname === 'accounts.google.com' ||
    url.hostname === 'www.youtube.com';
  if (isLive) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
