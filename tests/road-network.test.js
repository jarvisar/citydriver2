import test from 'node:test';
import assert from 'node:assert/strict';
import Vector from '../src/mapgen/vector.js';
import Graph from '../src/mapgen/graph.js';
import { generateCityMap, carriagewayScore } from '../src/mapgen/generate.js';
import { filletPolyline, clipInside, cleanNetwork, pruneNetwork } from '../src/mapgen/road-network.js';
import { frontageLots, chamferAcute } from '../src/mapgen/lots.js';
import { offsetPolygonMapped, removeLoops, offsetPolyline, calcPolygonArea, isSimple, insidePolygon, signedArea, polygonCentroid } from '../src/mapgen/polygon-util.js';
import { mulberry32 } from '../src/mapgen/random.js';

const v = (x, y) => new Vector(x, y);
const heading = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const turn = (a, b, c) => { const d = heading(b, c) - heading(a, b); return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); };

test('a filleted polyline keeps its ends and turns in small steps round an arc', () => {
  const line = [v(0, 0), v(100, 0), v(100, 100)];
  const round = filletPolyline(line, 30);
  assert.deepEqual([round[0].x, round[0].y], [0, 0]);
  assert.deepEqual([round.at(-1).x, round.at(-1).y], [100, 100]);
  for (let i = 1; i < round.length - 1; i++) assert.ok(turn(round[i - 1], round[i], round[i + 1]) < .2, 'no sharp kink left');
  // The arc is tangent to both legs: it starts on the first and ends on the second
  assert.ok(round.some(p => Math.abs(p.y) < 1e-9 && p.x > 60 && p.x < 75));
  assert.ok(round.some(p => Math.abs(p.x - 100) < 1e-9 && p.y > 25 && p.y < 40));
});

test('clipping keeps the runs inside a polygon, carried just across its edge', () => {
  const square = [v(0, 0), v(100, 0), v(100, 100), v(0, 100)];
  const runs = clipInside([v(-50, 50), v(150, 50)], square, .6);
  assert.equal(runs.length, 1);
  assert.ok(Math.abs(runs[0][0].x + .6) < 1e-9 && Math.abs(runs[0].at(-1).x - 100.6) < 1e-9);
  assert.deepEqual(clipInside([v(-50, 50), v(-10, 50)], square), []);
});

test('the network cleaner trims overshoots, joins a dead end to the next street and drops orphans', () => {
  const roads = [
    { kind: 'major', points: [v(0, 0), v(200, 0)] },
    { kind: 'major', points: [v(0, 100), v(200, 100)] },
    // Crosses the lower street and overshoots it by 8 m
    { kind: 'minor', points: [v(50, 108), v(50, -8)] },
    // Stops 30 m short of the upper street
    { kind: 'minor', points: [v(150, 0 - 4), v(150, 70)] },
    // Touches nothing at all
    { kind: 'minor', points: [v(400, 400), v(450, 400)] },
  ];
  const clean = pruneNetwork(cleanNetwork(roads), { Graph });
  const cross = clean.find(r => r.kind === 'minor' && Math.abs(r.points[0].x - 50) < 1e-6);
  assert.ok(cross && Math.min(...cross.points.map(p => p.y)) > -1 && Math.max(...cross.points.map(p => p.y)) < 101, 'overshoots trimmed');
  const joined = clean.find(r => r.kind === 'minor' && Math.abs(r.points[0].x - 150) < 1e-6);
  assert.ok(joined && Math.max(...joined.points.map(p => p.y)) >= 100, 'dead end carried on to the next street');
  assert.ok(!clean.some(r => r.points[0].x >= 400), 'the orphan is gone');
  // The streets' own loose ends beyond the last crossing are cut back to it
  for (const street of clean.filter(r => r.kind === 'major')) {
    assert.ok(Math.abs(Math.min(...street.points.map(p => p.x)) - 49.4) < 1e-6 && Math.abs(Math.max(...street.points.map(p => p.x)) - 150.6) < 1e-6);
  }
  const graph = new Graph(clean.map(r => r.points), 4, false);
  for (const node of graph.nodes.filter(n => n.neighbors.size === 1)) assert.ok(node.value.distanceTo([...node.neighbors][0].value) < 1, 'only overshoots dangle');
});

test('offsets map each vertex to where it went, and loops on the inside of tight bends are cut out', () => {
  const square = [v(0, 0), v(100, 0), v(100, 100), v(0, 100)];
  const mapped = offsetPolygonMapped(square, -10);
  assert.deepEqual(mapped.source, [0, 1, 2, 3]);
  assert.ok(Math.abs(calcPolygonArea(mapped.points) - 6400) < 1e-6);
  // A short edge collapses; both its ends map to the same point
  const notch = [v(0, 0), v(100, 0), v(100, 50), v(98, 52), v(96, 50), v(96, 100), v(0, 100)];
  const collapsed = offsetPolygonMapped(notch, -8);
  assert.ok(collapsed && collapsed.points.length < notch.length && collapsed.source.every(k => k >= 0 && k < collapsed.points.length));
  // Offsetting a hairpin by more than its radius makes a loop; it is removed
  const hairpin = Array.from({ length: 30 }, (_, i) => v(Math.cos(i / 29 * Math.PI) * 10, Math.sin(i / 29 * Math.PI) * 10));
  const inner = removeLoops(offsetPolyline(hairpin, 20));
  for (let i = 0; i < inner.length - 1; i++) for (let j = i + 2; j < inner.length - 1; j++) {
    const a = inner[i], b = inner[i + 1], c = inner[j], d = inner[j + 1];
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    assert.ok(!(cross(a, b, c) * cross(a, b, d) < -1e-9 && cross(c, d, a) * cross(c, d, b) < -1e-9), 'no self-crossing');
  }
});

