import * as THREE from 'three';
import { carEntry } from './cars.js';
import { sceneryContacts } from './collision.js';
import { rock } from './impact.js';
import { PLAYER_LOOK, WALKER_SPEC } from './walker.js';

// Getting out of the car and into another, in free drive (the walking is
// the Walker's). The player keeps one garage car at a time: out of it, it
// stays where they left it, handbrake on, as a parked car knocked loose
// does (see CityTraffic.playerCars): the traffic brakes for it and can
// shove it, and both maps mark it, until they get back in or pick another
// car in the garage. Any car in the traffic can be borrowed too, as in The
// Simpsons: Hit & Run, where its driver lets the player take the wheel: when
// they get out, the driver drives on from there, back to the nearest lane
// the car faces (see CityTraffic.giveBack). The helicopter is not left.

// How near (m, from someone's side to a car's) a car can be got into
const REACH = 1.1;
// A car slower than this (m/s) is left at once; a faster one stops first
const HALT = .8;
// Where they step out, in order: by the driver's door (they drive on the
// right, so the left side), by the other, behind the car, in front of it.
// (across the car, and along it, in its half-lengths)
const DOORS = [[-1, .15], [1, .15], [0, -1], [0, 1]];
// The gap left between them and the car, and the highest step onto that spot (m)
const CLEAR = .15, STEP = .45;

