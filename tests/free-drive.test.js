import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiRun, STOP_SECONDS, SHIFT_SECONDS, pickupSeconds } from '../src/taxi-run.js';
import { TaxiCareer } from '../src/taxi-career.js';
import { StuntChain, STUNTS, SMASH_SHARE, REPEATS, nearMiss } from '../src/stunt-chain.js';
import { CHAIN_SECONDS, PRICES, CAR_PRICES, PARKED_SHARE, DemolitionRun, demolitionPay, DEMOLITION_RANKS } from '../src/demolition-run.js';
import { freeHudModel, headsetHudModel } from '../src/run-hud-model.js';
import { placePay, PLACE_PAY, KIND_PAY } from '../src/city-guide.js';
import { TestDrive, TEST_DRIVE_ENDING } from '../src/test-drive.js';

const player = () => ({ s: 25, u: 3, heading: 0, speed: 0, audioTelemetry: { impactSerial: 0, crashSerial: 0 }, groundedPosition: { x: 3, y: 0, z: -25 } });
const step = (stunts, car, dt = .1, options) => stunts.update(dt, car, [], options);

test('a cab on standby shows its fares with no clock, and the first one aboard starts the shift', () => {
  const run = new TaxiRun(), car = player();
  run.standby(car);
  assert.equal(run.status, 'standby'); assert.equal(run.running, false, 'standby is not a run'); assert.ok(run.customers.length > 0);
  run.update(30, car);
  assert.equal(run.timeLeft, SHIFT_SECONDS, 'no clock ticks before the first fare');
  const fare = run.customers.find(customer => customer.id !== run.blockedPickup?.id);
  Object.assign(car, { s: fare.s, u: fare.u });
  run.update(STOP_SECONDS / 2, car);
  assert.equal(run.status, 'standby'); assert.equal(run.boarding.id, fare.id);
  run.update(STOP_SECONDS / 2, car);
  assert.equal(run.status, 'driving'); assert.equal(run.fare.id, fare.id);
  assert.equal(run.timeLeft, SHIFT_SECONDS + pickupSeconds(fare.passengers));
  const [pickup] = run.drainEvents();
  assert.equal(pickup.kind, 'pickup'); assert.equal(pickup.first, true); assert.match(pickup.text, /aboard/);
  assert.equal(run.goals.length, 3, 'the shift draws its goals as it begins');
  assert.ok(!run.customers.includes(fare), 'the fare aboard no longer waits');
});

test('standby never boards a fare the cab was already sitting in, and stops with the cab', () => {
  const run = new TaxiRun(), car = player(), probe = new TaxiRun();
  probe.standby(car);
  const fare = probe.customers[0];
  Object.assign(car, { s: fare.s, u: fare.u });
  run.standby(car);
  assert.equal(run.blockedPickup?.id, fare.id);
  run.update(STOP_SECONDS * 2, car);
  assert.equal(run.status, 'standby', 'it has to drive into a ring');
  run.stop();
  assert.equal(run.status, 'idle'); assert.equal(run.customers.length, 0);
});

test('the stunt chain multiplies as it grows, banks when it waits too long, and a crash loses it', () => {
  const stunts = new StuntChain(), car = player();
  step(stunts, car);
  for (let i = 0; i < 5; i++) stunts.add(10, 'Test');
  assert.equal(stunts.chain, 5); assert.equal(stunts.multiplier, 2);
  assert.equal(stunts.pot, 10 * 3 + 20 * 2, 'the fourth and fifth are doubled');
  assert.ok(stunts.drainEvents().some(event => event.kind === 'multiplier'));
  step(stunts, car, CHAIN_SECONDS);
  const banked = stunts.drainEvents().find(event => event.kind === 'banked');
  assert.equal(banked.amount, 70); assert.equal(stunts.chain, 0);
  stunts.add(10, 'Test'); step(stunts, car, .5);
  car.audioTelemetry.crashSerial++; step(stunts, car);
  const lost = stunts.drainEvents().find(event => event.kind === 'lost');
  assert.equal(lost.lost, 10); assert.equal(stunts.chain, 0);
  assert.equal(stunts.add(10, 'Test'), 0, 'nothing counts for a moment after a crash');
  step(stunts, car, 1); assert.ok(stunts.add(10, 'Test') > 0);
  // A chain the crash began, smashing what it hit, is kept: it was "+$5" then "$5 chain lost" for one blow
  step(stunts, car, CHAIN_SECONDS); stunts.drainEvents();
  stunts.smashed(['lamp']); car.audioTelemetry.crashSerial++; step(stunts, car, 1 / 60);
  assert.equal(stunts.chain, 1); assert.ok(!stunts.drainEvents().some(event => event.kind === 'lost'));
  assert.equal(stunts.add(10, 'Test'), 0, 'though nothing counts for a moment after it either');
});

