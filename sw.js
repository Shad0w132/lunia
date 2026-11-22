const CACHE_NAME = 'lunia-ios-pwa-v6';
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/app.js",
  "./js/engine.js",
  "./js/catalog.js",
  "./js/storage.js",
  "./assets/articles.json",
  "./assets/stories.json",
  "./assets/books/index.json",
  "./assets/books/01-cycle.md",
  "./assets/books/02-periods.md",
  "./assets/books/03-hormones.md",
  "./assets/books/04-contraception.md",
  "./assets/books/05-pregnancy-planning.md",
  "./assets/books/06-interesting.md",
  "./assets/fonts/manrope_medium.ttf",
  "./assets/fonts/manrope_semibold.ttf",
  "./assets/fonts/manrope_bold.ttf",
  "./assets/fonts/manrope_extrabold.ttf",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-180.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isCode = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  if (isCode) {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        return res;
      }).catch(() => caches.match(req))
    );
  } else {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        return res;
      }))
    );
  }
});
