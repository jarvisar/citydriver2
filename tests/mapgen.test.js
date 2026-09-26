import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCityMap, cityStats, ROAD_PROFILES } from '../src/mapgen/generate.js';
import Vector from '../src/mapgen/vector.js';
import { offsetPolygon, insidePolygon, isSimple, calcPolygonArea, splitPolygonByPolyline, subdividePolygon, lineRectanglePolygon, bufferPolyline } from '../src/mapgen/polygon-util.js';
import { simplify } from '../src/mapgen/simplify.js';
import { mulberry32 } from '../src/mapgen/random.js';
import { doublesBack } from '../src/mapgen/water-generator.js';
import { withoutHoles } from '../src/mapgen/booleans.js';
import { chooseCollectors } from '../src/mapgen/road-hierarchy.js';

const square = (size = 100) => [new Vector(0, 0), new Vector(size, 0), new Vector(size, size), new Vector(0, size)];

test('a seed reproduces the same city and different seeds differ', () => {
  const a = generateCityMap({ seed: 4817, width: 1200, height: 900 });
  const b = generateCityMap({ seed: 4817, width: 1200, height: 900 });
  assert.deepEqual(cityStats(a).roads, cityStats(b).roads);
  assert.deepEqual(a.lots.map(lot => lot.map(p => [p.x, p.y])), b.lots.map(lot => lot.map(p => [p.x, p.y])));
  const c = generateCityMap({ seed: 4818, width: 1200, height: 900 });
  assert.notDeepEqual(a.lots.length, c.lots.length);
});

test('a generated city has roads of every class, blocks, lots, parks and water inside its domain', () => {
  const city = generateCityMap({ seed: 42, width: 1600, height: 1200 });
  const stats = cityStats(city);
  assert.ok(stats.roads.major.count > 0 && stats.roads.minor.count > 5, JSON.stringify(stats.roads));
  assert.ok(city.blocks.length > 20 && city.lots.length > 100, `${city.blocks.length} blocks, ${city.lots.length} lots`);
  assert.ok(city.parks.length >= 1);
  assert.ok(city.hasCoast || city.hasRiver);
  for (const road of city.roads) {
    assert.ok(ROAD_PROFILES[road.kind], road.kind);
    for (const p of road.points) assert.ok(Math.abs(p.x) <= 800 + 40 && Math.abs(p.y) <= 600 + 40, `road point outside the domain ${p.x},${p.y}`);
  }
  // Every lot lies inside its block and away from the road centrelines
  for (const lot of city.lots) {
    const centre = lot.reduce((sum, p) => sum.add(p), new Vector(0, 0)).divideScalar(lot.length);
    assert.ok(isSimple(lot));
    assert.ok(calcPolygonArea(lot) >= 60, `lot area ${calcPolygonArea(lot)}`);
    assert.ok(!insidePolygon(centre, city.sea) && !insidePolygon(centre, city.river), 'lot in the water');
    const nearest = city.roadIndex.nearest(centre.x, centre.y, 200);
    assert.ok(!nearest || nearest.distance >= nearest.road.profile.halfWidth, 'lot centre on a road');
  }
  assert.ok(city.nav.length > 100);
  assert.ok(city.timings.total < 20000);
});

test('polygon offset shrinks a square and rejects a collapse; per-edge distances apply', () => {
  const inset = offsetPolygon(square(), -10);
  assert.equal(inset.length, 4);
  assert.ok(Math.abs(calcPolygonArea(inset) - 80 * 80) < 1e-6);
  assert.deepEqual(offsetPolygon(square(), -60), []);
  const uneven = offsetPolygon(square(), (a, b, i) => (i === 0 ? -20 : -5));
  assert.ok(Math.abs(calcPolygonArea(uneven) - 90 * 75) < 1e-6);
  const grown = offsetPolygon(square(), 5);
  assert.ok(Math.abs(calcPolygonArea(grown) - 110 * 110) < 1e-6);
});

test('a polyline splits a polygon into two pieces that add up, and cuts a rectangle into land and sea', () => {
  const line = [new Vector(-10, 50), new Vector(50, 55), new Vector(110, 50)];
  const pieces = splitPolygonByPolyline(square(), line);
  assert.equal(pieces.length, 2);
  assert.ok(Math.abs(pieces[0].length + pieces[1].length - 10) <= 2);
  assert.ok(Math.abs(calcPolygonArea(pieces[0]) + calcPolygonArea(pieces[1]) - 10000) < 1e-6);
  const sea = lineRectanglePolygon(new Vector(0, 0), new Vector(100, 100), [new Vector(-5, 20), new Vector(50, 25), new Vector(105, 20)]);
  assert.ok(calcPolygonArea(sea) < 5000 && calcPolygonArea(sea) > 1500);
  assert.ok(insidePolygon(new Vector(50, 5), sea) && !insidePolygon(new Vector(50, 80), sea));
});

