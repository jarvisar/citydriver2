import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiRun, STOP_SECONDS, SHIFT_SECONDS, pickupSeconds } from '../src/taxi-run.js';
import { TaxiCareer } from '../src/taxi-career.js';
import { StuntChain, STUNTS, SMASH_SHARE, nearMiss } from '../src/stunt-chain.js';
import { CHAIN_SECONDS, PRICES, DemolitionRun, PAY_SHARE } from '../src/demolition-run.js';
import { freeHudModel, headsetHudModel } from '../src/run-hud-model.js';
import { placePay, PLACE_PAY, KIND_PAY } from '../src/city-guide.js';

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
  stunts.add(10, 'Test');
  car.audioTelemetry.crashSerial++; step(stunts, car);
  const lost = stunts.drainEvents().find(event => event.kind === 'lost');
  assert.equal(lost.lost, 10); assert.equal(stunts.chain, 0);
  assert.equal(stunts.add(10, 'Test'), 0, 'nothing counts for a moment after a crash');
  step(stunts, car, 1); assert.ok(stunts.add(10, 'Test') > 0);
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
  const tipped = freeHudModel(new StuntChain(), player(), { taxi: { waiting: true, customers: [], boarding: null }, hint: id => id === 'cab' ? 'A tip · more on it' : '' });
  assert.equal(tipped.title, 'A tip', 'a cab with no fare near gets its tip'); assert.equal(tipped.detail, 'more on it');
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
  assert.equal(banked.pay, Math.round(PRICES.lamp * PAY_SHARE)); assert.equal(run.paid, banked.pay);
  assert.equal(placePay([{ first: true }, { first: false }]), KIND_PAY + PLACE_PAY);
});
