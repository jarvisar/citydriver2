import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiRun, STOP_SECONDS, RATINGS, FARE_BANDS, METERS_PER_SECOND_EARNED, MOODS, arrivalRating, deliverySeconds, pickupSeconds,
  streakSeconds, fareBand, legLimit, timeScale, TIME_FLOOR, TIPS } from '../src/taxi-run.js';
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
  assert.deepEqual(RATINGS.map(r => [r.label, r.seconds, r.riderSeconds]), [['Speedy', 10, 2], ['Normal', 6, 1], ['Slow', 1, 0]]);
  for (const length of [100, 400, 700, 1100, 2000]) {
    for (const rating of RATINGS) assert.equal(deliverySeconds(length, rating), Math.round(length / METERS_PER_SECOND_EARNED) + rating.seconds);
    assert.equal(deliverySeconds(length), deliverySeconds(length, RATINGS[2]), 'an unrated delivery earns the base time');
  }
  // Time comes back mostly per fare: a quick hop earns more time per metre than a long ride
  assert.ok(deliverySeconds(400, RATINGS[0]) / 400 > 1.3 * deliverySeconds(1600, RATINGS[0]) / 1600);
  // and every minute of the shift trims what fares add, down to a floor
  assert.equal(timeScale(0), 1);
  for (let minute = 1; minute < 30; minute++) assert.ok(timeScale(minute * 60) < timeScale((minute - 1) * 60) || timeScale(minute * 60) === TIME_FLOOR);
  assert.equal(timeScale(3600), TIME_FLOOR);
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
    for (const stop of offer.stops) assert.equal(stop.limit, Math.ceil(legLimit(stop.length) * (MOODS[offer.mood]?.clock ?? 1)));
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
  assert.deepEqual([1, 2, 3, 4].map(pickupSeconds), [8, 10, 12, 14]);
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
    assert.equal(event.seconds, Math.round((deliverySeconds(length, RATINGS.find(r => r.id === event.rating)) + event.streak) * timeScale(run.elapsed)));
    return event.streak;
  });
  assert.deepEqual(streaks, [0, 1, 2, 3, 4, 0, 0]);
  const streak = deliver(.9);
  assert.equal(streak.streak, 1); assert.match(streak.text, /^Speedy! · Streak 2 · (Smooth ride \+\$\d+ · )?\+\$\d+ · \+\d+s$/);
  board(run, car, run.customers.find(c => c.id !== run.blockedPickup?.id));
  run.fareLeft = .01; run.update(.02, car); assert.equal(run.streak, 0, 'a rider who jumps out ends the streak');
});

test('a rider aboard when time runs out still gets there, and the shift ends with them', () => {
  const run = new TaxiRun(), car = player(); run.start(car);
  // Out of time between fares, the shift just ends
  run.timeLeft = .01; run.update(.02, car); assert.equal(run.status, 'over'); assert.deepEqual(run.drainEvents().map(e => e.kind), ['over']);
  run.start(car);
  const group = run.customers.find(c => c.passengers > 1 && c.id !== run.blockedPickup?.id);
  board(run, car, group); run.drainEvents();
  run.goals = [{ id: 'fares', stat: 'delivered', tier: 0, target: 1, bonus: 150, text: 'Deliver 1 fare', progress: 0, done: false }];
  run.timeLeft = .01; run.update(.02, car);
  assert.equal(run.status, 'driving'); assert.equal(run.overtime, true); assert.equal(run.timeLeft, 0);
  assert.deepEqual(run.drainEvents().map(e => e.text), ['Time up · last ride']);
  // Each stop pays as usual but adds no time; the last ends the shift
  let paid = 0;
  while (run.status === 'driving') {
    Object.assign(car, { s: run.target.s, u: run.target.u }); run.update(STOP_SECONDS, car);
    for (const event of run.drainEvents()) {
      if (event.seconds !== undefined) assert.equal(event.seconds, 0);
      if (event.kind === 'paid') paid = event.paid;
      assert.doesNotMatch(event.text ?? '', /\+\d+s/);
    }
    assert.equal(run.timeLeft, 0);
  }
  assert.equal(run.status, 'over'); assert.ok(paid > 0); assert.equal(run.cash, paid); assert.equal(run.delivered, 1);
  assert.equal(run.goals[0].done, true, 'the last ride still completes goals'); assert.equal(run.goalCash, 150);
  // Riders who give up in overtime end the shift too
  run.start(car); board(run, car, run.customers.find(c => c.id !== run.blockedPickup?.id)); run.drainEvents();
  run.timeLeft = .01; run.update(.02, car); run.fareLeft = .01; run.update(.02, car);
  assert.equal(run.status, 'over'); assert.equal(run.cash, 0);
});

