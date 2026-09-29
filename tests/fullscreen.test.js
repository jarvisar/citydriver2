import test from 'node:test';
import assert from 'node:assert/strict';
import { createFullscreen } from '../src/fullscreen.js';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, fields = {}) { for (const fn of listeners.get(type) ?? []) fn({ type, target: {}, isTrusted: true, ...fields }); },
  };
}
function fixture({ keyboard = false, webkit = false, supported = true, desktop = null } = {}) {
  const document = events(), display = { ...events(), matches: false }, timers = new Map(), messages = [];
  const state = { started: true, paused: false, vr: false }, calls = { requests: 0, exits: 0, pauses: 0, locks: 0 };
  let now = 2000, timer = 0;
  const change = webkit ? 'webkitfullscreenchange' : 'fullscreenchange', field = webkit ? 'webkitFullscreenElement' : 'fullscreenElement';
  if (!webkit) document.onfullscreenchange = null;
  document[field] = null;
  document.documentElement = {};
  document[webkit ? 'webkitFullscreenEnabled' : 'fullscreenEnabled'] = supported;
  const enter = () => { document[field] = document.documentElement; document.fire(change); };
  const leave = () => { document[field] = null; document.fire(change); };
  if (supported) document.documentElement[webkit ? 'webkitRequestFullscreen' : 'requestFullscreen'] = async () => { calls.requests++; enter(); };
  document[webkit ? 'webkitExitFullscreen' : 'exitFullscreen'] = async () => { calls.exits++; leave(); };
  const navigator = { userActivation: { isActive: true } };
  if (keyboard) navigator.keyboard = { lock: async keys => { calls.locks++; assert.deepEqual(keys, ['Escape']); } };
  const button = { pressed: null, getAttribute() { return this.pressed; }, setAttribute(key, value) { this.pressed = value; } };
  const window = { ...events(), document, navigator, citydriverDesktop: desktop, performance: { now: () => now },
    matchMedia: query => query === '(display-mode: fullscreen)' ? display : { matches: true },
    setTimeout(fn, delay) { timers.set(++timer, { fn, at: now + delay }); return timer; }, clearTimeout(id) { timers.delete(id); } };
  const fullscreen = createFullscreen({ window, button, state: () => state,
    pause: () => { state.paused = true; calls.pauses++; }, toast: text => messages.push(text) });
  const advance = ms => { now += ms; for (const [id, task] of timers) if (task.at <= now) { timers.delete(id); task.fn(); } };
  const resume = async () => { state.paused = false; fullscreen.resume(); await flush(); };
  return { document, display, navigator, button, window, state, calls, messages, fullscreen, enter, leave, advance, resume };
}

test('fullscreen is entered only on request, and leaving with the switch never pauses or restores it', async () => {
  const f = fixture();
  assert.equal(f.calls.requests, 0);
  assert.equal(f.button.pressed, 'false');
  await f.fullscreen.toggle();
  assert.equal(f.fullscreen.active, true);
  assert.equal(f.button.pressed, 'true');
  await f.fullscreen.toggle();
  assert.equal(f.fullscreen.active, false);
  assert.equal(f.calls.pauses, 0);
  assert.equal(f.fullscreen.released(), false, 'a pointer lost with the fullscreen switch is expected');
  await f.resume();
  assert.equal(f.calls.requests, 1);
});

test('browser Escape pauses and restores fullscreen on resume only without Keyboard Lock', async () => {
  for (const keyboard of [false, true]) {
    const f = fixture({ keyboard });
    await f.fullscreen.toggle();
    f.leave();
    assert.equal(f.state.paused, true);
    assert.equal(f.button.pressed, 'false');
    await f.resume();
    assert.equal(f.fullscreen.active, !keyboard);
    assert.equal(f.calls.requests, keyboard ? 1 : 2);
  }
});

