import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { trafficContact, collideScenery, postContact, footprintContact, sightLine, cameraClearance } from '../src/collision.js';
import { DrivingController } from '../src/vehicle.js';
import { CHUNK_LENGTH } from '../src/world/route.js';
import { solidBox, solidPost, solidSpan, solidModel, convexPieces, convexHull } from '../src/world/colliders.js';
import { CARS, CAR_IDS } from '../src/cars.js';

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

test('every wheeled car stays outside a thin wall at its boosted speed in forward and reverse', () => {
  for (const id of CAR_IDS) {
    if (['helicopter', 'plane'].includes(CARS[id].kind)) continue;
    for (const reverse of [false, true]) {
      const direction = reverse ? -1 : 1, route = { ...straightRoute, laneAssist: false };
      const chunks = scenery(chunk => solidBox(chunk, 0, -direction * 12, 0, 20, .06));
      const car = new DrivingController(route, { s: 0, u: 0, heading: 0 }, id);
      try {
        car.freeDriving = true;
        car.speed = reverse ? -car.stats.reverseSpeed : car.stats.topSpeed * 1.35; car.update(0, {});
        for (let i = 0; i < 240; i++) {
          car.update(1 / 120, reverse ? { brake: 1 } : { forward: 1, boost: true });
          collideScenery(car, chunks, 1 / 120);
          assert.ok([car.s, car.u, car.y, car.heading, car.speed, car.knock.x, car.knock.z, car.knock.spin].every(Number.isFinite), id);
          assert.ok(car.s * direction < 12, `${id} crossed the wall ${reverse ? 'in reverse' : 'forward'}`);
          assert.ok(overlap(car, chunks) < .01, `${id} stayed embedded`);
        }
        assert.ok(car.audioTelemetry.impactSerial > 0, `${id} reached the wall`);
      } finally { car.disposeModel(); }
    }
  }
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

test('a scrape along a wall is no crash, and a nose into it is', () => {
  const route = { ...straightRoute, laneAssist: false };
  const crashes = (speed, degrees) => {
    // A long wall beside the road, its face at x = 12
    const chunks = scenery(chunk => solidBox(chunk, 13, -134, 0, 1, 120));
    const car = new DrivingController(route, { s: 24 });
    try {
      const a = degrees * Math.PI / 180;
      car.heading = a; car.u = 12 - Math.sin(a) * car.spec.length / 2 - Math.cos(a) * car.spec.width / 2 - 1; car.speed = speed; car.update(0, {});
      for (let i = 0; i < 240; i++) { car.update(1 / 120, {}); collideScenery(car, chunks, 1 / 120); }
      assert.ok(car.audioTelemetry.impactSerial > 0, `${degrees}° at ${speed} m/s met the wall`);
      return car.audioTelemetry.crashSerial;
    } finally { car.disposeModel(); }
  };
  // Grazing it at 90 km/h, and nudging it at parking speed, aren't crashes
  assert.equal(crashes(25, 15), 0); assert.equal(crashes(3, 90), 0);
  assert.equal(crashes(10, 90), 1); assert.equal(crashes(25, 45), 1);
  // Trading paint with a car alongside is no crash, being T-boned is
  const car = new DrivingController(straightRoute, { s: 24 });
  try {
    car.speed = 20; car.update(0, {});
    car.strike(-2, 0, 0, 4); assert.equal(car.audioTelemetry.crashSerial, 0);
    car.speed = 0; car.update(0, {});
    car.strike(9.5, 0, 0, 15); assert.equal(car.audioTelemetry.crashSerial, 1);
    // One hit landing as two blows a couple of frames apart adds up, two separate knocks don't
    const twice = gap => {
      car.update(1, {}); const serial = car.audioTelemetry.crashSerial;
      car.speed = 15; car.knock.x = car.knock.z = car.knock.spin = 0; car.update(0, {});
      car.strike(0, 5, 0, 10); for (let t = 0; t < gap; t += 1 / 60) car.update(1 / 60, {});
      car.strike(0, 3, 0, 5);
      car.update(1, {});
      return car.audioTelemetry.crashSerial - serial;
    };
    assert.equal(twice(1 / 30), 1); assert.equal(twice(.5), 0);
  } finally { car.disposeModel(); }
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
  // A 2 x 4 hut under a roof that overhangs it by a meter all round.
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
  // Level ground that falls ten meters at u = 30.
  const ledge = { ...straightRoute, height: (s, u) => u > 30 ? -10 : 0, position: (s, u, y = u > 30 ? -10 : 0) => ({ x: u, y, z: -s }) };
  const car = new DrivingController(ledge, { s: 24 });
  car.toggleFreeDriving();
  car.heading = Math.PI / 2;
  for (let i = 0; i < 600; i++) car.update(1 / 60, { forward: true });
  assert.ok(car.u > 26 && car.u + car.spec.length / 2 <= 30.05, `the nose should stop at the edge, u=${car.u}`);
  // (held at the edge, the wheels keep a little speed that grows with the car's pull)
  assert.ok(Math.abs(car.speed) < 3.5);
  car.disposeModel();
});

test('a wall met head-on at speed throws the car back a little, and leaning on it is silent', () => {
  const chunks = scenery(chunk => solidBox(chunk, 0, -40, 0, 10, 1));
  const car = new DrivingController(straightRoute, { s: 24 });
  try {
    // Coasting in at 20 m/s in its lane: one blow, then a short roll back off the wall
    car.u = 2.4; car.s = 39 - car.spec.length / 2 - 1; car.speed = 20; car.update(0, {});
    const impacts = car.audioTelemetry.impactSerial;
    let hit = null, furthest = 0;
    for (let i = 0; i < 240; i++) {
      car.update(1 / 120, {}); collideScenery(car, chunks, 1 / 120);
      if (hit === null && car.audioTelemetry.impactSerial !== impacts) hit = car.s;
      if (hit !== null) furthest = Math.max(furthest, hit - car.s);
    }
    assert.equal(car.audioTelemetry.impactSerial, impacts + 1, 'one crash, one sound');
    assert.ok(furthest > .4 && furthest < 2.5, `bounced back ${furthest} m`);
    assert.ok(Math.abs(car.heading) < 1e-9, 'a square hit does not turn the car');
    // Pushing against it from a standstill neither bounces nor reports a crash
    car.s = 39 - car.spec.length / 2 - .01; car.speed = 0; car.knock.x = car.knock.z = car.knock.spin = 0; car.update(0, {});
    const leaning = car.audioTelemetry.impactSerial, s = car.s;
    for (let i = 0; i < 360; i++) { car.update(1 / 120, { forward: true }); collideScenery(car, chunks, 1 / 120); }
    assert.equal(car.audioTelemetry.impactSerial, leaning);
    assert.ok(Math.abs(car.s - s) < .02 && overlap(car, chunks) < .05);
  } finally { car.disposeModel(); }
});

test('a post met off center swings the car round it, and one met square does not', () => {
  const yawAfter = offset => {
    const chunks = scenery(chunk => solidPost(chunk, 2.4 + offset, -30, .35));
    const car = new DrivingController(straightRoute, { s: 24 });
    try {
      car.u = 2.4; car.s = 26; car.speed = 18; car.update(0, {});
      for (let i = 0; i < 72; i++) { car.update(1 / 120, {}); collideScenery(car, chunks, 1 / 120); }
      return car.heading;
    } finally { car.disposeModel(); }
  };
  assert.ok(Math.abs(yawAfter(0)) < 1e-9);
  // Caught by the right of its nose, the car pivots right; by the left, left
  assert.ok(yawAfter(.5) > .25, `turned ${yawAfter(.5)}`);
  assert.ok(yawAfter(-.5) < -.25);
});

test('a corner clipped by the edge of the nose glances the car aside instead of stopping it', () => {
  const run = inside => {
    // A parked car's corner, `inside` meters within the line of the car's right side
    const car = new DrivingController(straightRoute, { s: 24 });
    const chunks = scenery(chunk => solidBox(chunk, 2.4 + car.spec.width / 2 - inside + 1, -40, 0, 1, 2.2));
    try {
      car.u = 2.4; car.s = 30; car.speed = 24; car.update(0, {});
      for (let i = 0; i < 180; i++) { car.update(1 / 120, {}); collideScenery(car, chunks, 1 / 120); }
      const v = car.velocity;
      return { speed: Math.hypot(v.x, v.z), heading: car.heading, s: car.s, x: car.groundedPosition.x - 2.4, hit: car.audioTelemetry.impactSerial > 0 };
    } finally { car.disposeModel(); }
  };
  const clip = run(.12), square = run(.9);
  assert.ok(clip.hit && clip.speed > 8 && clip.s > 44, `a clip kept ${clip.speed} m/s and reached s=${clip.s}`);
  assert.ok(clip.heading < -.1 && clip.x < 0, 'turned and pushed away from the corner');
  assert.ok(square.speed < 3 && square.s < 38, `a square hit kept ${square.speed} m/s`);
});

test('the body rocks after a blow, nose down into one from ahead, and settles', () => {
  const car = new DrivingController(straightRoute, { s: 24 });
  try {
    car.speed = 15; car.update(0, {});
    // Stopped by something ahead: the blow points back down the road (+z)
    car.strike(0, 15, 0, 15);
    assert.ok(car.trauma > .4, 'a crash shakes the view');
    let lowest = 0;
    for (let i = 0; i < 30; i++) {
      car.update(1 / 120, {}); lowest = Math.min(lowest, car.jolt.pitch);
      assert.ok(Math.abs(car.currentPose.bodyPitch - car.bodyPitch - car.jolt.pitch) < 1e-12, 'the pose shows it');
    }
    assert.ok(lowest < -.03, `the nose dipped ${lowest}`);
    assert.ok(car.trauma > 0 && car.car.userData.trauma === car.trauma);
    for (let i = 0; i < 360; i++) car.update(1 / 120, {});
    assert.deepEqual(car.jolt, { pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 });
    assert.equal(car.trauma, 0);
  } finally { car.disposeModel(); }
});

// A chunk holding one building, 10 m square and 10 m tall, 15 m off along -z
function block(extra = {}) {
  const building = { corners: [{ x: -5, z: -25 }, { x: 5, z: -25 }, { x: 5, z: -15 }, { x: -5, z: -15 }], x: 0, z: -20, reach: Math.hypot(5, 5), top: 10, ...extra };
  return { collisionBounds: { minX: -5, maxX: 5, minZ: -25, maxZ: -15 }, features: { colliders: [building] } };
}

test('camera sight intersects roofs in 3D, including descending from above a footprint and pitched ridges', () => {
  for (const origin of [0, 1024]) {
    const from = { x: 0, y: 20, z: origin - 20 }, to = { x: 0, y: 5, z: origin - 20 };
    assert.ok(Math.abs(sightLine([block()], from, to, origin) - 9.5 / 15) < 1e-9, 'vertical descent stops above the roof');
    assert.ok(Math.abs(sightLine([block({ ridge: 15 })], from, to, origin) - 4.5 / 15) < 1e-9, 'pitched roof includes the ridge');
    assert.equal(sightLine([block()], { ...from, y: 30 }, { ...to, y: 20 }, origin), 1, 'high flight clears the footprint');
    const across = sightLine([block()], { x: 0, y: 20, z: origin }, { x: 0, y: 5, z: origin - 30 }, origin);
    assert.ok(Math.abs(across - 9.5 / 15) < 1e-9, 'above-roof entry does not pull the camera back to the wall unnecessarily');
  }
});

test('camera clearance keeps close clipping near walls, roof ridges and after rebasing', () => {
  const chunks = [block()];
  assert.equal(cameraClearance(chunks, { x: 0, y: 100, z: -20 }), 1, 'open air above the building');
  assert.equal(cameraClearance(chunks, { x: 5.2, y: 5, z: -20 }), .1, 'beside a wall');
  assert.equal(cameraClearance(chunks, { x: 0, y: 10.2, z: -20 }), .1, 'just above a flat roof');
  assert.equal(cameraClearance([block({ ridge: 15 })], { x: 0, y: 15.2, z: -20 }), .1, 'a pitched roof uses its ridge');
  assert.equal(cameraClearance(chunks, { x: 0, y: 5, z: -20 }), .1, 'inside a footprint');
  assert.equal(cameraClearance(chunks, { x: 5.2, y: 5, z: 1004 }, 1024), .1, 'same clearance after an origin shift');
  assert.equal(cameraClearance(chunks, { x: 9, y: 5, z: -20 }), 1, 'clear of the wall and its overhangs');
});
test('the chase camera sees up to 2.2 m short of a building below its roof, and over or past anything else', () => {
  const from = { x: 0, y: 2, z: 0 }, to = { x: 0, y: 5, z: -30 };
  assert.ok(Math.abs(sightLine([block()], from, to) - 12.8 / 30) < 1e-9, 'awnings and balconies stand out from the wall');
  assert.equal(sightLine([block({ top: 1 })], from, to), 1, 'over the roof');
  assert.equal(sightLine([block({ top: undefined })], from, to), 1, 'walls, hedges and trees do not count');
  assert.equal(sightLine([{ ...block(), collisionBounds: undefined }], from, to), 1, 'a chunk still being built');
  assert.equal(sightLine([block()], { x: 8, y: 2, z: 0 }, { x: 8, y: 5, z: -30 }), 1, 'a line that passes it by');
  // The scene lies `origin` along z from the colliders
  assert.ok(Math.abs(sightLine([block()], { ...from, z: 500 }, { ...to, z: 470 }, 500) - 12.8 / 30) < 1e-9);
  // A car nearer the wall than that still keeps the camera half a meter off it
  assert.ok(Math.abs(sightLine([block()], { x: 0, y: 2, z: -13.5 }, { x: 0, y: 5, z: -30 }) - 1 / 16.5) < 1e-9);
  // A sharp corner is bevelled, not grown into a spike far past its tip
  const wedge = { corners: [{ x: 0, z: -10 }, { x: 5, z: -40 }, { x: -5, z: -40 }], x: 0, z: -30, reach: 21, top: 10 };
  const chunk = { collisionBounds: { minX: -5, maxX: 5, minZ: -40, maxZ: -10 }, features: { colliders: [wedge] } };
  assert.equal(sightLine([chunk], { x: -10, y: 2, z: -7.5 }, { x: 10, y: 5, z: -7.5 }), 1);
  assert.ok(sightLine([chunk], { x: -10, y: 2, z: -12 }, { x: 10, y: 5, z: -12 }) < 1);
});

// A building's footprint as the colliders a chunk makes of it (see
// footprintSolids, and CityChunk.mapFeatures): map points [x, s] round it,
// whole or in its convex pieces, each piece knowing its seams with the next
const mapped = (points, seams) => {
  const corners = points.map(([x, s]) => ({ x, z: -s })), n = corners.length, x = corners.reduce((sum, p) => sum + p.x, 0) / n, z = corners.reduce((sum, p) => sum + p.z, 0) / n;
  return { corners, x, z, reach: Math.max(...corners.map(p => Math.hypot(p.x - x, p.z - z))), heading: 0, top: 30, ...(seams ? { seams } : {}) };
};
const ringOf = points => points.map(([x, y]) => ({ x, y }));
const inPieces = (ring, hull = convexHull(ringOf(ring)).map(p => [p.x, p.y])) => convexPieces(ringOf(ring)).map(piece => ({ ...mapped(piece.points.map(p => [p.x, p.y]), piece.seams), hull }));
const asHull = ring => [mapped(convexHull(ringOf(ring)).map(p => [p.x, p.y]))];
const turnedBy = (ring, angle) => ring.map(([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)]);
const cityOf = colliders => new Map([[0, { collisionBounds: { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 }, features: { colliders } }]]);
const openRoute = { ...straightRoute, grid: true, laneAssist: false, bounds: () => [-1e9, 1e9] };
// A car set down at (x, s) on the map, headed `way` (radians anticlockwise
// from east) and driven on with `steer` held: where it went step by step, and
// the most the scenery moved it in one
function run(colliders, { x, s, way, speed, seconds = 3, steer = null, id = 'taxi' }) {
  const car = new DrivingController(openRoute, { s }, id), chunks = cityOf(colliders), path = [];
  try {
    car.u = x; car.heading = Math.atan2(Math.cos(way), Math.sin(way)); car.speed = speed; car.update(0, {});
    let moved = 0;
    for (let i = 0; i < seconds * 120; i++) {
      car.update(1 / 120, { forward: true, ...(steer ? { [steer]: true } : {}) });
      const p = car.groundedPosition, bx = p.x, bz = p.z;
      collideScenery(car, chunks, 1 / 120);
      moved = Math.max(moved, Math.hypot(p.x - bx, p.z - bz));
      path.push([p.x, p.z]);
    }
    return { path, moved, speed: car.speed, crashes: car.audioTelemetry.crashSerial, met: car.audioTelemetry.impactSerial, box: footprint(car) };
  } finally { car.disposeModel(); }
}
const apart = (a, b) => a.path.reduce((most, p, i) => Math.max(most, Math.hypot(p[0] - b.path[i][0], p[1] - b.path[i][1])), 0);
// An L of two wings 16 m deep and 40 m long, its yard in the crook beyond (16, 16)
const ELL = [[0, 0], [40, 0], [40, 16], [16, 16], [16, 40], [0, 40]];

test('a building with wings stands in convex pieces that fill its outline, and its hull where its hollows are not worth opening', () => {
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x), span = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const area = points => points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0) / 2;
  const pieces = (ring, count, name) => {
    const made = convexPieces(ringOf(ring));
    assert.equal(made.length, count, name);
    if (count === 1) {
      assert.equal(made[0].seams, undefined, `${name}: one piece has no seams`);
      assert.deepEqual(made[0].points, convexHull(ringOf(ring)), `${name}: its hull, as every building's collider once was`);
      return made;
    }
    // How much of the turn round a point the pieces fill between them
    const filled = p => made.reduce((sum, piece) => sum + piece.points.reduce((turn, q, i) => {
      const n = piece.points.length, b = piece.points[(i + 1) % n], a = piece.points[(i + n - 1) % n];
      if (span(q, p) < 1e-6) return turn + Math.abs(Math.atan2(cross(q, b, a), (b.x - q.x) * (a.x - q.x) + (b.y - q.y) * (a.y - q.y)));
      // (a point along an edge has half a turn of that piece beside it)
      const along = ((p.x - q.x) * (b.x - q.x) + (p.y - q.y) * (b.y - q.y)) / span(q, b) ** 2;
      return span(b, p) > 1e-6 && along > 0 && along < 1 && Math.abs(cross(q, b, p)) / span(q, b) < 1e-6 ? turn + Math.PI : turn;
    }, 0), 0);
    for (const piece of made) {
      const points = piece.points, n = points.length;
      assert.ok(area(points) > 0 && piece.seams.length === n && piece.seams.some(Boolean) && !piece.seams.every(Boolean), `${name}: each piece has walls and a seam`);
      points.forEach((p, i) => {
        assert.ok(cross(points[(i + n - 1) % n], p, points[(i + 1) % n]) > -1e-9, `${name}: a piece is convex`);
        // A seam ends part of the way along a wall, or at a corner that turns
        // into the building: never at a corner the building has, where a car
        // would need both of that corner's walls to be put out past it
        if (piece.seams[i] || piece.seams[(i + n - 1) % n]) assert.ok(filled(p) > Math.PI - 1e-6, `${name}: a seam ends at a real corner (${p.x}, ${p.y})`);
      });
    }
    return made;
  };
  const total = made => made.reduce((sum, piece) => sum + area(piece.points), 0);
  pieces([[0, 0], [10, 0], [10, 10], [0, 10]], 1, 'a square');
  assert.ok(Math.abs(total(pieces(ELL, 2, 'an L')) - 16 * 40 - 16 * 24) < 1e-9, 'the L and no more: its yard is open');
  assert.equal(pieces(ELL.slice().reverse(), 2, 'an L given clockwise').length, 2);
  assert.ok(Math.abs(total(pieces([[0, 0], [30, 0], [30, 30], [21, 30], [21, 12], [9, 12], [9, 30], [0, 30]], 3, 'a U')) - (900 - 12 * 18)) < 1e-9);
  // A dip in a wall no deeper than its sills stand out is left closed, a deeper one opened
  pieces([[0, 0], [20, 0], [20, 10], [12, 10], [10, 9.85], [8, 10], [0, 10]], 1, 'a wall with a dip of 15 cm');
  assert.ok(Math.abs(total(pieces([[0, 0], [20, 0], [20, 10], [12, 10], [10, 9.5], [8, 10], [0, 10]], 2, 'a wall with a dip of half a meter')) - 199) < 1e-9);
  // A slot nobody on foot fits into (they are .64 m across) stays closed, however deep
  pieces([[0, 0], [20, 0], [20, 10], [10.4, 10], [10.4, 5], [9.6, 5], [9.6, 10], [0, 10]], 1, 'a slot 80 cm wide');
  assert.ok(Math.abs(total(pieces([[0, 0], [20, 0], [20, 10], [10.8, 10], [10.8, 5], [9.2, 5], [9.2, 10], [0, 10]], 3, 'a slot 1.6 m wide')) - 192) < 1e-9);
  // The inside of a curved front, a corner every 2 m: a few pieces, never more than 20 cm proud of it or 2 cm inside it
  const front = Array.from({ length: 31 }, (_, k) => { const a = -Math.PI / 2 + (15 - k) * 2 / 70; return [70 * Math.cos(a), 70 + 70 * Math.sin(a)]; });
  const curved = [[front.at(-1)[0], -14], [front[0][0], -14], ...front], made = pieces(curved, 8, 'a front round a curve');
  assert.ok(total(made) >= area(ringOf(curved)) - 1e-9 && total(made) - area(ringOf(curved)) < .2 * 60, `${(total(made) - area(ringOf(curved))).toFixed(2)} m2 over its 60 m`);
  for (const [x, y] of front) {
    // (each corner of the front against the pieces' walls: how far outside them, or in)
    const out = Math.min(...made.flatMap(piece => piece.points.map((a, i) => piece.seams[i] ? Infinity : Math.abs(cross(a, piece.points[(i + 1) % piece.points.length], { x, y })) / span(a, piece.points[(i + 1) % piece.points.length]))));
    assert.ok(out < .2 + 1e-9, `a corner of the front ${out.toFixed(2)} m from the collider's wall`);
  }
});

