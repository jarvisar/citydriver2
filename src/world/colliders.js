// What the car cannot drive through. A chunk records the footprint of each
// solid thing as it stands it up, as plain data in the global coordinates the
// car and the traffic collide in, so the driving step never has to read a
// mesh. Positions come in as the chunk places them: x, and z measured from the
// chunk's own start.

// A rectangle turned by the object's own yaw, in the shape trafficContact reads.
export function solidBox(chunk, x, z, yaw, halfWidth, halfLength) {
  ((chunk.features ??= {}).colliders ??= []).push({ x, z: z - chunk.start, reach: Math.hypot(halfWidth, halfLength), heading: -yaw, halfWidth, halfLength });
}
// A wall or a block laid out between two points, this wide either side of the line.
export function solidSpan(chunk, a, b, halfWidth) {
  solidBox(chunk, (a.x + b.x) / 2, (a.z + b.z) / 2, Math.atan2(b.x - a.x, b.z - a.z), halfWidth, Math.hypot(b.x - a.x, b.z - a.z) / 2);
}
// A trunk, a silo, a tank: anything near enough round.
export function solidPost(chunk, x, z, radius) {
  ((chunk.features ??= {}).colliders ??= []).push({ x, z: z - chunk.start, reach: radius });
}

// The outline of a model's lowest quarter is what a car can reach: the walls
// and the trunk, not the eaves or a crown overhead.
const footprints = new WeakMap();
function footprint(geometry) {
  if (!footprints.has(geometry)) {
    const position = geometry.attributes.position;
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < position.count; i++) { low = Math.min(low, position.getY(i)); high = Math.max(high, position.getY(i)); }
    const reach = low + (high - low) / 4;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) > reach) continue;
      const x = position.getX(i), z = position.getZ(i);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    footprints.set(geometry, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, halfWidth: (x1 - x0) / 2, halfLength: (z1 - z0) / 2 });
  }
  return footprints.get(geometry);
}
// Whatever is placed with this geometry, position, yaw and uniform scale.
export function solidModel(chunk, geometry, p, yaw = 0, scale = 1, round = false) {
  const f = footprint(geometry), cos = Math.cos(yaw), sin = Math.sin(yaw);
  const x = p[0] + (f.x * cos + f.z * sin) * scale, z = p[2] + (f.z * cos - f.x * sin) * scale;
  if (round) solidPost(chunk, x, z, Math.max(f.halfWidth, f.halfLength) * scale);
  else solidBox(chunk, x, z, yaw, f.halfWidth * scale, f.halfLength * scale);
}

// Andrew's monotone chain: the outline a band stretched round the points takes.
export function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 4) return sorted;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of sorted.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// A building with wings has hollows in its outline: the yard in the crook of
// an L, the court of a U, the inside of a front that follows a curve. Its
// hull closed them all with a wall nobody could see. A hollow stays closed
// only where it is shallower than SHALLOW (sills, pilasters and awnings stand
// as far out from a wall), or its mouth is narrower than NARROW: nobody on
// foot fits into it (they are .64 m across), so open it would only be a notch
// for a car's corner or a loose bin to catch in. A wall of the collider may
// stand INSIDE within the wall as drawn, where that spares a corner.
const SHALLOW = .2, NARROW = 1.2, INSIDE = .02;
// A cut ends this far from the end of the wall it meets, or more
const END = .3;
const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const span = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const area = points => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2;
// The sine of the turn at a corner of an anticlockwise outline: under 0 it turns the wrong way
function turn(points, i) {
  const n = points.length, a = points[(i + n - 1) % n], p = points[i], b = points[(i + 1) % n];
  return cross(a, p, b) / ((span(a, p) * span(p, b)) || 1);
}
const TURN = 1e-6, reflex = (points, i) => turn(points, i) < -TURN;
const angle = (p, a, b) => Math.abs(Math.atan2((a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x), (a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)));