test('an Escape releasing the pointer before fullscreen still restores the drive on resume', async () => {
  const f = fixture();
  await f.fullscreen.toggle();
  f.fullscreen.released();
  assert.equal(f.state.paused, true);
  assert.equal(f.fullscreen.recentlyReleased, true, 'ignore a second pause from the same Escape');
  f.advance(100); f.leave();
  await f.resume();
  assert.equal(f.fullscreen.active, true);
  f.advance(500);
  assert.equal(f.fullscreen.recentlyReleased, false);
});

test('fullscreen exit on the title, in VR or in an existing pause does not pause or restore a drive', async () => {
  for (const state of [{ started: false }, { vr: true }, { paused: true }]) {
    const f = fixture(); Object.assign(f.state, state);
    await f.fullscreen.toggle(); f.leave();
    assert.equal(f.calls.pauses, 0);
    await f.resume();
    assert.equal(f.fullscreen.active, false);
  }
  const f = fixture();
  await f.fullscreen.toggle(); f.leave(); f.state.vr = true;
  await f.resume();
  assert.equal(f.fullscreen.active, false, 'entering VR cancels the pending desktop restoration');
});

test('a controller request waits for one trusted click or key, then removes the gesture listeners', async () => {
  const f = fixture(); f.navigator.userActivation.isActive = false;
  await f.fullscreen.toggle();
  assert.equal(f.calls.requests, 0);
  assert.equal(f.messages.at(-1), 'Click or press any key for fullscreen');
  f.window.fire('keydown', { key: 'W', isTrusted: false });
  f.window.fire('keydown', { key: 'W', repeat: true });
  for (const key of ['Escape', 'Shift', 'Control', 'Alt', 'Meta']) f.window.fire('keydown', { key });
  assert.equal(f.calls.requests, 0);
  f.navigator.userActivation.isActive = true;
  f.window.fire('pointerup'); await flush();
  assert.equal(f.calls.requests, 1);
  await f.fullscreen.toggle(); f.advance(2000);
  f.window.fire('keydown', { key: 'W' }); await flush();
  assert.equal(f.calls.requests, 1, 'the old request cannot take fullscreen again');
});

test('a pending controller request expires and does not double-handle F or the fullscreen switch', async () => {
  for (const fields of [{ code: 'KeyF' }, { key: 'F11' }, { target: { closest: () => ({}) } }]) {
    const f = fixture(); f.navigator.userActivation.isActive = false;
    await f.fullscreen.toggle();
    f.navigator.userActivation.isActive = true; f.window.fire('keydown', fields);
    await flush(); assert.equal(f.calls.requests, 0);
  }
  const f = fixture(); f.navigator.userActivation.isActive = false;
  await f.fullscreen.toggle(); f.advance(10000);
  f.navigator.userActivation.isActive = true; f.window.fire('pointerup');
  await flush(); assert.equal(f.calls.requests, 0);
});

test('browser-owned fullscreen updates the switch and explains why the page cannot leave it', async () => {
  const f = fixture();
  f.display.matches = true; f.display.fire('change');
  assert.equal(f.fullscreen.active, true); assert.equal(f.button.pressed, 'true');
  await f.fullscreen.toggle();
  assert.equal(f.calls.exits, 0); assert.equal(f.messages.at(-1), 'Press F11 to leave fullscreen');
  f.display.matches = false; f.display.fire('change');
  assert.equal(f.button.pressed, 'false');
});

test('unsupported fullscreen is hidden and WebKit uses its prefixed entry and exit methods', async () => {
  const unsupported = fixture({ supported: false });
  assert.equal(unsupported.button.hidden, true);
  await unsupported.fullscreen.toggle();
  assert.equal(unsupported.messages.at(-1), 'Fullscreen unavailable');
  const f = fixture({ webkit: true });
  assert.equal(f.button.hidden, false);
  await f.fullscreen.toggle(); assert.equal(f.fullscreen.active, true);
  await f.fullscreen.toggle(); assert.equal(f.fullscreen.active, false);
  assert.equal(f.calls.exits, 1); assert.equal(f.calls.pauses, 0);
});

