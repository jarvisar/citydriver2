import * as THREE from 'three';
import { compactGeometry } from './compact-geometry.js';
import { PAVEMENT_LEVEL } from './city-route.js';

// One shared triangular prism. Ground pieces share their actual corner
// positions instead of overlapping independently rotated tangent boxes.
const vertices = [0, -.5, 0, 1, -.5, 0, 0, -.5, -1, 0, .5, 0, 1, .5, 0, 0, .5, -1];
const indexed = new THREE.BufferGeometry();
indexed.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
indexed.setIndex([3, 4, 5, 2, 1, 0, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5]);
export const surfaceGeometry = indexed.toNonIndexed();
surfaceGeometry.computeVertexNormals(); indexed.dispose();
compactGeometry(surfaceGeometry);
export const surfaceTopGeometry = new THREE.BufferGeometry();
surfaceTopGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, .5, 0, 1, .5, 0, 0, .5, -1], 3));
surfaceTopGeometry.computeVertexNormals();
const EPS = 1e-8;
// How far down a thin slab's edge faces reach: just under the pavement, the
// lowest ground a lot's surfaces meet
const SLAB_FOOT = PAVEMENT_LEVEL - .005;
export const signedArea = points => points.reduce((sum, a, i) => {
  const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - a[1] * b[0];
}, 0) / 2;