test('a lone rider may want something of the ride, and it changes the pay', () => {
  const all = offers(), seen = new Map();
  for (const offer of all) {
    if (offer.passengers > 1) assert.equal(offer.mood, null, 'groups ask for nothing more');
    seen.set(offer.mood, (seen.get(offer.mood) ?? 0) + 1);
  }
  const singles = all.filter(offer => offer.passengers === 1).length;
  for (const mood of Object.keys(MOODS)) {
    const share = (seen.get(mood) ?? 0) / singles;
    assert.ok(share > .06 && share < .25, `${mood} riders: ${share.toFixed(2)} of singles`);
  }
  assert.ok((seen.get(null) ?? 0) > all.length / 2, 'most fares are plain');
  const pay = (mood, act = () => {}) => {
    const run = new TaxiRun(), car = player(); run.start(car);
    const offer = { ...run.customers.find(c => c.passengers === 1 && c.id !== run.blockedPickup?.id), mood };
    run.customers = [offer]; run.blockedPickup = null;
    board(run, car, offer); run.drainEvents(); act(run, car);
    run.legElapsed = run.currentStop.limit * .4;
    Object.assign(car, { s: run.target.s, u: run.target.u, speed: 0 }); run.update(STOP_SECONDS, car);
    const event = run.drainEvents().find(e => e.kind === 'paid');
    return { run, event, fare: offer.stops[0].fare };
  };
  const plain = pay(null), hurry = pay('hurry');
  assert.ok(hurry.event.paid > plain.event.paid, 'arriving early pays double for a rider in a hurry');
  // A thrill seeker doubles stunt tips
  const thrill = pay('thrill', run => run.reward('Near miss', TIPS.nearMiss)), tipped = pay(null, run => run.reward('Near miss', TIPS.nearMiss));
  assert.equal(thrill.run.tipsBanked, 2 * tipped.run.tipsBanked);
  // A nervous rider pays half again, unless the cab crashes
  const calm = pay('nervous');
  assert.equal(calm.event.paid - plain.event.paid, Math.round(calm.fare * MOODS.nervous.smooth));
  assert.match(calm.event.text, /Smooth ride \+\$\d+/);
  const shaken = pay('nervous', (run, car) => { car.audioTelemetry = { impactSerial: 1, crashSerial: 1, impact: 6 }; run.update(.02, car); });
  assert.equal(shaken.run.shaken, true); assert.doesNotMatch(shaken.event.text, /Smooth ride/);
  // A scrape or a sideswipe, however loud, is no crash (see CRASH in vehicle.js)
  const scraped = pay('nervous', (run, car) => { car.audioTelemetry = { impactSerial: 1, crashSerial: 0, impact: 9 }; run.update(.02, car); });
  assert.equal(scraped.run.shaken, false); assert.match(scraped.event.text, /Smooth ride/);
  // Each counts as satisfied for the goals when their wish is met
  assert.deepEqual([plain, hurry, thrill, calm, shaken].map(ride => ride.run.pleased), [0, 1, 1, 1, 0]);
  assert.equal(thrill.run.stats.pleased, 1);
  // and a rider in a hurry has less time
  const hurried = all.find(offer => offer.mood === 'hurry');
  assert.ok(hurried.stops[0].limit < legLimit(hurried.stops[0].length));
});

test('only a crash ends the stunt combo, not a scrape or a sideswipe', () => {
  const run = new TaxiRun(), car = player();
  run.start(car); board(run, car, run.customers.find(c => c.id !== run.blockedPickup?.id)); run.drainEvents();
  run.reward('Near miss', TIPS.nearMiss); run.reward('Near miss', TIPS.nearMiss);
  car.audioTelemetry = { impactSerial: 1, crashSerial: 0, impact: 9 }; run.update(.02, car);
  assert.equal(run.combo, 3); assert.ok(!run.drainEvents().some(e => e.kind === 'crash'));
  car.audioTelemetry = { impactSerial: 2, crashSerial: 1, impact: 9 }; run.update(.02, car);
  assert.equal(run.combo, 1); assert.ok(run.drainEvents().some(e => e.kind === 'crash'));
});

test('fares waiting where the cab comes back are the same fares, each with legs of its own', () => {
  // (offers are kept once worked out, see offerFor)
  const run = new TaxiRun(), car = player();
  run.start(car); const first = run.customers;
  run.start({ ...car, s: car.s + 1500 }); run.start(car);
  assert.ok(first.length > 20);
  assert.equal(JSON.stringify(run.customers), JSON.stringify(first));
  assert.ok(first.some(fare => fare.mood), 'special riders come back as they were');
  run.customers.forEach((fare, i) => {
    assert.notEqual(fare, first[i]); assert.equal(fare.destination, fare.stops[0].destination);
    fare.stops.forEach((leg, j) => { assert.notEqual(leg, first[i].stops[j]); assert.notEqual(leg.destination, first[i].stops[j].destination); });
  });
});