test('a ring road is a band all the way round, with no notch or gap where it starts', () => {
  // (seeds 135, 215, 248 and 1676955306: a ring road starting on a bend was
  // buffered with two flat ends there, which left a notch outside the bend
  // that the sea took, and lost its last edge)
  const ring = [new Vector(0, 0), new Vector(100, 0), new Vector(100, 100), new Vector(0, 100), new Vector(0, 0)];
  const band = bufferPolyline(ring, 10);
  // the outside of the bend at its start and all along its last edge, and not the middle
  for (const [x, y] of [[-6, -6], [-8, 50], [50, -8], [108, 108], [-8, 2], [2, -8]]) assert.ok(insidePolygon(new Vector(x, y), band), `road at ${x},${y}`);
  for (const [x, y] of [[50, 50], [15, 15], [-15, -15]]) assert.ok(!insidePolygon(new Vector(x, y), band), `no road at ${x},${y}`);
  assert.ok(Math.abs(calcPolygonArea(band) - (120 * 120 - 80 * 80)) < 1, `${calcPolygonArea(band)} m²`);
  // An open line keeps its flat ends
  const street = bufferPolyline([new Vector(0, 0), new Vector(100, 0)], 5);
  assert.ok(!insidePolygon(new Vector(-1, 0), street) && Math.abs(calcPolygonArea(street) - 1000) < 1e-6);
});

test('a river that doubles back on itself, with no room for both reaches\' banks, is no river', () => {
  // (seeds 165, 118 and 242: a hairpin left its inner bank roads on top of
  // each other on a spit, or folded into a spike out over the water)
  // (both banks' roads, 58 m out and 8 m half wide, either side of both reaches)
  const apart = 2 * (58 + 8);
  // Out and back round a half circle, its two reaches twice its radius apart
  const hairpin = radius => [new Vector(-800, -radius), ...Array.from({ length: 25 }, (_, k) => {
    const a = -Math.PI / 2 + Math.PI * k / 24;
    return new Vector(Math.cos(a) * radius, Math.sin(a) * radius);
  }), new Vector(-800, radius)];
  assert.ok(doublesBack(hairpin(64), apart), 'reaches 128 m apart');
  assert.ok(doublesBack(hairpin(40), apart), 'a bend tighter than its banks');
  // but a bend as wide as the river's fillets, and a straight river, are
  assert.ok(!doublesBack(hairpin(90), apart), 'reaches 180 m apart');
  assert.ok(!doublesBack([new Vector(-1000, 0), new Vector(0, 30), new Vector(1000, 0)], apart), 'straight');
});

test('a piece round a hole is cut into pieces without, covering it exactly', () => {
  // (seed 1676955306: bare ground round a traffic island at a bridge's end
  // was left bare, as one outline paving it would pave the island too)
  const ring = [[0, 0], [30, 0], [30, 20], [0, 20]].map(([x, y]) => ({ x, y })), hole = [[10, 5], [10, 12], [18, 12], [18, 5]].map(([x, y]) => ({ x, y }));
  const pieces = withoutHoles({ outer: ring, holes: [hole] });
  assert.ok(pieces.length >= 2 && pieces.every(piece => !piece.holes.length));
  assert.ok(Math.abs(pieces.reduce((sum, piece) => sum + calcPolygonArea(piece.outer), 0) - (600 - 56)) < 1e-3);
  assert.ok(!pieces.some(piece => insidePolygon(new Vector(14, 8), piece.outer)), 'not over the island');
  assert.equal(withoutHoles({ outer: ring, holes: [] }).length, 1);
});

test('where the avenues crowd a city\'s side streets, collectors are chosen a little nearer them', () => {
  // (seeds 2 and 39: avenues 360 m apart left no side street 210 m clear of
  // them, and the city had next to no collectors between its avenues)
  const street = (kind, x) => ({ kind, points: [new Vector(x, 0), new Vector(x, 1000)] });
  const crowded = [0, 360, 720, 1080].map(x => street('major', x)).concat([180, 540, 900].map(x => street('minor', x)));
  chooseCollectors(crowded);
  assert.ok(crowded.filter(road => road.kind === 'minor').every(road => road.collector), 'none between the avenues');
  // but a city that has its collectors keeps to the full distance
  const open = [0, 460, 820].map(x => street('major', x)).concat([230, 640].map(x => street('minor', x)));
  chooseCollectors(open);
  assert.deepEqual(open.filter(road => road.collector).map(road => road.points[0].x), [230]);
});

test('subdivision keeps pieces between half and twice the minimum area and drops slivers', () => {
  const random = mulberry32(7);
  const pieces = subdividePolygon(square(120), 1000, random);
  assert.ok(pieces.length >= 6, `${pieces.length} pieces`);
  for (const piece of pieces) { const area = calcPolygonArea(piece); assert.ok(area >= 500 && area < 2000, `piece area ${area}`); }
  assert.ok(Math.abs(pieces.reduce((sum, piece) => sum + calcPolygonArea(piece), 0) - 14400) < 1);
  assert.deepEqual(subdividePolygon([new Vector(0, 0), new Vector(100, 0), new Vector(100, 4), new Vector(0, 4)], 50, random), []);
});

test('a buffered polyline is a ribbon of the right width and simplification keeps the ends', () => {
  const line = Array.from({ length: 50 }, (_, i) => new Vector(i * 10, Math.sin(i / 5) * 30));
  const ribbon = bufferPolyline(line, 20);
  assert.equal(ribbon.length, 100);
  assert.ok(isSimple(ribbon));
  assert.ok(Math.abs(calcPolygonArea(ribbon) / (490 * 40) - 1) < .15);
  const simple = simplify(line, 4);
  assert.ok(simple.length < line.length && simple.length > 4);
  assert.deepEqual([simple[0].x, simple.at(-1).x], [0, 490]);
});
