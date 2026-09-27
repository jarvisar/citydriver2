import test from 'node:test';
import assert from 'node:assert/strict';
import { DemolitionRun, DemolitionRecords, DEMOLITION_RANKS, PRICES, PIECE_NAMES, CAR_PRICES, RUN_SECONDS, CHAIN_SECONDS, CHAIN_STEP,
  MULTIPLIER_MAX, TAKEDOWN_SECONDS, MAX_SECONDS, FINE, DENT_SPEED, DENT_GAP, WRECK_SPEED, SCORE_SLOTS, SCORES_KEY,
  chainMultiplier, carDamage, demolitionRank, money } from '../src/demolition-run.js';
import { TRAFFIC_MODELS } from '../src/traffic-models.js';

const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), data }; };
const car = (name = 'sedan', extra = {}) => ({ spec: { name }, generation: 1, parked: null, position: { x: 0, y: 0, z: 0 }, ...extra });
const started = storage => { const run = new DemolitionRun(storage); run.start(); return run; };

test('everything a car can knock loose has a price and a name, and every traffic model a value', () => {
  for (const kind of ['lamp', 'lantern', 'signal', 'mast', 'sign', 'bench', 'bin', 'table', 'chair', 'stall', 'tree', 'shelter']) {
    assert.ok(PRICES[kind] > 0 && PIECE_NAMES[kind], kind);
  }
  for (const model of TRAFFIC_MODELS) assert.ok(CAR_PRICES[model.name] > 0, model.name);
  // A car is worth more than any furniture but the signal gantry
  const furniture = Object.entries(PRICES).filter(([kind]) => kind !== 'mast').map(([, price]) => price);
  assert.ok(Math.min(...Object.values(CAR_PRICES)) > Math.max(...furniture));
});

test('a chain steps its multiplier every few smashes, then banks its pot once it goes quiet', () => {
  assert.deepEqual([0, 1, CHAIN_STEP - 1, CHAIN_STEP, CHAIN_STEP * 2, 1000].map(chainMultiplier), [1, 1, 1, 2, 3, MULTIPLIER_MAX]);
  const run = started();
  for (let i = 0; i < CHAIN_STEP; i++) { run.smash(['bench'], { x: i, y: 0, z: 0 }); run.update(CHAIN_SECONDS / 2); }
  assert.equal(run.chain, CHAIN_STEP); assert.equal(run.multiplier, 2); assert.equal(run.score, 0, 'nothing is banked while the chain runs');
  // Each smash pays at the multiplier it lands at: the step's own smash is the first doubled
  const pot = PRICES.bench * ((CHAIN_STEP - 1) + 2);
  assert.equal(run.pending, pot);
  const events = run.drainEvents();
  assert.deepEqual(events.filter(event => event.kind === 'smash').map(event => event.value), [...Array(CHAIN_STEP - 1).fill(PRICES.bench), PRICES.bench * 2]);
  assert.ok(events.some(event => event.kind === 'multiplier' && event.multiplier === 2));
  run.update(CHAIN_SECONDS);
  assert.equal(run.score, pot); assert.equal(run.chain, 0);
  const banked = run.drainEvents().find(event => event.kind === 'banked');
  assert.equal(banked.amount, run.score); assert.equal(banked.multiplier, 2);
  assert.equal(banked.rank, null, 'a bank under the first rating lifts nothing');
  // One that carries the score past a rating says so
  run.damageCar(car('van'), WRECK_SPEED); run.update(CHAIN_SECONDS);
  assert.equal(run.drainEvents().find(event => event.kind === 'banked').rank.id, demolitionRank(run.score).id);
  assert.notEqual(run.rank.id, 'none');
});

test('a cafe is paid for whole, a tree is counted, and nothing is paid outside a run', () => {
  const idle = new DemolitionRun();
  assert.equal(idle.smash(['lamp']), 0); assert.equal(idle.damageCar(car(), 20), 0); idle.pedestrian();
  assert.equal(idle.events.length, 0);
  const run = started();
  assert.equal(run.smash(['table', 'chair', 'chair', 'chair', 'chair']), PRICES.table + PRICES.chair * 4);
  assert.equal(run.last.label, 'Cafe terrace');
  run.smash(['tree']); assert.equal(run.trees, 1); assert.equal(run.smashed, 2);
  assert.equal(run.smash(['person']), 0, 'people are not property');
});

test('cars dent by the square of the blow, count one blow at a time and are paid for once', () => {
  const price = CAR_PRICES.sedan;
  assert.equal(carDamage(price, DENT_SPEED - .1), 0);
  assert.equal(carDamage(price, WRECK_SPEED), price); assert.equal(carDamage(price, WRECK_SPEED * 2), price);
  assert.equal(carDamage(price, WRECK_SPEED / 2), price / 4);
  const run = started(), sedan = car('sedan');
  const first = run.damageCar(sedan, WRECK_SPEED / 2);
  assert.equal(first, price / 4); assert.equal(run.carsHit, 1);
  assert.equal(run.damageCar(sedan, WRECK_SPEED), 0, 'a scrape lasting many steps counts once');
  run.update(DENT_GAP);
  assert.equal(run.damageCar(sedan, 1), 0, 'a touch is not damage');
  assert.equal(run.damageCar(sedan, WRECK_SPEED), price - first, 'paid up to its price');
  assert.equal(run.wrecked, 1); assert.equal(run.carsHit, 1);
  run.update(DENT_GAP);
  assert.equal(run.damageCar(sedan, WRECK_SPEED), 0, 'a wreck has nothing left to pay');
  // Recycled into a new car, it is worth hitting again
  sedan.generation++; run.update(DENT_GAP);
  assert.equal(run.damageCar(sedan, WRECK_SPEED), price); assert.equal(run.carsHit, 2);
});

