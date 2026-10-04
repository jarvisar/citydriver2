import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiFleet, TAXI_FLEET, FLEET_KEY, KONAMI_PAY } from '../src/taxi-fleet.js';
import { TaxiRun } from '../src/taxi-run.js';
import { CARS, GARAGE_IDS, GARAGE_PRICES, GEAR, carPrice, testDrivePrice } from '../src/cars.js';
import { PAINT_PRICE, RAINBOW_PAINT } from '../src/car-paint.js';
import { DrivingController, createCar } from '../src/vehicle.js';
import { engineFor } from '../src/audio/profiles.js';

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };

test('fleet purchases deduct once, persist ownership and keep score separate from savings', () => {
  const disk = storage(), fleet = new TaxiFleet(disk), gt = carPrice('taxiGT');
  assert.deepEqual([...fleet.owned], ['taxi', 'coast'], 'the cab for shifts and the Surf Wagon for free drive');
  assert.equal(fleet.buy('taxiGT'), false);
  assert.equal(fleet.select('taxiFormula'), false);
  assert.equal(fleet.buy('sports'), false);
  fleet.credit(gt - 1); assert.equal(fleet.buy('taxiGT'), false);
  fleet.credit(1); assert.equal(fleet.buy('taxiGT'), true);
  assert.equal(fleet.balance, 0); assert.equal(fleet.selected, 'taxiGT');
  assert.equal(fleet.buy('taxiGT'), false);
  fleet.credit(carPrice('taxiFormula')); assert.equal(fleet.buy('taxiFormula'), true);
  fleet.select('taxi');
  const loaded = new TaxiFleet(disk);
  assert.equal(loaded.balance, 0); assert.equal(loaded.selected, 'taxi');
  assert.deepEqual([...loaded.owned], ['taxi', 'coast', 'taxiGT', 'taxiFormula']);
  assert.equal(loaded.select('taxiFormula'), true);
  assert.equal(new TaxiFleet(disk).selected, 'taxiFormula');
  assert.equal(disk.getItem('citydriver-taxi-best'), null);
});