test('pending and rejected fullscreen requests do not duplicate entry or prevent retry', async () => {
  const f = fixture(); let finish;
  f.document.documentElement.requestFullscreen = () => { f.calls.requests++; return new Promise(resolve => { finish = resolve; }); };
  const first = f.fullscreen.toggle(); await f.fullscreen.toggle();
  assert.equal(f.calls.requests, 1);
  f.enter(); finish(); await first;
  const exit = f.document.exitFullscreen;
  f.document.exitFullscreen = async () => { throw new Error('denied'); };
  await f.fullscreen.toggle();
  assert.equal(f.fullscreen.active, true); assert.equal(f.messages.at(-1), 'Fullscreen unavailable');
  f.document.exitFullscreen = exit;
  await f.fullscreen.toggle(); assert.equal(f.fullscreen.active, false);
  f.document.documentElement.requestFullscreen = async () => { throw new Error('denied'); };
  await f.fullscreen.toggle(); assert.equal(f.fullscreen.active, false);
  f.document.documentElement.requestFullscreen = async () => f.enter();
  await f.fullscreen.toggle(); assert.equal(f.fullscreen.active, true);
});

test('native desktop fullscreen needs no browser gesture or Keyboard Lock', async () => {
  let changed, active = true, toggles = 0;
  const desktop = { onFullscreenChange(fn) { changed = fn; }, getFullscreen: async () => active,
    async toggleFullscreen() { toggles++; active = !active; changed(active); return active; } };
  const f = fixture({ desktop, keyboard: true }); await flush();
  assert.equal(f.fullscreen.active, true); assert.equal(f.button.pressed, 'true');
  f.navigator.userActivation.isActive = false;
  await f.fullscreen.toggle(); await f.fullscreen.toggle();
  assert.equal(toggles, 2); assert.equal(f.calls.requests, 0); assert.equal(f.calls.locks, 0);
  assert.equal(f.calls.pauses, 0);
  f.advance(2000); f.fullscreen.released();
  assert.equal(f.calls.pauses, 1, 'Escape freeing the pointer pauses the desktop drive');
});

test('a late Keyboard Lock result from an exited session cannot change the next session', async () => {
  const f = fixture({ keyboard: true }); let finish;
  f.navigator.keyboard.lock = () => new Promise(resolve => { finish = resolve; });
  await f.fullscreen.toggle(); f.leave();
  finish(); await flush();
  f.navigator.keyboard.lock = () => Promise.reject(new Error('denied'));
  await f.resume();
  f.leave(); await f.resume();
  assert.equal(f.fullscreen.active, true, 'the current session had no Keyboard Lock, so Resume restores it');
});

test('Keyboard Lock throwing leaves Escape and resume usable', async () => {
  const f = fixture({ keyboard: true });
  f.navigator.keyboard.lock = () => { throw new Error('unavailable'); };
  await f.fullscreen.toggle(); f.leave(); await f.resume();
  assert.equal(f.fullscreen.active, true);
  assert.deepEqual(f.messages, []);
});

test('recapturing the mouse after a fullscreen exit makes the next Escape pause immediately', async () => {
  const f = fixture();
  await f.fullscreen.toggle(); await f.fullscreen.toggle();
  assert.equal(f.fullscreen.released(), false);
  f.fullscreen.captured(); f.advance(50); f.fullscreen.released();
  assert.equal(f.calls.pauses, 1);
});

test('a refused fullscreen exit must not suppress a later pointer release', async () => {
  const f = fixture(); await f.fullscreen.toggle();
  f.document.exitFullscreen = async () => { throw new Error('denied'); };
  await f.fullscreen.toggle(); f.fullscreen.released();
  assert.equal(f.calls.pauses, 1);
});