test('a car slides along a wall across the seam between two pieces of it exactly as along the wall whole', () => {
  // A wall 100 m long facing west at x = 12, in one piece and cut in two: square across, and on a slant
  const whole = [[12, 20], [20, 20], [20, 120], [12, 120]];
  const cuts = {
    square: [[[[12, 20], [20, 20], [20, 70], [12, 70]], [false, false, true, false]], [[[12, 70], [20, 70], [20, 120], [12, 120]], [true, false, false, false]]],
    slant: [[[[12, 20], [20, 20], [20, 90], [12, 60]], [false, false, true, false]], [[[12, 60], [20, 90], [20, 120], [12, 120]], [true, false, false, false]]],
  };
  let met = 0, unmarked = 0;
  for (const tilt of [0, .37]) for (const back of [false, true]) for (const degrees of [2, 5, 10, 20]) for (const speed of [6, 18, 32]) {
    // Into the wall at a slant from 3 m off it, up the map or back down it, and held against it
    const a = degrees * Math.PI / 180, [[x, s]] = turnedBy([[9, back ? 114 : 26]], tilt);
    const drive = colliders => run(colliders, { x, s, way: (back ? -Math.PI / 2 + a : Math.PI / 2 - a) + tilt, speed, steer: back ? 'left' : 'right' });
    const one = drive([mapped(turnedBy(whole, tilt))]);
    met += one.met > 0;
    for (const [name, halves] of Object.entries(cuts)) for (const order of [0, 1]) {
      const two = halves.map(([points, seams]) => mapped(turnedBy(points, tilt), seams));
      const cut = drive(order ? two.reverse() : two);
      assert.ok(apart(one, cut) < 1e-9 && cut.crashes === one.crashes, `${name} cut, ${degrees} degrees at ${speed} m/s ${back ? 'back' : 'on'}, piece ${order} first: ${apart(one, cut).toFixed(3)} m apart, ${cut.crashes} crashes for ${one.crashes}`);
      // (the same pieces not knowing their seams, each a building of its own: the seam is a wall end to catch on)
      if (name === 'square' && !order) unmarked += apart(one, drive(two.map(({ seams, ...solid }) => solid))) > .01;
    }
  }
  assert.equal(met, 48, 'every run met the wall');
  assert.ok(unmarked > 5, `unmarked, the seam shows in ${unmarked} of 48 runs`);
});

