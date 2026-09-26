import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { XRInput } from '../src/xr-input.js';
import { XRCameraRig, ComfortVignette } from '../src/xr-camera.js';
import { BrowserVR } from '../src/vr.js';
import { VRStatus } from '../src/vr-status.js';

// The headset's panels draw on canvases. Node has none, so a stand-in
// measures every character 14 px wide and draws nothing.
globalThis.document ??= { createElement: () => {
  const ctx = new Proxy({ measureText: text => ({ width: String(text).length * 14 }) }, { get: (target, key) => target[key] ?? (() => {}), set: () => true });
  return { width: 0, height: 0, getContext: () => ctx };
} };
function panelFixture(model) {
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(), anchor = new THREE.Group();
  rig.add(camera, anchor); rig.updateMatrixWorld(true);
  const status = new VRStatus(camera, anchor);
  status.update(model);
  const label = () => status.entries[status.selected]?.label;
  return { rig, status, label };
}
const item = (label, extra) => ({ label, activate() { this.pressed = (this.pressed ?? 0) + 1; }, ...extra });
const pauseModel = () => ({ id: 'pause', title: 'Paused', columns: 2, items: [
  item('Resume', { primary: true, header: true }),
  item('Restart run', { group: 'Driving' }), item('Reset car', { group: 'Driving' }), item('City map', { group: 'The city' }),
  item('Camera', { column: 1, group: 'View' }), item('Graphics', { column: 1, group: 'View' }),
  item('Exit VR', { footer: true }),
] });

test('headset menus open on their main action and the stick walks rows and columns', () => {
  const { status, label } = panelFixture(pauseModel());
  assert.equal(label(), 'Resume', 'pausing and pressing A again resumes: it never restarts the run');
  status.move('vrMenuNext'); assert.equal(label(), 'Restart run');
  status.move('vrMenuNext'); status.move('vrMenuNext'); assert.equal(label(), 'City map');
  status.move('vrMenuNext'); assert.equal(label(), 'Camera', 'down the first column, then the second');
  status.move('vrMenuLeft'); assert.equal(label(), 'Restart run', 'sideways to the nearest row of the other column');
  status.move('vrMenuRight'); assert.equal(label(), 'Camera');
  status.move('vrMenuPrevious'); status.move('vrMenuPrevious'); status.move('vrMenuPrevious'); status.move('vrMenuPrevious');
  assert.equal(label(), 'Resume');
  status.move('vrMenuPrevious'); assert.equal(label(), 'Exit VR', 'the list wraps');
  status.activate(); assert.equal(status.entries[status.selected].pressed, 1);
  // A chooser opened from a row returns to that row when it closes.
  status.move('vrMenuNext'); status.move('vrMenuNext'); status.move('vrMenuNext'); status.move('vrMenuNext');
  assert.equal(label(), 'City map');
  status.update({ id: 'map', title: 'City map', items: [item('Back', { footer: true })] });
  status.update(pauseModel()); assert.equal(label(), 'City map');
  status.update(null); status.update(pauseModel()); assert.equal(label(), 'Resume', 'a fresh pause starts on Resume');
});

test('long headset lists page under group headings, and left or right at an edge turns the page', () => {
  const items = [...Array.from({ length: 13 }, (_, i) => item(`Paint ${i}`, { group: 'Paint', swatch: '#fff' })),
    ...Array.from({ length: 22 }, (_, i) => item(`Car ${i}`, { group: 'Cars', disabled: i === 3 })), item('Back', { footer: true })];
  const { status, label } = panelFixture({ id: 'car-dialog', title: 'Garage', flow: true, items });
  assert.equal(status.pages, 3);
  assert.deepEqual(status.flowPages.map(page => page.headings.map(heading => heading.text)), [['Paint'], ['Cars'], ['Cars']],
    'each page is headed by the group it shows');
  assert.ok(status.flowPages[0].rows.every(row => items[row.index].group === 'Paint'), 'the paints fill the first page');
  const height = status.menu.height;
  status.page(1); assert.equal(label(), 'Car 0'); assert.equal(status.pageIndex, 1);
  assert.equal(status.menu.height, height, 'every page is as tall, so the panel keeps still');
  status.page(1); status.page(1); assert.equal(status.pageIndex, 0, 'pages wrap');
  status.move('vrMenuLeft'); assert.equal(status.pageIndex, 2, 'left of the first column is the previous page');
  status.page(-1); status.move('vrMenuNext'); status.move('vrMenuNext'); status.move('vrMenuNext');
  assert.equal(label(), 'Car 4', 'disabled rows are passed over');
  assert.deepEqual(status.entries.filter(entry => entry.footer).map(entry => entry.label), ['Back', '‹ Previous', 'Next ›']);
});

