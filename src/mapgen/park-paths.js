import Vector from './vector.js';
import { insidePolygon, calcPolygonArea, polygonBounds, dedupePolygon, signedArea, segmentIntersection, polylineLength } from './polygon-util.js';
import { insetPolygon } from './booleans.js';
import { filletPolyline } from './road-network.js';

// A park laid out as a park is: a loop walk a little in from its edge,
// gates in the middle of its streets' frontages leading onto it, and walks
// from the gates across the lawn to a round plaza at its heart (or, in a big
// park, round a pond). Every walk joins the others and a street, so the
// network has no dead end, and every walk stays on the lawn.
//
// park: the face of the streets round it (their centre lines).
// halfWidthAt(a, b): the half width of the street along a face edge.
// junctionNear(p, road, reach): whether a road other than `road` comes
//   within `reach` of p: where a gate would crowd a junction.
// streetAt(p): the nearest street's centre-line point { x, y, road }.
// Returns { paths: [polyline], plaza, pond, lawn, loop, gates }: each gate
// where a walk leaves its street, with the street's centre-line point there.
export const PARK_PATH = { overshoot: .6, step: 4 };

const v = (x, y) => new Vector(x, y);

// Distance from p to the nearest edge of a closed polygon (or, once it is no
// more than `least`, some distance no more than that)
function edgeDistance(p, polygon, least = -Infinity) {
  let best = Infinity;
  for (let i = 0, n = polygon.length; i < n && best > least; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
  }
  return best;
}

// The point deepest inside a polygon (its pole of inaccessibility), by a
// coarse grid refined twice round the best cell
export function deepestPoint(polygon) {
  const b = polygonBounds(polygon);
  let best = null, bestDistance = -1, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, w = b.maxX - b.minX, h = b.maxY - b.minY;
  for (let pass = 0; pass < 3; pass++) {
    const steps = 18;
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
      // (a point no deeper than the best so far is given up on at its first
      // edge that near)
      const p = v(cx - w / 2 + w * i / steps, cy - h / 2 + h * j / steps), d = edgeDistance(p, polygon, bestDistance);
      if (d > bestDistance && insidePolygon(p, polygon)) { bestDistance = d; best = p; }
    }
    if (!best) break;
    cx = best.x; cy = best.y; w /= 5; h /= 5;
  }
  return best ? { point: best, distance: bestDistance } : null;
}

// Points every `step` along a closed ring, with the distance round it
function around(ring, step) {
  const out = [], n = ring.length;
  let travelled = 0, next = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], length = a.distanceTo(b);
    if (length < 1e-9) continue;
    while (next <= travelled + length) {
      const t = (next - travelled) / length;
      out.push({ p: v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), tx: (b.x - a.x) / length, ty: (b.y - a.y) / length, d: next });
      next += step;
    }
    travelled += length;
  }
  return { points: out, perimeter: travelled };
}

// A closed ring as a polyline, gently wobbled and rounded: the park's loop walk
function looseLoop(ring, random, { step = 22, wobble = 4, radius = 30 } = {}) {
  const { points } = around(ring, step);
  if (points.length < 6) return null;
  const phase = random() * Math.PI * 2, phase2 = random() * Math.PI * 2, count = points.length;
  // Anticlockwise, so (ty, -tx) points out of the ring
  const wobbled = points.map(({ p, tx, ty }, k) => {
    const w = wobble * (.65 * Math.sin(k / count * Math.PI * 2 * 3 + phase) + .35 * Math.sin(k / count * Math.PI * 2 * 7 + phase2));
    return v(p.x + ty * w, p.y - tx * w);
  });
  const closed = [...wobbled, wobbled[0].clone()];
  return filletPolyline(closed, radius);
}

// A blob: a circle whose radius swells and narrows, for a pond
function blob(centre, radius, random, count = 28) {
  const a = random() * Math.PI * 2, b = random() * Math.PI * 2, out = [];
  for (let k = 0; k < count; k++) {
    const t = k / count * Math.PI * 2, r = radius * (1 + .16 * Math.sin(t * 2 + a) + .08 * Math.sin(t * 3 + b));
    out.push(v(centre.x + Math.cos(t) * r, centre.y + Math.sin(t) * r));
  }
  return out;
}
const closedRing = ring => [...ring.map(p => p.clone()), ring[0].clone()];

