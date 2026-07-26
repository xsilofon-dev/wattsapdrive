const CACHE = 'wattsapdrive-v1'
const ASSETS = ['/', '/manifest.json', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})))
})

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => {
      return fetch(e.request).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)) }
        return res
      }).catch(() => r)
    })
  )
})