test('a chain waits for a car in the air, and autodrive banks it and counts nothing', () => {
  const stunts = new StuntChain(), car = player();
  stunts.add(10, 'Test');
  step(stunts, car, CHAIN_SECONDS * 2, { aloft: true });
  assert.equal(stunts.chain, 1, 'held while the car flies');
  stunts.add(10, 'Test');
  step(stunts, car, .1, { active: false });
  assert.equal(stunts.chain, 0);
  assert.ok(stunts.drainEvents().some(event => event.kind === 'banked'));
});

test('stunts pay by what they are: drift stages, jumps, flying stunts and smashes', () => {
  const stunts = new StuntChain(), car = player();
  step(stunts, car);
  assert.equal(stunts.drifted({ stage: 3, time: 2 }), STUNTS.drift[2][1]);
  car.audioTelemetry.impactSerial++; step(stunts, car);
  assert.equal(stunts.drifted({ stage: 1, time: 1 }), 0, 'a drift that touched something pays nothing');
  assert.ok(stunts.jumped({ landing: 'clean', air: 1.5, turns: 1 }) > STUNTS.spin);
  stunts.jumped({ landing: 'spun', air: 1, turns: 0 });
  assert.equal(stunts.chain, 0, 'a spin out loses the chain');
  step(stunts, car, 1);
  assert.equal(stunts.flew({ kind: 'stunt', text: 'Barrel roll' }), STUNTS.flight['Barrel roll']);
  assert.equal(stunts.smashed(['lamp']), Math.round(PRICES.lamp * SMASH_SHARE) * stunts.multiplier);
  assert.equal(stunts.smashed(['nothing-priced']), 0);
  const parked = { spec: { name: 'sedan' }, parked: true, generation: 1 };
  assert.ok(stunts.damaged(parked, 20) > 0);
  assert.equal(stunts.damaged(parked, 20), 0, 'a car written off pays once');
});

test('the same smash again in one chain pays less each time, and a new chain starts afresh', () => {
  const stunts = new StuntChain(), car = player(), row = [];
  step(stunts, car);
  for (let i = 0; i < 8; i++) row.push(stunts.damaged({ spec: { name: 'van' }, parked: true, generation: i }, 20) / stunts.multiplier);
  const whole = Math.round(CAR_PRICES.van * PARKED_SHARE * SMASH_SHARE);
  assert.deepEqual(row, REPEATS.concat(REPEATS.at(-1), REPEATS.at(-1), REPEATS.at(-1)).map(share => Math.max(1, Math.round(CAR_PRICES.van * PARKED_SHARE * SMASH_SHARE * share))));
  assert.equal(stunts.chain, 8, 'every one still counts toward the multiplier');
  assert.equal(stunts.smashed(['tree']) / stunts.multiplier, Math.round(PRICES.tree * SMASH_SHARE), 'something else pays in full');
  stunts.bank();
  assert.equal(stunts.damaged({ spec: { name: 'van' }, parked: true, generation: 99 }, 20), whole, 'a new chain pays in full again');
});