// A hollow's wall from one end of its mouth to the other (the building on its
// left, so a corner left of a chord is a hollow under the chord), straight
// across every hollow in it with a mouth under NARROW, however deep
function closeNarrow(chain) {
  const out = [chain[0]];
  for (let i = 0; i < chain.length - 1;) {
    let k = chain.length - 1;
    for (; k > i + 1; k--) {
      const a = chain[i], b = chain[k], length = span(a, b);
      if (length < NARROW && chain.slice(i + 1, k).every(p => cross(a, b, p) >= -INSIDE * length)) break;
    }
    out.push(chain[k]); i = k;
  }
  return out;
}
// and with as few of its corners as keep it within SHALLOW outside the wall
// as drawn and INSIDE within it, the furthest out kept first: a front round
// a curve has a corner every 2 m
function ease(chain) {
  const out = [chain[0]];
  const run = (i, k) => {
    const a = chain[i], b = chain[k], length = span(a, b) || 1;
    let worst = -1, most = 0;
    for (let m = i + 1; m < k; m++) {
      const d = cross(a, b, chain[m]) / length, over = Math.max(d - SHALLOW, -INSIDE - d);
      if (over > most) { most = over; worst = m; }
    }
    if (worst < 0) out.push(b);
    else { run(i, worst); run(worst, k); }
  };
  run(0, chain.length - 1);
  return out;
}
// Whether no two walls of an outline cross
function simple(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = points[i], b = points[i + 1], c = points[j], d = points[(j + 1) % n];
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
  }
  return true;
}
// The outline to collide with: the hull, with each hollow that is to be open
// let into it. Null where none is: the hull will do.
function openOutline(ring, hull) {
  const points = area(ring) < 0 ? ring.slice().reverse() : ring, n = points.length, on = new Set(hull), first = points.findIndex(p => on.has(p));
  const outline = [];
  for (let k = 0; k < n;) {
    const chain = [points[(first + k) % n]];
    do chain.push(points[(first + ++k) % n]); while (!on.has(chain.at(-1)));
    outline.push(...(chain.length > 2 ? ease(closeNarrow(chain)) : chain).slice(0, -1));
  }
  return outline.some((p, i) => reflex(outline, i)) && simple(outline) ? outline : null;
}

