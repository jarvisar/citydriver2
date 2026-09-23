import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { touchDrivingInput } from '../src/touch-stick.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute } from '../src/world/city-route.js';

function cameraAt(offset, aspect) {
  const camera = new THREE.OrthographicCamera(-80 * aspect, 80 * aspect, 80, -80, 1, 1200);
  camera.position.set(...offset); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return camera;
}
const directions = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];

test('touch travel follows screen direction across city cameras and distant coordinates', () => {
  for (const route of [citydriverRoute]) {
    for (const offset of [[-220, 245, 260], [260, 245, 220]]) {
      for (const aspect of [390 / 844, 844 / 390]) {
        const camera = cameraAt(offset, aspect);
        for (const s of [24, 148, 420, 1025]) for (const [x, y] of directions) {
          const car = new DrivingController(route); car.s = s; car.reset();
          car.heading = -2; car.speed = 3;
          const before = car.car.position.clone().project(camera), length = Math.hypot(x, y);
          car.update(1 / 60, { touchDrive: touchDrivingInput({ x: x / length, y: y / length }, camera, route, car.s, car.u) });
          const after = car.car.position.clone().project(camera);
          const dx = (after.x - before.x) * aspect, dy = after.y - before.y;
          const alignment = (dx * x + dy * y) / (Math.hypot(dx, dy) * length);
          assert.ok(alignment > .999, `screen direction ${x},${y} at ${s}: ${alignment}`);
        }
      }
    }
  }
});

test('joystick distance controls speed and release stops without reversing', () => {
  const car = new DrivingController(), camera = cameraAt([-220, 245, 260], 1);
  const m = camera.matrixWorld.elements, frame = car.route.frame(car.s);
  const dx = Math.sin(frame.angle), dz = -Math.cos(frame.angle);
  const x = dx * m[0] + dz * m[2], y = dx * m[4] + dz * m[6], length = Math.hypot(x, y);
  for (let i = 0; i < 50; i++) car.update(1 / 60, { touchDrive: touchDrivingInput({ x: x / length * .25, y: y / length * .25 }, camera, car.route, car.s, car.u) });
  assert.ok(car.speed > 5 && car.speed <= 7);
  for (let i = 0; i < 60; i++) {
    car.update(1 / 60, { touchDrive: { amount: 0 } });
    assert.ok(car.speed >= 0);
  }
  assert.equal(car.speed, 0);
});

test('touch direction is independent of prior car heading and reverse speed', () => {
  const camera = cameraAt([-220, 245, 260], 1);
  for (const heading of [-Math.PI, -1, 0, 2]) {
    const car = new DrivingController(); car.heading = heading; car.speed = -3;
    const before = car.car.position.clone().project(camera);
    car.update(1 / 60, { touchDrive: touchDrivingInput({ x: 0, y: 1 }, camera, car.route, car.s, car.u) });
    assert.ok(car.car.position.clone().project(camera).y > before.y);
    assert.ok(car.speed > 0);
  }
});

test('touch keeps the car grounded throughout an unbounded city', () => {
  const camera = cameraAt([-220, 245, 260], 1), car = new DrivingController();
  for (let i = 0; i < 500; i++) {
    car.update(1 / 60, { touchDrive: touchDrivingInput({ x: 1, y: 0 }, camera, car.route, car.s, car.u) });
    const [lo, hi] = car.route.bounds(car.s);
    assert.ok(car.u >= lo && car.u <= hi);
    assert.ok(Math.abs(car.car.position.y - car.route.height(car.s, car.u) - .13) < 1e-8);
  }
});
