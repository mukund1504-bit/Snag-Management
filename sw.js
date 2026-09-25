const CACHE_NAME = 'csms-offline-cache-v6'; // Version upgrade kar diya hai

const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './Script.js?v=5.0',          // Naya version
  './enhancements.js?v=5.0',    // Naya version
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Naye service worker ko turant install hone dega
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Supabase API hamesha internet se aayegi, cache nahi hogi
  if (event.request.url.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch((err) => {
        console.log('Offline: Supabase request failed', err);
        throw err; 
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(networkResponse => {
        if(!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }
        let responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        console.log('Offline: File not found in cache - ', event.request.url);
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim()); // Naye worker ko turant active karega
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Ye purani kharab files wale cache ko delete kar dega
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});