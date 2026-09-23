import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collideScenery, postContact } from '../src/collision.js';
import { trafficContact } from '../src/traffic.js';
import { DrivingController } from '../src/vehicle.js';
import { CHUNK_LENGTH } from '../src/world/route.js';
import { solidBox, solidPost, solidSpan, solidModel } from '../src/world/colliders.js';

// A flat, straight road: x is u and z is -s, as in the traffic tests.
const straightRoute = {
  frame: s => ({ x: 0, y: 0, z: -s, nx: 1, nz: 0, angle: 0, scale: 1 }),
  position: (s, u, y = 0) => ({ x: u, y, z: -s }),
  height: () => 0,
  bounds: () => [-400, 400],
};
// One chunk holding whatever the test stands in it, keyed as a world keeps them.
function scenery(build) {
  const chunk = { start: 0, features: {} };
  build(chunk);
  return new Map([[0, chunk]]);
}
const footprint = car => ({ x: car.groundedPosition.x, z: car.groundedPosition.z, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2 });
const contactWith = (car, solid) => solid.heading === undefined ? postContact(footprint(car), solid) : trafficContact(footprint(car), solid);
function overlap(car, chunks) {
  let deepest = 0;
  for (const chunk of chunks.values()) for (const solid of chunk.features.colliders ?? []) deepest = Math.max(deepest, contactWith(car, solid)?.depth ?? 0);
  return deepest;
}
function drive(car, chunks, seconds, input = { forward: true }) {
  let deepest = 0;
  for (let i = 0; i < seconds * 60; i++) {
    car.update(1 / 60, input); collideScenery(car, chunks, 1 / 60);
    deepest = Math.max(deepest, overlap(car, chunks));
  }
  return deepest;
}

test('a round footprint pushes the car straight back out of whichever side it met', () => {
  const car = { x: 0, z: 0, heading: 0, halfWidth: 1, halfLength: 2 };
  assert.equal(postContact(car, { x: 0, z: -3, reach: .5 }), null);
  const ahead = postContact(car, { x: 0, z: -2.3, reach: .5 });
  assert.ok(Math.abs(ahead.x) < 1e-9 && Math.abs(ahead.z - 1) < 1e-9 && Math.abs(ahead.depth - .2) < 1e-9);
  const beside = postContact(car, { x: 1.2, z: 0, reach: .5 });
  assert.ok(Math.abs(beside.x + 1) < 1e-9 && Math.abs(beside.z) < 1e-9 && Math.abs(beside.depth - .3) < 1e-9);
  // Turned a quarter, the car's flank faces down the road.
  const turned = postContact({ ...car, heading: Math.PI / 2 }, { x: 0, z: -1.2, reach: .5 });
  assert.ok(Math.abs(turned.x) < 1e-9 && Math.abs(turned.z - 1) < 1e-9 && Math.abs(turned.depth - .3) < 1e-9);
  // A post already under the bonnet leaves by the nose, the nearer side.
  const under = postContact(car, { x: 0, z: -1.6, reach: .5 });
  assert.ok(Math.abs(under.z - 1) < 1e-9 && Math.abs(under.depth - .9) < 1e-9);
});

test('a wall met head-on stops the car outside it and reports the impact', () => {
  const chunks = scenery(chunk => solidBox(chunk, 0, -80, 0, 10, 2));
  const car = new DrivingController(straightRoute, { s: 24 });
  car.u = 0; car.update(0, {});
  const deepest = drive(car, chunks, 8);
  // One step's travel may stand inside the wall before it is put back out.
  assert.ok(deepest < 1, `the car sank ${deepest} m into the wall`);
  assert.ok(overlap(car, chunks) < .05);
  assert.ok(Math.abs(car.s - (78 - car.spec.length / 2)) < .3, `stopped at s=${car.s}`);
  assert.ok(Math.abs(car.speed) < 1);
  assert.ok(car.audioTelemetry.impactSerial > 0);
  // Reversing away is free.
  for (let i = 0; i < 120; i++) { car.update(1 / 60, { brake: true }); collideScenery(car, chunks, 1 / 60); }
  assert.ok(car.s < 74 && car.speed < -2);
  car.disposeModel();
});

