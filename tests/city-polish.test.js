import test from 'node:test';
import assert from 'node:assert/strict';
import { wallHasOutlook, edgeFacade, edgeWindows, shopAwning, shopFront } from '../src/world/city-buildings.js';
import { CityChunk } from '../src/world/citydriver-world.js';
import { seededRandom } from '../src/world/route.js';
import { Surface } from '../src/world/surface.js';
import { PAVEMENT_LEVEL } from '../src/world/city-route.js';
import { CITY } from '../src/world/city.js';
import { cityMedians } from '../src/world/city-medians.js';
import { calcPolygonArea, insidePolygon } from '../src/mapgen/polygon-util.js';
import { intersection, region } from '../src/mapgen/booleans.js';
import { buildLandmark } from '../src/world/city-landmarks.js';
import { cityPlaces } from '../src/city-exploration.js';
import { cityTrees, parkedCars } from '../src/world/city-assets.js';
import { buildHedge } from '../src/world/city-detail-assets.js';

const rectangle = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
test('refined tree crowns fit existing planting clearances and parked tyres retain road contact', () => {
  for (const tree of cityTrees) {
    const g = tree.leaves, p = g.attributes.position;
    assert.ok((g.index?.count ?? p.count) / 3 <= 88, 'a crown stays a small shared mesh');
    for (let i = 0; i < p.count; i++) {
      assert.ok(Math.hypot(p.getX(i), p.getZ(i)) <= .52, 'crowns fit the street planner clearance');
      assert.ok(p.getY(i) > .27 && p.getY(i) < 1.26, 'keep headroom and the established tree height');
    }
  }
  for (const { paint, trim } of Object.values(parkedCars)) {
    paint.computeBoundingBox(); trim.computeBoundingBox();
    assert.ok(Math.abs(trim.boundingBox.min.y) < 1e-6, 'tyres touch the road at model zero');
    assert.ok(paint.boundingBox.min.y > 0, 'the body sits above the tyres');
  }
});

test('windows can overlook open ground but not neighbouring plots or the return of a concave building', () => {
  const building = rectangle(0, 0, 20, 15);
  assert.ok(wallHasOutlook(building, 1, []), 'an exposed side has an outlook');
  assert.ok(wallHasOutlook(building, 1, [rectangle(24, 0, 20, 15)]), 'a wide gap admits windows');
  assert.equal(wallHasOutlook(building, 1, [rectangle(20.2, 0, 20, 15)]), false, 'a party wall stays blank');
  assert.equal(wallHasOutlook(building, 1, [rectangle(22, 11, 20, 4)]), false, 'the whole face needs clearance, not just its centre');
  assert.equal(wallHasOutlook(building, 1, [rectangle(22, 7, .2, .2)]), false, 'a narrow intrusion between samples is still found');
  const courtyard = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 15 }, { x: 12, y: 15 }, { x: 12, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 15 }, { x: 0, y: 15 }];
  assert.equal(wallHasOutlook(courtyard, 3, []), false, 'a tight return of the same building blocks the outlook');
});

// Exercise the rendering entry point with different chunk origins and random
// histories: the same physical tree must keep its silhouette at a LOD handover.
const tree = (east, start, x, s, distant, seed) => {
  const items = [], c = { east, start, distant, random: seededRandom(seed), materials: {}, features: {},
    item(key, geometry, material, position, scale, colour, yaw) { items.push({ key, scale, colour, yaw }); }, box() {}, post() {} };
  CityChunk.prototype.tree.call(c, x, s, 8);
  return items.find(item => item.key.startsWith('tree-crowns-'));
};
test('tree shape, colour and orientation belong to its world position at every detail level', () => {
  const detail = tree(160, -320, 30, 40, false, 1);
  assert.deepEqual(tree(160, -320, 30, 40, true, 937), detail);
  assert.deepEqual(tree(0, 0, 190, -280, false, 832), detail);
  const neighbours = Array.from({ length: 12 }, (_, i) => tree(160, -320, 30 + i * 18, 40, false, 1));
  assert.ok(new Set(neighbours.map(t => t.yaw)).size > 8, 'a row does not repeat the same orientation');
  assert.ok(neighbours.every(t => t.scale[0] <= 8 * 1.06 && t.scale[2] === t.scale[0]), 'rotation keeps the existing crown clearance');
});

