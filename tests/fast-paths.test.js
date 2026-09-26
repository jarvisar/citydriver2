import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import Vector from '../src/mapgen/vector.js';
import Tensor from '../src/mapgen/tensor.js';
import { Grid } from '../src/mapgen/basis-field.js';
import { RoadIndex } from '../src/mapgen/road-index.js';
import { deepestPoint } from '../src/mapgen/park-paths.js';
import { mulberry32 } from '../src/mapgen/random.js';
import { insidePolygon, insideIndexed, polygonBounds, calcPolygonArea, offsetPolygon } from '../src/mapgen/polygon-util.js';
import { intersection } from '../src/mapgen/booleans.js';
import { Surface, setColor } from '../src/world/surface.js';
import { CITY } from '../src/world/city.js';
import { wallHasOutlook } from '../src/world/city-buildings.js';

// The city is built through a few shortcuts: indexes, caches and early
// exits. Each must give exactly the answer of the plain computation it
// stands in for, which the same city for the same seed depends on.

// A jagged ring of n points, with runs of level edges and repeated heights
const jaggedRing = (n, random) => Array.from({ length: n }, (_, i) => {
  const angle = i / n * Math.PI * 2, radius = 200 + random() * 150 * (i % 7 === 0 ? 0 : 1);
  return new Vector(Math.round(Math.cos(angle) * radius), i % 5 === 0 ? Math.round(Math.sin(angle) * 20) * 10 : Math.sin(angle) * radius);
});

test('a banded ring answers insidePolygon\'s way for every point, on its edges and corners too', () => {
  const random = mulberry32(7);
  for (const n of [12, 48, 300, 1500]) {
    const ring = jaggedRing(n, random), b = polygonBounds(ring), points = [];
    for (let k = 0; k < 4000; k++) points.push({ x: b.minX - 20 + random() * (b.maxX - b.minX + 40), y: b.minY - 20 + random() * (b.maxY - b.minY + 40) });
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      points.push(p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, { x: p.x - 1, y: p.y }, { x: p.x + 1e-9, y: q.y });
    }
    points.push({ x: 0, y: b.minY }, { x: 0, y: b.maxY }, { x: 0, y: NaN }, { x: NaN, y: 0 });
    for (const p of points) assert.equal(insideIndexed(p, ring), insidePolygon(p, ring), `${n} points, (${p.x}, ${p.y})`);
  }
});

test('the road index visits every segment within reach once, however its queries nest', () => {
  const random = mulberry32(11), roads = [];
  for (let r = 0; r < 60; r++) {
    const points = [new Vector(random() * 800 - 400, random() * 800 - 400)];
    for (let i = 0; i < 12; i++) points.push(points.at(-1).clone().add(new Vector(random() * 60 - 30, random() * 60 - 30)));
    roads.push({ points });
  }
  const index = new RoadIndex(roads);
  // (every segment, by the index's own distance)
  const within = (x, y, radius) => index.segments.map(segment => {
    let t = ((x - segment.ax) * segment.dx + (y - segment.ay) * segment.dy) / (segment.length * segment.length);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return [segment, Math.hypot(x - segment.ax - segment.dx * t, y - segment.ay - segment.dy * t)];
  }).filter(([, distance]) => distance <= radius);
  const visits = (x, y, radius, inner = null) => {
    const seen = [];
    index.each(x, y, radius, (segment, distance) => { seen.push([segment, distance]); inner?.(); });
    return seen;
  };
  for (let k = 0; k < 300; k++) {
    const x = random() * 900 - 450, y = random() * 900 - 450, radius = 5 + random() * 60, expected = within(x, y, radius);
    const plain = visits(x, y, radius);
    assert.equal(new Set(plain.map(([segment]) => segment)).size, plain.length, 'no segment twice');
    assert.deepEqual(new Map(plain), new Map(expected));
    // (a query inside a visit leaves the outer one's answer as it was)
    const nested = visits(x, y, radius, () => assert.deepEqual(new Map(visits(y, x, radius)), new Map(within(y, x, radius))));
    assert.deepEqual(nested, plain);
  }
  // A segment exactly the radius away is within it
  const level = new RoadIndex([{ points: [new Vector(0, 0), new Vector(10, 0)] }]);
  let found = 0;
  level.each(5, 7, 7, () => found++);
  assert.equal(found, 1);
});

