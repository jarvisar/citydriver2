// Free drive's stunt chain. Drifts, jumps, near misses, flying stunts and
// smashes chain together the way a demolition run's smashes do (the same
// multiplier steps and the same shrinking wait), and when the chain runs out
// its pot goes into the fleet balance. A crash, a spin out or running someone
// over loses it, as a bail loses a combo in Tony Hawk's. It's deliberately
// small money next to a taxi shift: the point is that the stunts count for
// something outside a run too.

import { CALLOUTS, CHAIN_STEP, MULTIPLIER_MAX, chainMultiplier, chainSeconds, PRICES, PIECE_NAMES, CAR_PRICES, PARKED_SHARE, carDamage, DENT_SPEED, DENT_GAP } from './demolition-run.js';

// Dollars per stunt, before the multiplier
export const STUNTS = {
  drift: [['Drift', 5], ['Super drift', 10], ['Ultra drift', 20]],
  nearMiss: 6,
  // a jump: a flat amount, more for each second in the air, and each full spin
  jump: 4, air: 6, spin: 15, trick: 5,
  // the flying machines' stunts and landings, by the name they give them
  flight: { 'Barrel roll': 12, 'Loop the loop': 20, 'Under the bridge': 25, 'Rooftop landing': 15, 'Smooth landing': 3 },
};
// Smashing pays this share of what the same piece earns in a demolition run
// (a lamp post $16, a tree $22, a traffic car written off $70 to $140)
export const SMASH_SHARE = .005;
// Faster than this past traffic going its own speed, and close
const NEAR_SPEED = 14, NEAR_CLOSING = 7, NEAR_GAP = 2.5;

// A near miss: the player going past `car` fast, within NEAR_GAP of its side
// (a taxi shift tips for the same thing)
export function nearMiss(player, car) {
  if (Math.abs(player.speed) <= NEAR_SPEED || Math.abs(player.speed - car.speed * Math.cos(car.heading - player.heading)) < NEAR_CLOSING) return false;
  const ds = car.s - player.s, du = car.u - player.u;
  const along = ds * Math.cos(player.heading) + du * Math.sin(player.heading);
  const across = Math.abs(du * Math.cos(player.heading) - ds * Math.sin(player.heading));
  const clearance = (player.spec?.width ?? 2) / 2 + (car.spec?.width ?? 2) / 2 + .4;
  return Math.abs(along) < 2.5 && across > clearance && across < clearance + NEAR_GAP;
}

