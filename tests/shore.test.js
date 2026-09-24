import test from 'node:test';
import assert from 'node:assert/strict';
import Vector from '../src/mapgen/vector.js';
import { CITY } from '../src/world/city.js';
import { waterAt } from '../src/world/city-route.js';
import { islandOutline, landAndWater } from '../src/mapgen/shore.js';
import { ringRoad } from '../src/mapgen/road-network.js';
import { insidePolygon, distanceToPolyline, interiorPoint, segmentIntersection } from '../src/mapgen/polygon-util.js';

const inPiece = (p, piece) => insidePolygon(p, piece.outer) && !piece.holes.some(hole => insidePolygon(p, hole));
const nearEdge = (p, pieces, distance) => pieces.some(piece => [piece.outer, ...piece.holes].some(ring => distanceToPolyline(p, [...ring, ring[0]]) < distance));

test('land, sea and river cover the whole world exactly once, and the tyres see the same water', () => {
  let land = 0;
  for (let x = CITY.minX + 11; x < CITY.maxX; x += 37) for (let y = CITY.minY + 11; y < CITY.maxY; y += 37) {
    const p = { x, y };
    const count = CITY.land.filter(piece => inPiece(p, piece)).length + CITY.seaWater.filter(piece => inPiece(p, piece)).length + CITY.riverWater.filter(piece => inPiece(p, piece)).length;
    if (nearEdge(p, CITY.land, .5)) continue;
    assert.equal(count, 1, `${count} surfaces at ${x},${y}`);
    const dry = CITY.land.some(piece => inPiece(p, piece));
    if (dry) land++;
    // The 4 m mask may round a shore by a cell
    if (!nearEdge(p, CITY.land, 3)) assert.equal(waterAt(y, x), !dry, `mask at ${x},${y}`);
  }
  assert.ok(land > 1000);
  // The world beyond the island is sea, all the way to the fog and past it
  for (const [x, y] of [[CITY.minX + 5, 0], [CITY.maxX - 5, 0], [0, CITY.minY + 5], [0, CITY.maxY - 5], [CITY.maxX + 900, CITY.maxY + 900]]) assert.ok(waterAt(y, x), `sea at ${x},${y}`);
});

test('the city stands on land: lots and kerbs never in the water, roads only over it on bridges across the river', () => {
  for (const lot of CITY.lots) for (const p of lot) assert.ok(!waterAt(p.y, p.x), `lot corner in the water at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
  for (const block of CITY.blocks) for (const p of block.kerb) assert.ok(!waterAt(p.y, p.x) || nearEdge(p, CITY.land, 3), 'kerb in the water');
  for (const road of CITY.roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    for (let t = 0; t <= 1; t += .25) {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (nearEdge(p, CITY.land, 2)) continue;
      assert.ok(!CITY.seaWater.some(piece => inPiece(p, piece)), `${road.kind} road out at sea`);
    }
  }
});

test('quay walls stand in the city with the water on their right; the country meets the water in beaches and banks', () => {
  const kinds = new Set(CITY.shores.map(run => run.kind));
  assert.ok(kinds.has('quay') && kinds.has('beach'));
  const ring = CITY.ring.slice(0, -1);
  for (const run of CITY.shores) {
    for (let i = 0; i + 1 < run.points.length; i += 3) {
      const a = run.points[i], b = run.points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < 1) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const right = { x: mid.x + dy / length * 1.5, y: mid.y - dx / length * 1.5 }, left = { x: mid.x - dy / length * 1.5, y: mid.y + dx / length * 1.5 };
      assert.ok(!CITY.land.some(piece => inPiece(right, piece)) && CITY.land.some(piece => inPiece(left, piece)), 'water on the right of a shore');
      if (run.kind === 'quay') assert.ok(insidePolygon(mid, ring) || distanceToPolyline(mid, CITY.ring) < 20, 'quay in the city');
      else assert.ok(!insidePolygon(mid, ring), `${run.kind} in the city`);
    }
  }
});

test('the island shore is one simple ring round the ring road', () => {
  const ring = ringRoad(new Vector(-1200, -900), new Vector(2400, 1800), { noise: (x, y) => Math.sin(x * 3.1) * Math.cos(y * 2.3) });
  const outline = islandOutline(ring, { noise: (x, y) => Math.sin(x * 2.7 + y), reach: [60, 300] });
  for (const p of ring) assert.ok(insidePolygon(p, outline), 'ring inside the shore');
  const n = outline.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    assert.equal(segmentIntersection(outline[i], outline[(i + 1) % n], outline[j], outline[(j + 1) % n]), null, 'shore crosses itself');
  }
});

test('a river that loops and runs out past the harbour still leaves land and water tiling the world', () => {
  const island = [];
  for (let k = 0; k < 200; k++) { const a = k / 200 * Math.PI * 2; island.push(new Vector(Math.cos(a) * 1000, Math.sin(a) * 800)); }
  // A river doubling back on itself, and a coast across the south
  const centre = [];
  for (let k = 0; k <= 120; k++) { const t = k / 120; centre.push(new Vector(-1200 + t * 2400, Math.sin(t * Math.PI * 3) * 300 + 100)); }
  const coast = { line: [new Vector(-2000, -500), new Vector(0, -420), new Vector(2000, -560)], reach: 15, seaSide: -1 };
  const bounds = { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 };
  const { land, sea, river } = landAndWater({ island, coast, river: { centre, halfWidth: 40 }, bounds });
  assert.ok(land.length >= 2 && river.length >= 1);
  for (let x = -2900; x < 3000; x += 97) for (let y = -2900; y < 3000; y += 97) {
    const p = { x, y };
    if (nearEdge(p, land, .5)) continue;
    const count = [...land, ...sea, ...river].filter(piece => inPiece(p, piece)).length;
    assert.equal(count, 1, `${count} surfaces at ${x},${y}`);
  }
});

test('a point inside a U-shaped polygon is inside it, as its centroid is not', () => {
  const u = [[0, 0], [100, 0], [100, 100], [80, 100], [80, 20], [20, 20], [20, 100], [0, 100]].map(([x, y]) => new Vector(x, y));
  const p = interiorPoint(u);
  assert.ok(insidePolygon(p, u));
  assert.ok(distanceToPolyline(p, [...u, u[0]]) > 5);
});
