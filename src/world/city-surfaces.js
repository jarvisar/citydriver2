import * as THREE from 'three';
import { compactGeometry } from './compact-geometry.js';

// The generated city has no layout warp: an address is its own position.
const cityLayout = (s, u) => ({ s, u });

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
export const SURFACE_STEP = 14;
const EPS = 1e-8;
export const signedArea = points => points.reduce((sum, a, i) => {
  const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - a[1] * b[0];
}, 0) / 2;

export function clipPolygon(points, axis, edge, greater) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const insideA = greater ? a[axis] >= edge : a[axis] <= edge;
    const insideB = greater ? b[axis] >= edge : b[axis] <= edge;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = (edge - a[axis]) / (b[axis] - a[axis]);
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; p[axis] = edge; result.push(p);
    }
  }
  return result.filter((p, i) => Math.hypot(p[0] - result[(i + 1) % result.length][0], p[1] - result[(i + 1) % result.length][1]) > EPS);
}
export function clipBounds(points, bounds) {
  let p = points;
  for (const [axis, edge, greater] of [[0, bounds[0], true], [1, bounds[1], true], [0, bounds[2], false], [1, bounds[3], false]]) p = clipPolygon(p, axis, edge, greater);
  return p;
}
function cuts(low, high) {
  const values = [low];
  for (let v = (Math.floor(low / SURFACE_STEP) + 1) * SURFACE_STEP; v < high - EPS; v += SURFACE_STEP) values.push(v);
  values.push(high); return values;
}
// Convex polygons are sufficient for rectangles and each joined ribbon panel.
// The same global lattice is used on opposite sides of every chunk seam.
export function surfacePolygons(points) {
  const xs = cuts(Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[0])));
  const ss = cuts(Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[1])));
  const pieces = [];
  for (let i = 1; i < xs.length; i++) for (let j = 1; j < ss.length; j++) {
    const polygon = clipBounds(points, [xs[i - 1], ss[j - 1], xs[i], ss[j]]);
    if (polygon.length >= 3 && Math.abs(signedArea(polygon)) > EPS) pieces.push(signedArea(polygon) < 0 ? polygon.reverse() : polygon);
  }
  return pieces;
}
// A polygon's triangles, anticlockwise: a fan across a convex polygon, and
// ear clipping for any other, whose fan would reach outside it (an L-shaped
// lot's lawn laid across the street beside it)
function triangles(ring) {
  const n = ring.length, turn = i => { const a = ring[(i + n - 1) % n], p = ring[i], b = ring[(i + 1) % n]; return (p.u - a.u) * (b.s - p.s) - (p.s - a.s) * (b.u - p.u); };
  if (ring.every((p, i) => turn(i) >= -EPS)) return Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2]);
  return THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p.u, p.s)), []).map(([i0, i1, i2]) => {
    const a = ring[i0], b = ring[i1], d = ring[i2];
    return (b.u - a.u) * (d.s - a.s) - (b.s - a.s) * (d.u - a.u) >= 0 ? [i0, i1, i2] : [i0, i2, i1];
  });
}
export function addSurfacePolygon(c, points, y, height, color, kind = 'solid') {
  const flat = height <= .08 || kind === 'water';
  const key = kind === 'road' || kind === 'water' ? kind : `surface-${kind}${flat ? '' : '-volume'}`;
  if (!c.batches.has(key)) c.batches.set(key, { geometry: flat ? surfaceTopGeometry : surfaceGeometry, material: c.materials[kind], items: [] });
  const items = c.batches.get(key).items;
  // Clip paving after mapping the curved streets: separate tessellations can
  // overlap slightly even when their logical footprints meet exactly. This is
  // construction-only work; the resulting pieces use the usual instance batch.
  c.surfaceLayers ??= new Map();
  const level = (y + height / 2).toFixed(5);
  if (!c.surfaceLayers.has(level)) c.surfaceLayers.set(level, []);
  const layer = c.surfaceLayers.get(level);
  const previousCount = layer.length;
  c.surfacePoints ??= new Map();
  const mapped = ([x, s]) => {
    const key = `${x},${s}`;
    if (!c.surfacePoints.has(key)) c.surfacePoints.set(key, cityLayout(c.start + s, c.east + x));
    return c.surfacePoints.get(key);
  };
  const x0 = Math.min(...points.map(p => p[0])), x1 = Math.max(...points.map(p => p[0]));
  const s0 = Math.min(...points.map(p => p[1])), s1 = Math.max(...points.map(p => p[1]));
  const a = mapped([x0, s0]), b = mapped([x1, s0]), d = mapped([x0, s1]);
  let affine = true;
  for (const tx of [0, .5, 1]) for (const ts of [0, .5, 1]) {
    const p = mapped([x0 + tx * (x1 - x0), s0 + ts * (s1 - s0)]);
    if (Math.hypot(p.u - a.u - (b.u - a.u) * tx - (d.u - a.u) * ts, p.s - a.s - (b.s - a.s) * tx - (d.s - a.s) * ts) > 1e-8) affine = false;
  }
  const pieces = affine && kind !== 'water' ? [signedArea(points) < 0 ? [...points].reverse() : points] : surfacePolygons(points);
  for (const polygon of pieces) {
    const world = polygon.map(mapped);
    for (const [i0, i1, i2] of triangles(world)) {
      const triangle = [world[i0], world[i1], world[i2]].map(p => [p.u - c.east, p.s - c.start]);
      if (Math.abs(signedArea(triangle)) < EPS) continue;
      const bounds = [Math.min(...triangle.map(p => p[0])), Math.min(...triangle.map(p => p[1])),
        Math.max(...triangle.map(p => p[0])), Math.max(...triangle.map(p => p[1]))];
      let visible = [triangle];
      if (kind !== 'water') {
        for (let k = 0; k < previousCount; k++) {
          const previous = layer[k];
          const b = previous.bounds;
          if (bounds[0] >= b[2] - EPS || bounds[2] <= b[0] + EPS || bounds[1] >= b[3] - EPS || bounds[3] <= b[1] + EPS) continue;
          visible = visible.flatMap(p => subtractPolygon(p, previous.points));
          if (!visible.length) break;
        }
        layer.push({ points: triangle, bounds });
      }
      for (const piece of visible) for (let j = 1; j < piece.length - 1; j++) {
        const [a, b, d] = [piece[0], piece[j], piece[j + 1]].map(([u, s]) => ({ u: u + c.east, s: s + c.start }));
        const area = Math.abs((b.u - a.u) * (d.s - a.s) - (b.s - a.s) * (d.u - a.u));
        // Microscopic clipping slivers add long, nearly coincident prism sides.
        if (area < 1e-4) continue;
        items.push({ p: [0, y, 0], scale: [1, height, 1], color, yaw: 0, roll: 0,
          ...(kind === 'water' ? { riverAddress: [polygon[0], polygon[i], polygon[i + 1]].flatMap(([x, s]) => [c.east + x, c.start + s]) } : {}),
          anchor: { u: c.east, s: c.start }, frame: { u: a.u, s: a.s, eu: b.u - a.u, es: b.s - a.s, nu: d.u - a.u, ns: d.s - a.s } });
      }
    }
  }
}
export function rectanglePolygon(x, s, width, depth, yaw = 0) {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([u, v]) => [x + u * width * cos - v * depth * sin, s + u * width * sin + v * depth * cos]);
}

