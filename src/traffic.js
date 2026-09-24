import * as THREE from 'three';
import { clamp, randomAt } from './world/route.js';
import { createTrafficModels, TRAFFIC_COLORS, TRAFFIC_MODELS } from './traffic-models.js';
import { collisionImpulse, contactPoint } from './impact.js';

export const TRAFFIC_CRUISE_SPEED = 16;
const LANE = 2.4;
// A struck car is never knocked further from its lane than this, which keeps
// it on the tarmac and on its own side of the centre line.
const REACH = 1.2;
// How quickly locked tyres take the speed off a car driven backwards.
const RECOIL_GRIP = 8;
const BEHIND = 380, AHEAD = 620;
const DENSITY = { coast: 1, snow: .75, desert: .5, jungle: .6, plains: .5, city: 1 };
// The city runs half as many cars again over the same stretch of road.
const FLEET = { city: 9 };
const LIGHTS = { snow: 1, city: .35 };

// Four separating axes give a forgiving rectangular footprint even when the
// player is sideways. All collision coordinates are independent of render origin.
export function trafficContact(a, b) {
  const axes = car => [{ x: Math.cos(car.heading), z: Math.sin(car.heading) }, { x: Math.sin(car.heading), z: -Math.cos(car.heading) }];
  const aa = axes(a), ba = axes(b), dx = a.x - b.x, dz = a.z - b.z;
  const dot = (u, v) => u.x * v.x + u.z * v.z;
  const radius = (car, basis, axis) => car.halfWidth * Math.abs(dot(basis[0], axis)) + car.halfLength * Math.abs(dot(basis[1], axis));
  let contact = null;
  for (const axis of [...aa, ...ba]) {
    const distance = dx * axis.x + dz * axis.z;
    const depth = radius(a, aa, axis) + radius(b, ba, axis) - Math.abs(distance);
    if (depth <= 0) return null;
    if (!contact || depth < contact.depth) {
      const sign = distance < 0 ? -1 : 1;
      contact = { x: axis.x * sign, z: axis.z * sign, depth };
    }
  }
  return contact;
}

