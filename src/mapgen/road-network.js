import Vector from './vector.js';
import { findIntersections } from './graph.js';
import { insidePolygon, segmentIntersection } from './polygon-util.js';
import { RoadIndex } from './road-index.js';

// The streamlines MapGenerator integrates are a sketch of a street network:
// their ends stop wherever the separation test or the domain edge stopped
// them, dangling ends overshoot the road they were joined to, and the domain
// edge leaves every outer block open. This turns the sketch into a network a
// city can stand on: bends are rounded, a ring road closes the city, roads
// are clipped to it, overshoots are trimmed and dead ends either reach the
// next street or are cut back to the last junction. Every later stage (the
// blocks, the lots, the junctions, the traffic) relies on it being clean.

const lengthOf = points => { let d = 0; for (let i = 1; i < points.length; i++) d += points[i].distanceTo(points[i - 1]); return d; };

// Replaces each bend of a polyline with a circular arc tangent to both of its
// segments, as large as the segments allow up to maxRadius. Straight runs stay
// straight and the ends stay put, so a road still meets what it met before.
export function filletPolyline(points, maxRadius, { minTurn = .035, arcStep = .16 } = {}) {
  if (points.length < 3 || maxRadius <= 0) return points.map(p => p.clone());
  const closed = points[0].distanceTo(points[points.length - 1]) < 1e-6;
  const n = points.length, lengths = [];
  for (let i = 0; i < n - 1; i++) lengths.push(points[i].distanceTo(points[i + 1]));
  const out = [points[0].clone()];
  const bend = i => {
    const prev = closed && i === 0 ? n - 2 : i - 1, next = closed && i === n - 1 ? 1 : i + 1;
    const p = points[i], a = points[prev], b = points[next];
    const d1 = p.clone().sub(a), d2 = b.clone().sub(p), l1 = d1.length(), l2 = d2.length();
    if (l1 < 1e-9 || l2 < 1e-9) return [p.clone()];
    d1.divideScalar(l1); d2.divideScalar(l2);
    const turn = Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y), angle = Math.abs(turn);
    if (angle < minTurn || angle > Math.PI - .05) return [p.clone()];
    const tanHalf = Math.tan(angle / 2);
    // Each segment lends at most half of itself to the arcs at its two ends
    const tangent = Math.min(maxRadius * tanHalf, .5 * l1, .5 * l2), radius = tangent / tanHalf;
    const start = p.clone().sub(d1.clone().multiplyScalar(tangent));
    const normal = turn > 0 ? new Vector(-d1.y, d1.x) : new Vector(d1.y, -d1.x);
    const centre = start.clone().add(normal.clone().multiplyScalar(radius));
    const steps = Math.max(1, Math.ceil(angle / arcStep)), arc = [];
    const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
    for (let k = 0; k <= steps; k++) {
      const angleAt = a0 + (turn > 0 ? 1 : -1) * angle * k / steps;
      arc.push(new Vector(centre.x + Math.cos(angleAt) * radius, centre.y + Math.sin(angleAt) * radius));
    }
    return arc;
  };
  for (let i = 1; i < n - 1; i++) out.push(...bend(i));
  if (closed) {
    const arc = bend(0);
    out[0] = arc[arc.length - 1];
    out.push(...arc);
  } else out.push(points[n - 1].clone());
  return dedupe(out);
}
function dedupe(points, epsilon = 1e-4) {
  const out = [];
  for (const p of points) if (!out.length || out[out.length - 1].distanceTo(p) > epsilon) out.push(p);
  return out;
}