test('fabric awnings slope outwards, clear heads and signs, and stay cheap from both sides', () => {
  for (const distant of [false, true]) for (const variation of [0, 1, 2, 3]) {
    const c = { distant, bodies: new Surface() }, f = edgeFacade(c, { x: 10, y: 20 }, { x: 18, y: 26 });
    shopAwning(c, f, 0, 7, '#386f73', variation);
    const p = c.bodies.positions, n = c.bodies.normals;
    assert.ok(p.length / 9 <= 64, 'striped fabric replaces 192 box triangles');
    let nearest = Infinity, farthest = -Infinity, atWall = 0, atEdge = 0;
    for (let i = 0; i < p.length; i += 3) {
      const local = f.local(p[i], -p[i + 2]), height = p[i + 1] - PAVEMENT_LEVEL;
      assert.ok(Math.abs(local.offset) <= 3.5 + 1e-8 && local.outward > 0 && local.outward < 2);
      assert.ok(height > 2.8 && height < 3.65, 'headroom below and fascia above');
      if (local.outward < nearest - 1e-8) { nearest = local.outward; atWall = height; }
      if (local.outward > farthest + 1e-8) { farthest = local.outward; atEdge = height; }
      else if (Math.abs(local.outward - farthest) < 1e-8) atEdge = Math.max(atEdge, height);
      assert.ok(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-8, 'no degenerate fabric faces');
    }
    assert.ok(atWall > atEdge + .3, 'a visible pitch away from the wall');
    assert.ok(n.some((v, i) => i % 3 === 1 && v > .5) && n.some((v, i) => i % 3 === 1 && v < -.5), 'fabric visible above and below');
  }
});

test('stacked balconies have doors meeting their decks and leave ordinary windows between them', () => {
  for (const variation of [0, 1, 2, 3]) {
    const pieces = [], f = { span: 28, street: true, clear: [], add(x, y, out, w, h, d, colour, kind = 'solid') { pieces.push({ x, y, out, w, h, d, kind }); } };
    edgeWindows({}, { type: 'apartment', variation, accent: '#386f73' }, f, 5, 3, seededRandom(123));
    const decks = pieces.filter(p => p.d === 1.5);
    assert.ok(decks.length >= 3);
    for (const deck of decks) {
      const door = pieces.find(p => ['glass', 'lit'].includes(p.kind) && p.x === deck.x && Math.abs(p.y - p.h / 2 - deck.y - deck.h / 2) < 1e-8);
      assert.ok(door && door.h > 2.4, 'each deck has a full-height door at its surface');
      assert.equal(decks.filter(p => p.x === deck.x).length, 3, 'balconies align through all three storeys');
    }
    assert.ok(pieces.some(p => p.d === .48), 'ordinary window bays retain their sills');
  }
});

test('blinds meet the glazing without overlapping it and retain the window random budget', () => {
  for (const distant of [false, true]) for (const type of ['office', 'brick', 'loft', 'apartment']) {
    const pieces = [], f = { span: 28, street: true, clear: [], add(x, y, out, w, h, d, colour, kind = 'solid') { pieces.push({ x, y, out, w, h, d, kind }); } };
    let draws = 0;
    edgeWindows({ distant }, { type, variation: 0, accent: '#386f73' }, f, 5, 3, () => { draws++; return .95; });
    const glass = pieces.filter(p => p.kind === 'glass'), blinds = pieces.filter(p => p.kind === 'inlay');
    assert.equal(draws, glass.length, 'one existing draw per window');
    assert.equal(blinds.length > 0, type !== 'loft', 'industrial windows keep clear glazing');
    for (const blind of blinds) {
      const pane = glass.find(p => p.x === blind.x && Math.abs(p.y + p.h / 2 - (blind.y - blind.h / 2)) < 1e-8);
      assert.ok(pane, 'glazing ends exactly where the blind starts');
      assert.equal(pane.w, blind.w);
      assert.equal(blind.out + blind.d / 2, pane.out + (distant ? 0 : pane.d / 2), 'inserts share the visible glazing plane');
    }
  }
});

