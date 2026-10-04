import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sightLine } from '../src/collision.js';
import { ThirdPersonCamera } from '../src/third-person-camera.js';
import { touchDrivingInput, thirdPersonDrivingInput } from '../src/touch-stick.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute, nearestLanePose } from '../src/world/city-route.js';
import { fitSunShadow } from '../src/shadows.js';

test('third-person view stays behind the car, frames it on phones, and survives origin shifts', () => {
  for (const aspect of [390 / 844, 844 / 390, 16 / 9]) for (const heading of [-3, 0, 2]) {
    const car = new DrivingController(); car.heading = heading; car.update(0, {});
    const rig = new ThirdPersonCamera(); rig.resize(aspect); rig.update(car.car, 0);
    const forward = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
    assert.ok(rig.camera.position.clone().sub(car.car.position).dot(forward) < -13.9);
    const projected = car.car.position.clone().project(rig.camera);
    assert.ok(Math.abs(projected.x) < .01 && projected.y > -.8 && projected.y < 0);
    car.render(0, 20000); rig.update(car.car, 1 / 60);
    assert.ok(projected.distanceTo(car.car.position.clone().project(rig.camera)) < 1e-9);
  }
});

test('perspective joystick follows all screen directions through the city and after rebasing', () => {
  const directions = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const route of [citydriverRoute]) {
    for (const aspect of [390 / 844, 844 / 390]) for (const s of [24, 148, 420, 20025]) {
      for (const [x, y] of directions) {
        // In a lane near there, clear of curbs and quays
        const lane = nearestLanePose(s, 0), car = new DrivingController(route, { s: lane.s, u: lane.u });
        const origin = Math.floor(s / 1024) * 1024;
        car.render(0, origin);
        const rig = new ThirdPersonCamera(); rig.resize(aspect); rig.update(car.car, 0);
        // Also exercise an off-center car, where perspective depth matters.
        rig.camera.position.x += 1;
        rig.camera.updateMatrixWorld();
        const before = car.car.position.clone().project(rig.camera), length = Math.hypot(x, y);
        const input = touchDrivingInput({ x: x / length, y: y / length }, rig.camera, route, car.s, car.u, origin);
        car.update(1 / 60, { touchDrive: input }); car.render(0, origin);
        const after = car.car.position.clone().project(rig.camera);
        const dx = (after.x - before.x) * aspect, dy = after.y - before.y;
        const alignment = (dx * x + dy * y) / (Math.hypot(dx, dy) * length);
        assert.ok(alignment > .999, `screen ${x},${y} at ${s}: ${alignment}`);
      }
    }
  }
});

test('third-person joystick steers gradually while the camera follows, and release stops', () => {
  const car = new DrivingController();
  const rig = new ThirdPersonCamera(); rig.resize(390 / 844); rig.update(car.car, 0);
  const heading = car.heading;
  for (let i = 0; i < 90; i++) {
    const before = car.heading;
    car.update(1 / 60, thirdPersonDrivingInput({ x: .6, y: .8 }));
    rig.update(car.car, 1 / 60);
    assert.ok(Math.abs(car.heading - before) < .04, 'steering must not snap the car to a new heading');
  }
  assert.ok(car.speed > 1);
  assert.ok(car.heading - heading > .2, 'right turns the car right');
  assert.ok(rig.heading - heading > .1, 'camera follows before the stick is released');
  for (let i = 0; i < 120; i++) {
    car.update(1 / 60, thirdPersonDrivingInput({ x: 0, y: 0 })); rig.update(car.car, 1 / 60);
    assert.ok(car.speed >= 0);
  }
  assert.equal(car.speed, 0);
  assert.ok(Math.cos(rig.heading - car.heading) > .999);
  car.heading = 1.2; car.update(0, {}); rig.snap(); rig.update(car.car, 0);
  assert.ok(Math.abs(rig.heading - car.heading) < 1e-9);
});

