import test from 'node:test';
import assert from 'node:assert/strict';
import { connectWalk, parkSurfaces, walkRegion } from '../src/world/city-park-surfaces.js';
import { circle, cityParks, pondShore } from '../src/world/city-parks.js';
import { CITY } from '../src/world/city.js';
import { calcPolygonArea, insidePolygon } from '../src/mapgen/polygon-util.js';
import { difference, intersection, region, solids } from '../src/mapgen/booleans.js';

const rectangle = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const area = pieces => pieces.reduce((sum, p) => sum + calcPolygonArea(p.outer) - p.holes.reduce((s, h) => s + calcPolygonArea(h), 0), 0);
const contains = (pieces, x, y) => pieces.some(p => insidePolygon({ x, y }, p.outer) && !p.holes.some(h => insidePolygon({ x, y }, h)));
const entry = () => ({ park: { kerb: rectangle(-20, -20, 40, 40), lawn: rectangle(-17, -17, 34, 34), square: true }, walks: [], panels: [], plaza: null });

test('closed walks join across their seam and keep their central lawn', () => {
  const ring = circle(0, 0, 10, 32), paving = walkRegion([...ring, ring[0]], 1.8);
  assert.equal(paving.length, 1);
  assert.equal(paving[0].holes.length, 1);
  assert.equal(contains(paving, 0, 0), false);
  for (let k = 0; k < 96; k++) {
    const a = k * Math.PI / 48;
    assert.ok(contains(paving, Math.cos(a) * 10, Math.sin(a) * 10), `unbroken walk at ${k}`);
  }
});

test('path junctions have a single surface, no edging across branches, and clip their full width to the kerb', () => {
  const e = entry(), roads = [
    { points: [{ x: -30, y: -26 }, { x: 30, y: 26 }], profile: { halfWidth: 2 } },
    { points: [{ x: -30, y: 0 }, { x: 30, y: 0 }], profile: { halfWidth: 2 } },
  ];
  const p = parkSurfaces(e, roads);
  assert.equal(p.walks.length, 1);
  assert.ok(contains(p.walks, 0, 0));
  assert.ok(area(p.edging) > 1);
  assert.ok(area(intersection(region(p.walks), region(p.edging))) < .001);
  assert.ok(area(difference(region(p.walks), solids([e.park.kerb]))) < .001);
  assert.ok(area(difference(region(p.edging), solids([e.park.lawn]))) < .001, 'no bars across pavement mouths');
});

test('square entrances cross the grass gap and meet pavement across an angled mouth', () => {
  const e = entry();
  e.walks = [[{ x: -16.5, y: -4 }, { x: 0, y: 0 }]];
  e.plaza = { x: 0, y: 0, radius: 4 };
  const p = parkSurfaces(e, []);
  for (const y of [-6.1, -4.9, -3.5]) assert.ok(contains(p.walks, -19.99, y), 'the full mouth reaches the kerb');
  assert.ok(contains(p.walks, -16.8, -4.1), 'no strip of lawn across the entrance');
  assert.ok(area(intersection(region(p.walks), region(p.plaza))) < .001, 'walks and plaza cannot fight for depth');
  const corner = connectWalk([{ x: -16.7, y: -16.7 }, { x: 0, y: 0 }], e.park.lawn, e.park.kerb);
  assert.ok(corner[0].x < -20 && corner[0].y < -20, 'a ray hitting a kerb vertex also connects');
});

test('generated park paving stays inside its park and clear of pond water', () => {
  const roads = CITY.roads.filter(r => r.kind === 'path');
  let count = 0;
  for (const e of cityParks()) {
    const p = parkSurfaces(e, roads), all = [...p.walks, ...p.plaza, ...p.edging];
    assert.ok(area(difference(region(all), solids([e.park.kerb]))) < .03, `park ${e.index}: no path corners in the carriageway`);
    assert.ok(area(intersection(region(p.walks), region(p.plaza))) < .01, 'plazas and walks meet without overlap');
    // Re-intersecting shared oblique edges can leave millimetre slivers:
    // Clipper rounds every new intersection. Limit each overlap's width,
    // rather than accumulating that rounding over a whole park perimeter.
    for (const overlap of intersection(region(p.edging), region([...p.walks, ...p.plaza]))) {
      const perimeter = overlap.outer.reduce((sum, p, i, ring) => sum + Math.hypot(p.x - ring[(i + 1) % ring.length].x, p.y - ring[(i + 1) % ring.length].y), 0);
      assert.ok(area([overlap]) < Math.max(.001, perimeter * .001), 'no stone bars across walks');
    }
    if (e.pond) assert.ok(area(intersection(region(all), solids([pondShore(e.pond)]))) < .03, 'ponds remain open');
    count += p.walks.length;
  }
  assert.ok(count > 0);
});
