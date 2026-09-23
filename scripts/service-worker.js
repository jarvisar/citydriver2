/* Build placeholders are filled by pwa-plugin.mjs. */
const VERSION = __BUILD_VERSION__;
const FILES = __PRECACHE_FILES__;
const SCOPE = self.registration.scope;
const PREFIX = `citydriver:${SCOPE}:`;
const CACHE = `${PREFIX}${VERSION}`;
const urls = FILES.map(file => new URL(file, SCOPE).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
  // Let existing tabs finish on their current version; never force a reload.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.href.startsWith(SCOPE)) return;
  const isAppPage = request.mode === 'navigate' &&
    (url.pathname === new URL(SCOPE).pathname || url.pathname === new URL('index.html', SCOPE).pathname);
  const cacheKey = isAppPage ? new URL('index.html', SCOPE).href : url.href;
  if (!urls.includes(cacheKey)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(cacheKey)) || fetch(request);
  })());
});
