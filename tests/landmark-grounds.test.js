import test from 'node:test';
import assert from 'node:assert/strict';
import { cityPlaces } from '../src/city-exploration.js';
import { buildLandmark } from '../src/world/city-landmarks.js';
import { Surface } from '../src/world/surface.js';

// What a venue's grounds and building must show, whatever the site, as the
// notebook describes it (see landmark-grounds.js). A kind missing here may
// still go without on a cramped lot: a hotel's terrace, a cinema's booth,
// the stands by the courts.
const SIGNATURES = {
  station: ['item rail-carriage'], depot: ['colour #5d6061'], market: ['item square-stall'], cityhall: ['item basin-rim'],
  museum: ['item square-sculpture'], library: ['prop bench'], hospital: ['item basin-rim'], bathhouse: ['colour #4fb6b2'],
  observatory: ['item armillary-upright', 'item observatory-telescope'], music: ['item poster-column'], postoffice: ['prop post-box'],
  firehouse: ['item detail-fire-engine'],
};

test('each venue has what the notebook says it has, near and from afar alike', () => {
  for (const place of cityPlaces().filter(place => place.footprint && SIGNATURES[place.type])) {
    const seen = new Set(), c = {
      east: 0, start: 0, distant: false, bodies: new Surface(), materials: { solid: {}, glass: {}, props: {} }, features: { buildings: [], shopLights: [] }, grassAreas: null,
      box(x, y, s, w, h, d, colour) { seen.add(`colour ${colour}`); }, item(key) { seen.add(`item ${key.replace(/-(#?[0-9a-f]{6}|\d+)$/, '')}`); return {}; },
      prop(name) { seen.add(`prop ${name}`); return {}; }, polygon() {}, polygonSolid() {}, tree() {}, post() {}, signFace() {}, standingSign() {}, solid() {},
      rigid(x, s, fn) { fn(); }, knockable() {},
    };
    buildLandmark(c, { polygon: place.polygon, seed: 123 }, place);
    for (const mark of SIGNATURES[place.type]) assert.ok(seen.has(mark), `${place.name} (${place.id}) has no ${mark}`);
    // (the skyline lays out the same grounds, and draws what it can see)
    if (place.type === 'station') {
      const far = new Set();
      buildLandmark({ ...c, distant: true, bodies: new Surface(), item(key) { far.add(key.replace(/-(#?[0-9a-f]{6})$/, '')); return {}; } }, { polygon: place.polygon, seed: 123 }, place);
      assert.ok(far.has('rail-carriage'), `${place.name}: its train is gone from afar`);
    }
  }
});
