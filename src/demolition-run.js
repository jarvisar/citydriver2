// Demolition: a timed run in the truck, doing as much damage to the city as
// the clock allows. After Burnout's Crash and Road Rage: everything knocked
// loose has a price, cars are the big money, and wrecking a moving car buys
// a little more time, as do the run's three contracts. Smashes close
// together build a chain, each paying its price times the chain's multiplier
// as it lands, as Crazy Taxi's tips do. As in Tony Hawk's combos, the
// chain's pot is only banked once nothing has been hit for a moment, running
// a pedestrian over loses it, and a chain going when time runs out plays on.

import { randomAt } from './world/route.js';

// The truck, in site-work orange
export const DEMOLITION_CAR = 'rig', DEMOLITION_PAINT = '#e27a24';
export const RUN_SECONDS = 60;
// Wrecking a moving car adds this much to the clock, which holds no more than MAX_SECONDS
export const TAKEDOWN_SECONDS = 3, MAX_SECONDS = 120;
// The chain: how long it waits for the next smash, and how many smashes each
// step of its multiplier takes, up to MULTIPLIER_MAX. Multiplying the whole
// pot when it banked (and a cap of 8, a step every 3) grew a chain with the
// square of its length: one lucky chain decided a run, and a playtest bot
// ramming parked cars reached the top rating on its first go.
export const CHAIN_SECONDS = 2.5, CHAIN_STEP = 4, MULTIPLIER_MAX = 5;
export const chainMultiplier = chain => Math.min(MULTIPLIER_MAX, 1 + Math.floor(chain / CHAIN_STEP));
// The wait gets shorter as the multiplier climbs, as Burnout Paradise's stunt
// combos do: holding ×5 takes a smash every 1.7 s
export const CHAIN_TIGHTEN = .2;
export const chainSeconds = multiplier => CHAIN_SECONDS - CHAIN_TIGHTEN * (multiplier - 1);
// Called out as the multiplier climbs
export const CALLOUTS = ['', '', 'Smash', 'Wrecking', 'Rampage', 'Total chaos'];
export const FINE = 10000, FINE_GAP = 1;
// Each smash tops up the boost, as a taxi's stunts do, and a wreck more
export const SMASH_BOOST = .06, WRECK_BOOST = .2;

// Street furniture, per piece that comes loose (a cafe's table and chairs
// come loose together, and are paid for together)
export const PRICES = {
  bin: 250, chair: 120, table: 350, sign: 450, bench: 1100, lantern: 1400, stall: 2400,
  lamp: 3200, tree: 4500, signal: 6500, shelter: 9000, mast: 18000,
  'news-boxes': 300, 'bike-rack': 400, 'post-box': 900, cabinet: 1600, hydrant: 2200,
};
export const PIECE_NAMES = {
  bin: 'Litter bin', chair: 'Cafe chair', table: 'Cafe table', sign: 'Street sign', bench: 'Bench', lantern: 'Park lantern',
  stall: 'Market stall', lamp: 'Lamp post', tree: 'Tree', signal: 'Traffic light', shelter: 'Bus shelter', mast: 'Signal gantry',
  'news-boxes': 'News stand', 'bike-rack': 'Bike rack', 'post-box': 'Post box', cabinet: 'Utility box', hydrant: 'Fire hydrant',
};
// Cars by model: what it costs to write one off. A parked car pays
// PARKED_SHARE of that: they stand in rows, and a truck ploughing a row of
// them earned most of every big run's score (1.3M of 1.6M in one bot run).
export const CAR_PRICES = { hatchback: 14000, sedan: 19000, wagon: 21000, pickup: 26000, van: 29000, bus: 45000 };
export const PARKED_SHARE = .5;
const CAR_NAMES = { hatchback: 'Hatchback', sedan: 'Sedan', wagon: 'Estate', pickup: 'Pickup', van: 'Van', bus: 'Bus' };
const CAR_PRICE = 18000;
// A blow closing at WRECK_SPEED (m/s) writes a car off at once; slower ones
// dent it by the square of their speed, so it pays to hit hard. Under
// DENT_SPEED it is a touch, and a car counts one blow per DENT_GAP seconds,
// so leaning on one earns nothing.
export const WRECK_SPEED = 16, DENT_SPEED = 2.5, DENT_GAP = .35;
// A jump that keeps a chain going says so from this far (m)
const AIR_NEWS = 8;
export const carDamage = (price, closing) => closing < DENT_SPEED ? 0 : Math.max(10, Math.round(price * Math.min(1, (closing / WRECK_SPEED) ** 2) / 10) * 10);

