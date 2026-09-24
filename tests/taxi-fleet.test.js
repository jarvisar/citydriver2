import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiFleet, TAXI_FLEET, FLEET_KEY } from '../src/taxi-fleet.js';
import { TaxiRun } from '../src/taxi-run.js';
import { CARS } from '../src/cars.js';
import { DrivingController, createCar } from '../src/vehicle.js';
import { engineFor } from '../src/audio/profiles.js';

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };

test('fleet purchases deduct once, persist ownership and keep score separate from savings', () => {
  const disk = storage(), fleet = new TaxiFleet(disk);
  assert.deepEqual([...fleet.owned], ['taxi']);
  assert.equal(fleet.buy('taxiGT'), false);
  assert.equal(fleet.select('taxiFormula'), false);
  assert.equal(fleet.buy('sports'), false);
  fleet.credit(1499); assert.equal(fleet.buy('taxiGT'), false);
  fleet.credit(1); assert.equal(fleet.buy('taxiGT'), true);
  assert.equal(fleet.balance, 0); assert.equal(fleet.selected, 'taxiGT');
  assert.equal(fleet.buy('taxiGT'), false);
  fleet.credit(4500); assert.equal(fleet.buy('taxiFormula'), true);
  fleet.select('taxi');
  const loaded = new TaxiFleet(disk);
  assert.equal(loaded.balance, 0); assert.equal(loaded.selected, 'taxi');
  assert.deepEqual([...loaded.owned], TAXI_FLEET.map(cab => cab.id));
  assert.equal(loaded.select('taxiFormula'), true);
  assert.equal(new TaxiFleet(disk).selected, 'taxiFormula');
  assert.equal(disk.getItem('citydriver-taxi-best'), null);
});

test('a driver can save directly for Formula, and malformed saves cannot unlock non-fleet cars', () => {
  const disk = storage(), fleet = new TaxiFleet(disk);
  fleet.credit(4500); assert.equal(fleet.buy('taxiFormula'), true);
  assert.equal(fleet.owned.has('taxiGT'), false);
  for (const data of ['broken', 'null', '{"version":1,"balance":-1}', '{"version":2,"balance":9999}']) {
    disk.setItem(FLEET_KEY, data);
    assert.equal(new TaxiFleet(disk).balance, 0);
  }
  disk.setItem(FLEET_KEY, JSON.stringify({ version: 1, balance: 321, owned: ['sports'], selected: 'taxiFormula' }));
  const loaded = new TaxiFleet(disk);
  assert.equal(loaded.balance, 321); assert.equal(loaded.selected, 'taxi');
  assert.deepEqual([...loaded.owned], ['taxi']);
  for (const amount of [-1, NaN, Infinity, 1.1, '50']) assert.equal(loaded.credit(amount), false);
  const unavailable = new TaxiFleet({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  unavailable.credit(1500); assert.equal(unavailable.buy('taxiGT'), true); assert.equal(unavailable.saved, false);
});

test('completed fares bank exactly once and survive restart, abandonment, expiry and reload', () => {
  const disk = storage(), run = new TaxiRun(disk);
  const player = { s: 25, u: 3, heading: 0, speed: 0 };
  // A solo rider pays at their one stop; a group would hold its fare until the last.
  // (not one the cab started beside, who waits until it has driven off)
  const solo = () => run.customers.find(customer => customer.passengers === 1 && customer.id !== run.blockedPickup?.id) ?? run.customers.find(customer => customer.id !== run.blockedPickup?.id);
  run.start(player); Object.assign(player, solo()); run.update(.5, player);
  assert.equal(run.status, 'driving'); assert.equal(run.fleet.balance, 0);
  Object.assign(player, { s: run.target.s, u: run.target.u }); run.update(.5, player);
  const paid = run.cash; assert.ok(paid > 0);
  assert.equal(run.fleet.balance, paid); assert.equal(new TaxiRun(disk).fleet.balance, paid);
  run.update(.5, player); assert.equal(run.fleet.balance, paid);
  run.finish(); run.finish(); assert.equal(run.fleet.balance, paid);
  run.start(player); assert.equal(run.cash, 0); assert.equal(run.fleet.balance, paid);
  Object.assign(player, solo()); run.update(.5, player);
  run.fareLeft = .01; run.update(.02, player); assert.equal(run.fleet.balance, paid);
  run.stop(); assert.equal(run.fleet.balance, paid);
  assert.equal(new TaxiRun(disk).best, paid);
});

const straight = { frame: () => ({ angle: 0, scale: 1 }), position: (s, u) => ({ x: u, y: 0, z: -s }), height: () => 0, bounds: () => [-100, 100] };
test('upgrades actually cover a block faster, brake harder and turn tighter at every tick rate', () => {
  for (const hz of [30, 60, 144]) {
    const results = TAXI_FLEET.map(({ id }) => {
      const car = new DrivingController(straight, {}, id); car.arcade = true;
      try {
        car.s = 0; car.speed = 0;
        let sprint = 0;
        while (car.s < 300 && sprint < 30) { car.update(1 / hz, { forward: 1 }); sprint += 1 / hz; }
        car.speed = 30; const start = car.s;
        for (let i = 0; i < hz * 3 && car.speed > .1; i++) car.update(1 / hz, { brake: 1 });
        return { sprint, braking: car.s - start, radius: car.stats.turnRadius };
      } finally { car.disposeModel(); }
    });
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i].sprint < results[i - 1].sprint * .94, `upgrade ${i} must save useful block time at ${hz} Hz`);
      assert.ok(results[i].braking < results[i - 1].braking);
      assert.ok(results[i].radius < results[i - 1].radius);
    }
  }
  assert.equal(CARS.taxiFormula.stats.topSpeed, CARS.formula.stats.topSpeed);
  assert.equal(CARS.taxiFormula.stats.acceleration, CARS.formula.stats.acceleration);
  assert.ok(CARS.taxi.stats.topSpeed >= 42 * .95, 'starter keeps at least 95% of its old speed');
  assert.ok(CARS.taxi.stats.acceleration >= 22 * .95);
});

test('taxi variants carry their sports engine voices, taxi signs, and two-seat Formula cockpit', () => {
  assert.equal(engineFor('taxiGT'), engineFor('sports'));
  assert.equal(engineFor('taxiFormula'), engineFor('formula'));
  const sports = createCar('taxiGT'), formula = createCar('taxiFormula');
  try {
    assert.ok(sports.car.getObjectByName('taxi-sign'));
    assert.equal(formula.car.userData.seats, 2);
    assert.equal(formula.nightLights.length, 2);
    assert.ok(CARS.taxiFormula.shape.cabin[0] > CARS.formula.shape.cabin[0] * 1.5);
  } finally { sports.disposeModel(); formula.disposeModel(); }
});
