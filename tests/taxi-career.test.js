import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiCareer, CAREER_KEY, DRIVER_RANKS, LIVERIES, RECORDS, driverRank, liveryById } from '../src/taxi-career.js';
import { TaxiFleet, FLEET_KEY } from '../src/taxi-fleet.js';
import { TaxiRun, STOP_SECONDS } from '../src/taxi-run.js';

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const player = () => ({ s: 25, u: 3, heading: 0, speed: 0 });
const shift = (run, car, cash) => { run.start(car); run.cash = cash; run.timeLeft = .01; run.update(.02, car); return run.summary; };

test('ranks climb with career earnings and each one opens a livery', () => {
  assert.equal(DRIVER_RANKS[0].earnings, 0);
  for (let i = 1; i < DRIVER_RANKS.length; i++) assert.ok(DRIVER_RANKS[i].earnings > DRIVER_RANKS[i - 1].earnings * 1.5, 'each rank is a real stretch');
  assert.equal(driverRank(0).id, 'rookie'); assert.equal(driverRank(1999).id, 'rookie'); assert.equal(driverRank(2000).id, 'cabbie');
  assert.equal(driverRank(2000).next.id, 'regular'); assert.equal(driverRank(1e7).next, null);
  assert.deepEqual(LIVERIES.map(livery => livery.rank), DRIVER_RANKS.map(rank => rank.id), 'one livery per rank, in order');
  assert.equal(LIVERIES[0].color, null, 'the first livery is the cab’s own yellow');
  assert.equal(new Set(LIVERIES.map(livery => livery.id)).size, LIVERIES.length);
  assert.equal(liveryById('nope'), LIVERIES[0]);
  const career = new TaxiCareer();
  assert.deepEqual(career.liveries.map(l => l.id), ['yellow']);
  career.earnings = 15000; assert.equal(career.rank.id, 'pro'); assert.equal(career.unlocked('seaglass'), true); assert.equal(career.unlocked('forest'), false);
});

test('closing a shift grows the totals, sets records only when beaten, promotes, and survives reload', () => {
  const disk = storage(), run = new TaxiRun(disk), car = player();
  let summary = shift(run, car, 1500);
  assert.equal(run.career.shifts, 1); assert.equal(run.career.earnings, 1500);
  assert.deepEqual(summary.beaten, [], 'the first shift sets records rather than beating them');
  assert.equal(summary.promoted, false); assert.deepEqual(summary.liveries, []);
  assert.equal(run.career.records.shift, Math.round(run.elapsed));
  summary = shift(run, car, 900);
  assert.equal(run.career.shifts, 2); assert.equal(run.career.earnings, 2400);
  assert.equal(summary.promoted, true); assert.equal(summary.before.id, 'rookie'); assert.equal(summary.after.id, 'cabbie');
  assert.deepEqual(summary.liveries.map(l => l.id), ['cream']);
  assert.ok(!summary.beaten.includes('fares'), 'zero fares beats nothing');
  const loaded = new TaxiCareer(disk);
  assert.equal(loaded.shifts, 2); assert.equal(loaded.earnings, 2400); assert.equal(loaded.rank.id, 'cabbie');
  assert.deepEqual(Object.keys(loaded.records).sort(), RECORDS.map(r => r.id).sort());
  // A shift with a fare beats the fares record and the tips record only if tips were banked.
  run.start(car); const solo = run.customers.find(c => c.passengers === 1 && c.id !== run.blockedPickup?.id);
  Object.assign(car, { s: solo.s, u: solo.u, speed: 0 }); run.update(STOP_SECONDS, car); run.reward('Drift', 2);
  Object.assign(car, { s: run.target.s, u: run.target.u }); run.update(STOP_SECONDS, car);
  run.timeLeft = .01; run.update(.02, car);
  assert.ok(run.summary.beaten.includes('fares')); assert.ok(run.summary.beaten.includes('tips')); assert.ok(run.summary.beaten.includes('combo'));
  assert.equal(run.career.records.fares, 1); assert.equal(run.career.fares, 1); assert.equal(run.career.riders, 1);
  for (const data of ['broken', '{"version":1,"earnings":-5,"shifts":"x"}', '{"version":2,"earnings":9999}']) {
    disk.setItem(CAREER_KEY, data); assert.equal(new TaxiCareer(disk).earnings, 0);
  }
  const unavailable = new TaxiCareer({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  unavailable.record(run); assert.equal(unavailable.saved, false); assert.equal(unavailable.shifts, 1);
});

test('the fleet keeps a livery, but only one the career has unlocked', () => {
  const disk = storage(), fleet = new TaxiFleet(disk), career = new TaxiCareer(disk);
  assert.equal(fleet.livery, 'yellow'); assert.equal(fleet.liveryColor, null);
  assert.equal(fleet.setLivery('signal', career), false, 'locked liveries stay locked');
  assert.equal(fleet.setLivery('nope'), false);
  career.earnings = 6000; career.save();
  assert.equal(fleet.setLivery('signal', career), true); assert.equal(fleet.liveryColor, '#b8232f');
  assert.equal(new TaxiFleet(disk).livery, 'signal', 'the livery is saved with the fleet');
  disk.setItem(FLEET_KEY, JSON.stringify({ version: 1, balance: 10, owned: ['taxi'], selected: 'taxi', livery: 'purple' }));
  assert.equal(new TaxiFleet(disk).livery, 'yellow', 'an unknown livery falls back to yellow');
  assert.equal(new TaxiFleet(disk).balance, 10);
});