// A closed loop round the city, a rounded rectangle inset from the domain
// edge whose sides wander a little so it does not look ruled.
export function ringRoad(origin, dimensions, { inset = 45, radius = 220, wander = 14, step = 12, noise = null } = {}) {
  const x0 = origin.x + inset, y0 = origin.y + inset, x1 = origin.x + dimensions.x - inset, y1 = origin.y + dimensions.y - inset;
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2), outline = [];
  const corners = [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= 8; k++) {
    const a = a0 + k / 8 * Math.PI / 2;
    outline.push(new Vector(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  outline.push(outline[0].clone());
  const points = [];
  for (let i = 0; i < outline.length - 1; i++) {
    const a = outline[i], b = outline[i + 1], length = a.distanceTo(b), count = Math.max(1, Math.round(length / step));
    for (let k = 0; k < count; k++) points.push(a.clone().add(b.clone().sub(a).multiplyScalar(k / count)));
  }
  // Wander inward only, so the ring never leaves the domain
  if (noise && wander > 0) {
    const cx = origin.x + dimensions.x / 2, cy = origin.y + dimensions.y / 2;
    for (const p of points) {
      const inward = new Vector(cx - p.x, cy - p.y).normalize(), offset = (noise(p.x / 420, p.y / 420) * .5 + .5) * wander;
      p.add(inward.multiplyScalar(offset));
    }
  }
  points.push(points[0].clone());
  return points;
}

// Every place two roads cross, as distances along each road. Endpoints that
// touch another road's end or run count too: that is where a road split at
// a park edge carries on as a path.
function crossings(roads) {
  const segments = [];
  const cumulative = roads.map(road => {
    const c = [0];
    for (let i = 1; i < road.points.length; i++) c.push(c[i - 1] + road.points[i].distanceTo(road.points[i - 1]));
    return c;
  });
  roads.forEach((road, r) => {
    for (let i = 0; i < road.points.length - 1; i++) segments.push({ from: road.points[i], to: road.points[i + 1], road: r, i });
  });
  const hits = roads.map(() => []);
  const along = (segment, point) => cumulative[segment.road][segment.i] + segment.from.distanceTo(point);
  for (const { point, segments: [a, b] } of findIntersections(segments)) {
    if (a.road === b.road && Math.abs(a.i - b.i) < 2) continue;
    hits[a.road].push({ d: along(a, point), point, other: b.road });
    hits[b.road].push({ d: along(b, point), point, other: a.road });
  }
  // Ends that meet another road end to end, where no segments cross
  const ends = [];
  roads.forEach((road, r) => {
    if (road.points.length < 2) return;
    ends.push({ r, p: road.points[0], d: 0 }, { r, p: road.points[road.points.length - 1], d: cumulative[r][road.points.length - 1] });
  });
  for (const a of ends) for (const b of ends) {
    if (a.r === b.r || a.p.distanceTo(b.p) > .5) continue;
    hits[a.r].push({ d: a.d, point: a.p, other: b.r, endToEnd: true });
  }
  for (const list of hits) list.sort((p, q) => p.d - q.d);
  return { hits, cumulative };
}

// The part of a polyline between two distances along it
export function slicePolyline(points, from, to) {
  const out = [];
  let travelled = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], length = a.distanceTo(b);
    const s0 = travelled, s1 = travelled + length;
    if (s1 >= from && s0 <= to && length > 1e-9) {
      const t0 = Math.max(0, (from - s0) / length), t1 = Math.min(1, (to - s0) / length);
      const p0 = a.clone().add(b.clone().sub(a).multiplyScalar(t0)), p1 = a.clone().add(b.clone().sub(a).multiplyScalar(t1));
      if (!out.length || out[out.length - 1].distanceTo(p0) > 1e-6) out.push(p0);
      if (out[out.length - 1].distanceTo(p1) > 1e-6) out.push(p1);
    }
    travelled = s1;
  }
  return out;
}

// The runs of a polyline inside a polygon (or outside it), each carried
// `overshoot` past the boundary so it still crosses the road along it. Every
// crossing counts, including a long segment that enters and leaves.
export function clipInside(points, polygon, overshoot = .6, keepInside = true) {
  const runs = [], n = polygon.length;
  const inside = p => insidePolygon(p, polygon) === keepInside;
  let run = inside(points[0]) ? [points[0].clone()] : null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], p = points[i], length = a.distanceTo(p);
    if (length < 1e-9) continue;
    const direction = p.clone().sub(a).divideScalar(length);
    // Where this segment crosses the boundary, in order along it
    const cuts = [];
    for (let k = 0; k < n; k++) {
      const hit = segmentIntersection(a, p, polygon[k], polygon[(k + 1) % n]);
      if (hit) cuts.push(hit.distanceTo(a));
    }
    cuts.sort((x, y) => x - y);
    for (const d of cuts) {
      // Just past the crossing decides which side the segment is now on
      const probe = a.clone().add(direction.clone().multiplyScalar(Math.min(length, d + 1e-4)));
      const nowIn = inside(probe), at = a.clone().add(direction.clone().multiplyScalar(d));
      if (run && !nowIn) { run.push(at.clone().add(direction.clone().multiplyScalar(overshoot))); runs.push(run); run = null; }
      else if (!run && nowIn) run = [at.clone().sub(direction.clone().multiplyScalar(overshoot))];
    }
    if (run) run.push(p.clone());
  }
  if (run && run.length > 1) runs.push(run);
  return runs.filter(r => r.length > 1 && lengthOf(r) > 1);
}

// A cell hash of segments for casting rays through the network
class SegmentGrid {
  constructor(roads, cell = 40) {
    this.cell = cell; this.cells = new Map();
    roads.forEach((road, r) => {
      for (let i = 0; i < road.points.length - 1; i++) {
        const a = road.points[i], b = road.points[i + 1], segment = { a, b, road: r, i };
        for (let cx = Math.floor(Math.min(a.x, b.x) / cell); cx <= Math.floor(Math.max(a.x, b.x) / cell); cx++) {
          for (let cy = Math.floor(Math.min(a.y, b.y) / cell); cy <= Math.floor(Math.max(a.y, b.y) / cell); cy++) {
            const key = `${cx},${cy}`;
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key).push(segment);
          }
        }
      }
    });
  }
  // The nearest road the segment from p to q crosses, ignoring `skip(segment)`
  cast(p, q, skip) {
    const seen = new Set();
    let best = null, bestDistance = Infinity;
    const steps = Math.ceil(p.distanceTo(q) / (this.cell / 2)) + 1;
    for (let k = 0; k <= steps; k++) {
      const x = p.x + (q.x - p.x) * k / steps, y = p.y + (q.y - p.y) * k / steps;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const segment of this.cells.get(`${Math.floor(x / this.cell) + dx},${Math.floor(y / this.cell) + dy}`) ?? []) {
          if (seen.has(segment)) continue;
          seen.add(segment);
          if (skip(segment)) continue;
          const hit = segmentIntersection(p, q, segment.a, segment.b);
          if (!hit) continue;
          const distance = hit.distanceTo(p);
          if (distance < bestDistance) { bestDistance = distance; best = { point: hit, segment, distance }; }
        }
      }
    }
    return best;
  }
}

