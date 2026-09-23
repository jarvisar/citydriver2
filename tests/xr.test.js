import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { XRInput } from '../src/xr-input.js';
import { XRCameraRig } from '../src/xr-camera.js';
import { BrowserVR } from '../src/vr.js';
import { VRStatus } from '../src/vr-status.js';

test('VR menu page buttons wrap correctly when the last page is partial', () => {
  const menu = new VRStatus(new THREE.PerspectiveCamera());
  menu.model = { items: Array.from({ length: 11 }, () => ({})) };
  menu.update = () => {};
  menu.page(-1); assert.equal(menu.selected, 6);
  menu.page(1); assert.equal(menu.selected, 0);
  menu.selected = 10; menu.page(-1); assert.equal(menu.selected, 0);
});

const controller = handedness => ({ handedness, gamepad: { mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ value: 0 })) } });
function inputFixture() {
  const left = controller('left'), right = controller('right'), actions = [];
  const input = new XRInput(action => actions.push(action));
  const sources = [right, left]; // Handedness, not connection order.
  input.update(sources);
  return { left, right, actions, input, sources };
}

test('Quest analog controls use XR thumbstick slots and handedness', () => {
  const { left, right, actions, input, sources } = inputFixture();
  left.gamepad.axes[0] = 1; left.gamepad.axes[2] = -.59;
  right.gamepad.buttons[0].value = .54; left.gamepad.buttons[0].value = .31;
  input.update(sources);
  assert.ok(Math.abs(input.state.left - .5) < 1e-10);
  assert.equal(input.state.right, 0);
  assert.ok(Math.abs(input.state.forward - .5) < 1e-10);
  assert.ok(Math.abs(input.state.brake - .25) < 1e-10);
  assert.deepEqual(actions, ['drive']);
  right.gamepad.buttons[1].value = 1; input.update(sources);
  assert.equal(input.state.handbrake, true);
});

test('XR input consumes held controls on entry, focus loss and disconnect', () => {
  const { left, right, input, sources } = inputFixture();
  right.gamepad.buttons[0].value = 1; input.clear(); input.update(sources);
  assert.deepEqual(input.state, {});
  right.gamepad.buttons[0].value = 0; input.update(sources);
  right.gamepad.buttons[0].value = 1; input.update(sources);
  assert.equal(input.state.forward, 1);
  input.update(sources, { blocked: true }); input.update(sources);
  assert.deepEqual(input.state, {});
  right.gamepad.buttons[0].value = 0; input.update(sources);
  right.gamepad.buttons[0].value = 1; input.update([right]);
  assert.deepEqual(input.state, {});
  right.gamepad.buttons[0].value = 0; input.update([right]);
  right.gamepad.axes[2] = 1; input.update([right]);
  assert.equal(input.state.right, 1);
  input.update([]); assert.deepEqual(input.state, {});
  left.gamepad.mapping = 'standard'; input.update([left]);
  assert.equal(input.state.forward, 0);
  right.gamepad.buttons[0].value = 1; input.update([right]);
  assert.deepEqual(input.state, {}, 'a controller arriving after idle frames must release its held trigger');
});

test('Quest shortcuts fire once, pause can resume, and input remains stopped while paused', () => {
  const { left, right, actions, input, sources } = inputFixture();
  for (const [source, index, action] of [[right, 4, 'view'], [right, 5, 'pause'], [left, 4, 'reset'], [left, 5, 'exitVR'], [right, 3, 'recenterVR']]) {
    source.gamepad.buttons[index].value = 1;
    input.update(sources); input.update(sources);
    assert.equal(actions.at(-1), action);
    assert.equal(actions.filter(item => item === action).length, 1);
    source.gamepad.buttons[index].value = 0; input.update(sources);
  }
  right.gamepad.buttons[0].value = 1; input.update(sources, { paused: true });
  assert.deepEqual(input.state, {}); assert.ok(!actions.includes('drive'));
});

