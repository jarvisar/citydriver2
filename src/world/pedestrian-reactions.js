import * as THREE from 'three';
import { level } from '../loose-props.js';
import { cityWalker } from './city-walkers.js';
import { surfaceAt, PAVEMENT_LEVEL } from './city-route.js';

// A pedestrian a moving car meets is knocked flying: a loose body like the
// street furniture's (see LooseProps.person), which tumbles, lands and slides
// to a stop. After lying still a moment they get up where they lie and carry
// on, unharmed: a resident rejoins their walk round the block at the nearest
// point of it, a step on (see rejoinWalk). (A fare waiting for a taxi only
// hops out of the way, see applyHop.) Someone walking with them stops and turns to watch; once both are
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
// they lean into a hurry (radians, at a meter a second over their pace)
const TURN_RATE = 4, LEAN = .14;

const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
const home = new THREE.Vector3(), homeScale = new THREE.Vector3(), homeRotation = new THREE.Quaternion();
const face = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const world = new THREE.Matrix4(), local = new THREE.Matrix4(), tilt = new THREE.Matrix4();
const smooth = t => t * t * (3 - 2 * t);
const hopCentre = new THREE.Vector3(), hopPivot = new THREE.Vector3(), hopSpin = new THREE.Quaternion(), hopSquash = new THREE.Matrix4(), Z = new THREE.Vector3(0, 0, 1);

// A fare waiting for a taxi only jumps out of the way of a car and lands
// back on their spot, still waiting: a quick crouch, a leap with a
// cartwheel away from the car, fastest in the middle, and a squash on landing.
export const PEDESTRIAN_HOP = .6, PEDESTRIAN_HOP_HEIGHT = 1.2, PEDESTRIAN_PIVOT = 1.04;
const CROUCH = .07, LAND = .1, AIR = PEDESTRIAN_HOP - CROUCH - LAND;
// A hop at `time` (a `hopStart`, and `hopSpin` 1 or -1 about their front),
// applied to their `matrix` about their middle. False once they have landed.
export function applyHop(person, matrix, time) {
  const t = time - person.hopStart;
  if (!(t >= 0 && t < PEDESTRIAN_HOP)) { if (t >= PEDESTRIAN_HOP) delete person.hopStart; return false; }
  // (squashed down before take-off and on landing, stretched off the ground)
  let stretch = 1;
  if (t < CROUCH) stretch = 1 - .14 * Math.sin(Math.PI * t / CROUCH);
  else if (t >= CROUCH + AIR) stretch = 1 - .12 * Math.sin(Math.PI * (t - CROUCH - AIR) / LAND);
  if (t >= CROUCH && t < CROUCH + AIR) {
    const u = (t - CROUCH) / AIR, turn = (u - .12 * Math.sin(2 * Math.PI * u)) * Math.PI * 2 * (person.hopSpin ?? 1);
    stretch = 1 + .07 * Math.abs(1 - 2 * u);
    hopCentre.set(0, PEDESTRIAN_PIVOT, 0).applyMatrix4(matrix);
    matrix.decompose(position, rotation, scale);
    rotation.multiply(hopSpin.setFromAxisAngle(Z, turn));
    hopPivot.set(0, PEDESTRIAN_PIVOT * scale.y, 0).applyQuaternion(rotation);
    position.copy(hopCentre).sub(hopPivot); position.y += PEDESTRIAN_HOP_HEIGHT * 4 * u * (1 - u);
    matrix.compose(position, rotation, scale);
  }
  const wide = 1 / Math.sqrt(stretch);
  matrix.multiply(hopSquash.makeScale(wide, stretch, wide));
  return true;
}

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const E = PEDESTRIAN_EASE;

