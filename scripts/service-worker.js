/* Build placeholders are filled by pwa-plugin.mjs. */
const VERSION = __BUILD_VERSION__;
const FILES = __PRECACHE_FILES__;
const SCOPE = self.registration.scope;
const PREFIX = `citydriver:${SCOPE}:`;
const CACHE = `${PREFIX}${VERSION}`;
const PREVIOUS = new URL('.previous-caches', SCOPE).href;
const urls = FILES.map(file => new URL(file, SCOPE).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const previous = (await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== CACHE);
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
      await cache.put(PREVIOUS, new Response(JSON.stringify(previous)));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
  // Let existing tabs finish on their current version; never force a reload.
});

// Sent when the player presses Reload on the update notice.
self.addEventListener('message', event => {
  if (event.data === 'activate-update') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // A newer worker can already be downloading while this one activates.
    // Only remove caches that preceded our install. Persist the list because
    // the worker may have stopped between downloading and activation.
    const previous = await (await caches.open(CACHE)).match(PREVIOUS);
    for (const name of previous ? await previous.json() : []) {
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
    // An old tab's request can finish after activation removed its cache.
    // Reading it must not recreate the discarded version.
    return (await caches.match(cacheKey, { cacheName: CACHE })) || fetch(request);
  })());
});
