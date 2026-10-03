import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pressOnRelease } from '../src/touch-stick.js';

// A stand-in button: its listeners, and a 44px box at (300, 20)
function fakeButton() {
  const listeners = {};
  return {
    listeners,
    blur() {},
    addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
    getBoundingClientRect: () => ({ left: 300, right: 344, top: 20, bottom: 64 }),
    fire(type, fields = {}) {
      const event = { cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
      for (const listener of listeners[type] ?? []) listener(event);
      return event;
    },
  };
}

test('a tap on a driving HUD button presses it once, on release, and makes no click', () => {
  const button = fakeButton(); let presses = 0;
  pressOnRelease(button, () => presses++);
  button.fire('pointerup', { pointerType: 'touch', clientX: 320, clientY: 40 });
  assert.equal(presses, 1);
  // The browser's own click after the tap is stopped where it starts...
  assert.ok(button.fire('touchend').defaultPrevented, 'the tap makes no click');
  // ...and a click still counted as a touch never presses it again
  button.fire('click', { pointerType: 'touch' });
  assert.equal(presses, 1);
});

test('sliding off a HUD button before lifting cancels the press, a small slip does not', () => {
  const button = fakeButton(); let presses = 0;
  pressOnRelease(button, () => presses++);
  button.fire('pointerup', { pointerType: 'touch', clientX: 352, clientY: 70 });
  assert.equal(presses, 1, 'a finger 8px off the edge still taps');
  button.fire('pointerup', { pointerType: 'touch', clientX: 200, clientY: 40 });
  assert.equal(presses, 1, 'a finger slid well away cancels');
});

test('a mouse, pen or key presses a HUD button with its click', () => {
  const button = fakeButton(); let presses = 0;
  pressOnRelease(button, () => presses++);
  for (const pointerType of ['mouse', 'pen', '']) {
    button.fire('pointerup', { pointerType, clientX: 320, clientY: 40 });
    button.fire('click', { pointerType });
  }
  assert.equal(presses, 3);
});

// The page's layout is sized from the window's own box (#app is fixed to it)
// and from percentages of that box, never 100dvh, lvh or vh: in Android
// Chrome's fullscreen they came out a toolbar taller than the screen, and the
// bottom of the HUD went off it. svh can never be taller than the screen.
const css = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? css(`${dir}/${entry.name}`) : entry.name.endsWith('.css') ? [`${dir}/${entry.name}`] : []);
const rules = file => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('no page style is sized from the dynamic or large viewport height', () => {
  const files = css(fileURLToPath(new URL('../src', import.meta.url)));
  assert.ok(files.length > 5);
  for (const file of files) {
    const found = rules(file).match(/[\d.]+(dvh|lvh|vh)\b/g);
    assert.equal(found, null, `${file}: ${found}`);
  }
});

test('the game box is fixed to the window, and the pause screen is a named modal dialog', () => {
  const ui = rules(new URL('../src/ui.css', import.meta.url));
  assert.match(ui, /#app \{[^}]*position: fixed; inset: 0;/);
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const overlay = page.match(/<div id="pause-overlay"[^>]*>/)[0];
  for (const attribute of ['role="dialog"', 'aria-modal="true"', 'aria-labelledby="pause-heading"']) assert.ok(overlay.includes(attribute), attribute);
  assert.match(page, /<h2 id="pause-heading">Paused<\/h2>/);
});