// A streamline can follow the field alongside the road it set out from,
// inside that road's own carriageway. Wherever the lesser of two roads runs
// within their combined half widths of the other, nearly parallel to it, for
// more than a few metres, that stretch of it is cut out.
function unhug(roads, { fixed, halfWidthOf, step = 2, minRun = 8, maxAngle = .45 } = {}) {
  const index = new RoadIndex(roads), sin = Math.sin(maxAngle);
  const rank = road => fixed.has(road.kind) ? 9 : RANK[road.kind] ?? 1;
  return roads.flatMap((road, r) => {
    if (fixed.has(road.kind) || road.kind === 'path') return [road];
    const own = halfWidthOf(road.kind), runs = [];
    let run = null, travelled = 0;
    const points = road.points;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < 1e-9) continue;
      const tx = dx / length, ty = dy / length;
      for (let d = (step - travelled % step) % step; d <= length; d += step) {
        const x = a.x + tx * d, y = a.y + ty * d;
        let hugging = false;
        index.each(x, y, own + 12, (segment, distance) => {
          if (hugging || segment.roadIndex === r) return;
          const other = segment.road;
          if (other.kind === 'path' || rank(other) < rank(road) || (rank(other) === rank(road) && segment.roadIndex > r)) return;
          if (distance < (own + halfWidthOf(other.kind)) * .9 && Math.abs(tx * segment.dy - ty * segment.dx) / segment.length < sin) hugging = true;
        });
        const at = travelled + d;
        if (hugging) { run ??= [at, at]; run[1] = at; }
        else if (run) { if (run[1] - run[0] >= minRun) runs.push(run); run = null; }
      }
      travelled += length;
    }
    if (run && run[1] - run[0] >= minRun) runs.push(run);
    if (!runs.length) return [road];
    const pieces = [];
    let from = 0;
    for (const [a, b] of runs) { if (a - from > 1) pieces.push([from, a]); from = b; }
    if (travelled - from > 1) pieces.push([from, travelled]);
    return pieces.map(([a, b]) => ({ ...road, points: slicePolyline(points, a, b) })).filter(piece => piece.points.length > 1);
  });
}

// A streamline that hugs a road can cross it twice a few metres apart,
// leaving a sliver of street beside the road and two junctions on top of one
// another. The lesser road loses the stretch between the crossings: it
// meets the greater road at two plain junctions instead.
const RANK = { path: 0, minor: 1, major: 2, main: 3 };
function unlens(roads, { fixed, overshoot, span = 40 } = {}) {
  const { hits, cumulative } = crossings(roads), cuts = new Map();
  roads.forEach((road, r) => {
    if (fixed.has(road.kind)) return;
    const mine = hits[r];
    for (let k = 0; k + 1 < mine.length; k++) {
      const a = mine[k], b = mine[k + 1], other = roads[a.other];
      if (a.other !== b.other || a.endToEnd || b.endToEnd || b.d - a.d > span || b.d - a.d < 1e-3) continue;
      const mineRank = RANK[road.kind] ?? 1, theirRank = fixed.has(other.kind) ? 9 : RANK[other.kind] ?? 1;
      if (mineRank > theirRank || (mineRank === theirRank && a.other < r)) continue;
      if (!cuts.has(r)) cuts.set(r, []);
      cuts.get(r).push([a.d + overshoot, b.d - overshoot]);
    }
  });
  if (!cuts.size) return roads;
  return roads.flatMap((road, r) => {
    if (!cuts.has(r)) return [road];
    const length = cumulative[r][road.points.length - 1], pieces = [];
    let from = 0;
    for (const [a, b] of cuts.get(r).sort((p, q) => p[0] - q[0])) {
      if (a > from) pieces.push([from, a]);
      from = Math.max(from, b);
    }
    pieces.push([from, length]);
    return pieces.filter(([a, b]) => b - a > 1).map(([a, b]) => ({ ...road, points: slicePolyline(road.points, a, b) })).filter(piece => piece.points.length > 1);
  });
}