test('softened hedges keep the existing footprint and bake into twenty opaque faces', () => {
  const yaw = .7, width = 17, depth = .7, height = .95, bodies = new Surface();
  buildHedge(bodies, 23, PAVEMENT_LEVEL, -31, width, height, depth, '#587745', yaw);
  assert.equal(bodies.positions.length / 9, 20);
  for (let i = 0; i < bodies.positions.length; i += 3) {
    const x = bodies.positions[i] - 23, z = bodies.positions[i + 2] - 31, y = bodies.positions[i + 1] - PAVEMENT_LEVEL;
    const along = x * Math.cos(yaw) - z * Math.sin(yaw), across = x * Math.sin(yaw) + z * Math.cos(yaw);
    assert.ok(Math.abs(along) <= width / 2 + 1e-6 && Math.abs(across) <= depth / 2 + 1e-6);
    assert.ok(y >= -1e-6 && y <= height + 1e-6);
    if (y > height - 1e-6) assert.ok(Math.abs(across) < depth * .4, 'shoulders taper towards the crown');
    assert.ok(Math.abs(Math.hypot(...bodies.normals.slice(i, i + 3)) - 1) < 1e-6);
  }
});

test('shop entrances, glazing, awnings and signs fit narrow, wide and mirrored frontages', () => {
  for (const span of [5, 7.5, 11.9, 12, 18, 32, 55]) for (const variation of [0, 1, 2, 3]) for (const distant of [false, true]) {
    const boxes = [], signs = [], c = { distant, bodies: new Surface(), materials: { glass: {} },
      box(x, y, s, w, h, d, colour, kind) { boxes.push({ x, y, s, w, h, d, colour, kind }); },
      item(key, geometry, material, p, scale, colour) { boxes.push({ x: p[0], y: p[1], s: -p[2], w: scale[0], h: scale[1], colour, kind: 'glass' }); },
      signFace(key, sign, x, y, s, yaw, w, h) { signs.push({ x, y, s, w, h }); } };
    const f = edgeFacade(c, { x: 13, y: 27 }, { x: 13 + span * .6, y: 27 + span * .8 });
    shopFront(c, { type: 'apartment', variation, accent: '#386f73', shop: 'CAFE', seed: 41 }, f, 5.4, true);
    const local = boxes.map(p => ({ ...p, offset: f.local(p.x, p.s).offset }));
    const doors = local.filter(p => p.kind === 'glass' && p.y - p.h / 2 < PAVEMENT_LEVEL + .25);
    assert.equal(doors.length, span >= 12 ? 2 : 1, 'one shop door, plus an upstairs entrance where there is room');
    for (const p of local) {
      assert.ok(p.w > 0 && p.h > 0 && Math.abs(p.offset) + p.w / 2 < span / 2 + 1e-8, 'all facade pieces fit');
    }
    for (const door of doors) {
      assert.ok(!local.some(p => p !== door && p.y < PAVEMENT_LEVEL + .75 && Math.abs(p.offset - door.offset) < (p.w + door.w) / 2), 'no display sill crosses a doorway');
    }
    const fascia = local.find(p => p.h > 1 && p.y - p.h / 2 > PAVEMENT_LEVEL + 3.6);
    for (const sign of signs) assert.ok(Math.abs(f.local(sign.x, sign.s).offset - fascia.offset) + sign.w / 2 <= fascia.w / 2, 'the name stays over the shop');
    const p = c.bodies.positions;
    for (let i = 0; i < p.length; i += 3) {
      const offset = f.local(p[i], -p[i + 2]).offset;
      assert.ok(Math.abs(offset - fascia.offset) <= fascia.w / 2 && p[i + 1] < fascia.y - fascia.h / 2, 'fabric stays below its own fascia, clear of the upstairs entrance');
    }
  }
});

