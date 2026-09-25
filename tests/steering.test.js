import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_IDS, DRAG } from '../src/cars.js';
import { DrivingController } from '../src/vehicle.js';
import { steerCurve } from '../src/handling.js';

const road = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0,
  bounds: () => [-1000, 1000],
  looseness: () => 0,
  laneAssist: false,
};

// Balance drag with the pedals so each trial measures steering at a known
// speed, including the distance spent taking up steering and arcade slip.
function holdSpeed(car, speed, dt, input) {
  car.speed = speed;
  const drag = DRAG.rolling + DRAG.air * speed * speed;
  const launch = 1 + .22 * Math.max(0, 1 - speed / 12);
  const pedals = speed === 0 ? {} : speed < 0 ? { brake: drag / car.stats.creep } : { forward: drag / (car.stats.acceleration * launch) };
  car.update(dt, { ...pedals, ...input });
}

test('every car makes a compact quarter turn at city speeds in both driving modes', () => {
  for (const id of CAR_IDS) for (const arcade of [false, true]) {
    const car = new DrivingController(road, {}, id);
    car.arcade = arcade;
    try {
      for (const hz of [30, 60, 144]) for (const speed of [3, 6, 10]) for (const direction of [-1, 1]) {
        car.reset(); car.s = 0; car.u = 0; car.update(0, {});
        const input = direction > 0 ? { right: 1 } : { left: 1 };
        let ticks = 0;
        while (Math.abs(car.heading) < Math.PI / 2 && ticks++ < hz * 8) holdSpeed(car, speed, 1 / hz, input);
        const label = `${id}, arcade=${arcade}, ${speed} m/s, ${hz} Hz, direction=${direction}`;
        assert.ok(car.heading * direction >= Math.PI / 2, `${label}: did not complete the turn`);
        const limit = speed <= 6 ? 7 : 10;
        assert.ok(car.s < limit && Math.abs(car.u) < limit,
          `${label}: turn needs ${car.s.toFixed(2)} by ${Math.abs(car.u).toFixed(2)} metres`);
      }
    } finally { car.disposeModel(); }
  }
});

test('every car keeps precise analog steering, reverse steering and highway stability', () => {
  for (const id of CAR_IDS) {
    const car = new DrivingController(road, {}, id);
    try {
      const yaw = (speed, steering) => {
        car.reset(); car.steer = steering;
        holdSpeed(car, speed, 1 / 60, { right: Math.max(0, steering), left: Math.max(0, -steering) });
        return car.heading * 60;
      };
      assert.equal(yaw(0, 1), 0, `${id}: turns while stationary`);
      assert.ok(Math.abs(yaw(-3, 1) + yaw(3, 1)) < 1e-10, `${id}: reverse turn differs from forward`);
      const half = yaw(6, .5), full = yaw(6, 1);
      assert.ok(half > full * .3 && half < full * .45, `${id}: half stick should favor fine control`);
      assert.ok(Math.abs(yaw(6, -1) + yaw(6, 1)) < 1e-10, `${id}: left and right differ`);
      for (const speed of [20, car.stats.topSpeed]) {
        assert.ok(yaw(speed, 1) * speed <= car.stats.cornering, `${id}: cornering force is unbounded`);
      }
      assert.ok(yaw(car.stats.topSpeed, 1) < Math.max(yaw(10, 1), yaw(15, 1), yaw(20, 1)), `${id}: top-speed steering must ease off`);
    } finally { car.disposeModel(); }
  }
});

test('steering responds within 40 ms and releases or reverses promptly in both modes', () => {
  for (const id of CAR_IDS) for (const arcade of [false, true]) {
    const car = new DrivingController(road, {}, id); car.arcade = arcade;
    try {
      for (const hz of [30, 60, 120, 144]) for (const amount of [.25, 1]) for (const direction of [-1, 1]) {
        car.reset();
        const label = `${id}, arcade=${arcade}, ${hz} Hz, input=${amount * direction}`;
        const turn = direction > 0 ? { right: amount } : { left: amount };
        const advance = (seconds, input) => {
          for (let elapsed = 0; elapsed < seconds - 1e-10;) {
            const dt = Math.min(1 / hz, seconds - elapsed);
            holdSpeed(car, 6, dt, input); elapsed += dt;
          }
        };
        // `steer` is the angle the wheels take: the request run through the
        // precision curve, which is where a stick's fine control lives.
        const lock = steerCurve(amount);
        advance(.04, turn);
        assert.ok(car.heading * direction > 0, `${label}: heading follows input`);
        assert.ok(car.steer * direction >= lock * .97, `${label}: turn-in exceeds 40 ms`);
        assert.ok(car.steer * direction <= lock, `${label}: steering overshoots`);
        advance(.03, {});
        assert.ok(Math.abs(car.steer) < lock * .1, `${label}: release carries on turning`);
        advance(.3, turn);
        const heading = car.heading;
        advance(1 / 120, direction > 0 ? { left: amount } : { right: amount });
        assert.ok(car.steer * direction < 0, `${label}: countersteering stays in the old direction`);
        assert.ok((car.heading - heading) * direction < 0, `${label}: countersteer must change yaw on the first tick`);
      }
    } finally { car.disposeModel(); }
  }
});

