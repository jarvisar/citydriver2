import Vector from './vector.js';
import { findIntersections } from './graph.js';
import { insidePolygon, segmentIntersection, signedArea, polygonCentroid } from './polygon-util.js';
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
// A street that comes back round to where it began (round a circus, say)
const isLoop = points => points.length > 3 && points[0].distanceTo(points[points.length - 1]) <= .5 && lengthOf(points) >= 5;
// Roads the cleanup never cuts: the ring, the waterside roads, and each circus
const held = (fixed, road) => fixed.has(road.kind) || road.circus === true;

// Replaces each bend of a polyline with a circular arc tangent to both of its
// segments, as large as the segments allow up to maxRadius. Straight runs stay
// straight and the ends stay put, so a road still meets what it met before.
// A shallow bend (a simplified curve is a chain of them, long chords a few
// degrees apart) would get only a short arc between long straights, so it is
// rounded over as much of its segments as keeps the road within `drift` of
// the corner: the chain becomes one smooth curve again.
export const ARC_STEP = .045;
export function filletPolyline(points, maxRadius, { minTurn = .035, arcStep = ARC_STEP, drift = maxRadius / 25, minStraight = 2 } = {}) {
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
    // Each segment lends at most half of itself to the arcs at its two ends.
    // (An arc `tangent` long each side pulls in tangent * tan(angle / 4) from the corner.)
    const tangent = Math.min(Math.max(maxRadius * tanHalf, drift / Math.tan(angle / 4)), .5 * l1, .5 * l2), radius = tangent / tanHalf;
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
  // Arcs that all but meet share a point: a sliver of straight between them
  // would turn back on itself when offset inside the bend (a river's banks).
  // The ends stay put.
  const add = arc => {
    const last = out[out.length - 1], first = arc[0];
    if (last.distanceTo(first) >= minStraight) out.push(first);
    else if (out.length > 1) out[out.length - 1] = new Vector((last.x + first.x) / 2, (last.y + first.y) / 2);
    out.push(...arc.slice(1));
  };
  for (let i = 1; i < n - 1; i++) add(bend(i));
  if (closed) {
    add(bend(0));
    out[0] = out[out.length - 1].clone();
  } else {
    if (out.length > 1 && out[out.length - 1].distanceTo(points[n - 1]) < minStraight) out.pop();
    out.push(points[n - 1].clone());
  }
  return dedupe(out);
}
// A streamline that closes on itself joins its two integration fronts where
// they met, which can be metres apart and out of line, leaving a hook: the
// loop is cut back past the join and closed straight across, for the fillet
// to round like any other bend
export function closeLoop(points, trim = 12) {
  const n = points.length;
  if (n < 4 || points[0].distanceTo(points[n - 1]) > 1e-6 || lengthOf(points) < trim * 8) return points;
  const kept = slicePolyline(points, trim, lengthOf(points) - trim);
  return kept.length > 2 ? [...kept, kept[0].clone()] : points;
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
  // Each corner in `step` chords, as round as the rest of the ring
  const arcSteps = Math.max(8, Math.ceil(r * Math.PI / 2 / step));
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= arcSteps; k++) {
    const a = a0 + k / arcSteps * Math.PI / 2;
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
// touch another road's end count too: that is where one road carries on as
// another, or, for a loop (a street round a circus), as itself.
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
  // A loop's first and last segments are neighbours too, across its closure
  const last = roads.map(road => isLoop(road.points) ? road.points.length - 2 : -1);
  for (const { point, segments: [a, b] } of findIntersections(segments)) {
    if (a.road === b.road && (Math.abs(a.i - b.i) < 2 || Math.abs(a.i - b.i) === last[a.road])) continue;
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
    if (a === b || (a.r === b.r && (a.d === b.d || cumulative[a.r][roads[a.r].points.length - 1] < 5)) || a.p.distanceTo(b.p) > .5) continue;
    hits[a.r].push({ d: a.d, point: a.p, other: b.r, endToEnd: true });
  }
  for (const list of hits) list.sort((p, q) => p.d - q.d);
  return { hits, cumulative };
}

