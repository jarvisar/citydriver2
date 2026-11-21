import { CHUNK_LENGTH, clamp } from './world/route.js';
import { contactPoint, leadingPoint } from './impact.js';
import { profileHeight } from './car-profile.js';

// Two cars' boxes drawn in by `ra` and `rb` all round, on four separating
// axes: the way out for `a` (from b to a) and how far, or null if they are apart.
function boxContact(a, b, ra = 0, rb = 0) {
  const axes = car => [{ x: Math.cos(car.heading), z: Math.sin(car.heading) }, { x: Math.sin(car.heading), z: -Math.cos(car.heading) }];
  const aa = axes(a), ba = axes(b), dx = a.x - b.x, dz = a.z - b.z;
  const dot = (u, v) => u.x * v.x + u.z * v.z;
  const radius = (car, basis, axis, r) => (car.halfWidth - r) * Math.abs(dot(basis[0], axis)) + (car.halfLength - r) * Math.abs(dot(basis[1], axis));
  let contact = null;
  for (const axis of [...aa, ...ba]) {
    const distance = dx * axis.x + dz * axis.z;
    const depth = radius(a, aa, axis, ra) + radius(b, ba, axis, rb) - Math.abs(distance);
    if (depth <= 0) return null;
    if (!contact || depth < contact.depth) {
      const sign = distance < 0 ? -1 : 1;
      contact = { x: axis.x * sign, z: axis.z * sign, depth };
    }
  }
  return contact;
}
// Car against car, both with their corners rounded to CAR_ROUND (less on a
// very small car). Square on, or one's side to the other's nose, they meet
// flat, as boxes. Overlapping only by a corner they meet on the curves, at a
// slant: clipping the back corner of a car in the way shoulders the two
// apart instead of stopping the faster one dead, the more the less they
// overlap. (As square boxes any touch from behind was a square hit, and the
// commonest collision in the game, catching a queueing car's corner, cost
// half the car's speed.) All collision coordinates are independent of render origin.
const CAR_ROUND = .45;
const roundOf = car => Math.min(CAR_ROUND, Math.min(car.halfWidth, car.halfLength) * .6);
const boxCorners = (car, r, cos = Math.cos(car.heading), sin = Math.sin(car.heading)) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([side, end]) => ({
  x: car.x + cos * (car.halfWidth - r) * side + sin * (car.halfLength - r) * end, z: car.z + sin * (car.halfWidth - r) * side - cos * (car.halfLength - r) * end }));
// The nearest point of a car's box drawn in by `r` to (px, pz)
function nearestOnBox(px, pz, car, r, out) {
  const cos = Math.cos(car.heading), sin = Math.sin(car.heading), dx = px - car.x, dz = pz - car.z;
  const across = clamp(dx * cos + dz * sin, r - car.halfWidth, car.halfWidth - r), along = clamp(dx * sin - dz * cos, r - car.halfLength, car.halfLength - r);
  out.x = car.x + cos * across + sin * along; out.z = car.z + sin * across - cos * along;
  return out;
}
const NEAR = { x: 0, z: 0 };
export function trafficContact(a, b) {
  const flat = boxContact(a, b);
  if (!flat) return null;
  const ra = roundOf(a), rb = roundOf(b);
  // Their boxes less the rounding still overlap: they are well into each other, and meet as boxes
  if (boxContact(a, b, ra, rb)) return flat;
  // Otherwise the nearest the two drawn-in boxes come: a corner of one to the other
  let best = Infinity, x = 0, z = 0;
  for (const p of boxCorners(a, ra)) {
    const q = nearestOnBox(p.x, p.z, b, rb, NEAR), d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < best) { best = d; x = p.x - q.x; z = p.z - q.z; }
  }
  for (const p of boxCorners(b, rb)) {
    const q = nearestOnBox(p.x, p.z, a, ra, NEAR), d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < best) { best = d; x = q.x - p.x; z = q.z - p.z; }
  }
  if (best < 1e-6) return flat;
  const depth = ra + rb - best;
  return depth > 0 ? { x: x / best, z: z / best, depth } : null;
}

