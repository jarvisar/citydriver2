import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverWorld, CityChunk } from '../src/world/citydriver-world.js';
import { CITY, cityCell, CITY_CELL } from '../src/world/city.js';
import { journeyStart, ROAD_LEVEL } from '../src/world/city-route.js';

// The meshes as drawn, round the journey's start: the static streets and the
// detailed chunks, every triangle in world space with the look it is drawn in
// (material and colour). The people and the trees, which sway, are left out.
const SKIP = new Set(['residents', 'leaves', 'bark']);
function meshes() {
  // (round the start, and round the end of a bridge with footways, where the
  // waterfront's promenades, copings and footways all meet the roads)
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene), start = journeyStart(), chunks = [];
  const bridge = CITY.bridges.find(b => b.footways.length)?.points[0], centres = [cityCell(start.s, start.u), ...(bridge ? [cityCell(bridge.y, bridge.x)] : [])];
  for (const cell of centres) for (let ix = cell.ix - 1; ix <= cell.ix + 1; ix++) for (let iz = cell.iz - 1; iz <= cell.iz + 1; iz++) {
    if (!world.inCity(ix, iz) || chunks.some(chunk => chunk.ix === ix && chunk.iz === iz)) continue;
    const chunk = new CityChunk(world, ix, iz);
    chunk.group.position.set(chunk.east, 0, -chunk.start); chunk.group.updateMatrix(); scene.add(chunk.group); chunks.push(chunk);
  }
  scene.remove(world.distantGroup); scene.updateMatrixWorld(true);
  const names = new Map(Object.entries(world.materials).map(([name, material]) => [material, name.replace('merged-', '')]));
  const triangles = [], m = new THREE.Matrix4(), im = new THREE.Matrix4(), v = new THREE.Vector3(), tint = new THREE.Color(), vertex = new THREE.Color();
  scene.traverse(object => {
    const material = names.get(object.material) ?? 'other';
    if (!object.isMesh || SKIP.has(material) || /resident|walker|lens|boat/.test(object.name)) return;
    const { position, color } = object.geometry.attributes, index = object.geometry.index, count = index ? index.count : position.count;
    for (let k = 0; k < (object.isInstancedMesh ? object.count : 1); k++) {
      m.copy(object.matrixWorld);
      if (object.isInstancedMesh) { object.getMatrixAt(k, im); m.multiply(im); }
      if (object.isInstancedMesh && object.instanceColor) object.getColorAt(k, tint); else tint.set(1, 1, 1);
      for (let t = 0; t < count; t += 3) {
        const points = [0, 1, 2].map(j => v.fromBufferAttribute(position, index ? index.getX(t + j) : t + j).applyMatrix4(m).toArray());
        const first = index ? index.getX(t) : t;
        if (color) tint.multiply(vertex.setRGB(color.getX(first), color.getY(first), color.getZ(first)));
        triangles.push({ points, look: `${material}:${tint.getHexString()}`, source: object.name });
        if (color) object.isInstancedMesh && object.instanceColor ? object.getColorAt(k, tint) : tint.set(1, 1, 1);
      }
    }
  });
  world.dispose();
  return { chunks, triangles };
}
const { chunks, triangles } = meshes();
const HASH = 2, key = (x, z) => Math.floor(x / HASH) * 100003 + Math.floor(z / HASH);
const hashed = list => {
  const map = new Map();
  for (const t of list) {
    const xs = t.points.map(p => p[0]), zs = t.points.map(p => p[2]);
    // (only the cells of the chunks looked at: the sea is one face)
    for (const c of chunks) {
      const x0 = Math.max(Math.min(...xs), c.east), x1 = Math.min(Math.max(...xs), c.east + CITY_CELL), z0 = Math.max(Math.min(...zs), -c.start - CITY_CELL), z1 = Math.min(Math.max(...zs), -c.start);
      if (x0 > x1 || z0 > z1) continue;
      for (let hx = Math.floor(x0 / HASH); hx <= Math.floor(x1 / HASH); hx++) for (let hz = Math.floor(z0 / HASH); hz <= Math.floor(z1 / HASH); hz++) {
        const k = hx * 100003 + hz; if (!map.has(k)) map.set(k, []); const list = map.get(k); if (list.at(-1) !== t) list.push(t);
      }
    }
  }
  return map;
};
// (a face counts wherever it overlaps a chunk, however far its corners reach:
// a bridge's deck can be one long face)
const overChunks = t => {
  const xs = t.points.map(p => p[0]), ss = t.points.map(p => -p[2]);
  return chunks.some(c => Math.max(...xs) >= c.east && Math.min(...xs) < c.east + CITY_CELL && Math.max(...ss) >= c.start && Math.min(...ss) < c.start + CITY_CELL);
};
const normal = t => {
  const [a, b, c] = t.points.map(p => new THREE.Vector3(...p));
  return b.sub(a).cross(c.sub(a)).normalize();
};
const flat = triangles.filter(t => Math.abs(t.points[0][1] - t.points[1][1]) < 1e-4 && Math.abs(t.points[0][1] - t.points[2][1]) < 1e-4 && overChunks(t) &&
  // (faces looking up; the streets' ground is drawn from both sides)
  (normal(t).y > .99 || (normal(t).y < -.99 && /^citydriver-(ground|roads|paths|walls)$/.test(t.source))));
