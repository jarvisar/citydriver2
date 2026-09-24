import * as THREE from 'three';
import { randomAt, clamp } from './world/route.js';
import { navGraph } from './world/nav-graph.js';
import { createTrafficModels, TRAFFIC_MODELS, TRAFFIC_COLORS } from './traffic-models.js';
import { trafficContact } from './traffic.js';
import { collisionImpulse, contactPoint } from './impact.js';
import { junctionSpeed } from './city-junctions.js';
import { turnPath, approachSpeed, wayOn, bendSpeed } from './world/lane-paths.js';
const up = new THREE.Vector3(0, 1, 0);
const SPAWN_CLEARANCE = 150, RECYCLE_BEHIND = 190, LOCAL_RADIUS = 380;
// A junction is reserved for a few seconds by whichever car reaches it first;
// everyone else stops at the line until it is free.
const JUNCTION_BOX = 11, STOP_LINE = 9, RESERVATION_SECONDS = 4.5;

// A bounded fleet driving the generated streets: each car follows a nav
// graph edge in its lane, picks a way on before each junction and turns onto
// it along a curve (see world/lane-paths.js), keeps its distance from the car
// ahead, yields at junctions and recycles beyond the local view. A car's
// `along` runs on past the start of its turn, through the curve, until it
// joins the next edge.
export class CityTraffic {
  constructor(scene, route, s, journey = 'city', u = 0) {
    this.route = route; this.enabled = true; this.time = 0; this.nav = navGraph();
    this.group = new THREE.Group(); this.group.name = 'city-traffic'; scene.add(this.group);
    this.models = createTrafficModels();
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
    this.junctionReservations = new Map();
    for (const car of this.vehicles) this.spawn(car, s, u, true);
  }
  setEnabled(enabled, player) {
    this.enabled = enabled; this.group.visible = enabled;
    if (enabled) this.reset(this.route, player.s, 'city', player.u);
  }
  random(car, salt) { return randomAt(car.index + car.generation * 97, 8100 + salt); }
  spawn(car, s, u, initial = false) {
    car.generation++;
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
      Object.assign(car, { edge, direction, along, lane: edge.profile.lane, next: null, turn: null, after: null, waiting: 0, stopKey: null, stopWait: 0, stopReleased: false });
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
    car.s = pose.s; car.u = pose.u; car.heading = pose.heading;
    const p = this.route.position(car.s, car.u);
    car.position.set(p.x, p.y + .13, p.z);
    car.quaternion.setFromAxisAngle(up, -car.heading);
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
    car.stopKey = null; car.stopWait = 0; car.stopReleased = false; car.cruiseSpeed = car.edge.profile.speed * (car.pace ?? 1);
    // The next turn is known on joining a street, so there is all of it to slow down in
    this.choose(car);
  }
  // How fast a car may go into the junction ahead of it: the shared signal
  // cycle, a stop and give way, or straight through on a priority road. The
  // player counts as traffic in the box.
  junctionSpeed(car, player, dt) {
    const remaining = car.edge.length - car.along;
    if (remaining > 50) return Infinity;
    const node = this.nav.endNode(car.edge, car.direction);
    if (Math.hypot(player.s - node.y, player.u - node.x) < car.edge.profile.halfWidth + 8 && remaining > 8) return Math.sqrt(14 * Math.max(0, remaining - car.edge.profile.halfWidth - 6));
    return junctionSpeed(car, this, this.nav, car.edge, car.direction, car.along, car.speed, dt);
  }
  update(dt, player) {
    if (!this.enabled) return;
    if (Math.hypot(player.s - this.lastS, player.u - this.lastU) > 130) this.reset(this.route, player.s, 'city', player.u);
    const ds = player.s - this.lastS, du = player.u - this.lastU, moved = Math.hypot(ds, du);
    const speed = dt > 0 ? moved / dt : 0;
    this.travelS = speed > 2 ? ds / moved : 0; this.travelU = speed > 2 ? du / moved : 0;
    this.lookAhead = Math.min(180, speed > 2 ? speed * 3.5 : 0);
    this.lastS = player.s; this.lastU = player.u; this.time += dt;
    for (const car of this.vehicles) {
      if (!car.edge && !this.spawn(car, player.s, player.u)) { car.targetSpeed = 0; continue; }
      const ds = car.s - player.s, du = car.u - player.u;
      const behind = ds * this.travelS + du * this.travelU < -RECYCLE_BEHIND;
      const beside = Math.abs(du * this.travelS - ds * this.travelU) > 260;
      if (Math.hypot(ds, du) > LOCAL_RADIUS || behind || beside) this.spawn(car, player.s, player.u);
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      let target = Math.min(car.cruiseSpeed, this.junctionSpeed(car, player, dt));
      // Choose the way on in good time, and arrive at the turn at its own speed
      if (!car.turn && car.edge.length - car.along < 70) this.choose(car);
      if (car.turn) target = Math.min(target, approachSpeed(car.turn, car.turn.start - car.along));
      // and slow for the street's own bends before the turn
      if (!car.turn || car.along < car.turn.start) target = Math.min(target, bendSpeed(this.nav, car.edge, car.direction, car.along, car.lane));
      target = Math.min(target, this.afterSpeed(car));
      // Basic following: brake for whatever is ahead in this lane, the player included
      const cos = Math.cos(car.heading), sin = Math.sin(car.heading);
      for (let i = 0; i <= this.vehicles.length; i++) {
        const other = i === this.vehicles.length ? player : this.vehicles[i];
        if (other === car) continue;
        const ds = other.s - car.s, du = other.u - car.u;
        const ahead = ds * cos + du * sin, beside = Math.abs(du * cos - ds * sin);
        if (ahead > 0 && ahead < 70 && beside < 2.9) target = Math.min(target, Math.sqrt(2 * 8 * Math.max(0, ahead - 9)));
      }
      car.targetSpeed = target;
    }
    for (const car of this.vehicles) {
      if (!car.edge) continue;
      car.speed += clamp(car.targetSpeed - car.speed, -16 * dt, 3 * dt);
      car.along += car.speed * dt;
      if (car.along >= (car.turn ? car.turn.start + car.turn.length : car.edge.length)) this.advance(car);
      this.pose(car);
      const p = player.groundedPosition;
      if (Math.abs(car.position.x - p.x) > 7 || Math.abs(car.position.z - p.z) > 7) continue;
      const v = player.velocity;
      const a = { x: p.x, z: p.z, heading: player.heading, halfWidth: player.spec.width / 2, halfLength: player.spec.length / 2, mass: player.spec.mass, vx: v.x, vz: v.z };
      const b = { x: car.position.x, z: car.position.z, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2, mass: car.spec.mass, vx: Math.sin(car.heading) * car.speed, vz: -Math.cos(car.heading) * car.speed };
      const contact = trafficContact(a, b);
      if (contact) {
        const blow = collisionImpulse(a, b, contact, contactPoint(a, b));
        player.resolveTrafficCollision(contact.x * (contact.depth + .025), contact.z * (contact.depth + .025), blow?.a.x ?? 0, blow?.a.z ?? 0, blow?.a.spin ?? 0);
        car.speed = Math.max(0, car.speed + (blow?.b.x ?? 0) * Math.sin(car.heading) - (blow?.b.z ?? 0) * Math.cos(car.heading));
      }
    }
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
