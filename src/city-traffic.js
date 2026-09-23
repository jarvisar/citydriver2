import * as THREE from 'three';
import { randomAt, clamp } from './world/route.js';
import { navGraph } from './world/nav-graph.js';
import { createTrafficModels, TRAFFIC_MODELS, TRAFFIC_COLORS } from './traffic-models.js';
import { trafficContact } from './traffic.js';
import { collisionImpulse, contactPoint } from './impact.js';
const up = new THREE.Vector3(0, 1, 0);
const SPAWN_CLEARANCE = 150, RECYCLE_BEHIND = 190, LOCAL_RADIUS = 380;
// A junction is reserved for a few seconds by whichever car reaches it first;
// everyone else stops at the line until it is free.
const JUNCTION_BOX = 11, STOP_LINE = 9, RESERVATION_SECONDS = 4.5;

// A bounded fleet driving the generated streets: each car follows a nav
// graph edge in its lane, picks a way on at every junction, keeps its
// distance from the car ahead, yields at junctions and recycles beyond the
// local view.
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
    this.reservations = new Map();
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
    const edges = this.nav.edges, centreS = s + this.travelS * this.lookAhead, centreU = u + this.travelU * this.lookAhead;
    for (let attempt = 0; attempt < 60; attempt++) {
      const edge = edges[Math.floor(r(10 + attempt * 3) * edges.length)];
      if (!edge || edge.kind === 'path' || edge.length < 30) continue;
      const middle = edge.points[Math.floor(edge.points.length / 2)];
      if (Math.hypot(middle.y - centreS, middle.x - centreU) > LOCAL_RADIUS) continue;
      const direction = r(11 + attempt * 3) < .5 ? 1 : -1, along = 12 + r(12 + attempt * 3) * (edge.length - 24);
      const pose = this.nav.pose(edge, along, direction, edge.profile.lane);
      const ds = pose.s - s, du = pose.u - u, distance = Math.hypot(ds, du);
      if (distance < (initial ? 25 : SPAWN_CLEARANCE) || distance > LOCAL_RADIUS) continue;
      if (!initial && this.lookAhead && ds * this.travelS + du * this.travelU < 60) continue;
      if (this.vehicles.some(other => other !== car && Math.hypot(pose.s - other.s, pose.u - other.u) < 14)) continue;
      Object.assign(car, { edge, direction, along, lane: edge.profile.lane, next: null, waiting: 0 });
      car.cruiseSpeed = edge.profile.speed * (.75 + r(4) * .25); car.speed = car.cruiseSpeed;
      this.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      return true;
    }
    return false;
  }
  pose(car) {
    const pose = this.nav.pose(car.edge, car.along, car.direction, car.lane);
    car.s = pose.s; car.u = pose.u; car.heading = pose.heading;
    const p = this.route.position(car.s, car.u);
    car.position.set(p.x, p.y + .13, p.z);
    car.quaternion.setFromAxisAngle(up, -car.heading);
  }
  // Move on to the next edge at the end of this one
  advance(car) {
    const choices = this.nav.choices(car.edge, car.direction).filter(choice => choice.edge.kind !== 'path' || car.edge.kind === 'path');
    const options = choices.length ? choices : this.nav.choices(car.edge, car.direction);
    if (!options.length) { car.direction = -car.direction; car.along = 0; return; }
    const roll = this.random(car, 30 + Math.floor(car.along)), straight = options[0];
    const choice = Math.abs(straight.turn) < .5 && roll < .55 ? straight : options[Math.floor(roll * options.length)];
    car.along = Math.max(0, car.along - car.edge.length);
    car.edge = choice.edge; car.direction = choice.direction; car.lane = choice.edge.profile.lane; car.next = null;
  }
  // How fast a car may go into the junction ahead of it
  junctionSpeed(car, player, dt) {
    const remaining = car.edge.length - car.along, node = this.nav.endNode(car.edge, car.direction);
    if (node.edges.length < 3 || remaining > 45) { car.junction = null; return Infinity; }
    const key = node.id, reservation = this.reservations.get(key);
    if (reservation && reservation.until <= this.time) this.reservations.delete(key);
    const holder = this.reservations.get(key);
    if (holder?.car === car) return Infinity;
    const playerInside = Math.hypot(player.s - node.y, player.u - node.x) < JUNCTION_BOX + 2;
    const gap = remaining - STOP_LINE;
    if (!holder && !playerInside && gap < 2.5 && car.speed < 1) { this.reservations.set(key, { car, until: this.time + RESERVATION_SECONDS }); return Infinity; }
    if (!holder && !playerInside && gap < 14) { this.reservations.set(key, { car, until: this.time + RESERVATION_SECONDS }); return Infinity; }
    return Math.sqrt(14 * Math.max(0, gap));
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
      const ds = car.s - player.s, du = car.u - player.u;
      const behind = ds * this.travelS + du * this.travelU < -RECYCLE_BEHIND;
      const beside = Math.abs(du * this.travelS - ds * this.travelU) > 260;
      if (Math.hypot(ds, du) > LOCAL_RADIUS || behind || beside) this.spawn(car, player.s, player.u);
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      let target = Math.min(car.cruiseSpeed, this.junctionSpeed(car, player, dt));
      // Slow for the turn ahead
      const remaining = car.edge.length - car.along;
      if (remaining < 30) {
        car.next ??= this.nav.choices(car.edge, car.direction)[0] ?? null;
        if (car.next && Math.abs(car.next.turn) > .4) target = Math.min(target, Math.max(4, Math.sqrt(36 + 14 * Math.max(0, remaining - 6))));
      }
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
      car.speed += clamp(car.targetSpeed - car.speed, -16 * dt, 3 * dt);
      car.along += car.speed * dt;
      if (car.along >= car.edge.length) this.advance(car);
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