test('cut into pieces any way, a convex building moves a car as it does whole', () => {
  let state = 7;
  const random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // A piece cut in two by a chord from part of the way along one of its edges to part of the way along another
  const chop = piece => {
    const n = piece.points.length, i = Math.floor(random() * n), other = Math.floor(random() * (n - 1)), [a, b] = [i, other >= i ? other + 1 : other].sort((p, q) => p - q);
    const at = k => { const p = piece.points[k], q = piece.points[(k + 1) % n], t = .12 + random() * .76; return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }, pa = at(a), pb = at(b);
    return [
      { points: [pa, ...piece.points.slice(a + 1, b + 1), pb], seams: [piece.seams[a], ...piece.seams.slice(a + 1, b), piece.seams[b], true] },
      { points: [pb, ...piece.points.slice(b + 1), ...piece.points.slice(0, a + 1), pa], seams: [piece.seams[b], ...piece.seams.slice(b + 1), ...piece.seams.slice(0, a), piece.seams[a], true] },
    ];
  };
  let met = 0, same = 0;
  for (let k = 0; k < 80; k++) {
    const corners = 4 + Math.floor(random() * 4), turn = random() * 6.28, rx = 8 + random() * 14, ry = 6 + random() * 10;
    const outline = Array.from({ length: corners }, (_, i) => { const a = turn + (i + .15 + random() * .7) / corners * Math.PI * 2; return [Math.cos(a) * rx, Math.sin(a) * ry]; });
    const list = [{ points: outline, seams: outline.map(() => false) }];
    for (let c = 1 + Math.floor(random() * 3); c > 0; c--) { const at = Math.floor(random() * list.length); list.splice(at, 1, ...chop(list[at])); }
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    // At it from somewhere round about, turning now and then
    const from = random() * 6.28, far = 26 + random() * 8, id = ['taxi', 'micro', 'rig', 'formula', 'bus'][Math.floor(random() * 5)], steer = random() < .4 ? 'left' : random() < .6 ? 'right' : null;
    const start = { x: Math.cos(from) * far, s: Math.sin(from) * far, way: from + Math.PI + (random() - .5) * .7, speed: 4 + random() * 30, steer, id, seconds: 3 };
    const whole = run([mapped(outline)], start), cut = run(list.map(piece => mapped(piece.points, piece.seams)), start);
    met += whole.met > 0; same += apart(whole, cut) < 1e-6;
    assert.ok(apart(whole, cut) < .5 && whole.crashes === cut.crashes, `building ${k} in ${list.length} pieces, the ${id}: ${apart(whole, cut).toFixed(3)} m apart, ${cut.crashes} crashes for ${whole.crashes}`);
  }
  assert.ok(met > 25, `${met} of 80 met their building`);
  // (a piece without the corner a car's nose is square to puts it out by the wall beside it, a fraction of a degree off: seldom)
  assert.ok(same >= 78, `the very same path in ${same} of 80`);
});

