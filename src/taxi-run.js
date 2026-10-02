import { CITY } from './world/city.js';
import { nearestLanePose, waterAt } from './world/city-route.js';
import { navGraph, routeDistance } from './world/nav-graph.js';
import { nearbyPlaces, cityPlaces, dropOffStretch } from './city-exploration.js';
import { randomAt } from './world/route.js';
import { TaxiFleet } from './taxi-fleet.js';
import { TaxiCareer } from './taxi-career.js';
import { shiftGoals, goalProgress } from './taxi-goals.js';
import { nearMiss } from './stunt-chain.js';
const B = 112;

export const SHIFT_SECONDS = 100;
export const STOP_RADIUS = 8;
export const STOP_SECONDS = .45;
export const GROUP_MAX_LEG = 650;
// A group's next stop is at least this far from the last stop's stretch, so
// one stop never lets two riders out.
export const GROUP_MIN_HOP = 45;
// How far a hop between drop-offs may wander from the straight line. A grid
// costs about √2 on a diagonal, so anything beyond this is a river, a dead end
// or a hop that doubles back through the block it started on.
export const GROUP_MAX_DETOUR = 1.45;
export const GROUP_MAX_ROUTE = 2200;
export const MAX_SHIFT_SECONDS = 180;
// Cosine of the sharpest turn a party route may take between two drop-offs,
// about 105°. Street routes zigzag, so demanding a strictly forward hop leaves
// most full cabs with nowhere legal to go.
export const GROUP_MIN_TURN = -.25;
// Each hop samples a handful of the closest unused places; the chain is built
// for every waiting ring, so the route tracing has to stay cheap.
const GROUP_CANDIDATES = 6;
const CUSTOMER_RANGE = B * 3;
// A new pickup never waits where the last rider got out. Pickup sites and
// destinations are laid out independently, so without this about one drop-off
// in four would end beside, or inside, a fresh ring.
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
  { id: 'speedy', label: 'Speedy', remaining: .5, seconds: 10, riderSeconds: 2 },
  { id: 'normal', label: 'Normal', remaining: .25, seconds: 6, riderSeconds: 1 },
  { id: 'slow', label: 'Slow', remaining: 0, seconds: 1, riderSeconds: 0 },
];
export const arrivalRating = remaining => RATINGS.find(rating => remaining >= rating.remaining);
export const legLimit = length => Math.ceil(18 + length / 14);
// As in Crazy Taxi 2, boarding adds time: a flat amount per party, and a
// little more for each extra rider.
export const PICKUP_SECONDS = 8;
export const PICKUP_EXTRA_SECONDS = 2;
export const pickupSeconds = passengers => PICKUP_SECONDS + PICKUP_EXTRA_SECONDS * (passengers - 1);
// Most of a fare's time is a flat amount for boarding and the rating, as in
// Crazy Taxi. The route adds a second per 30 m, less than the cab covers, so
// short fares keep the clock going and long fares pay more money.
export const METERS_PER_SECOND_EARNED = 30;
export const deliverySeconds = (length, rating = RATINGS.at(-1)) =>
  Math.round(length / METERS_PER_SECOND_EARNED) + rating.seconds;
