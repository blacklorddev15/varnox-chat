/* Varnox service worker — offline shell only.
   API responses and Blob media are never cached, so the app can never show stale chats. */
/* The version is bumped whenever the shell changes shape, because activate() deletes every
   cache whose name does not match — that is what makes a change to the shell actually reach
   a browser that already has the old one. */
const CACHE = 'varnox-shell-v2';
/* The backdrop is part of the shell rather than chat content: nothing else would ever cache
   it, since it is neither a navigation nor under /_next/static, so offline it would simply
   vanish and leave the flat fallback colour behind the messages. */
const SHELL = ['/', '/login', '/icon.svg', '/manifest.webmanifest', '/fire-bg.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icon')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
            return res;
          })
      )
    );
  }
});
