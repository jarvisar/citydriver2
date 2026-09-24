import { CITY } from './world/city.js';
import { nearestLanePose, waterAt, onRoadAt } from './world/city-route.js';
import { navGraph, routeDistance } from './world/nav-graph.js';
import { nearbyPlaces, cityPlaces } from './city-exploration.js';
import { randomAt } from './world/route.js';
export { routeDistance } from './world/nav-graph.js';
const B = 112;
import { TaxiFleet } from './taxi-fleet.js';
import { TaxiCareer } from './taxi-career.js';
import { shiftGoals, goalProgress } from './taxi-goals.js';

export const SHIFT_SECONDS = 90;
export const STOP_RADIUS = 8;
export const STOP_SECONDS = .45;
export const GROUP_MAX_LEG = 650;
// How far a hop between drop-offs may wander from the straight line. A grid
// costs about √2 on a diagonal, so anything beyond this is a river, a dead end
// or a hop that doubles back through the block it started on.
export const GROUP_MAX_DETOUR = 1.45;
export const GROUP_MAX_ROUTE = 2200;
export const MAX_SHIFT_SECONDS = 180;
// Cosine of the sharpest turn a party route may take between two drop-offs,
// about 105°. Street routes zigzag, so demanding a strictly forward hop left
// most full cabs with nowhere legal to go.
export const GROUP_MIN_TURN = -.25;
// Each hop samples a handful of the closest unused places; the chain is built
// for every waiting ring, so the route tracing has to stay cheap.
const GROUP_CANDIDATES = 6;
const CUSTOMER_RANGE = B * 3;
// A new pickup never waits where the last rider got out. Pickup sites and
// destinations are laid out independently, so without this about one drop-off
// in four ended beside, or inside, a fresh ring.
export const DROP_OFF_CLEARANCE = 60;
// As in Crazy Taxi, a waiting fare's colour says how far the whole job goes:
// red is a hop around the corner, green a long haul that pays the most.
export const FARE_BANDS = [
  { id: 'hop', label: 'Quick hop', color: '#ff5a4a', below: 550 },
  { id: 'short', label: 'Short ride', color: '#ff9c33', below: 800 },
  { id: 'medium', label: 'Medium ride', color: '#ffe03d', below: 1100 },
  { id: 'long', label: 'Long ride', color: '#5fe06a', below: Infinity },
];
export const fareBand = length => FARE_BANDS.find(band => length < band.below);
// Crazy Taxi's arrival ratings. Every rider has their own clock, and its
// colour on arrival sets the bonus: green is Speedy, yellow Normal, red Slow.
// A rider who steps out before the end of a group's route adds only
// `riderSeconds`: the group's travel time is paid at the last stop.
export const RATINGS = [
  { id: 'speedy', label: 'Speedy', remaining: .5, seconds: 5, riderSeconds: 2 },
  { id: 'normal', label: 'Normal', remaining: .25, seconds: 2, riderSeconds: 1 },
  { id: 'slow', label: 'Slow', remaining: 0, seconds: 0, riderSeconds: 0 },
];
export const arrivalRating = remaining => RATINGS.find(rating => remaining >= rating.remaining);
export const legLimit = length => Math.ceil(18 + length / 14);
// As in Crazy Taxi 2, boarding adds time: a flat amount per party, and a
// little more for each extra rider.
export const PICKUP_SECONDS = 6;
export const PICKUP_EXTRA_SECONDS = 2;
export const pickupSeconds = passengers => PICKUP_SECONDS + PICKUP_EXTRA_SECONDS * (passengers - 1);
// A fare pays back its distance at a Speedy pace: about 20 m/s along the
// route, counting the stop at each end and the drive to the next ring, holds
// the shift clock steady once a streak is going. Normal arrivals drain it
// slowly, Slow ones quickly, whether the cab carries one rider or four.
export const METERS_PER_SECOND_EARNED = 24;
export const deliverySeconds = (length, rating = RATINGS.at(-1)) =>
  Math.round(length / METERS_PER_SECOND_EARNED) + rating.seconds;
