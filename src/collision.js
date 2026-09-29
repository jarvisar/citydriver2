import { CHUNK_LENGTH, clamp } from './world/route.js';
import { leadingPoint } from './impact.js';

// Four separating axes give a forgiving rectangular footprint even when the
// player is sideways. All collision coordinates are independent of render origin.
export function trafficContact(a, b) {
  const axes = car => [{ x: Math.cos(car.heading), z: Math.sin(car.heading) }, { x: Math.sin(car.heading), z: -Math.cos(car.heading) }];
  const aa = axes(a), ba = axes(b), dx = a.x - b.x, dz = a.z - b.z;
  const dot = (u, v) => u.x * v.x + u.z * v.z;
  const radius = (car, basis, axis) => car.halfWidth * Math.abs(dot(basis[0], axis)) + car.halfLength * Math.abs(dot(basis[1], axis));
  let contact = null;
  for (const axis of [...aa, ...ba]) {
    const distance = dx * axis.x + dz * axis.z;
    const depth = radius(a, aa, axis) + radius(b, ba, axis) - Math.abs(distance);
    if (depth <= 0) return null;
    if (!contact || depth < contact.depth) {
      const sign = distance < 0 ? -1 : 1;
      contact = { x: axis.x * sign, z: axis.z * sign, depth };
    }
  }
  return contact;
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
    // The post's centre is already under the car: leave by the nearer side.
    const side = halfWidth - Math.abs(across), end = halfLength - Math.abs(along);
    x = side < end ? Math.sign(across) || 1 : 0; z = side < end ? 0 : Math.sign(along) || 1;
    depth = post.reach + ROUND + Math.min(side, end);
  }
  const a = nearAcross + x * ROUND, b = nearAlong + z * ROUND;
  return { x: -(x * cos + z * sin), z: -(x * sin - z * cos), depth, point: { x: car.x + a * cos + b * sin, z: car.z + a * sin - b * cos } };
}