// How far a resident has walked round their block (m, the way they go) at
// `time`. Their stride is { d, at, from, rate, until }: `d` meters at `at`,
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
    // (a walk bent round something keeps each point's distance round its base: see WalkSpace)
    if (d < best) { best = d; at = cumulative[i] + t * (cumulative[i + 1] - cumulative[i]); }
  }
  return at;
}
// Meters from b to a round a loop the way a walker goes, between -half and half a lap
const around = (a, b, perimeter) => a - b - Math.round((a - b) / perimeter) * perimeter;
// How far either side of a corner of their walk a resident turns through it (m)
const WALKER_TURN = 1.2;
// Where a walker is on their loop, `walked` meters on: world (x east, s
// north) and a yaw facing the way they walk. The yaw turns through each
// corner over a meter or so either side of it (less on a short side), so a
// walker rounds it rather than snapping about, and a pair's sideways
// spacing, which follows the yaw, swings round with them.
export function walkPose(walker, walked) {
  const loop = walker.loop, travel = walker.phase + walked * walker.direction;
  const d = ((travel % loop.perimeter) + loop.perimeter) % loop.perimeter, points = loop.points, cumulative = loop.cumulative, n = points.length;
  // (the side they are on: the last whose start they have reached)
  let i = 0;
  for (let high = n - 1; i < high;) { const middle = (i + high + 1) >> 1; if (cumulative[middle] <= d) i = middle; else high = middle - 1; }
  const a = points[i], b = points[(i + 1) % n], span = (cumulative[i + 1] - cumulative[i]) || 1, t = (d - cumulative[i]) / span;
  const side = k => { const p = points[((k % n) + n) % n], q = points[(((k + 1) % n) + n) % n]; return Math.atan2(q.x - p.x, q.y - p.y); };
  const length = k => cumulative[((k % n) + n) % n + 1] - cumulative[((k % n) + n) % n];
  // (the corner nearer this point, and how far through its turn it is)
  const along = d - cumulative[i], atEnd = along > span / 2, reach = Math.min(WALKER_TURN, span / 2, length(atEnd ? i + 1 : i - 1) / 2);
  const from = atEnd ? side(i) : side(i - 1), to = atEnd ? side(i + 1) : side(i), past = atEnd ? along - span : along;
  const blend = reach > 1e-6 ? THREE.MathUtils.smoothstep(past, -reach, reach) : past >= 0 ? 1 : 0;
  const heading = from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * blend;
  return { x: a.x + (b.x - a.x) * t, s: a.y + (b.y - a.y) * t, yaw: -heading + (walker.direction < 0 ? Math.PI : 0) };
}

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
  const a = walkedAt(walker, time), b = walkedAt(partner, time), gap = around(a, b, walker.loop.perimeter);
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
// Where a person's head turns from their body (radians, their yaw's sense):
// toward `watch` ({x, z} in their frame, or null) when it is near and not
// behind them, so people look round at a car going by; otherwise now and
// then at a partner beside them (`side`, their partner's way across, -1 or
// 1) as if talking, or at the shops. On a spring kept on `person`.
const GLANCE_REACH = 16, GLANCE_MOST = 1.1, GLANCE_RATE = 5;
export function glance(person, yaw, x, z, watch, time, side = 0) {
  let goal = 0, watching = false;
  if (watch) {
    const dx = watch.x - x, dz = watch.z - z, d = dx * dx + dz * dz;
    if (d < GLANCE_REACH * GLANCE_REACH && d > .09) {
      const turn = wrap(Math.atan2(-dx, -dz) - yaw);
      if (Math.abs(turn) < 2) { goal = Math.max(-GLANCE_MOST, Math.min(GLANCE_MOST, turn)); watching = true; }
    }
  }
  if (!watching) {
    // (a new whim every few seconds, different for everyone)
    const beat = Math.floor(time / 3.2 + (person.phase ?? 0) * .37), whim = Math.abs(Math.sin(beat * 12.9898 + (person.phase ?? 0) * 78.233) * 43758.5453) % 1;
    if (side && whim < .4) goal = -side * .85;
    else if (whim > .82) goal = whim > .91 ? .6 : -.6;
  }
  const dt = time - (person.glanceTime ?? -Infinity);
  person.glanceTime = time;
  if (!(dt >= 0 && dt < .25)) { person.glance = goal; person.glancing = 0; return goal; }
  for (let left = dt; left > 1e-6; left -= 1 / 30) {
    const step = Math.min(left, 1 / 30);
    person.glancing += (GLANCE_RATE * GLANCE_RATE * (goal - person.glance) - 2 * GLANCE_RATE * person.glancing) * step;
    person.glance += person.glancing * step;
  }
  return person.glance;
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

// The player on foot (see Walker) shoves people aside rather than knocking
// them flying: whoever they walk into gives way, stepping ASIDE out of the
// way the player is going as much as back, and returns to their walk at
// RETURN m/s, no further than SHOVED m off it. Pushing through someone slows
// the player at RESIST (a share a second of their way toward them).
// Sprinting into someone faster than TACKLE (m/s) bowls them over, as a car
// does, their weight behind it (CHARGE, tonnes). Someone shoved turns to
// look for LOOK s.
const ASIDE = 1, RETURN = 1.1, SHOVED = 2.5, RESIST = 5, TACKLE = 5.5, CHARGE = .35, LOOK = 1.4;

// Loose furniture knocks people over too, and so does anyone already sent
// flying: a piece whose fastest point moves faster than FLUNG (m/s), with
// enough behind it (tonnes times m/s: a bin at 2 m/s, a cafe chair only
// at 5), met by any of its points within STANDING (m) of their feet
const FLUNG = 2, HEFT = .05, STANDING = 1.8;
const pieceAt = new THREE.Vector3();
// Dodging (see dive): someone in the path of the player's car, or a car it
// knocked loose, coming faster than DODGE_SPEED (m/s), notices it DODGE_SEEN
// (m) off, or DODGE_AHEAD (s) off if that is nearer, and dives aside to
// clear it by DODGE_CLEAR (m), at most DIVE_MOST, then waits DIVE_HOLD (s)
// before walking back. The leap takes PEDESTRIAN_HOP, so they get clear of a
// car up to about 20 m/s (45 mph) coming straight at them, and not of the
// truck flat out: slowing down near people is what spares them.
const DODGE_SPEED = 5, DODGE_SEEN = 9, DODGE_AHEAD = 1.2, DODGE_CLEAR = .45, DIVE_MOST = 2.4, DIVE_HOLD = .6;
const dodge = { x: 0, z: 0 };
// Stepping round (see sidestep): someone walking sees a car at rest on the
// pavement, or a heavy piece or a person lying there, SEEN m ahead on their
// way and steps aside far enough to pass it ROUND_CLEAR m clear, no faster
// aside than STEP_ASIDE (m/s) and no further than ROUND_MOST: a car right
// across a pavement with a wall beside it is passed by the road
const SEEN = 5, ROUND_CLEAR = .2, STEP_ASIDE = 2.2, ROUND_MOST = 4;
const extent = { a0: 0, a1: 0, c0: 0, c1: 0 }, NONE = [];
// Getting back round something (see detour): how far aside a turn is tried
// (m), and the furthest
const TURNS = [1.2, -1.2, 2.4, -2.4, 3.6, -3.6, 5, -5], TURN_MOST = 5;

// One reusable set of car footprints per rendered frame. Broad bounds reject
// almost every pedestrian before the swept rectangle test; there are no
// raycasts, per-person scene objects, or allocations in the contact loop.
// Loose pieces in flight are kept as their points in the world, likewise
// reused: nothing is flying most of the time.
export class PedestrianContacts {
  constructor() {
    this.history = new WeakMap(); this.cars = []; this.count = 0; this.pieces = []; this.flying = 0; this.props = null; this.player = null; this.traffic = null; this.onFoot = null;
    // The city's built cells, for their colliders (the world sets it: see
    // CitydriverWorld.animate), and its walks (see WalkSpace). With them,
    // people shoved, diving and walking back keep to where they can stand.
    this.scenery = null; this.space = null;
    // Cars at rest on a pavement and what lies in the way, to be stepped round (see sidestep)
    this.rest = []; this.lying = NONE;
    // Told of each person knocked flying: `(by, at, kind)`, `by` the player's
    // car, a loose `piece` (`kind` its kind: a person, a lamp...), a `loose`
    // car (knocked off its lane or out of its bay) or ordinary `traffic`, and
    // `at` where they stood (see DemolitionRun)
    this.onKnock = null;
    // Residents dive out of the way of a car bearing down on them (see dive).
    // Only in a demolition run, where they are what the player must avoid.
    this.dodge = false;
  }
  // `props` (LooseProps) takes those knocked flying; without it, nobody is
  update(player, traffic, time, props = null) {
    this.count = 0; this.flying = 0; this.player = player; this.traffic = traffic; this.props = props;
    this.rest.length = 0; this.lying = props?.lying?.() ?? NONE;
    // (the player on foot is no car: see shove)
    this.onFoot = player?.walker ? player : null;
    if (!this.onFoot) this.add(player, time);
    if (traffic?.enabled) {
      for (const car of traffic.vehicles) this.add(car, time);
      // (and parked cars knocked loose, while they are out of their bays)
      for (const car of traffic.woken ?? []) if (car.parked) this.add(car, time);
    }
    // (and the player's own car where they left it, knocked about as those are)
    for (const car of traffic?.playerCars ?? []) this.add(car, time);
    for (const body of props?.bodies ?? []) if (!body.asleep && !body.sunk && !body.removed) this.addPiece(body);
  }
  // A loose piece, if it is moving fast enough to knock someone over
  addPiece(body) {
    // (a ball bounces off people: it is a game to them, not a blow)
    if (body.kind.kick) return;
    const { p, v, w, q, shape } = body, fastest = Math.hypot(v.x, v.y, v.z) + Math.hypot(w.x, w.y, w.z) * shape.radius;
    if (fastest < FLUNG || fastest * body.kind.mass < HEFT) return;
    const piece = this.pieces[this.flying] ?? (this.pieces[this.flying] = { body: null, points: new Float32Array(shape.points.length), count: 0, hit: -1 });
    if (piece.points.length < shape.points.length) piece.points = new Float32Array(shape.points.length);
    const points = piece.points, from = shape.points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < from.length; i += 3) {
      pieceAt.set(from[i], from[i + 1], from[i + 2]).applyQuaternion(q).add(p);
      points[i] = pieceAt.x; points[i + 1] = pieceAt.y; points[i + 2] = pieceAt.z;
      minX = Math.min(minX, pieceAt.x); maxX = Math.max(maxX, pieceAt.x); minY = Math.min(minY, pieceAt.y); maxY = Math.max(maxY, pieceAt.y); minZ = Math.min(minZ, pieceAt.z); maxZ = Math.max(maxZ, pieceAt.z);
    }
    Object.assign(piece, { body, count: from.length, minX, maxX, minY, maxY, minZ, maxZ });
    this.flying++;
  }
  add(car, time) {
    const p = car?.groundedPosition ?? car?.position;
    if (!p || !car.spec) return;
    let previous = this.history.get(car);
    if (!previous) {
      previous = { x: p.x, z: p.z, time, generation: car.generation, restX: NaN, restZ: NaN, paved: undefined };
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
    // (the way it is going, for anyone dodging it: the player's car and any knocked loose)
    footprint.vx = continuous ? (p.x - previous.x) / dt : 0; footprint.vz = continuous ? (p.z - previous.z) / dt : 0;
    footprint.threat = car === this.player || Boolean(car.loose);
    footprint.x = p.x; footprint.y = p.y; footprint.z = p.z;
    footprint.px = continuous ? previous.x : p.x; footprint.pz = continuous ? previous.z : p.z;
    footprint.cos = Math.cos(car.heading); footprint.sin = Math.sin(car.heading);
    footprint.width = car.spec.width / 2; footprint.length = car.spec.length / 2;
    footprint.moving = speed > 1.2;
    // (at rest with a corner on a pavement, it is in someone's way: asked again only once it has moved)
    if (!footprint.moving) {
      if (previous.paved === undefined || (p.x - previous.restX) ** 2 + (p.z - previous.restZ) ** 2 > .09) {
        previous.restX = p.x; previous.restZ = p.z; previous.paved = false;
        for (let k = 0; k < 4 && !previous.paved; k++) {
          const w = footprint.width * (k & 1 ? 1 : -1), l = footprint.length * (k & 2 ? 1 : -1);
          previous.paved = surfaceAt(-(p.z + w * footprint.sin - l * footprint.cos), p.x + w * footprint.cos + l * footprint.sin) === 'pavement';
        }
      }
      if (previous.paved) this.rest.push(footprint);
    } else previous.paved = undefined;
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
    // (and loose pieces, by whichever of their points reaches them)
    for (let i = 0; i < this.flying && !moving; i++) {
      const piece = this.pieces[i], points = piece.points, reach = radius + .1;
      if (piece.body === person.body || x < piece.minX - reach || x > piece.maxX + reach || z < piece.minZ - reach || z > piece.maxZ + reach || y > piece.maxY || y + STANDING < piece.minY) continue;
      for (let k = 0; k < piece.count; k += 3) {
        if (points[k + 1] < y || points[k + 1] > y + STANDING || (points[k] - x) ** 2 + (points[k + 2] - z) ** 2 > reach * reach) continue;
        touching = true;
        // (by the point that meets them: a tree rolling slowly over has a
        // fast point up in its crown, and knocked people down with its trunk)
        if (this.props.speedAt(piece.body, points[k], points[k + 1], points[k + 2]) < FLUNG) continue;
        moving = piece; piece.hit = k; break;
      }
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
  // With `hop`, they only jump out of the way and land where they stood (see applyHop).
  person(person, matrix, frame, radius, time, rejoin = null, hop = false) {
    if (hop) {
      const at = position.setFromMatrixPosition(matrix).applyMatrix4(frame), car = this.hit(person, at.x, at.y, at.z, radius);
      if (car && person.hopStart === undefined) {
        // (cartwheeling away from the car: the way their right hand points, if it came from their left)
        const side = world.multiplyMatrices(frame, matrix).elements, x = side[0], z = side[2];
        // (a flying piece has no x and z of its own: its body's position)
        const from = car.body?.p ?? car;
        person.hopStart = time; person.hopSpin = (at.x - from.x) * x + (at.z - from.z) * z > 0 ? -1 : 1;
      }
      return person.hopStart !== undefined && applyHop(person, matrix, time);
    }
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
    // Shoved aside by the player on foot, or at a charge bowled over
    const charged = !away && this.onFoot ? this.shove(person, matrix, frame, radius, time) : false;
    // Diving out of the way (a dive under way finishes even once dodging stops)
    if (!away && !charged && (this.dodge || person.dive)) this.dive(person, matrix, frame, radius, time);
    // Stepping round what stands or lies on their way
    // (the test sidestep makes first, here: calling it at all made its closures' context for every resident every frame)
    if (!away && !charged && (this.rest.length || this.lying.length || person.aside)) this.sidestep(person, matrix, frame, radius, time);
    const at = position.setFromMatrixPosition(matrix).applyMatrix4(frame), car = this.props && (charged ? { car: this.player } : this.hit(person, at.x, at.y, at.z, radius));
    if (!car) {
      // (the dive's leap is drawn once they are known to be clear: it
      // cartwheels their feet up out of reach of the test)
      if (person.hopStart !== undefined) applyHop(person, matrix, time);
      return away;
    }
    person.dive = null; delete person.hopStart;
    world.multiplyMatrices(frame, matrix);
    // Knocked flying: whatever they were doing, a body takes their place.
    // A loose piece that hit them gives up its share of the blow.
    const piece = car.body, player = !piece && car.car === this.player;
    const motion = piece ? this.props.motionOf(piece, car.points[car.hit], car.points[car.hit + 1], car.points[car.hit + 2]) : player ? this.props.carOf(this.player) : this.traffic.motion(car.car);
    if (!player && !piece) { motion.y = car.y; }
    if (charged) motion.mass = CHARGE;
    const { body, blow } = this.props.person(cityWalker, world, motion);
    this.onKnock?.(piece ? 'piece' : player ? 'player' : car.car.loose || car.car.parked ? 'loose' : 'traffic', { x: at.x, y: at.y, z: at.z }, piece?.piece.kind);
    if (player && blow) this.player.strike(blow.x, blow.z, blow.spin, Math.hypot(blow.x, blow.z));
    if (piece && blow) { piece.v.x += blow.x; piece.v.z += blow.z; }
    person.body = body; person.rise = person.back = null;
    return true;
  }
  // The player on foot against someone drawn by `matrix` (in `frame`): they
  // give way, moved out of the player's path (and one pushed as far as
  // SHOVED will go no further: the player is stopped instead), and turn to
  // look (`shovedBy`, where the player stood in their frame). What a shove
  // left of them fades as they step back onto their walk. True if the
  // player charged into them, to be bowled over as by a car.
  shove(person, matrix, frame, radius, time) {
    const e = matrix.elements, f = frame.elements, player = this.onFoot, p = player.groundedPosition;
    let shove = person.shove;
    const elapsed = shove ? Math.max(0, time - shove.time) : 1 / 60, dt = Math.min(.1, elapsed);
    if (shove) {
      const far = Math.hypot(shove.x, shove.z), back = Math.max(0, far - elapsed * RETURN) / (far || 1);
      shove.x *= back; shove.z *= back; shove.time = time;
      if (back === 0) shove = person.shove = null;
    }
    const x = e[12] + f[12] + (shove?.x ?? 0), z = e[14] + f[14] + (shove?.z ?? 0), reach = radius + player.spec.radius;
    const dx = x - p.x, dz = z - p.z, distance = Math.hypot(dx, dz);
    if (distance < reach && Math.abs(e[13] + f[13] - p.y) < 1.5) {
      const nx = distance > 1e-6 ? dx / distance : 1, nz = distance > 1e-6 ? dz / distance : 0, v = player.velocity, speed = Math.hypot(v.x, v.z);
      if (speed > TACKLE && v.x * nx + v.z * nz > speed * .5) { person.shove = null; return true; }
      if (!shove) shove = person.shove = { x: 0, z: 0, time };
      // Out of the way the player is going: back from them, and aside, to
      // whichever side of their path they were on
      let ax = nx, az = nz;
      if (speed > .1) {
        const along = (nx * v.x + nz * v.z) / speed, side = Math.sign(nx * v.z - nz * v.x) || 1;
        ax += side * v.z / speed * ASIDE * Math.max(0, along); az -= side * v.x / speed * ASIDE * Math.max(0, along);
        const length = Math.hypot(ax, az); ax /= length; az /= length;
      }
      const push = (reach - distance) / Math.max(.3, ax * nx + az * nz);
      // (no further than where they can stand: against a wall, a post or the
      // curb they are pushed no more, and the player is stopped instead)
      const held = !this.standable(x + ax * push, z + az * push, radius);
      if (!held) { shove.x += ax * push; shove.z += az * push; }
      const far = Math.hypot(shove.x, shove.z), over = held ? push : Math.max(0, far - SHOVED);
      if (far > SHOVED) { shove.x *= SHOVED / far; shove.z *= SHOVED / far; }
      player.walker.brush(nx, nz, over, Math.exp(-RESIST * dt));
      person.shovedBy = { x: p.x - f[12], z: p.z - f[14], until: time + LOOK };
    }
    if (shove) { e[12] += shove.x; e[14] += shove.z; }
    return false;
  }
  // Someone drawn by `matrix` (in `frame`) in the way of a car bearing down
  // on them leaps aside with the fares' hop, as Crazy Taxi's pedestrians do,
  // far enough to clear its side, then drifts back onto their walk as a
  // shoved one does. Their partner walks on: a dive is no stop. The hit test
  // is from where the dive has got them, so leaving it late still gets them hit.
  dive(person, matrix, frame, radius, time) {
    const e = matrix.elements, f = frame.elements;
    // (from where their walk has them: they stay out of its way until it has gone by)
    const threat = this.threat(e[12] + f[12], e[13] + f[13], e[14] + f[14], radius);
    let dive = person.dive;
    if (threat) {
      if (!dive) {
        this.landing(threat, e[12] + f[12], e[14] + f[14], radius);
        dive = person.dive = { at: time, x: threat.x, z: threat.z, until: 0 };
        // (cartwheeling the way they dive)
        person.hopStart = time; person.hopSpin = e[0] * dive.x + e[2] * dive.z > 0 ? -1 : 1;
      }
      dive.until = time + DIVE_HOLD;
    }
    if (!dive) return;
    const out = smooth(Math.min(1, (time - dive.at) / PEDESTRIAN_HOP)), far = Math.hypot(dive.x, dive.z) || 1e-6;
    const k = out * Math.max(0, 1 - Math.max(0, time - Math.max(dive.until, dive.at + PEDESTRIAN_HOP)) * RETURN / far);
    if (k <= 0 && out === 1) { person.dive = null; return; }
    e[12] += dive.x * k; e[14] += dive.z * k;
  }
  // The way to dive, as { x, z }, from the first car bearing down on someone
  // standing at (x, y, z), or alongside them: null if none is
  threat(x, y, z, radius) {
    for (let i = 0; i < this.count; i++) {
      const car = this.cars[i];
      if (!car.threat) continue;
      const speed = Math.hypot(car.vx, car.vz);
      if (speed < DODGE_SPEED || Math.abs(y - car.y) > 2) continue;
      // Along and across the way it is going, from its middle
      const ux = car.vx / speed, uz = car.vz / speed, dx = x - car.x, dz = z - car.z, along = dx * ux + dz * uz, across = dz * ux - dx * uz;
      const lined = Math.abs(ux * car.sin - uz * car.cos) > .7, reach = (lined ? car.length : car.width) + radius, side = (lined ? car.width : car.length) + radius;
      if (along < -reach || along > reach + Math.min(DODGE_SEEN, speed * DODGE_AHEAD) || Math.abs(across) > side + DODGE_CLEAR) continue;
      const way = Math.sign(across) || 1, far = Math.max(.5, Math.min(DIVE_MOST, side + DODGE_CLEAR - Math.abs(across)));
      dodge.x = -uz * way * far; dodge.z = ux * way * far;
      // (and across its path to its other side, if that is not too far: see landing)
      const other = side + DODGE_CLEAR + Math.abs(across);
      dodge.ox = other <= DIVE_MOST ? uz * way * other : 0; dodge.oz = other <= DIVE_MOST ? -ux * way * other : 0;
      return dodge;
    }
    return null;
  }
  // Whether someone of `radius` can stand at (x, z): on a pavement (or, not
  // `paved`, anywhere) and in none of the colliders of the cells built round
  // them. True when the world is not known (see scenery).
  standable(x, z, radius, paved = true) {
    if (!this.scenery) return true;
    if (paved && surfaceAt(-z, x) !== 'pavement') return false;
    for (const chunk of this.scenery.values()) {
      const b = chunk.collisionBounds;
      if (!b || x < b.minX - radius || x > b.maxX + radius || z < b.minZ - radius || z > b.maxZ + radius) continue;
      for (const solid of chunk.features.colliders) {
        const dx = x - solid.x, dz = z - solid.z, reach = solid.reach + radius;
        if (dx * dx + dz * dz >= reach * reach || solid.woken || solid.clutter || solid.shape || solid.top - PAVEMENT_LEVEL <= .3) continue;
        if (!solid.corners || inside(solid.corners, x, z, radius)) return false;
      }
    }
    return true;
  }
  // Whether the straight way from (ax, az) to (bx, bz) is one they can walk
  walkable(ax, az, bx, bz, radius, paved = true) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / .4));
    for (let i = 1; i <= steps; i++) if (!this.standable(ax + (bx - ax) * i / steps, az + (bz - az) * i / steps, radius, paved)) return false;
    return true;
  }
  // A dive (`way`: x, z, and ox, oz to the car's other side) from (x, z)
  // lands where they can stand: the way first asked for, else the other
  // way, else as far the first way as is clear (and they may yet be hit)
  landing(way, x, z, radius) {
    if (!this.scenery || this.walkable(x, z, x + way.x, z + way.z, radius)) return;
    if ((way.ox || way.oz) && this.walkable(x, z, x + way.ox, z + way.oz, radius)) { way.x = way.ox; way.z = way.oz; return; }
    let k = .75;
    while (k > 0 && !this.walkable(x, z, x + way.x * k, z + way.z * k, radius)) k -= .25;
    way.x *= k; way.z *= k;
  }
  // Someone walking steps round a car at rest on their way (the player's,
  // parked or not, or one knocked there) and round heavy pieces and people
  // lying there, as they step round the player on foot: aside as they come
  // up to it, past it, and back onto their walk. To the side with less to go
  // round where they can stand, on the pavement if either side is. `matrix`
  // (in `frame`) is moved by how far aside they are.
  sidestep(person, matrix, frame, radius, time) {
    const e = matrix.elements, f = frame.elements, x = e[12] + f[12], z = e[14] + f[14], was = person.walked;
    // (nothing to step round, nothing to do: where they were is only kept while something is about)
    if (!this.rest.length && !this.lying.length && !person.aside) return;
    const dt = was ? time - was.time : 0;
    // (standing, they stay as far aside as they are)
    let tx = person.aside?.x ?? 0, tz = person.aside?.z ?? 0;
    if (dt > 0 && dt < .25) {
      const vx = (x - was.x) / dt, vz = (z - was.z) / dt, speed = Math.hypot(vx, vz);
      if (speed > .2) {
        tx = tz = 0;
        // (along and across the way they go: the nearest thing across it)
        const ux = vx / speed, uz = vz / speed, y = e[13] + f[13], pad = radius + ROUND_CLEAR;
        let a0 = Infinity, a1 = 0, c0 = 0, c1 = 0, ox = 0, oz = 0, most = 0;
        // (what they are beside first, then what is nearest ahead, then what they have just passed)
        const take = (cx, cz) => {
          const urgent = extent.c0 >= 0 || extent.c1 <= 0 ? 0 : extent.a0 > 0 ? 1 - extent.a0 / SEEN : extent.a1 < 0 ? 1 + extent.a1 / 3 : 2;
          if (urgent > most) { most = urgent; ({ a0, a1, c0, c1 } = extent); ox = cx; oz = cz; }
        };
        for (const car of this.rest) {
          if (x < car.minX - SEEN || x > car.maxX + SEEN || z < car.minZ - SEEN || z > car.maxZ + SEEN || Math.abs(y - car.y) > 2) continue;
          extent.a0 = extent.c0 = Infinity; extent.a1 = extent.c1 = -Infinity;
          for (let k = 0; k < 4; k++) {
            const w = car.width * (k & 1 ? 1 : -1), l = car.length * (k & 2 ? 1 : -1);
            reach(car.x + w * car.cos + l * car.sin - x, car.z + w * car.sin - l * car.cos - z, ux, uz, pad);
          }
          take(car.x, car.z);
        }
        for (const piece of this.lying) {
          if (Math.abs(piece.u - x) > SEEN + piece.reach || Math.abs(piece.s + z) > SEEN + piece.reach) continue;
          extent.a0 = extent.c0 = Infinity; extent.a1 = extent.c1 = -Infinity;
          for (let k = 0; k < piece.count; k++) reach(piece.discs[k * 2] - x, -piece.discs[k * 2 + 1] - z, ux, uz, pad + .15);
          take(piece.u, -piece.s);
        }
        if (a0 < Infinity) {
          // Which side: as they chose for it before, else the nearer side they can stand on
          let round = person.round;
          if (!round || (round.x - ox) ** 2 + (round.z - oz) ** 2 > .25) {
            const along = (a0 + a1) / 2, sides = Math.abs(c1) <= Math.abs(c0) ? [c1, c0] : [c0, c1];
            const stand = (side, paved) => Math.abs(side) <= ROUND_MOST && this.standable(x + ux * along - uz * side, z + uz * along + ux * side, radius, paved);
            const side = sides.find(each => stand(each, true)) ?? sides.find(each => stand(each, false)) ?? 0;
            round = person.round = { x: ox, z: oz, side };
          }
          const run = Math.max(1.2, Math.abs(round.side) * 2), k = a0 > 0 ? 1 - a0 / run : a1 < 0 ? 1 + a1 / run : 1, out = round.side * smooth(Math.max(0, Math.min(1, k)));
          tx = -uz * out; tz = ux * out;
        } else person.round = null;
      }
    }
    if (was) { was.x = x; was.z = z; was.time = time; } else person.walked = { x, z, time };
    // (aside, and back, no faster than a step)
    const aside = person.aside ??= { x: 0, z: 0 }, gx = tx - aside.x, gz = tz - aside.z, gap = Math.hypot(gx, gz), step = STEP_ASIDE * Math.max(0, Math.min(.1, dt));
    if (gap <= step || !(dt > 0 && dt < .25)) { aside.x = tx; aside.z = tz; } else { aside.x += gx / gap * step; aside.z += gz / gap * step; }
    if (!aside.x && !aside.z && !tx && !tz) { person.aside = null; return; }
    e[12] += aside.x; e[14] += aside.z;
  }
  // A turn on the way from (ax, az) to (bx, bz) that leaves both parts of it
  // clear of walls and furniture, or null if the straight way is clear, or
  // no turn nearby makes it so
  detour(ax, az, bx, bz) {
    const radius = .25, scenery = this.scenery;
    if (!scenery) return null;
    // (tried against only what stands near the way and its turns: against
    // every built cell's colliders, at up to a few thousand points, it took
    // up to 15 ms)
    this.scenery = nearWay(scenery, Math.min(ax, bx) - TURN_MOST, Math.max(ax, bx) + TURN_MOST, Math.min(az, bz) - TURN_MOST, Math.max(az, bz) + TURN_MOST, radius);
    try {
      if (this.walkable(ax, az, bx, bz, radius, false)) return null;
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz) || 1;
      // (aside from the middle of the way, then nearer either end, a little further each try)
      for (const out of TURNS) for (const share of [.5, .3, .7]) {
        const x = ax + dx * share - dz / length * out, z = az + dz * share + dx / length * out;
        if (this.standable(x, z, radius, false) && this.walkable(ax, az, x, z, radius, false) && this.walkable(x, z, bx, bz, radius, false)) return { x, z };
      }
      return null;
    } finally { this.scenery = scenery; }
  }
  // Getting up, then walking back to where they would be now (where they
  // rejoin their walk, which waits for them, or their own spot), briskly
  // if it is far, turning at the end to face on: round a wall, a post or a
  // parked car between them and it, by one turn on the way (see detour).
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
      person.rise = null; person.back = { at: rise.at + PEDESTRIAN_RISE, x: rise.x, z: rise.z, speed: Math.min(PEDESTRIAN_HURRY, PEDESTRIAN_WALK_BACK + far / 25), via: this.detour(rise.x, rise.z, home.x, home.z), rolling: false };
    }
    const back = person.back;
    // (to the turn first, then on from it, already walking: no easing from a standstill again)
    let along = back.rolling ? back.speed * (time - back.at) : eased(0, back.speed, time - back.at);
    if (back.via) {
      const first = Math.hypot(back.via.x - back.x, back.via.z - back.z);
      if (along >= first) { along -= first; back.x = back.via.x; back.z = back.via.z; back.via = null; back.rolling = true; back.at = time - along / back.speed; }
    }
    const to = back.via ?? home, dx = to.x - back.x, dz = to.z - back.z, length = Math.hypot(dx, dz) || 1e-6;
    const pace = back.rolling ? back.speed : easing(0, back.speed, time - back.at);
    if (!back.via && along >= length) { person.back = null; person.arrival = pace; return false; }
    const x = back.x + dx * along / length, z = back.z + dz * along / length, k = back.via ? 0 : smooth(Math.max(0, 1 - (length - along) / TURN_IN));
    const ground = level(x, z), y = (Number.isNaN(ground) ? home.y : ground + lift(home)) * (1 - k) + home.y * k;
    rotation.slerpQuaternions(facing(dx, dz, face), homeRotation, k);
    matrix.copy(local.copy(frame).invert().multiply(world.compose(position.set(x, y, z), rotation, homeScale)));
    lean(matrix, (1 - k) * (pace - 2.2) / .6);
    return true;
  }
}

