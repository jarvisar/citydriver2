import test from 'node:test';
import assert from 'node:assert/strict';
import { addSurfacePolygon } from '../src/world/city-surfaces.js';

// The triangles a chunk's surface batch was given, back on the map
function surfaceTriangles(points) {
  const c = { east: 0, start: 0, batches: new Map(), materials: { solid: {} } };
  addSurfacePolygon(c, points, 24, .06, '#7f9a5e');
  return c.batches.get('surface-solid').items.map(({ frame: f }) => [[f.u, f.s], [f.u + f.eu, f.s + f.es], [f.u + f.nu, f.s + f.ns]]);
}
const area = t => ((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0])) / 2;
const inside = ([x, s], polygon) => {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, si] = polygon[i], [xj, sj] = polygon[j];
    if ((si > s) !== (sj > s) && x < (xj - xi) * (s - si) / (sj - si) + xi) result = !result;
  }
  return result;
};

test('a lawn or paving laid on a concave lot covers the lot and nothing beyond it', () => {
  // An L-shaped corner lot, from each of its corners and either way round
  const lot = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
  const turns = lot.map((p, i) => [...lot.slice(i), ...lot.slice(0, i)]);
  for (const polygon of [...turns, ...turns.map(ring => ring.slice().reverse())]) {
    const triangles = surfaceTriangles(polygon);
    let total = 0;
    for (const t of triangles) {
      assert.ok(area(t) > 0, 'every triangle faces up');
      const centre = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
      assert.ok(inside(centre, lot), `a triangle outside the lot at ${centre.map(v => v.toFixed(1))}`);
      total += area(t);
    }
    assert.ok(Math.abs(total - 500) < 1e-6, `the lot's 500 m² covered once (${total})`);
  }
  // A convex one is still a plain fan
  assert.equal(surfaceTriangles([[0, 0], [8, 0], [8, 5], [0, 5]]).length, 2);
});

test('a surface cut into tiles keeps every face in its order, each tile compact and the wide faces together', async () => {
  const { Surface } = await import('../src/world/surface.js');
  const surface = new Surface();
  for (let x = -500; x < 500; x += 37) for (let y = -300; y < 300; y += 41) surface.polygon([{ x, y }, { x: x + 5, y }, { x: x + 5, y: y + 5 }, { x, y: y + 5 }], 24, x > 0 ? '#778899' : '#99aa77');
  surface.flat({ x: -900, y: 0 }, { x: 900, y: 0 }, { x: 0, y: 20 }, 24.1, '#445566');
  const faces = geometry => {
    const { position, normal, color } = geometry.attributes, out = [];
    for (let i = 0; i < position.count; i += 3) out.push([position, normal, color].map(a => Array.from(a.array.slice(i * 3, i * 3 + 9))).join());
    return out;
  };
  const whole = faces(surface.build()), order = new Map(whole.map((face, i) => [face, i])), tiles = surface.tiles(200);
  assert.ok(tiles.length > 10);
  assert.deepEqual(tiles.flatMap(faces).sort(), whole.slice().sort());
  for (const tile of tiles) {
    const indices = faces(tile).map(face => order.get(face));
    assert.deepEqual(indices, indices.slice().sort((a, b) => a - b), 'faces keep the order they were drawn in');
  }
  for (const tile of tiles.slice(0, -1)) assert.ok(tile.boundingSphere.radius < 200, `a tile ${tile.boundingSphere.radius.toFixed(0)} m across`);
  assert.equal(tiles.at(-1).attributes.position.count, 3, 'the face wider than a tile is on its own');
});