test('the crook of an L is open to drive into, and its outer walls are as its hull had them', () => {
  for (const tilt of [0, .41]) {
    const ring = turnedBy(ELL, tilt), pieces = inPieces(ring), hull = asHull(ring);
    assert.equal(pieces.length, 2);
    // Along the two long outer walls, which the cut crosses or ends at, both ways: no different from the hull
    for (const [from, to, side] of [[[-4, -2.2], [44, -2.2], 1], [[44, -2.2], [-4, -2.2], -1], [[-2.2, 44], [-2.2, -4], 1], [[-2.2, -4], [-2.2, 44], -1]]) for (const degrees of [3, 8, 20]) for (const speed of [8, 20, 32]) {
      const [[x, s]] = turnedBy([from], tilt), along = Math.atan2(to[1] - from[1], to[0] - from[0]);
      const start = { x, s, way: along + side * degrees * Math.PI / 180 + tilt, speed, steer: side > 0 ? 'left' : 'right', seconds: Math.min(1.6, 36 / speed) };
      const one = run(hull, start);
      for (const order of [0, 1]) {
        const two = run(order ? [...pieces].reverse() : pieces, start);
        assert.ok(one.met > 0 && apart(one, two) < 1e-9, `${degrees} degrees at ${speed} m/s from ${from}: ${apart(one, two).toFixed(3)} m apart`);
      }
    }
    // Into the yard, at the inner corner and at each inner wall near it: it ends up at rest in the yard, against the walls and in neither
    for (const degrees of [185, 205, 225, 245, 265]) for (const speed of [5, 15, 30]) for (const order of [0, 1]) {
      const way = degrees * Math.PI / 180, [[x, s]] = turnedBy([[16 - 26 * Math.cos(way), 16 - 26 * Math.sin(way)]], tilt);
      const end = run(order ? [...pieces].reverse() : pieces, { x, s, way: way + tilt, speed }), [[ex, es]] = turnedBy([end.path.at(-1)].map(([px, pz]) => [px, -pz]), -tilt);
      assert.ok(ex > 16 && es > 16 && ex < 24 && es < 24, `${degrees} degrees at ${speed} m/s: it stops in the crook, at (${ex.toFixed(1)}, ${es.toFixed(1)})`);
      assert.ok(Math.abs(end.speed) < 2 && end.met > 0, `at rest against the walls (${end.speed.toFixed(1)} m/s)`);
      assert.ok(end.moved < .35, `no wall threw it (${end.moved.toFixed(2)} m in a step)`);
      assert.ok(pieces.every(piece => !(footprintContact(end.box, piece)?.depth > .02)), 'and it is left in neither wall');
      // (its hull, a wall from wing tip to wing tip, kept it out of the yard altogether)
      if (!order) assert.ok(run(hull, { x, s, way: way + tilt, speed }).path.every(([px, pz]) => { const [[hx, hs]] = turnedBy([[px, -pz]], -tilt); return hx + hs > 56; }), 'the hull stood across the yard');
    }
  }
});

