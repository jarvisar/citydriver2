import test from 'node:test';
import assert from 'node:assert/strict';
import { readHintFlags } from '../src/hud-dom.js';

test('malformed hint saves can still record the next hint without interrupting play', () => {
  for (const saved of ['true', 'false', '42', '"shown"', '[]', 'null', '{broken']) {
    const flags = readHintFlags('hints', { getItem: () => saved });
    flags.stages = true;
    assert.deepEqual(flags, { stages: true }, saved);
  }
});

test('hint flags preserve earlier hints and tolerate missing or unavailable storage', () => {
  const flags = readHintFlags('hints', { getItem: key => key === 'hints' ? '{"roll":true}' : null });
  flags.loop = true;
  assert.deepEqual(flags, { roll: true, loop: true });
  assert.deepEqual(readHintFlags('hints'), {});
  assert.deepEqual(readHintFlags('hints', { getItem() { throw new Error('Storage unavailable'); } }), {});
});
