import * as THREE from 'three';
import { randomAt, clamp } from './world/route.js';
import { navGraph } from './world/nav-graph.js';
import { createTrafficModels, TRAFFIC_MODELS, TRAFFIC_COLORS } from './traffic-models.js';
import { trafficContact } from './traffic.js';
import { collisionImpulse, contactPoint, footprintMass, heft, rock, rockFrom, skid, LOOSE_GRIP, HANDBRAKE_GRIP, SCENERY_SURFACE } from './impact.js';
import { sceneryContacts } from './collision.js';
import { carProfile } from './car-profile.js';
import { JunctionTraffic, approachControl } from './city-junctions.js';
import { turnPath, approachSpeed, wayOn, bendSpeed, hasTurnPath, turnPathSteps, bendSpeedSteps, isLink, HAIRPIN } from './world/lane-paths.js';
const up = new THREE.Vector3(0, 1, 0), tilt = new THREE.Euler(0, 0, 0, 'YXZ');
const SPAWN_CLEARANCE = 150, RECYCLE_BEHIND = 190, LOCAL_RADIUS = 380;
// Following: braking for what is in the way, and the room left behind it
const FOLLOW_DECEL = 5, FOLLOW_GAP = 2.2;
// Loose furniture lying in its lane (see LooseProps.lying) is kept this far
// off (m, beyond the car's side); a driver held up by it this many seconds
// edges on at this pace (m/s), shoving it aside, if it weighs no more than
// EDGE_MOST (t: a lamp post, not a fallen tree). Nobody drives into someone
// lying in the road: they wait for them to get up.
const LYING_CLEAR = .3, EDGE_AFTER = 3, EDGE = 1.5, EDGE_MOST = .5;
// and dropping back to let in a car that must get over for its turn (see think)
const LET_IN = 2.5;
// A blow along a car's lane is only speed. One that knocks it across its lane
// or sets it turning faster than this (m/s, rad/s), or would drive it
// backwards, knocks it loose: off its rails, skidding on its own tyres (see
// skid in impact.js) until it comes to rest. Then its driver steers back to
// the lane along a curve, as Midtown Madness's traffic did. One knocked off
// its way back STRANDED times, or that cannot find its lane, waits WAIT
// seconds before trying again, and is put straight back on it once the
// player is OUT_OF_SIGHT metres away.
const LOOSE = 2.5, LOOSE_SPIN = .6, STRANDED = 3, WAIT = 4, OUT_OF_SIGHT = 120;
// A shaken driver lifts off and rolls to a stop before driving on, for this
// many seconds per m/s the blow changed the car's speed, and at most MOST.
const DAZE = .1, DAZE_MOST = 1.6;
// Stand-ins for parked cars knocked loose, of each model: made at the start,
// and at most (more are made as a rampage needs them); and how far off the
// player must be before one is put back in its bay (once no other car is in it)
const PARKED_POOL = 4, PARKED_MOST = 16, PARKED_RETURN = 150;
// How far behind a loose car the scenery is looked for, to tell whether a
// push would drive it into it (see pinned)
const PIN = .1;
// Changing lanes. A car moves across by steering, so only as it moves on:
// at most SWERVE metres across per metre on (less at speed, so it takes a
// couple of seconds whatever its speed), easing in and out of it. Drivers
// think about their lane every THINK seconds and change at most every
// SETTLE; one that must get over for its turn and cannot slows to wait at
// the merge point, MERGE_BY short of the line, and after MISS seconds there
// goes straight on instead. Something standing in its way (see stuck) is
// waited behind for AROUND_WAIT seconds, far enough back to pull out round
// it (see runUp), then driven round at AROUND_SPEED at most. The player gets
// a longer wait: the horn first.
const SWERVE = .45, THINK = .4, SETTLE = 3, MERGE_BY = 12, MISS = 4;
const AROUND_WAIT = 1.2, AROUND_WAIT_PLAYER = 3.6, AROUND_SPEED = 4;
// Working out turns ahead (see warm): up to WARM_SLICE ms and WARM_MOST pieces a step
const WARM_SLICE = .1, WARM_MOST = 64;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
// Scratch reused every step, so the traffic leaves next to nothing for the
// collector (see pose, following, pathAhead and steer)
const HERE = { s: 0, u: 0, heading: 0, tx: 0, ty: 0, segment: 0 }, BOX = new Float64Array(4), DISCS = new Float64Array(10), NONE = [];
const SWAY = { lane: 0, slope: 0 }, TURNING = [0, 0], STEER = { lane: 0, slope: 0 }, STEERING = [0, 0];
let PATH = new Float64Array(3 * 48);
// Math.hypot(dx, dy) < clear, answered from the squares. Within a hair of the
// limit hypot itself decides, so the answer is always the same as before.
const within = (dx, dy, clear) => {
  if (!(clear > 0)) return Math.hypot(dx, dy) < clear;
  const d2 = dx * dx + dy * dy, c2 = clear * clear;
  return d2 < c2 * (1 - 1e-9) || (!(d2 > c2 * (1 + 1e-9)) && Math.hypot(dx, dy) < clear);
};
// Whether any of the first n / 2 disc centres comes within `clear` (and a
// hair) of the box round the path ahead (BOX). If none does, none can be
// within `clear` of any point on the path.
const nearBox = (discs, n, clear) => {
  const reach = clear + 1e-6 + (Math.abs(BOX[0]) + Math.abs(BOX[1]) + Math.abs(BOX[2]) + Math.abs(BOX[3])) * 1e-9;
  if (!(reach > 0)) return true;
  for (let j = 0; j < n; j += 2) {
    const u = discs[j], s = discs[j + 1];
    if (!(u < BOX[0] - reach || u > BOX[1] + reach || s < BOX[2] - reach || s > BOX[3] + reach)) return true;
  }
  return false;
};
// Whether a driver's claim on a junction (see JunctionTraffic) shares a junction with another's
const meets = (claim, theirs) => {
  if (!claim) return false;
  const nodes = claim.nodes;
  for (let k = 0; k < nodes.length; k++) if (theirs.nodes.includes(nodes[k])) return true;
  return false;
};
// Whoever has waited longest at a stop line first (see update)
const byWait = (a, b) => (b.stopWait ?? 0) - (a.stopWait ?? 0) || a.index - b.index;
// Every field a traffic car gets while it drives, declared up front as
// undefined. Added a few at a time by Object.assign in spawn and settle, they
// pushed V8 into dictionary properties, and every read in the step was a
// hash lookup. That made the whole update about twice as slow.
const DRIVER = Object.fromEntries(['pending', 'leaving', 'claim', 'edge', 'direction', 'along', 'lane', 'next', 'turn', 'after', 'stopWait', 'loose', 'recover', 'rock',
  'dazed', 'shoved', 'bumped', 'tries', 'stranded', 'laneTo', 'laneOn', 'slope', 'around', 'merging', 'mergeWait', 'stood', 'laneTime', 'pace', 'cruiseSpeed', 'speed',
  's', 'u', 'laneHeading', 'heading', 'held', 'waited', 'blocker', 'think', 'targetSpeed', 'moved', 'dropBack'].map(key => [key, undefined]));
// The lanes each way, as offsets right of the centre line: the kerb lane every
// turn starts and ends in (the profile's), and on a boulevard or the parkway
// the lane beside the median as well
const laneCache = new Map();
export function lanesOf(profile) {
  if (!laneCache.has(profile)) laneCache.set(profile, profile.divider ? [profile.lane, (profile.median + profile.divider) / 2] : [profile.lane]);
  return laneCache.get(profile);
}
// How sharply a car at `speed` may steer across: the most it moves across per
// metre on, and how much that may change per metre
function swerve(speed, out = [0, 0]) {
  const v = Math.max(1, speed);
  out[0] = Math.min(SWERVE, 1.8 / v); out[1] = Math.min(.15, .6 / v);
  return out;
}
// A metre-by-metre step of a lane change (`state`: lane and slope), toward
// lane `to` over `dm` metres on: steering in as far as it may, and out again
// in time to arrive square to the lane
function sway(state, to, dm, [most, ease]) {
  const gap = to - state.lane;
  if (!gap && !state.slope) return;
  const want = Math.sign(gap) * Math.min(most, Math.sqrt(2 * ease * Math.abs(gap)));
  state.slope += clamp(want - state.slope, -ease * dm, ease * dm);
  state.lane += state.slope * dm;
  if (gap && (to - state.lane) * gap <= 0) { state.lane = to; state.slope = 0; }
}
// How far on a car pulling out round something steers to move `shift`
// metres across (see sway)
function runUp(shift) {
  const [most, ease] = swerve(AROUND_SPEED), across = Math.abs(shift);
  return across <= most * most / ease ? 2 * Math.sqrt(across / ease) : across / most + most / ease;
}
// A pose moved `shift` metres to its right
function aside(pose, shift) {
  if (!shift) return pose;
  return { s: pose.s - Math.sin(pose.heading) * shift, u: pose.u + Math.cos(pose.heading) * shift, heading: pose.heading };
}

