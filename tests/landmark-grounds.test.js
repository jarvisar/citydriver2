import test from 'node:test';
import assert from 'node:assert/strict';
import { cityPlaces } from '../src/city-exploration.js';
import { buildLandmark } from '../src/world/city-landmarks.js';
import { Surface } from '../src/world/surface.js';
import { insidePolygon } from '../src/mapgen/polygon-util.js';
import { PAVEMENT_LEVEL } from '../src/world/city-route.js';

// What a venue's grounds and building must show, whatever the site, as the
// notebook describes it (see landmark-grounds.js). A kind missing here may
// still go without on a cramped lot: a hotel's terrace, a cinema's booth,
// the stands by the courts.
const SIGNATURES = {
  station: ['item rail-carriage'], depot: ['colour #5d6061'], market: ['item square-stall'], cityhall: ['item basin-rim'],
  museum: ['item square-sculpture'], library: ['prop bench'], hospital: ['item basin-rim', 'parked ambulance'], bathhouse: ['colour #4fb6b2'],
  observatory: ['item armillary-upright', 'item observatory-telescope'], music: ['knock column'], postoffice: ['knock post-box'],
  firehouse: ['parked fireengine'], sports: ['knock hoop|knock net'],
};
// A stand-in chunk that notes what a venue is built from: `seen` its items
// ('item key'), props, colors and knockable pieces ('knock kind'), and its
// colliders, each { points } for a footprint or a box's middle and top
function recorder(distant = false) {
  const seen = new Set(), solids = [];
  return {
    seen, solids, east: 0, start: 0, distant, bodies: new Surface(), materials: { solid: {}, glass: {}, props: {} }, features: { buildings: [], shopLights: [] }, grassAreas: null,
    box(x, y, s, w, h, d, colour) { seen.add(`colour ${colour}`); return {}; }, item(key) { seen.add(`item ${key.replace(/-(#?[0-9a-f]{6}|\d+(\.\d+)?)$/, '')}`); return {}; },
    prop(name) { seen.add(`prop ${name}`); return {}; }, polygon() {}, tree() {}, post() {}, signFace() {}, standingSign() {},
    polygonSolid(points, top) { const made = { points, top }; solids.push(made); return made; },
    solid(x, s, w, d) { const made = { x, s, w, d }; solids.push(made); return made; },
    parkedCar(model) { seen.add(`parked ${model}`); return {}; },
    rigid(x, s, fn) { return fn(); }, knockable(items, pieces) { seen.add(`knock ${pieces[0].kind}`); },
  };
}

test('each venue has what the notebook says it has, near and from afar alike', () => {
  for (const place of cityPlaces().filter(place => place.footprint && SIGNATURES[place.type])) {
    const c = recorder(), seen = c.seen;
    buildLandmark(c, { polygon: place.polygon, seed: 123 }, place);
    for (const mark of SIGNATURES[place.type]) assert.ok(mark.split('|').some(each => seen.has(each)), `${place.name} (${place.id}) has no ${mark}`);
    // (the skyline lays out the same grounds, and draws what it can see)
    if (place.type === 'station') {
      const far = new Set();
      buildLandmark({ ...c, distant: true, bodies: new Surface(), item(key) { far.add(key.replace(/-(#?[0-9a-f]{6})$/, '')); return {}; } }, { polygon: place.polygon, seed: 123 }, place);
      assert.ok(far.has('rail-carriage'), `${place.name}: its train is gone from afar`);
    }
  }
});

test('a club is solid only where its clubhouse stands: its courts are open ground', () => {
  const clubs = cityPlaces().filter(place => place.footprint && place.type === 'sports');
  for (const place of clubs) {
    const c = recorder(), f = place.footprint;
    buildLandmark(c, { polygon: place.polygon, seed: 123 }, place);
    const buildings = c.solids.filter(solid => solid.points).map(solid => solid.points.map(([x, y]) => ({ x, y })));
    // (the courts lie in front of the clubhouse, between the site's middle and its front)
    const court = { x: f.centre.x - f.nx * f.depth * .25, y: f.centre.y - f.ny * f.depth * .25 };
    const house = { x: f.centre.x + f.nx * f.depth * .4, y: f.centre.y + f.ny * f.depth * .4 };
    assert.ok(!buildings.some(ring => insidePolygon(court, ring)), `${place.name}: its courts are walled in`);
    assert.ok(buildings.some(ring => insidePolygon(house, ring)), `${place.name}: its clubhouse is open`);
  }
});

test("a portico's steps and floor are steps up, on foot or in a car", () => {
  const halls = cityPlaces().filter(place => place.footprint && ['cityhall', 'museum', 'library', 'postoffice'].includes(place.type));
  assert.ok(halls.length > 0);
  for (const place of halls) {
    const c = recorder();
    buildLandmark(c, { polygon: place.polygon, seed: 123 }, place);
    const tops = new Set(c.solids.filter(solid => solid.top !== undefined && !solid.points).map(solid => (solid.top - PAVEMENT_LEVEL).toFixed(2)));
    for (const rise of [.2, .5, .8]) assert.ok([...tops].some(top => Math.abs(Number(top) - rise) < .01), `${place.name}: no step ${rise} m up`);
  }
});