test('third-person down brakes before reversing without turning the car around', () => {
  for (const route of [citydriverRoute]) {
    const car = new DrivingController(route);
    car.speed = 5;
    const heading = car.heading;
    car.update(1 / 60, thirdPersonDrivingInput({ x: 0, y: -1 }));
    assert.ok(car.speed > 0 && car.speed < 5);
    for (let i = 0; i < 60; i++) car.update(1 / 60, thirdPersonDrivingInput({ x: 0, y: -1 }));
    assert.ok(car.speed < -1);
    assert.ok(Math.cos(car.heading - heading) > .99);
    for (let i = 0; i < 60; i++) {
      car.update(1 / 60, thirdPersonDrivingInput({ x: 0, y: 0 }));
      assert.ok(car.speed <= 0);
    }
    assert.equal(car.speed, 0);
  }
});

test('camera eases through U-turns at a bounded speed across frame rates', () => {
  const samples = [];
  for (const fps of [30, 60, 120]) {
    const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
    rig.update(car, 0); car.rotation.y = -Math.PI;
    let previousStep = 0;
    for (let i = 0; i < fps * 4; i++) {
      const before = rig.heading;
      rig.update(car, 1 / fps);
      const step = rig.heading - before;
      assert.ok(step >= 0 && step * fps < 2.2, 'no whip-around or overshoot');
      if (i === 0) assert.ok(step < .02, 'ease into the orbit');
      assert.ok(Math.abs(step - previousStep) * fps < 1, 'smooth changes in angular speed');
      previousStep = step;
      if (i === fps - 1) samples.push(rig.heading);
    }
    assert.ok(Math.abs(rig.heading - Math.PI) < .001);
    // Cross the angle seam by the short path, then reset during a turn.
    car.rotation.y = Math.PI - .1;
    rig.update(car, 1 / fps);
    assert.ok(rig.heading > Math.PI - .001);
    rig.snap(); rig.update(car, 0);
    const snapped = rig.heading;
    rig.update(car, 1 / fps);
    assert.equal(rig.heading, snapped);
  }
  assert.ok(Math.max(...samples) - Math.min(...samples) < .04);
});

test('third-person camera softens terrain bumps and keeps the horizon level', () => {
  const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
  rig.update(car, 0);
  const height = rig.camera.position.y;
  car.position.y = .5; car.rotation.x = .4; car.rotation.z = .3;
  rig.update(car, 1 / 60);
  assert.ok(Math.abs(rig.camera.position.y - height) < .1);
  assert.ok(Math.abs(rig.pitch) < .01);
  for (let i = 0; i < 240; i++) rig.update(car, 1 / 60);
  assert.ok(Math.abs(rig.pitch - .18) < .001);
  assert.ok(Math.abs(rig.camera.matrixWorld.elements[1]) < 1e-9, 'car roll does not tilt the horizon');
});

test('chase view responds to small corrections quickly and shows the travel direction in a slide', () => {
  const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
  rig.update(car, 0); car.rotation.y = -.3;
  for (let i = 0; i < 24; i++) rig.update(car, 1 / 120);
  assert.ok(rig.heading > .17, 'camera should follow over half a small turn within 200 ms');
  car.rotation.y = -1; car.userData.slip = .4;
  for (let i = 0; i < 240; i++) rig.update(car, 1 / 120);
  assert.ok(rig.heading > .6 && rig.heading < .85, 'view points between chassis and travel heading');
  car.userData.slip = 0;
  for (let i = 0; i < 120; i++) rig.update(car, 1 / 120);
  assert.ok(Math.abs(rig.heading - 1) < .002, 'recovery returns the view behind the car');
});

test('perspective shadows cover nearby receivers without changing the camera projection', () => {
  for (const aspect of [390 / 844, 844 / 390]) {
    const rig = new ThirdPersonCamera(), car = new DrivingController();
    rig.resize(aspect); rig.update(car.car, 0);
    const sun = new THREE.DirectionalLight();
    sun.position.copy(car.car.position).add(new THREE.Vector3(-145, 230, 95));
    sun.target.position.copy(car.car.position);
    const projection = rig.camera.projectionMatrix.clone();
    fitSunShadow(rig.camera, sun);
    assert.deepEqual(rig.camera.projectionMatrix.elements, projection.elements);
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
      const point = new THREE.Vector3(x, y, 1).unproject(rig.camera);
      point.sub(rig.camera.position).multiplyScalar(90 / rig.camera.far).add(rig.camera.position);
      point.project(sun.shadow.camera);
      assert.ok(Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) < 1);
    }
  }
});

