import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/input.js';

function fixture(t) {
  const listeners = new Map(), captures = new Map(), actions = [];
  const element = { style: { setProperty() {} }, classList: { add() {}, remove() {} } };
  const node = name => ({
    addEventListener(type, handler) { const key = `${name}:${type}`; listeners.set(key, [...(listeners.get(key) ?? []), handler]); },
    setPointerCapture(id) { captures.set(id, this); },
    hasPointerCapture(id) { return captures.get(id) === this; },
    releasePointerCapture(id) { captures.delete(id); },
    blur() {},
  });
  const scene = node('scene'), boost = node('boost'), drift = node('drift');
  const previous = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  globalThis.window = node('window');
  globalThis.document = {
    body: { dataset: {} },
    querySelector(selector) { return { '#touch-stick': element, '#scene': scene, '[data-drive-button="boost"]': boost, '[data-drive-button="handbrake"]': drift }[selector] ?? null; },
  };
  const input = new Input(action => actions.push(action));
  const pointer = id => ({ pointerId: id, preventDefault() {} });
  return { input, captures, actions, pointer, event: (name, event = {}) => { for (const handler of listeners.get(name) ?? []) handler(event); } };
}

test('rotating the viewport releases HUD holds and captures before another gesture', t => {
  const f = fixture(t);
  f.event('boost:pointerdown', f.pointer(1)); f.event('drift:pointerdown', f.pointer(2));
  assert.equal(f.input.state.boost, true); assert.equal(f.input.state.handbrake, true);
  f.event('window:resize');
  assert.equal(f.input.state.boost, false); assert.equal(f.input.state.handbrake, false);
  assert.equal(f.captures.size, 0);
  f.event('boost:pointerdown', f.pointer(3));
  assert.equal(f.input.state.boost, true);
  f.event('boost:pointercancel', f.pointer(3));
  assert.equal(f.input.state.boost, false);
});

test('pausing clears every held touch button and capture', t => {
  const f = fixture(t);
  f.event('boost:pointerdown', f.pointer(1)); f.event('drift:pointerdown', f.pointer(2));
  f.input.clear();
  assert.equal(f.captures.size, 0);
  assert.equal(f.input.state.sprint, false); assert.equal(f.input.state.jump, false);
});

test('releasing one of two fingers on a HUD button keeps the other hold', t => {
  const f = fixture(t);
  f.event('boost:pointerdown', f.pointer(1)); f.event('boost:pointerdown', f.pointer(2));
  f.event('boost:pointerup', f.pointer(1));
  assert.equal(f.input.state.boost, true);
  f.event('boost:lostpointercapture', f.pointer(2));
  assert.equal(f.input.state.boost, false);
});
