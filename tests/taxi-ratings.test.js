import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiRun, STOP_SECONDS, RATINGS, FARE_BANDS, EASY_PACE, METERS_PER_SECOND_EARNED, arrivalRating, deliverySeconds, pickupSeconds,
  streakSeconds, fareBand, legLimit } from '../src/taxi-run.js';
import { TAXI_LICENSES, taxiLicense } from '../src/taxi-license.js';
const cityLayout = (s, u) => ({ s, u });

const player = () => ({ s: 25, u: 3, heading: 0, speed: 0 });
function board(run, car, customer) {
  Object.assign(car, { s: customer.s, u: customer.u, speed: 0 });
  run.update(STOP_SECONDS, car); assert.equal(run.status, 'driving');
}
function offers() {
  const run = new TaxiRun(), car = player(), found = new Map();
  for (const center of [0, -500, 500, -20000, 400000, 7000]) for (const offset of [-250, 0, 250]) {
    Object.assign(car, cityLayout(center + offset, center)); run.start(car);
    for (const offer of run.customers) found.set(offer.id, offer);
  }
  return [...found.values()];
}

test('the arrival rating follows the rider clock: over half green, over a quarter yellow, then red', () => {
  const at = remaining => arrivalRating(remaining).id;
  assert.deepEqual([1, .5, .4999, .25, .2499, 0].map(at), ['speedy', 'speedy', 'normal', 'normal', 'slow', 'slow']);
  assert.deepEqual(RATINGS.map(r => [r.label, r.seconds, r.riderSeconds]), [['Speedy', 5, 2], ['Normal', 2, 1], ['Slow', 0, 0]]);
  for (const length of [100, 400, 700, 1100, 2000]) {
    const slow = deliverySeconds(length, RATINGS[2]);
    assert.equal(slow, Math.round(length / METERS_PER_SECOND_EARNED), 'the distance pays back at a strong pace');
    assert.equal(deliverySeconds(length, RATINGS[1]), slow + 2);
    assert.equal(deliverySeconds(length, RATINGS[0]), slow + 5);
    assert.equal(deliverySeconds(length), slow, 'an unrated delivery earns the base time');
  }
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(streakSeconds), [0, 0, 1, 2, 3, 4, 5, 5], 'a Speedy streak adds up to 5 s');
});

test('ring colours run red to green with trip length and every offer wears its band', () => {
  assert.deepEqual(FARE_BANDS.map(band => band.id), ['hop', 'short', 'medium', 'long']);
  assert.equal(new Set(FARE_BANDS.map(band => band.color)).size, FARE_BANDS.length);
  assert.deepEqual([0, 549, 550, 799, 800, 1099, 1100, 5000].map(length => fareBand(length).id),
    ['hop', 'hop', 'short', 'short', 'medium', 'medium', 'long', 'long']);
  const all = offers(), seen = new Set();
  for (const offer of all) {
    const band = fareBand(offer.length);
    assert.equal(offer.band, band.id); assert.equal(offer.color, band.color);
    seen.add(offer.band);
    for (const stop of offer.stops) assert.equal(stop.limit, legLimit(stop.length));
  }
  assert.deepEqual(seen, new Set(FARE_BANDS.map(band => band.id)), 'every colour turns up in ordinary neighbourhoods');
  for (const band of FARE_BANDS) {
    const share = all.filter(offer => offer.band === band.id).length / all.length;
    assert.ok(share > .08 && share < .45, `${band.id} rings are neither rare nor everywhere: ${share.toFixed(2)}`);
  }
});

test('a rider whose clock runs out jumps out, and ratings reset each shift', () => {
  const run = new TaxiRun(), car = player(); run.start(car);
  const solo = run.customers.find(c => c.passengers === 1 && c.id !== run.blockedPickup?.id);
  board(run, car, solo); run.drainEvents();
  run.fareLeft = .01; run.update(.02, car);
  assert.equal(run.status, 'pickup'); assert.equal(run.failed, 1); assert.equal(run.cash, 0);
  assert.deepEqual(run.drainEvents().map(e => e.text), [`Too slow · Rider jumped out · $${solo.fare} lost`]);
  const group = run.customers.find(c => c.passengers > 2 && c.id !== run.blockedPickup?.id);
  assert.ok(group, 'a party of three or four waits nearby');
  board(run, car, group);
  Object.assign(car, { s: run.target.s, u: run.target.u }); run.update(STOP_SECONDS, car); run.drainEvents();
  const owed = run.remainingFare + run.tips;
  run.fareLeft = .01; run.update(.02, car);
  assert.deepEqual(run.drainEvents().map(e => e.text), [`Too slow · ${group.passengers - 1} riders jumped out · $${owed} lost`]);
  assert.equal(run.cash, 0, 'the rider already dropped off paid into the lost group fare');
  assert.equal(Object.values(run.ratings).reduce((a, b) => a + b, 0), 1);
  run.start(car); assert.deepEqual(run.ratings, { speedy: 0, normal: 0, slow: 0 });
});

