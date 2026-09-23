// What the car cannot drive through. A chunk records the footprint of each
// solid thing as it stands it up, in the global coordinates the car and the
// traffic already collide in, so the list crosses from the chunk worker as
// plain data and the driving step never has to read a mesh. Positions come in
// as the chunk places them: x, and z measured from the chunk's own start.

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
// and the trunk, not the eaves, a crown, or a turbine's nacelle overhead.
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
