const CACHE = 'wa-center-v5';
const SHELL = ['/index.html','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  if (req.mode === 'navigate' || url.pathname === '/index.html' || url.pathname === '/') {
    event.respondWith(fetch(req, { cache: 'no-store' }).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put('/index.html', copy)); return res;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => { const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); return res; })));
});
