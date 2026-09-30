import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_IDS } from '../src/cars.js';
import { DrivingController } from '../src/vehicle.js';
import { FrameClock, PHYSICS_STEP } from '../src/timing.js';

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

test('every car drifts either way while the button is held, and straightens as soon as it is let go', () => {
  for (const id of CAR_IDS) for (const arcade of [false, true]) for (const sign of [-1, 1]) {
    const car = new DrivingController(road, {}, id); car.arcade = arcade;
    const turn = { forward: 1, left: sign < 0, right: sign > 0 };
    try {
      car.speed = 16;
      advance(car, .8, { ...turn, handbrake: true });
      assert.ok(car.drifting && car.driftDirection === sign, `${id}: holding the button and steering drifts`);
      assert.ok(car.slip * sign > .12 && car.slip * sign <= .35, `${id}: the nose points in, not far (inside drift)`);
      assert.ok(car.speed > 15, `${id}: a drift keeps its speed`);
      assert.equal(car.audioTelemetry.handbrake, 0, 'the handbrake is not on');
      assert.equal(car.audioTelemetry.throttle, 1, 'engine remains under power');
      advance(car, .2, { forward: 1 });
      assert.equal(car.drifting, false);
      assert.ok(Math.abs(car.slip) < .035, `${id}: letting go catches the slide`);
    } finally { car.disposeModel(); }
  }
});

test('a drift holds through lifting, braking and steering either way, and only letting go ends it, across frame rates', () => {
  for (const hz of [30, 60, 120, 144]) for (const input of [
    { right: 1 }, { brake: 1, right: 1 }, { forward: 1 }, { forward: 1, left: 1 },
  ]) {
    const car = new DrivingController(road, {}, 'taxi');
    try {
      car.speed = 18;
      advance(car, .5, { forward: 1, right: 1, handbrake: true }, hz);
      advance(car, .2, { ...input, handbrake: true }, hz);
      assert.ok(car.drifting && car.driftDirection === 1, `${hz} Hz: ${JSON.stringify(input)} ended the drift`);
      const before = Math.abs(car.slip);
      advance(car, .2, input, hz);
      assert.equal(car.drifting, false);
      assert.ok(Math.abs(car.slip) < before * .25, `${hz} Hz: recovery failed for ${JSON.stringify(input)}`);
    } finally { car.disposeModel(); }
  }
});

test('a drift needs the button held and some speed, keeps its way until let go, and a fresh press can go the other way', () => {
  const car = new DrivingController(road, {}, 'taxi');
  try {
    for (const [speed, handbrake] of [[-5, true], [0, true], [5, true], [25, false]]) {
      car.reset(); car.speed = speed;
      advance(car, .1, { forward: speed > 0, right: 1, handbrake });
      assert.equal(car.drifting, false, `unexpected drift at ${speed}`);
    }
    car.reset(); car.speed = 18;
    advance(car, .5, { forward: 1, right: 1, handbrake: true });
    advance(car, .3, { forward: 1, left: 1, handbrake: true });
    assert.equal(car.driftDirection, 1, 'steering out of a drift widens it rather than ending or reversing it');
    advance(car, .05, { forward: 1, left: 1 });
    assert.equal(car.drifting, false);
    advance(car, .1, { forward: 1, left: 1, handbrake: true });
    assert.equal(car.driftDirection, -1, 'a fresh press starts the other way');
    car.reset();
    assert.equal(car.driftDirection, 0); assert.equal(car.slip, 0); assert.equal(car.drift.charge, 0);
  } finally { car.disposeModel(); }
});

test('stop holds a powered car still at any speed, the drift button only when too slow to drift, and brakes beat gas', () => {
  for (const arcade of [false, true]) for (const hz of [30, 120, 144]) {
    const car = new DrivingController(road, {}, 'taxi'); car.arcade = arcade;
    try {
      car.speed = 18;
      advance(car, .5, { forward: 1, handbrake: true }, hz);
      assert.ok(car.speed > 17, 'the drift button at speed is no brake');
      advance(car, 2, { forward: 1, stop: true, boost: true }, hz);
      assert.equal(car.speed, 0);
      let s = car.s;
      advance(car, 1, { forward: 1, stop: true }, hz);
      assert.equal(car.s, s, 'no bouncing against the parking brake');
      car.speed = 6;
      advance(car, 1, { forward: 1, handbrake: true, boost: true }, hz);
      assert.equal(car.speed, 0, 'the drift button holds a slow car');
      s = car.s;
      advance(car, 1, { brake: 1, handbrake: true }, hz);
      assert.equal(car.s, s, 'handbrake also holds against reverse');
      car.speed = 18;
      advance(car, .3, { forward: 1, brake: 1, boost: true }, hz);
      assert.ok(car.speed < 9, 'braking overrides throttle and boost');
    } finally { car.disposeModel(); }
  }
});

test('steering and a drift follow the same path at 30–240 Hz display rates', () => {
  let reference;
  for (const hz of [30, 60, 75, 120, 144, 165, 240]) {
    const car = new DrivingController(road, {}, 'taxi'), clock = new FrameClock();
    let ticks = 0;
    try {
      car.speed = 16;
      for (let frame = 0; frame <= hz * 3; frame++) {
        clock.tick(frame * 1000 / hz, true, dt => {
          car.update(dt, { forward: 1, right: ticks >= 30 && ticks < 150,
            handbrake: ticks >= 60 && ticks < 150, left: ticks >= 180 && ticks < 205 });
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

test('boost works in free drive as well as a taxi run, needs the gas, and coasts back', () => {
  for (const arcade of [false, true]) {
    const car = new DrivingController(road, {}, 'taxi'); car.arcade = arcade;
    try {
      const top = car.stats.topSpeed;
      car.speed = top;
      advance(car, 1, { boost: true });
      assert.equal(car.boosting, false, `arcade=${arcade}: boost without gas`);
      car.speed = top;
      advance(car, 3, { forward: 1, boost: true });
      assert.ok(car.boosting && car.speed > top + 1, `arcade=${arcade}: boost should pass top speed`);
      const boosted = car.speed;
      advance(car, 1 / 120, { forward: 1 });
      assert.ok(car.speed > top && car.speed < boosted, `arcade=${arcade}: releasing boost coasts down, not snaps`);
    } finally { car.disposeModel(); }
  }
});
