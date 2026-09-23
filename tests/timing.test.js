import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameClock, PHYSICS_STEP } from '../src/timing.js';
import { DrivingController } from '../src/vehicle.js';

const straightRoute = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0,
  bounds: () => [-100, 100],
};

for (const hz of [30, 60, 75, 120, 144, 165, 240]) {
  test(`car advances on every display frame at ${hz} Hz with identical physics`, () => {
    const car = new DrivingController(straightRoute), clock = new FrameClock();
    car.speed = 28;
    let steps = 0, previousZ;
    for (let i = 0; i <= hz * 3; i++) {
      clock.tick(i * 1000 / hz, true, dt => { car.update(dt, { forward: true }); steps++; });
      car.render(clock.alpha);
      if (i > hz / 2) assert.ok(Math.abs(previousZ - car.car.position.z - 28 / hz) < 1e-9, `uneven movement at frame ${i}`);
      previousZ = car.car.position.z;
    }
    assert.equal(steps, 360);
    assert.ok(Math.abs(car.s - 108) < 1e-9);
    // Projected forward, not interpolated back: the display shows the car
    // where the simulation has it now, with no step of latency added.
    assert.ok(Math.abs(car.car.position.z + 108) < 1e-9);
  });
}

test('irregular display intervals and refresh-rate changes preserve smooth travel', () => {
  const car = new DrivingController(straightRoute), clock = new FrameClock();
  car.speed = 28;
  let timestamp = 0;
  clock.tick(0, true, dt => car.update(dt, { forward: true }));
  for (const interval of [7, 6, 9, 16, 8, 24, 4, 5, 12, 33, 7, 4, 6, 16]) {
    timestamp += interval;
    clock.tick(timestamp, true, dt => car.update(dt, { forward: true }));
    car.render(clock.alpha);
    if (timestamp > 17) assert.ok(Math.abs(car.car.position.z + 24 + 28 * (timestamp / 1000)) < 1e-9);
  }
});

test('rendering never feeds projected body, steering or wheels back into physics', () => {
  const a = new DrivingController(), b = new DrivingController();
  for (let i = 0; i < 500; i++) {
    const input = { forward: i < 250, brake: i >= 250, right: i % 80 < 20 };
    a.update(PHYSICS_STEP, input); b.update(PHYSICS_STEP, input);
    for (const alpha of [0, .2, .6, .9]) a.render(alpha, 1024);
  }
  assert.deepEqual(a.currentPose, b.currentPose);
  assert.equal(a.s, b.s); assert.equal(a.speed, b.speed);
});

test('reverse travel is projected between ticks and rebasing only changes local coordinates', () => {
  const car = new DrivingController(straightRoute);
  car.s = 1024; car.reset(); car.speed = -7;
  car.update(PHYSICS_STEP, { brake: true });
  car.render(.25, 1024); const z = car.car.position.z;
  car.render(.75, 1024); assert.ok(car.car.position.z > z);
  const globalZ = car.car.position.z - 1024;
  car.render(.75, 0); assert.ok(Math.abs(car.car.position.z - globalZ) < 1e-10);
  car.s = -1025; car.reset();
  for (const alpha of [0, .3, 1]) { car.render(alpha, -2048); assert.equal(car.car.position.z, -1023); }
  car.setRoute(straightRoute, { s: 9000 });
  car.render(0, 8192); assert.equal(car.car.position.z, -808);
});

test('pause and resume retain the displayed pose without catching up hidden time', () => {
  const clock = new FrameClock(); let steps = 0;
  const step = () => steps++;
  clock.tick(0, true, step); clock.tick(25, true, step);
  const alpha = clock.alpha;
  clock.suspend(); clock.tick(50000, false, step);
  assert.equal(clock.alpha, alpha); assert.equal(steps, 3);
  clock.suspend(); clock.tick(60000, true, step);
  assert.equal(clock.alpha, alpha); assert.equal(steps, 3);
  clock.tick(60005, true, step); assert.ok(clock.alpha > alpha);
  clock.tick(90000, true, step); assert.equal(steps, 15); // Catch-up is bounded after a stall.
  clock.reset(); clock.tick(100000, true, step);
  assert.equal(clock.alpha, 0); assert.equal(clock.dt, 0);
});

test('new steering is visible on the next 60 Hz frame without waiting an extra frame', () => {
  const car = new DrivingController({ ...straightRoute, laneAssist: false }), clock = new FrameClock();
  try {
    car.speed = 15;
    clock.tick(0, true, () => {});
    const before = car.car.quaternion.clone();
    clock.tick(1000 / 60, true, dt => car.update(dt, { right: 1 }));
    car.render(clock.alpha);
    assert.ok(before.angleTo(car.car.quaternion) > .001, 'steering should already be visible');
    assert.ok(PHYSICS_STEP <= 1 / 120, 'interpolation delay must not exceed 8.33 ms');
  } finally { car.disposeModel(); }
});