// A car's corners are rounded to this radius. Whatever catches one meets it at
// a slant, so a clipped post or corner glances the car aside rather than
// stopping it dead, the more the smaller the overlap; and a corner that only
// reaches where a square one would be misses it altogether.
const ROUND = .4;

// A round footprint against the car, answering as trafficContact does: the
// way out for the car, and how far. `point` is where they touch.
export function postContact(car, post) {
  const cos = Math.cos(car.heading), sin = Math.sin(car.heading), dx = post.x - car.x, dz = post.z - car.z;
  // The post in the car's own frame, across it and then along it, measured
  // from the car drawn in by its rounding.
  const across = dx * cos + dz * sin, along = dx * sin - dz * cos, halfWidth = car.halfWidth - ROUND, halfLength = car.halfLength - ROUND;
  const nearAcross = clamp(across, -halfWidth, halfWidth), nearAlong = clamp(along, -halfLength, halfLength);
  let x = across - nearAcross, z = along - nearAlong;
  const distance = Math.hypot(x, z);
  let depth = post.reach + ROUND - distance;
  if (depth <= 0) return null;
  if (distance > 1e-6) { x /= distance; z /= distance; }
  else {
    // The post's center is already under the car: leave by the nearer side.
    const side = halfWidth - Math.abs(across), end = halfLength - Math.abs(along);
    x = side < end ? Math.sign(across) || 1 : 0; z = side < end ? 0 : Math.sign(along) || 1;
    depth = post.reach + ROUND + Math.min(side, end);
  }
  const a = nearAcross + x * ROUND, b = nearAlong + z * ROUND;
  return { x: -(x * cos + z * sin), z: -(x * sin - z * cos), depth, point: { x: car.x + a * cos + b * sin, z: car.z + a * sin - b * cos } };
}

