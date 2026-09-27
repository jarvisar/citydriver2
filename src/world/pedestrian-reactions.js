import * as THREE from 'three';
import { level } from '../loose-props.js';
import { cityWalker } from './city-walkers.js';

// A pedestrian a moving car meets is knocked flying: a loose body like the
// street furniture's (see LooseProps.person), which tumbles, lands and slides
// to a stop. After lying still a moment they get up where they lie and carry
// on, unharmed: a resident rejoins their walk round the block at the nearest
// point of it, a step on (see rejoinWalk), a waiting fare goes back to their
// spot. Someone walking with them stops and turns to watch; once both are
// on their feet, whichever is behind hurries to catch up while the other
// waits, looking back, and they set off together again (see regroupWalkers).

// How long a person lies still before getting up, how long getting up takes,
// and how fast they walk back (m/s): a stroll, brisker the further they were thrown
export const PEDESTRIAN_LIE = .9, PEDESTRIAN_RISE = .8, PEDESTRIAN_WALK_BACK = 1.6, PEDESTRIAN_HURRY = 3;
// How long a resident takes to change pace (s): stopping, setting off, hurrying
export const PEDESTRIAN_EASE = .5;
// How far on from the nearest point of their walk they rejoin it (m), so they
// merge on the way they were going rather than step back onto it
export const PEDESTRIAN_REJOIN_AHEAD = 1.5;
// The last stretch of the walk back turns them to face the way they were going
const TURN_IN = .8;
// How quickly a person turns to look (a spring, per second), and how far
// they lean into a hurry (radians, at a metre a second over their pace)
const TURN_RATE = 4, LEAN = .14;

const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
const home = new THREE.Vector3(), homeScale = new THREE.Vector3(), homeRotation = new THREE.Quaternion();
const face = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const world = new THREE.Matrix4(), local = new THREE.Matrix4(), tilt = new THREE.Matrix4();
const smooth = t => t * t * (3 - 2 * t);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const E = PEDESTRIAN_EASE;

// How far a resident has walked round their block (m, the way they go) at
// `time`. Their stride is { d, at, from, rate, until }: `d` metres at `at`,
// easing from `from` to `rate` m/s over PEDESTRIAN_EASE, until `until`, when
// they ease back to their own pace. Every stop, hurry and wait is one of
// these, worked out from the time alone, so a resident out of sight is where
// they should be when seen again, and none of them starts or stops dead.
const eased = (from, to, t) => t < E ? from * t + (to - from) * t * t / (2 * E) : to * t - (to - from) * E / 2;
const easing = (from, to, t) => t < E ? from + (to - from) * t / E : to;
export function walkedAt(walker, time) {
  const stride = walker.stride;
  if (!stride) return walker.speed * time;
  if (time <= stride.until) return stride.d + eased(stride.from, stride.rate, time - stride.at);
  const span = stride.until - stride.at;
  return stride.d + eased(stride.from, stride.rate, span) + eased(easing(stride.from, stride.rate, span), walker.speed, time - stride.until);
}
// How fast they are going round it at `time` (m/s)
export function paceAt(walker, time) {
  const stride = walker.stride;
  if (!stride) return walker.speed;
  if (time <= stride.until) return easing(stride.from, stride.rate, time - stride.at);
  return easing(easing(stride.from, stride.rate, stride.until - stride.at), walker.speed, time - stride.until);
}
export function setStride(walker, time, rate, until = Infinity, d = walkedAt(walker, time), from = paceAt(walker, time)) {
  walker.stride = { d, at: time, from, rate, until };
}
// Standing still, or coming to a stop (waiting, or knocked over), at `time`
export const standing = (walker, time) => walker.stride && time < walker.stride.until && walker.stride.rate === 0;
// Hurrying to catch up at `time`
export const hurrying = (walker, time) => walker.stride && time < walker.stride.until && walker.stride.rate > walker.speed;

// The distance round a loop ({ points, cumulative, perimeter }, points
// { x, y }) nearest (x, y)
export function nearestOnLoop(loop, x, y) {
  const { points, cumulative } = loop;
  let best = Infinity, at = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    const d = (a.x + dx * t - x) ** 2 + (a.y + dy * t - y) ** 2;
    if (d < best) { best = d; at = cumulative[i] + t * Math.sqrt(length); }
  }
  return at;
}
// Metres from b to a round a loop the way a walker goes, between -half and half a lap
const around = (a, b, perimeter) => a - b - Math.round((a - b) / perimeter) * perimeter;

