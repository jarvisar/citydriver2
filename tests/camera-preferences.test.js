import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraPreferences } from '../src/camera-preferences.js';

const storage = value => ({ value, writes: 0, getItem() { return this.value; }, setItem(key, value) { this.value = value; this.writes++; } });
test('camera settings survive reload, isolate input devices and keep driving separate from walking', () => {
  const saved = storage(), preferences = new CameraPreferences(saved), calls = [];
  preferences.setInput('touch', { sensitivity: .5, invertY: true });
  preferences.setInput('controller', { sensitivity: 1.5 });
  preferences.setProfile('walking', { view: 5, zoom: .75 });
  preferences.setProfile('driving', { view: 2, zoom: 4 });
  const restored = new CameraPreferences(saved);
  for (const source of ['touch', 'mouse', 'controller']) restored.look(source, .2, .4, (...args) => calls.push(args));
  assert.deepEqual(calls.slice(0, 2), [[.1, -.2], [.2, .4]]);
  assert.ok(Math.abs(calls[2][0] - .3) < 1e-9 && Math.abs(calls[2][1] - .6) < 1e-9);
  assert.deepEqual(restored.profiles, { driving: { view: 2, zoom: 4 }, walking: { view: 5, zoom: .75 } });
  restored.resetInput('touch'); assert.deepEqual(restored.inputs.touch, { sensitivity: 1, invertY: false });
  assert.equal(restored.inputs.controller.sensitivity, 1.5);
  const writes = saved.writes;
  restored.setProfile('driving', { zoom: 4 }); restored.setProfile(null, { view: 3 });
  assert.equal(saved.writes, writes, 'unchanged and title views do not write');
});

test('bad saved camera data and denied storage cannot break controls', () => {
  for (const raw of ['bad json', 'null', '42', JSON.stringify({ inputs: { touch: { sensitivity: -1, invertY: 'yes' } }, profiles: { driving: { view: 99, zoom: -2 } } })]) {
    const preferences = new CameraPreferences(storage(raw));
    assert.deepEqual(preferences.inputs.touch, { sensitivity: 1, invertY: false });
    assert.deepEqual(preferences.profiles.driving, { view: 4, zoom: 1 });
    preferences.setProfile('walking', { view: NaN, zoom: Infinity });
    assert.deepEqual(preferences.profiles.walking, { view: 4, zoom: 1 });
  }
  const preferences = new CameraPreferences({ getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } });
  preferences.setInput('mouse', { sensitivity: 100, invertY: true });
  assert.deepEqual(preferences.inputs.mouse, { sensitivity: 2, invertY: true });
});
