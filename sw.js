const CACHE_NAME = 'language-lab-static-v9';
const APP_FILES = [
  './',
  './index.html',
  './tailwind.css',
  './styles.css',
  './app.js',
  './xlsx.full.min.js',
  './manifest.json',
  './app-icon.svg',
  './app-icon-192.png',
  './app-icon-512.png',
  './sw.js'
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('language-lab-static-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isAppRequest = url.origin === self.location.origin;
  if (!isAppRequest) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', response.clone());
        return response;
      } catch {
        return (await caches.match(request)) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (isAppRequest && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      if (isAppRequest) {
        const fallback = await caches.match('./index.html');
        if (fallback && request.destination === 'document') return fallback;
      }
      throw error;
    }
  })());
});
