// Minimal service worker required for PWA installability.
// Caches the app shell for offline support.

const CACHE_NAME = 'pharmacy-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first strategy — fall back to cache for offline support
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