// A polygon's triangles, anticlockwise: a fan across a convex polygon, and
// ear clipping for any other, whose fan would reach outside it (an L-shaped
// lot's lawn laid across the street beside it). An outline that doubles
// straight back on itself (a spike) never turns the wrong way, but is no
// more convex for that.
function triangles(ring) {
  const n = ring.length, turn = i => { const a = ring[(i + n - 1) % n], p = ring[i], b = ring[(i + 1) % n]; return (p.u - a.u) * (b.s - p.s) - (p.s - a.s) * (b.u - p.u); };
  const back = i => { const a = ring[(i + n - 1) % n], p = ring[i], b = ring[(i + 1) % n], ux = p.u - a.u, us = p.s - a.s, vx = b.u - p.u, vs = b.s - p.s; return ux * vx + us * vs < -.99 * Math.hypot(ux, us) * Math.hypot(vx, vs); };
  if (ring.every((p, i) => turn(i) >= -EPS && !back(i))) return Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2]);
  return THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p.u, p.s)), []).map(([i0, i1, i2]) => {
    const a = ring[i0], b = ring[i1], d = ring[i2];
    return (b.u - a.u) * (d.s - a.s) - (b.s - a.s) * (d.u - a.u) >= 0 ? [i0, i1, i2] : [i0, i2, i1];
  });
}
export function addSurfacePolygon(c, points, y, height, color, kind = 'solid') {
  const flat = height <= .08;
  const key = `surface-${kind}${flat ? '' : '-volume'}`;
  if (!c.batches.has(key)) c.batches.set(key, { geometry: flat ? surfaceTopGeometry : surfaceGeometry, material: c.materials[kind], items: [] });
  const items = c.batches.get(key).items;
  // Clip paving against what is already laid at its level: separate
  // tessellations can overlap slightly even when their logical footprints
  // meet exactly. This is construction-only work; the resulting pieces use
  // the usual instance batch.
  c.surfaceLayers ??= new Map();
  const level = (y + height / 2).toFixed(5);
  if (!c.surfaceLayers.has(level)) c.surfaceLayers.set(level, []);
  const layer = c.surfaceLayers.get(level);
  const previousCount = layer.length;
  c.surfacePoints ??= new Map();
  const mapped = ([x, s]) => {
    const key = `${x},${s}`;
    if (!c.surfacePoints.has(key)) c.surfacePoints.set(key, { s: c.start + s, u: c.east + x });
    return c.surfacePoints.get(key);
  };
  const polygon = signedArea(points) < 0 ? [...points].reverse() : points;
  const world = polygon.map(mapped);
  for (const [i0, i1, i2] of triangles(world)) {
    const triangle = [world[i0], world[i1], world[i2]].map(p => [p.u - c.east, p.s - c.start]);
    if (Math.abs(signedArea(triangle)) < EPS) continue;
    const bounds = [Math.min(...triangle.map(p => p[0])), Math.min(...triangle.map(p => p[1])),
      Math.max(...triangle.map(p => p[0])), Math.max(...triangle.map(p => p[1]))];
    let visible = [triangle];
    for (let k = 0; k < previousCount; k++) {
      const previous = layer[k];
      const b = previous.bounds;
      if (bounds[0] >= b[2] - EPS || bounds[2] <= b[0] + EPS || bounds[1] >= b[3] - EPS || bounds[3] <= b[1] + EPS) continue;
      visible = visible.flatMap(p => subtractPolygon(p, previous.points));
      if (!visible.length) break;
    }
    layer.push({ points: triangle, bounds });
    for (const piece of visible) for (let j = 1; j < piece.length - 1; j++) {
      const [a, b, d] = [piece[0], piece[j], piece[j + 1]].map(([u, s]) => ({ u: u + c.east, s: s + c.start }));
      const area = Math.abs((b.u - a.u) * (d.s - a.s) - (b.s - a.s) * (d.u - a.u));
      // Microscopic clipping slivers add long, nearly coincident prism sides.
      if (area < 1e-4) continue;
      items.push({ p: [0, y, 0], scale: [1, height, 1], color, yaw: 0, roll: 0,
        anchor: { u: c.east, s: c.start }, frame: { u: a.u, s: a.s, eu: b.u - a.u, es: b.s - a.s, nu: d.u - a.u, ns: d.s - a.s } });
    }
  }
  // A thin slab is only its top, and it stands a few centimetres proud of
  // the lot's ground and the pavement (a garden path, a lawn bed, paving):
  // its edge is faced once the chunk's slabs are all laid (see faceSlabEdges)
  if (flat && kind === 'solid' && !c.distant) {
    (c.slabs ??= []).push({ ring: signedArea(points) > 0 ? [...points].reverse() : points, top: y + height / 2, bottom: Math.min(y - height / 2, SLAB_FOOT), color });
  }
}
// The faces down the edges of a chunk's thin slabs, to just under the
// pavement: without them a slab reads as a sheet hovering over a slit. An
// edge under another slab's top at least as high is left open, as the top
// hides it, and so is an edge along a higher slab's (a lawn under a
// forecourt's paving), whose face would lie in the same plane and flicker.
// Of two slabs at one height with an edge along the same line (a court's
// lines where they cross) the first keeps its face.
export function faceSlabEdges(c) {
  const slabs = c.slabs ?? [];
  c.slabs = null;
  if (!slabs.length || !c.bodies) return;
  for (const [j, slab] of slabs.entries()) {
    const { ring } = slab;
    slab.index = j; slab.box = [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))];
  }
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  for (const { ring, top, bottom, color, index: k } of slabs) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], es = b[1] - a[1], length2 = ex * ex + es * es;
      if (length2 < 1e-8) continue;
      const box = [Math.min(a[0], b[0]) - 1e-3, Math.min(a[1], b[1]) - 1e-3, Math.max(a[0], b[0]) + 1e-3, Math.max(a[1], b[1]) + 1e-3];
      const covers = slabs.filter(({ top: level, index, box: other }) => index !== k && level >= top - 1e-6 && other[0] <= box[2] && other[2] >= box[0] && other[1] <= box[3] && other[3] >= box[1]);
      // Cut the edge where it meets the covering outlines, and face the stretches outside them all
      const cuts = [0, 1];
      const length = Math.sqrt(length2), along = p => ((p[0] - a[0]) * ex + (p[1] - a[1]) * es) / length2;
      const off = p => cross(p[0] - a[0], p[1] - a[1], ex, es) / length;
      for (const { ring: other } of covers) for (let j = 0; j < other.length; j++) {
        const c0 = other[j], c1 = other[(j + 1) % other.length], o0 = off(c0), o1 = off(c1);
        // (an outline's corner on the edge, within the millimetre its outline counts for, or a crossing)
        for (const [p, o] of [[c0, o0], [c1, o1]]) if (Math.abs(o) < 1e-3) cuts.push(along(p));
        if ((o0 > 1e-3 && o1 < -1e-3) || (o0 < -1e-3 && o1 > 1e-3)) {
          const f = o0 / (o0 - o1);
          cuts.push(along([c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f]));
        }
      }
      for (let j = cuts.length - 1; j >= 2; j--) if (!(cuts[j] > 0 && cuts[j] < 1)) cuts.splice(j, 1);
      cuts.sort((p, q) => p - q);
      for (let j = 0; j < cuts.length - 1; j++) {
        if (cuts[j + 1] - cuts[j] < 1e-6) continue;
        const m = (cuts[j] + cuts[j + 1]) / 2, mx = a[0] + ex * m, ms = a[1] + es * m;
        if (covers.some(({ ring: other, top: level, index }) => { const where = placeOf(other, mx, ms); return where === 'in' || (where === 'on' && (level > top + 1e-6 || index < k)); })) continue;
        const p = { x: a[0] + ex * cuts[j], y: a[1] + es * cuts[j] }, q = { x: a[0] + ex * cuts[j + 1], y: a[1] + es * cuts[j + 1] };
        c.bodies.wall([p, q], top, bottom, color);
      }
    }
  }
}
// Where a point lies against a ring: 'on' its outline (within a millimetre), 'in' it, or outside (null)
function placeOf(ring, x, s) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j], ex = b[0] - a[0], es = b[1] - a[1], length2 = ex * ex + es * es;
    const t = length2 ? Math.max(0, Math.min(1, ((x - a[0]) * ex + (s - a[1]) * es) / length2)) : 0;
    if (Math.hypot(a[0] + ex * t - x, a[1] + es * t - s) < 1e-3) return 'on';
    if ((a[1] > s) !== (b[1] > s) && x < a[0] + (s - a[1]) * ex / es) inside = !inside;
  }
  return inside ? 'in' : null;
}
export function rectanglePolygon(x, s, width, depth, yaw = 0) {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([u, v]) => [x + u * width * cos - v * depth * sin, s + u * width * sin + v * depth * cos]);
}

