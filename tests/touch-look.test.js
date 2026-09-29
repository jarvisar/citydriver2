import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchStick } from '../src/touch-stick.js';

function fixture(t) {
  const previous = globalThis.window, events = new Map(), captures = new Set(), looked = [];
  globalThis.window = { innerWidth: 390, innerHeight: 844, addEventListener(type, fn) { events.set(type, fn); } };
  t.after(() => { globalThis.window = previous; });
  const zone = { addEventListener() {}, setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id), releasePointerCapture(id) { captures.delete(id); } };
  const element = { style: { setProperty() {} }, classList: { add() {}, remove() {} }, offsetWidth: 120 };
  let drives = 0;
  const stick = new TouchStick(element, () => drives++, zone);
  stick.available = () => true; stick.lookable = () => true; stick.onLook = (x, y) => looked.push([x, y]);
  const event = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch', preventDefault() {} });
  return { stick, looked, captures, events, event, get drives() { return drives; } };
}

test('one thumb drives and a second drags the view without changing the stick', t => {
  const f = fixture(t), { stick, event } = f;
  stick.start(event(1, 60, 600)); stick.move(event(1, 70, 570));
  const vector = { ...stick.vector };
  stick.start(event(2, 280, 430)); stick.move(event(2, 320, 410));
  assert.deepEqual(stick.vector, vector); assert.equal(f.drives, 1);
  assert.ok(f.looked.at(-1)[0] > 0 && f.looked.at(-1)[1] < 0);
  assert.deepEqual([...f.captures], [1, 2]);
  stick.start(event(3, 220, 420)); stick.move(event(3, 240, 500));
  assert.equal(stick.lookPointer, 2); assert.equal(f.looked.length, 2, 'extra touches cannot steal the camera');
});

test('lifting the driving thumb never promotes the look thumb or jumps a replacement stick', t => {
  const { stick, event, looked } = fixture(t);
  stick.start(event(1, 60, 600)); stick.move(event(1, 60, 550)); stick.start(event(2, 280, 430));
  stick.release(); stick.move(event(2, 300, 430));
  assert.equal(stick.pointer, null); assert.equal(stick.lookPointer, 2);
  assert.deepEqual(stick.vector, { x: 0, y: 0 }); assert.ok(looked.at(-1)[0] > 0);
  stick.start(event(3, 80, 600)); stick.move(event(3, 80, 590));
  assert.equal(stick.pointer, 3); assert.equal(stick.lookPointer, 2);
  assert.ok(stick.vector.y > 0 && stick.vector.y < .3);
  stick.releaseLook(); assert.equal(stick.pointer, 3);
});

test('pause, resize and an unavailable camera release capture without moving either control', t => {
  const { stick, event, captures, events, looked } = fixture(t);
  for (const clear of [() => stick.clear(), () => events.get('resize')()]) {
    stick.start(event(1, 60, 600)); stick.start(event(2, 280, 430)); clear();
    assert.equal(stick.pointer, null); assert.equal(stick.lookPointer, null); assert.equal(captures.size, 0);
  }
  stick.lookable = () => false;
  stick.start(event(1, 60, 600)); stick.start(event(2, 280, 430));
  assert.equal(stick.lookPointer, null, 'overhead views keep the single stick');
  const before = looked.length; stick.move(event(2, 320, 430)); assert.equal(looked.length, before);
});