// Whether one piece of a building's footprint (`seams`, see convexPieces in
// world/colliders.js) may put a car out the way `sign` its corners'
// `projection` runs: through one of the building's walls, or past a corner
// the building has, both of whose walls are this piece's. Never across a seam
// into the next piece: a car sliding along a wall would be stopped dead where
// the pieces meet. `edge` is the piece's own edge the way is square to, or -1.
function wayOut(seams, projection, sign, edge) {
  const n = seams.length;
  let far = 0;
  for (let k = 1; k < n; k++) if (projection[k] * sign > projection[far] * sign) far = k;
  if (edge >= 0 && (projection[far] - projection[edge]) * sign < 1e-6) return !seams[edge];
  return !seams[far] && !seams[(far + n - 1) % n];
}
// Buildings can have oblique footprints where a neighborhood bends. Test the
// actual convex footprint rather than its larger axis-aligned bounding box.
// Answers as postContact does.
export function footprintContact(car, solid) {
  const cos = Math.cos(car.heading), sin = Math.sin(car.heading), seams = solid.seams;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({
    x: car.x + x * car.halfWidth * cos + z * car.halfLength * sin,
    z: car.z + x * car.halfWidth * sin - z * car.halfLength * cos,
  }));
  let contact = null;
  for (const polygon of [corners, solid.corners]) for (let i = 0; i < (polygon === corners ? 2 : polygon.length); i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-8) continue;
    const x = -(b.z - a.z) / length, z = (b.x - a.x) / length;
    const carProjection = corners.map(p => p.x * x + p.z * z), solidProjection = solid.corners.map(p => p.x * x + p.z * z);
    const left = Math.max(...solidProjection) - Math.min(...carProjection);
    const right = Math.max(...carProjection) - Math.min(...solidProjection);
    if (left <= 0 || right <= 0) return null;
    const depth = Math.min(left, right), sign = left < right ? 1 : -1;
    if (seams && !wayOut(seams, solidProjection, sign, polygon === corners ? -1 : i)) continue;
    if (!contact || depth < contact.depth) contact = { x: x * sign, z: z * sign, depth };
  }
  // (a piece in the middle of a footprint: the pieces round it have the walls)
  if (!contact) return null;
  // The car's corners inside the solid (behind a piece's walls, on past its
  // seams: a corner in the next piece is as far into the building), and the
  // solid's inside the car
  const pierced = corners.filter(p => insideConvex(p, solid.corners, .02, seams)), caught = [];
  for (let k = 0; k < solid.corners.length; k++) {
    // (where a seam meets a wall is no corner to catch on)
    if (seams && (seams[k] || seams[(k + seams.length - 1) % seams.length])) continue;
    const p = solid.corners[k];
    const dx = p.x - car.x, dz = p.z - car.z, across = dx * cos + dz * sin, along = dx * sin - dz * cos;
    if (Math.abs(across) <= car.halfWidth + .02 && Math.abs(along) <= car.halfLength + .02) caught.push({ p, across, along });
  }
  // A single corner of the solid in one of the car's rounded corners, and
  // nothing else overlapping: they touch on the curve, if at all
  if (caught.length === 1) {
    const { p, across, along } = caught[0], a = car.halfWidth - ROUND, b = car.halfLength - ROUND;
    const own = corners[[[-1, -1], [1, -1], [1, 1], [-1, 1]].findIndex(([x, z]) => x === Math.sign(across) && z === Math.sign(along))];
    if (Math.abs(across) > a && Math.abs(along) > b && pierced.every(q => q === own)) {
      const x = across - Math.sign(across) * a, z = along - Math.sign(along) * b, distance = Math.hypot(x, z);
      if (distance >= ROUND) return null;
      return { x: -(x * cos + z * sin) / distance, z: -(x * sin - z * cos) / distance, depth: ROUND - distance, point: p };
    }
  }
  // Where they touch, as contactPoint finds it for two cars: the middle of
  // the corners each has put inside the other
  const touching = [...pierced, ...caught.map(c => c.p)];
  contact.point = touching.length ? { x: touching.reduce((sum, p) => sum + p.x, 0) / touching.length, z: touching.reduce((sum, p) => sum + p.z, 0) / touching.length } : leadingPoint(car, contact);
  return contact;
}
// A round footprint (someone on foot, `radius` across) against a standing
// thing, answering as postContact does. It slides round a corner rather than
// catching on it, whichever way it meets it.
export function circleContact(circle, solid) {
  const r = circle.radius;
  if (solid.heading === undefined && !solid.corners) {
    const dx = circle.x - solid.x, dz = circle.z - solid.z, distance = Math.hypot(dx, dz), depth = r + solid.reach - distance;
    if (depth <= 0) return null;
    const x = distance > 1e-6 ? dx / distance : 1, z = distance > 1e-6 ? dz / distance : 0;
    return { x, z, depth, point: { x: solid.x + x * solid.reach, z: solid.z + z * solid.reach } };
  }
  // The nearest point of the outline; from inside, the way out is through the nearest edge
  const corners = (solid.corners ? solid : boxOutline(solid)).corners, seams = solid.seams, n = corners.length;
  let best = Infinity, nx = 0, nz = 0, edge = null, end = -1;
  for (let i = 0; i < n; i++) {
    // (one piece of a footprint, see convexPieces in world/colliders.js: only its walls, not its seams with the next)
    if (seams?.[i]) continue;
    const a = corners[i], b = corners[(i + 1) % n], ex = b.x - a.x, ez = b.z - a.z, length = ex * ex + ez * ez;
    const along = length > 1e-12 ? ((circle.x - a.x) * ex + (circle.z - a.z) * ez) / length : 0, t = clamp(along, 0, 1);
    const px = a.x + ex * t, pz = a.z + ez * t, d = (circle.x - px) ** 2 + (circle.z - pz) ** 2;
    if (d < best) { best = d; nx = px; nz = pz; edge = [a, b]; end = along < 0 ? i : along > 1 ? (i + 1) % n : -1; }
  }
  if (!edge) return null;
  // The roof queries' 2 cm allowance would treat a point just outside as
  // inside and push it into the wall.
  const inside = insideConvex(circle, corners, 0), dx = circle.x - nx, dz = circle.z - nz, distance = Math.sqrt(best);
  if (!inside && distance >= r) return null;
  // Outside a piece, its nearest wall is only where they touch if it is the
  // piece's nearest edge too: met on its outer side, or at a corner the
  // building has (both its walls this piece's). Otherwise the piece is
  // nearest across a seam, and the next piece's wall is the one in the way.
  if (seams && !inside && (end < 0 ? dx * (solid.x - nx) + dz * (solid.z - nz) >= 0 : seams[end] || seams[(end + n - 1) % n])) return null;
  const sign = inside ? -1 : 1;
  let x = sign * dx / distance, z = sign * dz / distance;
  if (distance <= 1e-6) {
    const [a, b] = edge, length = Math.hypot(b.x - a.x, b.z - a.z);
    x = (b.z - a.z) / length; z = -(b.x - a.x) / length;
    const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length, cz = corners.reduce((sum, p) => sum + p.z, 0) / corners.length;
    if (x * (cx - a.x) + z * (cz - a.z) > 0) { x = -x; z = -z; }
  }
  return { x, z, depth: inside ? r + distance : r - distance, point: { x: nx, z: nz } };
}
// The outline of a rectangle turned by its heading, as trafficContact reads one.
function boxOutline(box) {
  const cos = Math.cos(box.heading), sin = Math.sin(box.heading);
  return { corners: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({
    x: box.x + x * box.halfWidth * cos + z * box.halfLength * sin, z: box.z + x * box.halfWidth * sin - z * box.halfLength * cos,
  })) };
}
// Whether a point stands inside (or within 2 cm of) a convex outline, whichever
// way round it runs: with `open`, on past its edges marked there.
export function insideConvex(p, polygon, margin = .02, open = null) {
  let sign = 0;
  // (no longer shut in all round, so which side is inside comes from the way the outline runs)
  if (open) sign = Math.sign(polygon.reduce((sum, a, i) => { const b = polygon[(i + 1) % polygon.length]; return sum + a.x * b.z - b.x * a.z; }, 0));
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-8 || open?.[i]) continue;
    const cross = ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / length;
    if (Math.abs(cross) <= margin) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