test('pause remains reachable with held driving controls, including left stick click', () => {
  const { left, right, actions, input, sources } = inputFixture();
  right.gamepad.buttons[0].value = 1; input.clear(); input.update(sources);
  left.gamepad.buttons[3].value = 1; input.update(sources); input.update(sources);
  assert.deepEqual(actions, ['pause']); assert.deepEqual(input.state, {});
  left.gamepad.buttons[3].value = 0; input.update(sources, { paused: true });
  right.gamepad.buttons[5].value = 1; input.update(sources, { paused: true });
  assert.deepEqual(actions, ['pause', 'pause']);
});

test('paused XR stick and A operate menus without driving or changing camera', () => {
  const { left, right, actions, input, sources } = inputFixture();
  left.gamepad.axes[3] = 1; input.update(sources, { paused: true }); input.update(sources, { paused: true });
  left.gamepad.axes[3] = 0; input.update(sources, { paused: true });
  left.gamepad.axes[3] = -1; input.update(sources, { paused: true });
  left.gamepad.axes[3] = 0; right.gamepad.buttons[4].value = 1;
  input.update(sources, { paused: true }); input.update(sources, { paused: true });
  assert.deepEqual(actions, ['vrMenuNext', 'vrMenuPrevious', 'vrMenuConfirm']);
  assert.deepEqual(input.state, {});
});

test('VR rig stays upright when entering or recentering with a tilted head on hills', () => {
  const source = new THREE.PerspectiveCamera(), rig = new XRCameraRig();
  const up = new THREE.Vector3(0, 1, 0);
  for (const pitch of [-.8, -.3, .2]) {
    source.quaternion.setFromEuler(new THREE.Euler(pitch, 1.2, .1, 'YXZ'));
    const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.4, .7, .25, 'YXZ'));
    const pose = { transform: { position: new THREE.Vector3(0, 1.6, 0), orientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w } } };
    rig.recenter(); rig.update(source, pose);
    assert.ok(up.clone().applyQuaternion(rig.rig.quaternion).distanceTo(up) < 1e-10);
    pose.transform.orientation = { x: 0, y: 0, z: 0, w: 1 }; rig.update(source, pose);
    const worldHead = rig.rig.quaternion.clone().multiply(new THREE.Quaternion().copy(pose.transform.orientation));
    assert.ok(up.clone().applyQuaternion(worldHead).distanceTo(up) < 1e-10, 'straightening your head restores a level horizon');
    const before = rig.rig.position.clone();
    pose.transform.position.y += .3; rig.update(source, pose);
    assert.ok(before.distanceTo(rig.rig.position) < 1e-10, 'standing up does not move the rig');
    assert.ok(new THREE.Vector3(0, .3, 0).applyQuaternion(rig.rig.quaternion).distanceTo(new THREE.Vector3(0, .3, 0)) < 1e-10);
  }
});

test('VR rig centers initial pose, preserves later head motion and follows origin shifts', () => {
  const source = new THREE.PerspectiveCamera(45, 1, .1, 1200);
  source.position.set(30, 8, -500); source.lookAt(30, 0, -515);
  const rig = new XRCameraRig();
  const pose = { transform: { position: new THREE.Vector3(1, 1.7, .5), orientation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .4) } };
  rig.update(source, pose);
  const world = pose.transform.position.clone().applyMatrix4(rig.rig.matrixWorld);
  assert.ok(world.distanceTo(source.position) < 1e-10);
  const rotation = rig.rig.quaternion.clone().multiply(pose.transform.orientation);
  const sourceYaw = new THREE.Euler().setFromQuaternion(source.quaternion, 'YXZ').y;
  assert.ok(rotation.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sourceYaw)) < 1e-7);
  const start = rig.rig.position.clone();
  pose.transform.position.x += .2; rig.update(source, pose);
  assert.ok(start.distanceTo(rig.rig.position) < 1e-10, 'head translation is not canceled each frame');
  source.position.z += 1024; rig.update(source, pose);
  assert.ok(Math.abs(rig.rig.position.z - start.z - 1024) < 1e-10);
  rig.recenter(); rig.update(source, pose);
  assert.ok(pose.transform.position.clone().applyMatrix4(rig.rig.matrixWorld).distanceTo(source.position) < 1e-10);
});