test('frontage lots tile a block exactly, square to the street, and wrap its corners', () => {
  for (const block of [
    [v(0, 0), v(120, 0), v(120, 80), v(0, 80)],
    [v(0, 0), v(140, 0), v(140, 60), v(70, 60), v(70, 120), v(0, 120)],
    [v(0, 0), v(130, 10), v(110, 95), v(-10, 80)],
  ]) {
    const result = frontageLots(block, { depth: 20, frontage: [12, 18], corner: [8, 12] }, mulberry32(3));
    assert.ok(result, 'the block takes a strip of lots');
    const total = result.lots.reduce((sum, lot) => sum + lot.area, 0) + calcPolygonArea(result.yard);
    assert.ok(Math.abs(total - calcPolygonArea(block)) < 1, `tiles exactly (${total} of ${calcPolygonArea(block)})`);
    for (const lot of result.lots) {
      assert.ok(isSimple(lot.polygon) && signedArea(lot.polygon) > 0);
      assert.equal(lot.edges.length, lot.polygon.length);
      assert.ok(lot.edges.includes('street'), 'every lot fronts the street');
    }
    // Along a straight side the dividing walls are square to the street
    const plain = result.lots.filter(lot => lot.edges.join() === 'street,side,rear,side');
    assert.ok(plain.length > 3);
    for (const lot of plain) {
      const [a, b, , d] = lot.polygon, sx = b.x - a.x, sy = b.y - a.y, wx = d.x - a.x, wy = d.y - a.y;
      assert.ok(Math.abs(sx * wx + sy * wy) / (Math.hypot(sx, sy) * Math.hypot(wx, wy)) < .05, 'square to the street');
    }
  }
  // A block too thin for a strip says so
  assert.equal(frontageLots([v(0, 0), v(100, 0), v(100, 12), v(0, 12)], { depth: 20 }), null);
});

test('a sharp block corner is cut off as a small plaza', () => {
  const wedge = [v(0, 0), v(160, 0), v(0, 30)];
  const cut = chamferAcute(wedge);
  assert.ok(cut.length === 4 && calcPolygonArea(cut) < calcPolygonArea(wedge));
  const angles = cut.map((p, i) => Math.PI - turn(cut[(i - 1 + cut.length) % cut.length], p, cut[(i + 1) % cut.length]));
  assert.ok(Math.min(...angles) > .6, 'no corner sharper than about 35 degrees remains');
});

for (const seed of [4817, 42, 2024]) test(`generated city ${seed}: a closed network with no dead ends, and lots clear of roads and of each other`, () => {
  const city = generateCityMap({ seed });
  assert.ok(city.ring && city.roads.some(road => road.kind === 'ring'));
  // One connected network
  const graph = new Graph(city.roads.map(road => road.points), 4, false), seen = new Set([graph.nodes[0]]), queue = [graph.nodes[0]];
  while (queue.length) for (const next of queue.pop().neighbors) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  assert.equal(seen.size, graph.nodes.length, 'every road is reachable');
  // Dead ends are only the few centimetres a road runs past the one it meets
  for (const node of graph.nodes.filter(n => n.neighbors.size === 1)) {
    const [next] = node.neighbors;
    assert.ok(node.value.distanceTo(next.value) < 1, `dead end at ${node.value.x.toFixed(0)},${node.value.y.toFixed(0)}`);
  }
  // A carriageway ends square across its road's ends
  const clear = p => { const hit = city.roadIndex.nearest(p.x, p.y, 25, carriagewayScore); return hit ? hit.score : Infinity; };
  const byBlock = new Map();
  city.lots.forEach((lot, i) => {
    assert.ok(lot.every(p => clear(p) > 2.5), 'a lot keeps its pavement');
    assert.ok(!insidePolygon(polygonCentroid(lot), city.sea));
    if (!byBlock.has(city.lotBlocks[i])) byBlock.set(city.lotBlocks[i], 0);
    byBlock.set(city.lotBlocks[i], byBlock.get(city.lotBlocks[i]) + calcPolygonArea(lot));
  });
  // A block's lots never add up to more than the block
  for (const [block, area] of byBlock) assert.ok(area <= calcPolygonArea(city.blocks[block].inner) * 1.005 + 1, `lots overlap in block ${block}`);
  for (const block of city.blocks) if (block.sidewalk.length) assert.ok(block.sidewalk.every(p => clear(p) > -.8), 'a kerb never reaches onto a carriageway');
});