test('taxi tires recover direction promptly after releasing a handbrake drift', () => {
  for (const hz of [30, 60, 120, 144]) {
    const car = new DrivingController(road, {}, 'taxi'); car.arcade = true;
    try {
      for (let i = 0; i < hz; i++) holdSpeed(car, 15, 1 / hz, { right: 1, handbrake: true });
      const slip = Math.abs(car.heading - car.slideHeading);
      assert.ok(car.drifting && slip > .1, `${hz} Hz: handbrake still creates a drift`);
      // Center the wheels to isolate tire recovery from steering release.
      car.steer = 0;
      for (let elapsed = 0; elapsed < .2 - 1e-10;) {
        const dt = Math.min(1 / hz, .2 - elapsed);
        holdSpeed(car, 15, dt, {}); elapsed += dt;
      }
      assert.equal(car.drifting, false);
      assert.ok(Math.abs(car.heading - car.slideHeading) < slip * .1, `${hz} Hz: tires still sliding after 200 ms`);
    } finally { car.disposeModel(); }
  }
});

test('handbrake slides build progressively, stay bounded and reset cleanly in both modes', () => {
  for (const arcade of [false, true]) {
    const car = new DrivingController(road, {}, 'taxi'); car.arcade = arcade;
    try {
      holdSpeed(car, 18, 1 / 120, { right: 1, handbrake: true });
      assert.ok(car.driftAmount > 0 && car.driftAmount < .1, 'no instant switch to full drift');
      for (let i = 0; i < 360; i++) {
        holdSpeed(car, 18, 1 / 120, { right: 1, handbrake: true });
        const slip = Math.atan2(Math.sin(car.heading - car.slideHeading), Math.cos(car.heading - car.slideHeading));
        assert.ok(Math.abs(slip) <= .55 + 1e-12, 'holding drift must not cause an uncontrolled spin');
      }
      assert.ok(car.drifting && car.heading - car.slideHeading > .15);
      // The velocity used by collisions must agree with actual sliding motion.
      const s = car.s, u = car.u;
      holdSpeed(car, 18, 1 / 120, { right: 1, handbrake: true });
      assert.ok(Math.abs((car.u - u) * 120 - car.velocity.x) < 1e-8);
      assert.ok(Math.abs(-(car.s - s) * 120 - car.velocity.z) < 1e-8);
      const velocity = car.velocity;
      car.resolveTrafficCollision(0, 0, 2, -1);
      assert.ok(Math.abs(car.velocity.x - velocity.x - 2) < 1e-8, 'impact preserves world velocity during a slide');
      assert.ok(Math.abs(car.velocity.z - velocity.z + 1) < 1e-8);
      car.reset();
      assert.equal(car.driftAmount, 0); assert.equal(car.drifting, false);
      assert.equal(car.slideHeading, car.heading);
      car.speed = 18;
      for (let i = 0; i < 240; i++) car.update(1 / 120, { handbrake: true });
      assert.equal(car.speed, 0, 'straight handbrake still stops the car');
      assert.equal(car.drifting, false);
    } finally { car.disposeModel(); }
  }
});

test('steering strength changes smoothly throughout the speed range', () => {
  const car = new DrivingController(road, {}, 'taxi');
  try {
    let previous = 0;
    for (let speed = 0; speed <= car.stats.topSpeed; speed += .1) {
      car.reset(); car.steer = 1;
      holdSpeed(car, speed, 1 / 120, { right: 1 });
      const yaw = car.heading * 120;
      assert.ok(Math.abs(yaw - previous) < .03, `steering jumps at ${speed} m/s`);
      previous = yaw;
    }
  } finally { car.disposeModel(); }
});