test('a building in the way brings the chase camera in along its line to the car at once, and lets it out gently', () => {
  const car = new THREE.Object3D(), rig = new ThirdPersonCamera(), free = new ThirdPersonCamera();
  car.rotation.y = -.7;
  let open = .4;
  rig.sight = (from, to) => {
    assert.ok(Math.hypot(from.x - car.position.x, from.z - car.position.z) < 1e-9 && from.y > car.position.y + 1, 'the line starts over the car');
    assert.ok(to.distanceTo(free.camera.position) < 1e-9, 'and ends where the camera would stand');
    return open;
  };
  free.update(car, 0); rig.update(car, 0);
  const along = t => rig.pivot.clone().lerp(free.camera.position, t), line = rig.pivot.distanceTo(free.camera.position);
  assert.ok(rig.camera.position.distanceTo(along(.4)) < 1e-9);
  assert.equal(rig.camera.userData.jump, 0, 'a snap is no jump');
  // The view clears: out over a second or two, a little at a time
  open = 1;
  let previous = .4;
  for (let i = 0; i < 60; i++) {
    free.update(car, 1 / 60); rig.update(car, 1 / 60);
    assert.ok(rig.reach > previous && rig.reach - previous < .04);
    assert.ok(Math.abs(rig.camera.userData.glide - (rig.reach - previous) * line * 60) < 1e-6, 'the headset hears how fast it glides');
    previous = rig.reach;
  }
  assert.ok(rig.reach > .9 && rig.reach < 1);
  // Something new in the way pulls it straight back in
  open = .3; free.update(car, 1 / 60); const reached = rig.reach; rig.update(car, 1 / 60);
  assert.ok(rig.camera.position.distanceTo(along(.3)) < 1e-9);
  assert.ok(Math.abs(rig.camera.userData.jump - (reached - .3) * line) < 1e-6 && rig.camera.userData.glide === 0, 'and how far it jumped');
  // Once clear it ends exactly where it stands without the check
  open = 1;
  for (let i = 0; i < 300; i++) { free.update(car, 1 / 60); rig.update(car, 1 / 60); }
  assert.equal(rig.reach, 1);
  assert.ok(rig.camera.position.distanceTo(free.camera.position) < 1e-9);
  // A snap (a reset, a new view) goes straight to wherever is clear
  open = .5; rig.update(car, 1 / 60); open = 1; rig.snap(); rig.update(car, 0);
  assert.equal(rig.reach, 1);
});

// Where a point is on screen, leaving out its depth
const onScreen = (point, camera) => { const p = point.clone().project(camera); return new THREE.Vector2(p.x, p.y); };

test('the mouse turns the chase camera round the car, which keeps its place in the frame', () => {
  const car = new THREE.Object3D(), rig = new ThirdPersonCamera(), free = new ThirdPersonCamera();
  rig.resize(16 / 9); free.resize(16 / 9); rig.update(car, 0); free.update(car, 0);
  const framed = onScreen(rig.pivot, rig.camera), height = rig.camera.position.y;
  // A quarter turn to the right and a tilt up: the camera stands off the car's left, looking down on it
  rig.look(Math.PI / 2, .5); rig.update(car, 1 / 60);
  assert.ok(rig.camera.position.x < -10 && Math.abs(rig.camera.position.z) < 1e-9);
  assert.ok(rig.camera.position.y > height + 5);
  assert.ok(onScreen(rig.pivot, rig.camera).distanceTo(framed) < 1e-9, 'the point over its roof stays put');
  // Tilts stop short of under the car and straight over it
  rig.look(0, -5); assert.ok(rig.lookPitch > -.3);
  rig.look(0, 10); assert.ok(rig.lookPitch < 1.1);
  // Standing still, it stays where it was put
  const turned = [rig.lookYaw, rig.lookPitch];
  for (let i = 0; i < 300; i++) { rig.update(car, 1 / 60); free.update(car, 1 / 60); }
  assert.deepEqual([rig.lookYaw, rig.lookPitch], turned);
  // Moving, it waits for the mouse to rest, then swings back behind, the short way round
  car.userData.speed = 10; rig.look(Math.PI * .6, 0);
  for (let i = 0; i < 60; i++) { rig.update(car, 1 / 60); free.update(car, 1 / 60); }
  assert.ok(Math.abs(rig.lookYaw + Math.PI * .9) < 1e-9, 'still turned a second after the mouse rests');
  let previous = Math.abs(rig.lookYaw);
  for (let i = 0; i < 300; i++) {
    rig.update(car, 1 / 60); free.update(car, 1 / 60);
    assert.ok(Math.abs(rig.lookYaw) <= previous); previous = Math.abs(rig.lookYaw);
  }
  assert.equal(rig.lookYaw, 0); assert.equal(rig.lookPitch, 0);
  assert.equal(rig.camera.position.distanceTo(free.camera.position), 0, 'exactly where it stands untouched');
  // A reset or a new view puts it straight back
  rig.look(2, .4); rig.snap(); rig.update(car, 0);
  assert.equal(rig.lookYaw, 0); assert.equal(rig.lookPitch, 0);
});