// A street that ends on another at a shallow angle runs inside the other's
// carriageway for metres before it joins: no junction can be laid out
// there. Such an end is cut back to the street's previous junction; a street
// with no other junction goes.
function unshallow(roads, { fixed, overshoot, stub, minAngle = .45, end = 2 } = {}) {
  const { hits, cumulative } = crossings(roads), drop = new Set(), cuts = new Map();
  const tangentAt = (points, d) => {
    const a = slicePolyline(points, 0, Math.max(1e-6, d - 4)), b = slicePolyline(points, 0, d + 4);
    return b[b.length - 1].clone().sub(a[a.length - 1]);
  };
  roads.forEach((road, r) => {
    if (fixed.has(road.kind) || road.kind === 'path') return;
    const length = cumulative[r][road.points.length - 1], mine = hits[r];
    for (const atStart of [true, false]) {
      const join = atStart ? mine[0] : mine[mine.length - 1];
      if (!join || join.endToEnd || (atStart ? join.d : length - join.d) > Math.max(end, stub)) continue;
      const other = roads[join.other], theirs = hits[join.other].find(h => h.other === r && h.point.distanceTo(join.point) < 1);
      if (!theirs || other.kind === 'path') continue;
      const mineT = tangentAt(road.points, join.d), theirT = tangentAt(other.points, theirs.d);
      const angle = Math.abs(Vector.angleBetween(mineT, theirT)), shallow = Math.min(angle, Math.PI - angle);
      if (shallow >= minAngle) continue;
      // Back to the previous junction along this street
      const before = atStart ? mine.find(h => h.d > join.d + 1 && h.other !== join.other) : [...mine].reverse().find(h => h.d < join.d - 1 && h.other !== join.other);
      if (!before) { drop.add(r); return; }
      if (!cuts.has(r)) cuts.set(r, [0, length]);
      const cut = cuts.get(r);
      if (atStart) cut[0] = Math.max(cut[0], before.d - overshoot); else cut[1] = Math.min(cut[1], before.d + overshoot);
    }
  });
  return roads.flatMap((road, r) => {
    if (drop.has(r)) return [];
    if (!cuts.has(r)) return [road];
    const [a, b] = cuts.get(r), points = slicePolyline(road.points, a, b);
    return points.length > 1 && b - a > 1 ? [{ ...road, points, joined: true }] : [];
  });
}

// MapGenerator joins a streamline to a road it comes near by swerving its
// last few metres onto it, which leaves a kink tighter than any street
// bends a few metres from the junction. Each such end is cut off before the
// swerve: the dead end left is then carried straight on to the next street,
// or cut back, like any other.
function unswerve(roads, { fixed, reach = 35, window = 3, minRadius = 20 } = {}) {
  return roads.map(road => {
    if (fixed.has(road.kind) || road.kind === 'path') return road;
    let points = road.points;
    for (const atStart of [false, true]) {
      const line = atStart ? points.slice().reverse() : points, total = lengthOf(line);
      if (total < reach + 20) continue;
      const at = d => { const slice = slicePolyline(line, 0, Math.max(1e-6, total - d)); return slice[slice.length - 1]; };
      // The furthest tight bend from the end, within reach of it
      let furthest = -1;
      for (let d = window; d <= reach; d += 1) {
        const a = at(d + window), p = at(d), b = at(d - window);
        const turn = Math.abs(Vector.angleBetween(p.clone().sub(a), b.clone().sub(p)));
        if (turn > 1e-3 && 2 * window / turn < minRadius) furthest = d;
      }
      if (furthest < 0) continue;
      const cut = slicePolyline(line, 0, total - furthest - window - 1);
      if (cut.length < 2) continue;
      points = atStart ? cut.reverse() : cut;
    }
    return points === road.points ? road : { ...road, points };
  });
}

