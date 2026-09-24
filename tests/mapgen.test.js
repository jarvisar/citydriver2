import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCityMap, cityStats, ROAD_PROFILES } from '../src/mapgen/generate.js';
import Vector from '../src/mapgen/vector.js';
import { offsetPolygon, insidePolygon, isSimple, calcPolygonArea, splitPolygonByPolyline, subdividePolygon, lineRectanglePolygon, bufferPolyline } from '../src/mapgen/polygon-util.js';
import { simplify } from '../src/mapgen/simplify.js';
import { mulberry32 } from '../src/mapgen/random.js';

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