test('the wheel brings the chase camera nearer or farther within limits, and a reset keeps the distance', () => {
  const car = new THREE.Object3D(), rig = new ThirdPersonCamera(), free = new ThirdPersonCamera();
  rig.resize(16 / 9); rig.update(car, 0); free.update(car, 0);
  const framed = onScreen(rig.pivot, rig.camera), out = free.camera.position.distanceTo(free.pivot);
  rig.zoomBy(.5); rig.update(car, 1 / 60);
  assert.ok(rig.zoom > .5 && rig.zoom < 1, 'it eases in');
  for (let i = 0; i < 120; i++) rig.update(car, 1 / 60);
  assert.equal(rig.zoom, .5);
  assert.ok(Math.abs(rig.camera.position.distanceTo(rig.pivot) - out / 2) < 1e-9);
  assert.ok(onScreen(rig.pivot, rig.camera).distanceTo(framed) < 1e-9);
  rig.zoomBy(100); assert.equal(rig.zoomTarget, 6);
  rig.zoomBy(1e-3); assert.equal(rig.zoomTarget, .45);
  rig.snap(); rig.update(car, 0);
  assert.equal(rig.zoom, .45);
});

test('turned down low or zoomed out, the chase camera stays over the ground under it', () => {
  const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
  // A quay 3 m up off to the car's left
  rig.ground = x => x < -6 ? 3 : 0;
  rig.update(car, 0); rig.zoomBy(6);
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    rig.snap(); rig.look(yaw, -1);
    for (let i = 0; i < 60; i++) {
      rig.update(car, 1 / 60);
      assert.ok(rig.camera.position.y >= rig.ground(rig.camera.position.x) + .6 - 1e-9);
    }
  }
  // (and where the ground does not reach it, it is left alone)
  rig.snap(); rig.update(car, 0);
  const free = new ThirdPersonCamera(); free.zoomBy(6); free.update(car, 0);
  assert.equal(rig.camera.position.distanceTo(free.camera.position), 0);
});

test('zoomed-out cameras preserve depth separation for thin road details', () => {
  for (const flying of [false, true]) {
    const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
    car.position.y = flying ? 124 : 24;
    car.userData.chaseDip = flying ? 1 : 0;
    rig.ground = () => 24; rig.resize(16 / 9); rig.update(car, 0);
    assert.equal(rig.camera.near, flying ? 1 : .1);
    rig.zoomBy(6); rig.snap(); rig.look(0, .4); rig.update(car, 0);
    const camera = rig.camera, asphalt = new THREE.Vector3(0, 24, -200), patch = asphalt.clone();
    patch.y += .007;
    const depthSteps = () => Math.abs(asphalt.clone().project(camera).z - patch.clone().project(camera).z) * .5 * (2 ** 24 - 1);
    const improved = depthSteps(), near = camera.near;
    assert.ok(improved > 2, `7 mm layers stay several depth steps apart: ${improved}`);
    camera.near = flying ? 1 : .1; camera.updateProjectionMatrix();
    assert.ok(improved > depthSteps() * 3, 'zoom improves on the old flight-only precision');
    camera.near = near; camera.updateProjectionMatrix();
    rig.zoomBy(1 / 6); rig.snap(); rig.update(car, 0);
    assert.equal(camera.near, flying ? 1 : .1, 'zooming back restores the close view');
  }
});

