import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_IDS, DRAG } from '../src/cars.js';
import { turningRadius } from '../src/handling.js';
import { DrivingController } from '../src/vehicle.js';
import { FrameClock, PHYSICS_STEP } from '../src/timing.js';
import { ThirdPersonCamera } from '../src/third-person-camera.js';

const road = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0, bounds: () => [-1e4, 1e4],
  looseness: () => 0, laneAssist: false,
};

// What the player actually feels is how long the car takes to start turning at
// the rate they asked for, not how long the steering column takes to move.
test('every car reaches nine tenths of its yaw rate within 40 ms of a keypress', () => {
  for (const id of CAR_IDS) {
    const car = new DrivingController(road, {}, id);
    try {
      const speed = Math.min(14, car.stats.topSpeed * .5);
      const settled = speed / turningRadius(speed, car.stats);
      let elapsed = 0, reached = null;
      for (let tick = 0; tick < 24 && reached === null; tick++) {
        const before = car.heading;
        car.speed = speed;
        car.update(PHYSICS_STEP, { right: 1 });
        elapsed += PHYSICS_STEP * 1000;
        if ((car.heading - before) / PHYSICS_STEP >= settled * .9) reached = elapsed;
      }
      assert.ok(reached !== null && reached <= 40, `${id}: ${reached ?? '>200'} ms to turn in`);
    } finally { car.disposeModel(); }
  }
});

test('a released key stops the car turning within 30 ms', () => {
  for (const id of CAR_IDS) {
    const car = new DrivingController(road, {}, id);
    try {
      const speed = Math.min(14, car.stats.topSpeed * .5);
      for (let tick = 0; tick < 60; tick++) { car.speed = speed; car.update(PHYSICS_STEP, { right: 1 }); }
      const turning = car.heading;
      for (let tick = 0; tick < Math.round(.03 / PHYSICS_STEP); tick++) { car.speed = speed; car.update(PHYSICS_STEP, {}); }
      assert.ok(Math.abs(car.heading - turning) < .06, `${id}: coasts ${(car.heading - turning).toFixed(3)} rad past the release`);
    } finally { car.disposeModel(); }
  }
});

// The simulation is fixed-rate and the display is not, so a frame almost always
// lands between two steps. Showing the earlier of the two would add a whole
// step of latency to every frame for nothing.
test('the displayed car is where the simulation has it, not a step behind', () => {
  for (const hz of [50, 60, 75, 144]) {
    const car = new DrivingController(road), clock = new FrameClock();
    try {
      // Balance drag against the throttle so the car holds exactly 24 m/s and
      // the distance it has covered follows from the time that has passed.
      car.speed = 24;
      const forward = (DRAG.rolling + DRAG.air * 24 * 24) / car.stats.acceleration;
      for (let frame = 0; frame <= hz; frame++) {
        const time = frame * 1000 / hz;
        clock.tick(time, true, dt => car.update(dt, { forward }));
        car.render(clock.alpha);
        if (frame < 2) continue;
        assert.ok(Math.abs(-car.car.position.z - (24 + 24 * time / 1000)) < 1e-9,
          `${hz} Hz frame ${frame}: drawn ${(-car.car.position.z).toFixed(4)} m, ${(24 + 24 * time / 1000).toFixed(4)} m simulated`);
      }
    } finally { car.disposeModel(); }
  }
});

test('a collision correction cannot throw the drawn body ahead of the car', () => {
  const car = new DrivingController(road, {}, 'taxi');
  try {
    car.speed = 30;
    car.update(PHYSICS_STEP, { forward: 1 });
    // Shove the car a long way in one step, as a deep overlap would.
    car.s += 12; car.update(0, {}); car.copyPose(car.previousPose, { ...car.currentPose, position: car.currentPose.position.clone().setZ(car.currentPose.position.z + 12) });
    car.render(1);
    assert.ok(car.car.position.distanceTo(car.currentPose.position) <= .5 + 1e-9,
      'the projection is capped at half a metre');
  } finally { car.disposeModel(); }
});

test('the chase lens opens with speed and settles back down again', () => {
  const car = new DrivingController(road, {}, 'taxi'), rig = new ThirdPersonCamera();
  try {
    rig.resize(16 / 9);
    car.update(0, {});
    rig.update(car.car, 0);
    const parked = { fov: rig.camera.fov, back: rig.camera.position.distanceTo(car.car.position) };
    car.speed = car.stats.topSpeed; car.update(0, {});
    for (let tick = 0; tick < 240; tick++) rig.update(car.car, 1 / 60);
    assert.ok(rig.camera.fov > parked.fov * 1.05, 'the lens should widen at speed');
    assert.ok(rig.camera.position.distanceTo(car.car.position) > parked.back + 1.5, 'the seat should slide back');
    car.speed = 0; car.update(0, {});
    for (let tick = 0; tick < 480; tick++) rig.update(car.car, 1 / 60);
    assert.ok(Math.abs(rig.camera.fov - parked.fov) < .05, 'and return to normal when stopped');
    car.speed = car.stats.topSpeed * .35; car.update(0, {});
    for (let tick = 0; tick < 240; tick++) rig.update(car.car, 1 / 60);
    assert.ok(Math.abs(rig.camera.fov - parked.fov) < .02, 'a junction crawl must still look like a junction crawl');
  } finally { car.disposeModel(); }
});

test('a handbrake tap and a steering input start a slide in either order', () => {
  for (const order of ['handbrake first', 'steering first', 'together']) {
    const car = new DrivingController(road, {}, 'taxi');
    try {
      car.speed = 18;
      const step = input => { car.speed = 18; car.update(PHYSICS_STEP, { forward: 1, ...input }); };
      if (order === 'handbrake first') {
        for (let tick = 0; tick < 6; tick++) step({ handbrake: true });
        for (let tick = 0; tick < 6; tick++) step({});
        for (let tick = 0; tick < 12; tick++) step({ right: 1 });
      } else if (order === 'steering first') {
        for (let tick = 0; tick < 12; tick++) step({ right: 1 });
        for (let tick = 0; tick < 6; tick++) step({ right: 1, handbrake: true });
      } else {
        for (let tick = 0; tick < 12; tick++) step({ right: 1, handbrake: true });
      }
      assert.ok(car.drifting, `${order}: no slide`);
      assert.equal(car.driftDirection, 1);
    } finally { car.disposeModel(); }
  }
});

test('the armed window closes, so an old handbrake tap cannot start a later slide', () => {
  const car = new DrivingController(road, {}, 'taxi');
  try {
    car.speed = 18;
    const step = input => { car.speed = 18; car.update(PHYSICS_STEP, { forward: 1, ...input }); };
    for (let tick = 0; tick < 6; tick++) step({ handbrake: true });
    for (let tick = 0; tick < 120; tick++) step({});
    for (let tick = 0; tick < 30; tick++) step({ right: 1 });
    assert.equal(car.drifting, false);
  } finally { car.disposeModel(); }
});
