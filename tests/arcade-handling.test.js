import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_IDS } from '../src/cars.js';
import { DrivingController } from '../src/vehicle.js';
import { FrameClock, PHYSICS_STEP } from '../src/timing.js';
import { DriveSoundModel } from '../src/audio/model.js';

const road = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0, bounds: () => [-10000, 10000],
  looseness: () => 0, laneAssist: false,
};
function advance(car, seconds, input, hz = 120) {
  for (let remaining = seconds; remaining > 1e-10;) {
    const dt = Math.min(remaining, 1 / hz);
    car.update(dt, input); remaining -= dt;
  }
}

test('every car can carry a tapped powerslide in either direction without holding handbrake', () => {
  for (const id of CAR_IDS) for (const arcade of [false, true]) for (const sign of [-1, 1]) {
    const car = new DrivingController(road, {}, id); car.arcade = arcade;
    const turn = { forward: 1, left: sign < 0, right: sign > 0 };
    try {
      car.speed = 16;
      advance(car, .1, { ...turn, handbrake: true });
      advance(car, .7, turn);
      assert.ok(car.drifting, `${id}: tap should carry the slide`);
      assert.ok(car.slip * sign > .12 && car.slip * sign <= .55 + 1e-12, `${id}: useful, bounded slip`);
      assert.ok(car.speed > 12, `${id}: powerslide should preserve useful exit speed`);
      assert.equal(car.audioTelemetry.handbrake, 0);
      assert.equal(car.audioTelemetry.throttle, 1, 'engine remains under power');
      assert.ok(car.audioTelemetry.slip > .12, 'tire sound follows the actual slide');
      advance(car, .2, { forward: 1 });
      assert.equal(car.drifting, false);
      assert.ok(Math.abs(car.slip) < .035, `${id}: straightening catches the slide`);
    } finally { car.disposeModel(); }
  }
});

test('lifting, braking, centering and countersteering each end a slide across frame rates', () => {
  for (const hz of [30, 60, 120, 144]) for (const input of [
    { right: 1 }, { brake: 1, right: 1 }, { forward: 1 }, { forward: 1, left: 1 },
  ]) {
    const car = new DrivingController(road, {}, 'taxi');
    try {
      car.speed = 18;
      advance(car, .7, { forward: 1, right: 1, handbrake: true }, hz);
      const before = Math.abs(car.slip);
      advance(car, .2, input, hz);
      assert.equal(car.drifting, false);
      assert.ok(Math.abs(car.slip) < before * .25, `${hz} Hz: recovery failed for ${JSON.stringify(input)}`);
    } finally { car.disposeModel(); }
  }
});

test('drift entry is deliberate and cannot relatch after countersteering a held handbrake', () => {
  const car = new DrivingController(road, {}, 'taxi');
  try {
    for (const speed of [-5, 0, 5, 25]) {
      car.reset(); car.speed = speed;
      advance(car, .1, { forward: speed > 0, right: 1, handbrake: speed < 8 });
      assert.equal(car.drifting, false, `unexpected drift at ${speed}`);
    }
    car.reset(); car.speed = 18;
    advance(car, .5, { forward: 1, right: 1, handbrake: true });
    advance(car, .1, { forward: 1, left: 1, handbrake: true });
    assert.equal(car.drifting, false, 'countersteer must catch, not switch to a new drift');
    advance(car, .05, { forward: 1, left: 1 });
    advance(car, .1, { forward: 1, left: 1, handbrake: true });
    assert.equal(car.driftDirection, -1, 'a fresh tap can deliberately start the other slide');
    car.reset();
    assert.equal(car.driftDirection, 0); assert.equal(car.slip, 0); assert.equal(car.driftReady, true);
  } finally { car.disposeModel(); }
});

test('handbrake holds a powered car still and brakes beat gas in both modes', () => {
  for (const arcade of [false, true]) for (const hz of [30, 120, 144]) {
    const car = new DrivingController(road, {}, 'taxi'); car.arcade = arcade;
    try {
      car.speed = 18;
      advance(car, 2, { forward: 1, handbrake: true, boost: true }, hz);
      assert.equal(car.speed, 0);
      const s = car.s;
      advance(car, 1, { forward: 1, handbrake: true }, hz);
      assert.equal(car.s, s, 'no bouncing against the parking brake');
      advance(car, 1, { brake: 1, handbrake: true }, hz);
      assert.equal(car.s, s, 'handbrake also holds against reverse');
      car.speed = 18;
      advance(car, .3, { forward: 1, brake: 1, boost: true }, hz);
      assert.ok(car.speed < 9, 'braking overrides throttle and boost');
    } finally { car.disposeModel(); }
  }
});

test('steering and a tapped slide follow the same path at 30–240 Hz display rates', () => {
  let reference;
  for (const hz of [30, 60, 75, 120, 144, 165, 240]) {
    const car = new DrivingController(road, {}, 'taxi'), clock = new FrameClock();
    let ticks = 0;
    try {
      car.speed = 16;
      for (let frame = 0; frame <= hz * 3; frame++) {
        clock.tick(frame * 1000 / hz, true, dt => {
          car.update(dt, { forward: 1, right: ticks >= 30 && ticks < 150,
            handbrake: ticks >= 60 && ticks < 72, left: ticks >= 180 && ticks < 205 });
          ticks++;
        });
        car.render(clock.alpha);
      }
      assert.equal(ticks, 3 / PHYSICS_STEP);
      const result = [car.s, car.u, car.speed, car.heading, car.slip];
      reference ??= result;
      assert.deepEqual(result, reference, `${hz} Hz changes the driving path`);
    } finally { car.disposeModel(); }
  }
});

test('tire sound continues through a powered slide and fades when traction returns', () => {
  const model = new DriveSoundModel();
  const grip = model.update({ speed: 18, steer: .5, throttle: 1 });
  const slide = model.update({ speed: 18, steer: .5, throttle: 1, slip: .3 });
  assert.ok(slide.skidLevel > grip.skidLevel + .02);
  assert.equal(model.update({ speed: 0, slip: .3 }).skidLevel, 0);
});
