import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_IDS, carStats } from '../src/cars.js';
import { turningRadius, turnRate, corneringLoad } from '../src/handling.js';
import { DrivingController } from '../src/vehicle.js';

const road = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0, bounds: () => [-1e4, 1e4],
  looseness: () => 0, laneAssist: false,
};
const hold = (car, seconds, input, speed = null, hz = 120) => {
  for (let remaining = seconds; remaining > 1e-10; remaining -= 1 / hz) {
    if (speed !== null) car.speed = speed;
    car.update(Math.min(1 / hz, remaining), input);
  }
};

test('the brakes tighten the line and power runs it wide, for every car', () => {
  for (const id of CAR_IDS) {
    const stats = carStats(id), speed = Math.min(18, stats.topSpeed * .6);
    const free = turningRadius(speed, stats), onBrakes = turningRadius(speed, stats, 0, 1), onPower = turningRadius(speed, stats, 0, -1);
    assert.ok(onBrakes < free && free < onPower, `${id}: weight transfer has no effect`);
    // Enough to feel and to reward committing to a corner, never enough to
    // turn the brake pedal into a second steering wheel.
    assert.ok(onBrakes > free * .82, `${id}: braking bends the line by ${(100 - onBrakes / free * 100).toFixed(0)}%`);
    assert.ok(onPower < free * 1.14, `${id}: throttle washes out by ${(onPower / free * 100 - 100).toFixed(0)}%`);
  }
});

test('braking into a bend turns the car in tighter than coasting through it', () => {
  const turn = (input, speed = 16) => {
    const car = new DrivingController(road, {}, 'taxi');
    try {
      car.speed = speed;
      // Settle the weight first: it shifts over about a tenth of a second.
      hold(car, .3, { ...input }, speed);
      const before = car.heading;
      hold(car, .2, { ...input, right: 1 }, speed);
      return car.heading - before;
    } finally { car.disposeModel(); }
  };
  const coasting = turn({}), braking = turn({ brake: 1 }), powering = turn({ forward: 1 });
  assert.ok(braking > coasting * 1.04, `braking should bite: ${braking.toFixed(4)} vs ${coasting.toFixed(4)}`);
  assert.ok(powering < coasting, `full power should push wide: ${powering.toFixed(4)} vs ${coasting.toFixed(4)}`);
});

test('rolling resistance and loose ground are not a brake pedal', () => {
  // Weight transfer follows the pedals, so leaving the road must cost grip
  // rather than handing the front tires more of it.
  const car = new DrivingController({ ...road, looseness: () => 1 }, {}, 'auto');
  try {
    car.freeDriving = true;
    hold(car, .5, { right: 1 }, 16);
    assert.ok(car.weight <= 0, `grass counted as braking: ${car.weight}`);
  } finally { car.disposeModel(); }
  // Nor does the brake pedal used as a reverse throttle.
  const reversing = new DrivingController(road, {}, 'auto');
  try {
    hold(reversing, .5, { brake: 1 });
    assert.ok(reversing.speed < -1 && reversing.weight < 0, `reverse throttle counted as braking: ${reversing.weight}`);
  } finally { reversing.disposeModel(); }
});

test('cornering load reaches the tires limit at full lock and stays there', () => {
  for (const id of CAR_IDS) {
    const stats = carStats(id);
    for (const speed of [4, 10, 18, stats.topSpeed]) for (const bias of [-1, 0, 1]) {
      const load = corneringLoad(speed, turnRate(speed, 1, stats, 0, 0, bias), stats, 0, bias);
      assert.ok(load >= 0 && load <= 1, `${id} at ${speed}: load ${load}`);
      assert.ok(corneringLoad(speed, turnRate(speed, .2, stats, 0, 0, bias), stats, 0, bias) < load + 1e-12,
        `${id} at ${speed}: a small correction works the tires as hard as full lock`);
    }
    assert.ok(corneringLoad(stats.topSpeed, turnRate(stats.topSpeed, 1, stats), stats) > .9,
      `${id}: full lock at top speed should be at the limit`);
  }
});
