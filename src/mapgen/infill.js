import Vector from './vector.js';
import { insidePolygon, segmentIntersection, splitPolygonByPolyline } from './polygon-util.js';
import { deepestPoint } from './park-paths.js';
import { RoadIndex } from './road-index.js';
import { filletPolyline } from './road-network.js';
import { simplify } from './simplify.js';

// Streets through blocks too big for one. MapGenerator seeds its minor
// streamlines a separation apart, but where they fan out or one stops short
// it leaves a gap twice as wide, and the block there is a ring of houses
// round a yard the size of a park. Each such block gets the street the
// streamlines missed: from its deepest point along the tensor field both
// ways, as a streamline would have run, to the streets either side, placed
// where it meets them square and clear of their junctions, and splitting the
// block into halves as even as it can.
//
// roads: the finished network. faces(roads): the blocks it makes, as
// polygons between the centre lines. directions(p): the field's two
// directions at p (major, minor; zero vectors where it has none).
// canPlace(p): whether a street may pass through p. Returns the roads with
// the new streets (kind `kind`, marked `infill`).
export function infillStreets(roads, { faces, directions, canPlace = () => true, maxDepth = 60, least = 28, clear = 24, minAngle = .8,
  step = 4, offsets = [0, -10, 10, -20, 20], snap = 16, radius = 35, overshoot = .6, depth: most = 3, kind = 'minor' } = {}) {
  const added = [], indices = [new RoadIndex(roads), null];
  // Each block, and each half of one it splits, as deep as `most` splits
  const split = (polygon, level) => {
      // No circle deeper than twice the area over the perimeter fits a
      // convex shape, and blocks are nearly convex: most need no closer look
      if (breadth(polygon) <= maxDepth || !deeperThan(polygon, maxDepth)) return;
      const deep = deepestPoint(polygon);
      if (!deep || deep.distance <= maxDepth) return;
      const candidates = [];
      for (let family = 0; family < 2; family++) {
        const along = directions(deep.point)[family];
        if (along.length() < 1e-6) continue;
        const across = new Vector(-along.y, along.x);
        for (const offset of offsets) {
          const start = deep.point.clone().add(across.clone().multiplyScalar(offset));
          if (!insidePolygon(start, polygon)) continue;
          const street = trace(start, along, family, polygon, { directions, step });
          if (!street) continue;
          // Each end meets its street nearly square, clear of every other road,
          // or carries on a street that meets it from the far side
          let ok = true;
          for (const atStart of [true, false]) {
            const line = atStart ? street.points.slice().reverse() : street.points;
            const end = endOn(line, indices, polygon, { clear, minAngle, snap });
            if (!end) { ok = false; break; }
            street.points = atStart ? end.reverse() : end;
          }
          if (!ok) continue;
          // and leaves two halves that are each a block
          const halves = splitPolygonByPolyline(polygon, street.points);
          if (halves.length !== 2) continue;
          const depth = Math.min(...halves.map(breadth));
          if (depth < least) continue;
          candidates.push({ score: depth - Math.abs(offset) * .25, points: street.points, halves });
        }
      }
      // The most even split whose street can be built and leaves two real blocks
      const best = candidates.sort((a, b) => b.score - a.score).find(c => c.points.slice(1, -1).every(canPlace) && c.halves.every(half => deeperThan(half, least, 4)));
      if (!best) return;
      const points = filletPolyline(simplify(best.points, 1), radius);
      // Carried just across the streets it ends on, so the graph joins them
      const a = points[0], b = points[1], c = points[points.length - 1], d = points[points.length - 2];
      points.unshift(a.clone().add(a.clone().sub(b).setLength(overshoot)));
      points.push(c.clone().add(c.clone().sub(d).setLength(overshoot)));
      added.push({ kind, points, infill: true });
      indices[1] = new RoadIndex(added);
      if (level + 1 < most) for (const half of best.halves) split(half, level + 1);
  };
  for (const polygon of faces(roads)) split(polygon, 0);
  return added.length ? roads.concat(added) : roads;
}

