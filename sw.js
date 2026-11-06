// Service worker de "Mis PDF": funciona sin conexión y recibe PDFs compartidos desde otras apps.
const VERSION = 'mispdf-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'mispdf-shared').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // PDF compartido desde otra app (WhatsApp, Archivos, Gmail...) hacia "Mis PDF"
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const files = form.getAll('pdf').filter((f) => f && f.size);
        const cache = await caches.open('mispdf-shared');
        let i = 0;
        for (const f of files) {
          await cache.put(`./shared/${Date.now()}-${i++}`, new Response(f, {
            headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(f.name || 'documento.pdf') }
          }));
        }
      } catch (err) { /* si falla, la app abre normal */ }
      return Response.redirect('./index.html?shared=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // App shell: primero caché, luego red (y se actualiza la caché)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: url.pathname.endsWith('index.html') || url.pathname.endsWith('/') })
      .then((hit) => {
        const net = fetch(e.request).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
  );
});
