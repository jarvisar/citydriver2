import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../public/pwa-register.js', import.meta.url), 'utf8');
function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { const entries = listeners.get(type) ?? []; entries.push(fn); listeners.set(type, entries); },
    async fire(type, event = {}) { for (const fn of listeners.get(type) ?? []) await fn(event); },
  };
}
async function fixture({ controller = null, waiting = null, unavailable = false } = {}) {
  const notices = [], messages = [], warnings = [], intervals = [];
  let reloads = 0, updates = 0, now = 0;
  const registration = { ...events(), waiting, installing: null, update: async () => { updates++; } };
  const worker = { ...events(), controller, register: async () => { if (unavailable) throw new Error('Offline disabled'); return registration; } };
  const parents = Array.from({ length: 2 }, () => ({ querySelector: () => null, insertBefore: notice => notices.push(notice) }));
  const document = {
    ...events(), currentScript: { src: 'https://citydriver.test/citydriver/pwa-register.js' }, visibilityState: 'visible',
    querySelectorAll: selector => selector === '#welcome, #pause-overlay .pause-header' ? parents : notices.map(notice => notice.button),
    createElement() { const button = events(); return { ...events(), button, querySelector: () => button }; },
  };
  const window = { ...events(), isSecureContext: true };
  runInNewContext(script, { window, document, navigator: { serviceWorker: worker }, URL,
    location: { reload: () => { reloads++; } }, console: { warn: (...args) => warnings.push(args) },
    Date: { now: () => now }, setInterval: callback => intervals.push(callback) });
  await window.fire('load');
  return { worker, registration, document, notices, messages, warnings,
    get reloads() { return reloads; }, get updates() { return updates; },
    tick: async ms => { now += ms; for (const callback of intervals) await callback(); },
    nextWorker: () => ({ postMessage: message => messages.push(message) }) };
}

test('a first-visit tab announces a later update after acquiring its initial worker', async () => {
  const f = await fixture();
  f.worker.controller = f.nextWorker();
  await f.worker.fire('controllerchange');
  assert.equal(f.notices.length, 0, 'initial offline installation is silent');
  f.worker.controller = f.nextWorker();
  await f.worker.fire('controllerchange');
  assert.equal(f.notices.length, 2, 'an update activated by another tab is announced');
  assert.equal(f.reloads, 0, 'driving never reloads automatically');
  await f.notices[0].button.fire('click');
  assert.equal(f.reloads, 1, 'Reload refreshes an update already activated elsewhere');
});

test('a waiting update stays put until Reload and reloads after activation', async () => {
  const f = await fixture({ controller: {}, waiting: { postMessage() {} } });
  f.registration.waiting = f.nextWorker();
  assert.equal(f.notices.length, 2);
  assert.equal(f.reloads, 0);
  await f.notices[1].button.fire('click');
  assert.deepEqual(f.messages, ['activate-update']);
  assert.ok(f.notices.every(notice => notice.button.disabled));
  assert.equal(f.reloads, 0);
  f.worker.controller = f.registration.waiting; f.registration.waiting = null;
  await f.worker.fire('controllerchange');
  assert.equal(f.reloads, 1);
});

test('a downloaded update announces once on title and pause without reloading', async () => {
  const f = await fixture({ controller: {} });
  const installing = { ...events(), state: 'installing' };
  f.registration.installing = installing;
  await f.registration.fire('updatefound');
  f.registration.waiting = installing; installing.state = 'installed';
  await installing.fire('statechange');
  await installing.fire('statechange');
  assert.equal(f.notices.length, 2);
  assert.equal(f.reloads, 0);
});

test('offline registration failure leaves the game usable', async () => {
  const f = await fixture({ unavailable: true });
  assert.equal(f.warnings.length, 1);
  assert.equal(f.notices.length, 0);
  assert.equal(f.reloads, 0);
});

test('update checks wait a minute and skip hidden tabs', async () => {
  const f = await fixture({ controller: {} });
  await f.tick(59_999); assert.equal(f.updates, 0);
  await f.tick(1); assert.equal(f.updates, 1);
  f.document.visibilityState = 'hidden';
  await f.tick(600_000); assert.equal(f.updates, 1);
  f.document.visibilityState = 'visible';
  await f.document.fire('visibilitychange'); assert.equal(f.updates, 2);
  await f.document.fire('visibilitychange'); assert.equal(f.updates, 2);
});