test('a driver can save directly for Formula, and malformed saves cannot unlock cars', () => {
  const disk = storage(), fleet = new TaxiFleet(disk);
  fleet.credit(carPrice('taxiFormula')); assert.equal(fleet.buy('taxiFormula'), true);
  assert.equal(fleet.owned.has('taxiGT'), false);
  for (const data of ['broken', 'null', '{"version":1,"balance":-1}', '{"version":2,"balance":-1}', '{"version":3,"balance":9999}']) {
    disk.setItem(FLEET_KEY, data);
    assert.equal(new TaxiFleet(disk).balance, 0);
  }
  disk.setItem(FLEET_KEY, JSON.stringify({ version: 1, balance: 321, owned: ['sports'], selected: 'taxiFormula' }));
  const loaded = new TaxiFleet(disk);
  assert.equal(loaded.balance, 321); assert.equal(loaded.selected, 'taxi');
  assert.deepEqual([...loaded.owned], ['taxi', 'coast']);
  for (const amount of [-1, NaN, Infinity, 1.1, '50']) assert.equal(loaded.credit(amount), false);
  disk.setItem(FLEET_KEY, JSON.stringify({ version: 2, balance: 5, owned: ['plane', 'auto', 'nope'], selected: 'plane', goal: 'plane', tried: ['nope', 'formula'] }));
  const odd = new TaxiFleet(disk);
  assert.deepEqual([...odd.owned], ['taxi', 'coast', 'plane'], 'only cars the garage sells');
  assert.equal(odd.selected, 'taxi', 'only a cab works shifts'); assert.equal(odd.goal, null, 'no saving for a car already owned');
  assert.deepEqual([...odd.tried], ['formula']);
  const unavailable = new TaxiFleet({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  unavailable.credit(carPrice('taxiGT')); assert.equal(unavailable.buy('taxiGT'), true); assert.equal(unavailable.saved, false);
});

test('fleet saves ignore malformed and inherited shop IDs without losing valid progress', () => {
  const disk = storage(), malformed = { toString: null };
  const invalid = [malformed, {}, ['taxiGT'], null, 42, 'constructor', '__proto__', 'toString'];
  for (const id of invalid) assert.equal(carPrice(id), null);
  for (const version of [1, 2]) {
    disk.setItem(FLEET_KEY, JSON.stringify({ version, balance: 321, owned: ['taxiGT', ...invalid],
      tried: ['helicopter', ...invalid], selected: malformed, goal: malformed, paint: malformed }));
    const fleet = new TaxiFleet(disk);
    assert.equal(fleet.balance, 321);
    assert.deepEqual([...fleet.owned], ['taxi', 'coast', 'taxiGT']);
    assert.equal(fleet.selected, 'taxi'); assert.equal(fleet.goal, null); assert.equal(fleet.paint, null);
    assert.deepEqual([...fleet.tried], version === 2 ? ['helicopter'] : []);
    assert.equal(fleet.buy(malformed), false); assert.equal(fleet.buy('constructor'), false);
    assert.equal(fleet.setGoal(malformed), false); assert.equal(fleet.testDrive(malformed), false);
    assert.equal(fleet.credit(1), true);
    assert.equal(new TaxiFleet(disk).balance, 322);
  }
  const fleet = new TaxiFleet(disk);
  disk.setItem(FLEET_KEY, JSON.stringify({ version: 2, balance: 654, owned: ['taxiFormula', ...invalid],
    tried: ['plane', ...invalid], selected: malformed, goal: malformed }));
  assert.doesNotThrow(() => fleet.credit(1), 'a corrupt save from another tab is safe too');
  assert.equal(fleet.balance, 655);
  assert.deepEqual([...fleet.owned], ['taxi', 'coast', 'taxiFormula']);
  assert.deepEqual([...fleet.tried], ['plane']);
});

test('the garage sells every car but the starting cab, cheapest in the traffic and dearest in the air', () => {
  for (const id of GARAGE_IDS) assert.ok(Number.isSafeInteger(GARAGE_PRICES[id]) && GARAGE_PRICES[id] >= 0, `${id} has a price`);
  assert.equal(carPrice('taxi'), 0); assert.equal(carPrice('auto'), null, 'retired cars are not for sale');
  const fleet = new TaxiFleet(), dearest = Math.max(...GARAGE_IDS.map(carPrice));
  assert.ok(carPrice('plane') === dearest && carPrice('helicopter') > carPrice('formula'), 'the aircraft are the long goal');
  for (const id of ['hatchback', 'sedan', 'wagon', 'pickup', 'van']) assert.ok(carPrice(id) < carPrice('sports'), `${id} can be borrowed from the traffic, so it is cheap`);
  fleet.credit(carPrice('sports')); assert.equal(fleet.buy('sports'), true);
  assert.equal(fleet.selected, 'taxi', 'buying a car keeps the shift cab'); assert.equal(fleet.select('sports'), false);
  for (const id of Object.keys(GEAR)) assert.ok(carPrice(id) > carPrice('exotic') && carPrice(id) < carPrice('helicopter'), `${id} costs a decent penny, less than an aircraft`);
  fleet.credit(carPrice('jetpack')); assert.equal(fleet.buy('jetpack'), true); assert.equal(fleet.select('jetpack'), false);
  assert.equal(fleet.testDriveCost('jetpack'), null, 'nothing to try once it is yours');
});

test('paint costs a little, a car\'s own colour is free, and each Konami entry adds money and unlocks the rainbow', () => {
  const disk = storage(), fleet = new TaxiFleet(disk);
  assert.equal(fleet.setPaint('#123456'), false, 'not without the money');
  fleet.credit(PAINT_PRICE * 2);
  assert.equal(fleet.paintCost('#123456'), PAINT_PRICE); assert.equal(fleet.setPaint('#123456'), true); assert.equal(fleet.balance, PAINT_PRICE);
  assert.equal(fleet.setPaint('#123456'), true); assert.equal(fleet.balance, PAINT_PRICE, 'the colour it wears costs nothing again');
  assert.equal(fleet.setPaint(null), true); assert.equal(fleet.balance, PAINT_PRICE, 'each car\'s own colour is free');
  assert.equal(fleet.setPaint(RAINBOW_PAINT), false, 'the rainbow waits for the code'); assert.equal(fleet.setPaint('nope'), false);
  assert.equal(fleet.enterKonami(), KONAMI_PAY); assert.equal(fleet.balance, PAINT_PRICE + KONAMI_PAY);
  assert.equal(fleet.enterKonami(), KONAMI_PAY); assert.equal(fleet.balance, PAINT_PRICE + KONAMI_PAY * 2);
  assert.equal(fleet.setPaint(RAINBOW_PAINT), true);
  const loaded = new TaxiFleet(disk);
  assert.equal(loaded.paint, RAINBOW_PAINT); assert.equal(loaded.konami, true);
  assert.equal(loaded.balance, KONAMI_PAY * 2);
  assert.equal(loaded.enterKonami(), KONAMI_PAY); assert.equal(loaded.balance, KONAMI_PAY * 3, 'adds again after a reload');
  disk.setItem(FLEET_KEY, JSON.stringify({ version: 2, balance: 0, owned: ['taxi'], paint: 'rainbow' }));
  assert.equal(new TaxiFleet(disk).paint, null, 'no rainbow without the code');
});

test('test drives: the first of each car is free, the rest cost a little, and none of a car owned', () => {
  const disk = storage(), fleet = new TaxiFleet(disk);
  assert.equal(fleet.testDriveCost('taxi'), null); assert.equal(fleet.testDriveCost('auto'), null);
  assert.equal(fleet.testDriveCost('plane'), 0); assert.equal(fleet.testDrive('plane'), true);
  assert.equal(fleet.testDriveCost('plane'), testDrivePrice('plane'));
  assert.ok(testDrivePrice('plane') < carPrice('plane') * .05 && testDrivePrice('coast') >= 50);
  assert.equal(fleet.testDrive('plane'), false, 'not without the money');
  fleet.credit(testDrivePrice('plane') + 7); assert.equal(fleet.testDrive('plane'), true); assert.equal(fleet.balance, 7);
  assert.deepEqual([...new TaxiFleet(disk).tried], ['plane'], 'kept with the fleet, so a reload is no new free drive');
  assert.equal(fleet.setGoal('plane'), true); assert.equal(new TaxiFleet(disk).goal, 'plane');
  assert.equal(fleet.setGoal('taxi'), false); assert.equal(fleet.setGoal(null), true);
  fleet.setGoal('hatchback'); fleet.credit(carPrice('hatchback')); fleet.buy('hatchback');
  assert.equal(fleet.goal, null, 'bought, nothing left to save for'); assert.equal(fleet.testDriveCost('hatchback'), null);
});

test('a fleet saved before the garage sold cars keeps its cabs, and the car its player had picked', () => {
  const disk = storage();
  disk.setItem(FLEET_KEY, JSON.stringify({ version: 1, balance: 900, owned: ['taxi', 'taxiGT'], selected: 'taxiGT', livery: 'cream' }));
  disk.setItem('citydriver-car', 'helicopter');
  const fleet = new TaxiFleet(disk);
  assert.deepEqual([...fleet.owned].sort(), ['coast', 'helicopter', 'taxi', 'taxiGT']); assert.equal(fleet.selected, 'taxiGT'); assert.equal(fleet.balance, 900);
  assert.equal(JSON.parse(disk.getItem(FLEET_KEY)).version, 2, 'saved again at once');
  disk.setItem('citydriver-car', 'plane');
  assert.ok(!new TaxiFleet(disk).owned.has('plane'), 'only once, from the old save');
  const cab = storage();
  cab.setItem(FLEET_KEY, JSON.stringify({ version: 1, balance: 0, owned: ['taxi'], selected: 'taxi' })); cab.setItem('citydriver-car', 'taxiFormula');
  assert.deepEqual([...new TaxiFleet(cab).owned], ['taxi', 'coast'], 'a cab picked there was only a test drive');
  const fresh = storage(); fresh.setItem('citydriver-car', 'sports');
  assert.ok(new TaxiFleet(fresh).owned.has('sports'), 'a player with no fleet yet keeps their car too');
  assert.ok(!new TaxiFleet(fresh).owned.has('jetpack'));
  const walked = storage(); walked.setItem('citydriver-jetpack-hint', 'shown');
  assert.ok(new TaxiFleet(walked).owned.has('jetpack'), 'one who has been on foot keeps the jetpack');
  assert.deepEqual([...new TaxiFleet(storage()).owned], ['taxi', 'coast'], 'a new player starts with the cab and the Surf Wagon');
});

test('completed fares bank exactly once and survive restart, abandonment, expiry and reload', () => {
  const disk = storage(), run = new TaxiRun(disk);
  const player = { s: 25, u: 3, heading: 0, speed: 0 };
  // A solo rider pays at their one stop; a group would hold its fare until the last.
  // Skip the rider the cab starts beside, who waits until it has driven off.
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

test('two tabs on one fleet keep both tabs\' money and purchases', () => {
  const disk = storage(), a = new TaxiFleet(disk), b = new TaxiFleet(disk);
  // A tab opened first, then the other earns and buys: the first one's next earning keeps that purchase
  a.credit(carPrice('hatchback')); assert.equal(a.buy('hatchback'), true);
  b.credit(100);
  assert.equal(b.balance, 100); assert.ok(b.owned.has('hatchback'));
  const reloaded = new TaxiFleet(disk);
  assert.equal(reloaded.balance, 100); assert.ok(reloaded.owned.has('hatchback'));
  // Money spent in one tab can't be spent again in the other, nor a car bought twice
  a.credit(carPrice('sports'));
  assert.equal(a.buy('sports'), true); assert.equal(b.buy('sports'), false); assert.equal(b.balance, 100);
  assert.equal(b.buy('hatchback'), false);
  // The Konami code adds to what the other tab saved, not to this tab's old balance
  const fresh = storage(), first = new TaxiFleet(fresh), second = new TaxiFleet(fresh);
  first.credit(5000); assert.equal(second.enterKonami(), KONAMI_PAY); assert.equal(second.balance, 5000 + KONAMI_PAY);
  assert.equal(first.enterKonami(), KONAMI_PAY); assert.equal(first.balance, 5000 + KONAMI_PAY * 2);
  assert.equal(new TaxiFleet(fresh).balance, 5000 + KONAMI_PAY * 2);
  // A tab whose save is untouched keeps its own state, changes made directly included (the dev hook's)
  b.owned.add('taxiGT'); assert.equal(b.select('taxiGT'), true); assert.equal(new TaxiFleet(disk).selected, 'taxiGT');
  // While its saves fail, a tab never swaps the progress it holds for another tab's save
  let full = false;
  const flaky = { getItem: key => disk.getItem(key), setItem: (key, value) => { if (full) throw Error('Quota'); disk.setItem(key, value); } };
  const c = new TaxiFleet(flaky);
  full = true; c.credit(1000); assert.equal(c.saved, false);
  a.credit(1); c.credit(1);
  assert.equal(c.balance, 100 + 1001);
  full = false; c.credit(1); assert.equal(c.saved, true); assert.equal(new TaxiFleet(disk).balance, 100 + 1002);
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
  // The passenger-carrying Formula keeps its own tuning, independently of the
  // faster chooser-only racer.
  assert.equal(CARS.taxiFormula.stats.topSpeed, 50);
  assert.equal(CARS.taxiFormula.stats.acceleration, 40);
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
