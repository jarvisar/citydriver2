import * as THREE from 'three';

export const PEDESTRIAN_HOP_SECONDS = .7;
export const PEDESTRIAN_HOP_HEIGHT = 1.8;
export const PEDESTRIAN_PIVOT = 1.04;
const position = new THREE.Vector3(), scale = new THREE.Vector3(), center = new THREE.Vector3();
const rotation = new THREE.Quaternion(), spin = new THREE.Quaternion();
const zAxis = new THREE.Vector3(0, 0, 1), pivot = new THREE.Vector3();

export function applyWalkerHop(walker, matrix, time) {
  if (walker.hopStart === undefined) return;
  if (time >= walker.hopStart + PEDESTRIAN_HOP_SECONDS) { delete walker.hopStart; return; }
  const t = (time - walker.hopStart) / PEDESTRIAN_HOP_SECONDS;
  if (t <= 0) return;
  // Zero velocity at both ends, a single clean arc, and exactly one turn.
  // Rotate around the character's middle, not their feet: the centre stays
  // over the same patch of pavement instead of orbiting sideways.
  const eased = t * t * t * (t * (t * 6 - 15) + 10);
  const lift = PEDESTRIAN_HOP_HEIGHT * 16 * t * t * (1 - t) * (1 - t);
  center.set(0, PEDESTRIAN_PIVOT, 0).applyMatrix4(matrix);
  matrix.decompose(position, rotation, scale);
  rotation.multiply(spin.setFromAxisAngle(zAxis, Math.PI * 2 * eased));
  pivot.set(0, PEDESTRIAN_PIVOT * scale.y, 0).applyQuaternion(rotation);
  position.copy(center).sub(pivot); position.y += lift;
  matrix.compose(position, rotation, scale);
}

// Pause only the travel clock. Absolute-time bobbing still blends naturally
// into the reaction, and an offscreen walker settles correctly on return.
export function walkerTravelTime(walker, time) {
  const hold = walker.travelHold;
  if (hold && time >= hold.until) {
    walker.travelDelay = (walker.travelDelay ?? 0) + hold.until - hold.at;
    delete walker.travelHold;
  }
  return (walker.travelHold ? walker.travelHold.at : time) - (walker.travelDelay ?? 0);
}

export function holdWalkerTravel(walker, partner, time) {
  walkerTravelTime(walker, time);
  if (partner) walkerTravelTime(partner, time);
  const hold = walker.travelHold ?? partner?.travelHold ?? { at: time, until: time };
  hold.until = Math.max(hold.until, time + PEDESTRIAN_HOP_SECONDS);
  walker.travelHold = hold;
  // A partner briefly waits beside the hop, preserving their pairing without
  // a chase/catch-up animation or a teleport when the character lands.
  if (partner) partner.travelHold = hold;
}

function crossesBox(ax, az, bx, bz, width, length) {
  let enter = 0, exit = 1;
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) < 1e-8) { if (Math.abs(ax) > width) return false; }
  else {
    const a = (-width - ax) / dx, b = (width - ax) / dx;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  if (Math.abs(dz) < 1e-8) { if (Math.abs(az) > length) return false; }
  else {
    const a = (-length - az) / dz, b = (length - az) / dz;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  return enter <= exit;
}

// One reusable set of car footprints per rendered frame. Broad bounds reject
// almost every pedestrian before the swept rectangle test; there are no
// raycasts, per-person scene objects, or allocations in the contact loop.
export class PedestrianContacts {
  constructor() { this.history = new WeakMap(); this.cars = []; this.count = 0; }
  update(player, traffic, time) {
    this.count = 0;
    this.add(player, time);
    if (traffic?.enabled) for (const car of traffic.vehicles) this.add(car, time);
  }
  add(car, time) {
    const p = car?.groundedPosition ?? car?.position;
    if (!p || !car.spec) return;
    let previous = this.history.get(car);
    if (!previous) {
      previous = { x: p.x, z: p.z, time, generation: car.generation };
      this.history.set(car, previous);
    }
    const dt = time - previous.time, speed = Math.abs(car.speed ?? 0);
    const limit = Math.max(3, speed * dt * 3);
    // Resets, recycled traffic and origin changes must not sweep across town.
    const continuous = dt > 0 && dt < .2 && previous.generation === car.generation
      && (p.x - previous.x) ** 2 + (p.z - previous.z) ** 2 < limit * limit;
    const footprint = this.cars[this.count] ?? (this.cars[this.count] = {});
    footprint.x = p.x; footprint.y = p.y; footprint.z = p.z;
    footprint.px = continuous ? previous.x : p.x; footprint.pz = continuous ? previous.z : p.z;
    footprint.cos = Math.cos(car.heading); footprint.sin = Math.sin(car.heading);
    footprint.width = car.spec.width / 2; footprint.length = car.spec.length / 2;
    footprint.moving = speed > 1.2;
    const radius = Math.hypot(footprint.width, footprint.length) + .4;
    footprint.minX = Math.min(footprint.px, p.x) - radius; footprint.maxX = Math.max(footprint.px, p.x) + radius;
    footprint.minZ = Math.min(footprint.pz, p.z) - radius; footprint.maxZ = Math.max(footprint.pz, p.z) + radius;
    previous.x = p.x; previous.z = p.z; previous.time = time; previous.generation = car.generation;
    this.count++;
  }
  hit(walker, x, y, z, radius, time) {
    let touching = false, moving = false;
    for (let i = 0; i < this.count; i++) {
      const car = this.cars[i];
      if (x < car.minX || x > car.maxX || z < car.minZ || z > car.maxZ || Math.abs(y - car.y) > 2) continue;
      const dx = x - car.x, dz = z - car.z, px = x - car.px, pz = z - car.pz;
      if (!crossesBox(px * car.cos + pz * car.sin, px * car.sin - pz * car.cos,
        dx * car.cos + dz * car.sin, dx * car.sin - dz * car.cos, car.width + radius, car.length + radius)) continue;
      touching = true; moving ||= car.moving;
    }
    const active = walker.hopStart !== undefined && time < walker.hopStart + PEDESTRIAN_HOP_SECONDS;
    const start = touching && moving && !walker.carTouching && !active;
    walker.carTouching = touching;
    if (start) walker.hopStart = time;
    return start;
  }
}