export class Traffic {
  constructor(scene, route, s, journey = 'coast') {
    this.enabled = true;
    this.group = new THREE.Group(); this.group.name = 'traffic'; scene.add(this.group);
    this.models = createTrafficModels();
    this.poseRotation = new THREE.Euler(0, 0, 0, 'YXZ');
    // A small shared pool illuminates nearby traffic without shadow-map passes.
    this.headlightRigs = Array.from({ length: 3 }, () => {
      const rig = new THREE.Group();
      const light = new THREE.SpotLight('#ffe0a6', 170, 24, .64, .8, 1.5);
      light.castShadow = false;
      rig.add(light, light.target);
      return { rig, light };
    });
    // Three cars in each direction over a kilometer: usually one or two in
    // view. The pool holds a few more for the routes that run heavier traffic.
    this.pool = Array.from({ length: 9 }, (_, index) => {
      const model = this.models.create(index % TRAFFIC_MODELS.length, TRAFFIC_COLORS[0]);
      this.group.add(model.car);
      return { ...model, index, direction: index % 2 ? -1 : 1, position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion() };
    });
    this.vehicles = this.pool.slice(0, 6);
    this.nearest = [];
    this.reset(route, s, journey);
  }
  random(car, salt) { return randomAt(car.index + car.generation * 31, salt + this.salt); }
  setEnabled(enabled, player) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.group.visible = enabled;
    if (enabled) {
      this.reset(this.route, player.s);
      this.clearNear(player);
    }
  }
  reset(route, s, journey = this.journey) {
    this.route = route; this.journey = journey; this.salt = { coast: 2100, desert: 2200, snow: 2300, jungle: 2400, plains: 2500, city: 2600 }[journey];
    this.spacing = 1 / (DENSITY[journey] ?? 1);
    const fleet = FLEET[journey] ?? 6;
    this.vehicles = this.pool.slice(0, fleet);
    for (const car of this.pool) car.car.visible = car.index < fleet;
    for (const { rig } of this.headlightRigs) {
      rig.removeFromParent();
      if (journey === 'snow') this.group.add(rig);
    }
    this.lastPlayerS = s; this.models.setLights(LIGHTS[journey] ?? 0);
    const span = 1080 / Math.ceil(fleet / 2);
    for (const car of this.vehicles) {
      car.generation = 0;
      car.s = s + (-280 + Math.floor(car.index / 2) * span + (car.direction < 0 ? 80 : 0) + this.random(car, 1) * 35) * this.spacing;
      this.respawn(car, car.s);
    }
  }
  respawn(car, s) {
    car.s = s; car.generation++;
    car.u = car.direction * LANE; car.drift = 0; car.yaw = 0; car.spin = 0; car.recoil = 0;
    car.cruiseSpeed = car.direction > 0 ? TRAFFIC_CRUISE_SPEED : 20; car.speed = car.cruiseSpeed;
    // A random colour, stepping past any another car already wears
    const worn = new Set(this.vehicles.filter(other => other !== car && other.generation).map(other => other.paint.color.getHex()));
    let pick = Math.floor(this.random(car, 2) * TRAFFIC_COLORS.length);
    for (let k = 0; k < TRAFFIC_COLORS.length && worn.has(new THREE.Color(TRAFFIC_COLORS[pick]).getHex()); k++) pick = (pick + 1) % TRAFFIC_COLORS.length;
    car.paint.color.set(TRAFFIC_COLORS[pick]);
    this.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
  }
  recycle(car, playerS) {
    // Pick a clear spot outside the camera, including when reversing or resetting.
    let bestS = playerS + (AHEAD - 30) * this.spacing, bestGap = -Infinity;
    for (const offset of [-360, -300, 460, 530, 600]) {
      const s = playerS + (offset + this.random(car, 3) * 12) * this.spacing;
      const gap = Math.min(...this.vehicles.filter(other => other !== car && other.direction === car.direction).map(other => Math.abs(other.s - s)));
      if (gap > bestGap) { bestGap = gap; bestS = s; }
    }
    this.respawn(car, bestS);
  }
  clearNear(player) {
    for (const car of this.vehicles) if (Math.abs(car.s - player.s) < 18) this.recycle(car, player.s);
  }
  pose(car) {
    const route = this.route, frame = route.frame(car.s), p = route.position(car.s, car.u);
    car.position.set(p.x, p.y + .13, p.z);
    car.heading = frame.angle + (car.direction < 0 ? Math.PI : 0) + car.yaw;
    const slope = (route.height(car.s + 1.5, car.u) - route.height(car.s - 1.5, car.u)) / (3 * frame.scale);
    const crossSlope = (route.height(car.s, car.u + .7) - route.height(car.s, car.u - .7)) / 1.4;
    car.quaternion.setFromEuler(this.poseRotation.set(Math.atan(slope * car.direction), -car.heading, Math.atan(crossSlope * car.direction)));
  }
  update(dt, player) {
    if (!this.enabled) return;
    if (Math.abs(player.s - this.lastPlayerS) > 120) this.reset(this.route, player.s);
    this.lastPlayerS = player.s;
    for (const car of this.vehicles) {
      if (car.s < player.s - BEHIND * this.spacing || car.s > player.s + AHEAD * this.spacing) this.recycle(car, player.s);
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      let target = car.cruiseSpeed;
      const scale = this.route.frame(car.s).scale;
      car.routeScale = scale;
      // Basic following/braking prevents the few cars from driving through a
      // stopped player or piling into one another. No passing or pathfinding.
      for (let i = 0; i <= this.vehicles.length; i++) {
        const other = i < this.vehicles.length ? this.vehicles[i] : player;
        if (other === car || Math.abs(other.u - car.u) > 2.2) continue;
        const ahead = (other.s - car.s) * car.direction * scale;
        if (ahead <= 0 || ahead > 70) continue;
        const gap = ahead - (car.spec.length + (other.spec?.length ?? 4)) / 2;
        target = Math.min(target, Math.sqrt(2 * 7 * Math.max(0, gap - 6)));
      }
      car.targetSpeed = target;
    }
    for (const car of this.vehicles) {
      // Braking is for the road ahead. A car shoved past its cruising speed eases back down to it.
      car.speed += clamp(car.targetSpeed - car.speed, -(car.targetSpeed < car.cruiseSpeed ? 14 : 2) * dt, 3 * dt);
      if (car.recoil) this.giveGround(car, dt);
      car.s += car.direction * (car.speed - car.recoil) * dt / car.routeScale;
      this.settle(car, dt);
      this.pose(car);
    }
    this.collide(player);
  }
  // A blow heavy enough to stop a car and more sends it back up the road, tyres
  // locked, which takes the speed off again within a few metres. It stops short
  // of the car behind it rather than being pushed through.
  giveGround(car, dt) {
    car.recoil *= Math.exp(-dt * RECOIL_GRIP);
    const blocked = this.vehicles.some(other => {
      const behind = (car.s - other.s) * car.direction * car.routeScale;
      return other !== car && Math.abs(other.u - car.u) < 2.2 && behind > 0 && behind < (car.spec.length + other.spec.length) / 2 + 1;
    });
    if (blocked || car.recoil < .05) car.recoil = 0;
  }
  // A struck car has been pushed across its lane and turned. Its driver
  // steers it back: two damped springs, which a car nothing has hit never runs.
  settle(car, dt) {
    const lane = car.direction * LANE;
    if (!car.drift && !car.spin && !car.yaw && car.u === lane) return;
    car.drift += (-9 * (car.u - lane) - 4.2 * car.drift) * dt;
    const offset = clamp(car.u - lane + car.drift * dt, -REACH, REACH);
    if (Math.abs(offset) === REACH) car.drift = 0;
    car.u = lane + offset;
    car.spin += (-25 * car.yaw - 6 * car.spin) * dt;
    car.yaw = clamp(car.yaw + car.spin * dt, -.6, .6);
    if (Math.abs(offset) < .005 && Math.abs(car.drift) < .01 && Math.abs(car.yaw) < .002 && Math.abs(car.spin) < .01) { car.u = lane; car.drift = car.yaw = car.spin = 0; }
  }
  collide(player) {
    if (!this.enabled) return;
    for (const car of this.vehicles) {
      if (Math.abs(car.s - player.s) > 9) continue;
      const p = player.groundedPosition, velocity = player.velocity;
      const a = { x: p.x, z: p.z, heading: player.heading, halfWidth: player.spec.width / 2, halfLength: player.spec.length / 2, vx: velocity.x, vz: velocity.z, mass: player.spec.mass };
      // Traffic runs along the road and drifts across it, whichever way a knock has turned it.
      const angle = this.route.frame(car.s).angle, alongX = Math.sin(angle) * car.direction, alongZ = -Math.cos(angle) * car.direction, acrossX = Math.cos(angle), acrossZ = Math.sin(angle);
      const b = { x: car.position.x, z: car.position.z, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2,
        vx: alongX * (car.speed - car.recoil) + acrossX * car.drift, vz: alongZ * (car.speed - car.recoil) + acrossZ * car.drift };
      const contact = trafficContact(a, b);
      if (!contact) continue;
      // The player is moved clear, and the two share the blow by weight. The
      // car on its rails takes its share as speed along the road, a drift
      // across it and a turn, the last two of which settle() steers out.
      // What would carry it through rest is recoil instead, so a heavy blow
      // drives it back and a light car leaning on it barely moves it.
      const blow = collisionImpulse(a, b, contact, contactPoint(a, b));
      player.resolveTrafficCollision(contact.x * (contact.depth + .025), contact.z * (contact.depth + .025), blow?.a.x, blow?.a.z, blow?.a.spin);
      if (!blow) continue;
      const along = car.speed - car.recoil + blow.b.x * alongX + blow.b.z * alongZ;
      car.speed = Math.max(0, along); car.recoil = Math.max(0, -along);
      car.drift += blow.b.x * acrossX + blow.b.z * acrossZ;
      car.spin = clamp(car.spin + blow.b.spin, -3, 3);
    }
  }
  render(alpha, origin = 0) {
    if (!this.enabled) return;
    this.group.position.z = origin;
    for (const car of this.vehicles) {
      car.car.position.lerpVectors(car.previousPosition, car.position, clamp(alpha, 0, 1));
      car.car.quaternion.slerpQuaternions(car.previousQuaternion, car.quaternion, clamp(alpha, 0, 1));
    }
    if (this.journey === 'snow') {
      // Reused, so ranking the fleet each frame allocates nothing.
      const nearest = this.nearest;
      for (let i = 0; i < this.vehicles.length; i++) nearest[i] = this.vehicles[i];
      nearest.sort((a, b) => Math.abs(a.s - this.lastPlayerS) - Math.abs(b.s - this.lastPlayerS));
      for (const [index, { rig, light }] of this.headlightRigs.entries()) {
        const car = nearest[index];
        rig.position.copy(car.car.position); rig.quaternion.copy(car.car.quaternion);
        light.position.set(0, 1.01, -car.spec.length / 2 - .05);
        light.target.position.set(0, -1, -car.spec.length / 2 - 10);
        // Fade in from 225 to 150 meters; every vehicle retains its glowing lamps.
        light.intensity = 170 * clamp((225 - Math.abs(car.s - this.lastPlayerS)) / 75, 0, 1);
      }
    }
  }
  dispose() {
    this.group.removeFromParent(); this.models.dispose();
    for (const { light } of this.headlightRigs) light.dispose();
  }
}