test('along the inside of a curved front a car scrapes on from wall to wall with no crash', () => {
  const front = Array.from({ length: 31 }, (_, k) => { const a = -Math.PI / 2 + (15 - k) * 2 / 70; return [70 * Math.cos(a), 70 + 70 * Math.sin(a)]; });
  const pieces = inPieces([[front.at(-1)[0], -14], [front[0][0], -14], ...front]);
  assert.equal(pieces.length, 8);
  for (const back of [false, true]) for (const degrees of [2, 5, 10]) for (const speed of [8, 20, 32]) for (const order of [0, 1]) {
    // From 2 m off its western end heading east along it (or back from its eastern end), a little into it, and held against it
    const x = back ? 24 : -24, s = 70 - Math.sqrt(70 * 70 - x * x) + 2.2, tangent = Math.asin(x / 70);
    const end = run(order ? [...pieces].reverse() : pieces, { x, s, way: back ? Math.PI + tangent + degrees * Math.PI / 180 : tangent - degrees * Math.PI / 180, speed, steer: back ? 'left' : 'right', seconds: 2.5 });
    assert.ok(end.met > 2 && end.crashes === 0, `${degrees} degrees at ${speed} m/s ${back ? 'back' : 'on'}: ${end.crashes} crashes`);
    assert.ok(end.speed > speed * .8 && Math.abs(end.path.at(-1)[0] - x) > 25, `it kept going (${end.speed.toFixed(1)} m/s, ${Math.abs(end.path.at(-1)[0] - x).toFixed(0)} m on)`);
    assert.ok(end.moved < .3, `no wall threw it (${end.moved.toFixed(2)} m in a step)`);
  }
});