test('median lawns stay on land while bridge separators retain their raised footprint', () => {
  const area = pieces => pieces.reduce((sum, p) => sum + calcPolygonArea(p.outer) - p.holes.reduce((n, h) => n + calcPolygonArea(h), 0), 0);
  const water = region([...CITY.seaWater, ...CITY.riverWater]), medians = cityMedians().list;
  let crossings = 0, grass = 0;
  for (const median of medians) {
    // Clipper rounds each new intersection to millimetres at the bank.
    assert.ok(area(intersection(region(median.lawns), water)) < .01, 'no lawn over water');
    if (area(intersection([median.polygon], water)) > 10) crossings++;
    grass += area(median.lawns);
  }
  assert.ok(crossings > 0, 'bridges retain their continuous raised separator');
  assert.ok(grass > 1000, 'the avenues still have lawns');
});

test('every enclosed venue has a doorway and vehicle bays open onto a paved apron', () => {
  for (const place of cityPlaces().filter(p => p.footprint && !['clock', 'art'].includes(p.type))) for (const distant of [false, true]) {
    const boxes = [], paving = [], c = { east: 0, start: 0, distant, bodies: new Surface(), materials: { solid: {}, glass: {} }, features: { buildings: [] },
      box(x, y, s, w, h, d, colour, kind) { boxes.push({ x, y, s, w, h, d, colour, kind }); },
      polygon(points, y, depth, colour) { if (colour === '#c9bfa9') paving.push(points.map(([x, y]) => ({ x, y }))); }, polygonSolid() {},
      item(key, geometry, material, p, scale, colour) { if (key === 'distant-glass') boxes.push({ x: p[0], y: p[1], s: -p[2], w: scale[0], h: scale[1], colour, kind: 'glass' }); },
      tree() {}, post() {}, signFace() {}, standingSign() {}, solid() {}, rigid(x, s, fn) { fn(); } };
    buildLandmark(c, { polygon: place.polygon, seed: 123 }, place);
    const site = place.footprint, D = site.depth;
    const front = place.type === 'sports' ? D / 2 - Math.max(7, D * .32) : -D / 2 + (place.type === 'observatory' ? D * .1 : place.type === 'garden' ? D * .15 : 0);
    if (['depot', 'firehouse'].includes(place.type)) for (const side of [-1, 1]) {
      const into = front - Math.max(2, site.setback * .6), along = side * site.width * .4;
      const p = { x: site.centre.x + site.tx * along + site.nx * into, y: site.centre.y + site.ty * along + site.ny * into };
      if (insidePolygon(p, place.polygon)) assert.ok(paving.some(ring => insidePolygon(p, ring)), `${place.name}: the outer loading bays need paving too`);
    }
    const doors = boxes.filter(p => p.kind === 'glass' && p.colour === '#375563' && p.h > 2.5);
    assert.ok(doors.length, `${place.name} needs a door at ${distant ? 'distant' : 'close'} range`);
    for (const door of doors) {
      const x = door.x - site.centre.x, y = door.s - site.centre.y, into = x * site.nx + y * site.ny;
      assert.ok(into < front - .2 && into > front - .5, `${place.name}: door is visible ahead of its front wall`);
      assert.ok(Math.abs(x * site.tx + y * site.ty) + door.w / 2 < site.width / 2, 'door fits within the facade');
      const bottom = door.y - door.h / 2 - PAVEMENT_LEVEL;
      assert.ok(Math.abs(bottom - .1) < 1e-8 || Math.abs(bottom - .8) < 1e-8, 'door meets the forecourt or portico landing');
    }
  }
});