// Buildings can have oblique footprints where a neighborhood bends. Test the
// actual convex footprint rather than its larger axis-aligned bounding box.
// Answers as postContact does.
export function footprintContact(car, solid) {
  const cos = Math.cos(car.heading), sin = Math.sin(car.heading);
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
    if (!contact || depth < contact.depth) contact = { x: x * sign, z: z * sign, depth };
  }
  // The car's corners inside the solid, and the solid's inside the car
  const pierced = corners.filter(p => insideConvex(p, solid.corners)), caught = [];
  for (const p of solid.corners) {
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
  const corners = (solid.corners ? solid : boxOutline(solid)).corners;
  let best = Infinity, nx = 0, nz = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length], ex = b.x - a.x, ez = b.z - a.z, length = ex * ex + ez * ez;
    const t = length > 1e-12 ? clamp(((circle.x - a.x) * ex + (circle.z - a.z) * ez) / length, 0, 1) : 0;
    const px = a.x + ex * t, pz = a.z + ez * t, d = (circle.x - px) ** 2 + (circle.z - pz) ** 2;
    if (d < best) { best = d; nx = px; nz = pz; }
  }
  const inside = insideConvex(circle, corners), dx = circle.x - nx, dz = circle.z - nz, distance = Math.sqrt(best);
  if (!inside && distance >= r) return null;
  const sign = inside ? -1 : 1, x = distance > 1e-6 ? sign * dx / distance : 1, z = distance > 1e-6 ? sign * dz / distance : 0;
  return { x, z, depth: inside ? r + distance : r - distance, point: { x: nx, z: nz } };
}
// The outline of a rectangle turned by its heading, as trafficContact reads one.
function boxOutline(box) {
  const cos = Math.cos(box.heading), sin = Math.sin(box.heading);
  return { corners: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({
    x: box.x + x * box.halfWidth * cos + z * box.halfLength * sin, z: box.z + x * box.halfWidth * sin - z * box.halfLength * cos,
  })) };
}
// Whether a point stands inside (or within 2 cm of) a convex outline, whichever way round it runs.
function insideConvex(p, polygon) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-8) continue;
    const cross = ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / length;
    if (Math.abs(cross) <= .02) continue;
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
      const contact = car.radius ? circleContact(car, solid) : solid.heading === undefined && !solid.corners ? postContact(car, solid) : footprintContact(car, solid.corners ? solid : boxOutline(solid));
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
// camera following someone on foot, the cars parked along the kerbs and
// `bodies` ({ x, z, heading, halfWidth, halfLength, y }: the traffic, and the
// player's own car) as well. Points are in the scene, which lies `origin`
// along z from the colliders.
export function sightLine(chunks, from, to, origin = 0, cars = null) {
  const x = from.x, z = from.z - origin, dx = to.x - from.x, dz = to.z - from.z;
  const minX = Math.min(x, x + dx) - CLEAR, maxX = Math.max(x, x + dx) + CLEAR, minZ = Math.min(z, z + dz) - CLEAR, maxZ = Math.max(z, z + dz) + CLEAR;
  let open = 1;
  const block = (solid, top, clear) => {
    let crossing = lineThrough(solid, x, z, dx, dz, clear);
    if (crossing?.[0] < 0 && clear > CLOSE) crossing = lineThrough(solid, x, z, dx, dz, CLOSE);
    if (!crossing) return;
    // Intersect the height interval as well as the footprint. A descending
    // lens can hit a roof after entering above it, even starting over the roof.
    // Returning the 2D entry either missed that roof or pulled in much too far.
    let [enter, leave] = crossing;
    const dy = to.y - from.y, ceiling = top + CLOSE;
    if (Math.abs(dy) < 1e-9) { if (from.y >= ceiling) return; }
    else if (dy < 0) enter = Math.max(enter, (ceiling - from.y) / dy);
    else leave = Math.min(leave, (ceiling - from.y) / dy);
    // If the player starts inside the actual volume there is nowhere better
    // along this ray; a roof entry from above still has a positive fraction.
    if (enter >= 0 && enter <= Math.min(leave, 1) && enter < open) open = enter;
  };
  const outside = (at, reach) => at.x - reach > maxX || at.x + reach < minX || at.z - reach > maxZ || at.z + reach < minZ;
  for (const chunk of chunks) {
    // (a chunk still being built has no bounds, nor its colliders' corners)
    const bounds = chunk?.collisionBounds;
    if (!bounds || maxX < bounds.minX || minX > bounds.maxX || maxZ < bounds.minZ || minZ > bounds.maxZ) continue;
    for (const solid of chunk.features.colliders) {
      const car = cars && solid.parked && !solid.woken;
      // (and a post, a trunk or a lamp, the camera would stand inside: it
      // comes in to just before it, rather than look out through it)
      if (cars && solid.heading === undefined && !solid.corners) { if (!outside(solid, solid.reach)) open = Math.min(open, postEnd(solid, x, z, dx, dz)); continue; }
      if ((solid.top === undefined && !car) || outside(solid, solid.reach)) continue;
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
// corners are bevelled, so a sharp one grows no long spike.
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
// in city-buildings.js), from its ridge down to its eaves
export function roofSurface(solid, p) {
  const pitch = solid.pitch;
  if (!pitch) return solid.ridge ?? solid.top;
  const { from: a, to: b, run, eaves, gable } = pitch, dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length > 1e-9 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / length : 0;
  // (across from the ridge's line, and on a hip past its ends: each face is
  // a plane, and measured straight from the ridge they sank into the hips)
  const across = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t), past = gable ? 0 : Math.max(0, -t, t - 1) * Math.sqrt(length);
  return eaves + (solid.ridge - eaves) * Math.max(0, 1 - Math.max(across, past) / run);
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
// someone on foot on a roof) is left alone. Someone on foot is round
// (`spec.radius`, see Walker).
export function collideScenery(player, chunks, dt, wake = null) {
  const halfWidth = player.spec.width / 2, halfLength = player.spec.length / 2, radius = player.spec.radius, center = Math.floor(player.s / CHUNK_LENGTH);
  const nearby = player.route.grid ? chunks.values() : [chunks.get(center - 1), chunks.get(center), chunks.get(center + 1)];
  const box = () => ({ x: player.groundedPosition.x, z: player.groundedPosition.z, heading: player.heading, halfWidth, halfLength, radius });
  sceneryContacts(box, nearby, (contact, solid) => {
    if (player.passes?.(solid)) return;
    if ((solid.parked || solid.prop) && wake?.(solid, contact)) return;
    player.resolveSceneryCollision(contact.x, contact.z, contact.depth, dt, contact.point);
  });
}
