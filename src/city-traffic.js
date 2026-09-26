import * as THREE from 'three';
import { randomAt, clamp } from './world/route.js';
import { navGraph } from './world/nav-graph.js';
import { createTrafficModels, TRAFFIC_MODELS, TRAFFIC_COLORS } from './traffic-models.js';
import { trafficContact } from './traffic.js';
import { collisionImpulse, contactPoint, footprintMass, heft, rock, rockFrom, skid, LOOSE_GRIP, HANDBRAKE_GRIP, SCENERY_SURFACE } from './impact.js';
import { sceneryContacts } from './collision.js';
import { JunctionTraffic, approachControl } from './city-junctions.js';
import { turnPath, approachSpeed, wayOn, bendSpeed } from './world/lane-paths.js';
const up = new THREE.Vector3(0, 1, 0), tilt = new THREE.Euler(0, 0, 0, 'YXZ');
const SPAWN_CLEARANCE = 150, RECYCLE_BEHIND = 190, LOCAL_RADIUS = 380;
// Following: braking for what is in the way, and the room left behind it
const FOLLOW_DECEL = 5, FOLLOW_GAP = 2.2;
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
// Parked cars knocked loose at once, of each model, and how far off the
// player must be before one is put back in its bay
const PARKED_POOL = 2, PARKED_RETURN = 150;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// A bounded fleet driving the generated streets: each car follows a nav
// graph edge in its lane, picks a way on before each junction and turns onto
// it along a curve (see world/lane-paths.js), claims its way through each
// junction before crossing it (see city-junctions.js), brakes for whatever is
// on its path ahead, the player included, and recycles beyond the local view.
// A car's `along` runs on past the start of its turn, through the curve,
// until it joins the next edge.
export class CityTraffic {
  constructor(scene, route, s, journey = 'city', u = 0) {
    this.route = route; this.enabled = true; this.time = 0; this.nav = navGraph();
    this.group = new THREE.Group(); this.group.name = 'city-traffic'; scene.add(this.group);
    this.models = createTrafficModels();
    this.junctions = new JunctionTraffic(this.nav);
    this.vehicles = Array.from({ length: 24 }, (_, index) => {
      const model = this.models.create(index % TRAFFIC_MODELS.length, TRAFFIC_COLORS[index % TRAFFIC_COLORS.length]);
      this.group.add(model.car);
      return { ...model, index, generation: 0, position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion() };
    });
    // Stand-ins for parked cars knocked loose (see wake)
    this.woken = TRAFFIC_MODELS.flatMap((spec, model) => Array.from({ length: PARKED_POOL }, (_, k) => {
      const made = this.models.create(model, TRAFFIC_COLORS[0]);
      made.car.visible = false; this.group.add(made.car);
      return { ...made, index: 100 + model * PARKED_POOL + k, parked: null, loose: null, rock: null, s: 0, u: 0, heading: 0, position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion() };
    }));
    this.reset(route, s, journey, u);
  }
  reset(route, s, journey = 'city', u = 0) {
    this.route = route; this.journey = journey; this.time = 0; this.lastS = s; this.lastU = u;
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
    // Only the streets around the car are worth trying
    const edges = this.nav.edges.filter(edge => {
      if (edge.kind === 'path' || edge.length < 30) return false;
      const middle = edge.points[Math.floor(edge.points.length / 2)];
      return Math.hypot(middle.y - centreS, middle.x - centreU) <= LOCAL_RADIUS;
    });
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
      // Each driver keeps their own pace, a share of every street's speed
      car.pace = .75 + r(4) * .25; car.cruiseSpeed = edge.profile.speed * car.pace; car.speed = car.cruiseSpeed;
      // Knowing its way on from the start, a car is never placed past a turn it
      // has not chosen, nor going faster than it could take the turn ahead
      this.choose(car);
      // and never part-way round it
      if (car.along > car.turn.start - 2) car.along = Math.max(0, car.turn.start - 2);
      car.speed = Math.min(car.speed, approachSpeed(car.turn, car.turn.start - car.along), bendSpeed(this.nav, edge, direction, along, car.lane), this.afterSpeed(car));
      this.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      car.car.visible = true;
      return true;
    }
    // Nowhere free just now: a car with no street waits out of sight and tries again later
    if (!car.edge) car.car.visible = false;
    return false;
  }
  pose(car) {
    // On its rails, unless a blow has knocked it loose or it is steering back
    if (car.edge && !car.loose && !car.recover) {
      const pose = car.turn && car.along > car.turn.start ? car.turn.pose(car.along - car.turn.start) : this.nav.pose(car.edge, car.along, car.direction, car.lane);
      car.s = pose.s; car.u = pose.u; car.heading = car.laneHeading = pose.heading;
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
    return { x: car.position.x, z: car.position.z, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2,
      mass: heft(car.spec.mass ?? footprintMass(car.spec.width, car.spec.length)),
      vx: loose ? loose.vx : Math.sin(way) * speed, vz: loose ? loose.vz : -Math.cos(way) * speed, spin: loose?.spin ?? 0 };
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
  }
  // Moved a little, as when parted from a car it overlaps
  nudge(car, dx, dz) { car.u += dx; car.s -= dz; car.moved = true; this.pose(car); }
  // A loose car skidding to rest. The water's edge stops it; the scenery it
  // runs into takes a blow as the player's car does, and a parked car it runs
  // into is knocked loose in turn. At rest, its driver steers back to its lane.
  slide(car, dt, chunks) {
    const loose = car.loose;
    if (loose.vx || loose.vz || loose.spin) {
      skid(loose, car.heading, dt, car.parked ? HANDBRAKE_GRIP : LOOSE_GRIP);
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
      if (solid.parked && this.wake(solid)) return;
      const point = contact.point, blow = collisionImpulse(this.motion(car), { x: point.x, z: point.z, vx: 0, vz: 0, mass: Infinity }, contact, point, SCENERY_SURFACE);
      if (blow) this.strike(car, blow.a.x, blow.a.z, blow.a.spin);
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
    r.speed = Math.min(r.speed + 2.5 * dt, Math.min(7, car.cruiseSpeed));
    r.at += r.speed * dt;
    const { points, lengths } = r, total = lengths[lengths.length - 1];
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
  wake(collider) {
    const info = collider.parked;
    if (!this.enabled || !info.ready) return false;
    const car = this.woken.find(c => !c.parked && c.spec.name === info.model);
    if (!car) return false;
    // Where it stands, and which way along its length its nose points
    const [a, b, c] = collider.corners, long = Math.hypot(b.x - a.x, b.z - a.z) > Math.hypot(c.x - b.x, c.z - b.z) ? [a, b] : [b, c];
    let fu = long[1].x - long[0].x, fs = -(long[1].z - long[0].z);
    if (fu * info.nose.u + fs * info.nose.s < 0) { fu = -fu; fs = -fs; }
    Object.assign(car, { parked: collider, s: -collider.z, u: collider.x, heading: Math.atan2(fu, fs), loose: { vx: 0, vz: 0, spin: 0 }, rock: null, dazed: 0, moved: false });
    car.paint.color.set(info.colour); car.car.visible = true;
    collider.woken = true; info.hide(true);
    this.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
    return true;
  }
  // Put back in its bay, out of sight
  release(car) {
    if (!car.parked) return;
    car.parked.woken = false; car.parked.parked.hide(false);
    car.parked = null; car.loose = null; car.car.visible = false;
  }
  // The player against a car. They share the blow by weight and, once the car
  // is free to move, are parted by weight too: a heavy car shoves a light one
  collidePlayer(car, player) {
    const p = player.groundedPosition;
    if (Math.abs(car.position.x - p.x) > 7 || Math.abs(car.position.z - p.z) > 7) return;
    const a = player.motion(), b = this.motion(car), contact = trafficContact(a, b);
    if (!contact) return;
    const blow = collisionImpulse(a, b, contact, contactPoint(a, b, contact));
    if (blow) this.strike(car, blow.b.x, blow.b.z, blow.b.spin);
    const share = car.loose ? b.mass / (a.mass + b.mass) : 1, depth = contact.depth + .005;
    player.resolveTrafficCollision(contact.x * depth * share, contact.z * depth * share, blow?.a.x ?? 0, blow?.a.z ?? 0, blow?.a.spin ?? 0, blow?.closing ?? 0, blow?.slide ?? 0);
    if (share < 1) this.nudge(car, -contact.x * depth * (1 - share), -contact.z * depth * (1 - share));
  }
  // A loose car, or one just shoved along its lane, can be knocked into
  // another, which takes its share of the blow in turn; the two are parted
  // by weight, as far as each is free to move
  knockOn(car) {
    for (const list of [this.vehicles, this.woken]) for (const other of list) {
      if (other === car || !(other.edge || other.parked) || Math.abs(other.position.x - car.position.x) > 7 || Math.abs(other.position.z - car.position.z) > 7) continue;
      const a = this.motion(car), b = this.motion(other), contact = trafficContact(a, b);
      if (!contact) continue;
      const blow = collisionImpulse(a, b, contact, contactPoint(a, b, contact));
      if (blow) { this.strike(car, blow.a.x, blow.a.z, blow.a.spin); this.strike(other, blow.b.x, blow.b.z, blow.b.spin); }
      const wa = car.loose ? b.mass : 0, wb = other.loose ? a.mass : 0, depth = contact.depth + .005;
      if (!wa && !wb) continue;
      const share = wa / (wa + wb);
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
    const roll = this.random(car, 30 + edge.id);
    // The driver's choice, unless no car could make that turn and another way on is open
    const pick = options => {
      const preferred = Math.abs(options[0].turn) < .5 && roll < .55 ? options[0] : options[Math.floor(roll * options.length)];
      if (options.length < 2 || preferred.via || turnPath(this.nav, edge, direction, preferred).radius >= 3) return preferred;
      return options.find(option => !option.via && turnPath(this.nav, edge, direction, option).radius >= 3) ?? preferred;
    };
    const next = wayOn(this.nav, edge, direction, pick, option => option.edge.kind !== 'path' || edge.kind === 'path');
    return { edge, direction, next, turn: turnPath(this.nav, edge, direction, next) };
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
    car.edge = choice.edge; car.direction = choice.direction; car.lane = choice.edge.profile.lane; car.next = null; car.turn = null;
    car.stopWait = 0; car.cruiseSpeed = car.edge.profile.speed * (car.pace ?? 1);
    // The next turn is known on joining a street, so there is all of it to slow down in
    this.choose(car);
  }
  // Where a car will be `d` metres on from where it is: along its lane,
  // round its turn and into the street beyond (null past the end of that)
  ahead(car, d) {
    const x = car.along + d, turn = car.turn;
    if (turn && x > turn.start) {
      if (x <= turn.start + turn.length) return turn.pose(x - turn.start);
      const beyond = turn.end + x - turn.start - turn.length;
      return beyond > car.next.edge.length ? null : this.nav.pose(car.next.edge, beyond, car.next.direction, car.next.edge.profile.lane);
    }
    return x > car.edge.length ? null : this.nav.pose(car.edge, x, car.direction, car.lane);
  }
  // How fast a car may go for whatever stands on its path in the next few
  // seconds: a car ahead in its lane, one crossing in front of it, or the
  // player. Each other car is three discs down its length. A car waiting at
  // the line of a junction this one is crossing is not in its way, whatever
  // the corner makes it look like, and nor are two cars crossing a junction
  // on paths that do not meet.
  following(car, player) {
    const reach = Math.min(70, car.speed * car.speed / (2 * FOLLOW_DECEL) + 18);
    // (the path ahead is walked only once something is near enough to be on it)
    let path = null, crossing = null;
    let limit = Infinity;
    // (parked cars knocked loose into the road are in the way too)
    const count = this.vehicles.length, total = count + this.woken.length;
    for (let i = 0; i <= total; i++) {
      const other = i === total ? player : i < count ? this.vehicles[i] : this.woken[i - count];
      if (other === car || (other !== player && !other.edge && !other.parked) || !Number.isFinite(other.heading)) continue;
      if (Math.abs(other.s - car.s) > reach + 6 || Math.abs(other.u - car.u) > reach + 6) continue;
      crossing ??= new Set([...(car.claim?.nodes ?? []), ...(car.leaving?.nodes ?? [])]);
      if (other !== player && other.edge && crossing.size && this.passes(car, other, crossing)) continue;
      if (!path) {
        path = [];
        for (let d = 1.5; d <= reach; d += 1.5) { const p = this.ahead(car, d); if (!p) break; path.push(d, p.u, p.s); }
      }
      const length = other.spec?.length ?? 4.4, reachAlong = length / 2 * .62, clear = (car.spec.width + (other.spec?.width ?? 2)) / 2 + .2;
      const hx = Math.sin(other.heading) * reachAlong, hy = Math.cos(other.heading) * reachAlong;
      const discs = [other.u, other.s, other.u + hx, other.s + hy, other.u - hx, other.s - hy];
      // The player's car, crossing or coming the other way, also where it will be in the next second
      const speed = other === player ? player.speed ?? 0 : 0, dx = Math.sin(other.heading), dy = Math.cos(other.heading);
      if (Math.abs(speed) > 3 && Math.sign(speed) * (dx * Math.sin(car.heading) + dy * Math.cos(car.heading)) < .7) {
        for (const t of [.5, 1]) discs.push(other.u + dx * speed * t, other.s + dy * speed * t);
      }
      for (let k = 0; k < path.length; k += 3) {
        const px = path[k + 1], py = path[k + 2];
        let hit = false;
        for (let j = 0; j < discs.length && !hit; j += 2) hit = Math.hypot(px - discs[j], py - discs[j + 1]) < clear;
        if (hit) {
          limit = Math.min(limit, Math.sqrt(2 * FOLLOW_DECEL * Math.max(0, path[k] - car.spec.length / 2 - FOLLOW_GAP)));
          break;
        }
      }
    }
    return limit;
  }
  // Whether `other` can be left out of `car`'s way while `car` crosses the
  // junctions `crossing`: waiting at another line there, or crossing on a path
  // that does not meet this one. A car ahead in its own lane is always in its way.
  passes(car, other, crossing) {
    if (other.edge === car.edge && other.direction === car.direction) return false;
    // Crossing the same junction: compare the two ways through it
    for (const theirs of [other.claim, other.leaving]) {
      const mine = theirs && [car.claim, car.leaving].find(claim => claim?.nodes.some(node => theirs.nodes.includes(node)));
      if (!mine) continue;
      return mine.movement.edge !== theirs.movement.edge && !(mine.movement.out === theirs.movement.out && mine.movement.outDirection === theirs.movement.outDirection)
        && !this.junctions.conflict(mine.movement, theirs.movement);
    }
    const control = approachControl(this.nav, other.edge, other.direction);
    return Boolean(control?.kind && crossing.has(control.node) && other.speed < 1 && other.edge.length - other.along > control.stopDistance - 1);
  }
  // `chunks` are the world's, for cars knocked loose to run into (see slide).
  update(dt, player, chunks = null) {
    if (!this.enabled) return;
    if (Math.hypot(player.s - this.lastS, player.u - this.lastU) > 130) this.reset(this.route, player.s, 'city', player.u);
    const ds = player.s - this.lastS, du = player.u - this.lastU, moved = Math.hypot(ds, du);
    const speed = dt > 0 ? moved / dt : 0;
    this.travelS = speed > 2 ? ds / moved : 0; this.travelU = speed > 2 ? du / moved : 0;
    this.lookAhead = Math.min(180, speed > 2 ? speed * 3.5 : 0);
    this.lastS = player.s; this.lastU = player.u; this.time += dt;
    this.junctions.tick(this.time);
    // Whoever has waited longest at a stop line asks for the junction first
    const order = this.vehicles.slice().sort((a, b) => (b.stopWait ?? 0) - (a.stopWait ?? 0) || a.index - b.index);
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
      let target = Math.min(car.cruiseSpeed, this.junctions.limit(car, this.vehicles, player, dt));
      if (car.turn) target = Math.min(target, approachSpeed(car.turn, car.turn.start - car.along));
      // and slow for the street's own bends before the turn
      if (!car.turn || car.along < car.turn.start) target = Math.min(target, bendSpeed(this.nav, car.edge, car.direction, car.along, car.lane));
      target = Math.min(target, after, this.following(car, player));
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
        if (car.along >= (car.turn ? car.turn.start + car.turn.length : car.edge.length)) this.advance(car);
      }
      // Off its lane and well out of the player's sight, it is simply put back
      if ((car.loose || car.recover) && Math.hypot(car.s - player.s, car.u - player.u) > OUT_OF_SIGHT) Object.assign(car, { loose: null, recover: null, stranded: 0, tries: 0, speed: 0 });
      if (car.rock && !rock(car.rock, dt)) car.rock = null;
      if (car.bumped > 0) car.bumped = Math.max(0, car.bumped - dt);
      this.pose(car);
      this.collidePlayer(car, player);
    }
    for (const car of this.woken) {
      if (!car.parked) continue;
      if (Math.hypot(car.s - player.s, car.u - player.u) > PARKED_RETURN) { this.release(car); continue; }
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      this.slide(car, dt, chunks);
      if (car.rock && !rock(car.rock, dt)) car.rock = null;
      this.pose(car);
      this.collidePlayer(car, player);
    }
    for (const list of [this.vehicles, this.woken]) for (const car of list) if ((car.edge || car.parked) && (car.loose || car.recover || car.bumped > 0)) this.knockOn(car);
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