// Contracts: three jobs a run, drawn from these, each worth CONTRACT_SECONDS
// on the clock when done, as a taxi shift's goals are. They give a run its
// own shape (a run after bus shelters goes looking for bus stops) and are
// the clock's other source of time besides takedowns. `stat` is what the run
// counts (see `tally`), targets step up with the best rating yet, and one of
// the three is always a tier harder.
export const CONTRACT_SECONDS = 10, CONTRACTS_PER_RUN = 3;
export const CONTRACTS = [
  { id: 'trees', stat: 'tree', targets: [3, 5, 8], text: n => `Fell ${n} trees`, short: 'Trees' },
  { id: 'lamps', stat: 'lamp', targets: [4, 7, 12], text: n => `Flatten ${n} lamp posts`, short: 'Lamp posts' },
  { id: 'signals', stat: 'signals', targets: [1, 3, 5], text: n => `Knock down ${n} traffic light${n > 1 ? 's' : ''}`, short: 'Traffic lights' },
  { id: 'shelters', stat: 'shelter', targets: [1, 2, 3], text: n => `Crush ${n} bus shelter${n > 1 ? 's' : ''}`, short: 'Bus shelters' },
  { id: 'parked', stat: 'parkedWrecks', targets: [2, 4, 7], text: n => `Write off ${n} parked cars`, short: 'Parked cars' },
  { id: 'takedowns', stat: 'takedowns', targets: [1, 2, 4], text: n => `${n} takedown${n > 1 ? 's' : ''}`, short: 'Takedowns' },
  { id: 'chain', stat: 'bestChain', targets: [8, 14, 22], text: n => `A ${n} hit chain`, short: 'Chain' },
  { id: 'bank', stat: 'bestBank', targets: [40000, 120000, 300000], text: n => `Bank ${compactMoney(n)} in one chain`, short: 'Best bank', money: true },
];
export const contractTier = rank => Math.min(2, Math.floor(rank / 2));
// Drawn by the number of runs finished, so a restarted run keeps its contracts
export function runContracts(runs, rank = 0) {
  const tier = contractTier(rank), pool = [...CONTRACTS], contracts = [];
  for (let i = 0; i < CONTRACTS_PER_RUN && pool.length; i++) {
    const [type] = pool.splice(Math.floor(randomAt(runs, i + 44021) * pool.length), 1);
    const level = i === CONTRACTS_PER_RUN - 1 ? Math.min(2, tier + 1) : tier, target = type.targets[level];
    contracts.push({ id: type.id, stat: type.stat, tier: level, target, text: type.text(target), short: type.short, money: Boolean(type.money), progress: 0, done: false });
  }
  // (in the list's order: things to go and hit first, the chain ones last,
  // as the task card leads with the first still open)
  const order = contract => CONTRACTS.findIndex(type => type.id === contract.id);
  return contracts.sort((a, b) => order(a) - order(b));
}

