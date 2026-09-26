import * as THREE from 'three';
import { randomAt, clamp } from './world/route.js';
import { navGraph } from './world/nav-graph.js';
import { createTrafficModels, TRAFFIC_MODELS, TRAFFIC_COLORS } from './traffic-models.js';
import { trafficContact } from './traffic.js';
import { collisionImpulse, contactPoint, footprintMass, rock, rockFrom } from './impact.js';
import { JunctionTraffic, approachControl } from './city-junctions.js';
import { turnPath, approachSpeed, wayOn, bendSpeed } from './world/lane-paths.js';
const up = new THREE.Vector3(0, 1, 0), tilt = new THREE.Euler(0, 0, 0, 'YXZ');
const SPAWN_CLEARANCE = 150, RECYCLE_BEHIND = 190, LOCAL_RADIUS = 380;
// Following: braking for what is in the way, and the room left behind it
const FOLLOW_DECEL = 5, FOLLOW_GAP = 2.2;
// A struck car is shoved off its line, turned and rocked, and never further
// than this: metres across its lane (less where the kerb or the parked cars
// are nearer), metres along it, and radians of turn.
const SHOVE_ACROSS = 1.6, SHOVE_ALONG = 2.5, TWIST = .6;
// A shaken driver lifts off and rolls to a stop before driving on, for this
// many seconds per m/s the blow changed the car's speed, and at most MOST.
const DAZE = .1, DAZE_MOST = 1.6;
// How far a struck car stands off its line and is turned, how fast either is
// changing, and the swing of its body (see rock in impact.js)
const jolted = car => car.jolt ??= { along: 0, across: 0, alongRate: 0, acrossRate: 0, yaw: 0, spin: 0, pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 };

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
    this.reset(route, s, journey, u);
  }
  reset(route, s, journey = 'city', u = 0) {
    this.route = route; this.journey = journey; this.time = 0; this.lastS = s; this.lastU = u;
    this.travelS = 0; this.travelU = 0; this.lookAhead = 0;
    this.junctions.reset();
    for (const car of this.vehicles) { car.claim = car.leaving = car.pending = null; this.spawn(car, s, u, true); }
  }
  setEnabled(enabled, player) {
    this.enabled = enabled; this.group.visible = enabled;
    if (enabled) this.reset(this.route, player.s, 'city', player.u);
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
      Object.assign(car, { edge, direction, along, lane: edge.profile.lane, next: null, turn: null, after: null, stopWait: 0, jolt: null, dazed: 0, shoved: false });
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
    const pose = car.turn && car.along > car.turn.start ? car.turn.pose(car.along - car.turn.start) : this.nav.pose(car.edge, car.along, car.direction, car.lane);
    car.s = pose.s; car.u = pose.u; car.heading = car.laneHeading = pose.heading;
    // Off its line and turned, where a blow has put it
    const jolt = car.jolt;
    if (jolt) {
      const fx = Math.sin(pose.heading), fy = Math.cos(pose.heading);
      car.u += fx * jolt.along + fy * jolt.across; car.s += fy * jolt.along - fx * jolt.across; car.heading += jolt.yaw;
    }
    const p = this.route.position(car.s, car.u);
    car.position.set(p.x, p.y, p.z);
    if (jolt) car.quaternion.setFromEuler(tilt.set(jolt.pitch, -car.heading, jolt.roll));
    else car.quaternion.setFromAxisAngle(up, -car.heading);
  }
  // How a car moves as a body, for a blow to read: along its lane at its own
  // speed, and however a knock has it sliding and turning
  motion(car) {
    const h = car.laneHeading, jolt = car.jolt, along = car.speed + (jolt?.alongRate ?? 0), across = jolt?.acrossRate ?? 0;
    return { x: car.position.x, z: car.position.z, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2, mass: car.spec.mass ?? footprintMass(car.spec.width, car.spec.length),
      vx: Math.sin(h) * along + Math.cos(h) * across, vz: -Math.cos(h) * along + Math.sin(h) * across, spin: jolt?.spin ?? 0 };
  }
  // A blow to a car (see impact.js). The part along its lane is speed, though
  // never through rest; what is left, and the part across it, slide it off
  // its line, and the turn twists it. Its body rocks, and its driver is shaken.
  strike(car, dvx, dvz, spin) {
    const h = car.laneHeading, along = dvx * Math.sin(h) - dvz * Math.cos(h), across = dvx * Math.cos(h) + dvz * Math.sin(h);
    const jolt = jolted(car), speed = car.speed + along;
    car.speed = Math.max(0, speed); car.shoved ||= car.speed > car.cruiseSpeed;
    jolt.alongRate += Math.min(0, speed); jolt.acrossRate += across; jolt.spin = clamp(jolt.spin + spin, -3, 3);
    rockFrom(jolt, along, across);
    const blow = Math.hypot(dvx, dvz);
    if (blow > 2) car.dazed = Math.max(car.dazed, Math.min(DAZE_MOST, blow * DAZE));
  }
  // Moved a little off its line, as when parted from a car it overlaps
  shove(car, dx, dz) {
    const h = car.laneHeading, jolt = jolted(car);
    jolt.along += dx * Math.sin(h) - dz * Math.cos(h); jolt.across += dx * Math.cos(h) + dz * Math.sin(h);
    this.hold(car);
    this.pose(car);
  }
  // Within the room its street has: out to the kerb or the parked cars, in to
  // the centre line or the median, and a little way along its lane
  hold(car) {
    const jolt = car.jolt, profile = car.edge.profile, half = car.spec.width / 2;
    const out = clamp((profile.parking || profile.halfWidth) - car.lane - half - .2, .3, SHOVE_ACROSS);
    const inside = clamp(car.lane - (profile.median || 0) - half + .3, .3, SHOVE_ACROSS);
    if (jolt.across > out || jolt.across < -inside) { jolt.across = clamp(jolt.across, -inside, out); jolt.acrossRate = 0; }
    if (Math.abs(jolt.along) > SHOVE_ALONG) { jolt.along = clamp(jolt.along, -SHOVE_ALONG, SHOVE_ALONG); jolt.alongRate = 0; }
  }
  // A struck car's driver steers it back to its line, and its body settles:
  // damped springs, which a car nothing has hit never runs. The slide is
  // scrubbed off within a few tenths of a second, the way back takes longer.
  settle(car, dt) {
    const jolt = car.jolt;
    jolt.acrossRate -= (6 * jolt.across + 7 * jolt.acrossRate) * dt; jolt.across += jolt.acrossRate * dt;
    jolt.alongRate -= (6 * jolt.along + 7 * jolt.alongRate) * dt; jolt.along += jolt.alongRate * dt;
    this.hold(car);
    jolt.spin -= (25 * jolt.yaw + 6 * jolt.spin) * dt;
    jolt.yaw = clamp(jolt.yaw + jolt.spin * dt, -TWIST, TWIST);
    const rocking = rock(jolt, dt);
    if (!rocking && Math.abs(jolt.across) + Math.abs(jolt.along) < .005 && Math.abs(jolt.acrossRate) + Math.abs(jolt.alongRate) < .01 && Math.abs(jolt.yaw) < .002 && Math.abs(jolt.spin) < .01) car.jolt = null;
  }
  // A car knocked off its line can be knocked into another, which takes its
  // share of the blow in turn; the two are parted by weight
  knockOn(car) {
    for (const other of this.vehicles) {
      if (other === car || !other.edge || Math.abs(other.position.x - car.position.x) > 7 || Math.abs(other.position.z - car.position.z) > 7) continue;
      const a = this.motion(car), b = this.motion(other), contact = trafficContact(a, b);
      if (!contact) continue;
      const share = b.mass / (a.mass + b.mass), depth = contact.depth + .005;
      this.shove(car, contact.x * depth * share, contact.z * depth * share);
      this.shove(other, -contact.x * depth * (1 - share), -contact.z * depth * (1 - share));
      const blow = collisionImpulse(a, b, contact, contactPoint(a, b, contact));
      if (blow) { this.strike(car, blow.a.x, blow.a.z, blow.a.spin); this.strike(other, blow.b.x, blow.b.z, blow.b.spin); }
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
    for (let i = 0; i <= this.vehicles.length; i++) {
      const other = i === this.vehicles.length ? player : this.vehicles[i];
      if (other === car || (other !== player && !other.edge) || !Number.isFinite(other.heading)) continue;
      if (Math.abs(other.s - car.s) > reach + 6 || Math.abs(other.u - car.u) > reach + 6) continue;
      crossing ??= new Set([...(car.claim?.nodes ?? []), ...(car.leaving?.nodes ?? [])]);
      if (other !== player && crossing.size && this.passes(car, other, crossing)) continue;
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
  update(dt, player) {
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
      // Braking is for the road ahead. A car shoved past its cruising speed
      // coasts back down to it, and a shaken driver lifts off and rolls to a
      // stop before driving on; both still brake hard for anything ahead.
      let target = car.targetSpeed, braking = 16;
      if (car.dazed > 0) {
        car.dazed = Math.max(0, car.dazed - dt); target = 0;
        if (car.targetSpeed >= car.cruiseSpeed) braking = 4;
      } else if (car.shoved && target >= car.cruiseSpeed) braking = 4;
      car.speed += clamp(target - car.speed, -braking * dt, 3 * dt);
      if (car.speed <= car.cruiseSpeed) car.shoved = false;
      car.along += car.speed * dt;
      if (car.along >= (car.turn ? car.turn.start + car.turn.length : car.edge.length)) this.advance(car);
      if (car.jolt) this.settle(car, dt);
      this.pose(car);
      const p = player.groundedPosition;
      if (Math.abs(car.position.x - p.x) > 7 || Math.abs(car.position.z - p.z) > 7) continue;
      const a = player.motion(), b = this.motion(car), contact = trafficContact(a, b);
      if (!contact) continue;
      // The player is moved clear, and the two share the blow by weight
      const blow = collisionImpulse(a, b, contact, contactPoint(a, b, contact));
      player.resolveTrafficCollision(contact.x * (contact.depth + .005), contact.z * (contact.depth + .005), blow?.a.x ?? 0, blow?.a.z ?? 0, blow?.a.spin ?? 0, blow?.closing ?? 0, blow?.slide ?? 0);
      if (blow) this.strike(car, blow.b.x, blow.b.z, blow.b.spin);
    }
    for (const car of this.vehicles) if (car.jolt && car.edge) this.knockOn(car);
  }
  render(alpha, origin = 0) {
    this.group.position.z = origin;
    for (const car of this.vehicles) {
      car.car.position.lerpVectors(car.previousPosition, car.position, clamp(alpha, 0, 1));
      car.car.quaternion.slerpQuaternions(car.previousQuaternion, car.quaternion, clamp(alpha, 0, 1));
    }
  }
  dispose() { this.group.removeFromParent(); this.models.dispose(); }
}
