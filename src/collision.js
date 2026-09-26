import { CHUNK_LENGTH, clamp } from './world/route.js';
import { leadingPoint } from './impact.js';

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

// The car against whatever stands in the chunks around it. Nearly every
// footprint is turned away by two subtractions, so a chunk's few hundred cost
// less than posing one traffic car.
export function collideScenery(player, chunks, dt) {
  const p = player.groundedPosition, halfWidth = player.spec.width / 2, halfLength = player.spec.length / 2;
  const reach = Math.hypot(halfWidth, halfLength), center = Math.floor(player.s / CHUNK_LENGTH);
  const nearby = player.route.grid ? chunks.values() : [chunks.get(center - 1), chunks.get(center), chunks.get(center + 1)];
  for (const chunk of nearby) {
    const bounds = chunk?.collisionBounds;
    if (bounds && (p.x + reach < bounds.minX || p.x - reach > bounds.maxX || p.z + reach < bounds.minZ || p.z - reach > bounds.maxZ)) continue;
    const colliders = chunk?.features?.colliders;
    if (!colliders) continue;
    for (const solid of colliders) {
      if (Math.abs(solid.z - p.z) > reach + solid.reach || Math.abs(solid.x - p.x) > reach + solid.reach) continue;
      const car = { x: p.x, z: p.z, heading: player.heading, halfWidth, halfLength };
      const contact = solid.heading === undefined && !solid.corners ? postContact(car, solid) : footprintContact(car, solid.corners ? solid : boxOutline(solid));
      if (!contact) continue;
      player.resolveSceneryCollision(contact.x, contact.z, contact.depth, dt, contact.point);
    }
  }
}
