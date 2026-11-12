/* =====================================================================
   sw.js — service worker.
   Cache-first for the shell so the app opens with no signal at all;
   network-first for Firebase (which the sync engine calls directly).
   ===================================================================== */
const VERSION = 'efpl-biomass-v1.2.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/config.js', './js/store.js', './js/domain.js', './js/firebase.js',
  './js/auth.js', './js/sync.js', './js/ui.js', './js/seed.js', './js/app.js',
  './js/views-core.js', './js/views-stock.js', './js/views-money.js', './js/boot.js',
  './assets/enerfab-logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache Firebase traffic — the sync engine needs live answers.
  if (/firebaseio\.com|googleapis\.com|firebaseapp\.com/.test(url.hostname)) return;

  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
        return res;
      }).catch(() => caches.match('./index.html'))),
    );
  }
});