test('a sideways slide into a wall loses speed even when the body faces along it', () => {
  const car = new DrivingController(straightRoute);
  try {
    car.speed = 15; car.heading = 0; car.slideHeading = .4;
    car.resolveSceneryCollision(-1, 0, .1, 1 / 120);
    assert.ok(car.speed < 15 && car.speed > 10, 'wall removes the sideways part of travel');
    assert.ok(car.audioTelemetry.impact > 5, 'the sliding contact reports its impact');
  } finally { car.disposeModel(); }
});

test('a glancing blow slides along a wall instead of stopping against it', () => {
  // A long wall beside the road, approached at twenty degrees.
  const chunks = scenery(chunk => solidSpan(chunk, { x: 12, z: -20 }, { x: 12, z: -120 + CHUNK_LENGTH }, 1));
  const car = new DrivingController(straightRoute, { s: 24 });
  car.u = 0; car.heading = .35; car.speed = 18; car.update(0, {});
  const deepest = drive(car, chunks, 3, { forward: true });
  assert.ok(deepest < 1, `the car sank ${deepest} m into the wall`);
  assert.ok(car.groundedPosition.x < 11 - car.spec.width / 2 + .3, 'the car stays on its own side of the wall');
  assert.ok(Math.abs(car.heading) < .08, `the car should run parallel to the wall, heading ${car.heading}`);
  assert.ok(car.speed > 10, `sliding kept only ${car.speed} m/s`);
  assert.ok(car.s > 60);
  car.disposeModel();
});

test('a tree stops a car that meets it squarely and lets a clipped corner past', () => {
  for (const [offset, passes] of [[0, false], [1.25, true]]) {
    // In the car's own lane, where the lane assist holds it on line.
    const chunks = scenery(chunk => solidPost(chunk, 2.4 + offset, -70, .5));
    const car = new DrivingController(straightRoute, { s: 24 });
    const deepest = drive(car, chunks, 6);
    assert.ok(deepest < 1.2, `the car sank ${deepest} m into the trunk`);
    assert.equal(car.s > 80, passes, `offset ${offset} ended at s=${car.s}`);
    car.disposeModel();
  }
});

test('a model stands on the outline of its lowest quarter, turned and scaled with it', () => {
  // A 2 x 4 hut under a roof that overhangs it by a metre all round.
  const hut = new THREE.BoxGeometry(2, 3, 4).translate(5, 1.5, 0), roof = new THREE.BoxGeometry(4, 1, 6).translate(5, 3.5, 0);
  const position = new Float32Array([...hut.attributes.position.array, ...roof.attributes.position.array]);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  const chunk = { start: 256, features: {} };
  solidModel(chunk, geometry, [10, 0, 300], Math.PI / 2, 2);
  solidModel(chunk, geometry, [10, 0, 300], 0, 1, true);
  const [box, post] = chunk.features.colliders;
  // Yaw a quarter turn carries the model's +x onto -z; z is stored from the world's origin.
  assert.ok(Math.abs(box.x - 10) < 1e-6 && Math.abs(box.z - (300 - 256 - 10)) < 1e-6);
  assert.ok(Math.abs(box.halfWidth - 2) < 1e-6 && Math.abs(box.halfLength - 4) < 1e-6 && Math.abs(box.heading + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(post.x - 15) < 1e-6 && Math.abs(post.reach - 2) < 1e-6 && post.heading === undefined);
});

test('a free-roaming car keeps its whole length back from a drop, not just its middle', () => {
  // Level ground that falls ten metres at u = 30.
  const ledge = { ...straightRoute, height: (s, u) => u > 30 ? -10 : 0, position: (s, u, y = u > 30 ? -10 : 0) => ({ x: u, y, z: -s }) };
  const car = new DrivingController(ledge, { s: 24 });
  car.toggleFreeDriving();
  car.heading = Math.PI / 2;
  for (let i = 0; i < 600; i++) car.update(1 / 60, { forward: true });
  assert.ok(car.u > 26 && car.u + car.spec.length / 2 <= 30.05, `the nose should stop at the edge, u=${car.u}`);
  assert.ok(Math.abs(car.speed) < 3);
  car.disposeModel();
});
