const CACHE = 'wa-center-v9.4';
const SHELL = ['/index.html','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/modern.css','/contact-fix.js','/domain-ui.js','/auto-auth.js'];
const UI_CSS = '/modern.css';
const UI_SCRIPTS = ['/auto-auth.js','/contact-fix.js','/domain-ui.js'];

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

async function modernizeHtml(response) {
  if (!response || !response.ok) return response;
  const html = await response.text();
  const marker = 'wa-center-v9.4-ui';
  if (html.includes(marker)) return new Response(html, {headers: response.headers, status: response.status});
  const scripts = UI_SCRIPTS.map(src => `<script src="${src}?v=9.4" defer></script>`).join('');
  const injection = `<!-- ${marker} --><link rel="stylesheet" href="${UI_CSS}?v=9.4">${scripts}<meta name="theme-color" content="#5f55f6"><meta name="apple-mobile-web-app-title" content="WA Center">`;
  const upgraded = html.replace('</head>', `${injection}</head>`);
  const headers = new Headers(response.headers);
  headers.set('content-type','text/html; charset=utf-8');
  headers.delete('content-length');
  headers.set('cache-control','no-store');
  return new Response(upgraded, {status:response.status,statusText:response.statusText,headers});
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  if (req.mode === 'navigate' || url.pathname === '/index.html' || url.pathname === '/') {
    event.respondWith(
      fetch(req, {cache:'no-store'}).then(res => modernizeHtml(res)).then(res => {
        const copy=res.clone(); caches.open(CACHE).then(c=>c.put('/index.html',copy)).catch(()=>{}); return res;
      }).catch(() => caches.match('/index.html').then(res => res || new Response('Offline',{status:503})))
    );
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => {
    const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{}); return res;
  })));
});