// Trims overshoots, joins or removes dead ends, and drops roads left with
// nothing to connect to. roads: [{ kind, points }]. Returns a new list.
//  stub: an end this close past its last crossing is an overshoot
//  reach: how far a dead end may be carried on to meet the next street
//  keepOver: a dead end longer than this that cannot be joined stays, as a cul-de-sac
//  canCross(p, road): whether an extension may pass through p
export function cleanNetwork(roads, { stub = 18, overshoot = .6, reach = 150, keepOver = 90, snap = 12, fixed = new Set(['coast', 'riverbank', 'ring']), extendable = new Set(['main', 'major', 'minor']), canCross = () => true, halfWidthOf = () => 6.5 } = {}) {
  let list = roads.filter(road => road.points.length > 1 && lengthOf(road.points) > 1).map(road => ({ ...road, points: road.points.map(p => p.clone()) }));
  const trim = () => {
    const { hits, cumulative } = crossings(list);
    list = list.flatMap((road, r) => {
      const length = cumulative[r][road.points.length - 1], list = hits[r];
      if (!list.length) return fixed.has(road.kind) ? [road] : [];
      let from = 0, to = length;
      const first = list[0], last = list[list.length - 1];
      if (!first.endToEnd && first.d > 1e-3 && first.d <= stub && !fixed.has(road.kind)) from = Math.max(0, first.d - overshoot);
      if (!last.endToEnd && length - last.d > 1e-3 && length - last.d <= stub && !fixed.has(road.kind)) to = Math.min(length, last.d + overshoot);
      if (from === 0 && to === length) return [road];
      const points = slicePolyline(road.points, from, to);
      return points.length > 1 && to - from > 1 ? [{ ...road, points }] : [];
    });
  };
  trim();
  list = unhug(list, { fixed, halfWidthOf });
  trim();
  list = unlens(list, { fixed, overshoot });
  list = unshallow(list, { fixed, overshoot, stub });
  trim();
  list = unswerve(list, { fixed });
  // Carry each dead end on to the next street, or cut it back
  for (let pass = 0; pass < 2; pass++) {
    const { hits, cumulative } = crossings(list), grid = new SegmentGrid(list);
    const junctions = hits.map(list => list.map(hit => hit.point));
    const next = [];
    list.forEach((road, r) => {
      const length = cumulative[r][road.points.length - 1], mine = hits[r];
      let points = road.points, from = 0, to = length;
      for (const atStart of [true, false]) {
        const nearest = atStart ? mine[0] : mine[mine.length - 1];
        const dangling = nearest ? (atStart ? nearest.d : length - nearest.d) : length;
        if (dangling <= stub || fixed.has(road.kind)) continue;
        const end = atStart ? points[0] : points[points.length - 1];
        const inner = atStart ? points[Math.min(points.length - 1, 1)] : points[Math.max(0, points.length - 2)];
        const direction = end.clone().sub(inner).normalize();
        let joined = null;
        if (extendable.has(road.kind) || road.kind === 'path') {
          const limit = road.kind === 'path' ? reach / 3 : reach;
          const far = end.clone().add(direction.clone().multiplyScalar(limit));
          const lastIndex = atStart ? 0 : points.length - 2;
          const hit = grid.cast(end, far, s => s.road === r && Math.abs(s.i - lastIndex) < 3);
          if (hit) {
            let target = hit.point;
            // Aim for a junction already on that road if one is close
            for (const junction of junctions[hit.segment.road]) {
              if (junction.distanceTo(hit.point) < snap && junction.distanceTo(end) > 1) {
                const turn = Vector.angleBetween(direction, junction.clone().sub(end));
                if (Math.abs(turn) < .45) { target = junction; break; }
              }
            }
            const heading = target.clone().sub(end).normalize(), span = target.distanceTo(end);
            let clear = true;
            for (let d = 2; d < span - 1 && clear; d += 3) clear = canCross(end.clone().add(heading.clone().multiplyScalar(d)), road);
            if (clear) joined = [target.clone(), target.clone().add(heading.multiplyScalar(overshoot))];
          }
        }
        if (joined) points = atStart ? [...joined.reverse(), ...points] : [...points, ...joined];
        else if (dangling < keepOver || road.kind === 'path' && dangling < keepOver / 2) {
          // No street to reach: cut back to the last junction, or drop the road
          if (!nearest) { from = to = -1; break; }
          if (atStart) from = Math.max(0, nearest.d - overshoot); else to = Math.min(length, nearest.d + overshoot);
        } else road.deadEnds = (road.deadEnds ?? 0) + 1;
      }
      if (from < 0) return;
      if (from > 0 || to < length) {
        // Cuts refer to the unextended polyline; only one end can have been
        // extended if the other was cut, so slice before re-attaching.
        const base = slicePolyline(road.points, from, to);
        if (base.length < 2 || to - from < 1) return;
        const startExtended = points[0] !== road.points[0], endExtended = points[points.length - 1] !== road.points[road.points.length - 1];
        points = [...(startExtended && from === 0 ? points.slice(0, 2) : []), ...base, ...(endExtended && to === length ? points.slice(-2) : [])];
      }
      next.push({ ...road, points });
    });
    list = next;
    trim();
  }
  return list;
}