// Speedy arrivals in a row add a second each to a fare's time bonus, so a
// clean run of fares is worth protecting.
export const STREAK_MAX_SECONDS = 5;
export const streakSeconds = streak => Math.min(STREAK_MAX_SECONDS, Math.max(0, streak - 1));
// Time rewards shrink by TIME_FADE a minute, down to TIME_FLOOR, so every
// shift ends. It goes by time, not fares delivered, so short fares are not
// penalised.
export const TIME_FADE = .045;
export const TIME_FLOOR = .4;
export const timeScale = elapsed => Math.max(TIME_FLOOR, 1 - elapsed / 60 * TIME_FADE);
// Stunts tip only on the way: a rider pays to get somewhere, so circling a
// block to drift for tips earns nothing once the cab stops closing in.
export const TIP_PROGRESS = 6;
// A stunt chain keeps climbing while the tricks keep coming, and each trick
// tips its base times the chain, times the riders aboard.
export const COMBO_MAX = 10;
export const COMBO_SECONDS = 4;
export const TIPS = { drift: 2, superDrift: 4, ultraDrift: 7, nearMiss: 5, crazyStop: 5, jump: 3, spin: 6 };
// (a drift tips as its sparks change: blue, orange, pink, see Drift)
const DRIFT_TIPS = [['Drift', TIPS.drift], ['Super drift', TIPS.superDrift], ['Ultra drift', TIPS.ultraDrift]];
const STUNT_STATS = { Drift: 'drifts', 'Super drift': 'drifts', 'Ultra drift': 'drifts', 'Near miss': 'nearMisses', 'Crazy stop': 'crazyStops' };
// Every tip also tops up the boost, so stunts feed speed.
export const STUNT_BOOST = .08;
// Coming into the ring this fast or more and drifting or handbraking to a
// stop in it is a Crazy stop.
export const CRAZY_STOP_SPEED = 12;
const distance = (a, b) => Math.hypot(a.s - b.s, a.u - b.u);
// The point of a stop's stretch nearest `p`, and its distance. A stop with no
// stretch is its one point.
export function nearestOnStop(stop, p) {
  const line = stop.stretch;
  if (!(line?.length > 1)) return { s: stop.s, u: stop.u, distance: distance(stop, p) };
  let best = null;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], ds = b.s - a.s, du = b.u - a.u;
    const t = Math.max(0, Math.min(1, ((p.s - a.s) * ds + (p.u - a.u) * du) / (ds * ds + du * du || 1)));
    const s = a.s + ds * t, u = a.u + du * t, d = Math.hypot(p.s - s, p.u - u);
    if (!best || d < best.distance) best = { s, u, distance: d };
  }
  return best;
}
// Whether the cab is in a stop: within STOP_RADIUS of its stretch
export const insideStop = (stop, p) => nearestOnStop(stop, p).distance < STOP_RADIUS;
// The closest distance between two stops' stretches
const stretchOf = stop => stop.stretch?.length ? stop.stretch : [stop];
export const stopGap = (a, b) => Math.min(...stretchOf(a).map(p => nearestOnStop(b, p).distance), ...stretchOf(b).map(p => nearestOnStop(a, p).distance));
// Whether a stop is GROUP_MIN_HOP from the last. A stretch point is never
// further from its entrance than the stretch's length, so only close stops
// need the full check.
const stretchLength = stop => stretchOf(stop).reduce((sum, p, i, line) => i ? sum + distance(p, line[i - 1]) : 0, 0);
const hopClear = (from, next) => distance(from, next) >= GROUP_MIN_HOP + stretchLength(from) + stretchLength(next) || stopGap(from, next) >= GROUP_MIN_HOP;
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
// Special riders. Some single riders are in a hurry (shorter clock, double
// pay for arriving early), thrill seekers (double stunt tips) or nervous
// (half the fare again for no crashes).
export const MOODS = {
  hurry: { label: 'In a hurry', rule: 'Double pay for arriving early', clock: .7, early: 1 },
  thrill: { label: 'Thrill seeker', rule: 'Stunt tips count double', tips: 2 },
  nervous: { label: 'Nervous', rule: 'Pays half again for no crashes', smooth: .5 },
};
// Whether a special rider was satisfied: Speedy, a stunt tip, or no crash
export const pleased = (mood, { rating, tips, shaken }) => mood === 'hurry' ? rating === 'speedy' : mood === 'thrill' ? tips > 0 : mood === 'nervous' ? !shaken : false;
export function riderMood(seed, passengers) {
  if (passengers !== 1) return null;
  const roll = randomAt(seed, 20210);
  return roll < .16 ? 'hurry' : roll < .3 ? 'thrill' : roll < .42 ? 'nervous' : null;
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
// museum or a second market. Nearest-first would choose the straight run
// about one group in five.
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
      .filter(next => !taken.has(next.id) && distance(from, next) <= GROUP_MAX_LEG
      // Keep roughly heading the way the cab is already pointed.
      && turnCosine(previous, from, next) >= GROUP_MIN_TURN && hopClear(from, next))
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
  // Allocate integer dollars once, so the riders split the fare exactly.
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

// The last few routes, by the exact points asked about. The task card and the
// street map ask for the same one in each refresh, and a group's next leg
// stays the same until the rider before is out. Callers only read the points.
const recentRoutes = [];
export function taxiRoute(player, target) {
  if (!target) return [];
  const fromS = player.s, fromU = player.u, toS = target.s, toU = target.u;
  const index = recentRoutes.findIndex(r => r.fromS === fromS && r.fromU === fromU && r.toS === toS && r.toU === toU);
  const found = index >= 0 ? recentRoutes.splice(index, 1)[0]
    : { fromS, fromU, toS, toU, points: navGraph().route({ s: fromS, u: fromU }, { s: toS, u: toU }) };
  recentRoutes.unshift(found); recentRoutes.length = Math.min(recentRoutes.length, 6);
  return found.points;
}

// Where a place's passengers get out: anywhere along its stretch (see
// dropOffStretch). Fares and the marker's arrow use the entrance. Worked out
// once a place, and each caller gets a fresh copy.
const placeStops = new WeakMap();
const placeStop = place => {
  let stop = placeStops.get(place);
  if (!stop) {
    const entrance = place.entrance ?? nearestLanePose(place.s, place.u, 0, 200);
    const hit = navGraph().nearest(entrance.s, entrance.u, 60);
    stop = { s: entrance.s, u: entrance.u, heading: entrance.heading, index: hit?.edge.id ?? -1, side: 1, profile: hit?.edge.profile,
      name: place.name, type: place.type, district: place.district, stretch: place.entrance ? dropOffStretch(place) : [{ s: entrance.s, u: entrance.u }] };
    placeStops.set(place, stop);
  }
  return { ...stop };
};

// Pickup sites are seeded along every street, one every hundred metres or
// so, so overlapping neighbourhoods agree on where passengers wait. A
// street's sites are worked out the first time it comes in range.
const streetStops = new WeakMap();
function stopsAlong(nav, edge) {
  let stops = streetStops.get(edge);
  if (stops) return stops;
  stops = [];
  const count = Math.max(1, Math.floor(edge.length / 110));
  for (let i = 0; i < count; i++) {
    const direction = randomAt(edge.id, i * 3 + 19110, CITY.seed) < .5 ? 1 : -1;
    // Spread along the street from one end, whichever way each rider is going
    const along = edge.length * (i + .25 + randomAt(edge.id, i * 3 + 19410, CITY.seed) * .5) / count;
    const pose = nav.pose(edge, direction > 0 ? along : edge.length - along, direction, edge.profile.lane);
    const stop = { ...pose, index: edge.id, side: 1, profile: edge.profile, id: `edge:${edge.id}:${i}`,
      fareSeed: Math.floor(randomAt(edge.id, i * 3 + 19610, CITY.seed) * 0xffffffff) };
    // Not on a bridge: the ring needs a kerb for the riders to wait on
    if (waterAt(stop.s + Math.cos(stop.heading + Math.PI / 2) * 12, stop.u + Math.sin(stop.heading + Math.PI / 2) * 12)) continue;
    stops.push(stop);
  }
  streetStops.set(edge, stops);
  return stops;
}
function nearbyCustomerStops(player, range = CUSTOMER_RANGE) {
  const nav = navGraph(), stops = [];
  for (const edge of nav.edges) {
    if (edge.kind === 'path' || edge.length < 50) continue;
    const middle = edge.points[Math.floor(edge.points.length / 2)];
    if (Math.hypot(middle.y - player.s, middle.x - player.u) > range + edge.length / 2) continue;
    for (const stop of stopsAlong(nav, edge)) if (!(distance(stop, player) > range)) stops.push(stop);
  }
  return stops.sort((a, b) => distance(a, player) - distance(b, player) || a.id.localeCompare(b.id));
}

// A pickup's offer depends only on where it waits and its seed (see
// makeCustomers), so each is worked out once and kept for when the cab comes
// back that way. Offers were most of a refresh's cost, with a route traced
// for every rider's stop. The last thousand are kept, and each caller gets
// its own copy of the legs.
const OFFERS_KEPT = 1024;
const offers = new Map();
function offerFor(stop) {
  const { party, mood } = partyFor(stop);
  const stops = party.stops.map(leg => ({ ...leg, destination: { ...leg.destination } }));
  return { party: { ...party, stops, destination: stops[0].destination }, mood };
}
function partyFor(stop) {
  let offer = offers.get(stop.id);
  if (offer) offers.delete(stop.id);
  else {
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
    if (!route) {
      // Nothing in range: of the few nearest places, the one whose ride comes
      // nearest the usual lengths. (It was always the city's first place, the
      // park, which from the harbour on seed 1 was 3 km and ~$950.)
      const near = cityPlaces().slice().sort((a, b) => distance(stop, a) - distance(stop, b)).slice(0, 6);
      let miss = Infinity;
      for (const place of near) {
        const destination = { ...placeStop(place), id: place.id }, length = routeDistance(taxiRoute(stop, destination));
        const off = length < 280 ? 280 - length : Math.max(0, length - 1100);
        if (off < miss) { route = { destination, length }; miss = off; }
      }
    }
    const destination = route?.destination ?? placeStop({ s: CITY.downtown.s, u: CITY.downtown.u, name: 'Downtown', type: 'plaza', district: 'Downtown' });
    const length = route?.length ?? routeDistance(taxiRoute(stop, destination));
    const party = partyOffer(stop, destination, length, wanted), mood = riderMood(stop.fareSeed, party.passengers);
    if (MOODS[mood]?.clock) party.stops[0].limit = Math.ceil(party.stops[0].limit * MOODS[mood].clock);
    offer = { party, mood };
    if (offers.size >= OFFERS_KEPT) offers.delete(offers.keys().next().value);
  }
  offers.set(stop.id, offer);
  return offer;
}
// The offers the next refresh will want are worked out while driving, one
// each LOOK_AHEAD of play: round the last stop while a fare is aboard, and a
// block beyond the pickup window while looking for one. The refresh then
// finds them ready instead of tracing up to ~130 routes in one step.
const LOOK_AHEAD = 1 / 60;

export class TaxiRun {
  constructor(storage = null) {
    this.fleet = new TaxiFleet(storage); this.career = new TaxiCareer(storage); this.goals = []; this.summary = null;
    this.storage = storage; this.best = 0; this.status = 'idle'; this.events = []; this.revision = 0;
    try { const best = Number(storage?.getItem('citydriver-taxi-best')); if (Number.isFinite(best) && best > 0) this.best = Math.floor(best); } catch { /* Optional storage. */ }
  }
  get running() { return this.status === 'pickup' || this.status === 'driving'; }
  get currentStop() { return this.status === 'driving' ? this.fare.stops[this.stopIndex] : null; }
  get target() { return this.currentStop?.destination ?? null; }
  // The nearest point of the drop-off stretch. The route, distance left and
  // tip progress use it.
  approach(player) { return this.target ? nearestOnStop(this.target, player) : null; }
  // A waiting passenger the cab has stopped over
  customerAt(player) { return this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null; }
  // How much of the current rider's own window is left. Ratings and the time
  // bonus fare judge each leg on its own, so time carried over from a fast
  // earlier stop protects the group without inflating later ratings.
  get legRemaining() { return this.status === 'driving' ? Math.max(0, 1 - this.legElapsed / this.currentStop.limit) : 0; }
  // Seconds until the arrival rating drops, or in the last rating, until the
  // riders give up
  get ratingSeconds() {
    if (this.status !== 'driving') return 0;
    const remaining = this.legRemaining, rating = arrivalRating(remaining);
    return rating.remaining > 0 ? (remaining - rating.remaining) * this.currentStop.limit : this.fareLeft;
  }
  // What the cab collects if everyone aboard arrives: a group's fare is held
  // until the last rider is out, as in Crazy Taxi 2.
  get remainingFare() { return this.status === 'driving' ? this.held + this.fare.stops.slice(this.stopIndex).reduce((sum, stop) => sum + stop.fare, 0) + this.fare.groupBonus : 0; }
  // Free drive in a cab: the fares wait round it with no clock running, and
  // stopping in a ring starts a shift with that fare aboard (see update).
  get waiting() { return this.status === 'standby'; }
  standby(player) {
    this.status = 'standby'; this.events = []; this.elapsed = 0; this.timeLeft = SHIFT_SECONDS; this.overtime = false;
    this.customers = []; this.servedCustomers = new Map(); this.boarding = null; this.hold = 0; this.fare = null;
    this.lastDropOff = null; this.ahead = null; this.nextLookAhead = 0; this.ring = null; this.boostActive = false;
    this.makeCustomers(player);
    this.blockedPickup = this.customerAt(player); this.revision++;
  }
  start(player) {
    this.begin(player); this.makeCustomers(player);
    // Starting inside a ring must not choose the first fare for the driver.
    this.blockedPickup = this.customerAt(player);
  }
  // A shift's own numbers, from nothing (keeping the fares already waiting,
  // when it begins from standby)
  begin(player, customers = []) {
    this.status = 'pickup'; this.timeLeft = SHIFT_SECONDS; this.cash = 0; this.delivered = 0; this.failed = 0;
    this.boost = 1; this.boostActive = false; this.elapsed = 0; this.combo = 1; this.comboTime = 0;
    this.tips = 0; this.hold = 0; this.fare = null; this.events = []; this.scrapedAt = -Infinity; this.crashCooldown = 0;
    this.customers = customers; this.boarding = null; this.blockedPickup = null; this.ahead = null; this.nextLookAhead = 0;
    this.servedCustomers = new Map();
    this.stopIndex = 0; this.onboard = 0; this.deliveredPassengers = 0; this.held = 0; this.lastDropOff = null;
    this.streak = 0; this.ring = null; this.overtime = false;
    this.ratings = Object.fromEntries(RATINGS.map(rating => [rating.id, 0])); this.previousBest = this.best;
    // What this shift can be measured by: the goals watch these, and the
    // career keeps the best of them.
    this.bestStreak = 0; this.bestCombo = 1; this.tipsBanked = 0; this.nearMisses = 0; this.crazyStops = 0; this.drifts = 0; this.jumps = 0;
    this.groups = 0; this.fullCabs = 0; this.longRides = 0; this.pleased = 0; this.goalCash = 0; this.summary = null;
    this.goals = shiftGoals(this.career.shifts, this.career.rank.index);
    this.lastImpact = player.audioTelemetry?.impactSerial ?? 0; this.lastCrash = player.audioTelemetry?.crashSerial ?? 0;
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
      const { party, mood } = offerFor(stop);
      return { ...stop, name: PASSENGERS[party.destination.type] ?? 'Passenger', ...party, mood };
    });
    this.customerCenter = { s: player.s, u: player.u };
    this.nextCustomerRefresh = this.elapsed + 1;
    if (previous.length !== this.customers.length || previous.some((stop, i) => stop !== this.customers[i])) this.revision++;
    // The next refresh comes B / 2 on, checked once a second
    this.lookAround(this.customerCenter, CUSTOMER_RANGE + B);
  }
  // Offers to work out ahead of need (see LOOK_AHEAD): the pickup sites
  // within `range` of `centre`, nearest first. Only the offer cache changes.
  lookAround(centre, range) { this.ahead = { centre, range, stops: null }; }
  lookAhead() {
    const ahead = this.ahead;
    // In overtime the shift ends with this ride
    if (!ahead || this.overtime || this.elapsed < this.nextLookAhead) return;
    this.nextLookAhead = this.elapsed + LOOK_AHEAD;
    // Finding the sites is a step of its own
    if (!ahead.stops) { ahead.stops = nearbyCustomerStops(ahead.centre, ahead.range); return; }
    while (ahead.stops.length) {
      const stop = ahead.stops.shift();
      if (!offers.has(stop.id)) { partyFor(stop); break; }
    }
    if (!ahead.stops.length) this.ahead = null;
  }
  controls(dt, input) {
    const gas = input.forward > 0 || input.touchDrive?.amount > .1;
    this.boostActive = this.running && Boolean(input.boost) && gas && !input.brake && !input.stop && this.boost > .01;
    if (this.running) this.boost = Math.max(0, Math.min(1, this.boost + dt * (this.boostActive ? -.44 : input.boost ? 0 : .16)));
    return { ...input, boost: this.boostActive };
  }
  // Crazy Taxi 2 multiplies every stunt tip by the riders aboard, so a full
  // cab is the moment to drive wild.
  get tipMultiplier() { return this.combo * Math.max(1, this.onboard); }
  // Remembers how the cab came into the ring it is stopping in, so a drift or
  // handbrake stop can be told from a gentle one.
  trackRing(stop, player) {
    if (stop !== this.ring?.stop) this.ring = stop ? { stop, speed: Math.abs(player.speed), slid: false } : null;
    if (this.ring && (player.drifting || player.audioTelemetry?.handbrake > 0)) this.ring.slid = true;
  }
  get crazyStop() { return Boolean(this.ring?.slid && this.ring.speed >= CRAZY_STOP_SPEED); }
  onTheWay(player) {
    const left = routeDistance(taxiRoute(player, this.approach(player)));
    if (left > this.tipMark - TIP_PROGRESS) return false;
    this.tipMark = left; return true;
  }
  reward(kind, amount, announce = true) {
    const tip = amount * this.tipMultiplier * (MOODS[this.fare?.mood]?.tips ?? 1); this.tips += tip;
    this.boost = Math.min(1, this.boost + STUNT_BOOST);
    if (announce) this.events.push({ kind: 'tip', text: `${kind} +$${tip}`, trick: kind, tip, combo: this.combo, riders: this.onboard });
    this.combo = Math.min(COMBO_MAX, this.combo + 1); this.comboTime = COMBO_SECONDS;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const stat = STUNT_STATS[kind]; if (stat) this[stat]++;
    this.checkGoals();
    return tip;
  }
  // A drift's sparks changing colour (see Drift) with a fare aboard tips,
  // more at each stage, unless the drift has touched anything since it began
  drifted(event, player) {
    if (this.status !== 'driving' || !this.fare || this.crashCooldown > 0 || this.elapsed - this.scrapedAt < event.time) return;
    const [kind, tip] = DRIFT_TIPS[event.stage - 1];
    if (this.onTheWay(player)) this.reward(kind, tip);
  }
  // A jump with a fare aboard is Crazy Taxi's Crazy Jump: a tip for the air
  // it got, more for a spin landed (see CarAir), and a spin out costs the
  // combo as a crash does. Coming down hard shakes a nervous rider.
  jumped(event, player) {
    if (this.status !== 'driving' || !this.fare) return;
    if (event.landing === 'spun' || event.landing === 'splash') {
      if (this.combo > 1) this.events.push({ kind: 'crash', text: `Spun out · ×${this.combo} combo lost` });
      this.combo = 1; this.comboTime = 0;
      return;
    }
    if (event.landing === 'hard' && this.fare.mood === 'nervous' && !this.shaken) { this.shaken = true; this.events.push({ kind: 'shaken', tone: 'slow', text: 'Hard landing · no smooth-ride bonus' }); }
    if (this.crashCooldown > 0 || !this.onTheWay(player)) return;
    const turns = Math.abs(event.turns ?? 0);
    this.jumps++;
    this.reward(turns ? `Crazy ${turns * 360}` : 'Crazy jump', Math.max(TIPS.jump, Math.round(TIPS.jump * 2 * event.air)) + turns * TIPS.spin);
  }
  // The shift so far, in the terms the goals and career records use.
  get stats() {
    return { delivered: this.delivered, riders: this.deliveredPassengers, groups: this.groups, speedy: this.ratings?.speedy ?? 0,
      streak: this.bestStreak, combo: this.bestCombo, tips: this.tipsBanked, nearMisses: this.nearMisses, crazyStops: this.crazyStops, jumps: this.jumps,
      longRides: this.longRides, fullCabs: this.fullCabs, pleased: this.pleased };
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
  // The fare in the ring the cab has stopped in climbs aboard. `first`: the
  // shift begins with it (from standby), which the event says.
  board(passenger, first = false) {
    this.fare = passenger; this.fareLeft = passenger.stops[0].limit; this.legElapsed = 0; this.tipMark = Infinity; this.held = 0; this.status = 'driving'; this.boarding = null; this.shaken = false;
    const seconds = Math.round(pickupSeconds(passenger.passengers) * timeScale(this.elapsed));
    this.timeLeft = Math.min(MAX_SHIFT_SECONDS, this.timeLeft + seconds);
    this.stopIndex = 0; this.onboard = passenger.passengers;
    this.customers = this.customers.filter(customer => customer !== passenger);
    this.servedCustomers.set(passenger.id, this.elapsed + 60);
    this.hold = 0; this.tips = 0; this.combo = 1; this.passed = new WeakSet(); this.revision++;
    // Look round the last stop. The cab can stop anywhere along its stretch.
    const last = passenger.stops.at(-1).destination, stretch = last.stretch ?? [last];
    this.lookAround({ s: last.s, u: last.u }, CUSTOMER_RANGE + STOP_RADIUS + Math.max(...stretch.map(p => distance(p, last))));
    // A Crazy stop is the fare's first trick and starts its chain.
    const stunt = this.crazyStop ? this.reward('Crazy stop', TIPS.crazyStop, false) : 0; this.ring = null;
    const who = passenger.passengers > 1 ? `${passenger.passengers} riders aboard` : `${passenger.name} aboard`;
    // (`brief` is what the labels over the cab leave unsaid: see TaxiView.pop)
    this.events.push({ kind: 'pickup', seconds, stunt, first, text: `${stunt ? `Crazy stop +$${stunt} · ` : ''}${who} · +${seconds}s`, brief: who });
  }
  // Standby's step: the pickup half of a shift with no clock. Stopping in a
  // ring begins the shift, keeping the fares that were waiting.
  wait(dt, player) {
    this.elapsed += dt;
    this.lookAhead();
    if (this.elapsed >= this.nextCustomerRefresh) {
      this.nextCustomerRefresh = this.elapsed + 1;
      if (distance(player, this.customerCenter) > B / 2) this.makeCustomers(player);
    }
    if (this.blockedPickup && distance(this.blockedPickup, player) >= STOP_RADIUS) this.blockedPickup = null;
    const inside = this.customers.find(p => p.id !== this.blockedPickup?.id && distance(p, player) < STOP_RADIUS) ?? null;
    this.trackRing(inside, player);
    const passenger = Math.abs(player.speed) < 2.5 ? inside : null;
    if (passenger?.id !== this.boarding?.id) this.hold = 0;
    this.boarding = passenger;
    this.hold = passenger ? this.hold + dt : 0;
    if (this.hold < STOP_SECONDS) return;
    const ring = this.ring;
    this.begin(player, this.customers); this.ring = ring;
    this.board(passenger, true);
  }
  update(dt, player, traffic = []) {
    if (this.status === 'standby' && Number.isFinite(dt) && dt > 0) { this.wait(dt, player); return; }
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt; this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0 && !this.overtime) {
      // With riders aboard when time runs out, the shift ends after their ride
      if (this.status !== 'driving') { this.finish(); return; }
      this.overtime = true; this.revision++;
      this.events.push({ kind: 'overtime', tone: 'slow', text: 'Time up · last ride' });
    }
    this.comboTime -= dt; if (this.comboTime <= 0) this.combo = 1;
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    const telemetry = player.audioTelemetry, impact = telemetry?.impactSerial ?? 0, crash = telemetry?.crashSerial ?? 0;
    const collided = impact !== this.lastImpact, crashed = crash !== this.lastCrash;
    this.lastImpact = impact; this.lastCrash = crash;
    // Scrapes and sideswipes aren't crashes (see CRASH in vehicle.js), but a
    // drift that touched anything tips nothing, so grinding along a wall earns nothing
    if (collided) this.scrapedAt = this.elapsed;
    if (crashed && this.status === 'driving') {
      // A crash breaks the stunt chain but keeps the tips already earned, as
      // in Crazy Taxi. A pileup can report crashes every tick, so stunts stay
      // suspended until the cab is clear.
      if (this.crashCooldown === 0 && this.combo > 1) this.events.push({ kind: 'crash', text: `Crash · ×${this.combo} combo lost` });
      if (this.fare.mood === 'nervous' && !this.shaken) { this.shaken = true; this.events.push({ kind: 'shaken', tone: 'slow', text: 'Crash · no smooth-ride bonus' }); }
      this.combo = 1; this.comboTime = 0; this.crashCooldown = .8;
    }
    this.lookAhead();
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
      if (this.hold >= STOP_SECONDS) this.board(passenger);
      return;
    }
    this.fareLeft = Math.max(0, this.fareLeft - dt); this.legElapsed += dt;
    if (this.fareLeft <= 0) {
      // All or nothing: riders already dropped off paid into the group fare,
      // and it leaves with whoever is still aboard.
      const riders = this.onboard, lost = this.remainingFare + this.tips;
      this.failed++; this.status = 'pickup'; this.fare = null; this.hold = 0; this.onboard = 0; this.stopIndex = 0; this.tips = 0; this.held = 0; this.combo = 1;
      this.streak = 0; this.ring = null; this.revision++; this.makeCustomers(player);
      this.blockedPickup = this.customerAt(player);
      const who = riders === 1 ? 'Rider' : `${riders} riders`;
      this.events.push({ kind: 'missed', tone: 'slow', text: `Too slow · ${who} jumped out · $${lost} lost`, lost });
      if (this.overtime) this.finish();
      return;
    }
    if (!collided && this.crashCooldown === 0) {
      for (const car of traffic) {
        if (this.passed.has(car) || !nearMiss(player, car)) continue;
        this.passed.add(car); if (this.onTheWay(player)) this.reward('Near miss', TIPS.nearMiss);
      }
    }
    const atStop = insideStop(this.target, player);
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
      // The time bonus fare, and a nervous rider's smooth-ride bonus
      const mood = MOODS[this.fare.mood], smooth = mood?.smooth && !this.shaken ? Math.round(stop.fare * mood.smooth) : 0;
      this.held += stop.fare + Math.round(stop.fare * (mood?.early ?? .5) * remaining) + smooth;
      const bonus = last ? this.fare.groupBonus : 0, paid = last ? this.held + this.tips + bonus : 0;
      // The whole route's time is paid when the fare ends, with the Speedy
      // streak on top; riders stepping out earlier add a small rating bonus.
      const streak = last ? streakSeconds(this.streak) : 0;
      const seconds = this.overtime ? 0 : Math.round((last ? deliverySeconds(this.fare.length, rating) + streak : rating.riderSeconds) * timeScale(this.elapsed));
      this.ratings[rating.id]++;
      this.deliveredPassengers += stop.passengers; this.onboard -= stop.passengers;
      this.timeLeft = Math.min(MAX_SHIFT_SECONDS, this.timeLeft + seconds);
      if (paid) { this.cash += paid; this.fleet.credit(paid); }
      const group = this.fare.passengers > 1;
      if (last) {
        this.delivered++; this.tipsBanked += this.tips;
        if (group) this.groups++;
        if (this.fare.passengers === 4) this.fullCabs++;
        if (this.fare.band === 'long') this.longRides++;
        if (pleased(this.fare.mood, { rating: rating.id, tips: this.tips, shaken: this.shaken })) this.pleased++;
      }
      const lead = !group ? '' : last ? 'Group complete · ' : `Stop ${this.stopIndex + 1} of ${this.fare.passengers} · `;
      const verdict = rating.id === 'speedy' ? `${rating.label}!` : rating.label;
      const text = [`${lead}${verdict}`, streak && `Streak ${this.streak}`, stunt && `Crazy stop +$${stunt}`, smooth && `Smooth ride +$${smooth}`, paid && `+$${paid}`, seconds && `+${seconds}s`];
      const brief = [lead.slice(0, -3), streak && `Streak ${this.streak}`, smooth && `Smooth ride +$${smooth}`].filter(Boolean).join(' · ');
      this.events.push({ kind: last ? 'paid' : 'dropoff', text: text.filter(Boolean).join(' · '), brief, paid, bonus, seconds, streak, stunt,
        rating: rating.id, passengers: stop.passengers, destination: stop.destination, groupComplete: last && group });
      if (group) this.boost = Math.min(1, this.boost + .25);
      if (!last) {
        // The group shares one clock, as in Crazy Taxi 2. Each rider adds
        // their own allowance as the one before steps out, so time saved on an
        // early stop carries forward.
        this.stopIndex++; this.fareLeft += this.currentStop.limit; this.legElapsed = 0; this.tipMark = Infinity;
        this.hold = 0; this.revision++;
        // Preserve the stunt combo, with enough grace to pull away.
        this.comboTime = Math.max(this.comboTime, COMBO_SECONDS);
        // (a goal can complete on a rider's stop too, and must bank if the group fails later)
        this.checkGoals();
        return;
      }
      if (this.overtime) { this.checkGoals(); this.finish(); return; }
      this.stopIndex = 0; this.held = 0; this.lastDropOff = { s: player.s, u: player.u };
      this.status = 'pickup'; this.fare = null; this.tips = 0; this.combo = 1; this.hold = 0;
      this.revision++; this.makeCustomers(player); this.checkGoals();
      // Overlapping pickups wait until the driver leaves the ring.
      this.blockedPickup = this.customerAt(player);
    }
  }
  drainEvents() { return this.events.splice(0); }
}
