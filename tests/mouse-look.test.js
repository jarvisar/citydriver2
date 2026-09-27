import test from 'node:test';
import assert from 'node:assert/strict';
import { MouseLook } from '../src/mouse-look.js';

// Node has no page: a stand-in document and scene that grant every lock
function fixture({ mouse = true, automatic = false } = {}) {
  const document = new EventTarget(), element = new EventTarget(), calls = { requests: 0, exits: 0, releases: 0, captures: 0, looks: [], zooms: [] };
  const fire = (target, type, fields = {}) => { const event = Object.assign(new Event(type, { cancelable: true }), fields); target.dispatchEvent(event); return event; };
  document.pointerLockElement = null;
  document.exitPointerLock = () => { document.pointerLockElement = null; calls.exits++; fire(document, 'pointerlockchange'); };
  element.requestPointerLock = () => { calls.requests++; document.pointerLockElement = element; fire(document, 'pointerlockchange'); return Promise.resolve(); };
  globalThis.document = document;
  globalThis.matchMedia = () => ({ matches: mouse });
  const state = { lookable: true, automatic, zoomable: true, release: undefined };
  const look = new MouseLook(element, { lookable: () => state.lookable, automatic: () => state.automatic, zoomable: () => state.zoomable,
    look: (yaw, pitch) => calls.looks.push([yaw, pitch]), zoom: factor => calls.zooms.push(factor),
    released: () => { calls.releases++; return state.release; }, captured: () => calls.captures++ });
  // (the player taking the pointer back: Escape)
  const escape = () => { document.pointerLockElement = null; fire(document, 'pointerlockchange'); };
  const click = (button = 0) => { fire(document, 'mousedown', { button }); fire(element, 'mousedown', { button }); };
  return { document, element, calls, state, look, fire, escape, click };
}
test.afterEach(() => { delete globalThis.document; delete globalThis.matchMedia; });

test('in a window a click on the scene takes the pointer, and it looks round from then on', () => {
  const { document, element, calls, state, look, fire, click } = fixture();
  look.update(); look.update();
  assert.equal(calls.requests, 0, 'nothing is taken unasked');
  fire(element, 'mousemove', { movementX: 40, movementY: -20 });
  assert.equal(calls.looks.length, 0, 'a free pointer does not look round');
  click(2);
  assert.equal(calls.requests, 0, 'only the main button takes it');
  click();
  assert.equal(calls.requests, 1); assert.equal(document.pointerLockElement, element); assert.equal(calls.captures, 1);
  look.update(); assert.equal(calls.requests, 1, 'asked once');
  fire(element, 'mousemove', { movementX: 40, movementY: -20 });
  assert.equal(calls.looks.length, 1);
  assert.ok(calls.looks[0][0] > 0 && calls.looks[0][1] < 0, 'right turns right, up looks up');
  // Paused or in a menu: moves are ignored at once, and the pointer is let go
  state.lookable = false;
  fire(element, 'mousemove', { movementX: 40, movementY: 0 });
  assert.equal(calls.looks.length, 1);
  look.update();
  assert.equal(calls.exits, 1); assert.equal(document.pointerLockElement, null); assert.equal(calls.releases, 0, 'the game let it go');
  // Back to the drive, it is taken again without another click
  state.lookable = true; look.update();
  assert.equal(calls.requests, 2); assert.equal(document.pointerLockElement, element);
});

test('a click while it may not look round takes nothing', () => {
  const { calls, state, look, click } = fixture();
  state.lookable = false; click(); look.update();
  assert.equal(calls.requests, 0);
  state.lookable = true; look.update();
  assert.equal(calls.requests, 0, 'nor is it wanted later');
});

test('in fullscreen the pointer is taken without a click', () => {
  const { calls, state, look } = fixture({ automatic: true });
  look.update();
  assert.equal(calls.requests, 1);
  // Taken once, it stays wanted after fullscreen is left by F or the switch
  state.automatic = false; look.update();
  assert.equal(calls.exits, 0);
});

test('Escape takes the pointer back: the drive hears it, and a click is wanted again', () => {
  const { document, calls, look, escape, click } = fixture();
  click(); escape();
  assert.equal(calls.releases, 1);
  look.update(); look.update();
  assert.equal(calls.requests, 1, 'not taken again unclicked');
  click(); assert.equal(calls.requests, 2); assert.equal(document.pointerLockElement !== null, true);
});

test('the browser letting go with fullscreen is no taking back', () => {
  const { calls, state, look, escape, click } = fixture();
  click(); state.release = false; escape();
  assert.equal(calls.releases, 1);
  look.update();
  assert.equal(calls.requests, 2, 'still wanted: taken again');
});

test('a refused lock is asked for again only after a click or a key', () => {
  const { document, element, calls, look, fire } = fixture({ automatic: true });
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
  const { calls, look, state, element, fire, click } = fixture({ mouse: false, automatic: true });
  look.update(); click(); look.update();
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

test('the game letting the pointer go is never heard as the player taking it back', () => {
  const { document, calls, state, look, fire, click } = fixture();
  click();
  // The browser says so a moment later, by when the camera is back in the
  // chase view (V pressed twice): only the game's own note tells them apart
  document.exitPointerLock = () => { document.pointerLockElement = null; calls.exits++; };
  state.lookable = false; look.update(); state.lookable = true;
  fire(document, 'pointerlockchange');
  assert.equal(calls.releases, 0);
  look.update();
  assert.equal(calls.requests, 2, 'it is taken again');
});