// Whatever stands in `chunks` that a car's footprint overlaps, handed to
// `visit(contact, solid)` one at a time. `box()` answers where the car is now,
// since each contact may move it; one with a `radius` is round, as someone on
// foot is (see circleContact). Nearly every footprint is turned away by two
// subtractions, so a chunk's few hundred cost less than posing one traffic car.
// A parked car knocked loose (`woken`) is no longer scenery.
function carContact(car, solid) {
  const contact = trafficContact(car, solid);
  if (contact) contact.point = contactPoint(car, solid, contact);
  return contact;
}
export function sceneryContacts(box, chunks, visit) {
  let car = box();
  const reach = car.radius ?? Math.hypot(car.halfWidth, car.halfLength);
  for (const chunk of chunks) {
    const bounds = chunk?.collisionBounds;
    if (bounds && (car.x + reach < bounds.minX || car.x - reach > bounds.maxX || car.z + reach < bounds.minZ || car.z - reach > bounds.maxZ)) continue;
    const colliders = chunk?.features?.colliders;
    if (!colliders) continue;
    for (const solid of colliders) {
      if (solid.woken || Math.abs(solid.z - car.z) > reach + solid.reach || Math.abs(solid.x - car.x) > reach + solid.reach) continue;
      // (a car at the curb is met as one in the road is, both with their corners rounded: see trafficContact)
      const contact = car.radius ? circleContact(car, solid) : solid.heading === undefined && !solid.corners ? postContact(car, solid)
        : solid.parked && solid.halfWidth !== undefined ? carContact(car, solid) : footprintContact(car, solid.corners ? solid : boxOutline(solid));
      if (contact) { visit(contact, solid); car = box(); }
    }
  }
}
// How far the chase camera keeps off a building's footprint: shop awnings and
// balconies stand up to about 2 m out from its walls. With the car itself
// nearer a wall than that, it keeps at least CLOSE off that one.
const CLEAR = 2.2, CLOSE = .5;
// Room for a camera's near plane in any look direction. Keep the same allowance
// for eaves and awnings as the chase sight line, including above a roof.
export function cameraClearance(chunks, point, origin = 0) {
  const radius = 1 + CLEAR, circle = { x: point.x, z: point.z - origin, radius };
  let room = radius;
  for (const chunk of chunks) {
    const bounds = chunk?.collisionBounds;
    if (!bounds || circle.x + radius < bounds.minX || circle.x - radius > bounds.maxX
      || circle.z + radius < bounds.minZ || circle.z - radius > bounds.maxZ) continue;
    for (const solid of chunk.features.colliders) {
      if (solid.shape) continue;
      const above = Math.max(0, point.y - (solid.ridge ?? solid.top ?? Infinity));
      if (above >= room || Math.abs(circle.x - solid.x) > solid.reach + radius || Math.abs(circle.z - solid.z) > solid.reach + radius) continue;
      const contact = circleContact(circle, solid);
      if (contact) room = Math.min(room, Math.hypot(Math.max(0, radius - contact.depth), above));
    }
  }
  return Math.max(.1, room - CLEAR);
}
// Someone on foot is framed low (see Walker), so cars come between them and
// the camera too: they count ROOF high, and the camera keeps CAR_CLEAR off them.
const ROOF = 2.1, CAR_CLEAR = .35;
// How far along the chase camera's line of sight, from `from` over the car to
// `to` where the camera would be, it first comes within CLEAR of a building
// below the building's roof: 0 to 1, and 1 if it never does. Only solids with
// a `top` (buildings) count, so the camera sees over walls and hedges and
// through trees and railings; and with `cars` ({ ground, bodies }), for a
// camera following someone on foot, the cars parked along the curbs and
// `bodies` ({ x, z, heading, halfWidth, halfLength, y }: the traffic, and the
// player's own car) as well. Points are in the scene, which lies `origin`
// along z from the colliders.
export function sightLine(chunks, from, to, origin = 0, cars = null) {
  const x = from.x, z = from.z - origin, dx = to.x - from.x, dz = to.z - from.z;
  const minX = Math.min(x, x + dx) - CLEAR, maxX = Math.max(x, x + dx) + CLEAR, minZ = Math.min(z, z + dz) - CLEAR, maxZ = Math.max(z, z + dz) + CLEAR;
  let open = 1;
  // (the line over a footprint from `enter` to `leave` along it, under a roof `top`)
  const under = (enter, leave, top) => {
    // Intersect the height interval as well as the footprint. A descending
    // lens can hit a roof after entering above it, even starting over the roof.
    // Returning the 2D entry either missed that roof or pulled in much too far.
    const dy = to.y - from.y, ceiling = top + CLOSE;
    if (Math.abs(dy) < 1e-9) { if (from.y >= ceiling) return; }
    else if (dy < 0) enter = Math.max(enter, (ceiling - from.y) / dy);
    else leave = Math.min(leave, (ceiling - from.y) / dy);
    // If the player starts inside the actual volume there is nowhere better
    // along this ray; a roof entry from above still has a positive fraction.
    if (enter >= 0 && enter <= Math.min(leave, 1) && enter < open) open = enter;
  };
  const block = (solid, top, clear) => {
    let crossing = lineThrough(solid, x, z, dx, dz, clear);
    if (crossing?.[0] < 0 && clear > CLOSE) crossing = lineThrough(solid, x, z, dx, dz, CLOSE);
    if (crossing) under(crossing[0], crossing[1], top);
  };
  // A footprint in pieces, one after another from `first` (see footprintSolids
  // in world/colliders.js), is one building: with the car nearer than CLEAR
  // to any of it the camera keeps CLOSE off all of it, and the pieces the line
  // runs through one into the next are one stretch of it. Piece by piece, a
  // camera following a car along its wall was pulled in at every seam.
  const blockPieces = (colliders, first) => {
    const hull = colliders[first].hull;
    let spans = [], last = first;
    for (; colliders[last]?.hull === hull; last++) { const crossing = lineThrough(colliders[last], x, z, dx, dz, CLEAR); if (crossing) spans.push(crossing); }
    if (spans.some(span => span[0] < 0)) spans = colliders.slice(first, last).map(piece => lineThrough(piece, x, z, dx, dz, CLOSE)).filter(Boolean);
    spans.sort((a, b) => a[0] - b[0]);
    for (let j = 0; j < spans.length; j++) {
      let [enter, leave] = spans[j];
      while (j + 1 < spans.length && spans[j + 1][0] <= leave) leave = Math.max(leave, spans[++j][1]);
      under(enter, leave, colliders[first].ridge ?? colliders[first].top);
    }
  };
  const outside = (at, reach) => at.x - reach > maxX || at.x + reach < minX || at.z - reach > maxZ || at.z + reach < minZ;
  for (const chunk of chunks) {
    // (a chunk still being built has no bounds, nor its colliders' corners)
    const bounds = chunk?.collisionBounds;
    if (!bounds || maxX < bounds.minX || minX > bounds.maxX || maxZ < bounds.minZ || minZ > bounds.maxZ) continue;
    const colliders = chunk.features.colliders;
    let hull = null, first = 0;
    for (let i = 0; i < colliders.length; i++) {
      const solid = colliders[i], car = cars && solid.parked && !solid.woken;
      if ((solid.hull ?? null) !== hull) { hull = solid.hull ?? null; first = i; }
      // (and a post, a trunk or a lamp, the camera would stand inside: it
      // comes in to just before it, rather than look out through it)
      if (cars && solid.heading === undefined && !solid.corners) { if (!outside(solid, solid.reach)) open = Math.min(open, postEnd(solid, x, z, dx, dz)); continue; }
      // (a ramp or a mound is low enough to see over)
      if ((solid.top === undefined && !car) || solid.shape || outside(solid, solid.reach)) continue;
      // (the pieces of one footprint together, at the first of them the line comes near)
      if (hull) { if (first >= 0) blockPieces(colliders, first); first = -1; continue; }
      block(solid, car ? cars.ground + ROOF : solid.ridge ?? solid.top, car ? CAR_CLEAR : CLEAR);
    }
  }
  for (const body of cars?.bodies ?? []) {
    const reach = Math.hypot(body.halfWidth, body.halfLength);
    if (!outside(body, reach)) block({ ...boxOutline(body), x: body.x, z: body.z }, body.y + ROOF, CAR_CLEAR);
  }
  return open;
}
// Where the line from (x, z) along (dx, dz) enters a post, grown by
// CAR_CLEAR, if it ends inside it (and does not start there), as a fraction
// along it; otherwise 1
function postEnd(post, x, z, dx, dz) {
  const r = post.reach + CAR_CLEAR, ex = x + dx - post.x, ez = z + dz - post.z;
  if (ex * ex + ez * ez >= r * r) return 1;
  const fx = x - post.x, fz = z - post.z, a = dx * dx + dz * dz, b = fx * dx + fz * dz, c = fx * fx + fz * fz - r * r;
  if (c <= 0 || a < 1e-12) return 1;
  return Math.max(0, (-b - Math.sqrt(Math.max(0, b * b - a * c))) / a);
}
// Where the line from (x, z) along (dx, dz) enters and leaves a convex outline
// grown by `grow` all round, as fractions along it, or null if it misses. Its
// corners are beveled, so a sharp one grows no long spike.
function lineThrough(solid, x, z, dx, dz, grow) {
  const corners = solid.corners, edges = [];
  let enter = -Infinity, leave = Infinity;
  // (keeps what of the line lies within `grow` of the inner side of a line through a, facing n)
  const cut = (a, nx, nz) => {
    const out = nx * (x - a.x) + nz * (z - a.z) - grow, rate = nx * dx + nz * dz;
    if (Math.abs(rate) < 1e-12) return out <= 0;
    if (rate < 0) enter = Math.max(enter, -out / rate); else leave = Math.min(leave, -out / rate);
    return enter <= leave;
  };
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-8) continue;
    // (the edge's normal, turned away from the middle)
    let nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
    if (nx * (solid.x - a.x) + nz * (solid.z - a.z) > 0) { nx = -nx; nz = -nz; }
    if (!cut(a, nx, nz)) return null;
    edges.push([a, nx, nz]);
  }
  // (each corner cut square to halfway between its two edges)
  for (let i = 0; i < edges.length; i++) {
    const [a, nx, nz] = edges[i], [, px, pz] = edges.at(i - 1), bx = nx + px, bz = nz + pz, length = Math.hypot(bx, bz);
    if (length > 1e-6 && !cut(a, bx / length, bz / length)) return null;
  }
  return leave < 0 ? null : [enter, leave];
}
// The highest roof under any of `points` ({ x, z }, as the colliders lie) no
// higher than `below`, or -Infinity: what a flying machine can set down on. A
// pitched roof counts to its ridge. A machine (`machine`) is held up only by
// roofs under all its feet, never hanging off an edge, and never by the plant
// and tanks up there (`clutter`), which someone on foot can climb onto: it
// perched on water tanks, with no room to get out.
export function roofUnder(chunks, points, below, machine = false) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, best = -Infinity, held = 0;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  for (const chunk of chunks) {
    const bounds = chunk?.collisionBounds;
    if (!bounds || maxX < bounds.minX || minX > bounds.maxX || maxZ < bounds.minZ || minZ > bounds.maxZ) continue;
    for (const solid of chunk.features.colliders) {
      if (solid.top === undefined || (machine && solid.clutter) || solid.x - solid.reach > maxX || solid.x + solid.reach < minX || solid.z - solid.reach > maxZ || solid.z + solid.reach < minZ) continue;
      // (a ramp or a mound by its slope under each point)
      if (solid.shape) {
        let inside = 0, top = -Infinity;
        for (let i = 0; i < points.length; i++) {
          if (!insideConvex(points[i], solid.corners)) continue;
          const h = shapeHeight(solid.shape, points[i]);
          if (h <= below) { inside |= 1 << i; top = Math.max(top, h); }
        }
        if (inside) { held |= inside; best = Math.max(best, top); }
        continue;
      }
      const top = solid.ridge ?? solid.top;
      if (top > below || (!machine && top <= best)) continue;
      let inside = 0;
      for (let i = 0; i < points.length; i++) if (insideConvex(points[i], solid.corners)) inside |= 1 << i;
      if (inside) { held |= inside; best = Math.max(best, top); }
    }
  }
  return machine && held !== (1 << points.length) - 1 ? -Infinity : best;
}
// How high a building's roof is at p ({ x, z }), for someone standing on it:
// a flat roof at its top, a pitched one on its slope (`pitch`, see roofPitch
// in city-buildings.js), from its ridge down to its eaves. A ramp or a mound
// (`shape`, see shapeHeight) is its own slope.
export function roofSurface(solid, p) {
  if (solid.shape) return shapeHeight(solid.shape, p);
  const pitch = solid.pitch;
  if (!pitch) return solid.ridge ?? solid.top;
  const { from: a, to: b, run, eaves, gable } = pitch, dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length > 1e-9 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / length : 0;
  // (across from the ridge's line, and on a hip past its ends: each face is
  // a plane, and measured straight from the ridge they sank into the hips)
  const across = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t), past = gable ? 0 : Math.max(0, -t, t - 1) * Math.sqrt(length);
  return eaves + (solid.ridge - eaves) * Math.max(0, 1 - Math.max(across, past) / run);
}
// A ramp or a mound to drive over (see city-jumps.js), as its collider's
// `shape`. A ramp climbs `rise` over `run` from its foot (`x`, `z`, the middle
// of its low edge, at `base`) the way (`dx`, `dz`) points, steepening toward
// its lip by `curve` (0 a plain wedge, .5 twice as steep at the lip as at the
// foot), with a level top `flat` long beyond. A mound is a smooth hump
// `height` high over an ellipse (`rx` along `angle`, `rz` across it).
export function shapeHeight(shape, p) {
  const ex = p.x - shape.x, ez = p.z - shape.z;
  if (shape.kind === 'mound') {
    const a = (ex * shape.cos + ez * shape.sin) / shape.rx, b = (ez * shape.cos - ex * shape.sin) / shape.rz, q = a * a + b * b;
    return q >= 1 ? shape.base : shape.base + shape.height * (1 - q) * (1 - q);
  }
  const t = ex * shape.dx + ez * shape.dz;
  if (t <= 0) return shape.base;
  if (t >= shape.run) return shape.base + shape.rise;
  const f = t / shape.run;
  return shape.base + shape.rise * f * (1 + shape.curve * (f - 1));
}
// Which way and how steeply a shape climbs at p: the height's rise per meter
// east (`x`) and south (`z`), written into `out`
export function shapeSlope(shape, p, out = { x: 0, z: 0 }) {
  const ex = p.x - shape.x, ez = p.z - shape.z;
  out.x = out.z = 0;
  if (shape.kind === 'mound') {
    const c = shape.cos, s = shape.sin, a = (ex * c + ez * s) / shape.rx, b = (ez * c - ex * s) / shape.rz, q = a * a + b * b;
    if (q >= 1) return out;
    const k = -4 * shape.height * (1 - q);
    out.x = k * (a * c / shape.rx - b * s / shape.rz); out.z = k * (a * s / shape.rx + b * c / shape.rz);
    return out;
  }
  const t = ex * shape.dx + ez * shape.dz;
  if (t <= 0 || t >= shape.run) return out;
  const grade = shape.rise / shape.run * (1 - shape.curve + 2 * shape.curve * t / shape.run);
  out.x = shape.dx * grade; out.z = shape.dz * grade;
  return out;
}
// What a car's wheels stand on: for each of `points` ({ x, z }, as the
// colliders lie), the highest roof, ramp or mound top under it no higher than
// its `limits`, written into `heights` (-Infinity where there is none) with the
// solid in `solids`, and with `cars` a curb-parked car's roof too (see
// parkedRoof). One pass over the colliders for all of them.
export function surfacesUnder(chunks, points, limits, heights, solids, cars = false) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    heights[i] = -Infinity; solids[i] = null;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  for (const chunk of chunks) {
    const bounds = chunk?.collisionBounds;
    if (!bounds || maxX < bounds.minX || minX > bounds.maxX || maxZ < bounds.minZ || minZ > bounds.maxZ) continue;
    for (const solid of chunk.features.colliders) {
      const car = cars && solid.parked?.profile && !solid.woken;
      if ((solid.top === undefined && !car) || solid.x - solid.reach > maxX || solid.x + solid.reach < minX || solid.z - solid.reach > maxZ || solid.z + solid.reach < minZ) continue;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (!insideConvex(p, solid.corners)) continue;
        const top = car ? parkedRoof(solid, p) : roofSurface(solid, p);
        if (top <= limits[i] && top > heights[i]) { heights[i] = top; solids[i] = solid; }
      }
    }
  }
}
// A curb-parked car's roof over p ({ x, z }, inside its footprint): its
// height there along its length, as its model has it (see carProfile)
export function parkedRoof(solid, p) {
  const info = solid.parked, along = (p.x - solid.x) * info.nose.u - (p.z - solid.z) * info.nose.s;
  return info.base + profileHeight(info.profile, along);
}
// The roof under someone at p ({ x, z }, as the colliders lie) no higher than
// `below`, where it is under them, or -Infinity
export function roofAt(chunks, p, below) {
  let best = -Infinity;
  for (const chunk of chunks) {
    const bounds = chunk?.collisionBounds;
    if (!bounds || p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ) continue;
    for (const solid of chunk.features.colliders) {
      if (solid.top === undefined || Math.abs(solid.x - p.x) > solid.reach || Math.abs(solid.z - p.z) > solid.reach || !insideConvex(p, solid.corners)) continue;
      const top = roofSurface(solid, p);
      if (top > best && top <= below) best = top;
    }
  }
  return best;
}
// The player's car against the chunks around it. A parked car or a piece of
// street furniture it touches may be knocked loose (`wake(solid, contact)`,
// see CityTraffic.wake and LooseProps.hit), and then it is no longer a wall.
// Whatever the player's machine clears (`passes`: a flying machine over it,
// a car up on a ramp or in the air over it, someone on foot on a roof) is
// left alone. Someone on foot is round (`spec.radius`, see Walker).
export function collideScenery(player, chunks, dt, wake = null) {
  const halfWidth = player.spec.width / 2, halfLength = player.spec.length / 2, radius = player.spec.radius, center = Math.floor(player.s / CHUNK_LENGTH);
  const nearby = player.route.grid ? chunks.values() : [chunks.get(center - 1), chunks.get(center), chunks.get(center + 1)];
  const box = () => ({ x: player.groundedPosition.x, z: player.groundedPosition.z, heading: player.heading, halfWidth, halfLength, radius });
  sceneryContacts(box, nearby, (contact, solid) => {
    if (player.passes?.(solid, contact)) return;
    if ((solid.parked || solid.prop) && wake?.(solid, contact)) return;
    player.resolveSceneryCollision(contact.x, contact.z, contact.depth, dt, contact.point);
  });
}