const walls = triangles.filter(t => /^citydriver-(ground|walls)$/.test(t.source) && Math.abs(normal(t).y) < .02 && overChunks(t));
const flatHash = hashed(flat);
// The flat faces over a point, highest first
function surfacesAt(x, z) {
  const out = [];
  for (const t of flatHash.get(key(x, z)) ?? []) {
    const [[ax, , az], [bx, , bz], [cx, , cz]] = t.points, d = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bx - x) * (cz - z) - (bz - z) * (cx - x)) / d, l2 = ((cx - x) * (az - z) - (cz - z) * (ax - x)) / d;
    if (l1 >= -1e-7 && l2 >= -1e-7 && 1 - l1 - l2 >= -1e-7) out.push({ y: t.points[0][1], look: t.look, source: t.source });
  }
  return out.sort((a, b) => b.y - a.y);
}

test('no two surfaces of different looks share a plane, so nothing z-fights', () => {
  const fights = new Map();
  for (const chunk of chunks) for (let x = chunk.east + .13; x < chunk.east + CITY_CELL; x += .5) for (let s = chunk.start + .17; s < chunk.start + CITY_CELL; s += .5) {
    const [top, ...under] = surfacesAt(x, -s);
    const rival = top && under.find(other => top.y - other.y < .004 && other.look !== top.look);
    if (rival) fights.set(`${top.source}/${top.look} ~ ${rival.source}/${rival.look}`, [+x.toFixed(1), +s.toFixed(1), +(top.y - ROAD_LEVEL).toFixed(3)]);
  }
  assert.deepEqual([...fights], [], 'coplanar faces of different looks (where)');
});

test('a kerb, a coping or a wall never stands up on its own in the road', () => {
  const fins = [];
  for (const t of walls) {
    const ys = t.points.map(p => p[1]), top = Math.max(...ys), edge = t.points.filter(p => Math.abs(p[1] - top) < 1e-4);
    if (edge.length !== 2) continue;
    const [a, b] = edge, length = Math.hypot(b[0] - a[0], b[2] - a[2]), n = normal(t);
    for (let d = .5; d < length; d += 1) {
      const x = a[0] + (b[0] - a[0]) * d / length, z = a[2] + (b[2] - a[2]) * d / length;
      const front = surfacesAt(x + n.x * .06, z + n.z * .06)[0], back = surfacesAt(x - n.x * .06, z - n.z * .06)[0];
      if (front && back && front.y < top - .012 && back.y < top - .012) { fins.push([t.source, t.look, +x.toFixed(1), +(-z).toFixed(1)]); break; }
    }
  }
  assert.deepEqual(fins, [], 'walls standing clear of the ground on both sides');
});
