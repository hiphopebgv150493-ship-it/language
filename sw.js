const CACHE_NAME = 'language-lab-static-v11';
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
    await Promise.all(APP_FILES.map(async file => {
      try { await cache.add(file); }
      catch (error) { console.warn('No se pudo guardar en caché:', file); }
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
  if (!isAppRequest) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        } catch (error) {}
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const indexUrl = new URL('index.html', self.registration.scope);
        const fallback = await caches.match(indexUrl);
        if (fallback) return fallback;
      }
      return new Response('Sin conexión. Abre la aplicación cuando vuelvas a tener internet.', {
        status: 503,
        statusText: 'Offline',
        headers: {'Content-Type': 'text/plain; charset=utf-8'}
      });
    }
  })());
});