test('wrecking a moving car buys time; a parked one pays but does not, and the clock is capped', () => {
  const run = started();
  run.damageCar(car('van', { parked: {} }), WRECK_SPEED);
  assert.equal(run.timeLeft, RUN_SECONDS); assert.equal(run.takedowns, 0); assert.equal(run.wrecked, 1);
  const wreck = run.drainEvents().find(event => event.kind === 'wreck');
  assert.equal(wreck.label, 'Parked van wrecked'); assert.equal(wreck.seconds, 0);
  run.damageCar(car('hatchback'), WRECK_SPEED);
  assert.equal(run.timeLeft, RUN_SECONDS + TAKEDOWN_SECONDS); assert.equal(run.takedowns, 1);
  assert.equal(run.drainEvents().find(event => event.kind === 'wreck').seconds, TAKEDOWN_SECONDS);
  run.timeLeft = MAX_SECONDS - 1;
  run.damageCar(car('pickup'), WRECK_SPEED);
  assert.equal(run.timeLeft, MAX_SECONDS);
});

test('a pedestrian costs a fine and the chain\'s pot', () => {
  const run = started();
  for (let i = 0; i < CHAIN_STEP * 2; i++) run.smash(['bench']);
  const pending = run.pending;
  run.pedestrian({ x: 1, y: 2, z: 3 });
  assert.equal(run.chain, 0); assert.equal(run.pot, 0); assert.equal(run.score, -FINE); assert.equal(run.people, 1);
  const penalty = run.drainEvents().find(event => event.kind === 'penalty');
  assert.equal(penalty.lost, pending); assert.equal(penalty.fine, FINE); assert.deepEqual([penalty.x, penalty.y, penalty.z], [1, 2, 3]);
  run.update(CHAIN_SECONDS * 2);
  assert.equal(run.score, -FINE, 'the lost chain never banks');
});

test('time up banks the last chain, rates the run and keeps it in the high score table', () => {
  const storage = memory(), run = started(storage);
  run.update(RUN_SECONDS - 1);
  run.damageCar(car('van'), WRECK_SPEED);
  assert.equal(run.timeLeft, 1 + TAKEDOWN_SECONDS);
  run.update(TAKEDOWN_SECONDS + 1);
  assert.equal(run.status, 'over'); assert.equal(run.score, CAR_PRICES.van);
  assert.equal(run.summary.placement, 0); assert.ok(run.summary.best);
  assert.equal(run.drainEvents().at(-1).kind, 'over');
  // Played again from storage: the table survives, sorted and five long
  const again = new DemolitionRun(storage);
  assert.equal(again.records.best, CAR_PRICES.van); assert.equal(again.records.runs, 1);
  for (const score of [10, 50000, 20, 30, 40, 5]) again.records.record({ score, smashed: 1, wrecked: 0, bestChain: 1 });
  assert.equal(again.records.scores.length, SCORE_SLOTS);
  assert.deepEqual(again.records.scores.map(entry => entry.score), [50000, CAR_PRICES.van, 40, 30, 20]);
  assert.equal(again.records.lifetime, CAR_PRICES.van + 50105);
  // A tie goes below the run that set it first; a score of nothing is not kept
  assert.equal(again.records.record({ score: 30, smashed: 0, wrecked: 0, bestChain: 0 }).placement, 4);
  assert.equal(again.records.record({ score: -FINE, smashed: 0, wrecked: 0, bestChain: 0 }).placement, -1);
});

test('corrupt or missing storage starts an empty table', () => {
  const storage = memory(); storage.setItem(SCORES_KEY, '{"version":1,"runs":-3,"scores":[{"score":"lots"},{"score":900,"date":42}]}');
  const records = new DemolitionRecords(storage);
  assert.equal(records.runs, 0); assert.deepEqual(records.scores.map(entry => entry.score), [900]); assert.equal(records.scores[0].date, '');
  storage.setItem(SCORES_KEY, 'not json');
  assert.equal(new DemolitionRecords(storage).scores.length, 0);
  const unsaved = new DemolitionRecords(null); unsaved.record({ score: 100, smashed: 0, wrecked: 0, bestChain: 0 });
  assert.equal(unsaved.saved, false); assert.equal(unsaved.best, 100);
});

test('ratings climb by about double, and each names the next', () => {
  for (let i = 2; i < DEMOLITION_RANKS.length; i++) {
    const ratio = DEMOLITION_RANKS[i].min / DEMOLITION_RANKS[i - 1].min;
    assert.ok(ratio >= 2 && ratio <= 2.6, DEMOLITION_RANKS[i].id);
  }
  assert.equal(demolitionRank(-FINE).id, 'none');
  assert.equal(demolitionRank(DEMOLITION_RANKS[3].min).id, DEMOLITION_RANKS[3].id);
  assert.equal(demolitionRank(DEMOLITION_RANKS[3].min - 1).next.id, DEMOLITION_RANKS[3].id);
  assert.equal(demolitionRank(1e9).next, null);
  assert.equal(money(-5000), '−$5,000'); assert.equal(money(1234567), '$1,234,567');
});

test('boost is metered, and smashing fills it', () => {
  const run = started();
  run.controls(2, { forward: 1, boost: true });
  assert.ok(run.boost < .2 && run.boostActive);
  const before = run.boost; run.smash(['bin']);
  assert.ok(run.boost > before);
  run.boost = 0; assert.equal(run.controls(.1, { forward: 1, boost: true }).boost, false, 'an empty meter boosts nothing');
});