// A scrap: a road that touches the rest in one place and runs only a stub's
// length either side of it. It is no street, and left, it would pass for a
// junction at the end of a dead end. mine: its crossings.
const isScrap = (mine, length, stub) => mine.length > 0 && mine[0].d <= stub && length - mine[mine.length - 1].d <= stub && mine.every(hit => hit.point.distanceTo(mine[0].point) < 1);

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
// inside that road's own carriageway, or just beside it with no room for a
// block between them: two carriageways kerb to kerb, or a strip of pavement
// where the houses should be. Wherever the lesser of two roads runs within
// their combined half widths of the other, nearly parallel to it, for more
// than a few metres, or within `crowd` metres of its kerb for more than
// `crowdRun`, that stretch of it is cut out. The ends left are marked, so
// the stretch is not carried straight back alongside the other road.
const CROWD = { gap: 14, angle: .3, run: 30 };
function unhug(roads, { fixed, halfWidthOf, step = 2, minRun = 8, maxAngle = .45, crowd = CROWD } = {}) {
  const index = new RoadIndex(roads), sin = Math.sin(maxAngle), crowdSin = Math.sin(crowd.angle);
  const rank = road => held(fixed, road) ? 9 : RANK[road.kind] ?? 1;
  return roads.flatMap((road, r) => {
    if (held(fixed, road) || road.kind === 'path') return [road];
    const own = halfWidthOf(road.kind), hugs = [], crowds = [];
    let hug = null, crowded = null, travelled = 0;
    const close = (run, list, least) => { if (run && run[1] - run[0] >= least) list.push(run); return null; };
    const points = road.points;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < 1e-9) continue;
      const tx = dx / length, ty = dy / length;
      for (let d = (step - travelled % step) % step; d <= length; d += step) {
        const x = a.x + tx * d, y = a.y + ty * d;
        let hugging = false, crowding = false;
        index.each(x, y, own + 12 + crowd.gap, (segment, distance) => {
          if (hugging || segment.roadIndex === r) return;
          const other = segment.road;
          if (other.kind === 'path' || rank(other) < rank(road) || (rank(other) === rank(road) && segment.roadIndex > r)) return;
          const across = Math.abs(tx * segment.dy - ty * segment.dx) / segment.length, both = own + halfWidthOf(other.kind);
          if (distance < both * .9 && across < sin) hugging = true;
          else if (distance < both + crowd.gap && across < crowdSin) crowding = true;
        });
        const at = travelled + d;
        if (hugging) { hug ??= [at, at]; hug[1] = at; } else hug = close(hug, hugs, minRun);
        if (hugging || crowding) { crowded ??= [at, at]; crowded[1] = at; } else crowded = close(crowded, crowds, crowd.run);
      }
      travelled += length;
    }
    close(hug, hugs, minRun); close(crowded, crowds, crowd.run);
    const runs = [...hugs, ...crowds].sort((p, q) => p[0] - q[0]);
    if (!runs.length) return [road];
    const pieces = [];
    let from = 0;
    for (const [a, b] of runs) { if (a - from > 1) pieces.push([from, a]); from = Math.max(from, b); }
    if (travelled - from > 1) pieces.push([from, travelled]);
    // What is left between two cuts is a street only if it is long enough for one
    return pieces.filter(([a, b]) => a === 0 || b === travelled || b - a >= 20).map(([a, b]) => ({ ...road, points: slicePolyline(points, a, b), cutStart: a > 0 || road.cutStart, cutEnd: b < travelled || road.cutEnd }))
      .filter(piece => piece.points.length > 1);
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
    if (held(fixed, road)) return;
    const mine = hits[r];
    for (let k = 0; k + 1 < mine.length; k++) {
      const a = mine[k], b = mine[k + 1], other = roads[a.other];
      if (a.other !== b.other || a.endToEnd || b.endToEnd || b.d - a.d > span || b.d - a.d < 1e-3) continue;
      const mineRank = RANK[road.kind] ?? 1, theirRank = held(fixed, other) ? 9 : RANK[other.kind] ?? 1;
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
    if (held(fixed, road) || road.kind === 'path') return;
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
    // A loop has no ends to swerve
    if (held(fixed, road) || road.kind === 'path' || isLoop(road.points)) return road;
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

// The ring and the waterside roads are clipped against each other's lines,
// and where they meet at a sharp angle the few centimetres each is carried
// past the other can miss: two ends a hair apart that never touch, a gap no
// car can cross. Ends of different roads of `kinds` within `reach` of each
// other that do not already cross are moved to meet halfway, so the roads
// meet end to end (and joinCorners rounds the corner).
export function weldEnds(roads, { reach = 2, carry = 15, kinds = new Set(['coast', 'riverbank', 'ring']) } = {}) {
  const list = roads.map(road => kinds.has(road.kind) ? { ...road, points: road.points.map(p => p.clone()) } : road), ends = [];
  list.forEach((road, r) => {
    if (!kinds.has(road.kind) || road.points.length < 2 || isLoop(road.points)) return;
    ends.push({ r, start: true }, { r, start: false });
  });
  // Where an end is now, and the last few segments of its road there
  const at = end => end.start ? 0 : list[end.r].points.length - 1;
  const tail = end => { const points = list[end.r].points; return end.start ? points.slice(0, 4) : points.slice(-4); };
  const cross = (a, b) => { for (let i = 0; i + 1 < a.length; i++) for (let j = 0; j + 1 < b.length; j++) if (segmentIntersection(a[i], a[i + 1], b[j], b[j + 1])) return true; return false; };
  const used = new Set();
  for (const a of ends) for (const b of ends) {
    if (a.r >= b.r || used.has(a) || used.has(b)) continue;
    const p = list[a.r].points[at(a)], q = list[b.r].points[at(b)], gap = p.distanceTo(q);
    if (gap < 1e-6 || gap > reach || cross(tail(a), tail(b))) continue;
    const middle = p.clone().add(q).multiplyScalar(.5);
    list[a.r].points[at(a)] = middle; list[b.r].points[at(b)] = middle.clone();
    used.add(a); used.add(b);
  }
  // An end that stops short of the others altogether (a bank road clipped by
  // the coast line where it runs out to the domain's corner) is carried on to
  // the nearest of them within `carry`
  const index = new RoadIndex(list.filter(road => kinds.has(road.kind)));
  for (const end of ends) {
    if (used.has(end)) continue;
    const road = list[end.r], p = road.points[at(end)], inner = road.points[end.start ? 1 : at(end) - 1];
    if (index.nearest(p.x, p.y, 1, segment => segment.road === road ? Infinity : 0)) continue;
    const hit = index.nearest(p.x, p.y, carry, (segment, distance) => segment.road === road ? Infinity : distance);
    if (!hit) continue;
    const target = new Vector(hit.x, hit.y), heading = target.clone().sub(p), towards = p.clone().sub(inner);
    if (heading.length() < 1e-6 || heading.x * towards.x + heading.y * towards.y <= 0) continue;
    const onward = [target, target.clone().add(heading.normalize().multiplyScalar(.6))];
    road.points = end.start ? [...onward.reverse(), ...road.points] : [...road.points, ...onward];
  }
  return list;
}

// Streamlines wind round the tensor field's degenerate points (the middle of
// downtown, where the radial field is centred) in loops too small for a
// block: a ring of road a few metres across, with streets converging on it
// and sometimes a main road straight through it. Each small, round loop is
// made a circus: a round street at least `radius` metres across with a
// garden in the middle, and every street that came inside it ends on it.
// canPlace(p) says whether the circus may pass through p; fixed roads stay
// `clearance` metres clear of it. Returns the roads and the circuses.
export function circuses(roads, { maxRadius = 55, radius = 40, roundness = .7, spacing = 80, clearance = 36, step = 6, kind = 'major',
  canPlace = () => true, fixed = new Set(['coast', 'riverbank', 'ring']) } = {}) {
  const found = [], fixedIndex = new RoadIndex(roads.filter(road => held(fixed, road)));
  for (const road of roads) {
    if (held(fixed, road) || road.kind === 'path' || !isLoop(road.points)) continue;
    const ring = road.points.slice(0, -1), area = Math.abs(signedArea(ring)), perimeter = lengthOf(road.points);
    if (area > Math.PI * maxRadius * maxRadius || 4 * Math.PI * area / (perimeter * perimeter) < roundness) continue;
    const centre = polygonCentroid(ring), size = Math.max(radius, Math.sqrt(area / Math.PI));
    if (found.some(c => c.centre.distanceTo(centre) < c.radius + size + spacing)) continue;
    const count = Math.max(Math.ceil(2 * Math.PI / ARC_STEP), Math.ceil(2 * Math.PI * size / step)), circle = [];
    for (let k = 0; k < count; k++) circle.push(new Vector(centre.x + Math.cos(k / count * Math.PI * 2) * size, centre.y + Math.sin(k / count * Math.PI * 2) * size));
    circle.push(circle[0].clone());
    if (!circle.every(p => canPlace(p) && !fixedIndex.nearest(p.x, p.y, clearance))) continue;
    found.push({ centre, radius: size, road, circle });
  }
  if (!found.length) return { roads, circuses: [] };
  let list = roads.filter(road => !found.some(c => c.road === road));
  for (const { circle } of found) {
    const polygon = circle.slice(0, -1);
    list = list.flatMap(road => held(fixed, road) ? [road] : clipInside(road.points, polygon, .6, false).map(points => ({ ...road, points })));
  }
  for (const { circle } of found) list.push({ kind, points: circle, circus: true });
  return { roads: list, circuses: found.map(({ centre, radius }) => ({ centre, radius })) };
}

// Every end that runs on less than `stub` past its last crossing is cut back to
// `overshoot` past it, scraps go, and so does a road that meets no other.
export function trimEnds(roads, { stub = 18, overshoot = .6, fixed = new Set(['coast', 'riverbank', 'ring']) } = {}) {
  const { hits, cumulative } = crossings(roads);
  return roads.flatMap((road, r) => {
    const length = cumulative[r][road.points.length - 1], mine = hits[r];
    if (held(fixed, road)) return [road];
    if (!mine.length || isScrap(mine, length, stub)) return [];
    let from = 0, to = length;
    const first = mine[0], last = mine[mine.length - 1];
    if (!first.endToEnd && first.d > 1e-3 && first.d <= stub) from = Math.max(0, first.d - overshoot);
    if (!last.endToEnd && length - last.d > 1e-3 && length - last.d <= stub) to = Math.min(length, last.d + overshoot);
    if (from === 0 && to === length) return [road];
    const points = slicePolyline(road.points, from, to);
    return points.length > 1 && to - from > 1 ? [{ ...road, points }] : [];
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
  const trim = () => { list = trimEnds(list, { stub, overshoot, fixed }); };
  trim();
  list = unhug(list, { fixed, halfWidthOf });
  trim();
  list = unlens(list, { fixed, overshoot });
  list = unshallow(list, { fixed, overshoot, stub });
  trim();
  list = unswerve(list, { fixed });
  // Carry each dead end on to the next street, or cut it back
  for (let pass = 0; pass < 2; pass++) {
    const { hits, cumulative } = crossings(list), grid = new SegmentGrid(list), index = new RoadIndex(list);
    // (A loop meeting itself where it closes is no junction to aim for)
    const junctions = hits.map((list, r) => list.filter(hit => hit.other !== r).map(hit => hit.point));
    // How far an extension would run alongside another road, as unhug would cut it
    const crowdedFor = (from, heading, span, r, own) => {
      let crowded = 0;
      for (let d = 2; d < span - 1; d += 2) {
        let near = false;
        index.each(from.x + heading.x * d, from.y + heading.y * d, own + 12 + CROWD.gap, (segment, distance) => {
          if (near || segment.roadIndex === r || segment.road.kind === 'path') return;
          const across = Math.abs(heading.x * segment.dy - heading.y * segment.dx) / segment.length;
          if (across < Math.sin(CROWD.angle) && distance < own + halfWidthOf(segment.road.kind) + CROWD.gap) near = true;
        });
        if (near) crowded += 2;
      }
      return crowded;
    };
    const next = [];
    list.forEach((road, r) => {
      const length = cumulative[r][road.points.length - 1], mine = hits[r];
      let points = road.points, from = 0, to = length;
      for (const atStart of [true, false]) {
        const nearest = atStart ? mine[0] : mine[mine.length - 1];
        const dangling = nearest ? (atStart ? nearest.d : length - nearest.d) : length;
        if (dangling <= stub || held(fixed, road)) continue;
        const end = atStart ? points[0] : points[points.length - 1];
        const inner = atStart ? points[Math.min(points.length - 1, 1)] : points[Math.max(0, points.length - 2)];
        const direction = end.clone().sub(inner).normalize();
        let joined = null;
        // An end cut where the road ran alongside another is not carried back beside it
        if ((extendable.has(road.kind) || road.kind === 'path') && !(atStart ? road.cutStart : road.cutEnd)) {
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
            if (clear && road.kind !== 'path') clear = crowdedFor(end, heading, span, r, halfWidthOf(road.kind)) < 12;
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

const pointAt = (points, d) => { const slice = slicePolyline(points, 0, Math.max(1e-6, d)); return slice[slice.length - 1]; };

// Where one road carries on as another (the ring into the coast road round a
// corner, a boulevard into a side street), each is drawn square across its
// end, and the two ends leave a wedge between them on the outside of any bend
// and a step where the widths differ. A patch for each such joint covers
// both ends: the hull of the two end sections, carried `into` each road a
// little so its edges never lie exactly along the roads' own (a crack in a
// union). width(road): the half width the patch spans for that road. With
// `round`, a disc as wide as the narrower of the two is added, which covers
// the joint itself however nearly straight on the roads meet.
export function endJoints(roads, width = road => road.profile.halfWidth, { into = .5, round = false } = {}) {
  const ends = [];
  roads.forEach((road, r) => {
    const points = road.points, n = points.length;
    if (n < 2 || road.kind === 'path' || isLoop(points)) return;
    for (const [at, towards] of [[0, 1], [n - 1, n - 2]]) {
      const p = points[at], q = points[towards], length = p.distanceTo(q);
      if (length > 1e-6) ends.push({ r, p, dx: (q.x - p.x) / length, dy: (q.y - p.y) / length, w: width(road) });
    }
  });
  // Ends by metre cell, so each is only compared with those beside it
  const patches = [], cells = new Map(), cell = (x, y) => `${Math.floor(x)},${Math.floor(y)}`;
  ends.forEach((end, i) => { const key = cell(end.p.x, end.p.y); if (!cells.has(key)) cells.set(key, []); cells.get(key).push(i); });
  const pairs = [];
  ends.forEach((a, i) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of cells.get(cell(a.p.x + dx, a.p.y + dy)) ?? []) if (j > i) pairs.push([i, j]);
  });
  for (const [i, j] of pairs) {
    const a = ends[i], b = ends[j];
    if (a.r === b.r || a.p.distanceTo(b.p) > .5) continue;
    const corners = [a.p];
    for (const { p, dx, dy, w } of [a, b]) for (const along of [0, into]) corners.push({ x: p.x + dx * along - dy * w, y: p.y + dy * along + dx * w }, { x: p.x + dx * along + dy * w, y: p.y + dy * along - dx * w });
    patches.push(hull(corners));
    if (round) patches.push(Array.from({ length: 24 }, (_, k) => new Vector(a.p.x + Math.cos(k / 24 * Math.PI * 2) * Math.min(a.w, b.w), a.p.y + Math.sin(k / 24 * Math.PI * 2) * Math.min(a.w, b.w))));
  }
  return patches;
}
// The convex hull of a few points, anticlockwise
function hull(points) {
  const sorted = points.map(p => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x), lower = [], upper = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of sorted.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1)).map(p => new Vector(p.x, p.y));
}

// Two streets that stop on the same road within a few metres of each other
// make a knot of junctions no kerb can round. From the same side they are
// converging on one place: the lesser gives way, cut back to its last
// junction clear of the knot. From opposite sides they are a crossroads
// drawn a few metres out of true: the lesser's last stretch swings onto the
// other's junction, so the two meet the road in one place.
export function spreadJunctions(roads, { close = 14, clear = 22, swing = 30, maxSwing = .5, end = 2, overshoot = .6, fixed = new Set(['coast', 'riverbank', 'ring']) } = {}) {
  let list = roads.map(road => ({ ...road, points: road.points.map(p => p.clone()) }));
  for (let pass = 0; pass < 3; pass++) {
    const { hits, cumulative } = crossings(list), grid = new SegmentGrid(list);
    // Each street end that stops on another road: where, from which side, and its last junction clear of it
    const tees = [];
    list.forEach((road, r) => {
      if (held(fixed, road) || road.kind === 'path' || isLoop(road.points)) return;
      const length = cumulative[r][road.points.length - 1], mine = hits[r];
      for (const atStart of [true, false]) {
        const hit = atStart ? mine[0] : mine[mine.length - 1];
        if (!hit || hit.endToEnd || hit.other === r || (atStart ? hit.d : length - hit.d) > end) continue;
        const host = list[hit.other], theirs = hits[hit.other].find(h => h.other === r && h.point.distanceTo(hit.point) < 1);
        if (!theirs || host.kind === 'path') continue;
        const hostLength = cumulative[hit.other][host.points.length - 1];
        const tangent = pointAt(host.points, Math.min(hostLength, theirs.d + 3)).clone().sub(pointAt(host.points, Math.max(0, theirs.d - 3)));
        const back = pointAt(road.points, atStart ? Math.min(length, hit.d + 10) : Math.max(0, hit.d - 10)).clone().sub(hit.point);
        if (tangent.length() < 1e-6 || back.length() < 1e-6) continue;
        const junctions = mine.filter(h => h !== hit && !h.endToEnd && h.point.distanceTo(hit.point) > clear);
        const previous = atStart ? junctions.find(h => h.d > hit.d) : [...junctions].reverse().find(h => h.d < hit.d);
        const any = mine.filter(h => h !== hit && Math.abs(h.d - hit.d) > 1), last = atStart ? any.find(h => h.d > hit.d) : [...any].reverse().find(h => h.d < hit.d);
        const angle = Math.abs(Vector.angleBetween(tangent, back));
        tees.push({ r, atStart, hit, host: hit.other, side: Math.sign(tangent.x * back.y - tangent.y * back.x), previous, last, square: Math.abs(Math.PI / 2 - angle), length });
      }
    });
    const edits = new Map();
    const worse = (a, b) => {
      const rank = t => RANK[list[t.r].kind] ?? 1;
      return rank(a) !== rank(b) ? rank(a) < rank(b) : Math.abs(a.square - b.square) > .1 ? a.square > b.square : a.length < b.length;
    };
    // Swing a street's last stretch onto a point on the road it stops on, if
    // that bends it only a little and crosses nothing on the way
    const swingOnto = (tee, target, other) => {
      const road = list[tee.r], from = tee.atStart ? road.points.slice().reverse() : road.points, total = tee.length;
      const endD = tee.atStart ? total - tee.hit.d : tee.hit.d, lastJunction = tee.last ? (tee.atStart ? total - tee.last.d : tee.last.d) : 0;
      const pivotD = Math.max(lastJunction + 2, endD - swing);
      if (endD - pivotD < 10) return false;
      const pivot = pointAt(from, pivotD);
      const before = pivot.clone().sub(pointAt(from, Math.max(0, pivotD - 4))), after = target.clone().sub(pivot);
      if (before.length() < 1e-6 || Math.abs(Vector.angleBetween(before, after)) > maxSwing) return false;
      const heading = after.clone().normalize();
      if (grid.cast(pivot.clone().add(heading.clone().multiplyScalar(.5)), target.clone().sub(heading.clone().multiplyScalar(.5)), s => s.road === tee.r || s.road === other)) return false;
      const tail = [...slicePolyline(from, 0, pivotD), target.clone(), target.clone().add(heading.multiplyScalar(overshoot))];
      edits.set(tee.r, { points: tee.atStart ? tail.reverse() : tail });
      return true;
    };
    for (let i = 0; i < tees.length; i++) for (let j = i + 1; j < tees.length; j++) {
      const a = tees[i], b = tees[j];
      if (a.r === b.r || a.host !== b.host || edits.has(a.r) || edits.has(b.r) || a.hit.point.distanceTo(b.hit.point) > close) continue;
      const loser = worse(a, b) ? a : b, winner = loser === a ? b : a;
      // Converging: the lesser gives way at its last junction, or goes.
      // Out of true: the lesser swings onto the other's junction.
      if (a.side === b.side) { if (!loser.previous || !edits.has(loser.previous.other)) edits.set(loser.r, { cut: loser }); }
      else swingOnto(loser, winner.hit.point, winner.r);
    }
    // A street stopping a few metres short of where another crosses the same road meets it at the crossing
    for (const tee of tees) {
      if (edits.has(tee.r)) continue;
      const crossing = hits[tee.host].find(h => !h.endToEnd && h.other !== tee.r && h.other !== tee.host && h.point.distanceTo(tee.hit.point) > 1 && h.point.distanceTo(tee.hit.point) < close
        && !edits.has(h.other) && hits[h.other].some(k => k.other === tee.host && k.point.distanceTo(h.point) < 1 && k.d > close && cumulative[h.other][list[h.other].points.length - 1] - k.d > close));
      if (crossing) swingOnto(tee, crossing.point, crossing.other);
    }
    if (!edits.size) break;
    list = list.flatMap((road, r) => {
      const edit = edits.get(r);
      if (!edit) return [road];
      if (edit.points) return [{ ...road, points: edit.points }];
      const { atStart, previous, length } = edit.cut;
      if (!previous) return [];
      const points = atStart ? slicePolyline(road.points, Math.max(0, previous.d - overshoot), length) : slicePolyline(road.points, 0, Math.min(length, previous.d + overshoot));
      return points.length > 1 ? [{ ...road, points }] : [];
    });
    // A street that stopped on a stretch cut away now runs a few metres past its last junction
    list = trimEnds(list, { overshoot, fixed });
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
    const { hits, cumulative } = crossings(list);
    list = list.filter((road, r) => held(fixed, road) || !isScrap(hits[r], cumulative[r][road.points.length - 1], stub));
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
    for (const node of nodes) if (component.get(node) !== biggest) for (const next of node.neighbors) { const r = roadOf(node, next); if (r !== undefined && !held(fixed, list[r])) drop.add(r); }
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
      if (length <= stub || chain.some(r => r === undefined || held(fixed, list[r]))) continue;
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
        // A loop's closure is no corner, nor is a road ending where one closes
        if (o === r || touched.has(o) || touched.has(r) || isLoop(road.points) || isLoop(other.points)) continue;
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
        const dogLeg = [[legA, 'a'], [legB, 'b']].filter(([leg, which]) => leg.junction !== null && leg.d < near && !held(fixed, which === 'a' ? road : other)).sort((x, y) => x[0].d - y[0].d)[0];
        if (dogLeg) {
          // Drop the short leg past its junction; the other road runs on to the junction
          const [leg, which] = dogLeg, short = which === 'a' ? a : b, long = which === 'a' ? b : a, longCorner = which === 'a' ? bCorner : aCorner;
          const junction = pointAt(short, leg.junction);
          const cut = slicePolyline(short, 0, leg.junction + overshoot);
          // Only the last stretch of the other road bends to the junction: moving
          // the end of a long straight segment would swing all of it, away from
          // every street that meets it
          const longLeg = which === 'a' ? legB : legA, bend = Math.min(20, longLeg.d * .5);
          const kept = slicePolyline(long, 0, Math.max(0, longCorner - bend));
          if (kept.length < 2) continue;
          kept.push(junction.clone());
          const heading = junction.clone().sub(kept[kept.length - 2]);
          if (heading.length() < 1) continue;
          kept.push(junction.clone().add(heading.normalize().multiplyScalar(overshoot)));
          if (which === 'a') { newA = cut; newB = kept; } else { newA = kept; newB = cut; }
        } else {
          // Round the corner: a curve from a point on one leg to a point on the other, tangent to both
          const radius = Math.min(radiusOf(road.kind), radiusOf(other.kind)), tangent = Math.min(radius * Math.tan(turn / 2), legA.d * .45, legB.d * .45);
          if (tangent < 1) continue;
          const s = pointAt(a, aCorner - tangent), e = pointAt(b, bCorner - tangent), steps = Math.max(4, Math.ceil(turn / ARC_STEP)), curve = [];
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
      if (held(fixed, road) || road.kind === 'path') return;
      const points = road.points, along = cumulative[r], total = along[points.length - 1];
      // The point `d` along the road (a search of the distances, not a slice: this runs every metre)
      const at = distance => {
        const d = Math.max(1e-6, Math.min(total, distance));
        let lo = 0, hi = points.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (along[mid] <= d) lo = mid; else hi = mid; }
        const length = along[hi] - along[lo], t = length > 1e-9 ? Math.min(1, (d - along[lo]) / length) : 0;
        return points[lo].clone().add(points[hi].clone().sub(points[lo]).multiplyScalar(t));
      };
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