test('a near miss is passing traffic fast and close, not following it or missing it by a street', () => {
  const car = { s: 0, u: 0, heading: 0, speed: 25, spec: { width: 2 } };
  const other = extra => ({ s: 1, u: 3.2, heading: Math.PI, speed: 10, spec: { width: 2 }, ...extra });
  assert.ok(nearMiss(car, other()));
  assert.ok(!nearMiss(car, other({ heading: 0, speed: 24 })), 'going its own speed');
  assert.ok(!nearMiss(car, other({ u: 8 })), 'too far off');
  assert.ok(!nearMiss({ ...car, speed: 10 }, other()), 'too slow');
});

test('free drive\'s card shows the chain, then a fare by the cab, and otherwise stays away', () => {
  const stunts = new StuntChain(), car = player(), run = new TaxiRun();
  assert.equal(freeHudModel(stunts, car).task, false, 'nothing to say, no card');
  run.standby(car);
  const fare = run.customers.find(customer => customer.id !== run.blockedPickup?.id);
  Object.assign(car, { s: fare.s + 20, u: fare.u });
  let model = freeHudModel(stunts, car, { taxi: run });
  assert.equal(model.task, true); assert.equal(model.stage, 'Fare'); assert.equal(model.title, `To ${fare.destination.name}`);
  assert.equal(model.running, false, 'no clock or shift money');
  stunts.add(10, 'Near miss');
  model = freeHudModel(stunts, car, { taxi: run });
  assert.equal(model.stage, 'Chain ×1'); assert.equal(model.title, 'Near miss'); assert.equal(model.timer.tone, 'chain');
  const headset = headsetHudModel(model, { heading: 'N', place: 'Harbour', cash: '$40' });
  assert.equal(headset.free, true); assert.equal(headset.cash, '$40'); assert.match(headset.stage, /^Chain/);
  // With no fare near, the cab's card still says what starts the shift (it was a one-off tip, then nothing)
  const waiting = freeHudModel(new StuntChain(), player(), { taxi: { waiting: true, customers: [], boarding: null, timeLeft: SHIFT_SECONDS } });
  assert.equal(waiting.task, true); assert.equal(waiting.stage, 'Taxi shift'); assert.equal(waiting.title, 'Find a passenger');
  assert.equal(waiting.fareStatus, `Clock ${SHIFT_SECONDS} s`); assert.match(waiting.party, /clock starts/);
  const tipped = freeHudModel(new StuntChain(), player(), { shop: true, hint: id => id === 'shop' ? 'A tip · more on it' : '' });
  assert.equal(tipped.title, 'A tip'); assert.equal(tipped.detail, 'more on it');
  assert.equal(tipped.fareStatus, '', 'and nothing in the money corner (it said "undefined")');
});

test('the demolition truck on standby says what starts its run, and which contracts it holds', () => {
  const run = new DemolitionRun();
  assert.equal(freeHudModel(new StuntChain(), player(), { demolition: run }).task, false, 'nothing until it is on standby');
  run.standby();
  const card = freeHudModel(new StuntChain(), player(), { demolition: run });
  assert.equal(card.task, true); assert.equal(card.running, false, 'no clock yet');
  assert.equal(card.stage, 'Demolition'); assert.equal(card.title, 'Hit anything to start'); assert.equal(card.fareStatus, 'Clock 60 s');
  assert.equal(card.party, `Contracts · ${run.contracts.map(contract => contract.short).join(', ')}`);
  const chain = new StuntChain(); chain.add(10, 'Near miss');
  assert.equal(freeHudModel(chain, player(), { demolition: run }).status, 'chain', 'a stunt chain going comes first');
  assert.equal(headsetHudModel(card, { heading: 'N', place: 'Harbour', cash: '$40' }).title, 'Hit anything to start');
});

test('money earned anywhere counts toward the rank, and a promotion says what it unlocked', () => {
  const career = new TaxiCareer();
  assert.equal(career.earn(1500), null);
  const promotion = career.earn(600);
  assert.equal(promotion.after.id, 'cabbie'); assert.match(promotion.text, /Cabbie.*Checker Cream/);
  assert.equal(career.earn(-5), null); assert.equal(career.earn(1.5), null);
  assert.equal(career.earnings, 2100);
});