// Where the ray from corner i of an outline along (dx, dy) first meets a wall
// that does not end at that corner: { k, u, x, y }, the wall from corner k and
// how far along it, or null
function rayHit(points, i, dx, dy) {
  const n = points.length, p = points[i];
  let best = null, nearest = Infinity;
  for (let k = 0; k < n; k++) {
    if (k === i || (k + 1) % n === i) continue;
    const a = points[k], b = points[(k + 1) % n], ex = b.x - a.x, ey = b.y - a.y, det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-12) continue;
    const wx = a.x - p.x, wy = a.y - p.y, t = (wx * ey - wy * ex) / det, u = (wx * dy - wy * dx) / det;
    if (t > 1e-7 && t < nearest && u >= -1e-9 && u <= 1 + 1e-9) { nearest = t; best = { k, u: Math.min(1, Math.max(0, u)), x: p.x + dx * t, y: p.y + dy * t }; }
  }
  return best;
}
// Whether corner i sees q, a corner (j) or a point along a wall (from corner
// `wall`): nothing else of the outline touches the line between them
function sees(points, i, q, j, wall = -1) {
  const n = points.length, p = points[i];
  for (let k = 0; k < n; k++) {
    const l = (k + 1) % n;
    if (k === i || l === i || k === j || l === j || k === wall) continue;
    const a = points[k], b = points[l], o1 = cross(p, q, a), o2 = cross(p, q, b), o3 = cross(a, b, p), o4 = cross(a, b, q);
    if (o1 * o2 > 0 || o3 * o4 > 0) continue;
    // (in one line: they touch if their spans overlap)
    if (o1 === 0 && o2 === 0 && (Math.max(a.x, b.x) < Math.min(p.x, q.x) || Math.min(a.x, b.x) > Math.max(p.x, q.x) || Math.max(a.y, b.y) < Math.min(p.y, q.y) || Math.min(a.y, b.y) > Math.max(p.y, q.y))) continue;
    return false;
  }
  return true;
}
// An outline ({ points, seams }, anticlockwise) cut into convex pieces, added
// to `pieces`: the best cut from a corner that turns the wrong way, then each
// half the same way. A cut runs across to the wall facing the corner, on
// along one of the corner's own walls or between them, or to another such
// corner. It never ends at a corner the building really has: each piece keeps
// both walls of every real corner it has, which is what footprintContact
// puts a car out by. False if it cannot be done.
function cut(shape, pieces, depth = 0) {
  const { points, seams } = shape, n = points.length;
  let best = null, hollow = false;
  // (shorter is better, and wider at its ends: a cut that leaves a sliver costs many times its length)
  const offer = (i, target, length, thin, both) => {
    const cost = length / Math.sin(Math.min(Math.PI / 2, Math.max(.01, thin))) ** 2 * (both ? .5 : 1);
    if (!best || cost < best.cost) best = { i, ...target, cost };
  };
  for (let i = 0; i < n && depth < 24; i++) {
    if (!reflex(points, i)) continue;
    hollow = true;
    const p = points[i], before = points[(i + n - 1) % n], after = points[(i + 1) % n];
    // (between the lines of this corner's walls, so the cut straightens it both sides)
    const between = q => cross(before, p, q) >= -1e-9 && cross(p, after, q) >= -1e-9;
    const corner = j => {
      const q = points[j], a = points[(j + n - 1) % n], b = points[(j + 1) % n];
      if (j === i || (j + 1) % n === i || (i + 1) % n === j || !reflex(points, j) || !between(q) || !sees(points, i, q, j)) return;
      offer(i, { j }, span(p, q), Math.min(angle(p, before, q), angle(p, after, q), angle(q, p, a), angle(q, p, b)), cross(a, q, p) >= 0 && cross(q, b, p) >= 0);
    };
    for (let j = 0; j < n; j++) corner(j);
    const d1 = { x: (p.x - before.x) / span(before, p), y: (p.y - before.y) / span(before, p) }, d2 = { x: (p.x - after.x) / span(after, p), y: (p.y - after.y) / span(after, p) };
    const mid = Math.hypot(d1.x + d2.x, d1.y + d2.y) > 1e-6 ? { x: d1.x + d2.x, y: d1.y + d2.y } : { x: -d1.y, y: d1.x }, length = Math.hypot(mid.x, mid.y);
    for (const d of [{ x: mid.x / length, y: mid.y / length }, d1, d2]) {
      const hit = rayHit(points, i, d.x, d.y);
      if (!hit) continue;
      const k = hit.k, l = (k + 1) % n, a = points[k], b = points[l], wall = span(a, b);
      // (too near the wall's end: that corner itself if it turns the wrong way too, else END along the wall from it)
      const near = hit.u * wall < END ? k : (1 - hit.u) * wall < END ? l : -1;
      if (near >= 0 && reflex(points, near)) { corner(near); continue; }
      if (near >= 0) {
        if (wall < 2 * END) continue;
        const u = near === k ? END / wall : 1 - END / wall;
        hit.x = a.x + (b.x - a.x) * u; hit.y = a.y + (b.y - a.y) * u;
        if (!between(hit) || !sees(points, i, hit, -1, k)) continue;
      }
      offer(i, { k, x: hit.x, y: hit.y }, span(p, hit), Math.min(angle(p, before, hit), angle(p, after, hit), angle(hit, p, a), angle(hit, p, b)), false);
    }
  }
  if (!hollow) { pieces.push(shape); return true; }
  if (!best) return false;
  let { i, j } = best;
  // (a new corner where the cut meets a wall, both halves of the wall as it was)
  if (j === undefined) {
    j = best.k + 1;
    points.splice(j, 0, { x: best.x, y: best.y }); seams.splice(j, 0, seams[best.k]);
    if (i >= j) i++;
  }
  const count = points.length;
  const half = (from, to) => {
    const part = { points: [], seams: [] };
    for (let k = from; ; k = (k + 1) % count) { part.points.push(points[k]); if (k === to) break; part.seams.push(seams[k]); }
    part.seams.push(true);
    return part;
  };
  return cut(half(i, j), pieces, depth + 1) && cut(half(j, i), pieces, depth + 1);
}
// A building's outline (points { x, y }) as the convex pieces to collide
// with: [{ points, seams }], `seams` marking the edges (from each point to the
// next) where a piece meets the next piece and not the open air. An outline
// that is convex, or near enough (see SHALLOW), is its hull in one piece
// with no seams, as every building's once was.
export function convexPieces(ring) {
  const hull = convexHull(ring), whole = [{ points: hull }];
  if (hull.length < 3 || ring.length <= hull.length) return whole;
  const outline = openOutline(ring, hull), pieces = [];
  if (!outline || !cut({ points: outline.slice(), seams: outline.map(() => false) }, pieces)) return whole;
  // (nothing lost or doubled, and every piece convex: else the hull, as before)
  const sound = pieces.every(piece => piece.points.length >= 3 && area(piece.points) > 1e-3 && piece.points.every((p, i) => turn(piece.points, i) > -1e-4));
  return sound && Math.abs(pieces.reduce((sum, piece) => sum + area(piece.points), 0) - area(outline)) < 1e-6 * area(outline) ? pieces : whole;
}
// A building's footprint stood up to collide with, `top` its roof's height
// (see CityChunk.polygonSolid): a solid for each convex piece of its outline,
// most often one. The pieces of one footprint know their `seams` (see
// convexPieces) and its `hull`, as [u, s], which the lawns' fringe keeps off.
export function footprintSolids(c, ring, top) {
  if (c.distant) return [];
  const pieces = convexPieces(ring), solids = [];
  const hull = pieces.length > 1 ? convexHull(ring).map(p => [c.east + p.x, c.start + p.y]) : null;
  for (const piece of pieces) {
    const solid = c.polygonSolid(piece.points.map(p => [p.x, p.y]), top);
    if (!solid) continue;
    if (hull) { solid.seams = piece.seams; solid.hull = hull; }
    solids.push(solid);
  }
  return solids;
}
