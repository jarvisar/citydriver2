import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadInput } from '../src/gamepad.js';
import { DrivingController } from '../src/vehicle.js';
import { steerCurve } from '../src/handling.js';

const pad = (index = 0, mapping = 'standard') => ({ index, mapping, connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
const hold = (pad, index, value = 1) => { pad.buttons[index] = { pressed: value > .5, value }; };
function fixture() {
  const device = pad(), actions = [], connections = [], devices = [null, device];
  const input = new GamepadInput(action => actions.push(action), connected => connections.push(connected), () => devices);
  return { device, devices, input, actions, connections };
}

const konamiButtons = [12, 12, 13, 13, 14, 15, 14, 15, 1, 0];
function enterCode(input, device, sequence = konamiButtons, options) {
  for (const index of sequence) {
    hold(device, index); input.update(options); input.update(options);
    hold(device, index, 0); input.update(options);
  }
}

test('controller Konami code toggles once per entry, including through autodrive input clearing', () => {
  const { input, device } = fixture();
  let toggles = 0;
  input.onKonami = () => toggles++;
  input.onAction = action => { if (action === 'autodrive') input.clear({ preserveKonami: true }); };
  enterCode(input, device);
  assert.equal(toggles, 1);
  assert.deepEqual(input.state, {}, 'the final A does not accelerate');
  enterCode(input, device);
  assert.equal(toggles, 2);
});

test('controller code requires distinct, ordered presses and resets on interrupted input', () => {
  for (const interrupt of ['wrong', 'held', 'blocked', 'clear', 'menu', 'replacement']) {
    const { input, device, devices } = fixture();
    let toggles = 0;
    input.onKonami = () => toggles++;
    if (interrupt === 'held') {
      enterCode(input, device, [12]);
      enterCode(input, device, konamiButtons.slice(2));
    } else {
      enterCode(input, device, konamiButtons.slice(0, 8));
      if (interrupt === 'wrong') enterCode(input, device, [2]);
      if (interrupt === 'blocked') input.update({ blocked: true });
      if (interrupt === 'clear') input.clear();
      if (interrupt === 'menu') input.update({ paused: true, menu: 'pause' });
      if (interrupt === 'replacement') {
        devices[1] = pad(2); input.update(); devices[1] = device;
      }
      input.update();
      enterCode(input, device, konamiButtons.slice(8));
    }
    assert.equal(toggles, 0, interrupt);
    enterCode(input, device);
    assert.equal(toggles, 1, `${interrupt}: a fresh attempt succeeds`);
  }
});

test('controller detection handles sparse slots, disconnects, and missing or restricted APIs', () => {
  const { input, connections, devices, device } = fixture();
  input.update(); input.update();
  assert.deepEqual(connections, [true]);
  hold(device, 7); input.update(); assert.equal(input.state.forward, 1);
  devices[1] = null; input.update();
  assert.deepEqual(input.state, {}); assert.deepEqual(connections, [true, false]);
  devices[1] = device; hold(device, 7, 0); input.update();
  assert.deepEqual(connections, [true, false, true]);
  input.getGamepads = () => { throw new Error('API restricted'); };
  input.update(); assert.equal(input.connected, false); assert.deepEqual(input.state, {});
  input.getGamepads = () => []; assert.doesNotThrow(() => input.update());
});

test('stick deadzone, analog triggers, D-pad and face-button fallbacks', () => {
  const { input, device, actions } = fixture();
  device.axes[0] = .12; hold(device, 7, .04); input.update();
  assert.equal(input.state.right, 0); assert.equal(input.state.forward, 0); assert.deepEqual(actions, []);
  device.axes[0] = -.56; hold(device, 7, .75); input.update();
  assert.ok(Math.abs(input.state.left - .5) < 1e-10);
  assert.ok(input.state.forward > .7 && input.state.forward < .8);
  hold(device, 7, 0); hold(device, 6, .54); hold(device, 15); input.update();
  assert.equal(input.state.right, 1); assert.ok(Math.abs(input.state.brake - .5) < 1e-10);
  device.mapping = ''; device.axes = []; hold(device, 0); hold(device, 1); input.update();
  assert.equal(input.state.forward, 1); assert.equal(input.state.brake, 1);
});

test('shortcuts fire once per press and Start works while paused', () => {
  const { input, device, actions } = fixture();
  for (const [index, action] of [[9, 'pause'], [2, 'view'], [3, 'reset'], [5, 'nextJourney'], [8, 'map'], [13, 'fullscreen'], [11, 'fps']]) {
    hold(device, index); input.update(); input.update(); input.update();
    assert.equal(actions.filter(item => item === action).length, 1);
    hold(device, index, 0); input.update();
  }
  hold(device, 9); input.update({ paused: true });
  assert.equal(actions.filter(item => item === 'pause').length, 2);
  hold(device, 9, 0); hold(device, 7); input.update({ paused: true });
  assert.deepEqual(input.state, {}); assert.equal(actions.includes('drive'), false);
  hold(device, 11); input.update({ paused: true }); input.update({ paused: true });
  assert.equal(actions.filter(item => item === 'fps').length, 2, 'R3 toggles FPS once while paused');
});

test('scene shortcut works paused and consumes presses made in a modal', () => {
  const { input, device, actions } = fixture();
  hold(device, 5); input.update({ paused: true }); input.update({ paused: true });
  assert.deepEqual(actions, ['nextJourney']);
  hold(device, 5, 0); input.update();
  hold(device, 5); input.update({ blocked: true }); input.update();
  assert.deepEqual(actions, ['nextJourney']);
  hold(device, 5, 0); input.update();
  hold(device, 5); input.update();
  assert.deepEqual(actions, ['nextJourney', 'nextJourney']);
});

test('L1 drifts, and D-pad Down is fullscreen while driving but navigation in menus', () => {
  const { input, device, actions } = fixture();
  hold(device, 4); input.update(); input.update();
  assert.equal(input.state.handbrake, 1);
  assert.deepEqual(actions, [], 'L1 is no shortcut');
  hold(device, 4, 0); hold(device, 13); input.update(); input.update();
  assert.equal(input.state.handbrake, 0, 'D-pad Down no longer drifts');
  assert.deepEqual(actions, ['fullscreen']);
  hold(device, 13, 0); input.update();
  hold(device, 13); input.update({ paused: true, menu: 'pause' });
  hold(device, 13, 0); input.update({ paused: true, menu: 'pause' });
  hold(device, 13); input.update({ menu: true });
  assert.deepEqual(actions, ['fullscreen', 'menuDown', 'menuDown']);
});

test('D-pad Up toggles autodrive once while driving and remains navigation in menus', () => {
  const { input, device, actions } = fixture();
  hold(device, 12); input.update(); input.update();
  assert.deepEqual(actions, ['autodrive']);
  hold(device, 12, 0); input.update();
  hold(device, 12); input.update({ paused: true, menu: 'pause' });
  assert.deepEqual(actions, ['autodrive', 'menuUp']);
  hold(device, 12, 0); input.update();
  hold(device, 12); input.update({ menu: true });
  assert.deepEqual(actions, ['autodrive', 'menuUp', 'menuUp']);
});

test('chooser routes controller inputs to navigation without driving', () => {
  const { input, device, actions } = fixture();
  for (const [index, action] of [[15, 'menuNext'], [14, 'menuPrevious'], [12, 'menuUp'], [13, 'menuDown'], [0, 'menuConfirm'], [1, 'menuClose'], [8, 'menuClose'], [10, 'menuClose']]) {
    hold(device, index); input.update({ menu: true }); input.update({ menu: true });
    assert.equal(actions.at(-1), action);
    assert.deepEqual(input.state, {});
    hold(device, index, 0); input.update({ menu: true });
  }
  assert.equal(actions.length, 8);
  device.axes[0] = 1; input.update({ menu: true }); input.update({ menu: true });
  assert.equal(actions.at(-1), 'menuNext');
  device.axes[0] = 0; input.update({ menu: true });
  // The stick's two axes are separate menu directions, so a grid can be crossed by row.
  device.axes[1] = 1; input.update({ menu: true }); input.update({ menu: true });
  assert.equal(actions.at(-1), 'menuDown');
  device.axes[1] = -1; input.update({ menu: true }); input.update({ menu: true });
  assert.equal(actions.at(-1), 'menuUp');
  assert.equal(actions.length, 11);
});

test('the title screen is a menu: the D-pad chooses, A and Start confirm, and only the gas pedal drives', () => {
  const { input, device, actions } = fixture();
  const welcome = { menu: 'welcome' };
  for (const [index, action] of [[13, 'menuDown'], [12, 'menuUp'], [15, 'menuNext'], [14, 'menuPrevious'], [0, 'menuConfirm'], [9, 'menuConfirm'], [10, 'car'], [2, 'view']]) {
    hold(device, index); input.update(welcome); input.update(welcome);
    assert.equal(actions.at(-1), action);
    assert.ok(!input.state.forward && !input.state.left && !input.state.right && !input.state.handbrake, 'a menu press never reaches the car');
    hold(device, index, 0); input.update(welcome);
  }
  assert.equal(actions.includes('autodrive'), false, 'D-pad Up moves the focus instead of starting autodrive');
  hold(device, 7); input.update(welcome);
  assert.equal(actions.at(-1), 'drive');
  assert.ok(input.state.forward > .9);
});

test('the right stick scrolls a menu and is ignored while driving', () => {
  const { input, device } = fixture();
  device.axes[3] = 1; input.update({ paused: true, menu: 'pause' });
  assert.ok(input.scroll > .9);
  input.update();
  assert.equal(input.scroll, 0);
});

test('the pause screen takes the pad as a menu while its shortcuts stay live', () => {
  const { input, device, actions } = fixture();
  const pauseMenu = { paused: true, menu: 'pause' };
  for (const [index, action] of [[15, 'menuNext'], [14, 'menuPrevious'], [12, 'menuUp'], [13, 'menuDown'], [0, 'menuConfirm'], [1, 'menuClose']]) {
    hold(device, index); input.update(pauseMenu); input.update(pauseMenu);
    assert.equal(actions.at(-1), action);
    assert.deepEqual(input.state, {}, 'a menu press never reaches the car');
    hold(device, index, 0); input.update(pauseMenu);
  }
  assert.equal(actions.length, 6);
  // The pause screen is a layer over the drive, not a modal, so the shortcuts
  // that open the garage or the routes from it still work.
  for (const [index, action] of [[9, 'pause'], [8, 'map'], [10, 'car'], [5, 'nextJourney'], [11, 'fps']]) {
    hold(device, index); input.update(pauseMenu); input.update(pauseMenu);
    assert.equal(actions.at(-1), action);
    hold(device, index, 0); input.update(pauseMenu);
  }
  // Both stick axes steer the focus ring here too.
  device.axes[0] = 1; input.update(pauseMenu); input.update(pauseMenu);
  assert.equal(actions.at(-1), 'menuNext');
  device.axes[0] = 0; device.axes[1] = -1; input.update(pauseMenu); input.update(pauseMenu);
  assert.equal(actions.at(-1), 'menuUp');
  device.axes[1] = 0; input.update(pauseMenu);
  // Paused without the screen up — a chooser is over it — nothing moves a ring.
  const before = actions.length;
  hold(device, 13); input.update({ paused: true }); input.update({ paused: true });
  assert.equal(actions.length, before);
});

test('focus loss and menus consume held inputs until the controller returns to neutral', () => {
  const { input, device, actions } = fixture();
  hold(device, 7); input.update(); input.clear();
  input.update({ blocked: true }); input.update();
  assert.deepEqual(input.state, {});
  hold(device, 9); input.update({ blocked: true }); input.update();
  assert.equal(actions.includes('pause'), false);
  hold(device, 7, 0); hold(device, 9, 0); input.update();
  hold(device, 7); input.update(); assert.equal(input.state.forward, 1);
});

test('a replacement controller cannot inherit held throttle', () => {
  const { input, devices } = fixture();
  input.update(); const replacement = pad(2); hold(replacement, 7);
  devices[1] = replacement; input.update(); assert.deepEqual(input.state, {});
  hold(replacement, 7, 0); input.update(); hold(replacement, 7); input.update();
  assert.equal(input.state.forward, 1);
});

test('vehicle honors partial throttle and steering while preserving digital input', () => {
  const full = new DrivingController(), partial = new DrivingController(), digital = new DrivingController();
  for (let frame = 0; frame < 30; frame++) {
    full.update(1 / 60, { forward: 1, right: 1 });
    partial.update(1 / 60, { forward: .5, right: .5 });
    digital.update(1 / 60, { forward: true, right: true });
  }
  assert.ok(partial.speed > 0 && partial.speed < full.speed);
  // `steer` is the angle the wheels take, so half a stick is the curve's
  // half-stick angle rather than half of full lock.
  assert.ok(Math.abs(partial.steer - steerCurve(.5)) < 1e-10);
  assert.ok(partial.steer > full.steer * .3 && partial.steer < full.steer * .45);
  assert.equal(full.speed, digital.speed); assert.equal(full.u, digital.u);
  const reverse = new DrivingController();
  for (let frame = 0; frame < 60; frame++) reverse.update(1 / 60, { brake: .5 });
  assert.ok(reverse.speed < 0);
});
