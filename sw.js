const CACHE_NAME = 'language-lab-static-v8';
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './xlsx.full.min.js',
  './manifest.json',
  './app-icon.svg',
  './app-icon-192.png',
  './app-icon-512.png',
  './sw.js'
];
const REMOTE_FILES = [
  'https://cdn.tailwindcss.com/'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);

    // Cache CDN scripts when the first install is online. Their failure does
    // not prevent the app's local dictionary and notebook from working.
    await Promise.allSettled(REMOTE_FILES.map(async url => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      try {
        const response = await fetch(url, {
          mode: 'no-cors',
          cache: 'reload',
          signal: controller.signal
        });
        if (response.ok || response.type === 'opaque') await cache.put(url, response);
      } finally {
        clearTimeout(timeout);
      }
    }));
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
  const isCachedCDN = REMOTE_FILES.includes(request.url);
  if (!isAppRequest && !isCachedCDN) return;

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