function edgeClip(points, a, b, inset = 0, inside = true) {
  const dx = b[0] - a[0], ds = b[1] - a[1], offset = inset * Math.hypot(dx, ds);
  const distance = p => dx * (p[1] - a[1]) - ds * (p[0] - a[0]) - offset;
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length], dp = distance(p), dq = distance(q);
    const ip = inside ? dp >= -EPS : dp <= EPS, iq = inside ? dq >= -EPS : dq <= EPS;
    if (ip) result.push(p);
    if (ip !== iq) { const t = dp / (dp - dq); result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return result.filter((p, i) => Math.hypot(p[0] - result[(i + 1) % result.length][0], p[1] - result[(i + 1) % result.length][1]) > EPS);
}
export function containsPoint(polygon, x, s, margin = 0) {
  const sign = Math.sign(signedArea(polygon));
  return polygon.length >= 3 && polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length], dx = b[0] - a[0], ds = b[1] - a[1];
    return sign * (dx * (s - a[1]) - ds * (x - a[0])) >= margin * Math.hypot(dx, ds) - EPS;
  });
}
// Subtract a convex walkway from a convex planting panel. Resulting pieces
// remain convex, so rendering and collisions can use the same footprints.
export function subtractPolygon(subject, input) {
  const clip = signedArea(input) < 0 ? [...input].reverse() : input;
  if (subject.length < 3 || clip.length < 3) return [subject];
  if (clip.some((a, i) => {
    const b = clip[(i + 1) % clip.length];
    return subject.every(p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= EPS);
  })) return [subject];
  let remaining = subject; const result = [];
  for (let i = 0; i < clip.length && remaining.length >= 3; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const outside = edgeClip(remaining, a, b, 0, false);
    if (outside.length >= 3 && Math.abs(signedArea(outside)) > EPS) result.push(outside);
    remaining = edgeClip(remaining, a, b);
  }
  return result;
}
