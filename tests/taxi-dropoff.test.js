import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY } from '../src/world/city.js';
import { onRoadAt, waterAt } from '../src/world/city-route.js';
import { cityPlaces, dropOffStretch, OPEN_REACH } from '../src/city-exploration.js';
import { TaxiRun, STOP_RADIUS, STOP_SECONDS, GROUP_MIN_HOP, nearestOnStop, insideStop, stopGap } from '../src/taxi-run.js';
import { stretchOutline } from '../src/taxi-view.js';
import { distanceToPolyline } from '../src/mapgen/polygon-util.js';

const places = cityPlaces();
const lengthOf = line => line.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.s - line[i].s, p.u - line[i].u), 0);
const open = place => place.park !== undefined;

test('every drop-off is a stretch of curbside lane through its entrance, on its one street', () => {
  for (const place of places) {
    const line = dropOffStretch(place), e = place.entrance;
    assert.equal(dropOffStretch(place), line, 'worked out once');
    assert.ok(line.some(p => p.s === e.s && p.u === e.u), `${place.name}: the entrance is in its stretch`);
    const street = CITY.roadIndex.nearest(e.u, e.s, 12, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance).road;
    for (const [i, p] of line.entries()) {
      if (i) assert.ok(Math.hypot(p.s - line[i - 1].s, p.u - line[i - 1].u) < 2.2, `${place.name}: a gap in its stretch`);
      assert.ok(!waterAt(p.s, p.u), `${place.name}: its stretch runs onto a bridge`);
      const road = CITY.roadIndex.nearest(p.u, p.s, 12, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance);
      assert.equal(road?.road, street, `${place.name}: its stretch leaves its street`);
      assert.ok(Math.abs(road.distance - street.profile.lane) < .3, `${place.name}: its stretch leaves the lane`);
      if (p.s === e.s && p.u === e.u) continue;
      // (clear of the streets crossing it, a car's length short of their curbs)
      const crossing = CITY.roadIndex.nearest(p.u, p.s, 30, (segment, distance) => segment.road === street || segment.road.kind === 'path' ? Infinity : distance - segment.road.profile.halfWidth);
      assert.ok(!crossing || crossing.score > 8, `${place.name}: its stretch runs into a junction`);
    }
    const length = lengthOf(line);
    if (open(place)) {
      assert.ok(length <= OPEN_REACH * 2 + 4, `${place.name}: ${length.toFixed(0)} m`);
      // (beside its own curb all the way)
      const kerb = CITY.parkPlans[place.park].kerb;
      if (kerb.length >= 3) for (const p of line) assert.ok(distanceToPolyline({ x: p.u, y: p.s }, [...kerb, kerb[0]]) < street.profile.halfWidth + 3, `${place.name}: its stretch runs past its curb`);
    } else assert.ok(length <= place.footprint.width / 2 + 1, `${place.name}: ${length.toFixed(0)} m, beyond the middle of its front`);
  }
  // Parks and squares are dropped off anywhere along their side of the street,
  // buildings at their doors
  const median = list => list.map(place => lengthOf(dropOffStretch(place))).sort((a, b) => a - b)[list.length >> 1];
  const openLength = median(places.filter(open)), buildingLength = median(places.filter(place => !open(place)));
  assert.ok(openLength >= 30, `open places' stretches: median ${openLength} m`);
  assert.ok(buildingLength >= 4 && buildingLength <= 24, `buildings' stretches: median ${buildingLength} m`);
});

test('the stop reaches STOP_RADIUS either side of its stretch, round both ends', () => {
  const stretch = [{ s: 0, u: 0 }, { s: 10, u: 0 }, { s: 20, u: 5 }], stop = { s: 10, u: 0, stretch };
  assert.deepEqual(nearestOnStop(stop, { s: 5, u: 3 }), { s: 5, u: 0, distance: 3 });
  assert.ok(insideStop(stop, { s: -STOP_RADIUS + .1, u: 0 }), 'round the start');
  assert.ok(!insideStop(stop, { s: -STOP_RADIUS - .1, u: 0 }));
  assert.ok(insideStop(stop, { s: 20, u: 5 + STOP_RADIUS - .1 }), 'past the end');
  assert.ok(insideStop(stop, { s: 5, u: -STOP_RADIUS + .1 }) && !insideStop(stop, { s: 5, u: -STOP_RADIUS - .1 }), 'across the middle');
  // A waiting fare, or a stretch of one point, is a ring
  const ring = { s: 3, u: 4 };
  assert.equal(nearestOnStop(ring, { s: 0, u: 0 }).distance, 5);
  assert.equal(nearestOnStop({ ...ring, stretch: [{ s: 3, u: 4 }] }, { s: 0, u: 0 }).distance, 5);
});

// Fares from a grid of pickups over the city
function offers() {
  const run = new TaxiRun(), found = new Map();
  for (let s = -900; s <= 900; s += 450) for (let u = -1200; u <= 1200; u += 400) {
    run.start({ s, u, heading: 0, speed: 0 });
    for (const offer of run.customers) found.set(offer.id, offer);
  }
  return [...found.values()];
}