test('pointing: a resting pointer leaves the selection alone, moving onto a row selects it, a held trigger must be released', () => {
  const model = { id: 'title', title: 'citydriver', items: [item('Start run', { primary: true }), item('Free drive'), item('Exit VR')] };
  const { rig, status, label } = panelFixture(model);
  const source = { handedness: 'right', targetRaySpace: {}, gamepad: { buttons: [{ value: 0 }] } };
  let aim = new THREE.Matrix4();
  const frame = { session: { inputSources: [source] }, getPose: () => ({ transform: { matrix: aim.elements } }) };
  const point = row => {
    const mesh = status.menu.mesh, region = status.regions.find(region => status.entries[region.index].label === row);
    mesh.updateWorldMatrix(true, false);
    const target = new THREE.Vector3((region.x + region.width / 2) / status.menu.width - .5, .5 - (region.y + region.height / 2) / status.menu.height, 0).applyMatrix4(mesh.matrixWorld);
    const hand = new THREE.Vector3(.2, -.3, -.2);
    aim = new THREE.Matrix4().lookAt(hand, target, new THREE.Vector3(0, 1, 0)).setPosition(hand);
    status.point(frame, null, rig, true);
  };
  point('Free drive');
  assert.equal(label(), 'Start run', 'a pointer resting on the panel as it opens does not move the selection');
  point('Exit VR'); assert.equal(label(), 'Exit VR', 'moving onto a row selects it');
  point('Free drive'); assert.equal(label(), 'Free drive');
  assert.ok(status.rays[0].ray.visible && status.rays[0].cursor.visible);
  source.gamepad.buttons[0].value = 1; point('Free drive'); source.gamepad.buttons[0].value = 0; point('Free drive');
  assert.equal(model.items[1].pressed, 1, 'a pull of the trigger presses the row pointed at');
  // A new menu under a trigger already held (the gas pedal) waits for a release.
  status.update(null);
  const results = { id: 'taxi-results', title: 'Time up', items: [item('Play again', { primary: true }), item('Free drive')] };
  source.gamepad.buttons[0].value = 1; status.update(results); point('Free drive');
  assert.equal(results.items[1].pressed, undefined);
  source.gamepad.buttons[0].value = 0; point('Free drive'); source.gamepad.buttons[0].value = 1; point('Free drive');
  assert.equal(results.items[1].pressed, 1);
  // The driving HUD is only read: nothing can be pressed on it.
  status.update(null); status.hud({ heading: 'N', place: 'Downtown', weather: 'Day' });
  source.gamepad.buttons[0].value = 0; status.point(frame, null, rig, true); source.gamepad.buttons[0].value = 1; status.point(frame, null, rig, true);
  assert.equal(status.rays[0].ray.visible, false);
  assert.ok(status.hudPanel.mesh.visible);
});