// End-of-run ratings, after the taxi's licences: each asks for about twice
// the one before. A first go lands around C; a run that keeps its chains
// going and its clock topped up reaches the top. (They were half these
// before contracts and the last chain made runs longer, and before a
// pedestrian hit by debris stopped costing the chain.)
export const DEMOLITION_RANKS = [
  { id: 'none', badge: '–', name: 'Fender bender', min: 0 },
  { id: 'd', badge: 'D', name: 'Nuisance', min: 50000 },
  { id: 'c', badge: 'C', name: 'Vandal', min: 125000 },
  { id: 'b', badge: 'B', name: 'Menace', min: 250000 },
  { id: 'a', badge: 'A', name: 'Wrecking ball', min: 500000 },
  { id: 's', badge: 'S', name: 'Natural disaster', min: 1000000 },
  { id: 'legend', badge: '★', name: 'Act of God', min: 2000000 },
];
export function demolitionRank(score = 0) {
  const rank = Math.max(0, DEMOLITION_RANKS.findLastIndex(entry => score >= entry.min));
  return { ...DEMOLITION_RANKS[rank], rank, next: DEMOLITION_RANKS[rank + 1] ?? null };
}

// The high score table: the best few runs, plus lifetime totals
export const SCORES_KEY = 'citydriver-demolition-scores';
export const SCORE_SLOTS = 5;
const validCount = value => Number.isSafeInteger(value) && value >= 0;
export class DemolitionRecords {
  constructor(storage = null) {
    this.storage = storage; this.saved = Boolean(storage); this.scores = []; this.runs = 0; this.lifetime = 0;
    try {
      const data = JSON.parse(storage?.getItem(SCORES_KEY) ?? 'null');
      if (data?.version === 1) {
        if (validCount(data.runs)) this.runs = data.runs;
        if (validCount(data.lifetime)) this.lifetime = data.lifetime;
        this.scores = (Array.isArray(data.scores) ? data.scores : []).filter(entry => validCount(entry?.score) && entry.score > 0)
          .map(({ score, smashed, wrecked, chain, date }) => ({ score, smashed: validCount(smashed) ? smashed : 0, wrecked: validCount(wrecked) ? wrecked : 0,
            chain: validCount(chain) ? chain : 0, date: typeof date === 'string' ? date.slice(0, 10) : '' }))
          .sort((a, b) => b.score - a.score).slice(0, SCORE_SLOTS);
      }
    } catch { /* Corrupt or unavailable storage starts a fresh table. */ }
  }
  get best() { return this.scores[0]?.score ?? 0; }
  save() {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(SCORES_KEY, JSON.stringify({ version: 1, runs: this.runs, lifetime: this.lifetime, scores: this.scores }));
      this.saved = true;
    } catch { this.saved = false; }
  }
  // Closes a run: its place in the table (from 0), or -1 if it missed it
  record(run, now = Date.now()) {
    const previousBest = this.best, score = Math.max(0, Math.round(run.score));
    this.runs++; this.lifetime += score;
    const entry = { score, smashed: run.smashed, wrecked: run.wrecked, chain: run.bestChain, date: new Date(now).toISOString().slice(0, 10) };
    // (a tie goes below the run that set it first)
    let placement = score > 0 ? this.scores.findIndex(other => score > other.score) : -1;
    if (score > 0 && placement < 0 && this.scores.length < SCORE_SLOTS) placement = this.scores.length;
    if (placement >= 0) { this.scores.splice(placement, 0, entry); this.scores.length = Math.min(this.scores.length, SCORE_SLOTS); }
    this.save();
    return { placement, entry, previousBest, best: placement === 0 && score > previousBest };
  }
}

