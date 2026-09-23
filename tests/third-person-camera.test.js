import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ThirdPersonCamera } from '../src/third-person-camera.js';
import { touchDrivingInput, thirdPersonDrivingInput } from '../src/touch-stick.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute } from '../src/world/city-route.js';
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
        const car = new DrivingController(route, { s });
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