export function pathPanels(input, width, bounds = [-1e9, -1e9, 1e9, 1e9], endSection = null) {
  const points = input.filter((p, i) => !i || Math.hypot(p[0] - input[i - 1][0], p[1] - input[i - 1][1]) > EPS).map(p => [...p]);
  if (points.length < 2) return [];
  const closed = Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < EPS;
  if (closed) points.pop();
  else for (const [i, next] of [[0, 1], [points.length - 1, points.length - 2]]) {
    // Extend an entrance beyond its boundary before clipping: the entire width
    // meets the sidewalk, even when the approach is diagonal.
    if (points[i].some((v, axis) => Math.abs(v - bounds[axis]) < EPS || Math.abs(v - bounds[axis + 2]) < EPS)) {
      const dx = points[i][0] - points[next][0], ds = points[i][1] - points[next][1], length = Math.hypot(dx, ds);
      points[i][0] += dx / length * width * 2; points[i][1] += ds / length * width * 2;
    }
  }
  const normals = points.map((a, i) => {
    const b = points[(i + 1) % points.length], dx = b[0] - a[0], ds = b[1] - a[1], length = Math.hypot(dx, ds);
    return [-ds / length, dx / length];
  });
  const sections = points.map((p, i) => {
    const a = !closed && i === 0 ? normals[0] : normals[(i + points.length - 1) % points.length];
    const b = !closed && i === points.length - 1 ? a : normals[i];
    const dot = Math.max(.25, 1 + a[0] * b[0] + a[1] * b[1]);
    const offset = [(a[0] + b[0]) / dot * width / 2, (a[1] + b[1]) / dot * width / 2];
    return [[p[0] + offset[0], p[1] + offset[1]], [p[0] - offset[0], p[1] - offset[1]]];
  });
  if (endSection && !closed) sections[sections.length - 1] = endSection;
  const panels = [];
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const next = (i + 1) % points.length;
    const panel = clipBounds([sections[i][1], sections[next][1], sections[next][0], sections[i][0]], bounds);
    if (panel.length >= 3 && Math.abs(signedArea(panel)) > EPS) panels.push(panel);
  }
  return panels;
}
export function distanceToPath(x, s, points) {
  let closest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, as] = points[i - 1], [bx, bs] = points[i], dx = bx - ax, ds = bs - as;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / (dx * dx + ds * ds || 1)));
    closest = Math.min(closest, Math.hypot(x - ax - t * dx, s - as - t * ds));
  }
  return closest;
}
export function offsetPath(points, distance) {
  const normals = points.slice(1).map((p, i) => {
    const dx = p[0] - points[i][0], ds = p[1] - points[i][1], length = Math.hypot(dx, ds);
    return [-ds / length, dx / length];
  });
  return points.map((p, i) => {
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(i, normals.length - 1)];
    const dot = Math.max(.25, 1 + a[0] * b[0] + a[1] * b[1]);
    return [p[0] + (a[0] + b[0]) / dot * distance, p[1] + (a[1] + b[1]) / dot * distance];
  });
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
export function insetPolygon(polygon, margin) {
  const boundary = signedArea(polygon) < 0 ? [...polygon].reverse() : polygon;
  let result = boundary;
  for (let i = 0; i < boundary.length; i++) result = edgeClip(result, boundary[i], boundary[(i + 1) % boundary.length], margin);
  return result;
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
