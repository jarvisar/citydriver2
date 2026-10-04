import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverWorld, CityChunk } from '../src/world/citydriver-world.js';
import { CITY, cityCell, CITY_CELL, cityStyleDistrict } from '../src/world/city.js';
import { journeyStart, ROAD_LEVEL, PAVEMENT_LEVEL } from '../src/world/city-route.js';

// The meshes as drawn, round the journey's start: the static streets and the
// detailed chunks, every triangle in world space with the look it is drawn in
// (material and color). The people and the trees, which sway, are left out.
const SKIP = new Set(['residents', 'leaves', 'bark']);
function meshes() {
  // (round the start, and round the end of a bridge with footways, where the
  // waterfront's promenades, copings and footways all meet the roads; and the
  // cells of the civic and garden quarters with the most lots, their front
  // gardens walled and hedged, and of a park, its walks meeting its curb)
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene), start = journeyStart(), chunks = [];
  const bridge = CITY.bridges.find(b => b.footways.length)?.points[0], centres = [cityCell(start.s, start.u), ...(bridge ? [cityCell(bridge.y, bridge.x)] : [])];
  const busiest = district => [...world.lotsByChunk].map(([key, lots]) => [key, lots.filter(lot => cityStyleDistrict(lot.centre.y, lot.centre.x) === district).length])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  const park = CITY.blocks.find(block => block.park && block.kerb.length >= 3)?.kerb[0];
  const cells = [...['Civic quarter', 'Garden quarter'].map(busiest).filter(best => best?.[1] > 0).map(([key]) => { const [ix, iz] = key.split(',').map(Number); return { ix, iz }; }),
    ...(park ? [cityCell(park.y, park.x)] : [])];
  for (const cell of [...centres, ...cells]) for (let ix = cell.ix - 1; ix <= cell.ix + 1; ix++) for (let iz = cell.iz - 1; iz <= cell.iz + 1; iz++) {
    if (!centres.includes(cell) && (ix !== cell.ix || iz !== cell.iz)) continue;
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

test('a curb, a coping or a wall never stands up on its own in the road', () => {
  const fins = [];
  for (const t of walls) {
    const ys = t.points.map(p => p[1]), top = Math.max(...ys), edge = t.points.filter(p => Math.abs(p[1] - top) < 1e-4);
    if (edge.length !== 2) continue;
    const [a, b] = edge, length = Math.hypot(b[0] - a[0], b[2] - a[2]), n = normal(t);
    for (let d = .5; d < length; d += 1) {
      const x = a[0] + (b[0] - a[0]) * d / length, z = a[2] + (b[2] - a[2]) * d / length;
      // (only where the ground either side was built: a street's curb runs on
      // past the chunks looked at, and beside it there a block's paving isn't)
      if (!chunks.some(c => x >= c.east + .1 && x < c.east + CITY_CELL - .1 && -z >= c.start + .1 && -z < c.start + CITY_CELL - .1)) continue;
      const front = surfacesAt(x + n.x * .06, z + n.z * .06)[0], back = surfacesAt(x - n.x * .06, z - n.z * .06)[0];
      if (front && back && front.y < top - .012 && back.y < top - .012) { fins.push([t.source, t.look, +x.toFixed(1), +(-z).toFixed(1)]); break; }
    }
  }
  assert.deepEqual(fins, [], 'walls standing clear of the ground on both sides');
});

// The upright faces of what is built (not the furniture, the cars or glass)
const FIXED = /^(solid|ground|road):/;
const uprights = triangles.filter(t => FIXED.test(t.look) && Math.abs(normal(t).y) < .02 && overChunks(t)).map(t => ({ ...t, n: normal(t) }));
const uprightHash = hashed(uprights);
// Whether an upright face crosses the level segment p-q (x, z) at height y
function faceAcross(px, pz, qx, qz, y) {
  for (const t of new Set([...uprightHash.get(key(px, pz)) ?? [], ...uprightHash.get(key(qx, qz)) ?? []])) {
    const [a, b, c] = t.points, { n } = t, d0 = (px - a[0]) * n.x + (pz - a[2]) * n.z, d1 = (qx - a[0]) * n.x + (qz - a[2]) * n.z;
    if (d0 * d1 > 0 || d0 === d1) continue;
    const f = d0 / (d0 - d1), along = [(px + (qx - px) * f) * -n.z + (pz + (qz - pz) * f) * n.x, y];
    const [A, B, C] = [a, b, c].map(p => [p[0] * -n.z + p[2] * n.x, p[1]]), den = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((B[0] - along[0]) * (C[1] - along[1]) - (B[1] - along[1]) * (C[0] - along[0])) / den, l2 = ((C[0] - along[0]) * (A[1] - along[1]) - (C[1] - along[1]) * (A[0] - along[0])) / den;
    if (l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6) return true;
  }
  return false;
}
const ground = (x, z) => surfacesAt(x, z).filter(s => FIXED.test(s.look));
const inside = (x, z, margin = .5) => chunks.some(c => x >= c.east + margin && x < c.east + CITY_CELL - margin && -z >= c.start + margin && -z < c.start + CITY_CELL - margin);
// The edges of the flat faces a filter picks that no other face at their
// level shares, each with the way out from its face, every half meter
function outlines(filter) {
  const edges = new Map(), q = v => Math.round(v * 500);
  for (const t of flat) {
    if (!filter(t) || normal(t).y < 0) continue;
    for (let i = 0; i < 3; i++) {
      const a = t.points[i], b = t.points[(i + 1) % 3], ka = `${q(a[0])},${q(a[2])}`, kb = `${q(b[0])},${q(b[2])}`;
      const k = `${ka < kb ? ka + kb : kb + ka},${q(a[1])}`;
      edges.set(k, edges.has(k) ? null : { a, b, c: t.points[(i + 2) % 3], t });
    }
  }
  const samples = [];
  for (const edge of edges.values()) {
    if (!edge) continue;
    const { a, b, c, t } = edge, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (length < .1) continue;
    let nx = (b[2] - a[2]) / length, nz = -(b[0] - a[0]) / length;
    if ((c[0] - a[0]) * nx + (c[2] - a[2]) * nz > 0) { nx = -nx; nz = -nz; }
    for (let d = Math.min(.25, length / 2); d < length; d += .5) {
      const x = a[0] + (b[0] - a[0]) * d / length, z = a[2] + (b[2] - a[2]) * d / length;
      if (inside(x, z)) samples.push({ x, z, nx, nz, y: a[1], t });
    }
  }
  return samples;
}

test('paving, lawns and walks raised on the ground have faces down their edges', () => {
  // (a thin slab is only its top: without a face down its edge it reads as a
  // sheet hovering over a slit; a step of a centimeter or two is left be)
  const open = [];
  for (const { x, z, nx, nz, y, t } of outlines(t => FIXED.test(t.look) && t.points[0][1] > PAVEMENT_LEVEL + .029 && t.points[0][1] < PAVEMENT_LEVEL + .151)) {
    const out = ground(x + nx * .012, z + nz * .012), below = out.find(s => s.y < y - .004);
    if (!below || out.some(s => s.y >= y - .004 && s.y < y + .5) || y - below.y < .03) continue;
    if (!faceAcross(x - nx * .015, z - nz * .015, x + nx * .015, z + nz * .015, (y + below.y) / 2)) open.push([t.source, t.look, +x.toFixed(1), +(-z).toFixed(1), +(y - below.y).toFixed(3)]);
  }
  assert.deepEqual(open.slice(0, 12), [], `${open.length} slab edges with nothing under them (where, drop)`);
});

test('a facade\'s frames, steps and walls come down to the ground in front of them', () => {
  const hanging = [];
  for (const t of uprights) {
    const ys = t.points.map(p => p[1]), bottom = Math.min(...ys), edge = t.points.filter(p => Math.abs(p[1] - bottom) < 1e-4);
    if (edge.length !== 2 || bottom > PAVEMENT_LEVEL + .5 || bottom < PAVEMENT_LEVEL - .03) continue;
    const [a, b] = edge, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    for (let d = Math.min(.25, length / 2); d < length; d += .75) {
      const x = a[0] + (b[0] - a[0]) * d / length, z = a[2] + (b[2] - a[2]) * d / length;
      if (!inside(x, z)) continue;
      const front = ground(x + t.n.x * .02, z + t.n.z * .02);
      // (unless something in front covers its foot, or it stands on another face)
      if (front.some(s => s.y > bottom - .004 && s.y < bottom + .6)) continue;
      const under = front.find(s => s.y <= bottom), gap = under ? bottom - under.y : 0;
      if (gap < .012 || gap > .1 || faceAcross(x - t.n.x * .03, z - t.n.z * .03, x + t.n.x * .03, z + t.n.z * .03, bottom - Math.min(.006, gap / 2))) continue;
      hanging.push([t.source, t.look, +x.toFixed(1), +(-z).toFixed(1), +gap.toFixed(3)]);
      break;
    }
  }
  assert.deepEqual(hanging.slice(0, 12), [], `${hanging.length} faces hanging just over the ground (where, gap)`);
});

test('a civic quarter\'s low stone walls run on from lot to lot without a notch', () => {
  // (the coping along their tops: no narrow drop to the lawn between two of them)
  const notches = [];
  for (const { x, z, nx, nz, y } of outlines(t => t.look === 'solid:e0d6bf')) {
    const below = ground(x + nx * .012, z + nz * .012)[0];
    if (!below || below.y > y - .01) continue;
    const across = [.03, .06, .1, .15].map(w => ground(x + nx * w, z + nz * w).find(s => s.y < y + .3)).find(s => s && s.y >= y - .004);
    if (across) notches.push([+x.toFixed(1), +(-z).toFixed(1)]);
  }
  assert.deepEqual(notches.slice(0, 12), [], `${notches.length} gaps between wall copings (where)`);
});