test('demolition pays its cut as each chain banks, and places found pay by kind', () => {
  const run = new DemolitionRun(); run.start();
  run.smash(['lamp']); run.update(CHAIN_SECONDS + .1);
  const banked = run.drainEvents().find(event => event.kind === 'banked');
  assert.equal(banked.pay, Math.round(demolitionPay(PRICES.lamp))); assert.equal(run.paid, banked.pay);
  run.smash(['mast']); run.smash(['shelter']); run.update(CHAIN_SECONDS + .1);
  assert.equal(run.paid, Math.round(demolitionPay(run.banked)), 'the payments add up to the cut of all of it');
  run.pedestrian({ x: 0, y: 0, z: 0 }, 'loose', 'resident');
  assert.equal(run.paid, Math.round(demolitionPay(run.banked)), 'a fine is off the score, not the pay');
  assert.equal(placePay([{ first: true }, { first: false }]), KIND_PAY + PLACE_PAY);
});

test('demolition\'s cut tapers: a bigger run pays more, but less of each extra dollar', () => {
  let last = 0, rate = Infinity;
  for (let damage = 50000; damage <= 3e6; damage += 50000) {
    const pay = demolitionPay(damage), step = pay - last;
    assert.ok(step > 0 && step <= rate + 1e-9, `${damage}`);
    last = pay; rate = step;
  }
  const at = id => demolitionPay(DEMOLITION_RANKS.find(rank => rank.id === id).min);
  assert.ok(at('c') > 400 && at('c') < 600, 'a first go is worth a few minutes of shift');
  assert.ok(at('legend') <= 2.6 * at('b'), 'and the best run ever not much more than a good one');
});

test('a test drive warns before its end, then waits for the car to stop or land before handing it back', () => {
  const drive = new TestDrive(), here = { inCar: true, still: false };
  assert.equal(drive.update(1, here), null, 'nothing to do with no test drive');
  drive.start('plane', 30);
  assert.equal(drive.clock, '0:30');
  assert.equal(drive.update(10, here), null);
  assert.equal(drive.update(10, here), 'warn'); assert.equal(drive.update(1, here), null, 'warned once');
  assert.equal(drive.update(20, here), 'over'); assert.equal(drive.over, true); assert.equal(drive.clock, '0:00');
  assert.equal(drive.update(5, here), null, 'still flying');
  assert.equal(drive.update(.1, { inCar: true, still: true }), 'done'); assert.equal(drive.active, false);
  drive.start('plane', 30); drive.update(31, here);
  assert.equal(drive.update(TEST_DRIVE_ENDING, here), 'done', 'swapped wherever it is if it takes too long');
  drive.start('bus', 30);
  assert.equal(drive.update(31, { inCar: false, still: true }), 'gone', 'left parked, it goes back to the garage');
  const card = freeHudModel(new StuntChain(), player(), { test: { label: 'Plane', clock: '1:40', left: 100, fraction: .8, over: false, price: '$140,000', note: '$139,000 to go · Garage' } });
  assert.equal(card.stage, 'Test drive'); assert.equal(card.title, 'Plane'); assert.equal(card.timer.text, '1:40'); assert.equal(card.party, '$139,000 to go · Garage');
  const chain = new StuntChain(); chain.add(10, 'Near miss');
  assert.equal(freeHudModel(chain, player(), { test: { label: 'Plane', clock: '1:40', left: 100, fraction: .8, over: false } }).status, 'chain', 'a chain going comes first');
  const ending = freeHudModel(chain, player(), { test: { label: 'Plane', clock: '0:00', left: 0, fraction: 0, over: true, landing: true, own: 'Taxi' } });
  assert.equal(ending.title, 'Landing…'); assert.equal(ending.party, 'Back to your Taxi', 'but not over the end of a test drive');
  assert.equal(freeHudModel(new StuntChain(), player(), { shop: true, hint: id => id === 'shop' ? 'Enough for your first car · open the Garage' : '' }).title, 'Enough for your first car');
});