export class StuntChain {
  constructor() {
    this.events = []; this.elapsed = 0;
    this.scrapedAt = -Infinity; this.lastImpact = null; this.lastCrash = null; this.cooldown = 0;
    this.cars = new WeakMap(); this.passed = new WeakSet();
    this.chain = 0; this.pot = 0; this.chainTime = 0; this.last = null;
  }
  get multiplier() { return chainMultiplier(this.chain); }
  get chainLeft() { return this.chain ? Math.max(0, Math.min(1, this.chainTime / chainSeconds(this.multiplier))) : 0; }
  get nextStep() { return this.multiplier >= MULTIPLIER_MAX ? 0 : CHAIN_STEP * this.multiplier - this.chain; }
  // A stunt worth `value` dollars before the multiplier. `at` is where in the
  // world it happened, for the number floating off it (`pop` false where the
  // stunt has a label of its own, as a jump or a flying stunt does).
  add(value, label, at = null, kind = 'stunt', pop = true) {
    if (!(value > 0) || this.cooldown > 0) return 0;
    const before = this.multiplier;
    this.chain++;
    const multiplier = this.multiplier, earned = Math.round(value * multiplier);
    this.chainTime = chainSeconds(multiplier); this.pot += earned;
    this.last = { label, value: earned };
    this.events.push({ kind, label, value: earned, chain: this.chain, multiplier, pop, x: at?.x ?? 0, y: at?.y ?? 0, z: at?.z ?? 0 });
    if (multiplier > before) this.events.push({ kind: 'multiplier', multiplier, text: `${CALLOUTS[multiplier]}! ×${multiplier}` });
    return earned;
  }
  // The chain is over: its pot is the player's (main.js pays it out)
  bank() {
    if (!this.chain) return 0;
    const amount = this.pot, chain = this.chain, multiplier = this.multiplier;
    this.chain = 0; this.pot = 0; this.chainTime = 0; this.last = null;
    this.events.push({ kind: 'banked', amount, chain, multiplier, text: chain > 1 ? `${chain} stunt chain · +$${amount.toLocaleString('en-US')}` : `+$${amount.toLocaleString('en-US')}` });
    return amount;
  }
  // Lost, with nothing paid: a crash, a spin out, someone run over
  lose(reason) {
    // (and stunts don't count again until the car is clear of whatever it hit)
    this.cooldown = .8;
    if (!this.chain) return 0;
    const lost = this.pot;
    this.chain = 0; this.pot = 0; this.chainTime = 0; this.last = null;
    this.events.push({ kind: 'lost', lost, text: `${reason} · $${lost.toLocaleString('en-US')} chain lost` });
    return lost;
  }
  // A step. `active` is false while autodrive drives: nothing counts then,
  // and a chain going is banked.
  update(dt, player, traffic = [], { active = true, aloft = false } = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt; this.cooldown = Math.max(0, this.cooldown - dt);
    const telemetry = player.audioTelemetry, impact = telemetry?.impactSerial ?? 0, crash = telemetry?.crashSerial ?? 0;
    const collided = this.lastImpact !== null && impact !== this.lastImpact, crashed = this.lastCrash !== null && crash !== this.lastCrash;
    this.lastImpact = impact; this.lastCrash = crash;
    if (!active) { this.bank(); return; }
    // (a drift that touched anything pays nothing, so grinding along a wall earns nothing)
    if (collided) this.scrapedAt = this.elapsed;
    if (crashed) this.lose('Crash');
    if (!player.walker && !player.pilot && !collided && this.cooldown === 0) {
      for (const car of traffic) {
        if (this.passed.has(car) || !nearMiss(player, car)) continue;
        this.passed.add(car); this.add(STUNTS.nearMiss, 'Near miss', player.groundedPosition);
      }
    }
    // (a jump keeps the chain waiting while the car is in the air)
    if (this.chain && !aloft && (this.chainTime -= dt) <= 0) this.bank();
  }
  // A drift's sparks changing colour (see Drift)
  drifted(event, at) {
    if (this.elapsed - this.scrapedAt < event.time) return 0;
    const [label, value] = STUNTS.drift[event.stage - 1] ?? [];
    return this.add(value, label, at);
  }
  // A car's jump landed (see CarAir). A spin out or the river loses the chain.
  jumped(event, at) {
    if (event.landing === 'spun') return this.lose('Spun out');
    if (event.landing === 'splash') return this.lose('In the river');
    const turns = Math.abs(event.turns ?? 0);
    const value = STUNTS.jump + Math.round(STUNTS.air * event.air) + turns * STUNTS.spin + (event.trick ? STUNTS.trick : 0);
    return this.add(value, turns ? `${turns * 360} spin` : event.trick ? 'Trick' : event.air >= 1.6 ? 'Big air' : 'Air', at, 'stunt', false);
  }
  // A flying machine's stunt or landing (see Helicopter and Plane)
  flew(event, at) {
    if (event.kind === 'bounce') return this.lose('Hard landing');
    return this.add(STUNTS.flight[event.text] ?? 0, event.text, at, 'stunt', false);
  }
  // Furniture knocked loose (see LooseProps.onSmash)
  smashed(kinds, at) {
    const price = (kinds ?? []).reduce((sum, kind) => sum + (PRICES[kind] ?? 0), 0);
    if (!price) return 0;
    const kind = kinds[0];
    return this.add(Math.max(1, Math.round(price * SMASH_SHARE)), kinds.length > 1 && kind === 'table' ? 'Cafe terrace' : PIECE_NAMES[kind] ?? 'Smash', at, 'smash');
  }
  // A blow to a traffic or parked car (see CityTraffic.onDamage), each car
  // paid for once, as in a demolition run
  damaged(car, closing, at = car?.position) {
    if (!car || closing < DENT_SPEED) return 0;
    let record = this.cars.get(car);
    if (!record || record.generation !== car.generation) this.cars.set(car, record = { generation: car.generation, damage: 0, hit: -Infinity, parked: Boolean(car.parked) });
    if (this.elapsed - record.hit < DENT_GAP) return 0;
    const price = (CAR_PRICES[car.spec?.name] ?? 18000) * (record.parked ? PARKED_SHARE : 1);
    const value = Math.min(price - record.damage, carDamage(price, closing));
    if (!(value > 0)) return 0;
    record.damage += value; record.hit = this.elapsed;
    return this.add(Math.max(1, Math.round(value * SMASH_SHARE)), record.damage >= price ? 'Wrecked' : 'Dent', at, 'smash');
  }
  // Someone knocked over by the player's car
  pedestrian() { return this.lose('Pedestrian!'); }
  drainEvents() { return this.events.splice(0); }
}
