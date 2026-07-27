const CACHE = 'wattsapdrive-v38'
self.addEventListener('install', e => { self.skipWaiting() })
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', e => {
  // network only — no cache (debug layout)
  e.respondWith(fetch(e.request))
})