export class DemolitionRun {
  constructor(storage = null) {
    this.records = new DemolitionRecords(storage);
    this.status = 'idle'; this.events = []; this.summary = null; this.score = 0; this.timeLeft = RUN_SECONDS;
    this.chain = 0; this.pot = 0; this.chainTime = 0; this.boost = 1; this.boostActive = false;
  }
  get running() { return this.status === 'running'; }
  get multiplier() { return chainMultiplier(this.chain); }
  // What the chain would bank now
  get pending() { return this.pot; }
  // How much of the chain's wait for the next smash is left, 0 to 1
  get chainLeft() { return this.chain ? Math.max(0, Math.min(1, this.chainTime / chainSeconds(this.multiplier))) : 0; }
  // Smashes still wanted for the next step of the multiplier (0 at the top)
  get nextStep() { return this.multiplier >= MULTIPLIER_MAX ? 0 : CHAIN_STEP * this.multiplier - this.chain; }
  get rank() { return demolitionRank(this.score); }
  start() {
    this.status = 'running'; this.timeLeft = RUN_SECONDS; this.elapsed = 0; this.score = 0;
    this.chain = 0; this.pot = 0; this.chainTime = 0; this.boost = 1; this.boostActive = false;
    this.events = []; this.summary = null; this.last = null; this.cars = new WeakMap();
    // What the run can be measured by, on the results screen
    this.smashed = 0; this.carsHit = 0; this.wrecked = 0; this.takedowns = 0; this.trees = 0; this.people = 0; this.fines = 0; this.fineCount = 0;
    this.bestChain = 0; this.bestMultiplier = 1; this.bestBank = 0; this.biggest = null; this.bonusSeconds = 0;
    this.previousBest = this.records.best; this.overtime = false; this.beatBest = false; this.fined = -Infinity;
    // What the contracts count besides the run's own numbers: furniture by kind, parked cars written off
    this.tally = { parkedWrecks: 0, signals: 0 };
    this.contracts = runContracts(this.records.runs, demolitionRank(this.records.best).rank);
  }
  stop() { this.status = 'idle'; this.boostActive = false; this.chain = 0; this.pot = 0; this.chainTime = 0; this.overtime = false; this.events = []; }
  get contractsDone() { return this.contracts?.filter(contract => contract.done).length ?? 0; }
  // The run so far, in the terms the contracts use
  get stats() { return { ...this.tally, takedowns: this.takedowns, bestChain: this.bestChain, bestBank: this.bestBank }; }
  // A contract done pays its time at once (none once the clock has run
  // out); one moved on says how far it has got
  checkContracts(at = null) {
    const stats = this.stats;
    for (const contract of this.contracts) {
      if (contract.done) continue;
      const progress = Math.min(contract.target, Math.max(0, stats[contract.stat] ?? 0));
      if (progress === contract.progress) continue;
      contract.progress = progress;
      if (progress < contract.target) {
        if (!contract.money) this.events.push({ kind: 'progress', contract, text: `${contract.short} ${progress} / ${contract.target}` });
        continue;
      }
      contract.done = true;
      const seconds = this.overtime ? 0 : Math.min(CONTRACT_SECONDS, MAX_SECONDS - this.timeLeft);
      this.timeLeft += seconds; this.bonusSeconds += seconds;
      this.events.push({ kind: 'contract', contract, seconds, x: at?.x ?? 0, y: at?.y ?? 0, z: at?.z ?? 0,
        text: `Contract done · ${contract.text}${seconds ? ` · +${seconds}s` : ''}` });
    }
  }
  // Boost is metered, as on a taxi run; smashing fills it
  controls(dt, input) {
    const gas = input.forward > 0 || input.touchDrive?.amount > .1;
    this.boostActive = this.running && Boolean(input.boost) && gas && !input.brake && !input.stop && this.boost > .01;
    if (this.running) this.boost = Math.max(0, Math.min(1, this.boost + dt * (this.boostActive ? -.44 : input.boost ? 0 : .16)));
    return { ...input, boost: this.boostActive };
  }
  // One blow that did damage (`value`, its price): times the chain's
  // multiplier, it joins the pot, and the chain waits for the next one again.
  // `at` is where, in the world, for the number that floats up from it.
  // Returns the damage done.
  add(value, label, at, kind, extra = {}) {
    const before = this.multiplier;
    this.chain++;
    const multiplier = this.multiplier, earned = value * multiplier;
    this.chainTime = chainSeconds(multiplier);
    this.pot += earned;
    this.bestChain = Math.max(this.bestChain, this.chain); this.bestMultiplier = Math.max(this.bestMultiplier, multiplier);
    this.boost = Math.min(1, this.boost + (kind === 'wreck' ? WRECK_BOOST : SMASH_BOOST));
    this.last = { label, value: earned, kind, at: this.elapsed };
    if (!this.biggest || earned > this.biggest.value) this.biggest = { label, value: earned };
    this.events.push({ kind, label, value: earned, price: value, chain: this.chain, multiplier, x: at?.x ?? 0, y: at?.y ?? 0, z: at?.z ?? 0, ...extra });
    if (multiplier > before) this.events.push({ kind: 'multiplier', multiplier, text: `${CALLOUTS[multiplier]}! ×${multiplier}` });
    return value;
  }
  // Furniture knocked loose: `kinds` are its pieces (see LooseProps)
  smash(kinds, at = null) {
    if (!this.running || !kinds?.length) return 0;
    const value = kinds.reduce((sum, kind) => sum + (PRICES[kind] ?? 0), 0);
    if (!value) return 0;
    this.smashed++; if (kinds.includes('tree')) this.trees++;
    const kind = kinds[0], label = kinds.length > 1 && kind === 'table' ? 'Cafe terrace' : PIECE_NAMES[kind] ?? 'Street furniture';
    this.tally[kind] = (this.tally[kind] ?? 0) + 1;
    if (kind === 'signal' || kind === 'mast') this.tally.signals++;
    this.add(value, label, at, 'smash');
    this.checkContracts(at);
    return value;
  }
  // A blow to a car, closing at `closing` m/s, whoever dealt it (the truck, or
  // a car it sent flying). A car is paid for up to its price, once; a parked
  // car knocked from its bay counts from its first blow. `car` is one of the
  // traffic's (see CityTraffic): its model, whether it is parked, and its
  // generation, which a car recycled into a new one, or a stand-in woken for
  // another bay, moves on.
  damageCar(car, closing, at = car?.position) {
    if (!this.running || !car) return 0;
    let record = this.cars.get(car);
    if (!record || record.generation !== car.generation) this.cars.set(car, record = { generation: car.generation, damage: 0, hit: -Infinity, wrecked: false, parked: Boolean(car.parked) });
    if (record.wrecked || closing < DENT_SPEED || this.elapsed - record.hit < DENT_GAP) return 0;
    const model = car.spec?.name, price = (CAR_PRICES[model] ?? CAR_PRICE) * (record.parked ? PARKED_SHARE : 1);
    const value = Math.min(price - record.damage, carDamage(price, closing));
    if (!(value > 0)) return 0;
    if (!record.damage) this.carsHit++;
    record.damage += value; record.hit = this.elapsed;
    const name = `${record.parked ? 'Parked ' : ''}${(CAR_NAMES[model] ?? 'car').toLowerCase()}`.replace(/^./, first => first.toUpperCase());
    if (record.damage < price) return this.add(value, name, at, 'dent');
    record.wrecked = true; this.wrecked++;
    // A moving car written off is a takedown, and buys time
    let seconds = 0;
    if (record.parked) this.tally.parkedWrecks++;
    else {
      this.takedowns++;
      seconds = this.overtime ? 0 : Math.min(TAKEDOWN_SECONDS, MAX_SECONDS - this.timeLeft);
      this.timeLeft += seconds; this.bonusSeconds += seconds;
    }
    this.add(value, `${name} wrecked`, at, 'wreck', { seconds });
    this.checkContracts(at);
    return value;
  }
  // Someone knocked over (see PedestrianContacts.onKnock): a fine. Run over
  // by the truck itself (`by` 'player'), the chain's pot is lost too, as a
  // bail loses a combo. Hit by what the truck sent flying or a car it knocked
  // loose, the chain goes on: the player can see where the truck is going,
  // not where a lamp lands, and in the playtests those were over half the
  // fines. One mishap is one fine: a pair walking together, or someone a
  // body was thrown into (`kind` 'person'), within FINE_GAP.
  pedestrian(at = null, by = 'player', kind = null) {
    if (!this.running) return;
    const bail = by === 'player', lost = bail ? this.pending : 0, fine = kind !== 'person' && this.elapsed - this.fined >= FINE_GAP ? FINE : 0;
    this.people++;
    if (fine) { this.fines += fine; this.fineCount++; this.score -= fine; this.fined = this.elapsed; }
    if (bail) { this.chain = 0; this.pot = 0; this.chainTime = 0; }
    if (!fine && !lost) return;
    this.events.push({ kind: 'penalty', fine, lost, by, x: at?.x ?? 0, y: at?.y ?? 0, z: at?.z ?? 0,
      text: `${bail ? 'Pedestrian!' : 'Pedestrian hit'}${fine ? ` −${money(fine)}` : ''}${lost ? ` · ${money(lost)} chain lost` : ''}` });
  }
  // The chain is over: its pot joins the score, and may lift the run's rating
  bank() {
    if (!this.chain) return 0;
    const multiplier = this.multiplier, amount = this.pot, chain = this.chain, before = this.rank;
    this.score += amount; this.bestBank = Math.max(this.bestBank, amount);
    this.chain = 0; this.pot = 0; this.chainTime = 0;
    const rank = this.rank;
    this.events.push({ kind: 'banked', amount, chain, multiplier, rank: rank.rank > before.rank ? rank : null,
      text: chain > 1 ? `${chain} hit chain · +${money(amount)}` : `+${money(amount)}` });
    // (past the best run on the table, once)
    if (!this.beatBest && this.previousBest > 0 && this.score > this.previousBest) {
      this.beatBest = true; this.events.push({ kind: 'record', text: 'New high score!' });
    }
    this.checkContracts();
    return amount;
  }
  // (`aloft`: the truck is in the air off a ramp, and a chain waits for it to come down)
  update(dt, aloft = false) {
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt; this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.chain && !aloft && (this.chainTime -= dt) <= 0) this.bank();
    if (this.timeLeft > 0) return;
    // Time up mid-chain: the chain plays on, as a combo does in Tony Hawk's,
    // and the run ends when it banks or is lost
    if (!this.chain) this.finish();
    else if (!this.overtime) { this.overtime = true; this.events.push({ kind: 'overtime', text: 'Time up · keep the chain going' }); }
  }
  // A jump landed keeps a chain going, as a stunt does in Burnout's Stunt Run
  // (see CarAir): its wait starts again. A spin out doesn't.
  jumped(event) {
    if (!this.running || !this.chain || event.landing === 'spun' || event.landing === 'splash') return;
    this.chainTime = Math.max(this.chainTime, chainSeconds(this.multiplier));
    // (a drop off something, onto a car, is kept quietly)
    if (event.distance >= AIR_NEWS) this.events.push({ kind: 'progress', text: `Air · ${Math.round(event.distance)} m · chain ×${this.multiplier} kept` });
  }
  finish() {
    this.bank();
    this.status = 'over'; this.boostActive = false;
    this.summary = this.records.record(this);
    this.events.push({ kind: 'over' });
  }
  drainEvents() { return this.events.splice(0); }
}
export function money(value) {
  const amount = Math.round(value ?? 0);
  return `${amount < 0 ? '−' : ''}$${Math.abs(amount).toLocaleString('en-US')}`;
}
// A round sum, short: $40K, $1.2M
export const compactMoney = value => value >= 1e6 ? `$${+(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `$${+(value / 1e3).toFixed(1)}K` : money(value);
// How far a contract has got: "2 / 5", or "$65K / $120K"
export const contractProgress = contract => contract.money ? `${compactMoney(contract.progress)} / ${compactMoney(contract.target)}` : `${contract.progress} / ${contract.target}`;