// Surface as it was, face by face into plain arrays
function plainSurface(faces) {
  const positions = [], normals = [], colors = [], color = new THREE.Color();
  for (const [ax, ay, az, bx, by, bz, cx, cy, cz, value] of faces) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1; nx /= length; ny /= length; nz /= length;
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const { r, g, b } = color.set(value);
    for (let i = 0; i < 3; i++) { normals.push(nx, ny, nz); colors.push(r, g, b); }
  }
  return { positions, normals, colors };
}

test('a surface kept in blocks builds and tiles the same faces as one kept face by face', () => {
  const random = mulberry32(5), palette = ['#6f6c64', '#a4a69b', 0x839b9e, new THREE.Color(.2, .4, .6), 'rgb(120, 90, 60)'], faces = [];
  for (let k = 0; k < 70000; k++) {
    const x = random() * 3000 - 1500, z = random() * 3000 - 1500, size = random() < .02 ? 200 : 3;
    faces.push([x, random() * 20, z, x + random() * size, random() * 20, z + random() * size, x - random() * size, random() * 20, z + random() * size, palette[k % palette.length]]);
  }
  const surface = new Surface();
  for (const face of faces) surface.face(...face);
  const plain = plainSurface(faces), built = surface.build();
  assert.deepEqual(built.attributes.position.array, new Float32Array(plain.positions));
  assert.deepEqual(built.attributes.normal.array, new Float32Array(plain.normals));
  assert.deepEqual(built.attributes.color.array, new Float32Array(plain.colors));
  // The tiles: each face goes by where its middle falls, a wide one with the wide
  const size = 480, tiles = new Map(), wide = [];
  for (let face = 0; face < faces.length; face++) {
    const p = plain.positions, o = face * 9, xs = [p[o], p[o + 3], p[o + 6]], zs = [p[o + 2], p[o + 5], p[o + 8]];
    if (Math.max(...xs) - Math.min(...xs) > size / 4 || Math.max(...zs) - Math.min(...zs) > size / 4) { wide.push(face); continue; }
    const key = `${Math.floor((xs[0] + xs[1] + xs[2]) / 3 / size)},${Math.floor((zs[0] + zs[1] + zs[2]) / 3 / size)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(face);
  }
  const expected = [...tiles.values(), wide].filter(list => list.length), made = surface.tiles(size);
  assert.equal(made.length, expected.length);
  made.forEach((geometry, t) => {
    for (const [name, values] of [['position', plain.positions], ['normal', plain.normals], ['color', plain.colors]]) {
      assert.deepEqual(geometry.attributes[name].array, new Float32Array(expected[t].flatMap(face => values.slice(face * 9, face * 9 + 9))), `${name} of tile ${t}`);
    }
  });
});

test('setColor sets what Color.set would, and leaves the colour be for a string it can\'t read', () => {
  for (const value of ['#abc', '#a1b2c3', 'red', 'rgb(10, 20, 30)', 'hsl(120, 50%, 40%)', 0x336699, new THREE.Color(.1, .2, .3)]) {
    for (let twice = 0; twice < 2; twice++) assert.deepEqual(setColor(new THREE.Color(), value).toArray(), new THREE.Color().set(value).toArray(), String(value));
  }
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (let twice = 0; twice < 2; twice++) assert.deepEqual(setColor(new THREE.Color(.5, .25, .125), 'no such colour').toArray(), [.5, .25, .125]);
  } finally { console.warn = warn; }
});

// deepestPoint as it was: every point inside measured against every edge
function deepestPlain(polygon) {
  const edgeDistance = p => {
    let best = Infinity;
    for (let i = 0, n = polygon.length; i < n; i++) {
      const a = polygon[i], b = polygon[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
    }
    return best;
  };
  const b = polygonBounds(polygon);
  let best = null, bestDistance = -1, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, w = b.maxX - b.minX, h = b.maxY - b.minY;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i <= 18; i++) for (let j = 0; j <= 18; j++) {
      const p = new Vector(cx - w / 2 + w * i / 18, cy - h / 2 + h * j / 18);
      if (!insidePolygon(p, polygon)) continue;
      const d = edgeDistance(p);
      if (d > bestDistance) { bestDistance = d; best = p; }
    }
    if (!best) break;
    cx = best.x; cy = best.y; w /= 5; h /= 5;
  }
  return best ? { point: best, distance: bestDistance } : null;
}

test('the deepest point of a block is the one a search of every edge finds', () => {
  const random = mulberry32(3), shapes = [jaggedRing(40, random), jaggedRing(200, random), [new Vector(0, 0), new Vector(90, 0), new Vector(90, 20), new Vector(20, 20), new Vector(20, 70), new Vector(0, 70)]];
  shapes.push(...CITY.blocks.slice(0, 120).map(block => block.polygon));
  for (const shape of shapes) assert.deepEqual(deepestPoint(shape), deepestPlain(shape));
});

test('a wall looks out over its lot the same as by the booleans alone', () => {
  // wallHasOutlook as it was
  const plain = (ring, i, neighbours) => {
    const a = ring[i], b = ring[(i + 1) % ring.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 3.2) return false;
    const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length, at = (along, out) => ({ x: a.x + tx * along + ty * out, y: a.y + ty * along - tx * out });
    const strip = [at(.6, .05), at(length - .6, .05), at(length - .6, 3), at(.6, 3)], bounds = polygonBounds(strip);
    return [ring, ...neighbours].every(polygon => {
      const other = polygonBounds(polygon);
      if (other.maxX < bounds.minX || other.minX > bounds.maxX || other.maxY < bounds.minY || other.minY > bounds.maxY) return true;
      return !intersection([strip], [polygon]).some(piece => calcPolygonArea(piece.outer) > .01);
    });
  };
  const byBlock = new Map();
  CITY.lots.forEach((lot, index) => { const block = CITY.lotBlocks[index]; if (!byBlock.has(block)) byBlock.set(block, []); byBlock.get(block).push(lot); });
  let walls = 0, open = 0;
  for (const lots of [...byBlock.values()].slice(0, 40)) {
    for (const lot of lots) {
      const neighbours = lots.filter(other => other !== lot);
      // (the lot itself, its edges against its neighbours, and a footprint stepped in from it)
      for (const ring of [lot, offsetPolygon(lot, -1.5)].filter(ring => ring.length >= 3)) {
        for (let i = 0; i < ring.length; i++) { const has = wallHasOutlook(ring, i, neighbours); assert.equal(has, plain(ring, i, neighbours)); walls++; open += has; }
      }
    }
  }
  assert.ok(walls > 500 && open > 0 && open < walls, `${open} of ${walls} walls look out`);
});

test('a tensor\'s angle, worked out when first asked for, is the one it had when made', () => {
  const random = mulberry32(9);
  for (let k = 0; k < 200; k++) {
    const r = random() < .1 ? 0 : random() * 3, matrix = [random() * 2 - 1, random() * 2 - 1];
    assert.equal(new Tensor(r, matrix.slice()).theta, r === 0 ? 0 : Math.atan2(matrix[1] / r, matrix[0] / r) / 2);
    const grid = new Grid(new Vector(0, 0), 100, 1, random() * Math.PI);
    for (let twice = 0; twice < 2; twice++) assert.deepEqual(grid.getTensor().matrix, [Math.cos(2 * grid._theta), Math.sin(2 * grid._theta)]);
  }
});
