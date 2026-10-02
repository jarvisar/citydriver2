import test from 'node:test';
import assert from 'node:assert/strict';
import { DemolitionRun, DemolitionRecords, DEMOLITION_RANKS, PRICES, PIECE_NAMES, CAR_PRICES, PARKED_SHARE, RUN_SECONDS, CHAIN_SECONDS, CHAIN_STEP,
  MULTIPLIER_MAX, TAKEDOWN_SECONDS, MAX_SECONDS, FINE, FINE_GAP, DENT_SPEED, DENT_GAP, WRECK_SPEED, SCORE_SLOTS, SCORES_KEY,
  CONTRACTS, CONTRACT_SECONDS, CONTRACTS_PER_RUN, chainMultiplier, chainSeconds, carDamage, demolitionRank, runContracts, money, compactMoney } from '../src/demolition-run.js';
import { TRAFFIC_MODELS, BUS_MODEL } from '../src/traffic-models.js';

const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), data }; };
const car = (name = 'sedan', extra = {}) => ({ spec: { name }, generation: 1, parked: null, position: { x: 0, y: 0, z: 0 }, ...extra });
// A run with no contracts, unless given some, so the clock only moves as a test means it to
const started = (storage, contracts = []) => { const run = new DemolitionRun(storage); run.start(); run.contracts = contracts; return run; };
const contract = (id, target) => { const type = CONTRACTS.find(entry => entry.id === id);
  return { id, stat: type.stat, tier: 0, target, text: type.text(target), short: type.short, money: Boolean(type.money), progress: 0, done: false }; };

test('everything a car can knock loose has a price and a name, and every traffic model a value', () => {
  for (const kind of ['lamp', 'lantern', 'signal', 'mast', 'sign', 'bench', 'bin', 'table', 'chair', 'stall', 'tree', 'shelter', 'hydrant', 'post-box', 'cabinet', 'news-boxes', 'bike-rack']) {
    assert.ok(PRICES[kind] > 0 && PIECE_NAMES[kind], kind);
  }
  for (const name of [...TRAFFIC_MODELS.map(model => model.name), BUS_MODEL.name, 'taxi', 'demolition']) assert.ok(CAR_PRICES[name] > 0, name);
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
  run.damageCar(car('van'), WRECK_SPEED); run.damageCar(car('pickup'), WRECK_SPEED); run.update(CHAIN_SECONDS);
  assert.equal(run.drainEvents().find(event => event.kind === 'banked').rank.id, demolitionRank(run.score).id);
  assert.notEqual(run.rank.id, 'none');
});