// A second, topological pass over the finished network: every chain that
// runs from a dead end back to its first junction is cut off at that junction,
// through however many end-to-end roads it spans (a street split into park
// path and street, say), and anything left in a small island of its own goes.
// Overshoots shorter than `stub` stay: they are the few centimetres a road
// runs past the one it meets.
export function pruneNetwork(roads, { stub = 18, overshoot = .6, fixed = new Set(['coast', 'riverbank', 'ring']), Graph } = {}) {
  let list = roads;
  for (let pass = 0; pass < 6; pass++) {
    const graph = new Graph(list.map(road => road.points), 4, false), nodes = graph.nodes;
    const roadOf = (a, b) => graph.edgeRoads.get(Graph.edgeKey(a, b));
    // Keep the largest connected network
    const component = new Map();
    let biggest = -1, biggestSize = 0;
    for (const start of nodes) {
      if (component.has(start)) continue;
      const id = component.size ? Math.max(...component.values()) + 1 : 0, queue = [start];
      let size = 0;
      component.set(start, id);
      while (queue.length) { const node = queue.pop(); size++; for (const next of node.neighbors) if (!component.has(next)) { component.set(next, id); queue.push(next); } }
      if (size > biggestSize) { biggestSize = size; biggest = id; }
    }
    const drop = new Set(), cuts = new Map();
    for (const node of nodes) if (component.get(node) !== biggest) for (const next of node.neighbors) { const r = roadOf(node, next); if (r !== undefined && !fixed.has(list[r].kind)) drop.add(r); }
    // Chains from each dead end back to the first junction
    for (const node of nodes) {
      if (node.neighbors.size !== 1 || component.get(node) !== biggest) continue;
      let previous = node, current = [...node.neighbors][0], length = previous.value.distanceTo(current.value);
      const chain = [roadOf(previous, current)];
      while (current.neighbors.size === 2) {
        const next = [...current.neighbors].find(n => n !== previous);
        length += current.value.distanceTo(next.value); chain.push(roadOf(current, next));
        previous = current; current = next;
      }
      if (length <= stub || chain.some(r => r === undefined || fixed.has(list[r].kind))) continue;
      // Every road wholly on the chain goes; the one reaching the junction is cut there
      const onChain = new Set(chain);
      const last = chain[chain.length - 1], junction = current.value;
      for (const r of onChain) if (r !== last) drop.add(r);
      if (!cuts.has(last)) cuts.set(last, []);
      cuts.get(last).push({ junction, towards: previous.value });
    }
    if (!drop.size && !cuts.size) break;
    list = list.flatMap((road, r) => {
      if (drop.has(r)) return [];
      if (!cuts.has(r)) return [road];
      let points = road.points;
      for (const { junction, towards } of cuts.get(r)) {
        // Which end of the road the dead chain is at, and where along it the junction is
        let best = 0, bestDistance = Infinity, travelled = 0, at = 0;
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((junction.x - a.x) * dx + (junction.y - a.y) * dy) / l2));
          const d = Math.hypot(junction.x - a.x - dx * t, junction.y - a.y - dy * t);
          if (d < bestDistance) { bestDistance = d; best = travelled + Math.sqrt(l2) * t; }
          travelled += Math.sqrt(l2);
        }
        at = best;
        const total = lengthOf(points), startSide = points[0].distanceTo(towards) + 1e-6 < points[points.length - 1].distanceTo(towards) ? towards.distanceTo(points[0]) < towards.distanceTo(points[points.length - 1]) : false;
        points = startSide ? slicePolyline(points, Math.max(0, at - overshoot), total) : slicePolyline(points, 0, Math.min(total, at + overshoot));
        if (points.length < 2) break;
      }
      return points.length > 1 && lengthOf(points) > 1 ? [{ ...road, points }] : [];
    });
  }
  return list;
}