test('the chase camera sees across a yard its building does not fill, and not through the building', () => {
  const pieces = inPieces(ELL), hull = asHull(ELL), chunk = colliders => [...cityOf(colliders).values()];
  // From a car beyond the yard to a lens well inside it (map (38, 38) to (26, 26)), 10 m from either wing
  const from = { x: 38, y: 2, z: -38 }, to = { x: 26, y: 5, z: -26 };
  assert.ok(sightLine(chunk(hull), from, to) < 1, 'its hull filled the yard');
  assert.equal(sightLine(chunk(pieces), from, to), 1);
  assert.equal(cameraClearance(chunk(pieces), { x: 24, y: 5, z: -24 }), 1, 'room for the lens out in the yard');
  assert.equal(cameraClearance(chunk(hull), { x: 24, y: 5, z: -24 }), .1);
  assert.equal(cameraClearance(chunk(pieces), { x: 16.3, y: 5, z: -30 }), .1, 'and none against the wing');
  // Through a wing, across the seam inside it, the building is as solid as its hull: in at the same wall
  const street = { x: 8, y: 2, z: 6 }, beyond = { x: 8, y: 5, z: -50 };
  assert.ok(Math.abs(sightLine(chunk(pieces), street, beyond) - sightLine(chunk(hull), street, beyond)) < 1e-9 && sightLine(chunk(pieces), street, beyond) < .1);
  // and a lens over the seam on the roof is over one roof
  assert.equal(cameraClearance(chunk(pieces), { x: 8, y: 29, z: -16 }), .1);
  assert.equal(cameraClearance(chunk(pieces), { x: 8, y: 40, z: -16 }), 1);
  // Following a car along a wall, past where two pieces of it meet: the
  // line of sight is the whole wall's, however close the car keeps to it
  // (each piece taken for a building of its own pulled the camera in at the seam)
  const wall = [[12, 20], [20, 20], [20, 120], [12, 120]], whole = [mapped(wall)];
  const two = [[[[12, 20], [20, 20], [20, 70], [12, 70]], [false, false, true, false]], [[[12, 70], [20, 70], [20, 120], [12, 120]], [true, false, false, false]]].map(([points, seams]) => ({ ...mapped(points, seams), hull: wall }));
  let pulled = 0;
  for (const off of [.3, 1, 1.5, 2.1, 2.3, 3, 6]) for (let s = 40; s < 100; s += .7) for (const back of [9, -9]) for (const slant of [0, 2, -2]) {
    const car = { x: 12 - off, y: 2, z: -s }, lens = { x: 12 - off + slant, y: 5, z: -(s - back) }, sight = sightLine(chunk(whole), car, lens);
    for (const list of [two, [...two].reverse()]) assert.ok(Math.abs(sightLine(chunk(list), car, lens) - sight) < 1e-9, `${off} m off the wall at s ${s.toFixed(1)}: ${sightLine(chunk(list), car, lens).toFixed(2)} for ${sight.toFixed(2)}`);
    pulled += sightLine(chunk(two.map(({ hull, ...solid }) => solid)), car, lens) < sight - .1;
  }
  assert.ok(pulled > 20, `taken apart, the seam pulled the camera in on ${pulled} lines`);
});
