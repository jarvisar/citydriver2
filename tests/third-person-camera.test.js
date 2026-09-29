import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
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
        // In a lane near there, clear of kerbs and quays
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
  rig.zoomBy(100); assert.equal(rig.zoomTarget, 4);
  rig.zoomBy(1e-3); assert.equal(rig.zoomTarget, .45);
  rig.snap(); rig.update(car, 0);
  assert.equal(rig.zoom, .45);
});

test('turned down low or zoomed out, the chase camera stays over the ground under it', () => {
  const car = new THREE.Object3D(), rig = new ThirdPersonCamera();
  // A quay 3 m up off to the car's left
  rig.ground = x => x < -6 ? 3 : 0;
  rig.update(car, 0); rig.zoomBy(4);
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    rig.snap(); rig.look(yaw, -1);
    for (let i = 0; i < 60; i++) {
      rig.update(car, 1 / 60);
      assert.ok(rig.camera.position.y >= rig.ground(rig.camera.position.x) + .6 - 1e-9);
    }
  }
  // (and where the ground does not reach it, it is left alone)
  rig.snap(); rig.update(car, 0);
  const free = new ThirdPersonCamera(); free.zoomBy(4); free.update(car, 0);
  assert.equal(rig.camera.position.distanceTo(free.camera.position), 0);
});