// Two roads that meet end to end at an angle make a corner that no junction
// rounds and no bend was filleted into. Where one leg of the corner runs only
// a few metres (under `near`) from a junction, that leg is a dog-leg: it goes,
// and the other road is carried on to the junction instead. Elsewhere the
// corner is rounded into a curve as wide as the legs allow, half on each road.
// radiusOf(kind) is how round a road of that kind bends.
export function joinCorners(roads, { near = 24, radiusOf = () => 35, minTurn = .2, end = 2, overshoot = .6, fixed = new Set(['coast', 'riverbank', 'ring']) } = {}) {
  let list = roads.map(road => ({ ...road, points: road.points.map(p => p.clone()) }));
  const pointAt = (points, d) => { const slice = slicePolyline(points, 0, d); return slice[slice.length - 1]; };
  for (let pass = 0; pass < 3; pass++) {
    const { hits, cumulative } = crossings(list), touched = new Set();
    let changed = false;
    list.forEach((road, r) => {
      if (touched.has(r)) return;
      const length = cumulative[r][road.points.length - 1];
      for (const atStart of [false, true]) {
        const mine = hits[r], corner = atStart ? mine[0] : mine[mine.length - 1];
        if (!corner || (atStart ? corner.d : length - corner.d) > end) continue;
        const o = corner.other, other = list[o];
        if (o === r || touched.has(o) || touched.has(r)) continue;
        // The partner must end there too, and nothing else meet them there
        const oLength = cumulative[o][other.points.length - 1];
        const theirs = hits[o].find(hit => hit.other === r && hit.point.distanceTo(corner.point) < 1);
        if (!theirs || Math.min(theirs.d, oLength - theirs.d) > end) continue;
        const crowd = hits.some((list, k) => k !== r && k !== o && list.some(hit => hit.point.distanceTo(corner.point) < end * 2));
        if (crowd) continue;
        // Both roads as running into the corner
        const oAtStart = theirs.d < oLength - theirs.d;
        const a = atStart ? road.points.slice().reverse() : road.points, b = oAtStart ? other.points.slice().reverse() : other.points;
        const aLength = length, bLength = oLength;
        const aCorner = atStart ? length - corner.d : corner.d, bCorner = oAtStart ? oLength - theirs.d : theirs.d;
        const p = corner.point, ta = p.clone().sub(pointAt(a, Math.max(0, aCorner - 3))), tb = pointAt(b, Math.max(0, bCorner - 3)).clone().sub(p);
        const turn = Math.abs(Vector.angleBetween(ta, tb));
        if (turn < minTurn || turn > Math.PI - .2) continue;
        // How far back along each leg its previous junction is
        const legOf = (list, cornerD, reversed, total) => {
          const before = list.filter(hit => hit.point.distanceTo(p) > end * 2).map(hit => reversed ? total - hit.d : hit.d).filter(d => d < cornerD);
          return before.length ? { d: cornerD - Math.max(...before), junction: Math.max(...before) } : { d: cornerD, junction: null };
        };
        const legA = legOf(hits[r], aCorner, atStart, aLength), legB = legOf(hits[o], bCorner, oAtStart, bLength);
        let newA, newB;
        const dogLeg = [[legA, 'a'], [legB, 'b']].filter(([leg, which]) => leg.junction !== null && leg.d < near && !fixed.has((which === 'a' ? road : other).kind)).sort((x, y) => x[0].d - y[0].d)[0];
        if (dogLeg) {
          // Drop the short leg past its junction; the other road runs on to the junction
          const [leg, which] = dogLeg, short = which === 'a' ? a : b, long = which === 'a' ? b : a, longCorner = which === 'a' ? bCorner : aCorner;
          const junction = pointAt(short, leg.junction);
          const cut = slicePolyline(short, 0, leg.junction + overshoot);
          const kept = slicePolyline(long, 0, Math.max(0, longCorner - 1e-6));
          if (kept.length < 2) continue;
          kept[kept.length - 1] = junction.clone();
          const heading = junction.clone().sub(kept[kept.length - 2]);
          if (heading.length() < 1) continue;
          kept.push(junction.clone().add(heading.normalize().multiplyScalar(overshoot)));
          if (which === 'a') { newA = cut; newB = kept; } else { newA = kept; newB = cut; }
        } else {
          // Round the corner: a curve from a point on one leg to a point on the other, tangent to both
          const radius = Math.min(radiusOf(road.kind), radiusOf(other.kind)), tangent = Math.min(radius * Math.tan(turn / 2), legA.d * .45, legB.d * .45);
          if (tangent < 1) continue;
          const s = pointAt(a, aCorner - tangent), e = pointAt(b, bCorner - tangent), steps = Math.max(4, Math.ceil(turn / .16)), curve = [];
          for (let k = 0; k <= steps; k++) {
            const t = k / steps, u = 1 - t;
            curve.push(new Vector(u * u * s.x + 2 * u * t * p.x + t * t * e.x, u * u * s.y + 2 * u * t * p.y + t * t * e.y));
          }
          const middle = Math.floor(steps / 2);
          newA = [...slicePolyline(a, 0, aCorner - tangent).slice(0, -1), ...curve.slice(0, middle + 1)];
          newB = [...slicePolyline(b, 0, bCorner - tangent).slice(0, -1), ...curve.slice(middle).reverse()];
        }
        road.points = atStart ? newA.slice().reverse() : newA;
        other.points = oAtStart ? newB.slice().reverse() : newB;
        touched.add(r); touched.add(o); changed = true;
        break;
      }
    });
    list = list.filter(road => road.points.length > 1 && lengthOf(road.points) > 1);
    if (!changed) break;
  }
  return list;
}

