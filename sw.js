const CACHE_NAME = 'csms-offline-cache-v1';

// Jo files hamesha offline chahiye unki list
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './Script.js?v=4.2',          
  './enhancements.js?v=4.2',    
  // External Libraries
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Install Event: App open hote hi in files ko cache me save karega
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Fetch Event: Network requests ko intercept karna
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return; // Sirf GET requests handle karein

  // FIX: Supabase API calls ko bypass karein taaki hamesha FRESH live data aaye
  if (event.request.url.includes('supabase.co')) {
    return; // Browser ko direct internet se laane do, cache mat karo
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Agar file cache me mil gayi toh wahi return kar do (Offline load ho jayega)
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Agar cache me nahi hai toh network se fetch karo aur cache me daal do
      return fetch(event.request).then(networkResponse => {
        // Agar response thik nahi hai toh wapas bhej do
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

// Activate Event: Purane caches ko clean karne ke liye
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});