// A bounded fleet driving the generated streets: each car follows a nav
// graph edge in its lane, picks a way on before each junction and turns onto
// it along a curve (see world/lane-paths.js), claims its way through each
// junction before crossing it (see city-junctions.js), brakes for whatever is
// on its path ahead, the player included, and recycles beyond the local view.
// A car's `along` runs on past the start of its turn, through the curve,
// until it joins the next edge. Its `lane` is its offset right of the centre
// line, which it steers toward `laneTo`: on a boulevard it passes slower cars
// and keeps right when it can, and anywhere it drives round a car or anything
// else left standing in its way (see think).
export class CityTraffic {
  constructor(scene, route, s, journey = 'city', u = 0) {
    this.route = route; this.enabled = true; this.time = 0; this.nav = navGraph();
    this.group = new THREE.Group(); this.group.name = 'city-traffic'; scene.add(this.group);
    this.models = createTrafficModels();
    this.junctions = new JunctionTraffic(this.nav);
    this.vehicles = Array.from({ length: 24 }, (_, index) => {
      const model = this.models.create(index % TRAFFIC_MODELS.length, TRAFFIC_COLORS[index % TRAFFIC_COLORS.length]);
      this.group.add(model.car);
      // (its shape, for loose pieces to meet: see carProfile)
      return { ...model, index, generation: 0, profile: this.profileOf(model), position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion(), ...DRIVER };
    });
    // Stand-ins for parked cars knocked loose (see wake)
    this.woken = []; this.standInLimit = PARKED_MOST;
    // The player's own car where they got out of it (see OnFoot): not the
    // traffic's to drive, but in its way, and knocked about as a parked car
    // knocked loose is
    this.playerCars = [];
    TRAFFIC_MODELS.forEach((spec, model) => { for (let k = 0; k < PARKED_POOL; k++) this.addStandIn(model); });
    // Street furniture a loose car can knock over, when there is any (see
    // LooseProps); and the world's chunks, as the last update had them
    this.props = null; this.chunks = null; this.lying = [];
    // Told of each blow a car takes from the player, another car or the
    // scenery it was sent into: `(car, closing)`, closing in m/s (see DemolitionRun)
    this.onDamage = null;
    // What warm has done or is doing (see warm)
    this.warming = null; this.warmableEnds = new Map(); this.warmBent = new Set(); this.warmMoved = new WeakSet(); this.warmPlanned = new WeakMap();
    this.reset(route, s, journey, u);
  }
  // A model's shape along its length (see carProfile), read once for each
  // of the fleet's models
  profileOf(model) {
    this.profiles ??= new Map();
    if (!this.profiles.has(model.spec.name)) this.profiles.set(model.spec.name, carProfile(model.car, model.spec.length));
    return this.profiles.get(model.spec.name);
  }
  addStandIn(model) {
    const made = this.models.create(model, TRAFFIC_COLORS[0]);
    made.car.visible = false; this.group.add(made.car);
    const car = { ...made, index: 100 + this.woken.length, profile: this.profileOf(made), parked: null, loose: null, rock: null, s: 0, u: 0, heading: 0, position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion(), generation: undefined, bay: undefined, dazed: undefined, moved: undefined };
    this.woken.push(car);
    return car;
  }
  reset(route, s, journey = 'city', u = 0) {
    this.route = route; this.time = 0; this.lastS = s; this.lastU = u;
    this.travelS = 0; this.travelU = 0; this.lookAhead = 0;
    this.junctions.reset();
    for (const car of this.woken) this.release(car);
    for (const car of this.vehicles) { car.claim = car.leaving = car.pending = null; this.spawn(car, s, u, true); }
  }
  setEnabled(enabled, player) {
    this.enabled = enabled; this.group.visible = enabled;
    if (enabled) this.reset(this.route, player.s, 'city', player.u);
    else for (const car of this.woken) this.release(car);
  }
  random(car, salt) { return randomAt(car.index + car.generation * 97, 8100 + salt); }
  spawn(car, s, u, initial = false) {
    car.generation++;
    this.junctions.release(car);
    const r = salt => this.random(car, salt);
    const centreS = s + this.travelS * this.lookAhead, centreU = u + this.travelU * this.lookAhead;
    // Only the streets around the car are worth trying. (By the squares, with
    // hypot deciding within a hair of the radius, so the list is as before.)
    const { edges: streets, middles } = this.spawnable(), edges = [], r2 = LOCAL_RADIUS * LOCAL_RADIUS;
    for (let k = 0; k < streets.length; k++) {
      const ds = middles[k * 2 + 1] - centreS, du = middles[k * 2] - centreU, d2 = ds * ds + du * du;
      if (d2 < r2 * (1 - 1e-9) || (!(d2 > r2 * (1 + 1e-9)) && Math.hypot(ds, du) <= LOCAL_RADIUS)) edges.push(streets[k]);
    }
    for (let attempt = 0; attempt < 60 && edges.length; attempt++) {
      const edge = edges[Math.floor(r(10 + attempt * 3) * edges.length)];
      const direction = r(11 + attempt * 3) < .5 ? 1 : -1, along = 12 + r(12 + attempt * 3) * (edge.length - 24);
      const pose = this.nav.pose(edge, along, direction, edge.profile.lane);
      const ds = pose.s - s, du = pose.u - u, distance = Math.hypot(ds, du);
      if (distance < (initial ? 25 : SPAWN_CLEARANCE) || distance > LOCAL_RADIUS) continue;
      if (!initial && this.lookAhead && ds * this.travelS + du * this.travelU < 60) continue;
      if (this.vehicles.some(other => other !== car && Math.hypot(pose.s - other.s, pose.u - other.u) < 14)) continue;
      // and never over a stop line, in a junction it has not claimed
      const control = approachControl(this.nav, edge, direction);
      if (control?.kind && edge.length - along < control.stopDistance + 6) continue;
      Object.assign(car, { edge, direction, along, lane: edge.profile.lane, next: null, turn: null, after: null, stopWait: 0, loose: null, recover: null, rock: null, dazed: 0, shoved: false, bumped: 0, tries: 0, stranded: 0 });
      this.settle(car, edge.profile.lane);
      // Each driver keeps their own pace, a share of every street's speed
      car.pace = .75 + r(4) * .25; car.cruiseSpeed = edge.profile.speed * car.pace; car.speed = car.cruiseSpeed;
      // Knowing its way on from the start, a car is never placed past a turn it
      // has not chosen, nor going faster than it could take the turn ahead
      this.choose(car);
      // and never part-way round it
      if (car.along > car.turn.start - 2) car.along = Math.max(0, car.turn.start - 2);
      // (on a boulevard, some start by the median, if they need not leave it soon)
      const lanes = lanesOf(edge.profile);
      if (lanes.length > 1 && r(40) < .35 && (this.carriesOn(car) || this.lineAt(car) - car.along > 120)) {
        this.settle(car, lanes[1]);
        const at = this.ahead(car, 0);
        if (this.vehicles.some(other => other !== car && Math.hypot(at.s - other.s, at.u - other.u) < 14)) this.settle(car, edge.profile.lane);
      }
      car.speed = Math.min(car.speed, approachSpeed(car.turn, car.turn.start - car.along), bendSpeed(this.nav, edge, direction, along, car.lane), this.afterSpeed(car));
      this.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      car.car.visible = true;
      return true;
    }
    // Nowhere free just now: a car with no street waits out of sight and tries again later
    if (!car.edge) car.car.visible = false;
    return false;
  }
  // The streets a car may be put on (no paths, none too short) and their middle points, gathered once
  spawnable() {
    if (!this.streets) {
      const edges = this.nav.edges.filter(edge => !(edge.kind === 'path' || edge.length < 30)), middles = new Float64Array(edges.length * 2);
      edges.forEach((edge, k) => { const middle = edge.points[Math.floor(edge.points.length / 2)]; middles[k * 2] = middle.x; middles[k * 2 + 1] = middle.y; });
      this.streets = { edges, middles };
    }
    return this.streets;
  }
  pose(car) {
    // On its rails, unless a blow has knocked it loose or it is steering back
    // (turned a little across it while changing lanes)
    if (car.edge && !car.loose && !car.recover) {
      const pose = this.aheadInto(HERE, car, 0) ? HERE : this.nav.poseInto(HERE, car.edge, car.along, car.direction, car.lane);
      car.s = pose.s; car.u = pose.u; car.laneHeading = pose.heading; car.heading = pose.heading + Math.atan(car.laneOn === car.edge ? car.slope ?? 0 : 0);
    }
    const p = this.route.position(car.s, car.u);
    car.position.set(p.x, p.y, p.z);
    if (car.rock) car.quaternion.setFromEuler(tilt.set(car.rock.pitch, -car.heading, car.rock.roll));
    else car.quaternion.setFromAxisAngle(up, -car.heading);
  }
  // How a car moves as a body, for a blow to read: along its lane at its own
  // speed, along its way back to it, or however a knock has it sliding and
  // turning; and what it weighs in a blow (see heft)
  motion(car) {
    const loose = car.loose, way = car.recover ? car.heading : car.laneHeading, speed = car.recover ? car.recover.speed : car.speed;
    // (and across it, changing lanes)
    const across = loose || car.recover ? 0 : speed * (car.slope ?? 0);
    return { x: car.position.x, z: car.position.z, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2,
      mass: heft(car.spec.mass ?? footprintMass(car.spec.width, car.spec.length)),
      vx: loose ? loose.vx : Math.sin(way) * speed + Math.cos(way) * across, vz: loose ? loose.vz : -Math.cos(way) * speed + Math.sin(way) * across, spin: loose?.spin ?? 0 };
  }
  // A blow to a car (see impact.js). Along its lane it is speed, though never
  // through rest; otherwise it knocks the car loose. Either way its body
  // rocks, and a hard one shakes its driver.
  strike(car, dvx, dvz, spin) {
    const cos = Math.cos(car.heading), sin = Math.sin(car.heading), along = dvx * sin - dvz * cos, across = dvx * cos + dvz * sin;
    rockFrom(car.rock ??= { pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 }, along, across);
    const blow = Math.hypot(dvx, dvz);
    if (blow > 2 && !car.parked) car.dazed = Math.max(car.dazed, Math.min(DAZE_MOST, blow * DAZE));
    if (!car.loose) {
      if (!car.recover && Math.abs(across) < LOOSE && Math.abs(spin) < LOOSE_SPIN && car.speed + along > -LOOSE) {
        // (and for a moment it may be shoved into the car ahead: see knockOn)
        car.speed = Math.max(0, car.speed + along); car.shoved ||= car.speed > car.cruiseSpeed; car.bumped = .5;
        return;
      }
      this.loosen(car);
    }
    car.loose.vx += dvx; car.loose.vz += dvz; car.loose.spin = clamp(car.loose.spin + spin, -6, 6);
  }
  // Off its rails, moving as it was. Knocked off its way back, it tries again
  // once it comes to rest, a few times.
  loosen(car) {
    const m = this.motion(car);
    if (car.recover && ++car.tries >= STRANDED) car.stranded = WAIT;
    car.loose = { vx: m.vx, vz: m.vz, spin: 0 }; car.speed = 0; car.recover = null;
    car.slope = 0; car.around = null; car.merging = false;
  }
  // Moved a little, as when parted from a car it overlaps
  nudge(car, dx, dz) { car.u += dx; car.s -= dz; car.moved = true; this.pose(car); }
  // Whether a car other than `except` stands on a collider's spot (a parked
  // car's bay, or where furniture stood: see LooseProps.update), as a disc of its reach
  standsIn(collider, except = null) {
    return [this.vehicles, this.woken, this.playerCars].some(list => list.some(other => {
      if (other === except || !other.car.visible || !(list === this.playerCars || other.edge || other.parked)) return false;
      const a = this.motion(other), cos = Math.cos(a.heading), sin = Math.sin(a.heading), dx = collider.x - a.x, dz = collider.z - a.z;
      return Math.abs(dx * cos + dz * sin) < a.halfWidth + collider.reach && Math.abs(dx * sin - dz * cos) < a.halfLength + collider.reach;
    }));
  }
  // Whether another car stands where this one does
  crowded(car) {
    const a = this.motion(car);
    return [this.vehicles, this.woken, this.playerCars].some(list => list.some(other => other !== car && other.car.visible && (list === this.playerCars || other.edge || other.parked)
      && Math.abs(other.position.x - car.position.x) < 7 && Math.abs(other.position.z - car.position.z) < 7 && trafficContact(a, this.motion(other))));
  }
  // Whether a loose car has the scenery hard behind it the way (nx, nz) a
  // push would move it, near enough square on (pushed at a slant, it slides
  // along it): pinned there, it can give no further way, and whatever
  // pushes it meets it as it would the wall. (Otherwise a truck shoving a
  // car against a building pressed it into it.) A parked car or furniture
  // there is no wall: pushed into it, the car knocks it loose.
  pinned(car, nx, nz) {
    if (!car.loose || !this.chunks) return false;
    const halfWidth = car.spec.width / 2, halfLength = car.spec.length / 2;
    let against = false;
    sceneryContacts(() => ({ x: car.u + nx * PIN, z: -car.s + nz * PIN, heading: car.heading, halfWidth, halfLength }), this.chunks.values(), (contact, solid) => {
      if (!solid.parked && !solid.prop) against ||= contact.x * nx + contact.z * nz < -.7;
    });
    return against;
  }
  // A loose car skidding to rest. The water's edge stops it; the scenery it
  // runs into takes a blow as the player's car does, and a parked car it runs
  // into is knocked loose in turn. At rest, its driver steers back to its lane.
  slide(car, dt, chunks) {
    const loose = car.loose;
    if (loose.vx || loose.vz || loose.spin) {
      skid(loose, car.heading, dt, car.parked || car.handbrake ? HANDBRAKE_GRIP : LOOSE_GRIP);
      const s = car.s, u = car.u;
      car.u += loose.vx * dt; car.s -= loose.vz * dt; car.heading += loose.spin * dt;
      if (this.route.water?.(car.s, car.u)) { car.s = s; car.u = u; loose.vx = loose.vz = 0; }
      car.moved = true;
    }
    if (chunks && car.moved) this.hitScenery(car, chunks);
    car.moved = false;
    if (car.edge && !car.stranded && !(car.dazed > 0) && Math.hypot(loose.vx, loose.vz) < .4 && Math.abs(loose.spin) < .15) this.steerBack(car);
    // (and one that gave up tries once more after a while)
    else if (car.stranded && (car.stranded = Math.max(0, car.stranded - dt)) === 0) car.tries = STRANDED - 1;
  }
  hitScenery(car, chunks) {
    const halfWidth = car.spec.width / 2, halfLength = car.spec.length / 2;
    sceneryContacts(() => ({ x: car.u, z: -car.s, heading: car.heading, halfWidth, halfLength }), chunks.values(), (contact, solid) => {
      if (solid.parked && this.wake(solid, car)) return;
      // (and furniture it slides into flies, taking a little of its speed: see LooseProps)
      const knocked = solid.prop && this.props?.knock(solid, contact, { ...this.motion(car), y: car.position.y, height: car.profile.height });
      if (knocked) { this.strike(car, knocked.x, knocked.z, knocked.spin); return; }
      const point = contact.point, blow = collisionImpulse(this.motion(car), { x: point.x, z: point.z, vx: 0, vz: 0, mass: Infinity }, contact, point, SCENERY_SURFACE);
      if (blow) { this.strike(car, blow.a.x, blow.a.z, blow.a.spin); this.onDamage?.(car, blow.closing); }
      car.u += contact.x * (contact.depth + .005); car.s -= contact.z * (contact.depth + .005);
    });
  }
  // Come to rest, the driver finds the nearest point of its lane and steers
  // back onto it along a curve that leaves where the car stands the way it
  // faces, and joins the lane a few lengths on the way the lane runs; the
  // further off and the more turned, the longer the curve. Facing too far the
  // wrong way, it first turns about on the spot.
  steerBack(car) {
    let near = null;
    for (let d = -Math.min(50, car.along); d <= 50; d += 1) {
      const p = this.ahead(car, d);
      if (!p) break;
      const distance = Math.hypot(p.s - car.s, p.u - car.u);
      if (!near || distance < near.distance) near = { d, distance, p };
    }
    if (!near || near.distance > 40) { car.stranded = WAIT; return; }
    // (back to whichever of its street's lanes it is nearer, on a boulevard,
    // unless it must be in the kerb lane for its turn)
    const lanes = lanesOf(car.edge.profile);
    if (lanes.length > 1) {
      const p = near.p, across = car.lane + (car.u - p.u) * Math.cos(p.heading) - (car.s - p.s) * Math.sin(p.heading);
      const free = this.carriesOn(car) || car.along + near.d + 30 < this.lineAt(car);
      this.settle(car, free && Math.abs(across - lanes[1]) < Math.abs(across - lanes[0]) ? lanes[1] : lanes[0]);
    } else this.settle(car, car.edge.profile.lane);
    const turn = wrap(near.p.heading - car.heading);
    car.loose = null; car.laneHeading = near.p.heading;
    if (Math.abs(turn) > 1.9) { car.recover = { about: Math.sign(turn), time: 0, speed: 0 }; return; }
    let join = near.d + clamp(6 + near.distance * 2.5 + Math.abs(turn) * 6, 8, 30), end = this.ahead(car, join);
    while (!end && join > near.d + 4) { join -= 2; end = this.ahead(car, join); }
    if (!end) { car.stranded = WAIT; car.loose = { vx: 0, vz: 0, spin: 0 }; return; }
    // A Hermite curve between the two poses, each tangent as long as the gap
    const k = Math.hypot(end.s - car.s, end.u - car.u) * 1.1, points = [], lengths = [0];
    const from = { u: car.u, s: car.s, du: Math.sin(car.heading) * k, ds: Math.cos(car.heading) * k }, to = { u: end.u, s: end.s, du: Math.sin(end.heading) * k, ds: Math.cos(end.heading) * k };
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, t2 = t * t, t3 = t2 * t;
      const a = 2 * t3 - 3 * t2 + 1, b = t3 - 2 * t2 + t, c = -2 * t3 + 3 * t2, d = t3 - t2;
      const da = 6 * t2 - 6 * t, db = 3 * t2 - 4 * t + 1, dc = -6 * t2 + 6 * t, dd = 3 * t2 - 2 * t;
      const point = { u: a * from.u + b * from.du + c * to.u + d * to.du, s: a * from.s + b * from.ds + c * to.s + d * to.ds };
      point.heading = Math.atan2(da * from.u + db * from.du + dc * to.u + dd * to.du, da * from.s + db * from.ds + dc * to.s + dd * to.ds);
      if (i) lengths.push(lengths[i - 1] + Math.hypot(point.u - points[i - 1].u, point.s - points[i - 1].s));
      points.push(point);
    }
    car.recover = { points, lengths, at: 0, speed: 0, join };
  }
  // Along the curve back, gathering speed, and onto the lane at its end
  rejoin(car, dt) {
    const r = car.recover;
    if (r.about) {
      // Turning about: creeping forward and back while it swings round
      r.time += dt; r.speed = 1.4 * Math.sin(r.time * 2.6);
      car.heading += r.about * .75 * dt; car.u += Math.sin(car.heading) * r.speed * dt; car.s += Math.cos(car.heading) * r.speed * dt;
      if (Math.abs(wrap(car.laneHeading - car.heading)) < 1.1) { car.recover = null; car.loose = { vx: 0, vz: 0, spin: 0 }; this.steerBack(car); }
      else if (r.time > 10) { car.recover = null; car.loose = { vx: 0, vz: 0, spin: 0 }; car.stranded = WAIT; }
      return;
    }
    const { points, lengths } = r, total = lengths[lengths.length - 1];
    // Not yet in the lane, it waits for a gap in the traffic coming along it
    if (r.at < total * .4 && this.approaching(car, r.join)) r.speed = Math.max(0, r.speed - 8 * dt);
    else r.speed = Math.min(r.speed + 2.5 * dt, Math.min(7, car.cruiseSpeed));
    r.at += r.speed * dt;
    if (r.at >= total) {
      car.along += r.join;
      for (let i = 0; i < 4 && car.along >= (car.turn ? car.turn.start + car.turn.length : car.edge.length); i++) this.advance(car);
      car.speed = r.speed; car.recover = null; car.tries = 0;
      return;
    }
    let i = 1;
    while (lengths[i] < r.at) i++;
    const a = points[i - 1], b = points[i], t = (r.at - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    car.u = a.u + (b.u - a.u) * t; car.s = a.s + (b.s - a.s) * t; car.heading = a.heading + wrap(b.heading - a.heading) * t;
    car.moved = true;
  }
  // A parked car the player or a loose car runs into is knocked loose: one
  // of a few stand-ins takes its place, handbrake on, and its bay stands
  // empty until the player has driven well away (see release)
  wake(collider, except = null) {
    const info = collider.parked;
    if (!this.enabled || !info?.ready) return false;
    const car = this.standIn(info.model, except);
    if (!car) return false;
    this.stand(car, collider, this.bayPose(collider), false);
    return true;
  }
  // Where a parked car stands in its bay, and which way along its length its nose points
  bayPose(collider) {
    const info = collider.parked, [a, b, c] = collider.corners, long = Math.hypot(b.x - a.x, b.z - a.z) > Math.hypot(c.x - b.x, c.z - b.z) ? [a, b] : [b, c];
    let fu = long[1].x - long[0].x, fs = -(long[1].z - long[0].z);
    if (fu * info.nose.u + fs * info.nose.s < 0) { fu = -fu; fs = -fs; }
    return { s: -collider.z, u: collider.x, heading: Math.atan2(fu, fs) };
  }
  // A stand-in for the parked car in `collider`'s bay, standing at `pose`,
  // its bay empty (`moved`: somewhere the scenery must be checked)
  stand(car, collider, pose, moved) {
    const info = collider.parked;
    this.release(car);
    // (a new car, as far as anything keeping track of one is concerned)
    car.generation = (car.generation ?? 0) + 1;
    Object.assign(car, { parked: collider, s: pose.s, u: pose.u, heading: pose.heading, bay: this.bayPose(collider).heading, loose: { vx: 0, vz: 0, spin: 0 }, rock: null, dazed: 0, moved });
    car.paint.color.set(info.colour); car.car.visible = true;
    collider.woken = true; info.hide(true);
    this.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
  }
  // The player gets into a parked car (see OnFoot), in its bay or knocked
  // loose: its bay stays empty while they have it, and a stand-in that had
  // it goes back to the pool. Only while there is traffic, as for wake.
  takeParked(collider) {
    if (!this.enabled || !collider.parked?.ready) return false;
    const standIn = this.woken.find(car => car.parked === collider);
    if (standIn) Object.assign(standIn, { parked: null, loose: null }).car.visible = false;
    else { collider.woken = true; collider.parked.hide(true); }
    return true;
  }
  // Back from the player where they got out of it, `pose`: a stand-in, as
  // though knocked loose to there, which goes back to its bay once they are
  // well away (see release). With no pose, or no traffic, straight back.
  leaveParked(collider, pose = null) {
    const car = pose && this.enabled && this.standIn(collider.parked.model);
    if (car) this.stand(car, collider, pose, true);
    else { collider.woken = false; collider.parked.hide(false); }
  }
  // A free stand-in of the model or, with all of them out (a row of cars
  // knocked into each other uses them up fast), one that has settled back
  // where it was parked, else a new one while there are under standInLimit,
  // else the one at rest furthest from the player. One still moving is never taken.
  standIn(model, except) {
    let best = null, score = -Infinity, count = 0;
    for (const car of this.woken) {
      if (car.spec.name !== model) continue;
      count++;
      if (car === except) continue;
      if (!car.parked) return car;
      const loose = car.loose;
      if (!loose || car.rock || Math.hypot(loose.vx, loose.vz) > .05 || Math.abs(loose.spin) > .05) continue;
      const settled = Math.hypot(car.u - car.parked.x, car.s + car.parked.z) < .3 && Math.abs(wrap(car.heading - car.bay)) < .05;
      const value = settled ? Infinity : Math.hypot(car.s - this.lastS, car.u - this.lastU);
      if (value > score) { best = car; score = value; }
    }
    if (score < Infinity && count < this.standInLimit) return this.addStandIn(TRAFFIC_MODELS.findIndex(spec => spec.name === model));
    return best;
  }
  // Put back in its bay, out of sight
  release(car) {
    if (!car.parked) return;
    car.parked.woken = false; car.parked.parked.hide(false);
    car.parked = null; car.loose = null; car.car.visible = false;
  }
  // The player gets into one of the traffic's cars (see OnFoot): it leaves
  // the traffic, and its model the scene, until they give it back
  take(car) {
    const at = this.vehicles.indexOf(car);
    if (at < 0) return false;
    this.vehicles.splice(at, 1); this.junctions.release(car);
    car.claim = car.leaving = car.pending = null; car.car.visible = false;
    return true;
  }
  // Back from the player where they got out of it, `pose` ({ s, u, heading
  // }): its driver drives on from there, back to the nearest lane going the
  // way the car faces, as after a knock (see steerBack), never back the way
  // it came. With no pose, or no street near, it turns up again elsewhere.
  giveBack(car, pose = null) {
    this.vehicles.push(car); car.generation++;
    const hit = pose && this.nav.index.nearest(pose.u, pose.s, 200, (segment, distance) => segment.road.edge.kind === 'path' ? Infinity : distance);
    if (!hit) { car.edge = null; return; }
    const edge = hit.road.edge, along = edge.cumulative[hit.segment.index] + hit.t * hit.segment.length;
    const direction = Math.sin(pose.heading) * hit.tx + Math.cos(pose.heading) * hit.ty >= 0 ? 1 : -1;
    Object.assign(car, { s: pose.s, u: pose.u, heading: pose.heading, edge, direction, along: direction > 0 ? along : edge.length - along, lane: edge.profile.lane,
      next: null, turn: null, after: null, stopWait: 0, loose: { vx: 0, vz: 0, spin: 0 }, recover: null, rock: null, dazed: 0, shoved: false, bumped: 0, tries: 0, stranded: 0, speed: 0, held: 0 });
    this.settle(car, edge.profile.lane);
    car.cruiseSpeed = edge.profile.speed * (car.pace ?? 1);
    this.choose(car); this.pose(car);
    car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion); car.car.visible = true;
  }
  // The player against a car. They share the blow by weight and, once the car
  // is free to move, are parted by weight too: a heavy car shoves a light one.
  // A helicopter up above the traffic (`airborne`) is not in its way at all,
  // and someone on foot (`walker`) moves no car: they are only put back
  // outside it, and take the car's blow (see Walker.resolveTrafficCollision).
  // A loose car pinned against the scenery (see pinned) is part of it to them.
  collidePlayer(car, player) {
    if (player.airborne) return;
    const p = player.groundedPosition;
    if (Math.abs(car.position.x - p.x) > 7 || Math.abs(car.position.z - p.z) > 7) return;
    const a = player.motion(), b = this.motion(car), contact = trafficContact(a, b), walking = Boolean(player.walker);
    if (!contact) return;
    const free = car.loose && !walking && !this.pinned(car, -contact.x, -contact.z);
    if (car.loose && !walking && !free) b.mass = Infinity;
    const blow = collisionImpulse(a, b, contact, contactPoint(a, b, contact));
    if (blow && !walking) { this.strike(car, blow.b.x, blow.b.z, blow.b.spin); this.onDamage?.(car, blow.closing); }
    const share = free ? b.mass / (a.mass + b.mass) : 1, depth = contact.depth + .005;
    player.resolveTrafficCollision(contact.x * depth * share, contact.z * depth * share, blow?.a.x ?? 0, blow?.a.z ?? 0, blow?.a.spin ?? 0, blow?.closing ?? 0, blow?.slide ?? 0);
    if (share < 1) this.nudge(car, -contact.x * depth * (1 - share), -contact.z * depth * (1 - share));
  }
  // A loose car, or one just shoved along its lane, can be knocked into
  // another, which takes its share of the blow in turn; the two are parted
  // by weight, as far as each is free to move (not on its rails, nor
  // pinned against the scenery, see pinned)
  knockOn(car) {
    for (const list of [this.vehicles, this.woken, this.playerCars]) for (const other of list) {
      if (other === car || (list !== this.playerCars && !(other.edge || other.parked)) || Math.abs(other.position.x - car.position.x) > 7 || Math.abs(other.position.z - car.position.z) > 7) continue;
      const a = this.motion(car), b = this.motion(other), contact = trafficContact(a, b);
      if (!contact) continue;
      // (two pinned between walls are parted all the same, rather than left in each other)
      let freeA = car.loose && !this.pinned(car, contact.x, contact.z), freeB = other.loose && !this.pinned(other, -contact.x, -contact.z);
      if (!freeA && !freeB) { freeA = Boolean(car.loose); freeB = Boolean(other.loose); }
      if (car.loose && !freeA) a.mass = Infinity;
      if (other.loose && !freeB) b.mass = Infinity;
      const blow = collisionImpulse(a, b, contact, contactPoint(a, b, contact));
      if (blow) {
        this.strike(car, blow.a.x, blow.a.z, blow.a.spin); this.strike(other, blow.b.x, blow.b.z, blow.b.spin);
        this.onDamage?.(car, blow.closing); this.onDamage?.(other, blow.closing);
      }
      const wa = freeA ? b.mass : 0, wb = freeB ? a.mass : 0, depth = contact.depth + .005;
      if (!wa && !wb) continue;
      const share = !wb ? 1 : !wa ? 0 : wa / (wa + wb);
      if (wa) this.nudge(car, contact.x * depth * share, contact.z * depth * share);
      if (wb) this.nudge(other, -contact.x * depth * (1 - share), -contact.z * depth * (1 - share));
    }
  }
  // Which way on at the end of this edge, and the curve that takes it there.
  // Straight on is likelier; a dead end turns the car round.
  choose(car) {
    // Planned already, if the street before this one was short
    if (car.after && car.after.edge === car.edge && car.after.direction === car.direction) ({ next: car.next, turn: car.turn } = car.after);
    else ({ next: car.next, turn: car.turn } = this.plan(car, car.edge, car.direction));
    car.after = null;
  }
  // The way on from the end of any edge, as this driver would choose it: no
  // paths unless already on one, and straight on likelier
  plan(car, edge, direction) {
    // The driver's choice, unless no car could make that turn and another way on is open
    const pick = options => {
      const preferred = this.preferred(car, edge, options);
      if (options.length < 2 || preferred.via || turnPath(this.nav, edge, direction, preferred).radius >= 3) return preferred;
      return options.find(option => !option.via && turnPath(this.nav, edge, direction, option).radius >= 3) ?? preferred;
    };
    const next = wayOn(this.nav, edge, direction, pick, option => option.edge.kind !== 'path' || edge.kind === 'path');
    return { edge, direction, next, turn: turnPath(this.nav, edge, direction, next) };
  }
  // The way on this driver tries first among `options` (see plan)
  preferred(car, edge, options) {
    const roll = this.random(car, 30 + edge.id);
    return Math.abs(options[0].turn) < .5 && roll < .55 ? options[0] : options[Math.floor(roll * options.length)];
  }
  // The most a car may carry now to take the turn after next, when the street
  // between is too short to slow down on
  afterSpeed(car) {
    const next = car.next;
    if (!car.turn || !next || next.edge.length > 60 || next.edge === car.edge) return Infinity;
    car.after ??= this.plan(car, next.edge, next.direction);
    const distance = car.turn.start - car.along + car.turn.length + Math.max(0, car.after.turn.start - car.turn.end);
    return approachSpeed(car.after.turn, distance);
  }
  // Onto the next edge once through the turn
  advance(car) {
    if (!car.turn) this.choose(car);
    const turn = car.turn, choice = car.next;
    car.along = Math.max(0, turn.end + car.along - turn.start - turn.length);
    // (in the same place across the road: by the median carried straight on
    // into the next boulevard, and anything else steered out of on the way)
    const home = car.edge.profile.lane, lane = car.lane - home + choice.edge.profile.lane, to = this.aim(car) - home + choice.edge.profile.lane;
    car.edge = choice.edge; car.direction = choice.direction; car.next = null; car.turn = null;
    const lanes = lanesOf(car.edge.profile);
    car.lane = lane; car.laneTo = !car.around && lanes.length > 1 && Math.abs(lanes[1] - to) < Math.abs(lanes[0] - to) ? lanes[1] : lanes[0]; car.laneOn = car.edge;
    car.around = null; car.merging = false;
    car.stopWait = 0; car.cruiseSpeed = car.edge.profile.speed * (car.pace ?? 1);
    // The next turn is known on joining a street, so there is all of it to slow down in
    this.choose(car);
  }
  // Where a car will be `d` metres on from where it is: along its lane,
  // round its turn and into the street beyond (null past the end of that),
  // or with `lane`, along another. Out of the kerb lane, the turn and the
  // street beyond are the same distance across.
  ahead(car, d, lane = car.lane) {
    const x = car.along + d, turn = car.turn, shift = lane - car.edge.profile.lane;
    if (turn && x > turn.start) {
      if (x <= turn.start + turn.length) return aside(turn.pose(x - turn.start), shift);
      const beyond = turn.end + x - turn.start - turn.length;
      return beyond > car.next.edge.length ? null : this.nav.pose(car.next.edge, beyond, car.next.direction, car.next.edge.profile.lane + shift);
    }
    return x > car.edge.length ? null : this.nav.pose(car.edge, x, car.direction, lane);
  }
  // ahead without allocating: into `out` (s, u, and heading unless `heading`
  // is false), and false where ahead gives null
  aheadInto(out, car, d, lane = car.lane, heading = true) {
    const x = car.along + d, turn = car.turn, shift = lane - car.edge.profile.lane;
    if (turn && x > turn.start) {
      if (x <= turn.start + turn.length) {
        // (moved over from the heading, as aside does)
        turn.place(x - turn.start, out, false, heading || Boolean(shift));
        if (shift) { const h = out.heading; out.s -= Math.sin(h) * shift; out.u += Math.cos(h) * shift; }
        return true;
      }
      const beyond = turn.end + x - turn.start - turn.length;
      if (beyond > car.next.edge.length) return false;
      this.nav.poseInto(out, car.next.edge, beyond, car.next.direction, car.next.edge.profile.lane + shift, heading);
      return true;
    }
    if (x > car.edge.length) return false;
    this.nav.poseInto(out, car.edge, x, car.direction, lane, heading);
    return true;
  }
  // Settled in a lane, not changing
  settle(car, lane) { Object.assign(car, { lane, laneTo: lane, laneOn: car.edge, slope: 0, around: null, merging: false, mergeWait: 0, stood: 0, laneTime: 0 }); }
  // Steering for another lane of the street it is on
  steerFor(car, lane) { car.laneTo = lane; car.laneOn = car.edge; car.laneTime = 0; }
  // The lane a car is steering for: one chosen on another street (a car
  // moved there by hand, as the tests and review scripts do) is forgotten
  aim(car) { return car.laneOn === car.edge ? car.laneTo ?? car.lane : car.lane; }
  // Along its lane, moving across as it steers for another
  steer(car, dm) {
    if (car.laneOn !== car.edge) { car.slope = 0; return; }
    const to = this.aim(car);
    if (to === car.lane && !car.slope) return;
    const state = STEER;
    state.lane = car.lane; state.slope = car.slope ?? 0;
    sway(state, to, dm, swerve(car.around ? Math.max(car.speed, AROUND_SPEED) : car.speed, STEERING));
    car.lane = state.lane; car.slope = state.slope;
  }
  // Where on its street a car must be in the lane for its turn: short of the
  // stop line, and of the turn
  lineAt(car) {
    const control = approachControl(this.nav, car.edge, car.direction);
    return Math.min(control?.kind ? car.edge.length - control.stopDistance : car.edge.length, car.turn ? car.turn.start : car.edge.length);
  }
  // Whether a car's way on is straight on into another boulevard, which it
  // may take from either lane
  carriesOn(car) {
    const next = car.next;
    return Boolean(next && !next.via && next.edge !== car.edge && Math.abs(next.turn) < .35 && next.edge.profile.divider);
  }
  // Whether something in a car's way is standing there, not just queueing:
  // the player stopped, the car they left, a parked car or a car knocked into
  // the road, or one turning about. A car that is steering back or waiting
  // at a junction is waited for.
  stuck(other, player) {
    if (!other) return false;
    if (other === player) return Math.abs(player.speed ?? 0) < .5;
    const loose = other.loose, resting = !loose || (Math.hypot(loose.vx, loose.vz) < .5 && Math.abs(loose.spin) < .3);
    if (this.playerCars.includes(other)) return resting;
    if (other.parked) return resting;
    if (!other.edge || !this.vehicles.includes(other)) return false;
    return Boolean((loose && resting) || other.recover?.about);
  }
  // Traffic coming along a car's lane toward where it will join it, `join`
  // metres on (see rejoin)
  approaching(car, join) {
    const at = car.along + join;
    return this.vehicles.some(other => other !== car && other.edge === car.edge && other.direction === car.direction && !other.loose && !other.recover
      && other.speed > 2 && Math.abs((other.lane ?? car.lane) - car.lane) < 2 && at - other.along > -4 && at - other.along < 10 + other.speed * 2.5);
  }
  // How fast a car may go for whatever stands on its path in the next few
  // seconds: a car ahead in its lane, one crossing in front of it, or the
  // player. Each other car is three discs down its length. A car waiting at
  // the line of a junction this one is crossing is not in its way, whatever
  // the corner makes it look like, and nor are two cars crossing a junction
  // on paths that do not meet.
  following(car, player) {
    const reach = Math.min(70, car.speed * car.speed / (2 * FOLLOW_DECEL) + 18);
    // (the path ahead, into PATH and BOX, is walked only once something is
    // near enough to be on it)
    let points = -1, limit = Infinity, blocker = null;
    // (whether it holds a claim on a junction, see passes)
    const crossing = (car.claim?.nodes ?? NONE).length + (car.leaving?.nodes ?? NONE).length > 0;
    // (parked cars knocked loose into the road are in the way too, and so is
    // the player's own car wherever they left it)
    const count = this.vehicles.length, woken = count + this.woken.length, total = woken + this.playerCars.length;
    for (let i = 0; i <= total; i++) {
      const other = i === total ? player : i < count ? this.vehicles[i] : i < woken ? this.woken[i - count] : this.playerCars[i - woken];
      if (other === car || (i < woken && !other.edge && !other.parked) || !Number.isFinite(other.heading) || other.airborne) continue;
      if (Math.abs(other.s - car.s) > reach + 6 || Math.abs(other.u - car.u) > reach + 6) continue;
      if (other !== player && other.edge && crossing && this.passes(car, other)) continue;
      if (points < 0) points = this.pathAhead(car, reach);
      const length = other.spec?.length ?? 4.4, reachAlong = length / 2 * .62, clear = (car.spec.width + (other.spec?.width ?? 2)) / 2 + .2;
      // A car by the median that must get over for its turn, ahead in the
      // lane beside, is let in, if this one can drop back for it gently
      if (other.merging && other.edge === car.edge && other.direction === car.direction && Math.abs(car.lane - car.edge.profile.lane) < .5) {
        const room = other.along - car.along - (car.spec.length + length) / 2 - FOLLOW_GAP, allowed = Math.sqrt(2 * LET_IN * Math.max(0, room));
        if (room > 0 && allowed < limit && allowed > car.speed - 1) { limit = allowed; blocker = other; }
      }
      const hx = Math.sin(other.heading) * reachAlong, hy = Math.cos(other.heading) * reachAlong, discs = DISCS;
      discs[0] = other.u; discs[1] = other.s; discs[2] = other.u + hx; discs[3] = other.s + hy; discs[4] = other.u - hx; discs[5] = other.s - hy;
      let n = 6;
      // The player's car, crossing or coming the other way, also where it will be in the next second
      const speed = other === player ? player.speed ?? 0 : 0, dx = Math.sin(other.heading), dy = Math.cos(other.heading);
      if (Math.abs(speed) > 3 && Math.sign(speed) * (dx * Math.sin(car.heading) + dy * Math.cos(car.heading)) < .7) {
        discs[6] = other.u + dx * speed * .5; discs[7] = other.s + dy * speed * .5; discs[8] = other.u + dx * speed * 1; discs[9] = other.s + dy * speed * 1; n = 10;
      }
      // (nowhere near the path's box, it cannot be on it)
      if (!nearBox(discs, n, clear)) continue;
      for (let k = 0; k < points; k += 3) {
        const px = PATH[k + 1], py = PATH[k + 2];
        let hit = false;
        for (let j = 0; j < n && !hit; j += 2) hit = within(px - discs[j], py - discs[j + 1], clear);
        if (hit) {
          // (and something standing in the road is stopped for further back, room to pull out round it)
          const side = !car.around && this.stuck(other, player) ? this.passSides(car, other).sides[0] : undefined;
          const gap = side === undefined ? FOLLOW_GAP : Math.max(FOLLOW_GAP, runUp(side - car.lane) - car.spec.length / 2 + 1);
          const allowed = Math.sqrt(2 * FOLLOW_DECEL * Math.max(0, PATH[k] - car.spec.length / 2 - gap));
          if (allowed < limit) { limit = allowed; blocker = other; }
          break;
        }
      }
    }
    // Furniture lying in the road, too heavy to shove aside, and anyone
    // knocked down (see LooseProps.lying): held up long enough by furniture
    // (see update), the driver edges on through it
    for (const piece of this.lying) {
      if (Math.abs(piece.s - car.s) > reach + piece.reach || Math.abs(piece.u - car.u) > reach + piece.reach) continue;
      if (points < 0) points = this.pathAhead(car, reach);
      const discs = piece.discs, clear = car.spec.width / 2 + LYING_CLEAR;
      for (let k = 0; k < points; k += 3) {
        const px = PATH[k + 1], py = PATH[k + 2];
        let hit = false;
        for (let j = 0; j < piece.count * 2 && !hit; j += 2) hit = within(px - discs[j], py - discs[j + 1], clear);
        if (!hit) continue;
        let allowed = Math.sqrt(2 * FOLLOW_DECEL * Math.max(0, PATH[k] - car.spec.length / 2 - FOLLOW_GAP));
        if (!piece.person && piece.mass <= EDGE_MOST && car.waited > EDGE_AFTER) allowed = Math.max(allowed, EDGE);
        if (allowed < limit) { limit = allowed; blocker = piece; }
        break;
      }
    }
    // (who set the limit, for the horn: see update)
    this.blocker = blocker;
    return limit;
  }
  // The path ahead of a car every 1.5 m out to `reach`, through any lane
  // change it has begun, as it will steer it. Written into PATH as distance,
  // u, s, with the box round it in BOX. Returns how many numbers it wrote.
  pathAhead(car, reach) {
    const to = this.aim(car), state = SWAY;
    state.lane = car.lane; state.slope = car.laneOn === car.edge ? car.slope ?? 0 : 0;
    swerve(car.around ? Math.max(car.speed, AROUND_SPEED) : car.speed, TURNING);
    let n = 0, minU = Infinity, maxU = -Infinity, minS = Infinity, maxS = -Infinity;
    for (let d = 1.5; d <= reach; d += 1.5) {
      sway(state, to, 1.5, TURNING);
      if (!this.aheadInto(HERE, car, d, state.lane, false)) break;
      if (n + 3 > PATH.length) { const longer = new Float64Array(PATH.length * 2); longer.set(PATH); PATH = longer; }
      const u = HERE.u, s = HERE.s;
      PATH[n] = d; PATH[n + 1] = u; PATH[n + 2] = s; n += 3;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (s < minS) minS = s;
      if (s > maxS) maxS = s;
    }
    BOX[0] = minU; BOX[1] = maxU; BOX[2] = minS; BOX[3] = maxS;
    return n;
  }
  // Whether `other` can be left out of `car`'s way while `car` crosses the
  // junctions it holds (see following): waiting at another line there, or
  // crossing on a path that does not meet this one. A car ahead in its own
  // lane is always in its way.
  passes(car, other) {
    if (other.edge === car.edge && other.direction === car.direction) return false;
    // Crossing the same junction: compare the two ways through it
    for (let k = 0; k < 2; k++) {
      const theirs = k ? other.leaving : other.claim;
      const mine = theirs && (meets(car.claim, theirs) ? car.claim : meets(car.leaving, theirs) ? car.leaving : undefined);
      if (!mine) continue;
      return mine.movement.edge !== theirs.movement.edge && !(mine.movement.out === theirs.movement.out && mine.movement.outDirection === theirs.movement.outDirection)
        && !this.junctions.conflict(mine.movement, theirs.movement);
    }
    const control = approachControl(this.nav, other.edge, other.direction);
    return Boolean(control?.kind && ((car.claim?.nodes ?? NONE).includes(control.node) || (car.leaving?.nodes ?? NONE).includes(control.node)) && other.speed < 1 && other.edge.length - other.along > control.stopDistance - 1);
  }
  // Which lane a driver wants, a few times a second. Round something left
  // standing in its way, once it has waited behind it a moment, and back once
  // past it. On a boulevard: over to the kerb lane in good time for a turn
  // (waiting at the merge point to be let in if it must); otherwise whichever
  // lane is going faster, keeping right when neither is, but never near the
  // line. It moves only into a gap it can take.
  think(car, player) {
    if (car.laneOn !== car.edge) this.settle(car, car.lane);
    const profile = car.edge.profile, lanes = lanesOf(profile), to = car.laneTo, speed = car.speed;
    car.merging = false;
    if (car.around) {
      const { obstacle, home } = car.around;
      const passed = !this.stuck(obstacle, player) || this.discs(obstacle, car).every(([dl]) => dl < -car.spec.length / 2 - 1.5);
      if (passed && to !== home && this.clearFor(car, home, player)) { this.steerFor(car, home); car.around.back = true; }
      if (to === home && car.lane === home) car.around = null;
      return;
    }
    const blocker = car.blocker;
    if (car.stood > (blocker === player || this.playerCars.includes(blocker) ? AROUND_WAIT_PLAYER : AROUND_WAIT)) {
      const lane = this.aroundPlan(car, blocker, player);
      if (lane !== null) {
        const home = lanes.length > 1 && Math.abs(to - lanes[1]) < Math.abs(to - lanes[0]) ? lanes[1] : lanes[0];
        car.around = { obstacle: blocker, home }; this.steerFor(car, lane); car.stood = 0;
        return;
      }
    }
    if (lanes.length < 2) return;
    const left = this.lineAt(car) - car.along;
    if (!this.carriesOn(car) && left < 40 + car.cruiseSpeed * 4.5) {
      if (to === lanes[0]) return;
      if (this.clearFor(car, lanes[0], player, { merging: true })) { this.steerFor(car, lanes[0]); car.mergeWait = 0; return; }
      car.merging = true;
      // (easing off to drop in behind the car level with it or just ahead,
      // but no slower than about half its speed: the one behind lets it in)
      car.dropBack = false;
      this.others(car, player, other => {
        const [dl, dt, along] = this.relative(car, other, player);
        if (Math.abs(dt - (lanes[0] - car.lane)) < 2 && dl > -6 && dl < 8 && along > 1 && speed > along * .5) car.dropBack = true;
      });
      // Nobody lets it in: it goes straight on instead, if it can
      car.mergeWait = speed < 1 ? (car.mergeWait ?? 0) + THINK : 0;
      if (car.mergeWait > MISS) {
        const next = wayOn(this.nav, car.edge, car.direction, options => options[0], option => option.edge.kind !== 'path');
        if (next && !next.via && next.edge !== car.edge && Math.abs(next.turn) < .35 && next.edge.profile.divider) {
          car.next = next; car.turn = turnPath(this.nav, car.edge, car.direction, next); car.after = null; car.merging = false; car.mergeWait = 0;
        }
      }
      return;
    }
    // (and never once it has the junction, or near enough to be asking for it)
    if (left < 25 || car.claim || (car.laneTime ?? SETTLE) < SETTLE || to !== car.lane) return;
    // How fast each lane is going: as fast as the slowest car a little way
    // ahead in it, allowing for those further off; the driver's own lane and
    // (for most drivers) the kerb lane are worth a little more
    const keep = this.random(car, 41) < .75 ? 1.2 : 0;
    let best = to, bestScore = -Infinity;
    for (const lane of lanes) {
      let pace = car.cruiseSpeed;
      this.others(car, player, other => {
        const [dl, dt, along] = this.relative(car, other, player);
        if (dl <= 0 || dl > 60 || Math.abs(dt - (lane - car.lane)) > (car.spec.width + (other.spec?.width ?? 2)) / 2) return;
        pace = Math.min(pace, Math.max(0, along) + Math.max(0, dl - 15) * .08);
      });
      const score = pace + (lane === lanes[0] ? keep : 0) + (lane === to ? .6 : 0);
      if (score > bestScore) { best = lane; bestScore = score; }
    }
    if (best !== to && this.clearFor(car, best, player)) this.steerFor(car, best);
  }
  // Everything on the road but this car: the traffic, parked cars knocked
  // loose, the car the player left and the player
  others(car, player, visit) {
    for (const other of this.vehicles) if (other !== car && other.edge) visit(other);
    for (const other of this.woken) if (other.parked) visit(other);
    for (const other of this.playerCars) visit(other);
    if (!player.airborne && Number.isFinite(player.heading)) visit(player);
  }
  // Where another is from this car, along its lane and across (to the right),
  // and how fast it is going along the lane
  relative(car, other, player) {
    const h = car.laneHeading ?? car.heading, fx = Math.sin(h), fy = Math.cos(h), du = other.u - car.u, ds = other.s - car.s;
    let vu, vs;
    if (other === player) { const v = player.speed ?? 0; vu = Math.sin(player.heading) * v; vs = Math.cos(player.heading) * v; }
    else if (other.loose) { vu = other.loose.vx; vs = -other.loose.vz; }
    else { const v = other.recover ? other.recover.speed : other.speed ?? 0; vu = Math.sin(other.heading) * v; vs = Math.cos(other.heading) * v; }
    return [du * fx + ds * fy, du * fy - ds * fx, vu * fx + vs * fy];
  }
  // Three points down another's length (as following sees it), along and across from this car
  discs(other, car) {
    const length = other.spec?.length ?? 4.4, reach = length / 2 * .62, hx = Math.sin(other.heading) * reach, hy = Math.cos(other.heading) * reach;
    const h = car.laneHeading ?? car.heading, fx = Math.sin(h), fy = Math.cos(h);
    return [[other.u, other.s], [other.u + hx, other.s + hy], [other.u - hx, other.s - hy]].map(([u, s]) => [(u - car.u) * fx + (s - car.s) * fy, (u - car.u) * fy - (s - car.s) * fx]);
  }
  // Whether a car can move over to `lane` now: nobody in the way there, ahead
  // within the gap it wants at its speed, behind closing on it, or coming the
  // other way within `reach` of it in the next `time` seconds. A car pulling
  // out round something (`obstacle`, left out) wants the whole of `reach`
  // clear of anything slower; one that must get over for its turn (`merging`)
  // takes a smaller gap behind.
  clearFor(car, lane, player, { merging = false, obstacle = null, reach = 0, time = 0 } = {}) {
    const shift = lane - car.lane, speed = car.speed;
    let clear = true;
    this.others(car, player, other => {
      if (!clear || other === obstacle) return;
      const [dl, dt, along] = this.relative(car, other, player);
      if (Math.abs(dl) > 120 || Math.abs(dt - shift) > (car.spec.width + (other.spec?.width ?? 2)) / 2 + .5) return;
      const room = Math.abs(dl) - (car.spec.length + (other.spec?.length ?? 4.4)) / 2;
      if (along < -1) clear = dl < -2 || room > reach + (speed - along) * time + 8;
      else if (dl >= 0) clear = room > Math.max(3 + Math.max(0, speed - along) * 1.2, along < AROUND_SPEED ? reach : 0);
      else clear = room > (merging ? 1.5 + Math.max(0, along - speed) * 1.2 : 4 + Math.max(0, along - speed) * 2.2);
    });
    return clear;
  }
  // The lane to drive round `obstacle` in: just clear of it on whichever side
  // is nearer, on the road (and never across a median), the pass ended well
  // short of the junction, and the way clear. Null if there is none.
  aroundPlan(car, obstacle, player) {
    const { sides, near, far } = this.passSides(car, obstacle);
    if (far < 0 || car.along + far + car.spec.length + 14 > this.lineAt(car)) return null;
    const reach = far + car.spec.length + 10, time = reach / AROUND_SPEED + 2;
    // (with room to steer out before reaching it)
    return sides.find(lane => runUp(lane - car.lane) < near - .5 && this.clearFor(car, lane, player, { obstacle, reach, time })) ?? null;
  }
  // The lanes just clear of `obstacle` either side, on the road and not
  // across a median, nearer first; and how far on its nearest and furthest
  // points are
  passSides(car, obstacle) {
    const profile = car.edge.profile, width = car.spec.width, discs = this.discs(obstacle, car);
    let lo = Infinity, hi = -Infinity, near = Infinity, far = -Infinity;
    for (const [dl, dt] of discs) { lo = Math.min(lo, dt + car.lane); hi = Math.max(hi, dt + car.lane); near = Math.min(near, dl); far = Math.max(far, dl); }
    const clear = (width + (obstacle.spec?.width ?? 2)) / 2 + .55;
    const kerb = (profile.parking || profile.halfWidth - .5) - width / 2 - .2, median = profile.divider ? profile.median + width / 2 + .4 : -profile.lane;
    const sides = [lo - clear, hi + clear].filter(lane => lane >= median && lane <= kerb).sort((a, b) => Math.abs(a - car.lane) - Math.abs(b - car.lane));
    return { sides, near, far };
  }
  // The most a car may go for its lane: slowly round something in the road,
  // and, waiting to get over for its turn, no further than the merge point,
  // easing off to fall in behind the car beside it
  laneLimit(car, dt) {
    let limit = Infinity;
    if (car.around && !car.around.back && Math.abs(this.aim(car) - car.lane) > .2) limit = AROUND_SPEED;
    else if (car.around) limit = 7;
    if (car.merging) limit = Math.min(limit, Math.sqrt(2 * 4 * Math.max(0, this.lineAt(car) - MERGE_BY - car.along - car.spec.length / 2)), car.dropBack ? Math.max(0, car.speed - 2 * dt) : Infinity);
    return limit;
  }
  // `chunks` are the world's, for cars knocked loose to run into (see slide).
  update(dt, player, chunks = null) {
    this.chunks = chunks;
    if (!this.enabled) return;
    this.lying = this.props?.lying() ?? [];
    if (Math.hypot(player.s - this.lastS, player.u - this.lastU) > 130) this.reset(this.route, player.s, 'city', player.u);
    const ds = player.s - this.lastS, du = player.u - this.lastU, moved = Math.hypot(ds, du);
    const speed = dt > 0 ? moved / dt : 0;
    this.travelS = speed > 2 ? ds / moved : 0; this.travelU = speed > 2 ? du / moved : 0;
    this.lookAhead = Math.min(180, speed > 2 ? speed * 3.5 : 0);
    this.lastS = player.s; this.lastU = player.u; this.time += dt;
    this.junctions.tick(this.time);
    // Whoever has waited longest at a stop line asks for the junction first
    // (sorted from the fleet's own order each step, into one array)
    const order = this.order ??= [];
    order.length = 0;
    for (const car of this.vehicles) order.push(car);
    order.sort(byWait);
    for (const car of order) {
      if (!car.edge && !this.spawn(car, player.s, player.u)) { car.targetSpeed = 0; continue; }
      const ds = car.s - player.s, du = car.u - player.u;
      const behind = ds * this.travelS + du * this.travelU < -RECYCLE_BEHIND;
      const beside = Math.abs(du * this.travelS - ds * this.travelU) > 260;
      if (Math.hypot(ds, du) > LOCAL_RADIUS || behind || beside) this.spawn(car, player.s, player.u);
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      // Choose the way on in good time, and arrive at the turn at its own speed
      if (!car.turn && car.edge.length - car.along < 70) this.choose(car);
      // (the plan beyond a short street is made first: the junctions ask for it)
      const after = this.afterSpeed(car);
      let target = Math.min(car.cruiseSpeed, this.junctions.limit(car, this.vehicles, player.airborne ? null : player, dt));
      if (car.turn) target = Math.min(target, approachSpeed(car.turn, car.turn.start - car.along));
      // and slow for the street's own bends before the turn
      if (!car.turn || car.along < car.turn.start) target = Math.min(target, bendSpeed(this.nav, car.edge, car.direction, car.along, car.lane));
      const follow = this.following(car, player);
      // Seconds held up by the player alone (or the car they left in the
      // road), not a light or the traffic: the driver sounds the horn (see
      // DriveAudio.horn)
      const theirs = this.blocker === player || this.playerCars.includes(this.blocker);
      car.held = theirs && car.speed < .5 && follow < Math.min(target, after) - .5 ? (car.held || 0) + dt : 0;
      // (and standing held up by something lying in the road, and then
      // edging on through it: see following)
      const lying = this.lying.includes(this.blocker);
      car.waited = !lying ? 0 : car.speed < .5 || car.waited > EDGE_AFTER ? (car.waited || 0) + dt : car.waited || 0;
      // and how long it has waited behind something left standing in the road
      car.blocker = this.blocker;
      car.stood = car.speed < 1 && follow < 1 && this.stuck(this.blocker, player) ? (car.stood ?? 0) + dt : 0;
      // Its lane, thought about a few times a second (not all on one frame)
      if (!car.loose && !car.recover) {
        car.laneTime = (car.laneTime ?? 0) + dt;
        car.think = (car.think ?? (car.index % 8) * THINK / 8) - dt;
        if (car.think <= 0) { car.think += THINK; this.think(car, player); }
      }
      target = Math.min(target, after, follow, this.laneLimit(car, dt));
      car.targetSpeed = target;
    }
    for (const car of this.vehicles) {
      if (!car.edge) continue;
      if (car.dazed > 0) car.dazed = Math.max(0, car.dazed - dt);
      if (car.loose) this.slide(car, dt, chunks);
      else if (car.recover) { this.rejoin(car, dt); if (chunks && car.recover) this.hitScenery(car, chunks); }
      else {
        // Braking is for the road ahead. A car shoved past its cruising speed
        // coasts back down to it, and a shaken driver lifts off and rolls to a
        // stop before driving on; both still brake hard for anything ahead.
        let target = car.targetSpeed, braking = 16;
        if (car.dazed > 0) { target = 0; if (car.targetSpeed >= car.cruiseSpeed) braking = 4; }
        else if (car.shoved && target >= car.cruiseSpeed) braking = 4;
        car.speed += clamp(target - car.speed, -braking * dt, 3 * dt);
        if (car.speed <= car.cruiseSpeed) car.shoved = false;
        car.along += car.speed * dt;
        this.steer(car, car.speed * dt);
        if (car.along >= (car.turn ? car.turn.start + car.turn.length : car.edge.length)) this.advance(car);
      }
      // Off its lane and well out of the player's sight, it is simply put
      // back, or turns up elsewhere if another car stands in its place there
      if ((car.loose || car.recover) && Math.hypot(car.s - player.s, car.u - player.u) > OUT_OF_SIGHT) {
        Object.assign(car, { loose: null, recover: null, stranded: 0, tries: 0, speed: 0 });
        this.settle(car, car.edge.profile.lane);
        this.pose(car);
        if (this.crowded(car)) this.spawn(car, player.s, player.u);
      }
      if (car.rock && !rock(car.rock, dt)) car.rock = null;
      if (car.bumped > 0) car.bumped = Math.max(0, car.bumped - dt);
      this.pose(car);
      this.collidePlayer(car, player);
    }
    for (const car of this.woken) {
      if (!car.parked) continue;
      if (Math.hypot(car.s - player.s, car.u - player.u) > PARKED_RETURN && !this.standsIn(car.parked, car)) { this.release(car); continue; }
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      this.slide(car, dt, chunks);
      if (car.rock && !rock(car.rock, dt)) car.rock = null;
      this.pose(car);
      this.collidePlayer(car, player);
    }
    for (const car of this.vehicles) if ((car.edge || car.parked) && (car.loose || car.recover || car.bumped > 0)) this.knockOn(car);
    for (const car of this.woken) if ((car.edge || car.parked) && (car.loose || car.recover || car.bumped > 0)) this.knockOn(car);
    this.warm();
  }
  // Turn paths, bend speeds and junction movements are worked out the first
  // time a driver needs them, then kept. A car joining a street nobody had
  // driven needed them all in one step: a turn path is about .2 ms on a
  // desktop, several times that on a phone. This works out what each car will
  // need at its next street ahead of time, a little each step (generators, a
  // candidate curve or a few metres of one at a time). Each is kept by what it
  // depends on alone, so doing it early changes nothing but when the time is
  // spent, and the clock only decides how much gets done in a step. Streets a
  // car may spawn on are not warmed: doing every street round the player made
  // six times the turn paths, and keeping them all made the collector slower.
  warm() {
    const until = performance.now() + WARM_SLICE;
    for (let n = 0; n < WARM_MOST; n++) {
      this.warming ??= this.warmNext();
      if (!this.warming) return;
      if (this.warming.next().done) this.warming = null;
      if (performance.now() >= until) return;
    }
  }
  // The next job for what a car will need at its next street, if any
  warmNext() {
    for (const car of this.vehicles) {
      const next = car.next;
      if (!car.edge || !next || !car.turn || next.edge === car.edge) continue;
      const job = this.warmBends(next.edge) ?? this.warmMovement(car.edge, car.direction, next, car.turn);
      if (job) return job;
      // (and the junction after, where limit claims both)
      const after = car.after;
      if (after?.edge === next.edge && after.direction === next.direction && after.next && after.turn && after.next.edge !== after.edge) {
        const later = this.warmMovement(next.edge, next.direction, after.next, after.turn);
        if (later) return later;
      }
      const turn = this.warmTurn(car, next);
      if (turn) return turn;
    }
    return null;
  }
  // An edge's bends in the lanes its traffic keeps to, once
  warmBends(edge) {
    if (this.warmBent.has(edge)) return null;
    this.warmBent.add(edge);
    return bendSpeedSteps(this.nav, edge, lanesOf(edge.profile));
  }
  // A driver's way through a controlled junction, as JunctionTraffic.limit asks for it, once per turn
  warmMovement(edge, direction, next, turn) {
    if (this.warmMoved.has(turn)) return null;
    this.warmMoved.add(turn);
    if (!this.warmable(edge, direction) || !approachControl(this.nav, edge, direction)?.kind) return null;
    const junctions = this.junctions;
    return (function* () { junctions.movement(edge, direction, next, turn); })();
  }
  // The turn plan asks for first when the car joins this street: its
  // preferred way on from the far end, of those wayOn offers. Only that one,
  // since every turn path worked out is kept for good.
  warmTurn(car, next) {
    if (this.warmPlanned.get(car) === next) return null;
    this.warmPlanned.set(car, next);
    const { edge, direction } = next;
    if (!this.warmable(edge, direction)) return null;
    const nav = this.nav, all = nav.choices(edge, direction), usable = all.filter(option => Math.abs(option.turn) < HAIRPIN && (option.edge.kind !== 'path' || edge.kind === 'path'));
    const options = usable.length ? usable : all, choice = options.length && this.preferred(car, edge, options);
    if (!choice || hasTurnPath(nav, edge, direction, choice)) return null;
    return turnPathSteps(nav, edge, direction, choice);
  }
  // Whether every turn path from this end is the same whoever asks first.
  // turnPath keys a curve by the street it joins, not the way there. Past a
  // link (a junction complex) a street can be asked for directly (the
  // traffic's pick does that) or across the link (the autodrive does), and
  // the first one asked is kept. Those ends are left alone.
  warmable(edge, direction) {
    const key = edge.id * 2 + (direction > 0 ? 1 : 0);
    let warmable = this.warmableEnds.get(key);
    if (warmable !== undefined) return warmable;
    const ways = new Map(), nav = this.nav, choices = nav.choices(edge, direction);
    warmable = true;
    const way = (next, via) => {
      const joins = next.edge.id * 2 + (next.direction > 0 ? 1 : 0);
      if (ways.has(joins) && ways.get(joins) !== via) warmable = false;
      ways.set(joins, via);
    };
    way({ edge, direction: -direction }, null);
    for (const choice of choices) way(choice, null);
    for (const choice of choices) {
      if (choice.edge === edge || !isLink(nav, choice.edge)) continue;
      for (const beyond of nav.choices(choice.edge, choice.direction)) {
        if (beyond.edge === edge || beyond.edge === choice.edge) continue;
        way(beyond, null); way(beyond, choice.edge);
      }
    }
    this.warmableEnds.set(key, warmable);
    return warmable;
  }
  render(alpha, origin = 0) {
    this.group.position.z = origin;
    for (const list of [this.vehicles, this.woken]) for (const car of list) {
      car.car.position.lerpVectors(car.previousPosition, car.position, clamp(alpha, 0, 1));
      car.car.quaternion.slerpQuaternions(car.previousQuaternion, car.quaternion, clamp(alpha, 0, 1));
    }
  }
  dispose() { this.group.removeFromParent(); this.models.dispose(); }
}
