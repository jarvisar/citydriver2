// Demolition: a timed run in the truck, doing as much damage to the city as
// the clock allows. After Burnout's Crash and Road Rage: everything knocked
// loose has a price, cars are the big money, and wrecking a moving car buys
// a little more time. Smashes close together build a chain, each paying its
// price times the chain's multiplier as it lands, as Crazy Taxi's tips do.
// As in Tony Hawk's combos, the chain's pot is only banked once nothing has
// been hit for CHAIN_SECONDS, and knocking a pedestrian over loses the whole
// pot and costs a fine.

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
// Called out as the multiplier climbs
export const CALLOUTS = ['', '', 'Smash', 'Wrecking', 'Rampage', 'Total chaos'];
export const FINE = 5000;
// Each smash tops up the boost, as a taxi's stunts do, and a wreck more
export const SMASH_BOOST = .06, WRECK_BOOST = .2;

// Street furniture, per piece that comes loose (a cafe's table and chairs
// come loose together, and are paid for together)
export const PRICES = {
  bin: 250, chair: 120, table: 350, sign: 450, bench: 1100, lantern: 1400, stall: 2400,
  lamp: 3200, tree: 4500, signal: 6500, shelter: 9000, mast: 18000,
};
export const PIECE_NAMES = {
  bin: 'Litter bin', chair: 'Cafe chair', table: 'Cafe table', sign: 'Street sign', bench: 'Bench', lantern: 'Park lantern',
  stall: 'Market stall', lamp: 'Lamp post', tree: 'Tree', signal: 'Traffic light', shelter: 'Bus shelter', mast: 'Signal gantry',
};
// Cars by model: what it costs to write one off
export const CAR_PRICES = { hatchback: 14000, sedan: 19000, wagon: 21000, pickup: 26000, van: 29000 };
const CAR_NAMES = { hatchback: 'Hatchback', sedan: 'Sedan', wagon: 'Estate', pickup: 'Pickup', van: 'Van' };
const CAR_PRICE = 18000;
// A blow closing at WRECK_SPEED (m/s) writes a car off at once; slower ones
// dent it by the square of their speed, so it pays to hit hard. Under
// DENT_SPEED it is a touch, and a car counts one blow per DENT_GAP seconds,
// so leaning on one earns nothing.
export const WRECK_SPEED = 16, DENT_SPEED = 2.5, DENT_GAP = .35;
export const carDamage = (price, closing) => closing < DENT_SPEED ? 0 : Math.max(10, Math.round(price * Math.min(1, (closing / WRECK_SPEED) ** 2) / 10) * 10);

// End-of-run ratings, after the taxi's licences: each asks for about twice
// the one before. A first go lands around C; a run that keeps its chains
// going and its clock topped up reaches the top.
export const DEMOLITION_RANKS = [
  { id: 'none', badge: '–', name: 'Fender bender', min: 0 },
  { id: 'd', badge: 'D', name: 'Nuisance', min: 25000 },
  { id: 'c', badge: 'C', name: 'Vandal', min: 60000 },
  { id: 'b', badge: 'B', name: 'Menace', min: 150000 },
  { id: 'a', badge: 'A', name: 'Wrecking ball', min: 300000 },
  { id: 's', badge: 'S', name: 'Natural disaster', min: 600000 },
  { id: 'legend', badge: '★', name: 'Act of God', min: 1200000 },
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
  get chainLeft() { return this.chain ? Math.max(0, Math.min(1, this.chainTime / CHAIN_SECONDS)) : 0; }
  // Smashes still wanted for the next step of the multiplier (0 at the top)
  get nextStep() { return this.multiplier >= MULTIPLIER_MAX ? 0 : CHAIN_STEP * this.multiplier - this.chain; }
  get rank() { return demolitionRank(this.score); }
  start() {
    this.status = 'running'; this.timeLeft = RUN_SECONDS; this.elapsed = 0; this.score = 0;
    this.chain = 0; this.pot = 0; this.chainTime = 0; this.boost = 1; this.boostActive = false;
    this.events = []; this.summary = null; this.last = null; this.cars = new WeakMap();
    // What the run can be measured by, on the results screen
    this.smashed = 0; this.carsHit = 0; this.wrecked = 0; this.takedowns = 0; this.trees = 0; this.people = 0; this.fines = 0;
    this.bestChain = 0; this.bestMultiplier = 1; this.bestBank = 0; this.biggest = null; this.bonusSeconds = 0;
    this.previousBest = this.records.best;
  }
  stop() { this.status = 'idle'; this.boostActive = false; this.chain = 0; this.pot = 0; this.chainTime = 0; this.events = []; }
  // Boost is metered, as on a taxi run; smashing fills it
  controls(dt, input) {
    const gas = input.forward > 0 || input.touchDrive?.amount > .1;
    this.boostActive = this.running && Boolean(input.boost) && gas && !input.brake && !input.handbrake && this.boost > .01;
    if (this.running) this.boost = Math.max(0, Math.min(1, this.boost + dt * (this.boostActive ? -.44 : input.boost ? 0 : .16)));
    return { ...input, boost: this.boostActive };
  }
  // One blow that did damage (`value`, its price): times the chain's
  // multiplier, it joins the pot, and the chain waits for the next one again.
  // `at` is where, in the world, for the number that floats up from it.
  // Returns the damage done.
  add(value, label, at, kind, extra = {}) {
    const before = this.multiplier;
    this.chain++; this.chainTime = CHAIN_SECONDS;
    const multiplier = this.multiplier, earned = value * multiplier;
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
    const label = kinds.length > 1 && kinds[0] === 'table' ? 'Cafe terrace' : PIECE_NAMES[kinds[0]] ?? 'Street furniture';
    return this.add(value, label, at, 'smash');
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
    const model = car.spec?.name, price = CAR_PRICES[model] ?? CAR_PRICE;
    const value = Math.min(price - record.damage, carDamage(price, closing));
    if (!(value > 0)) return 0;
    if (!record.damage) this.carsHit++;
    record.damage += value; record.hit = this.elapsed;
    const name = `${record.parked ? 'Parked ' : ''}${(CAR_NAMES[model] ?? 'car').toLowerCase()}`.replace(/^./, first => first.toUpperCase());
    if (record.damage < price) return this.add(value, name, at, 'dent');
    record.wrecked = true; this.wrecked++;
    // A moving car written off is a takedown, and buys time
    let seconds = 0;
    if (!record.parked) {
      this.takedowns++;
      seconds = Math.min(TAKEDOWN_SECONDS, MAX_SECONDS - this.timeLeft);
      this.timeLeft += seconds; this.bonusSeconds += seconds;
    }
    return this.add(value, `${name} wrecked`, at, 'wreck', { seconds });
  }
  // Someone knocked over by the truck or by what it sent flying: a fine,
  // and the chain's pot is lost
  pedestrian(at = null) {
    if (!this.running) return;
    const lost = this.pending;
    this.people++; this.fines += FINE; this.score -= FINE;
    this.chain = 0; this.pot = 0; this.chainTime = 0;
    this.events.push({ kind: 'penalty', fine: FINE, lost, x: at?.x ?? 0, y: at?.y ?? 0, z: at?.z ?? 0,
      text: `Pedestrian! −${money(FINE)}${lost ? ` · ${money(lost)} chain lost` : ''}` });
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
    return amount;
  }
  update(dt) {
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt; this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.chain && (this.chainTime -= dt) <= 0) this.bank();
    if (this.timeLeft <= 0) this.finish();
  }
  // Time up: whatever chain is going still counts
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