test('on standby the truck\'s run waits for its first hit, which starts the clock and counts in it', () => {
  const run = new DemolitionRun();
  run.standby();
  assert.ok(run.waiting && !run.running); assert.equal(run.timeLeft, RUN_SECONDS);
  assert.equal(run.contracts.length, CONTRACTS_PER_RUN, 'its contracts are dealt, for the card to show');
  const dealt = run.contracts.map(each => each.id);
  // (nothing moves the clock, nobody is fined, and a touch is no hit)
  run.update(5); run.pedestrian(); assert.equal(run.timeLeft, RUN_SECONDS);
  assert.equal(run.damageCar(car(), DENT_SPEED - .1), 0); assert.ok(run.waiting);
  assert.equal(run.smash(['person']), 0); assert.ok(run.waiting, 'nothing without a price starts it');
  assert.equal(run.events.length, 0);
  assert.equal(run.smash(['lamp']), PRICES.lamp);
  assert.ok(run.running); assert.equal(run.smashed, 1); assert.equal(run.chain, 1);
  assert.deepEqual(run.contracts.map(each => each.id), dealt, 'the contracts shown are the ones played');
  assert.deepEqual(run.drainEvents().map(event => event.kind).slice(0, 2), ['begin', 'smash'], 'begun, then the hit (and any contract it moved on)');
  // A car dented hard enough starts it the same way, and the standby ends with the truck
  const other = new DemolitionRun();
  other.standby(); other.damageCar(car(), 10);
  assert.ok(other.running && other.carsHit === 1); assert.equal(other.drainEvents()[0].kind, 'begin');
  other.standby(); other.stop(); assert.equal(other.status, 'idle');
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

test('running someone over costs a fine and the chain\'s pot; hitting them with debris only the fine', () => {
  const run = started();
  for (let i = 0; i < CHAIN_STEP * 2; i++) run.smash(['bench']);
  const pending = run.pending;
  run.pedestrian({ x: 1, y: 2, z: 3 }, 'player');
  assert.equal(run.chain, 0); assert.equal(run.pot, 0); assert.equal(run.score, -FINE); assert.equal(run.people, 1);
  const penalty = run.drainEvents().find(event => event.kind === 'penalty');
  assert.equal(penalty.lost, pending); assert.equal(penalty.fine, FINE); assert.deepEqual([penalty.x, penalty.y, penalty.z], [1, 2, 3]);
  run.update(CHAIN_SECONDS * 2);
  assert.equal(run.score, -FINE, 'the lost chain never banks');
  // A flying lamp, or a car the truck knocked loose: the chain goes on
  for (const by of ['piece', 'loose']) {
    const other = started();
    for (let i = 0; i < CHAIN_STEP; i++) other.smash(['bench']);
    const pot = other.pending;
    other.pedestrian(null, by, 'lamp');
    assert.equal(other.pending, pot, by); assert.equal(other.chain, CHAIN_STEP); assert.equal(other.score, -FINE);
    assert.equal(other.drainEvents().find(event => event.kind === 'penalty').lost, 0);
    other.update(CHAIN_SECONDS);
    assert.equal(other.score, pot - FINE, `${by}: the chain banks`);
  }
});

test('one mishap is one fine: a pair hit together, or someone a body is thrown into', () => {
  const run = started();
  run.pedestrian(null, 'player'); run.pedestrian(null, 'player');
  assert.equal(run.people, 2); assert.equal(run.score, -FINE);
  run.update(FINE_GAP);
  run.pedestrian(null, 'piece', 'person');
  assert.equal(run.people, 3); assert.equal(run.score, -FINE, 'a thrown body hitting someone is the same mishap'); assert.equal(run.fineCount, 1);
  run.pedestrian(null, 'piece', 'bin');
  assert.equal(run.score, -2 * FINE);
  assert.equal(run.drainEvents().filter(event => event.kind === 'penalty').length, 2);
});

test('parked cars pay part of their price and no time', () => {
  const run = started();
  assert.equal(run.damageCar(car('van', { parked: {} }), WRECK_SPEED), CAR_PRICES.van * PARKED_SHARE);
  assert.equal(run.damageCar(car('van'), WRECK_SPEED), CAR_PRICES.van);
  assert.equal(run.timeLeft, RUN_SECONDS + TAKEDOWN_SECONDS);
});

test('the chain waits less for the next smash as its multiplier climbs', () => {
  assert.equal(chainSeconds(1), CHAIN_SECONDS);
  for (let m = 2; m <= MULTIPLIER_MAX; m++) assert.ok(chainSeconds(m) < chainSeconds(m - 1) && chainSeconds(m) > 1.2);
  const run = started();
  for (let i = 0; i < CHAIN_STEP * (MULTIPLIER_MAX - 1); i++) run.smash(['bin']);
  assert.equal(run.multiplier, MULTIPLIER_MAX); assert.equal(run.chainLeft, 1);
  run.update(chainSeconds(MULTIPLIER_MAX) - .05);
  assert.equal(run.score, 0);
  run.update(.1);
  assert.ok(run.score > 0, 'held too long at the top, it banks');
});

test('time up mid-chain plays the chain out: no time comes back, and the run ends when it banks', () => {
  const run = started(null, [contract('trees', 1)]);
  run.update(RUN_SECONDS - 1);
  run.smash(['lamp']); run.update(1.5);
  assert.equal(run.status, 'running'); assert.equal(run.timeLeft, 0); assert.ok(run.overtime);
  assert.ok(run.drainEvents().some(event => event.kind === 'overtime'));
  // Smashes still pay, at the chain's multiplier, but a takedown or a contract adds no time
  run.smash(['tree']); run.damageCar(car('van'), WRECK_SPEED);
  assert.equal(run.timeLeft, 0); assert.equal(run.contracts[0].done, true); assert.equal(run.takedowns, 1);
  const events = run.drainEvents();
  assert.equal(events.find(event => event.kind === 'wreck').seconds, 0); assert.equal(events.find(event => event.kind === 'contract').seconds, 0);
  run.update(CHAIN_SECONDS);
  assert.equal(run.status, 'over'); assert.equal(run.score, PRICES.lamp + PRICES.tree + CAR_PRICES.van);
  // Lost to a pedestrian, the chain ends the run there and then
  const lost = started();
  lost.update(RUN_SECONDS - .5); lost.smash(['lamp']); lost.update(1);
  assert.ok(lost.overtime); lost.pedestrian(null, 'player'); lost.update(.01);
  assert.equal(lost.status, 'over'); assert.equal(lost.score, -FINE);
  // With no chain going the clock simply runs out
  const quiet = started(); quiet.update(RUN_SECONDS);
  assert.equal(quiet.status, 'over'); assert.equal(quiet.overtime, false);
});

test('contracts: three a run, drawn by the runs played, harder with a better rating, each worth time when done', () => {
  const first = runContracts(0), again = runContracts(0), next = runContracts(1);
  assert.equal(first.length, CONTRACTS_PER_RUN); assert.equal(new Set(first.map(entry => entry.id)).size, CONTRACTS_PER_RUN);
  assert.deepEqual(first, again, 'a restarted run keeps its contracts');
  assert.notDeepEqual(first.map(entry => entry.id), next.map(entry => entry.id));
  const tiers = contracts => contracts.map(entry => entry.tier).sort();
  assert.deepEqual(tiers(first), [0, 0, 1], 'one is a tier harder');
  assert.deepEqual(tiers(runContracts(0, DEMOLITION_RANKS.findIndex(rank => rank.id === 'b'))), [1, 1, 2]);
  // (in the list's order, so the chain ones come last)
  for (let runs = 0; runs < 20; runs++) {
    const order = runContracts(runs).map(entry => CONTRACTS.findIndex(type => type.id === entry.id));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  }
  for (const type of CONTRACTS) assert.ok(type.targets[0] < type.targets[1] && type.targets[1] < type.targets[2], type.id);
  // Progress is news as it moves; done, the contract pays its time
  const run = started(null, [contract('trees', 2), contract('parked', 1), contract('bank', 15000)]);
  run.smash(['tree']);
  assert.deepEqual(run.drainEvents().filter(event => event.kind === 'progress').map(event => event.text), ['Trees 1 / 2']);
  run.smash(['tree']);
  const done = run.drainEvents().find(event => event.kind === 'contract');
  assert.equal(done.contract.id, 'trees'); assert.equal(done.seconds, CONTRACT_SECONDS); assert.equal(run.timeLeft, RUN_SECONDS + CONTRACT_SECONDS);
  run.damageCar(car('hatchback', { parked: {} }), WRECK_SPEED);
  assert.equal(run.contracts[1].done, true);
  // A bank contract is done by one chain banking enough, and says nothing on the way
  assert.equal(run.contracts[2].done, false);
  run.update(CHAIN_SECONDS);
  assert.equal(run.contracts[2].done, true); assert.equal(run.contractsDone, 3);
  assert.equal(run.timeLeft, RUN_SECONDS + 3 * CONTRACT_SECONDS - CHAIN_SECONDS);
  // Time won stops at the clock's cap
  const full = started(null, [contract('lamps', 1)]); full.timeLeft = MAX_SECONDS - 2; full.smash(['lamp']);
  assert.equal(full.timeLeft, MAX_SECONDS);
  assert.equal(compactMoney(40000), '$40K'); assert.equal(compactMoney(1200000), '$1.2M');
});

test('passing the best run on the table is news, once', () => {
  const storage = memory();
  new DemolitionRecords(storage).record({ score: 10000, smashed: 1, wrecked: 0, bestChain: 1 });
  const run = started(storage);
  assert.equal(run.previousBest, 10000);
  run.damageCar(car('sedan'), WRECK_SPEED); run.update(CHAIN_SECONDS);
  assert.ok(run.beatBest); assert.equal(run.drainEvents().filter(event => event.kind === 'record').length, 1);
  run.damageCar(car('van'), WRECK_SPEED); run.update(CHAIN_SECONDS);
  assert.equal(run.drainEvents().filter(event => event.kind === 'record').length, 0);
  // (a first run has nothing to beat)
  const fresh = started(); fresh.damageCar(car('van'), WRECK_SPEED); fresh.update(CHAIN_SECONDS);
  assert.equal(fresh.beatBest, false);
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

test('two tabs on one high score table keep both tabs\' runs', () => {
  const storage = memory(), a = new DemolitionRecords(storage), b = new DemolitionRecords(storage);
  a.record({ score: 900, smashed: 1, wrecked: 0, bestChain: 1 });
  assert.equal(b.record({ score: 500, smashed: 1, wrecked: 0, bestChain: 1 }).placement, 1);
  const table = new DemolitionRecords(storage);
  assert.deepEqual(table.scores.map(entry => entry.score), [900, 500]); assert.equal(table.runs, 2); assert.equal(table.lifetime, 1400);
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