test('camera depth precision respects sudden wall pull-ins, ground and bridge clearance', () => {
  const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
  rig.ground = () => 0; rig.zoomBy(6); rig.update(car, 0);
  assert.ok(rig.camera.near > 2);
  rig.sight = () => .01; rig.update(car, 1 / 60);
  assert.equal(rig.camera.near, .1, 'a wall restores close clipping in the same frame');
  rig.sight = null; rig.snap(); rig.look(0, -1); rig.update(car, 0);
  assert.ok(rig.camera.near <= rig.camera.position.y * .5 + 1e-9, 'the ground stays outside the near plane');
  car.userData.lid = 5; rig.snap(); rig.update(car, 0);
  assert.ok(rig.camera.near <= (5 - rig.camera.position.y) * .5 + 1e-9, 'a bridge lid stays outside the near plane');
});

test('zooming against a fixed wall keeps the camera at the available distance', () => {
  for (const fps of [30, 60, 120]) {
    const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
    let available = 10;
    rig.sight = (from, to) => Math.min(1, available / from.distanceTo(to));
    rig.zoomBy(6); rig.update(car, 0);
    for (const factor of [1 / 6, 6]) {
      rig.zoomBy(factor);
      for (let i = 0; i < fps * 2; i++) {
        rig.update(car, 1 / fps);
        assert.ok(Math.abs(rig.camera.position.distanceTo(rig.pivot) - 10) < 1e-9);
        assert.ok(rig.camera.userData.jump < 1e-9 && rig.camera.userData.glide < 1e-9, 'zooming against the wall does not trigger VR comfort');
      }
    }
    available = 4; rig.update(car, 1 / fps);
    assert.ok(Math.abs(rig.camera.position.distanceTo(rig.pivot) - 4) < 1e-9);
    assert.ok(Math.abs(rig.camera.userData.jump - 6) < 1e-9, 'a newly closer wall still pulls in immediately');
    available = 10; rig.update(car, 1 / fps);
    assert.ok(rig.reachDistance > 4 && rig.reachDistance < 5, 'clearing a wall still eases out');
    rig.zoomBy(.45 / 6); rig.snap(); rig.update(car, 0);
    assert.equal(rig.reach, 1, 'a zoom closer than the wall is unrestricted');
    assert.equal(rig.camera.userData.jump, 0, 'a reset is not a collision');
    rig.zoomBy(6 / .45);
    for (let i = 0; i < fps * 2; i++) {
      rig.update(car, 1 / fps);
      assert.ok(rig.camera.userData.jump < 1e-9, 'zooming outward until it meets a wall is not a collision jump');
    }
  }
});

test('walking keeps a chosen camera tilt, while driving still recenters it', () => {
  const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
  Object.assign(car.userData, { leash: true, chaseScale: .36, speed: 4.4, velocity: { x: 0, z: -4.4 } });
  rig.update(car, 0); rig.look(.4, .6);
  for (let i = 0; i < 300; i++) rig.update(car, 1 / 60);
  assert.equal(rig.lookPitch, .6, 'walking leaves the chosen tilt alone');
  car.userData.leash = false;
  for (let i = 0; i < 300; i++) rig.update(car, 1 / 60);
  assert.equal(rig.lookPitch, 0, 'a moving vehicle still recenters');
});

test('collision pull-ins keep the same framing as zoom and recover smoothly at every frame rate', () => {
  for (const fps of [30, 60, 120]) {
    const rig = new ThirdPersonCamera(), car = new THREE.Object3D();
    rig.resize(16 / 9); rig.zoomBy(3); rig.update(car, 0);
    const framed = onScreen(rig.pivot, rig.camera);
    let available = 6;
    rig.sight = (from, to) => Math.min(1, available / from.distanceTo(to));
    for (let i = 0; i < fps * 2; i++) {
      if (i === fps) available = 100;
      rig.update(car, 1 / fps);
      assert.ok(onScreen(rig.pivot, rig.camera).distanceTo(framed) < 1e-9);
    }
  }
});