export class OnFoot {
  constructor(vehicle, traffic, appearance = PLAYER_LOOK) {
    this.vehicle = vehicle; this.traffic = traffic; this.appearance = appearance;
    // The garage car, parked: a body as the traffic knows one, with what it
    // takes to drive it again (see DrivingController.stepOut)
    this.parked = null;
    // The traffic car they are driving, if it is one (see CityTraffic.take)
    this.borrowed = null;
    // Stopping, to get out as soon as the car is still
    this.leaving = false;
  }
  get walking() { return Boolean(this.vehicle.walker); }
  // What getting in or out would do now, for the HUD: { out } in a car
  // they can leave, { car, own, name } by one they can get into, or null
  offer() {
    if (this.vehicle.pilot) return null;
    if (!this.walking) return { out: true, stopping: this.leaving };
    if (!this.vehicle.walker.standing) return null;
    const near = this.nearest();
    return near && { ...near, name: carEntry(near.own ? near.car.kept.carId : near.car.spec.name).name };
  }
  // Out of the car (stopping first), or into the car within reach. Returns
  // anything worth saying.
  use() {
    const v = this.vehicle;
    if (v.pilot) return '';
    if (!this.walking) {
      if (Math.abs(v.speed) < HALT) return this.getOut();
      this.leaving = true;
      return '';
    }
    if (!v.walker.standing) return '';
    const near = this.nearest();
    if (!near) return 'Walk up to a car to get in';
    if (near.own) return this.getBackIn();
    return this.borrow(near.car);
  }
  // The controls, while stopping to get out: brakes on, nothing else
  control(state) {
    if (!this.leaving) return state;
    return { handbrake: 1 };
  }
  // A step: out of the car once it has stopped, and the parked car's own
  // physics (a skid, the scenery, the player against it). Returns anything
  // worth saying, as use does.
  update(dt, chunks = null) {
    const v = this.vehicle;
    let said = '';
    if (this.leaving && (this.walking || v.pilot)) this.leaving = false;
    if (this.leaving && Math.abs(v.speed) < HALT) said = this.getOut();
    const car = this.parked;
    if (!car) return said;
    car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
    this.traffic.slide(car, dt, chunks);
    if (car.rock && !rock(car.rock, dt)) car.rock = null;
    this.traffic.pose(car);
    this.traffic.collidePlayer(car, v);
    if (car.loose.vx || car.loose.vz || car.loose.spin) this.traffic.knockOn(car);
    return said;
  }
  render(alpha = 1, origin = 0) {
    const car = this.parked;
    if (!car) return;
    const t = Math.min(1, Math.max(0, alpha));
    car.car.position.lerpVectors(car.previousPosition, car.position, t); car.car.position.z += origin;
    car.car.quaternion.slerpQuaternions(car.previousQuaternion, car.quaternion, t);
  }
  // A garage colour (or null) for the garage car, if it is parked: true if it was
  paint(color) {
    const car = this.parked;
    if (!car) return false;
    car.kept.paint = color; car.kept.model.paintCar(color);
    return true;
  }
  // Back to one car, the one under the player: the parked car goes, and a
  // borrowed one back to the traffic, to turn up elsewhere (a run begins,
  // or the garage brings another car)
  clear() {
    this.leaving = false;
    if (this.borrowed) { this.traffic.giveBack(this.borrowed); this.borrowed = null; }
    const car = this.parked;
    if (!car) return;
    this.unpark(); car.car.removeFromParent(); car.kept.model.disposeModel();
  }
  // The cars that can come between them and the chase camera (see
  // sightLine): the traffic, parked cars knocked loose and their own car,
  // in records kept from frame to frame
  sightCars() {
    const sight = this.sight ??= { ground: 0, bodies: [], pool: [] }, traffic = this.traffic;
    sight.ground = this.vehicle.groundedPosition.y; sight.bodies.length = 0;
    const add = car => {
      const body = sight.pool[sight.bodies.length] ??= {};
      body.x = car.position.x; body.z = car.position.z; body.y = car.position.y; body.heading = car.heading;
      body.halfWidth = car.spec.width / 2; body.halfLength = car.spec.length / 2;
      sight.bodies.push(body);
    };
    if (traffic.enabled) {
      for (const car of traffic.vehicles) if (car.edge && car.car.visible) add(car);
      for (const car of traffic.woken) if (car.parked) add(car);
    }
    for (const car of traffic.playerCars) add(car);
    return sight;
  }
  // The car nearest them within reach: their own, or one of the traffic's
  nearest() {
    const p = this.vehicle.groundedPosition;
    let best = null, gap = REACH;
    const consider = (car, own) => {
      const dx = p.x - car.position.x, dz = p.z - car.position.z;
      if (Math.abs(dx) > 8 || Math.abs(dz) > 8 || Math.abs(p.y - car.position.y) > 1.5) return;
      const cos = Math.cos(car.heading), sin = Math.sin(car.heading);
      const across = Math.max(0, Math.abs(dx * cos + dz * sin) - car.spec.width / 2), along = Math.max(0, Math.abs(dx * sin - dz * cos) - car.spec.length / 2);
      const distance = Math.hypot(across, along) - WALKER_SPEC.radius;
      if (distance < gap) { gap = distance; best = { car, own }; }
    };
    if (this.parked) consider(this.parked, true);
    if (this.traffic.enabled) for (const car of this.traffic.vehicles) if (car.edge && car.car.visible) consider(car, false);
    return best;
  }
  // Out beside the car. Their own car stays parked; a borrowed one goes
  // back to its driver.
  getOut() {
    const v = this.vehicle, spot = this.door();
    this.leaving = false;
    if (!spot) return 'No room to get out here';
    const pose = { s: v.s, u: v.u, heading: v.heading }, spec = v.spec, kept = v.stepOut(this.appearance);
    if (this.borrowed) {
      kept.model.car.removeFromParent(); kept.model.disposeModel();
      this.traffic.giveBack(this.borrowed, pose); this.borrowed = null;
    } else this.park(kept, pose, spec);
    v.s = -spot.z; v.u = spot.x; v.walker.takeOver(); v.update(0, {});
    return '';
  }
  // Where to stand, getting out: the first of the DOORS with room for them
  door() {
    const v = this.vehicle, p = v.groundedPosition, r = WALKER_SPEC.radius, halfWidth = v.spec.width / 2, halfLength = v.spec.length / 2;
    const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    for (const [across, along] of DOORS) {
      const side = across * (halfWidth + r + CLEAR), ahead = across ? along * halfLength : along * (halfLength + r + CLEAR);
      const x = p.x + rx * side + fx * ahead, z = p.z + rz * side + fz * ahead;
      if (this.room(x, z, p.y)) return { x, z };
    }
    return null;
  }
  // Whether someone can stand at (x, z): on dry ground about as high as the
  // car, clear of the scenery and of every car
  room(x, z, y) {
    const route = this.vehicle.route, r = WALKER_SPEC.radius, s = -z, u = x;
    if (route.water?.(s, u) || Math.abs(route.height(s, u) - y) > STEP) return false;
    let blocked = false;
    const chunks = this.vehicle.scenery;
    if (chunks) sceneryContacts(() => ({ x, z, heading: 0, halfWidth: r, halfLength: r, radius: r }), chunks.values(), () => { blocked = true; });
    if (blocked) return false;
    const cars = [...(this.traffic.enabled ? this.traffic.vehicles : []), ...(this.parked ? [this.parked] : [])];
    return !cars.some(car => {
      const dx = x - car.position.x, dz = z - car.position.z, cos = Math.cos(car.heading), sin = Math.sin(car.heading);
      return Math.abs(dx * cos + dz * sin) < car.spec.width / 2 + r && Math.abs(dx * sin - dz * cos) < car.spec.length / 2 + r;
    });
  }
  // The garage car, left standing where it stopped: lights off, handbrake on
  park(kept, pose, spec) {
    const model = kept.model;
    model.body.rotation.set(0, 0, 0);
    for (const wheel of model.wheels) if (wheel.front) wheel.pivot.rotation.y = 0;
    for (const light of model.nightLights) light.material.emissiveIntensity = light.day;
    const car = this.parked = {
      kept, car: model.car, spec, s: pose.s, u: pose.u, heading: pose.heading, speed: 0, handbrake: true, generation: 0, index: -1,
      loose: { vx: 0, vz: 0, spin: 0 }, rock: null,
      position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion(),
    };
    this.traffic.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
    this.traffic.playerCars.push(car);
  }
  unpark() {
    const list = this.traffic.playerCars, at = list.indexOf(this.parked);
    if (at >= 0) list.splice(at, 1);
    this.parked = null;
  }
  // Into their own car, where it stands
  getBackIn() {
    const v = this.vehicle, car = this.parked;
    this.unpark();
    v.s = car.s; v.u = car.u; v.heading = car.heading; v.speed = 0;
    v.stepIn(car.kept);
    return '';
  }
  // Into a car from the traffic, moving as it was, in its own paint
  borrow(car) {
    const v = this.vehicle;
    if (!this.traffic.take(car)) return '';
    const motion = this.traffic.motion(car);
    v.s = car.s; v.u = car.u; v.heading = car.heading;
    v.speed = motion.vx * Math.sin(car.heading) - motion.vz * Math.cos(car.heading);
    v.setCar(car.spec.name, { paint: `#${car.paint.color.getHexString()}` });
    this.borrowed = car;
    return `${carEntry(car.spec.name).name} · borrowed`;
  }
}