test('a rider bound for a park gets out anywhere along its side of the street, and not past it', () => {
  const all = offers(), offer = all.find(offer => offer.passengers === 1 && lengthOf(offer.stops[0].destination.stretch) >= 30);
  assert.ok(offer, 'a lone rider bound for a park or a square');
  const line = offer.stops[0].destination.stretch, gate = offer.stops[0].destination;
  const ends = [[line[0], line[1]], [line.at(-1), line.at(-2)]];
  assert.ok(Math.max(...ends.map(([end]) => Math.hypot(end.s - gate.s, end.u - gate.u))) > STOP_RADIUS * 2, 'an end well off the gate, where the old ring stopped');
  for (const [end, before] of ends) {
    const run = new TaxiRun(), car = { s: offer.s, u: offer.u, heading: 0, speed: 0 };
    run.start({ s: offer.s + 3000, u: offer.u, heading: 0, speed: 0 });
    run.customers = [offer]; run.blockedPickup = null;
    run.update(STOP_SECONDS, car); assert.equal(run.status, 'driving');
    // Beyond the end of the stretch, clear of its ring: still driving, and
    // the route runs to the end
    const du = end.u - before.u, ds = end.s - before.s, span = Math.hypot(du, ds);
    Object.assign(car, { s: end.s + ds / span * (STOP_RADIUS + 1), u: end.u + du / span * (STOP_RADIUS + 1) });
    run.update(STOP_SECONDS, car);
    assert.equal(run.status, 'driving', 'past the end of the stretch');
    assert.ok(Math.hypot(run.approach(car).s - end.s, run.approach(car).u - end.u) < 1e-6);
    Object.assign(car, { s: end.s, u: end.u });
    run.update(STOP_SECONDS, car);
    assert.equal(run.status, 'pickup', 'dropped off at the end of the stretch');
    assert.equal(run.delivered, 1);
    assert.deepEqual(run.lastDropOff, { s: end.s, u: end.u }, 'fresh fares keep clear of where the rider got out');
  }
});

test('no stop in a fare lies within reach of the one before it, nor of its pickup', () => {
  // Otherwise a cab stopped for one rider would let the next out too, or
  // drop a fare where it boarded
  for (const offer of offers()) {
    assert.ok(nearestOnStop(offer.stops[0].destination, offer).distance > STOP_RADIUS * 2, `${offer.id} boards in its own drop-off`);
    for (let i = 1; i < offer.stops.length; i++) {
      const a = offer.stops[i - 1].destination, b = offer.stops[i].destination;
      assert.ok(stopGap(a, b) >= GROUP_MIN_HOP, `${a.name} and ${b.name} are ${stopGap(a, b).toFixed(1)} m apart`);
    }
  }
  // (measured between the stretches, as a ring's stop is its one point)
  const line = n => ({ s: 0, u: 0, stretch: Array.from({ length: n }, (_, i) => ({ s: i * 2, u: 0 })) });
  assert.equal(stopGap({ s: 0, u: 0 }, { s: 30, u: 40 }), 50);
  assert.equal(stopGap(line(11), { s: 30, u: 0 }), 10);
  assert.equal(stopGap(line(11), { s: 30, u: 0, stretch: [{ s: 26, u: 0 }, { s: 34, u: 0 }] }), 6);
});

test('the drop-off marker rings its whole stretch, and a stretch of one point is the ring', () => {
  const heading = .7, radius = 7.8, sin = Math.sin(heading), cos = Math.cos(heading);
  // Back to the world's plane from the marker's frame (local -z ahead)
  const world = (stop, x, z) => ({ u: stop.u + x * cos - z * sin, s: stop.s - (x * sin + z * cos) });
  const point = { s: 40, u: -12, heading };
  const circle = stretchOutline(point, radius);
  assert.equal(circle.length / 2, 40, 'as many sides as the ring');
  for (let k = 0; k < circle.length; k += 2) assert.ok(Math.abs(Math.hypot(circle[k], circle[k + 1]) - radius) < 1e-9);
  // A bent stretch, starting 6 m behind its entrance
  const stretch = Array.from({ length: 16 }, (_, i) => {
    const d = (i - 3) * 2, bend = Math.max(0, d - 12) ** 2 * .02;
    return { s: point.s + cos * d - sin * bend, u: point.u + sin * d + cos * bend };
  });
  const stop = { ...point, stretch }, outline = stretchOutline(stop, radius);
  let ahead = -Infinity, behind = Infinity;
  for (let k = 0; k < outline.length; k += 2) {
    const p = world(stop, outline[k], outline[k + 1]);
    assert.ok(Math.abs(nearestOnStop(stop, p).distance - radius) < .05, 'the band keeps the ring\'s radius from the stretch');
    ahead = Math.max(ahead, -outline[k + 1]); behind = Math.min(behind, -outline[k + 1]);
  }
  assert.ok(behind < -6 - radius + .01 && ahead > 20, `the band runs the stretch's length: ${behind.toFixed(1)} to ${ahead.toFixed(1)}`);
});