// The cells of `scenery` with only their colliders that someone of `radius`
// anywhere in the box could be in (see standable), as cells for it
function nearWay(scenery, minX, maxX, minZ, maxZ, radius) {
  const cells = [];
  for (const chunk of scenery.values()) {
    const b = chunk.collisionBounds;
    if (!b || maxX < b.minX - radius || minX > b.maxX + radius || maxZ < b.minZ - radius || minZ > b.maxZ + radius) continue;
    const colliders = [];
    for (const solid of chunk.features.colliders) {
      if (solid.woken || solid.clutter || solid.shape || solid.top - PAVEMENT_LEVEL <= .3) continue;
      // (a centimeter to spare, for the rounding of the points along the way)
      const dx = Math.max(minX - solid.x, 0, solid.x - maxX), dz = Math.max(minZ - solid.z, 0, solid.z - maxZ), reach = solid.reach + radius + .01;
      if (dx * dx + dz * dz < reach * reach) colliders.push(solid);
    }
    cells.push({ collisionBounds: b, features: { colliders } });
  }
  return cells;
}
// (x, z) as far along (ux, uz) and across it as `extent` reaches, `pad` wider
function reach(dx, dz, ux, uz, pad) {
  const along = dx * ux + dz * uz, across = dz * ux - dx * uz;
  extent.a0 = Math.min(extent.a0, along - pad); extent.a1 = Math.max(extent.a1, along + pad);
  extent.c0 = Math.min(extent.c0, across - pad); extent.c1 = Math.max(extent.c1, across + pad);
}
// Whether (x, z) is inside a collider's corners or within `radius` of them
function inside(corners, x, z, radius) {
  let within = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i], b = corners[j], ex = b.x - a.x, ez = b.z - a.z, l = ex * ex + ez * ez;
    const t = l > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l)) : 0;
    if ((x - a.x - ex * t) ** 2 + (z - a.z - ez * t) ** 2 < radius * radius) return true;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) within = !within;
  }
  return within;
}

// How far above the ground a person's walk carries them (the bob of each step)
function lift(at) {
  const ground = level(at.x, at.z);
  return Number.isNaN(ground) ? 0 : Math.max(0, at.y - ground);
}