test('licences double from class to class and always name the next goal', () => {
  assert.deepEqual(TAXI_LICENSES.map(l => l.badge), ['–', 'E', 'D', 'C', 'B', 'A', 'S', '★']);
  for (let i = 2; i < TAXI_LICENSES.length; i++) assert.equal(TAXI_LICENSES[i].min, TAXI_LICENSES[i - 1].min * 2);
  assert.equal(taxiLicense(0).id, 'none'); assert.equal(taxiLicense(249).id, 'none');
  assert.equal(taxiLicense(250).id, 'e'); assert.equal(taxiLicense(1999).id, 'c'); assert.equal(taxiLicense(2000).id, 'b');
  assert.equal(taxiLicense(4000).next.id, 's'); assert.equal(taxiLicense(16000).id, 'legend');
  assert.equal(taxiLicense(99999).next, null);
  assert.equal(taxiLicense(1234).rank, 3);
});

test('finishing a shift remembers the previous best for the licence comparison', () => {
  const saved = new Map(), storage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) };
  const run = new TaxiRun(storage), car = player(); run.start(car);
  run.cash = 600; run.timeLeft = .01; run.update(.02, car);
  assert.equal(run.previousBest, 0); assert.equal(run.best, 600);
  run.start(car); run.cash = 300; run.timeLeft = .01; run.update(.02, car);
  assert.equal(run.previousBest, 600); assert.equal(run.best, 600);
});

test('boarding adds time per party, and a little more for every extra rider', () => {
  assert.deepEqual([1, 2, 3, 4].map(pickupSeconds), [6, 8, 10, 12]);
  const run = new TaxiRun(), car = player(); run.start(car); run.timeLeft = 40;
  const group = run.customers.find(c => c.passengers > 1 && c.id !== run.blockedPickup?.id);
  board(run, car, group);
  assert.ok(Math.abs(run.timeLeft - (40 - STOP_SECONDS + pickupSeconds(group.passengers))) < 1e-9);
  assert.deepEqual(run.drainEvents().map(e => e.text), [`${group.passengers} riders aboard · +${pickupSeconds(group.passengers)}s`]);
});

test('Speedy arrivals in a row add time; a slower arrival or a lost rider ends the streak', () => {
  const run = new TaxiRun(), car = player(); run.start(car);
  const deliver = remaining => {
    board(run, car, run.customers.find(c => c.passengers === 1 && c.id !== run.blockedPickup?.id)); run.drainEvents();
    run.legElapsed = run.currentStop.limit * (1 - remaining) - STOP_SECONDS; run.timeLeft = 60;
    Object.assign(car, { s: run.target.s, u: run.target.u }); run.update(STOP_SECONDS, car);
    return run.drainEvents().find(e => e.kind === 'paid');
  };
  const streaks = [.9, .9, .9, .9, .9, .4, .9].map(remaining => {
    const length = run.customers.find(c => c.passengers === 1 && c.id !== run.blockedPickup?.id).length, event = deliver(remaining);
    assert.equal(event.seconds, deliverySeconds(length, RATINGS.find(r => r.id === event.rating)) + event.streak);
    return event.streak;
  });
  assert.deepEqual(streaks, [0, 1, 2, 3, 4, 0, 0]);
  const streak = deliver(.9);
  assert.equal(streak.streak, 1); assert.match(streak.text, /^Speedy! · Streak ×2 · \+\$\d+ · \+\d+s$/);
  board(run, car, run.customers.find(c => c.id !== run.blockedPickup?.id));
  run.fareLeft = .01; run.update(.02, car); assert.equal(run.streak, 0, 'a rider who jumps out ends the streak');
});

test('the preview warns when the shift clock cannot cover a fare at an easy pace', () => {
  const run = new TaxiRun(), car = player(); run.start(car);
  const group = run.customers.filter(c => c.passengers > 2).sort((a, b) => b.length - a.length)[0];
  const need = offer => {
    let clock = pickupSeconds(offer.passengers), lowest = clock;
    for (const [index, leg] of offer.stops.entries()) {
      clock -= leg.length / EASY_PACE + 3; lowest = Math.min(lowest, clock);
      clock += index === offer.stops.length - 1 ? deliverySeconds(offer.length, RATINGS[1]) : RATINGS[1].riderSeconds;
    }
    return -lowest;
  };
  run.timeLeft = need(group) + 1; assert.ok(run.shiftAfter(group) > 0);
  run.timeLeft = need(group) - 1; assert.ok(run.shiftAfter(group) < 0);
  run.timeLeft = 180; assert.ok(run.customers.every(c => run.shiftAfter(c) > 0), 'a full clock covers any fare');
});
