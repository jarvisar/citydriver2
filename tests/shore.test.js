import test from 'node:test';
import assert from 'node:assert/strict';
import Vector from '../src/mapgen/vector.js';
import { CITY, CITY_WIDTH, CITY_HEIGHT } from '../src/world/city.js';
import { waterAt } from '../src/world/city-route.js';
import { islandOutline, landAndWater, seaSideOf } from '../src/mapgen/shore.js';
import { ringRoad } from '../src/mapgen/road-network.js';
import { insidePolygon, distanceToPolyline, interiorPoint, segmentIntersection, calcPolygonArea } from '../src/mapgen/polygon-util.js';

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

test('the sea never takes much of the city: its blocks cover most of the domain', () => {
  // A coast across the middle can leave a city half the size of others
  const domain = CITY_WIDTH * CITY_HEIGHT, sea = CITY.sea.length >= 3 ? calcPolygonArea(CITY.sea) : 0;
  const blocks = CITY.blocks.reduce((sum, block) => sum + calcPolygonArea(block.polygon), 0);
  assert.ok(sea <= domain * .15, `the sea takes ${(100 * sea / domain).toFixed(0)}% of the domain`);
  assert.ok(blocks >= domain * .65, `blocks cover ${(100 * blocks / domain).toFixed(0)}% of the domain`);
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

test('the city meets the water in quay walls all round, with the water on their right', () => {
  assert.ok(CITY.shores.length && CITY.shores.every(run => run.kind === 'quay'));
  for (const run of CITY.shores) {
    for (let i = 0; i + 1 < run.points.length; i += 3) {
      const a = run.points[i], b = run.points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < 1) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const right = { x: mid.x + dy / length * 1.5, y: mid.y - dx / length * 1.5 }, left = { x: mid.x - dy / length * 1.5, y: mid.y + dx / length * 1.5 };
      assert.ok(!CITY.land.some(piece => inPiece(right, piece)) && CITY.land.some(piece => inPiece(left, piece)), 'water on the right of a shore');
    }
  }
});

test('the island ends at the promenade outside the ring road', () => {
  const ring = ringRoad(new Vector(-1200, -900), new Vector(2400, 1800), { noise: (x, y) => Math.sin(x * 3.1) * Math.cos(y * 2.3) });
  const outline = islandOutline(ring, 17);
  for (const p of ring) {
    assert.ok(insidePolygon(p, outline), 'ring inside the shore');
    assert.ok(Math.abs(distanceToPolyline(p, [...outline, outline[0]]) - 17) < 1, 'shore a promenade beyond the ring');
  }
  const n = outline.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    assert.equal(segmentIntersection(outline[i], outline[(i + 1) % n], outline[j], outline[(j + 1) % n]), null, 'shore crosses itself');
  }
  // In the generated city every stretch of the ring road has its promenade before the water
  for (const road of CITY.roads.filter(road => road.kind === 'ring')) for (const p of road.points) {
    if (nearEdge(p, CITY.riverWater, 30)) continue;
    const q = { x: p.x, y: p.y };
    assert.ok(!waterAt(q.y, q.x), 'ring road over the sea');
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

test('a coast round an inlet, leaving by the shore it came in by, takes no strip off that shore', () => {
  // (seed 639546082: the line from one end of the coast to the other ran
  // along the north shore, a little inland of it, and carried on west it cut
  // off the ring road and its promenade, which became a bridge)
  const island = [[-1000, -800], [1000, -800], [1000, 800], [-1000, 800]].map(([x, y]) => new Vector(x, y));
  const line = [[1060, 900], [900, 700], [700, 300], [500, 100], [300, 300], [400, 700], [520, 860]].map(([x, y]) => new Vector(x, y));
  const bounds = { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 };
  const { land, sea } = landAndWater({ island, coast: { line, reach: 15, seaSide: -1 }, bounds });
  for (const [x, y] of [[-800, 780], [-300, 790], [100, 785], [-900, 0], [0, -700], [900, 0]]) assert.ok(land.some(piece => inPiece({ x, y }, piece)), `land at ${x},${y}`);
  for (const [x, y] of [[540, 400], [700, 790], [500, 200]]) assert.ok(sea.some(piece => inPiece({ x, y }, piece)), `inlet at ${x},${y}`);
});

test('the sea is on the side of the coast that cuts off less of the city, however little that is', () => {
  // (seeds 248, 1959669599, 2382780353 and 117: a point 30 m off the coast
  // fell outside the domain, the sea was taken to be on the other side, and
  // the harbour took the whole island, every road a bridge)
  const origin = new Vector(-1440, -1080), size = new Vector(2880, 2160), line = points => points.map(([x, y]) => new Vector(x, y));
  const corner = line([[-1462, 1064], [-1320, 1076], [-1190, 1087]]);
  assert.equal(seaSideOf(corner, origin, size), 1, 'a corner clipped');
  assert.equal(seaSideOf(corner.slice().reverse(), origin, size), -1, 'a corner clipped, the other way');
  assert.equal(seaSideOf(line([[-1442, -195], [-1436, -60], [-1442, 66]]), origin, size), 1, 'a sliver along an edge');
  assert.equal(seaSideOf(line([[-1460, 77], [-600, 900], [0, 1070], [600, 1060], [1462, 1025]]), origin, size), 1, 'across, close to an edge in the middle');
  assert.equal(seaSideOf(line([[-1460, -300], [0, -500], [1460, -300]]), origin, size), -1, 'across the south');
});

test('a point inside a U-shaped polygon is inside it, as its centroid is not', () => {
  const u = [[0, 0], [100, 0], [100, 100], [80, 100], [80, 20], [20, 20], [20, 100], [0, 100]].map(([x, y]) => new Vector(x, y));
  const p = interiorPoint(u);
  assert.ok(insidePolygon(p, u));
  assert.ok(distanceToPolyline(p, [...u, u[0]]) > 5);
});