// A park path that meets a street a few metres from a junction splits that
// street into a sliver no car can turn from, and puts its entrance in the
// junction's corner. Each such end slides along the street to `near` metres
// from the junction; where the street is too short for that, the path is cut
// back to where it last crosses another park path, so the entrance goes
// without leaving a dead end (a path that crosses none goes altogether).
export function easePathEnds(roads, { near = 24, touch = 1.5, overshoot = .6 } = {}) {
  const list = roads.map(road => ({ ...road, points: road.points.map(p => p.clone()) }));
  const { hits, cumulative } = crossings(list);
  const pointAt = (points, d) => { const slice = slicePolyline(points, 0, d); return slice[slice.length - 1]; };
  // How far along a polyline its nearest point to p is, and how far p is from it
  const project = (points, cumulative, p) => {
    let best = { d: 0, distance: Infinity };
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)), distance = Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
      if (distance < best.distance) best = { d: cumulative[i] + Math.sqrt(l2) * t, distance };
    }
    return best;
  };
  const drop = new Set();
  list.forEach((path, r) => {
    if (path.kind !== 'path') return;
    const originalLength = cumulative[r][path.points.length - 1];
    for (const atStart of [true, false]) {
      if (drop.has(r)) break;
      const endPoint = atStart ? path.points[0] : path.points[path.points.length - 1];
      // The street this end of the path meets
      let street = -1, at = null;
      list.forEach((road, k) => {
        if (road.kind === 'path') return;
        const hit = project(road.points, cumulative[k], endPoint);
        if (hit.distance < touch && (!at || hit.distance < at.distance)) { street = k; at = hit; }
      });
      if (street < 0) continue;
      const road = list[street], streetLength = cumulative[street][road.points.length - 1];
      const junctions = hits[street].filter(h => list[h.other].kind !== 'path').map(h => h.d);
      const nearest = junctions.reduce((best, d) => Math.abs(d - at.d) < Math.abs(best - at.d) ? d : best, Infinity);
      if (Math.abs(nearest - at.d) >= near) continue;
      // Between the junctions either side: `near` from the closer one, or halfway
      // if the gap is short, but never closer than half of `near` to either
      const lo = Math.max(0, ...junctions.filter(d => d <= at.d)), hi = Math.min(streetLength, ...junctions.filter(d => d > at.d)), middle = (lo + hi) / 2;
      const target = at.d < middle ? Math.min(lo + near, middle) : Math.max(hi - near, middle);
      const points = atStart ? path.points.slice().reverse() : path.points, length = lengthOf(points);
      if (Math.min(target - lo, hi - target) < near * .75) {
        // How far from this end the path last crosses another path
        const back = hits[r].filter(h => list[h.other].kind === 'path').map(h => atStart ? h.d : originalLength - h.d).filter(d => d > 2);
        if (!back.length) { drop.add(r); break; }
        const kept = slicePolyline(points, 0, length - Math.min(...back) + overshoot);
        if (kept.length > 1) path.points = atStart ? kept.reverse() : kept;
        continue;
      }
      const onStreet = pointAt(road.points, target);
      // The path as far as a few metres short of the street, then on to the new entrance
      const kept = slicePolyline(points, 0, Math.max(0, length - 6));
      if (kept.length < 2) continue;
      const heading = onStreet.clone().sub(kept[kept.length - 1]);
      if (heading.length() < 2) continue;
      const moved = [...kept, onStreet.clone(), onStreet.clone().add(heading.normalize().multiplyScalar(overshoot))];
      path.points = atStart ? moved.reverse() : moved;
    }
  });
  return list.filter((road, r) => !drop.has(r));
}

// A kink in the middle of a street, tighter than any street bends (where
// streamlines turn sharply round the field's degenerate points), is eased
// into a curve at least `minRadius` round, as far as the junctions either
// side of it allow: the stretch replaced never holds a junction, so no
// crossing moves.
export function easeKinks(roads, { minRadius = 15, window = 3, clear = 2, fixed = new Set(['coast', 'riverbank', 'ring']) } = {}) {
  let list = roads.map(road => ({ ...road, points: road.points.map(p => p.clone()) }));
  for (let pass = 0; pass < 3; pass++) {
    const { hits, cumulative } = crossings(list);
    let changed = false;
    list.forEach((road, r) => {
      if (fixed.has(road.kind) || road.kind === 'path') return;
      const points = road.points, total = cumulative[r][points.length - 1];
      const at = d => { const slice = slicePolyline(points, 0, Math.max(1e-6, Math.min(total, d))); return slice[slice.length - 1]; };
      // The tightest kink along the road
      let worst = null;
      for (let d = window + 1; d <= total - window - 1; d += 1) {
        const a = at(d - window), p = at(d), b = at(d + window);
        const turn = Math.abs(Vector.angleBetween(p.clone().sub(a), b.clone().sub(p)));
        const radius = turn > 1e-3 ? 2 * window / turn : Infinity;
        if (radius < minRadius && (!worst || radius < worst.radius)) worst = { d, radius };
      }
      if (!worst) return;
      // How much the road turns across the kink, and the curve that would take it at minRadius
      const d0 = worst.d, span = 12;
      const dirIn = at(d0 - span).clone().sub(at(Math.max(0, d0 - span - 4))), dirOut = at(Math.min(total, d0 + span + 4)).clone().sub(at(d0 + span));
      if (dirIn.length() < 1e-6 || dirOut.length() < 1e-6) return;
      const turn = Math.abs(Vector.angleBetween(dirIn, dirOut));
      let tangent = Math.max(4, minRadius * Math.tan(Math.min(turn, 2.6) / 2));
      // Not over a junction, nor off the end of the road
      for (const hit of hits[r]) {
        const gap = Math.abs(hit.d - d0) - clear;
        if (gap < tangent) tangent = gap;
      }
      tangent = Math.min(tangent, d0 - clear, total - d0 - clear);
      if (tangent < 3) return;
      const s = at(d0 - tangent), e = at(d0 + tangent), control = at(d0), steps = Math.max(4, Math.ceil(turn / .12)), curve = [];
      for (let k = 1; k < steps; k++) {
        const t = k / steps, u = 1 - t;
        curve.push(new Vector(u * u * s.x + 2 * u * t * control.x + t * t * e.x, u * u * s.y + 2 * u * t * control.y + t * t * e.y));
      }
      road.points = [...slicePolyline(points, 0, d0 - tangent), ...curve, ...slicePolyline(points, d0 + tangent, total)];
      changed = true;
    });
    if (!changed) break;
  }
  return list;
}