test('scrolling keeps the chosen orbit while adjusting the view, then normal recentering resumes', () => {
  const rig = new ThirdPersonCamera(), car = new THREE.Object3D();
  car.userData.speed = 10; rig.update(car, 0); rig.look(1, .4);
  for (let i = 0; i < 180; i++) {
    if (i % 30 === 0) rig.zoomBy(1.02);
    rig.update(car, 1 / 60);
    assert.equal(rig.lookYaw, 1); assert.equal(rig.lookPitch, .4);
  }
  for (let i = 0; i < 300; i++) rig.update(car, 1 / 60);
  assert.equal(rig.lookYaw, 0); assert.equal(rig.lookPitch, 0);
});

test('recenter settles a stationary camera without changing zoom or bypassing an obstruction, and new look cancels it', () => {
  for (const fps of [30, 60, 120]) for (const leash of [false, true]) {
    const rig = new ThirdPersonCamera(), car = new THREE.Object3D(); car.userData.leash = leash;
    rig.setZoom(3); rig.sight = (from, to) => Math.min(1, 5 / from.distanceTo(to));
    rig.update(car, 0); rig.look(1.3, .6); rig.update(car, 1 / fps); rig.recenter(car);
    for (let i = 0; i < fps * 2; i++) {
      rig.update(car, 1 / fps);
      assert.ok(rig.camera.position.distanceTo(rig.pivot) <= 5 + 1e-6, 'recenter always respects the wall');
    }
    assert.equal(rig.zoomTarget, 3); assert.equal(rig.zoom, 3);
    assert.ok(Math.abs(rig.heading) < 1e-4 && rig.lookYaw === 0 && rig.lookPitch === 0);
    rig.look(1, .4); rig.recenter(car); rig.update(car, 1 / fps); rig.look(.2, 0);
    assert.equal(rig.centering, false);
    rig.recenter(car, true); assert.equal(rig.centering, false); assert.equal(rig.lookYaw, 0);
  }
});

const cameraWall = top => ({ collisionBounds: { minX: -5, maxX: 5, minZ: 8, maxZ: 24 }, features: { colliders: [
  { x: 0, z: 16, reach: 10, top, corners: [{ x: -5, z: 8 }, { x: 5, z: 8 }, { x: 5, z: 24 }, { x: -5, z: 24 }] },
] } });
test('a bridge clamp checks the low sight line instead of moving a previously clear lens into a building', () => {
  const rig = new ThirdPersonCamera(), car = new THREE.Object3D(), chunks = [cameraWall(6)];
  car.userData.lid = 5;
  rig.sight = (from, to) => sightLine(chunks, from, to);
  rig.setZoom(6); rig.look(0, .8); rig.update(car, 0);
  assert.ok(rig.camera.position.y <= 4.5);
  assert.ok(rig.camera.position.z <= 5.8 + 1e-8, 'ceiling cannot lower the lens through a wall');
});

test('pulling onto a raised verge retains ground clearance without crossing the nearby wall', () => {
  const rig = new ThirdPersonCamera(), car = new THREE.Object3D();
  rig.ground = (x, z) => z > 4 ? 7 : 0;
  rig.sight = (from, to) => sightLine([cameraWall(20)], from, to);
  rig.update(car, 0);
  assert.ok(rig.camera.position.y >= 7.6 - 1e-9);
  assert.ok(rig.camera.position.z <= 5.8 + 1e-9);
});

test('reversing toward a wall and changing vehicle framing stays outside it at different frame rates', () => {
  for (const fps of [30, 60, 120]) {
    const rig = new ThirdPersonCamera(), car = new THREE.Object3D();
    rig.sight = (from, to) => sightLine([cameraWall(30)], from, to);
    rig.update(car, 0);
    for (let i = 0; i < fps * 4; i++) {
      const time = i / fps;
      car.position.z = time < 2 ? time * 3.4 : (4 - time) * 3.4;
      if (i === fps * 2) { car.userData.chaseLift = 2.2; car.userData.chaseScale = 1.2; }
      rig.update(car, 1 / fps);
      assert.ok(rig.camera.position.z <= 7.5 + 1e-7, 'camera never crosses the wall clearance');
      assert.ok(Number.isFinite(rig.camera.position.y));
    }
  }
});