test('overhead VR retains each view framing without mutating the desktop camera', () => {
  const rig = new XRCameraRig(), direction = new THREE.Vector3();
  const camera = new THREE.OrthographicCamera(-80, 80, 82.5, -82.5, 1, 1200);
  const focus = new THREE.Vector3(-24, 0, -46), offset = new THREE.Vector3(-220, 245, 260);
  camera.position.copy(focus).add(offset); camera.lookAt(focus); camera.userData.focusDistance = offset.length();
  const before = camera.position.clone();
  for (const height of [235, 165, 115, 75]) {
    camera.top = height / 2; camera.bottom = -height / 2;
    rig.update(camera);
    const distance = height / (2 * Math.tan(Math.PI / 6));
    camera.getWorldDirection(direction);
    assert.ok(rig.rig.position.clone().addScaledVector(direction, distance).distanceTo(focus) < 1e-9);
    assert.ok(camera.position.equals(before));
  }
});

function sessionFixture({ supported = true, secure = true, userAgent = 'Quest', failRequest = false, failSetup = false } = {}) {
  const events = [], session = new EventTarget(), button = new EventTarget();
  Object.assign(session, { visibilityState: 'visible', end: async () => session.dispatchEvent(new Event('end')) });
  button.setAttribute = () => {};
  const xr = { enabled: false, setReferenceSpaceType() {}, setFramebufferScaleFactor() {}, setFoveation() {}, async setSession() { if (failSetup) throw new Error('setup failed'); } };
  let requested = 0;
  const navigator = { userAgent, xr: { async isSessionSupported(mode) { assert.equal(mode, 'immersive-vr'); return supported; }, async requestSession(mode, options) { requested++; assert.equal(mode, 'immersive-vr'); assert.deepEqual(options.requiredFeatures, ['local']); if (failRequest) throw new Error('denied'); return session; } } };
  const vr = new BrowserVR({ renderer: { xr }, buttons: [button], secure, navigator, onStart: () => events.push('start'), onEnd: () => events.push('end'), onVisibility: visible => events.push(visible), onError: () => events.push('error') });
  return { vr, session, button, events, get requested() { return requested; } };
}

test('VR support detection hides unsupported, insecure and Electron entry', async () => {
  for (const options of [{ supported: false }, { secure: false }, { userAgent: 'Chrome Electron/44.0' }]) {
    const fixture = sessionFixture(options); await fixture.vr.detect(); await fixture.vr.toggle();
    assert.equal(fixture.vr.supported, false); assert.equal(fixture.requested, 0);
  }
});

test('VR sessions handle visibility, exit, reentry and duplicate entry requests', async () => {
  const fixture = sessionFixture(); const { vr, session, events, button } = fixture;
  await vr.detect(); assert.equal(button.hidden, false);
  await Promise.all([vr.toggle(), vr.toggle()]); assert.equal(fixture.requested, 1);
  assert.equal(vr.active, true); assert.equal(button.textContent, 'Exit VR');
  session.visibilityState = 'visible-blurred'; session.dispatchEvent(new Event('visibilitychange'));
  assert.equal(vr.visible, false);
  session.visibilityState = 'visible'; session.dispatchEvent(new Event('visibilitychange'));
  await vr.toggle(); assert.equal(vr.active, false); assert.equal(button.textContent, 'Enter VR');
  await vr.toggle(); assert.equal(vr.active, true);
  assert.deepEqual(events, ['start', false, true, 'end', 'start']);
});

test('permission or renderer failure leaves VR retryable and ends a failed session', async () => {
  for (const options of [{ failRequest: true }, { failSetup: true }]) {
    const { vr, events, button } = sessionFixture(options);
    await vr.detect(); await vr.toggle();
    assert.equal(vr.active, false); assert.equal(vr.pending, false); assert.equal(button.disabled, false);
    assert.ok(events.includes('error')); assert.ok(!events.includes('start'));
    if (options.failSetup) assert.ok(events.includes('end'));
  }
});
