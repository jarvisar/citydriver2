import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMenuKey, rotateHue } from '../src/menu-focus.js';

test('the custom paint well turns its hue from a controller and comes full circle', () => {
  assert.equal(rotateHue('#ff0000', 120), '#00ff00');
  assert.equal(rotateHue('#ff0000', -120), '#0000ff');
  let color = '#d96143';
  for (let i = 0; i < 18; i++) color = rotateHue(color, 20);
  const distance = [1, 3, 5].reduce((sum, i) => sum + Math.abs(parseInt(color.slice(i, i + 2), 16) - parseInt('#d96143'.slice(i, i + 2), 16)), 0);
  assert.ok(distance <= 6, `${color} returns to the starting colour`);
  assert.notEqual(rotateHue('#808080', 20), '#808080', 'a grey still changes');
});

function keyboardFixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  globalThis.document = { activeElement: null };
  const root = { querySelectorAll: () => controls, contains: element => element === root || element === group || controls.includes(element) };
  const group = { querySelectorAll: () => controls.filter(control => control.radio) };
  const control = (name, options = {}) => ({
    name, clicks: 0, ...options,
    closest(selector) { return selector === '[inert]' ? this.inert ? root : null
      : selector === 'button[role="radio"]' ? this.radio ? this : null
        : selector === '[role="radiogroup"]' ? this.radio ? group : null : null; },
    getClientRects() { return this.hidden ? [] : [{}]; },
    checkVisibility() { return !this.hidden; },
    matches(selector) { return selector === 'button[role="radio"]' && Boolean(this.radio); },
    focus() { document.activeElement = this; },
    click() { this.clicks++; },
  });
  const controls = [control('first'), control('disabled', { disabled: true }), control('hidden', { hidden: true }), control('inert', { inert: true }), control('last')];
  const event = (key, target = document.activeElement, options = {}) => ({ key, target, ...options,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
  });
  return { root, group, controls, control, event };
}

test('modal keyboard Tab wraps both ends and cannot focus hidden background controls', t => {
  const f = keyboardFixture(t);
  f.controls[0].focus();
  const backward = f.event('Tab', undefined, { shiftKey: true });
  assert.equal(handleMenuKey(f.root, backward), true);
  assert.equal(document.activeElement.name, 'last');
  assert.equal(backward.defaultPrevented, true); assert.equal(backward.stopped, true);
  assert.equal(handleMenuKey(f.root, f.event('Tab')), true);
  assert.equal(document.activeElement.name, 'first');
  document.activeElement = f.control('background');
  handleMenuKey(f.root, f.event('Tab'));
  assert.equal(document.activeElement.name, 'first');
});

test('radio keyboard arrows wrap, skip disabled choices and activate the selected choice', t => {
  const f = keyboardFixture(t);
  for (const control of f.controls) control.radio = true;
  f.controls[0].focus();
  handleMenuKey(f.root, f.event('ArrowLeft'));
  assert.equal(document.activeElement.name, 'last'); assert.equal(f.controls.at(-1).clicks, 1);
  handleMenuKey(f.root, f.event('ArrowRight'));
  assert.equal(document.activeElement.name, 'first'); assert.equal(f.controls[0].clicks, 1);
  handleMenuKey(f.root, f.event('End'));
  assert.equal(document.activeElement.name, 'last');
  handleMenuKey(f.root, f.event('Home'));
  assert.equal(document.activeElement.name, 'first');
  assert.equal(f.controls[1].clicks, 0); assert.equal(f.controls[2].clicks, 0); assert.equal(f.controls[3].clicks, 0);
});

test('menu keyboard handling leaves native editing, shortcuts and modified keys alone', t => {
  const f = keyboardFixture(t);
  f.controls[0].focus();
  for (const event of [f.event('ArrowLeft'), f.event('Home'), f.event('Escape'), f.event('m'), f.event('Tab', undefined, { ctrlKey: true }), f.event('Tab', undefined, { defaultPrevented: true })]) {
    assert.equal(handleMenuKey(f.root, event), false);
    assert.equal(document.activeElement.name, 'first');
    assert.equal(event.stopped, undefined);
  }
  assert.equal(handleMenuKey(null, f.event('Tab')), false);
});
