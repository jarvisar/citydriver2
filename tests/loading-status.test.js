import test from 'node:test';
import assert from 'node:assert/strict';
import { startupErrorMessage } from '../src/loading-status.js';

test('startup failures explain graphics requirements only for a failed WebGL context', () => {
  const graphics = startupErrorMessage(new Error('Error creating WebGL context.'));
  assert.match(graphics, /WebGL 2 required/);
  assert.equal(startupErrorMessage(new Error('THREE.WebGLRenderer: WebGL 1 is not supported since r163.')), graphics);
  for (const error of [new TypeError('Cannot convert object to primitive value'), new Error('Could not fetch resources'), null]) {
    const message = startupErrorMessage(error);
    assert.doesNotMatch(message, /WebGL|hardware acceleration/);
    assert.match(message, /Try again/);
  }
});
