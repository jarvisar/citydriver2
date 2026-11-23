import * as THREE from 'three';
import { seededRandom } from './route.js';
import { cityAffinePoint } from './city-layout-render.js';
import { polygonEdges, edgesContain, signedArea } from './city-surfaces.js';

// Three tapered, leaning blades: twelve opaque triangles, shared city material.
// Solid facets read from every camera angle without alpha textures or animation.
const positions = [], colors = [];
const face = (a, b, c, tint) => {
  positions.push(...a, ...b, ...c);
  for (let i = 0; i < 3; i++) colors.push(tint, tint, tint);
};
for (const [x, z, height, leanX, leanZ, tint] of [
  [-.19, .02, .64, -.22, .08, .83], [.03, -.1, .86, .13, -.12, 1], [.19, .13, .53, .23, .17, .91],
]) {
  const a = [x - .12, 0, z + .07], b = [x + .12, 0, z + .07], c = [x, 0, z - .1];
  const tip = [x + leanX, height, z + leanZ];
  face(a, b, tip, tint); face(b, c, tip, tint); face(c, a, tip, tint); face(c, b, a, tint);
}
export const grassGeometry = new THREE.BufferGeometry();
grassGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
grassGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
grassGeometry.computeVertexNormals();
export const MAX_GRASS_TUFTS = 64;
// and on the parks', squares' and islands' lawns, placed with the furniture
export const MAX_LAWN_TUFTS = 320;

export function grassArea(c, polygon, color, y) {
  if (c.distant) return;
  c.grassAreas ??= [];
  c.grassAreas.push({ polygon, color, y });
}

// Yield after about this many point checks (lawns, obstacles and tufts so far
// per tuft tried). A cell full of lawns took up to 8 ms in one step.
const FRINGE_CHECKS = 3000;
// Run after colliders are mapped, so a shifted building or a rigid deck on a
// curved block protects its actual footprint. Grass never changes collision.
export function* buildGrassFringeSteps(c) {
  if (c.distant || !c.grassAreas?.length) return;
  // (`taken`: the tufts so far, u then s)
  const random = seededRandom(c.plan.seed ^ 0x36f91b27), candidates = [], taken = [];
  const obstacles = [], margins = [];
  const protect = (polygon, margin = .7) => {
    // Test offset half-planes directly: clipping an existing polygon against
    // outward edges cannot expand it, and silently loses the clearance margin.
    // (Each as its edges, worked out once for all the points asked of it.)
    if (polygon.length >= 3) { obstacles.push(polygonEdges(polygon)); margins.push(margin); }
  };
  let hull = null;
  for (const collider of c.features.colliders) {
    // (a footprint in pieces, one after another: its whole outline once, hollows and all, as when it was one collider)
    if (collider.hull) { if (collider.hull !== hull) protect(hull = collider.hull); }
    else if (collider.corners) protect(collider.corners.map(p => [p.x, -p.z]));
    else protect([[collider.x - collider.reach, -collider.z - collider.reach], [collider.x + collider.reach, -collider.z - collider.reach],
      [collider.x + collider.reach, -collider.z + collider.reach], [collider.x - collider.reach, -collider.z + collider.reach]]);
  }
  // Setback aprons and small seating pads need not be recorded as walks.
  // Respect their rendered ground triangles too, including shifted lot edges.
  const lawnHeight = Math.min(...c.grassAreas.map(area => area.y)), lawnColours = new Set(c.grassAreas.map(area => area.color));
  for (const item of c.batches.get('surface-solid')?.items ?? []) {
    if (item.p[1] + item.scale[1] / 2 < lawnHeight + .005 || lawnColours.has(item.color)) continue;
    const f = item.frame;
    protect([[f.u, f.s], [f.u + f.eu, f.s + f.es], [f.u + f.nu, f.s + f.ns]], .65);
  }
  for (const bench of c.batches.get('bench')?.items ?? []) {
    const p = cityAffinePoint(c.start - bench.p[2], c.east + bench.p[0], bench.anchor, bench.frame);
    protect([[p.u - 2.7, p.s - 2.7], [p.u + 2.7, p.s - 2.7], [p.u + 2.7, p.s + 2.7], [p.u - 2.7, p.s + 2.7]], 0);
  }
  const scatterEdge = (a, b, offset, spacing, chance) => {
    const dx = b[0] - a[0], ds = b[1] - a[1], length = Math.hypot(dx, ds);
    const count = Math.max(1, Math.floor(length / spacing));
    for (let i = 0; i < count; i++) {
      if (random() > chance) continue;
      const t = (i + .2 + random() * .6) / count, inset = offset + random() * .65;
      candidates.push([a[0] + dx * t - ds / length * inset, a[1] + ds * t + dx / length * inset]);
    }
  };
  for (const area of c.grassAreas) {
    const polygon = signedArea(area.polygon) < 0 ? [...area.polygon].reverse() : area.polygon;
    for (let i = 0; i < polygon.length; i++) scatterEdge(polygon[i], polygon[(i + 1) % polygon.length], 1.15, 5, .8);
  }
  // Mix the border candidates before applying a strict per-block budget.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const tint = new THREE.Color(), areas = c.grassAreas, lawns = areas.map(area => polygonEdges(area.polygon));
  let checks = 0;
  for (const center of candidates) {
    if (checks > FRINGE_CHECKS) { checks = 0; yield; }
    const count = random() < .55 ? 2 : 1;
    for (let i = 0; i < count && taken.length < MAX_GRASS_TUFTS * 2; i++) {
      checks += areas.length + obstacles.length + taken.length / 2;
      const x = center[0] + (i ? .8 + random() * .4 : 0), s = center[1] + (i ? (random() - .5) * 1.3 : 0);
      let lawn = 0;
      while (lawn < lawns.length && !edgesContain(lawns[lawn], x, s, .9)) lawn++;
      if (lawn === lawns.length) continue;
      const area = areas[lawn], u = c.east + x, v = c.start + s;
      let clear = true;
      for (let k = 0; clear && k < obstacles.length; k++) clear = !edgesContain(obstacles[k], u, v, -margins[k]);
      // (within .85 m of another tuft: by a square root, and by Math.hypot where its last bit could tell)
      for (let k = 0; clear && k < taken.length; k += 2) {
        const du = u - taken[k], dv = v - taken[k + 1], apart = du * du + dv * dv;
        clear = !(apart < .7224 || (apart <= .7226 && Math.hypot(du, dv) < .85));
      }
      if (!clear) continue;
      // A fringe in maintained city lawns, not knee-high weeds. Keep its
      // simple silhouette subordinate to the curb and the planted trees.
      const width = .65 + random() * .3, height = .4 + random() * .25;
      tint.set(area.color).multiplyScalar(.92 + random() * .35);
      c.item('grass-fringe', grassGeometry, c.materials.props, [x, area.y, -s], [width, height, width], `#${tint.getHexString()}`, random() * Math.PI * 2);
      taken.push(u, v);
    }
    if (taken.length === MAX_GRASS_TUFTS * 2) break;
  }
  c.grassAreas = null;
}
