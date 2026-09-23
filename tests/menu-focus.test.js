import test from 'node:test';
import assert from 'node:assert/strict';
import { rotateHue } from '../src/menu-focus.js';

test('the custom paint well turns its hue from a controller and comes full circle', () => {
  assert.equal(rotateHue('#ff0000', 120), '#00ff00');
  assert.equal(rotateHue('#ff0000', -120), '#0000ff');
  let color = '#d96143';
  for (let i = 0; i < 18; i++) color = rotateHue(color, 20);
  const distance = [1, 3, 5].reduce((sum, i) => sum + Math.abs(parseInt(color.slice(i, i + 2), 16) - parseInt('#d96143'.slice(i, i + 2), 16)), 0);
  assert.ok(distance <= 6, `${color} returns to the starting colour`);
  assert.notEqual(rotateHue('#808080', 20), '#808080', 'a grey still changes');
});
