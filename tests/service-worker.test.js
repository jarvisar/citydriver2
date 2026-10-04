import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const template = readFileSync(new URL('../scripts/service-worker.js', import.meta.url), 'utf8');
const scope = 'https://citydriver.test/citydriver/';
const prefix = `citydriver:${scope}:`;
function cacheFixture() {
  const stores = new Map();
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    match: async (key, { cacheName }) => stores.get(cacheName)?.get(typeof key === 'string' ? key : key.url)?.clone(),
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        put: async (key, response) => store.set(typeof key === 'string' ? key : key.url, response),
        match: async key => store.get(typeof key === 'string' ? key : key.url)?.clone(),
        async addAll(requests) {
          if (caches.fail) throw new Error('Download failed');
          for (const request of requests) store.set(request.url, new Response(`${name}:${request.url}`));
        },
      };
    },
  };
  return { caches, stores };
}
function worker(version, caches) {
  const listeners = new Map();
  const self = { registration: { scope }, clients: { claim: async () => {} }, skipWaiting: async () => {},
    addEventListener: (type, callback) => listeners.set(type, callback) };
  runInNewContext(template.replace('__BUILD_VERSION__', JSON.stringify(version))
    .replace('__PRECACHE_FILES__', JSON.stringify(['index.html', 'assets/game.js'])),
  { self, caches, URL, Request, Response, fetch: async () => { throw new Error('Offline'); } });
  return {
    async event(type, request) {
      let pending;
      listeners.get(type)({ request, waitUntil: promise => { pending = promise; }, respondWith: promise => { pending = promise; } });
      return pending;
    },
  };
}

test('activation keeps a newer downloaded cache and that update works offline', async () => {
  const { caches, stores } = cacheFixture();
  await caches.open(`${prefix}old`); await caches.open('unrelated-app-cache');
  const first = worker('first', caches), next = worker('next', caches);
  await first.event('install');
  await next.event('install');
  await first.event('activate');
  assert.ok(stores.has(`${prefix}next`), 'a second update can finish downloading before the first activates');
  assert.ok(!stores.has(`${prefix}old`));
  assert.ok(stores.has('unrelated-app-cache'));
  await next.event('activate');
  assert.deepEqual([...stores.keys()], ['unrelated-app-cache', `${prefix}next`]);
  const page = await next.event('fetch', { method: 'GET', url: `${scope}?from=homescreen`, mode: 'navigate' });
  assert.match(await page.text(), /:next:/);
  const asset = await next.event('fetch', { method: 'GET', url: `${scope}assets/game.js` });
  assert.match(await asset.text(), /:next:/);
});

test('a failed update removes only its own incomplete download', async () => {
  const { caches, stores } = cacheFixture();
  await caches.open(`${prefix}old`); await caches.open('unrelated-app-cache');
  caches.fail = true;
  await assert.rejects(worker('broken', caches).event('install'), /Download failed/);
  assert.deepEqual([...stores.keys()], [`${prefix}old`, 'unrelated-app-cache']);
});

test('cache cleanup stays within this app scope', async () => {
  const { caches, stores } = cacheFixture();
  await caches.open('citydriver:https://citydriver.test/:root-version');
  await caches.open(`${prefix}old`);
  const next = worker('next', caches);
  await next.event('install'); await next.event('activate');
  assert.deepEqual([...stores.keys()], ['citydriver:https://citydriver.test/:root-version', `${prefix}next`]);
});

test('a late request from an old worker cannot recreate its discarded cache', async () => {
  const { caches, stores } = cacheFixture();
  const old = worker('old', caches), next = worker('next', caches);
  await old.event('install'); await old.event('activate');
  await next.event('install'); await next.event('activate');
  await assert.rejects(old.event('fetch', { method: 'GET', url: `${scope}assets/game.js` }), /Offline/);
  assert.deepEqual([...stores.keys()], [`${prefix}next`]);
});