test('menus open in front of wherever the player is looking, level and a little low', () => {
  for (const yaw of [0, .9, -2]) {
    const { rig, status } = panelFixture({ id: 'pause', title: 'Paused', items: [item('Resume')] });
    const camera = status.camera;
    camera.position.set(.1, .2, .05); camera.rotation.set(-.3, yaw, 0, 'YXZ'); rig.updateMatrixWorld(true);
    status.point({ session: { inputSources: [] } }, null, rig, true);
    const panel = status.menu.mesh.getWorldPosition(new THREE.Vector3()), eye = camera.getWorldPosition(new THREE.Vector3());
    const offset = panel.sub(eye);
    assert.ok(Math.abs(Math.sin(Math.atan2(-offset.x, -offset.z) - yaw)) < 1e-6, 'in front of the head, whatever its pitch');
    const drop = Math.atan2(-offset.y, Math.hypot(offset.x, offset.z)) * 180 / Math.PI;
    assert.ok(drop > 2 && drop < 10, `${drop.toFixed(1)} degrees below the eyes`);
    assert.ok(Math.abs(offset.length() - 1.5) < .01);
  }
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
  // The grips are the pad's bumpers: left drifts, right boosts.
  left.gamepad.buttons[1].value = 1; input.update(sources);
  assert.equal(input.state.handbrake, true); assert.equal(input.state.boost, false);
  left.gamepad.buttons[1].value = 0; right.gamepad.buttons[1].value = 1; input.update(sources);
  assert.equal(input.state.handbrake, false); assert.equal(input.state.boost, true);
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
  // Y pauses as B does: no single press leaves the headset.
  for (const [source, index, action] of [[right, 4, 'view'], [right, 5, 'pause'], [left, 4, 'reset'], [left, 5, 'pause'], [right, 3, 'recenterVR']]) {
    source.gamepad.buttons[index].value = 1;
    const before = actions.length;
    input.update(sources); input.update(sources);
    assert.deepEqual(actions.slice(before), [action], 'one action per press, however long it is held');
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

test('putting the controllers down pauses a drive, but not a menu or a blurred session', () => {
  const { right, actions, input, sources } = inputFixture();
  input.update([]); assert.deepEqual(actions, ['pause']);
  input.update(sources); input.update([{ handedness: 'right', hand: {}, gamepad: { mapping: '', axes: [], buttons: [{ value: 0 }] } }]);
  assert.deepEqual(actions, ['pause', 'pause'], 'hands are not controllers');
  input.update(sources); input.update([], { paused: true });
  input.update(sources); input.update([], { blocked: true });
  assert.equal(actions.length, 2);
  right.gamepad.buttons[0].value = 1; input.update(sources); assert.deepEqual(input.state, {}, 'picked up again, the gas must be released first');
});

test('either stick walks a menu, sideways crosses columns, and X selects rather than resets', () => {
  const { left, right, actions, input, sources } = inputFixture();
  const step = (pad, axis, value) => { pad.axes[axis] = value; input.update(sources, { paused: true }); pad.axes[axis] = 0; input.update(sources, { paused: true }); };
  step(right.gamepad, 3, 1); step(right.gamepad, 2, 1); step(left.gamepad, 2, -1);
  left.gamepad.buttons[4].value = 1; input.update(sources, { paused: true });
  left.gamepad.buttons[4].value = 0; input.update(sources, { paused: true });
  assert.deepEqual(actions, ['vrMenuNext', 'vrMenuRight', 'vrMenuLeft', 'vrMenuConfirm']);
  assert.ok(!actions.includes('reset'), 'a menu is no place for a stray reset');
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

test('panels hang from an anchor that follows the game camera with yaw only', () => {
  const source = new THREE.PerspectiveCamera(), rig = new XRCameraRig();
  source.position.set(40, 7, -300); source.quaternion.setFromEuler(new THREE.Euler(-.25, .8, .05, 'YXZ'));
  const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -.6);
  const pose = { transform: { position: new THREE.Vector3(.3, .1, -.2), orientation } };
  rig.update(source, pose);
  const anchor = rig.anchor.getWorldPosition(new THREE.Vector3()), turn = rig.anchor.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(anchor.distanceTo(source.position) < 1e-9, 'where the recentred head is');
  assert.ok(turn.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .8)) < 1e-6, 'facing the camera\'s way, level');
});

test('the comfort vignette closes in while the camera turns, eases off after, and can be switched off', () => {
  const camera = new THREE.PerspectiveCamera(), source = new THREE.Object3D(), vignette = new ComfortVignette(camera);
  const run = (seconds, rate, options = {}) => {
    for (let t = 0; t < seconds; t += 1 / 72) { source.rotation.y += rate / 72; source.updateMatrixWorld(); vignette.update(source, 20, 1 / 72, options.active ?? true); }
  };
  run(.5, .1); assert.equal(vignette.mesh.visible, false, 'a gentle curve leaves the view alone');
  run(.6, 1.6); assert.ok(vignette.amount > .6 && vignette.mesh.visible, `a hard turn closes it in (${vignette.amount.toFixed(2)})`);
  const narrow = vignette.mesh.scale.x;
  assert.ok(Math.atan(narrow / vignette.distance) > .5, 'the middle of the view stays clear');
  run(2, 0); assert.equal(vignette.mesh.visible, false, 'straight again, it has gone');
  run(.6, 1.6, { active: false }); assert.equal(vignette.mesh.visible, false, 'never while paused or in a menu');
  vignette.enabled = false; run(.6, 1.6); assert.equal(vignette.mesh.visible, false);
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
