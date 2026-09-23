import test from 'node:test';
import assert from 'node:assert/strict';
import { KonamiCode } from '../src/konami-code.js';

const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
const enter = (detector, keys = code) => keys.map(key => detector.keydown({ code: key }));

test('only the complete Konami Code activates, once per entry', () => {
  const detector = new KonamiCode();
  for (let i = 0; i < 2; i++) assert.deepEqual(enter(detector), [...Array(9).fill(false), true]);
  assert.equal(detector.keydown({ code: 'KeyA' }), false);
});

test('wrong keys and WASD cannot substitute for the code, and another attempt can succeed', () => {
  for (const wrong of [
    [...code.slice(0, 4), 'KeyX', ...code.slice(4)],
    [...code.slice(0, 8), 'KeyA', 'KeyB'],
    ['KeyW', 'KeyW', 'KeyS', 'KeyS', 'KeyA', 'KeyD', 'KeyA', 'KeyD', 'KeyB', 'KeyA'],
  ]) {
    const detector = new KonamiCode();
    assert.ok(enter(detector, wrong).every(value => !value));
    assert.equal(enter(detector).at(-1), true);
  }
  assert.equal(enter(new KonamiCode(), ['ArrowUp', ...code]).at(-1), true);
});

test('holding a key cannot count as two presses', () => {
  const detector = new KonamiCode();
  detector.keydown({ code: 'ArrowUp' });
  assert.equal(detector.keydown({ code: 'ArrowUp', repeat: true }), false);
  assert.ok(enter(detector, code.slice(2)).every(value => !value));
  detector.reset();
  for (const key of code.slice(0, -1)) {
    assert.equal(detector.keydown({ code: key }), false);
    assert.equal(detector.keydown({ code: key, repeat: true }), false);
  }
  assert.equal(detector.keydown({ code: 'KeyA' }), true);
});

test('modified shortcuts and typing in fields break a partial code', () => {
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true },
    { target: { isContentEditable: true } }, { target: { closest: () => ({}) } }]) {
    const detector = new KonamiCode();
    enter(detector, code.slice(0, 8));
    assert.equal(detector.keydown({ code: 'KeyB', ...extra }), false);
    assert.equal(detector.keydown({ code: 'KeyA' }), false);
    assert.equal(enter(detector).at(-1), true);
  }
});

test('clearing input prevents completing a code started before focus or menu changes', () => {
  const detector = new KonamiCode();
  enter(detector, code.slice(0, 8));
  detector.reset();
  assert.ok(enter(detector, code.slice(8)).every(value => !value));
  assert.equal(enter(detector).at(-1), true);
});