// Cubic Bézier samples from a to b, leaving a along da and arriving along db
function sweep(a, da, b, db, bend, step) {
  const chord = a.distanceTo(b), handle = chord * .36;
  // A sideways bow so the walk curves rather than runs dead straight
  const nx = -(b.y - a.y) / (chord || 1), ny = (b.x - a.x) / (chord || 1);
  const c1 = v(a.x + da.x * handle + nx * bend * chord, a.y + da.y * handle + ny * bend * chord);
  const c2 = v(b.x - db.x * handle + nx * bend * chord, b.y - db.y * handle + ny * bend * chord);
  const count = Math.max(4, Math.ceil(chord / step)), out = [];
  for (let k = 0; k <= count; k++) {
    const t = k / count, u = 1 - t;
    out.push(v(u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y));
  }
  return out;
}

export function parkLayout(park, { halfWidthAt, sidewalk = 4.2, junctionNear, streetAt, random, pathHalfWidth = 3.6 }) {
  const empty = { paths: [], plaza: null, pond: null, lawn: [], loop: null };
  let polygon = dedupePolygon(park);
  if (polygon.length < 3) return empty;
  if (signedArea(polygon) < 0) polygon = polygon.slice().reverse();
  // The lawn: inside the streets and the park's own pavement
  const lawn = insetPolygon(polygon, (a, b) => -(halfWidthAt(a, b) + sidewalk));
  const area = lawn.length >= 3 ? calcPolygonArea(lawn) : 0;
  if (area < 2500) return { ...empty, lawn };
  const deep = deepestPoint(lawn);
  if (!deep || deep.distance < 18) return { ...empty, lawn };
  const centre = deep.point, room = deep.distance;
  // The plaza, or a pond with a walk round it in a big park
  const pondy = area > 45000 && room > 70 && random() < .6;
  let pond = null, ring;
  if (pondy) {
    const radius = Math.min(42, room * .38);
    pond = blob(centre, radius, random);
    ring = insetPolygon(pond, 7.5);
    if (ring.length < 3) { pond = null; ring = null; }
  }
  const plazaRadius = Math.max(8, Math.min(13, room * .2));
  if (!ring) ring = Array.from({ length: 20 }, (_, k) => v(centre.x + Math.cos(k / 20 * Math.PI * 2) * plazaRadius, centre.y + Math.sin(k / 20 * Math.PI * 2) * plazaRadius));
  const ringRadius = Math.max(...ring.map(p => p.distanceTo(centre)));
  // The loop walk, far enough in to leave a lawn outside it and room inside
  const inset = Math.max(10, Math.min(19, Math.sqrt(area) * .05));
  let loop = null;
  if (room - inset > ringRadius + 26) {
    const inner = insetPolygon(lawn, -inset);
    if (inner.length >= 3 && calcPolygonArea(inner) > 6000) {
      const b = polygonBounds(inner), radius = Math.min(38, Math.min(b.maxX - b.minX, b.maxY - b.minY) * .28);
      loop = looseLoop(inner, random, { radius, wobble: Math.min(4, inset * .3) });
      // It must stay on the lawn and clear of the plaza
      if (loop && (loop.some(p => !insidePolygon(p, lawn) || edgeDistance(p, lawn) < pathHalfWidth + 1.5) || loop.some(p => p.distanceTo(centre) < ringRadius + 12))) loop = null;
    }
  }
  // Gates: on the street frontages, spread round the park, clear of junctions
  // and of the park's corners
  const { points: edge, perimeter } = around(lawn, 4);
  const wanted = Math.max(2, Math.min(6, Math.round(perimeter / 240)));
  const candidates = edge.map(({ p, tx, ty, d }, k) => {
    const street = streetAt(p);
    if (!street) return null;
    // A corner: the edge turns sharply within a few metres either side
    const before = edge[(k - 5 + edge.length) % edge.length], after = edge[(k + 5) % edge.length];
    const straight = before.tx * after.tx + before.ty * after.ty > .88 && before.tx * tx + before.ty * ty > .95;
    return { p, d, street, straight, tx, ty };
  }).filter(Boolean);
  const pick = clearance => {
    const gates = [], phase = random();
    for (let k = 0; k < wanted; k++) {
      const middle = ((k + phase) / wanted) * perimeter, span = perimeter / wanted / 2;
      let best = null, bestScore = Infinity;
      for (const c of candidates) {
        const offset = Math.abs(((c.d - middle + perimeter * 1.5) % perimeter) - perimeter / 2);
        if (offset > span * .9 || !c.straight || junctionNear(c.street, c.street.road, clearance)) continue;
        if (gates.some(g => g.p.distanceTo(c.p) < 60)) continue;
        if (offset < bestScore) { bestScore = offset; best = c; }
      }
      if (best) gates.push(best);
    }
    return gates;
  };
  let gates = pick(34);
  if (!gates.length) gates = pick(22);
  if (!gates.length) return { ...empty, lawn };
  const paths = [], used = [];
  const overshoot = PARK_PATH.overshoot, step = PARK_PATH.step;
  const onLawn = points => points.every(p => insidePolygon(p, lawn) && edgeDistance(p, lawn) > pathHalfWidth);
  for (const gate of gates) {
    const s = v(gate.street.x, gate.street.y), g = gate.p, inward = g.clone().sub(s);
    if (inward.length() < 1) continue;
    inward.normalize();
    // In from the street, across its pavement to the lawn's edge and a few metres on
    const entry = [s.clone().sub(inward.clone().multiplyScalar(overshoot)), s, g.clone().add(inward.clone().multiplyScalar(pathHalfWidth + 2))];
    const from = entry[entry.length - 1];
    // Toward the plaza: where the ring faces the gate
    const toward = from.clone().sub(centre).normalize();
    let target = null, bestDot = -Infinity;
    for (const p of ring) { const d = p.clone().sub(centre).normalize(), dot = d.x * toward.x + d.y * toward.y; if (dot > bestDot) { bestDot = dot; target = p; } }
    const arrive = centre.clone().sub(target).normalize();
    let walk = null;
    for (const bend of [(random() - .5) * .28, 0]) {
      const curve = sweep(from, inward, target, arrive, bend, step);
      if (onLawn(curve.slice(1, -1))) { walk = curve; break; }
    }
    if (walk) {
      paths.push([...entry.slice(0, -1), ...walk, target.clone().add(arrive.clone().multiplyScalar(overshoot))]);
      used.push(gate);
    } else if (loop) {
      // No clear way to the middle: the gate leads onto the loop and stops there
      let near = null, nearDistance = Infinity;
      for (const p of loop) { const d = p.distanceTo(from); if (d < nearDistance) { nearDistance = d; near = p; } }
      const onto = near.clone().sub(from), length = onto.length();
      if (length < 1) continue;
      paths.push([...entry, near.clone().add(onto.multiplyScalar(overshoot / length))]);
      used.push(gate);
    }
  }
  if (!paths.length) return { ...empty, lawn };
  // A loop no gate reaches would be an island: only keep one that some walk crosses
  const crosses = (a, b) => {
    for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) if (segmentIntersection(a[i], a[i + 1], b[j], b[j + 1], 1e-6)) return true;
    return false;
  };
  const ringPath = closedRing(ring);
  const reachesRing = paths.some(path => crosses(path, ringPath));
  if (reachesRing) paths.push(ringPath);
  if (loop && paths.some(path => path !== ringPath && crosses(path, loop))) paths.push(loop);
  else loop = null;
  const plaza = reachesRing ? { x: centre.x, y: centre.y, radius: pond ? 0 : plazaRadius, kind: pond ? 'pond' : random() < .6 ? 'fountain' : 'bandstand' } : null;
  return { paths: paths.map(path => path.filter((p, i) => !i || p.distanceTo(path[i - 1]) > 1e-3)), plaza, pond: reachesRing ? pond : null, lawn, loop, gates: used.map(g => ({ x: g.p.x, y: g.p.y, street: { x: g.street.x, y: g.street.y }, profile: g.street.road.profile })), length: paths.reduce((sum, path) => sum + polylineLength(path), 0) };
}
