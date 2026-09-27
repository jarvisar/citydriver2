import test from 'node:test';
import assert from 'node:assert/strict';
import { MouseLook } from '../src/mouse-look.js';

// Node has no page: a stand-in document and scene that grant every lock
function fixture({ mouse = true } = {}) {
  const document = new EventTarget(), element = new EventTarget(), calls = { requests: 0, exits: 0, releases: 0, looks: [], zooms: [] };
  document.pointerLockElement = null;
  document.exitPointerLock = () => { document.pointerLockElement = null; calls.exits++; };
  element.requestPointerLock = () => { calls.requests++; document.pointerLockElement = element; return Promise.resolve(); };
  globalThis.document = document;
  globalThis.matchMedia = () => ({ matches: mouse });
  const state = { lockable: true, zoomable: true };
  const look = new MouseLook(element, { lockable: () => state.lockable, zoomable: () => state.zoomable,
    look: (yaw, pitch) => calls.looks.push([yaw, pitch]), zoom: factor => calls.zooms.push(factor), released: () => calls.releases++ });
  const fire = (target, type, fields = {}) => { const event = Object.assign(new Event(type, { cancelable: true }), fields); target.dispatchEvent(event); return event; };
  return { document, element, calls, state, look, fire };
}
test.afterEach(() => { delete globalThis.document; delete globalThis.matchMedia; });

test('the mouse holds the pointer while it may look round, and lets it go for a menu', () => {
  const { document, element, calls, state, look, fire } = fixture();
  look.update(); look.update();
  assert.equal(calls.requests, 1); assert.equal(document.pointerLockElement, element);
  fire(element, 'mousemove', { movementX: 40, movementY: -20 });
  assert.equal(calls.looks.length, 1);
  assert.ok(calls.looks[0][0] > 0 && calls.looks[0][1] < 0, 'right turns right, up looks up');
  // Paused: moves are ignored at once, and the pointer is let go
  state.lockable = false;
  fire(element, 'mousemove', { movementX: 40, movementY: 0 });
  assert.equal(calls.looks.length, 1);
  look.update();
  assert.equal(calls.exits, 1); assert.equal(document.pointerLockElement, null);
  // Back to the drive, it takes it again
  state.lockable = true; look.update();
  assert.equal(calls.requests, 2);
});

test('a refused lock is asked for again only after a click or a key', () => {
  const { document, element, calls, look, fire } = fixture();
  element.requestPointerLock = () => { calls.requests++; return Promise.reject(new Error('needs a gesture')); };
  for (let i = 0; i < 5; i++) look.update();
  assert.equal(calls.requests, 1);
  fire(document, 'keydown', { repeat: true }); look.update();
  assert.equal(calls.requests, 1, 'a held key is no new press');
  fire(document, 'keydown'); look.update();
  fire(document, 'mousedown'); look.update();
  assert.equal(calls.requests, 3);
});

test('without a mouse nothing is locked, and the wheel zooms by how far it turns', () => {
  const { calls, look, state, element, fire } = fixture({ mouse: false });
  look.update();
  assert.equal(calls.requests, 0);
  const notch = fire(element, 'wheel', { deltaY: 100, deltaMode: 0 });
  assert.ok(notch.defaultPrevented && calls.zooms[0] > 1.1 && calls.zooms[0] < 1.2, 'down takes it out');
  fire(element, 'wheel', { deltaY: -3, deltaMode: 1 });
  assert.ok(Math.abs(calls.zooms[1] * calls.zooms[0] - 1) < .02, 'three lines are about a notch');
  // (Ctrl and the wheel zoom the page, and there is nothing to zoom in a menu)
  assert.equal(fire(element, 'wheel', { deltaY: 100, deltaMode: 0, ctrlKey: true }).defaultPrevented, false);
  state.zoomable = false; fire(element, 'wheel', { deltaY: 100, deltaMode: 0 });
  assert.equal(calls.zooms.length, 2);
});

test('the player taking the pointer back mid-drive is heard, the game letting it go is not', () => {
  const { document, calls, state, look, fire } = fixture();
  look.update(); fire(document, 'pointerlockchange');
  assert.equal(calls.releases, 0, 'taking it is no release');
  document.pointerLockElement = null; fire(document, 'pointerlockchange');
  assert.equal(calls.releases, 1, 'Escape freed it while driving');
  look.update();
  state.lockable = false; look.update(); fire(document, 'pointerlockchange');
  assert.equal(calls.releases, 1, 'paused, the game let it go itself');
});