// A resident back on their feet at (x, y) (world x, s) rejoins their walk at
// the nearest point of it, a step on, and waits there for themselves to
// arrive (see PedestrianContacts.away).
export function rejoinWalk(walker, x, y, time) {
  const loop = walker.loop, walked = walkedAt(walker, time);
  const travel = walker.phase + walked * walker.direction;
  const to = walked + around(nearestOnLoop(loop, x, y), travel, loop.perimeter) * walker.direction + PEDESTRIAN_REJOIN_AHEAD;
  setStride(walker, time, 0, Infinity, to, 0);
}
// A resident knocked over stops where they were; so does whoever is with them
export function stopWalkers(walker, partner, time) {
  setStride(walker, time, 0);
  if (partner && !partner.away) setStride(partner, time, 0);
}
// A resident back where they rejoined their walk goes on, arriving at
// `arrival` m/s. With someone, and both on their feet, the one behind hurries
// up to the other, who waits (or, further apart than MEET, comes back to meet
// them); they walk on together from where they meet. Someone still down is
// waited for.
export const PEDESTRIAN_MEET = 10;
export function regroupWalkers(walker, partner, time, arrival = 0) {
  if (!partner) { setStride(walker, time, 0, time, walkedAt(walker, time), arrival); return; }
  if (partner.away) { setStride(walker, time, 0, Infinity, walkedAt(walker, time), arrival); return; }
  const a = walkedAt(walker, time), b = walkedAt(partner, time), gap = around(a, b, walker.loop?.perimeter ?? Infinity);
  const [ahead, behind, lead] = gap >= 0 ? [walker, partner, a] : [partner, walker, b], apart = Math.abs(gap);
  const pace = w => w === walker ? arrival : paceAt(w, time), fa = pace(ahead), fb = pace(behind);
  let hurry = Math.min(PEDESTRIAN_HURRY + .4, Math.max(2.4, behind.speed * 2));
  const back = apart > PEDESTRIAN_MEET ? ahead.speed : 0;
  // (they meet where both, once eased back to their pace, walk on as one:
  // the one behind makes up the gap and what the easing loses; a gap too
  // small to hurry over is closed at a stroll, and one they would overrun
  // arriving, by the other setting off gently ahead of them)
  const close = apart - (fb - fa) * E / 2;
  let span = close / (hurry + back), onward = back ? -back : 0;
  if (span < E) { span = E; hurry = close / E - back; }
  if (hurry < 0) { onward = -close / E; hurry = 0; }
  setStride(ahead, time, onward, time + span, lead, fa);
  setStride(behind, time, hurry, time + span, lead - apart, fb);
}
// A person's yaw: `base`, the way they go, turned toward `look` (a yaw, or
// null to face on) on a spring kept on `person`, so they turn to look, and
// back, without snapping round
export function lookYaw(person, base, look, time) {
  const dt = time - (person.lookTime ?? -Infinity), goal = look === null ? 0 : wrap(look - base);
  person.lookTime = time;
  if (!(dt >= 0 && dt < .25)) { person.look = goal; person.turning = 0; return base + goal; }
  for (let left = dt; left > 1e-6; left -= 1 / 60) {
    const step = Math.min(left, 1 / 60), error = wrap(goal - person.look);
    person.turning += (TURN_RATE * TURN_RATE * error - 2 * TURN_RATE * person.turning) * step;
    person.look += person.turning * step;
  }
  return base + person.look;
}
// A person leaning into a hurry, about their feet, by how far they go over `pace` (m/s)
export function lean(matrix, over) {
  return over > 0 ? matrix.multiply(tilt.makeRotationX(-LEAN * Math.min(1, over))) : matrix;
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

// A matrix facing world direction (dx, dz): people's faces look down their -z
const facing = (dx, dz, out) => out.setFromAxisAngle(UP, Math.atan2(-dx, -dz));

// One reusable set of car footprints per rendered frame. Broad bounds reject
// almost every pedestrian before the swept rectangle test; there are no
// raycasts, per-person scene objects, or allocations in the contact loop.
export class PedestrianContacts {
  constructor() { this.history = new WeakMap(); this.cars = []; this.count = 0; this.props = null; this.player = null; this.traffic = null; }
  // `props` (LooseProps) takes those knocked flying; without it, nobody is
  update(player, traffic, time, props = null) {
    this.count = 0; this.player = player; this.traffic = traffic; this.props = props;
    this.add(player, time);
    if (traffic?.enabled) {
      for (const car of traffic.vehicles) this.add(car, time);
      // (and parked cars knocked loose, while they are out of their bays)
      for (const car of traffic.woken ?? []) if (car.parked) this.add(car, time);
    }
  }
  add(car, time) {
    const p = car?.groundedPosition ?? car?.position;
    if (!p || !car.spec) return;
    let previous = this.history.get(car);
    if (!previous) {
      previous = { x: p.x, z: p.z, time, generation: car.generation };
      this.history.set(car, previous);
    }
    // (a car knocked loose slides on with no speed of its own)
    const dt = time - previous.time, speed = Math.abs(car.speed ?? 0) || (car.loose ? Math.hypot(car.loose.vx, car.loose.vz) : 0);
    const limit = Math.max(3, speed * dt * 3);
    // Resets, recycled traffic and origin changes must not sweep across town.
    const continuous = dt > 0 && dt < .2 && previous.generation === car.generation
      && (p.x - previous.x) ** 2 + (p.z - previous.z) ** 2 < limit * limit;
    const footprint = this.cars[this.count] ?? (this.cars[this.count] = {});
    footprint.car = car;
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
  // The moving car that has just met a person at (x, y, z), or null. A car
  // that stays touching them meets them only once.
  hit(person, x, y, z, radius) {
    let touching = false, moving = null;
    for (let i = 0; i < this.count; i++) {
      const car = this.cars[i];
      if (x < car.minX || x > car.maxX || z < car.minZ || z > car.maxZ || Math.abs(y - car.y) > 2) continue;
      const dx = x - car.x, dz = z - car.z, px = x - car.px, pz = z - car.pz;
      if (!crossesBox(px * car.cos + pz * car.sin, px * car.sin - pz * car.cos,
        dx * car.cos + dz * car.sin, dx * car.sin - dz * car.cos, car.width + radius, car.length + radius)) continue;
      touching = true; if (car.moving) moving ??= car;
    }
    const start = moving && !person.carTouching ? moving : null;
    person.carTouching = touching;
    return start;
  }
  // A person whose `matrix` is where they would be now (drawn in `frame`, a
  // matrix to the world): knocked over, getting up or walking back, it is
  // changed to where they are. True while they are away from where they were.
  // `rejoin(person, x, s, time)`, if given, is told where they get up, so
  // their walk can take them on from there (see rejoinWalk).
  person(person, matrix, frame, radius, time, rejoin = null) {
    if (person.body?.removed) person.body = null;
    if (person.body) {
      const body = person.body;
      if (!body.asleep || body.slept < PEDESTRIAN_LIE) {
        this.props.personMatrix(body, world);
        matrix.copy(local.copy(frame).invert().multiply(world));
        return true;
      }
      // Up again: from where they lie to standing, feet under them, facing back
      this.props.personMatrix(body, world).decompose(position, rotation, scale);
      person.rise = { at: time, from: { p: position.clone(), q: rotation.clone() }, x: body.p.x, z: body.p.z };
      this.props.release(body); person.body = null;
      rejoin?.(person, body.p.x, -body.p.z, time);
    }
    const away = this.away(person, matrix, frame, time);
    const at = position.setFromMatrixPosition(matrix).applyMatrix4(frame), car = this.props && this.hit(person, at.x, at.y, at.z, radius);
    if (!car) return away;
    world.multiplyMatrices(frame, matrix);
    // Knocked flying: whatever they were doing, a body takes their place
    const player = car.car === this.player, motion = player ? this.props.carOf(this.player) : this.traffic.motion(car.car);
    if (!player) { motion.y = car.y; motion.height = 1.5; }
    const { body, blow } = this.props.person(cityWalker, world, motion);
    if (player && blow) this.player.strike(blow.x, blow.z, blow.spin, Math.hypot(blow.x, blow.z));
    person.body = body; person.rise = person.back = null;
    return true;
  }
  // Getting up, then walking back to where they would be now (where they
  // rejoin their walk, which waits for them, or their own spot), briskly
  // if it is far, turning at the end to face on
  away(person, matrix, frame, time) {
    if (!person.rise && !person.back) return false;
    world.multiplyMatrices(frame, matrix).decompose(home, homeRotation, homeScale);
    const rise = person.rise;
    if (rise) {
      const t = (time - rise.at) / PEDESTRIAN_RISE;
      if (t < 1) {
        const k = smooth(Math.max(0, t));
        const ground = level(rise.x, rise.z);
        position.set(rise.x, Number.isNaN(ground) ? home.y : ground, rise.z).sub(rise.from.p).multiplyScalar(k).add(rise.from.p);
        rotation.slerpQuaternions(rise.from.q, facing(home.x - rise.x, home.z - rise.z, face), k);
        matrix.copy(local.copy(frame).invert().multiply(world.compose(position, rotation, homeScale)));
        return true;
      }
      const far = Math.hypot(home.x - rise.x, home.z - rise.z);
      person.rise = null; person.back = { at: rise.at + PEDESTRIAN_RISE, x: rise.x, z: rise.z, speed: Math.min(PEDESTRIAN_HURRY, PEDESTRIAN_WALK_BACK + far / 25) };
    }
    const back = person.back, dx = home.x - back.x, dz = home.z - back.z, length = Math.hypot(dx, dz);
    const along = eased(0, back.speed, time - back.at);
    if (along >= length) { person.back = null; person.arrival = easing(0, back.speed, time - back.at); return false; }
    const x = back.x + dx * along / length, z = back.z + dz * along / length, k = smooth(Math.max(0, 1 - (length - along) / TURN_IN));
    const ground = level(x, z), y = (Number.isNaN(ground) ? home.y : ground + lift(home)) * (1 - k) + home.y * k;
    rotation.slerpQuaternions(facing(dx, dz, face), homeRotation, k);
    matrix.copy(local.copy(frame).invert().multiply(world.compose(position.set(x, y, z), rotation, homeScale)));
    lean(matrix, (1 - k) * (easing(0, back.speed, time - back.at) - 2.2) / .6);
    return true;
  }
}

// How far above the ground a person's walk carries them (the bob of each step)
function lift(at) {
  const ground = level(at.x, at.z);
  return Number.isNaN(ground) ? 0 : Math.max(0, at.y - ground);
}