test('wide and zoomed chase lenses fit their near-plane corners into the available scenery clearance', () => {
  for (const aspect of [.4, 16 / 9, 4]) {
    const rig = new ThirdPersonCamera(), car = new THREE.Object3D();
    rig.resize(aspect); rig.clearance = () => .35; rig.setZoom(6); rig.update(car, 0);
    const slope = Math.tan(THREE.MathUtils.degToRad(rig.camera.fov) / 2);
    assert.ok(rig.camera.near * Math.hypot(1, slope, slope * aspect) <= .35 + 1e-9);
  }
});

test('getting in or out, the camera glides from one body to the next rather than cutting', () => {
  for (const fps of [30, 60, 120]) {
    const walker = new THREE.Object3D(), car = new THREE.Object3D(), rig = new ThirdPersonCamera(), fresh = new ThirdPersonCamera();
    Object.assign(walker.userData, { leash: true, chaseScale: .36, chaseLift: .75, velocity: { x: 0, z: 0 } });
    walker.position.set(1.5, 0, .4);
    rig.update(walker, 0);
    for (let i = 0; i < fps; i++) rig.update(walker, 1 / fps);
    const before = rig.camera.position.clone();
    rig.update(car, 1 / fps);
    // (cut straight over, it would move 1.55 m in a frame)
    assert.ok(rig.camera.position.distanceTo(before) < .45, `moved ${rig.camera.position.distanceTo(before).toFixed(2)} m getting in at ${fps} fps`);
    for (let i = 0; i < fps * 3; i++) rig.update(car, 1 / fps);
    fresh.update(car, 0);
    assert.ok(rig.camera.position.distanceTo(fresh.camera.position) < 1e-3, 'then frames the car just as it would have');
  }
});

test('a long fall stays in frame and lands without the camera whipping down after it', () => {
  for (const fps of [30, 60, 120]) {
    const body = new THREE.Object3D(), rig = new ThirdPersonCamera(), subject = new THREE.Vector3();
    Object.assign(body.userData, { leash: true, chaseScale: .7, velocity: { x: 0, z: 0 } });
    body.position.y = 200; rig.update(body, 0);
    let vy = 0, lowest = 0;
    const frame = () => { subject.copy(body.position); subject.y += 1; return subject.project(rig.camera).y; };
    for (let i = 0; i < fps * 3.5; i++) {
      vy -= 24 / fps; body.position.y += vy / fps; rig.update(body, 1 / fps);
      lowest = Math.min(lowest, frame());
    }
    assert.ok(lowest > -.85, `at ${-vy.toFixed(0)} m/s it sat at ${lowest.toFixed(2)} of the frame`);
    // Down: the camera catches up without the subject shooting up the frame
    let before = frame(), most = 0;
    for (let i = 0; i < fps; i++) { rig.update(body, 1 / fps); const now = frame(); most = Math.max(most, Math.abs(now - before) * fps / 60); before = now; }
    assert.ok(most < .06, `moved ${(most * 100).toFixed(1)}% of the frame in a 60th of a second`);
  }
});

test('into a car the chase camera swings round behind it gently at first', () => {
  const walker = new THREE.Object3D(), car = new THREE.Object3D(), rig = new ThirdPersonCamera();
  Object.assign(walker.userData, { leash: true, chaseScale: .36, velocity: { x: 0, z: 0 } });
  walker.rotation.y = Math.PI / 2; car.rotation.y = 0;
  rig.update(walker, 0);
  const start = rig.heading;
  rig.update(car, 1 / 60); rig.update(car, 1 / 60);
  const early = Math.abs(rig.heading - start) * 30;
  for (let i = 0; i < 180; i++) rig.update(car, 1 / 60);
  assert.ok(early < 1, `turning ${early.toFixed(2)} rad/s in its first frames`);
  assert.ok(Math.abs(Math.atan2(Math.sin(rig.heading), Math.cos(rig.heading))) < .01, 'and ends up behind it');
});