// Speedy arrivals in a row add a second each to a fare's time bonus, so a
// clean run of fares is worth protecting.
export const STREAK_MAX_SECONDS = 5;
export const streakSeconds = streak => Math.min(STREAK_MAX_SECONDS, Math.max(0, streak - 1));
// Stunts tip only on the way: a rider pays to get somewhere, so circling a
// block to drift for tips earns nothing once the cab stops closing in.
export const TIP_PROGRESS = 6;
// A stunt chain keeps climbing while the tricks keep coming, and each trick
// tips its base times the chain, times the riders aboard.
export const COMBO_MAX = 10;
export const COMBO_SECONDS = 4;
export const TIPS = { drift: 2, nearMiss: 5, crazyStop: 5 };
const STUNT_STATS = { Drift: 'drifts', 'Near miss': 'nearMisses', 'Crazy stop': 'crazyStops' };
// Every tip also tops up the boost, so stunts feed speed.
export const STUNT_BOOST = .08;
// A handbrake stop from this speed or more, inside the ring, is a Crazy stop.
export const CRAZY_STOP_SPEED = 12;
// The steady pace fare clocks are set for. The pickup preview warns when the
// shift clock would run dry before a fare ends at this pace, since a group
// pays nothing if the shift ends with riders still aboard.
export const EASY_PACE = 14;
const distance = (a, b) => Math.hypot(a.s - b.s, a.u - b.u);
export const turnCosine = (from, via, to) => {
  const ax = via.s - from.s, ay = via.u - from.u, bx = to.s - via.s, by = to.u - via.u;
  return (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
};
const PASSENGERS = {
  clock: 'Sightseer', market: 'Market shopper', garden: 'Garden visitor', depot: 'Tram driver', art: 'Art student',
  cinema: 'Moviegoer', hotel: 'Hotel guest', museum: 'Museum visitor', station: 'Rail commuter', library: 'Reader',
  hospital: 'Hospital visitor', observatory: 'Stargazer', music: 'Jazz fan', sports: 'Club member', firehouse: 'Firefighter',
  park: 'Park visitor', plaza: 'Cafe regular',
  postoffice: 'Postal worker', bathhouse: 'Morning swimmer', farmersmarket: 'Market gardener',
  donut: 'Coffee regular',
  cityhall: 'City clerk',
};
const PASSENGER_TYPES = Object.keys(PASSENGERS);

// Parties board in one beat and every rider keeps their own destination: a
// four-seat party is four real drop-offs. The chain is grown one hop at a
// time, always nearby and never doubling back, so a full cab reads as one
// route rather than four errands. A rider whose stop will not fit never
// boards, which keeps the count on the ring equal to the stops ahead.
export function partySize(seed) {
  const roll = randomAt(seed, 20010);
  return roll < .5 ? 1 : roll < .73 ? 2 : roll < .91 ? 3 : 4;
}
// Bigger parties start with a shorter first ride, leaving room in the route
// for everyone else's stop.
const FIRST_LEG_MAX = [0, 1100, 800, 650, 500];
// Each extra rider adds a fifth to the distance fare. Groups still pay best,
// with the $25 bonus per extra rider and tips multiplied by everyone aboard,
// without making a single rider not worth stopping for.
export const GROUP_FARE_SHARE = .2;
// A party's stops should read as a route through the city, not a line down
// one street. Each hop ranks the nearby places by distance plus these
// penalties, in metres: a stop around a corner beats one straight ahead on
// the street the cab is already on, and a new kind of place beats a second
// museum or a second market. Nearest-first chose the straight run about one
// group in five.
export const SAME_STREET_PENALTY = 320;
export const STRAIGHT_PENALTY = 140;
export const SAME_TYPE_PENALTY = 200;
export const STRAIGHT_COSINE = .85;
export function hopPenalty(previous, from, next, types) {
  return (next.index === from.index ? SAME_STREET_PENALTY : 0)
    + (turnCosine(previous, from, next) > STRAIGHT_COSINE ? STRAIGHT_PENALTY : 0)
    + (types.has(next.type) ? SAME_TYPE_PENALTY : 0);
}

function partyOffer(stop, destination, length, wanted) {
  const stops = [{ destination, passengers: 1, length }];
  let previous = stop, from = destination, totalLength = length;
  while (stops.length < wanted) {
    const taken = new Set(stops.map(leg => leg.destination.id)), types = new Set(stops.map(leg => leg.destination.type));
    // Look around the rider who just got out, not around the pickup: a long
    // chain would otherwise run off the edge of the pickup's own window.
    const candidates = nearbyPlaces(from.s, from.u, 6).map(place => ({ ...placeStop(place), id: place.id }))
      .filter(next => !taken.has(next.id)
      && distance(from, next) >= 45 && distance(from, next) <= GROUP_MAX_LEG
      // Keep roughly heading the way the cab is already pointed.
      && turnCosine(previous, from, next) >= GROUP_MIN_TURN)
      .map(next => ({ next, score: distance(from, next) + hopPenalty(previous, from, next, types) }))
      .sort((a, b) => a.score - b.score || a.next.id.localeCompare(b.next.id))
      .slice(0, GROUP_CANDIDATES).map(({ next }) => next);
    let chosen = null;
    for (const next of candidates) {
      const leg = routeDistance(taxiRoute(from, next));
      if (leg > GROUP_MAX_LEG || leg > distance(from, next) * GROUP_MAX_DETOUR) continue;
      if (totalLength + leg > GROUP_MAX_ROUTE) continue;
      chosen = { destination: next, passengers: 1, length: leg };
      break;
    }
    if (!chosen) break;
    stops.push(chosen); previous = from; from = chosen.destination; totalLength += chosen.length;
  }
  const passengers = stops.length;
  const fare = Math.round((40 + totalLength * .28) * (1 + (passengers - 1) * GROUP_FARE_SHARE));
  // Allocate integer dollars once, so the riders split the fare exactly. Each
  // drop-off banks its own share immediately if the party later runs out.
  let allocated = 0;
  for (const [index, leg] of stops.entries()) {
    leg.fare = index === stops.length - 1 ? fare - allocated : Math.round(fare / passengers);
    allocated += leg.fare;
    leg.limit = legLimit(leg.length);
  }
  const band = fareBand(totalLength);
  return { passengers, stops, destination: stops[0].destination, length: totalLength, fare,
    band: band.id, color: band.color, groupBonus: (passengers - 1) * 25 };
}

export function taxiRoute(player, target) {
  if (!target) return [];
  return navGraph().route({ s: player.s, u: player.u }, { s: target.s, u: target.u });
}

// A stop ahead of the car in its own lane, for tools and tests.
export function leadStop(player) {
  const nav = navGraph(), hit = nav.nearest(player.s, player.u, 60);
  if (!hit) return { s: player.s, u: player.u, heading: player.heading, side: 1 };
  const forward = nav.pose(hit.edge, hit.along, 1);
  const direction = Math.cos(player.heading - forward.heading) >= 0 ? 1 : -1;
  const along = direction > 0 ? hit.along : hit.edge.length - hit.along;
  const pose = nav.pose(hit.edge, Math.min(hit.edge.length - 4, along + 40), direction, hit.edge.profile.lane);
  return { ...pose, index: hit.edge.id, side: 1, profile: hit.edge.profile };
}
// Where a place's passengers get out: in the lane beside its entrance.
const placeStop = place => {
  const entrance = place.entrance ?? nearestLanePose(place.s, place.u, 0, 200);
  const hit = navGraph().nearest(entrance.s, entrance.u, 60);
  return { s: entrance.s, u: entrance.u, heading: entrance.heading, index: hit?.edge.id ?? -1, side: 1, profile: hit?.edge.profile,
    name: place.name, type: place.type, district: place.district };
};

// Pickup sites are seeded along every street, one every hundred metres or
// so, so overlapping neighbourhoods agree on where passengers wait.
function nearbyCustomerStops(player) {
  const nav = navGraph(), stops = [];
  for (const edge of nav.edges) {
    if (edge.kind === 'path' || edge.length < 50) continue;
    const middle = edge.points[Math.floor(edge.points.length / 2)];
    if (Math.hypot(middle.y - player.s, middle.x - player.u) > CUSTOMER_RANGE + edge.length / 2) continue;
    const count = Math.max(1, Math.floor(edge.length / 110));
    for (let i = 0; i < count; i++) {
      const direction = randomAt(edge.id, i * 3 + 19110, CITY.seed) < .5 ? 1 : -1;
      // Spread along the street from one end, whichever way each rider is going
      const along = edge.length * (i + .25 + randomAt(edge.id, i * 3 + 19410, CITY.seed) * .5) / count;
      const pose = nav.pose(edge, direction > 0 ? along : edge.length - along, direction, edge.profile.lane);
      const stop = { ...pose, index: edge.id, side: 1, profile: edge.profile, id: `edge:${edge.id}:${i}`,
        fareSeed: Math.floor(randomAt(edge.id, i * 3 + 19610, CITY.seed) * 0xffffffff) };
      if (distance(stop, player) > CUSTOMER_RANGE) continue;
      // Not on a bridge: the ring needs a kerb for the riders to wait on
      if (waterAt(stop.s + Math.cos(stop.heading + Math.PI / 2) * 12, stop.u + Math.sin(stop.heading + Math.PI / 2) * 12)) continue;
      stops.push(stop);
    }
  }
  return stops.sort((a, b) => distance(a, player) - distance(b, player) || a.id.localeCompare(b.id));
}

export class TaxiRun {
  constructor(storage = null) {
    this.fleet = new TaxiFleet(storage); this.career = new TaxiCareer(storage); this.goals = []; this.summary = null;
    this.storage = storage; this.best = 0; this.status = 'idle'; this.events = []; this.revision = 0;
    try { const best = Number(storage?.getItem('citydriver-taxi-best')); if (Number.isFinite(best) && best > 0) this.best = Math.floor(best); } catch { /* Optional storage. */ }
  }
  get running() { return this.status === 'pickup' || this.status === 'driving'; }
  get currentStop() { return this.status === 'driving' ? this.fare.stops[this.stopIndex] : null; }
  get target() { return this.currentStop?.destination ?? null; }
  // What the cab collects if everyone aboard arrives: a group's fare is held
  // until the last rider is out, as in Crazy Taxi 2.
  // How much of the current rider's own window is left. Ratings and the time
  // bonus fare judge each leg on its own, so time carried over from a fast
  // earlier stop protects the group without inflating later ratings.
  get legRemaining() { return this.status === 'driving' ? Math.max(0, 1 - this.legElapsed / this.currentStop.limit) : 0; }
  get remainingFare() { return this.status === 'driving' ? this.held + this.fare.stops.slice(this.stopIndex).reduce((sum, stop) => sum + stop.fare, 0) + this.fare.groupBonus : 0; }
  start(player) {
    this.status = 'pickup'; this.timeLeft = SHIFT_SECONDS; this.cash = 0; this.delivered = 0; this.failed = 0;
    this.boost = 1; this.boostActive = false; this.elapsed = 0; this.combo = 1; this.comboTime = 0;
    this.tips = 0; this.hold = 0; this.fare = null; this.events = []; this.driftTime = 0; this.crashCooldown = 0;
    this.recentDestinations = []; this.customers = []; this.boarding = null; this.blockedPickup = null;
    this.servedCustomers = new Map();
    this.stopIndex = 0; this.onboard = 0; this.deliveredPassengers = 0; this.held = 0; this.lastDropOff = null;
    this.streak = 0; this.ring = null;
    this.ratings = Object.fromEntries(RATINGS.map(rating => [rating.id, 0])); this.previousBest = this.best;
    // What this shift can be measured by: the goals watch these, and the
    // career keeps the best of them.
    this.bestStreak = 0; this.bestCombo = 1; this.tipsBanked = 0; this.nearMisses = 0; this.crazyStops = 0; this.drifts = 0;
    this.groups = 0; this.fullCabs = 0; this.longRides = 0; this.goalCash = 0; this.summary = null;
    this.goals = shiftGoals(this.career.shifts, this.career.rank.index);
    this.lastImpact = player.audioTelemetry?.impactSerial ?? 0; this.makeCustomers(player);
    // Starting inside a ring must not choose the first fare for the driver.
    this.blockedPickup = this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null;
  }
  stop() { this.status = 'idle'; this.customers = []; this.servedCustomers?.clear(); this.fare = null; this.boarding = null; this.hold = 0; this.onboard = 0; this.stopIndex = 0; this.boostActive = false; this.revision++; }
  makeCustomers(player) {
    const previous = this.customers;
    for (const [id, until] of this.servedCustomers) if (until <= this.elapsed) this.servedCustomers.delete(id);
    const waiting = new Map(previous.map(customer => [customer.id, customer]));
    const stops = nearbyCustomerStops(player).filter(stop => !this.servedCustomers.has(stop.id)
      && !(this.lastDropOff && distance(stop, this.lastDropOff) < DROP_OFF_CLEARANCE))
      .map(stop => waiting.get(stop.id) ?? stop);
    this.customers = stops.map(stop => {
      if (stop.destination) return stop;
      // Derive the entire offer from this pickup, not the driver's approach
      // or trip history, so unloading and revisiting recreates the same fare.
      const wanted = partySize(stop.fareSeed), maxLength = FIRST_LEG_MAX[wanted];
      const destinations = nearbyPlaces(stop.s, stop.u, 6).map(place => ({ ...placeStop(place), id: place.id }));
      // Rank cheaply before tracing any streets. Usually only one or two
      // routes need sampling, even when many new blocks enter the window.
      const choices = destinations.filter(destination => distance(stop, destination) <= 1100)
        .map((destination, j) => ({ destination, variety: randomAt(stop.fareSeed, j + 19710),
          rank: randomAt(stop.fareSeed, PASSENGER_TYPES.indexOf(destination.type) + 19810) }))
        .sort((a, b) => a.rank - b.rank || a.variety - b.variety);
      // A party prefers a shorter first ride but settles for any ordinary fare.
      let route, fallback;
      for (const { destination } of choices) {
        const length = routeDistance(taxiRoute(stop, destination));
        if (length < 280 || length > 1100) continue;
        fallback ??= { destination, length };
        if (length <= maxLength) { route = { destination, length }; break; }
      }
      route ??= fallback;
      const destination = route?.destination ?? placeStop(cityPlaces()[0] ?? { s: CITY.downtown.s, u: CITY.downtown.u, name: 'Downtown', type: 'plaza', district: 'Downtown' });
      const length = route?.length ?? routeDistance(taxiRoute(stop, destination));
      const party = partyOffer(stop, destination, length, wanted);
      return { ...stop, name: PASSENGERS[party.destination.type] ?? 'Passenger', ...party };
    });
    this.customerCenter = { s: player.s, u: player.u };
    this.nextCustomerRefresh = this.elapsed + 1;
    if (previous.length !== this.customers.length || previous.some((stop, i) => stop !== this.customers[i])) this.revision++;
  }
  controls(dt, input) {
    const gas = input.forward > 0 || input.touchDrive?.amount > .1;
    this.boostActive = this.running && Boolean(input.boost) && gas && !input.brake && !input.handbrake && this.boost > .01;
    if (this.running) this.boost = Math.max(0, Math.min(1, this.boost + dt * (this.boostActive ? -.44 : input.boost ? 0 : .16)));
    return { ...input, boost: this.boostActive };
  }
  // Crazy Taxi 2 multiplies every stunt tip by the riders aboard, so a full
  // cab is the moment to drive wild.
  get tipMultiplier() { return this.combo * Math.max(1, this.onboard); }
  // The lowest the shift clock would fall while carrying this fare at an easy
  // pace, counting the time boarding and each Normal drop-off add back.
  shiftAfter(offer) {
    let clock = this.timeLeft + pickupSeconds(offer.passengers), lowest = clock;
    for (const [index, leg] of offer.stops.entries()) {
      clock -= leg.length / EASY_PACE + 3; lowest = Math.min(lowest, clock);
      clock += index === offer.stops.length - 1 ? deliverySeconds(offer.length, RATINGS[1]) : RATINGS[1].riderSeconds;
    }
    return lowest;
  }
  // Remembers how the cab came into the ring it is stopping in, so a sliding
  // handbrake stop can be told from a gentle one.
  trackRing(stop, player) {
    if (stop !== this.ring?.stop) this.ring = stop ? { stop, speed: Math.abs(player.speed), slid: false } : null;
    if (this.ring && (player.drifting || player.audioTelemetry?.handbrake > 0)) this.ring.slid = true;
  }
  get crazyStop() { return Boolean(this.ring?.slid && this.ring.speed >= CRAZY_STOP_SPEED); }
  onTheWay(player) {
    const left = routeDistance(taxiRoute(player, this.target));
    if (left > this.tipMark - TIP_PROGRESS) return false;
    this.tipMark = left; return true;
  }
  reward(kind, amount, announce = true) {
    const tip = amount * this.tipMultiplier; this.tips += tip;
    this.boost = Math.min(1, this.boost + STUNT_BOOST);
    if (announce) this.events.push({ kind: 'tip', text: `${kind} +$${tip}`, combo: this.combo, riders: this.onboard });
    this.combo = Math.min(COMBO_MAX, this.combo + 1); this.comboTime = COMBO_SECONDS;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const stat = STUNT_STATS[kind]; if (stat) this[stat]++;
    this.checkGoals();
    return tip;
  }
  // The shift so far, in the terms the goals and career records use.
  get stats() {
    return { delivered: this.delivered, riders: this.deliveredPassengers, groups: this.groups, speedy: this.ratings?.speedy ?? 0,
      streak: this.bestStreak, combo: this.bestCombo, tips: this.tipsBanked, nearMisses: this.nearMisses, crazyStops: this.crazyStops,
      longRides: this.longRides, fullCabs: this.fullCabs };
  }
  // A finished goal banks its bonus with the fleet at once, so the money is
  // kept even if the shift ends with riders still aboard.
  checkGoals() {
    if (!this.running) return;
    const stats = this.stats;
    for (const goal of this.goals) {
      if (goal.done) continue;
      goal.progress = goalProgress(goal, stats);
      if (goal.progress < goal.target) continue;
      goal.done = true; this.goalCash += goal.bonus; this.fleet.credit(goal.bonus);
      this.events.push({ kind: 'goal', text: `Goal · ${goal.text} · +$${goal.bonus}`, goal, bonus: goal.bonus });
    }
  }
  finish() {
    this.status = 'over'; this.boostActive = false; this.boarding = null; this.hold = 0; this.onboard = 0; this.revision++;
    this.previousBest = this.best; this.best = Math.max(this.best, this.cash);
    try { this.storage?.setItem('citydriver-taxi-best', String(this.best)); } catch { /* Optional storage. */ }
    this.summary = this.career.record(this);
    this.events.push({ kind: 'over' });
  }
  update(dt, player, traffic = []) {
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt; this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) { this.finish(); return; }
    this.comboTime -= dt; if (this.comboTime <= 0) this.combo = 1;
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    const impact = player.audioTelemetry?.impactSerial ?? 0;
    const collided = impact !== this.lastImpact;
    if (collided) {
      this.lastImpact = impact;
      if (this.status === 'driving' && (player.audioTelemetry?.impact ?? 0) > 3) {
        // A crash breaks the stunt chain but keeps the tips already earned, as
        // in Crazy Taxi. A wall scrape or traffic pileup can report contacts
        // every tick, so stunts stay suspended until the cab is clear.
        if (this.crashCooldown === 0 && this.combo > 1) this.events.push({ kind: 'crash', text: `Crash · ×${this.combo} combo lost` });
        this.combo = 1; this.comboTime = 0; this.driftTime = 0; this.crashCooldown = .8;
      }
    }
    if (this.status === 'pickup') {
      if (this.elapsed >= this.nextCustomerRefresh) {
        this.nextCustomerRefresh = this.elapsed + 1;
        if (distance(player, this.customerCenter) > B / 2) this.makeCustomers(player);
      }
      // The driver chooses a fare by stopping in its ring. Boarding is never
      // a navigation target and cannot carry progress between passengers.
      if (this.blockedPickup && distance(this.blockedPickup, player) >= STOP_RADIUS) this.blockedPickup = null;
      const inside = this.customers.find(p => p.id !== this.blockedPickup?.id && distance(p, player) < STOP_RADIUS) ?? null;
      this.trackRing(inside, player);
      const passenger = Math.abs(player.speed) < 2.5 ? inside : null;
      if (passenger?.id !== this.boarding?.id) this.hold = 0;
      this.boarding = passenger;
      this.hold = passenger ? this.hold + dt : 0;
      if (this.hold >= STOP_SECONDS) {
        this.fare = passenger; this.fareLeft = passenger.stops[0].limit; this.legElapsed = 0; this.tipMark = Infinity; this.held = 0; this.status = 'driving'; this.boarding = null;
        const seconds = pickupSeconds(passenger.passengers);
        this.timeLeft = Math.min(MAX_SHIFT_SECONDS, this.timeLeft + seconds);
        this.stopIndex = 0; this.onboard = passenger.passengers;
        this.customers = this.customers.filter(customer => customer !== passenger);
        this.servedCustomers.set(passenger.id, this.elapsed + 60);
        this.hold = 0; this.tips = 0; this.combo = 1; this.driftTime = 0; this.passed = new WeakSet(); this.revision++;
        // A Crazy stop is the fare's first trick and starts its chain.
        const stunt = this.crazyStop ? this.reward('Crazy stop', TIPS.crazyStop, false) : 0; this.ring = null;
        this.events.push({ kind: 'pickup', seconds, stunt, text: `${stunt ? `Crazy stop +$${stunt} · ` : ''}${passenger.passengers > 1 ? `${passenger.passengers} riders aboard` : 'Rider aboard'} · +${seconds}s` });
      }
      return;
    }
    this.fareLeft = Math.max(0, this.fareLeft - dt); this.legElapsed += dt;
    if (this.fareLeft <= 0) {
      // All or nothing: riders already dropped off paid into the group fare,
      // and it leaves with whoever is still aboard.
      const riders = this.onboard, lost = this.remainingFare + this.tips;
      this.failed++; this.status = 'pickup'; this.fare = null; this.hold = 0; this.onboard = 0; this.stopIndex = 0; this.tips = 0; this.held = 0; this.combo = 1;
      this.streak = 0; this.ring = null; this.revision++; this.makeCustomers(player);
      this.blockedPickup = this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null;
      const who = riders === 1 ? 'Rider' : `${riders} riders`;
      this.events.push({ kind: 'missed', text: `Too slow · ${who} jumped out · $${lost} lost`, lost }); return;
    }
    if (player.drifting && Math.abs(player.speed) > 10 && this.crashCooldown === 0) {
      this.driftTime += dt;
      if (this.driftTime >= .65) { this.driftTime -= .65; if (this.onTheWay(player)) this.reward('Drift', TIPS.drift); }
    } else this.driftTime = 0;
    if (Math.abs(player.speed) > 14 && !collided && this.crashCooldown === 0) {
      for (const car of traffic) {
        const carHeading = car.heading ?? (car.axis === 'east' ? car.direction * Math.PI / 2 : car.direction < 0 ? Math.PI : 0);
        if (this.passed.has(car) || Math.abs(player.speed - car.speed * Math.cos(carHeading - player.heading)) < 7) continue;
        const ds = car.s - player.s, du = car.u - player.u;
        const along = ds * Math.cos(player.heading) + du * Math.sin(player.heading);
        const across = Math.abs(du * Math.cos(player.heading) - ds * Math.sin(player.heading));
        const clearance = (player.spec?.width ?? 2) / 2 + (car.spec?.width ?? 2) / 2 + .4;
        if (Math.abs(along) < 2.5 && across > clearance && across < clearance + 2.5) {
          this.passed.add(car); if (this.onTheWay(player)) this.reward('Near miss', TIPS.nearMiss);
        }
      }
    }
    const atStop = distance(this.target, player) < STOP_RADIUS;
    this.trackRing(atStop ? this.currentStop : null, player);
    this.hold = atStop && Math.abs(player.speed) < 2.5 ? this.hold + dt : 0;
    if (this.hold >= STOP_SECONDS) {
      const stop = this.currentStop, last = this.stopIndex === this.fare.stops.length - 1;
      const remaining = this.legRemaining, rating = arrivalRating(remaining);
      // Tipped while this rider is still aboard, so it counts every rider.
      const stunt = this.crazyStop ? this.reward('Crazy stop', TIPS.crazyStop, false) : 0; this.ring = null;
      this.streak = rating.id === 'speedy' ? this.streak + 1 : 0; this.bestStreak = Math.max(this.bestStreak, this.streak);
      // Crazy Taxi's three kinds of money: the base fare for the distance, a
      // time bonus fare for the clock left, and tips. A group's fare is held
      // until the last rider is out, then paid in full, as in Crazy Taxi 2.
      this.held += stop.fare + Math.round(stop.fare * .5 * remaining);
      const bonus = last ? this.fare.groupBonus : 0, paid = last ? this.held + this.tips + bonus : 0;
      // The whole route's time is paid when the fare ends, with the Speedy
      // streak on top; riders stepping out earlier add a small rating bonus.
      const streak = last ? streakSeconds(this.streak) : 0;
      const seconds = last ? deliverySeconds(this.fare.length, rating) + streak : rating.riderSeconds;
      this.ratings[rating.id]++;
      this.deliveredPassengers += stop.passengers; this.onboard -= stop.passengers;
      this.timeLeft = Math.min(MAX_SHIFT_SECONDS, this.timeLeft + seconds);
      if (paid) { this.cash += paid; this.fleet.credit(paid); }
      this.recentDestinations = [...this.recentDestinations, stop.destination.type].slice(-3);
      const group = this.fare.passengers > 1;
      if (last) {
        this.delivered++; this.tipsBanked += this.tips;
        if (group) this.groups++;
        if (this.fare.passengers === 4) this.fullCabs++;
        if (this.fare.band === 'long') this.longRides++;
      }
      const lead = !group ? '' : last ? 'Group complete · ' : `Rider ${this.stopIndex + 1} of ${this.fare.passengers} · `;
      const verdict = rating.id === 'speedy' ? `${rating.label}!` : rating.label;
      const text = [`${lead}${verdict}`, streak && `Streak ×${this.streak}`, stunt && `Crazy stop +$${stunt}`, paid && `+$${paid}`, `+${seconds}s`];
      this.events.push({ kind: last ? 'paid' : 'dropoff', text: text.filter(Boolean).join(' · '), paid, bonus, seconds, streak, stunt,
        rating: rating.id, passengers: stop.passengers, destination: stop.destination, groupComplete: last && group });
      if (group) this.boost = Math.min(1, this.boost + .25);
      if (!last) {
        // The group shares one clock, as in Crazy Taxi 2. Each rider adds
        // their own allowance as the one before steps out, so time saved on an
        // early stop carries forward.
        this.stopIndex++; this.fareLeft += this.currentStop.limit; this.legElapsed = 0; this.tipMark = Infinity;
        this.hold = 0; this.driftTime = 0; this.revision++;
        // Preserve the stunt combo, with enough grace to pull away.
        this.comboTime = Math.max(this.comboTime, COMBO_SECONDS);
        return;
      }
      this.stopIndex = 0; this.held = 0; this.lastDropOff = { s: stop.destination.s, u: stop.destination.u };
      this.status = 'pickup'; this.fare = null; this.tips = 0; this.combo = 1; this.hold = 0;
      this.revision++; this.makeCustomers(player); this.checkGoals();
      // Overlapping pickups wait until the driver leaves the ring.
      this.blockedPickup = this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null;
    }
  }
  drainEvents() { return this.events.splice(0); }
}