// Whether a circle deeper than `depth` fits inside the polygon, near enough:
// a grid of points `step` apart, each given up on at the first edge nearer
// than it could be to the deepest point
function deeperThan(polygon, depth, step = 8) {
  const n = polygon.length, near = depth - step * .75;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  for (let x = minX + depth * .9; x <= maxX - depth * .9; x += step) for (let y = minY + depth * .9; y <= maxY - depth * .9; y += step) {
    let deep = true;
    for (let i = 0; i < n && deep; i++) {
      const a = polygon[i], b = polygon[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
      if (Math.hypot(x - a.x - dx * t, y - a.y - dy * t) < near) deep = false;
    }
    if (deep && insidePolygon({ x, y }, polygon)) return true;
  }
  return false;
}

// Twice the area over the perimeter: the depth of the deepest circle in a
// convex shape at most, and about it in a block
function breadth(polygon) {
  let area = 0, perimeter = 0;
  for (let i = 0, n = polygon.length; i < n; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n];
    area += a.x * b.y - b.x * a.y; perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return perimeter > 0 ? Math.abs(area) / perimeter : 0;
}

// A streamline from `start` both ways along the field's `family` direction
// until it leaves the polygon, as { points } from one crossing to the other
function trace(start, along, family, polygon, { directions, step, most = 400 }) {
  const half = sign => {
    const out = [];
    let p = start.clone(), heading = along.clone().multiplyScalar(sign);
    for (let i = 0; i < most; i++) {
      let next = directions(p)[family];
      if (next.length() < 1e-6) next = heading.clone();
      if (next.x * heading.x + next.y * heading.y < 0) next.multiplyScalar(-1);
      const q = p.clone().add(next.clone().multiplyScalar(step));
      const hit = crossing(p, q, polygon);
      if (hit) { out.push(hit); return out; }
      out.push(q); p = q; heading = next;
    }
    return null;
  };
  const forward = half(1), backward = half(-1);
  if (!forward || !backward) return null;
  return { points: [...backward.reverse(), start.clone(), ...forward] };
}

// Where a segment first leaves the polygon
function crossing(a, b, polygon) {
  let best = null, bestDistance = Infinity;
  for (let i = 0, n = polygon.length; i < n; i++) {
    const hit = segmentIntersection(a, b, polygon[i], polygon[(i + 1) % n]);
    if (hit && hit.distanceTo(a) < bestDistance) { bestDistance = hit.distanceTo(a); best = hit; }
  }
  return best ? new Vector(best.x, best.y) : null;
}

// How a new street (line, running to its end) meets the road it ends on:
// the line as it is if it meets it no more askew than minAngle with no other
// road's centre line within `clear` of its end (a junction it would crowd);
// its last stretch swung onto a junction within `snap` where one other
// street meets the road from the far side, so the two make a crossroads; or
// null.
function endOn(line, indices, polygon, { clear, minAngle, snap, swing = 30 }) {
  const end = line[line.length - 1], inner = line[line.length - 2];
  const hostOf = p => indices.filter(Boolean).map(index => index.nearest(p.x, p.y, 2)).filter(Boolean).sort((a, b) => a.distance - b.distance)[0];
  const host = hostOf(end);
  if (!host) return null;
  const square = (from, to) => { const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1; return Math.abs(dx / length * host.ty - dy / length * host.tx) >= Math.sin(minAngle); };
  const others = new Map();
  for (const index of indices) index?.each(end.x, end.y, Math.max(clear, snap + 8), (segment, distance) => {
    if (segment.road === host.road || segment.road.kind === 'path') return;
    if (!others.has(segment.road) || others.get(segment.road).distance > distance) others.set(segment.road, { segment, distance });
  });
  const crowding = [...others.values()].filter(other => other.distance < clear);
  if (!crowding.length) return square(inner, end) ? line : null;
  if (crowding.length > 1) return null;
  // Where the one street near the end meets the road it ends on: a junction
  // on the far side of the road, not a corner of the block
  const road = crowding[0].segment.road;
  let junction = null;
  for (const p of road.points) {
    const on = hostOf(p);
    if (on && on.road === host.road && on.distance < 1 && p.distanceTo(end) < snap && (!junction || p.distanceTo(end) < junction.distanceTo(end))) junction = p;
  }
  if (!junction || road.points.some(p => p.distanceTo(junction) < clear && p.distanceTo(junction) > 1.5 && insidePolygon(p, polygon))) return null;
  // The last stretch bent onto it, fading in over `swing` metres
  const shift = junction.clone().sub(end), out = line.map(p => p.clone());
  let travelled = 0;
  for (let i = out.length - 1; i > 0 && travelled < swing; i--) {
    out[i].add(shift.clone().multiplyScalar(1 - travelled / swing));
    travelled += line[i].distanceTo(line[i - 1]);
  }
  return square(out[out.length - 2], out[out.length - 1]) ? out : null;
}
