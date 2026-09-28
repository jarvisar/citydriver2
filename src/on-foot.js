import * as THREE from 'three';
import { carEntry } from './cars.js';
import { collideScenery, roofAt, roofSurface, sceneryContacts } from './collision.js';
import { rock, rockFrom } from './impact.js';
import { DrivingController } from './vehicle.js';
import { TRAFFIC_MODELS, BUS_MODEL, BUS_DOORS } from './traffic-models.js';
import { PLAYER_LOOK, WALKER_SPEC } from './walker.js';
import { cityCell } from './world/city.js';

// Getting out of the car and into another, in free drive (the walking is
// the Walker's). The player keeps one garage car at a time: out of it, it
// stays where they left it, handbrake on, as a parked car knocked loose
// does (see CityTraffic.playerCars): the traffic brakes for it and can
// shove it, and both maps mark it, until they get back in or pick another
// car in the garage. Any car in the traffic can be borrowed too, as in The
// Simpsons: Hit & Run, where its driver lets the player take the wheel: when
// they get out, the driver drives on from there, back to the nearest lane
// the car faces (see CityTraffic.giveBack). So can a car parked along the
// kerb, while there is traffic: its bay stays empty, and where they get out
// it stands as though knocked loose to there, going back to its bay once
// they are well away (see CityTraffic.leaveParked).
//
// On foot, E or Y picks the car they face within ENTER as GTA does (a marker
// floats over it, see EnterMarker), they go to its door by themselves (a
// push on the stick takes over again) while a traffic car waits for them,
// and hop in. Out, they hop down from the seat, and the car rocks on its
// springs. Going fast, a second press while the car stops jumps out: they
// tumble, and the car rolls on without them.
//
// The helicopter and the plane are left the same way, only they land first
// (the press sets them down by themselves, and any flying control takes
// over again), and wherever they come down, a roof included, they stay.
// High enough, a second press jumps out with a parachute (see Walker's
// `chute`), and the machine lands itself with nobody aboard, flown by a
// controller of its own (`drone`) until it has stopped and its engine has
// died, when it is parked as a car is.

// How near (m, from someone's side to a car's) a car can be got into, and
// how far off one can be picked to go to (see target)
const REACH = 1.1, ENTER = 8;
// A car slower than this (m/s) is left at once. A faster one stops first,
// and while it stops, a second press faster than BAIL jumps out. Something
// flying lands first, and a second press more than LEAP m up jumps out.
// Left flying, it lands itself, unless it gets DRONE_FAR m from them first,
// or out of the streets built round them, where nothing is solid
// (skimming off out to sea), when the garage has it back.
const HALT = .8, BAIL = 6, LEAP = 3, DRONE_FAR = 700;
// Seconds to get to a car before they give up, and to hop into it
const APPROACH = 5, BOARD = .45;
// Where they step out, in order: by the driver's door (they drive on the
// right, so the left side), by the other, behind the car, in front of it.
// (across the car, and along it, in its half-lengths)
const DOORS = [[-1, .15], [1, .15], [0, -1], [0, 1]];
// How far ahead of its middle a car's driver gets in and out (m): a bus's
// driver sits by its front door, 5 m on, and a flying machine says where its door is
const doorAlong = spec => spec.name === BUS_MODEL.name ? BUS_DOORS.on : spec.door ?? spec.length / 2 * DOORS[0][1];
// The gap left between them and the car, and the highest step onto that spot (m)
const CLEAR = .15, STEP = .45;
// On foot they look at a car going by within PASSING, and at people within LOOK_NEAR (m)
const PASSING = 10, LOOK_NEAR = 9;
// A car's rock on its springs as someone climbs in or out (m/s across it)
const CLIMB = 1.4;
const STOPPING = { handbrake: 1 }, LANDING = { land: true }, STILL = { walk: { x: 0, z: 0 }, jump: false, sprint: false, face: true, aim: NaN };
// (whether the controls ask anything of something flying: any of it takes over from its landing)
const FLYING = ['forward', 'brake', 'left', 'right', 'climb', 'descend'];
const flown = state => FLYING.some(key => state[key]) || Boolean(state.touchStick || state.touchDrive?.amount);

// From someone's side at `p` to a car's (`shape`, see shapeOf), in metres
function gapTo(p, shape) {
  const dx = p.x - shape.x, dz = p.z - shape.z, cos = Math.cos(shape.heading), sin = Math.sin(shape.heading);
  const across = Math.max(0, Math.abs(dx * cos + dz * sin) - shape.halfWidth), along = Math.max(0, Math.abs(dx * sin - dz * cos) - shape.halfLength);
  return Math.hypot(across, along) - WALKER_SPEC.radius;
}

export class OnFoot {
  constructor(vehicle, traffic, appearance = PLAYER_LOOK) {
    this.vehicle = vehicle; this.traffic = traffic; this.appearance = appearance;
    // The garage car, parked: a body as the traffic knows one, with what it
    // takes to drive it again (see DrivingController.stepOut)
    this.parked = null;
    // The traffic car they are driving, if it is one (see CityTraffic.take),
    // or the bay of the parked car they are (see CityTraffic.takeParked)
    this.borrowed = null; this.bay = null;
    // Stopping, to get out as soon as the car is still
    this.leaving = false;
    // Going to a car to get in ({ target, since }), and hopping in ({ target, side })
    this.approach = null; this.boarding = null;
    // Where they look (see lookAround), filled each frame
    this.watching = { x: 0, z: 0 };
    // The world with its residents (CitydriverWorld), and the game's clock
    this.world = null; this.clock = 0;
  }
  get walking() { return Boolean(this.vehicle.walker); }
  // Whether a second press now jumps out: of a car going fast, or of
  // something flying, high enough for the parachute (or on its wheels in
  // the street going fast)
  get leaping() {
    const v = this.vehicle, pilot = v.pilot;
    if (!pilot) return Math.abs(v.speed) > BAIL;
    return pilot.landed ? Math.abs(v.speed) > BAIL && v.groundedPosition.y < v.route.height(v.s, v.u) + .3 : pilot.height > LEAP;
  }
  // What getting in or out would do now, for the HUD: { out, stopping, bail,
  // flying } in a car or a flying machine they can leave, { car | bay, own,
  // gap, name } by one they can get into, or null
  offer() {
    if (!this.walking) return { out: true, stopping: this.leaving, bail: this.leaving && this.leaping, flying: Boolean(this.vehicle.pilot) };
    if (!this.vehicle.walker.standing || this.boarding) return null;
    const target = this.approach?.target ?? this.target();
    return target && { ...target, name: carEntry(target.own ? target.car.kept.carId : target.bay ? target.bay.parked.model : target.car.spec.name).name };
  }
  // Out of the car (stopping first, or at speed jumping out), or on foot
  // into the car they would pick (going to it first). Returns anything
  // worth saying.
  use() {
    const v = this.vehicle, pilot = v.pilot;
    if (!this.walking) {
      if (Math.abs(v.speed) < HALT && (!pilot || pilot.landed)) return this.getOut();
      if (this.leaving && this.leaping) return pilot && !pilot.landed ? this.jump() : this.bail();
      if (this.leaving) return '';
      this.leaving = true;
      // (nothing flying sets down on the water)
      return pilot?.water && !pilot.landed ? 'Find somewhere to land' : '';
    }
    if (!v.walker.standing || this.boarding) return '';
    const target = this.target();
    if (!target) return 'Walk up to a car to get in';
    this.approach = null;
    if (this.reached(target, target.gap)) this.board(target);
    else this.approach = { target, since: v.walker.time };
    return '';
  }
  // The controls. While stopping to get out, the brakes and nothing else;
  // landing, the flying machine sets itself down, until the player flies it
  // again. Going to a car, the way to its door, until the player pushes the
  // stick or jumps. Hopping in, nothing.
  control(state) {
    if (this.leaving && this.vehicle.pilot) {
      if (!flown(state)) return LANDING;
      this.leaving = false;
      return state;
    }
    if (this.leaving) return STOPPING;
    if (!this.walking || (!this.approach && !this.boarding)) return state;
    if (this.boarding) return STILL;
    const walk = state.walk;
    if ((walk && Math.hypot(walk.x, walk.z) > .3) || state.jump) { this.approach = null; return state; }
    const door = this.doorOf(this.approach.target), p = this.vehicle.groundedPosition;
    if (!door) { this.approach = null; return state; }
    const going = this.going ??= { walk: { x: 0, z: 0 }, jump: false, sprint: false, face: true, aim: NaN };
    const dx = door.x - p.x, dz = door.z - p.z, d = Math.hypot(dx, dz), pace = d > 1e-6 ? Math.min(1, d / .8) / d : 0;
    going.walk.x = dx * pace; going.walk.z = dz * pace; going.sprint = d > 5;
    return going;
  }
  // A step: out of the car once it has stopped, going to a car and into it
  // once there (the traffic's waits for them), and the parked car's own
  // physics (a skid, the scenery, the player against it). Returns anything
  // worth saying, as use does.
  update(dt, chunks = null) {
    const v = this.vehicle;
    let said = '';
    if (this.leaving && this.walking) this.leaving = false;
    if (this.leaving && Math.abs(v.speed) < HALT && (!v.pilot || v.pilot.landed)) said = this.getOut();
    if (this.approach) {
      const { target, since } = this.approach, shape = v.walker?.standing ? this.shapeOf(target) : null;
      if (!shape || v.walker.time - since > APPROACH) this.approach = null;
      else if (this.reached(target, gapTo(v.groundedPosition, shape))) this.board(target);
      else this.hold(target);
    }
    if (this.boarding) {
      const { target } = this.boarding, walker = v.walker;
      if (!walker || !this.shapeOf(target)) { this.boarding = null; if (walker) walker.board = null; }
      else if (walker.boarded) said = this.enter(target) || said;
      else if (!this.boarding.moving) this.hold(target);
    }
    const car = this.parked;
    if (!car) return said;
    car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
    if (car.drone) return this.fly(car, dt, chunks) || said;
    // (one left up on a roof stays just where it is: nothing but them reaches it there)
    if (car.perch === undefined) this.traffic.slide(car, dt, chunks);
    if (car.rock && !rock(car.rock, dt)) car.rock = null;
    this.traffic.pose(car);
    if (car.perch !== undefined) car.position.y = car.perch;
    this.traffic.collidePlayer(car, v);
    if (car.loose.vx || car.loose.vz || car.loose.spin) this.traffic.knockOn(car);
    return said;
  }
  render(alpha = 1, origin = 0) {
    const car = this.parked;
    if (!car) return;
    if (car.drone) { car.drone.render(alpha, origin); return; }
    const t = Math.min(1, Math.max(0, alpha));
    car.car.position.lerpVectors(car.previousPosition, car.position, t); car.car.position.z += origin;
    car.car.quaternion.slerpQuaternions(car.previousQuaternion, car.quaternion, t);
  }
  // Something flying left with nobody aboard, setting itself down (see
  // `drone`): the garage car's record follows it, and once it has stopped
  // and its engine has died it is parked there, in the traffic's way in the
  // street, or on the roof it came down on. If it gets too far away first,
  // the garage has it back. Returns anything worth saying.
  fly(car, dt, chunks) {
    const drone = car.drone, v = this.vehicle, props = v.props;
    drone.update(dt, LANDING);
    // (it knocks furniture flying as the player's car does, and meets parked cars as walls)
    if (chunks) collideScenery(drone, chunks, dt, (collider, contact) => Boolean(collider.prop && props?.hit(collider, contact, drone)));
    car.s = drone.s; car.u = drone.u; car.heading = drone.heading;
    car.position.copy(drone.groundedPosition); car.quaternion.copy(drone.car.quaternion);
    // (the streets built round the player: see CitydriverWorld.update)
    const centre = this.world?.centerCell, cell = centre && cityCell(drone.s, drone.u);
    const built = !centre || Math.max(Math.abs(cell.ix - centre.ix), Math.abs(cell.iz - centre.iz)) <= this.world.radius;
    if (!built || Math.hypot(drone.s - v.s, drone.u - v.u) > DRONE_FAR) {
      const name = carEntry(car.kept.carId).name;
      this.dropParked();
      return `${name} · back in the garage`;
    }
    if (!drone.pilot.settled) return '';
    car.drone = null;
    if (car.position.y > v.route.height(car.s, car.u) + .5) car.perch = car.position.y;
    car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
    car.kept.model.body.rotation.set(0, 0, 0);
    for (const light of car.kept.model.nightLights) light.material.emissiveIntensity = light.day;
    this.traffic.playerCars.push(car);
    return '';
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
    this.leaving = false; this.approach = null; this.boarding = null;
    if (this.borrowed) { this.traffic.giveBack(this.borrowed); this.borrowed = null; }
    if (this.bay) { this.traffic.leaveParked(this.bay); this.bay = null; }
    this.dropParked();
  }
  // The garage car goes, wherever it was left
  dropParked() {
    const car = this.parked;
    if (!car) return;
    this.unpark(); car.car.removeFromParent(); car.kept.model.disposeModel();
  }
  // What they look at on foot (see Walker's `watch`): a car going by close,
  // else someone near them or, now and then, their own car or, standing
  // about, the camera, each watched a while before another is picked. Going
  // to a car or hopping in, that car. `world` has the residents (see
  // CitydriverWorld), `time` is the game's clock, and `lens` ({ x, z }, as
  // the colliders lie) is where the camera is.
  lookAround(world, time, lens = null) {
    this.world = world; this.clock = time;
    const walker = this.vehicle.walker;
    if (!walker) return;
    const p = this.vehicle.groundedPosition, gaze = this.gaze ??= { target: null, until: -Infinity, last: null }, out = this.watching;
    const going = (this.boarding ?? this.approach)?.target, shape = going && this.shapeOf(going);
    if (shape) { out.x = shape.x; out.z = shape.z; walker.watch = out; return; }
    // (where a resident is drawn in the world while their chunk is about, or a car while it is seen)
    const where = target => {
      if (!target) return null;
      if (target === 'lens') return lens && walker.idle > 2 ? (out.x = lens.x, out.z = lens.z, out) : null;
      if (target.car) return target.car.visible === false ? null : (out.x = target.position.x, out.z = target.position.z, out);
      const { person, chunk } = target;
      if (world?.chunks?.get(chunk.index) !== chunk || !person.drawn || person.away) return null;
      out.x = person.drawn.x + chunk.east; out.z = person.drawn.z - chunk.start;
      return out;
    };
    // A car going by close is always worth a look
    let passing = null, near = PASSING;
    if (this.traffic.enabled) for (const car of this.traffic.vehicles) {
      if (!car.edge || !car.car.visible || Math.abs(car.speed) < 3) continue;
      const d = Math.hypot(car.position.x - p.x, car.position.z - p.z);
      if (d < near) { near = d; passing = car; }
    }
    if (passing && gaze.target !== passing) Object.assign(gaze, { target: passing, until: time + 1.2 });
    let at = where(gaze.target);
    if (at && gaze.target !== 'lens' && Math.hypot(at.x - p.x, at.z - p.z) > LOOK_NEAR * 1.5) at = null;
    if (!at || time > gaze.until) {
      // Someone near them (not whoever they looked at last), else now and
      // then their own car or the camera, else nothing in particular a while
      const roll = Math.abs(Math.sin(Math.floor(time * 3.1) * 12.9898) * 43758.5453) % 1, people = [];
      for (const chunk of world?.chunks?.values() ?? []) for (const person of chunk.walkers ?? []) {
        if (!person.drawn || person.away || person === gaze.last) continue;
        const d = Math.hypot(person.drawn.x + chunk.east - p.x, person.drawn.z - chunk.start - p.z);
        if (d < LOOK_NEAR) people.push({ person, chunk, d });
      }
      people.sort((a, b) => a.d - b.d);
      const own = this.parked && gaze.target !== this.parked && Math.hypot(this.parked.position.x - p.x, this.parked.position.z - p.z) < 15;
      let target = null;
      if (people.length && roll < .55) target = people[Math.floor(roll * 20) % Math.min(2, people.length)];
      else if (own && roll < .7) target = this.parked;
      else if (lens && walker.idle > 2 && gaze.target !== 'lens' && roll < .8) target = 'lens';
      Object.assign(gaze, { target, until: time + (target ? 1.4 + roll * 2 : 1.2 + roll) });
      if (target?.person) gaze.last = target.person;
      at = where(target);
    }
    walker.watch = at;
  }
  // The cars that can come between them and the chase camera (see
  // sightLine): the traffic, parked cars knocked loose and their own car,
  // in records kept from frame to frame
  sightCars() {
    const sight = this.sight ??= { ground: 0, bodies: [], pool: [] }, traffic = this.traffic, v = this.vehicle;
    // (the street's height, where the kerb's parked cars stand: from a roof, at
    // theirs, the cars below stood in the camera's way as walls up there)
    sight.ground = v.route.height(v.s, v.u); sight.bodies.length = 0;
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
  // Every car they could get into near them, `visit(found)` for each: their
  // own ({ car, own }), the traffic's ({ car }), or one parked along the kerb
  // ({ bay }, in its bay or knocked loose), while there is traffic
  candidates(visit) {
    const p = this.vehicle.groundedPosition, traffic = this.traffic, far = ENTER + 6;
    const near = (x, z) => Math.abs(x - p.x) < far && Math.abs(z - p.z) < far;
    // (their own, unless it is still coming down with nobody aboard, or rolling)
    const own = this.parked, drone = own?.drone;
    if (own && (!drone || (drone.pilot.landed && Math.abs(drone.speed) < 2)) && near(own.position.x, own.position.z)) visit({ car: own, own: true });
    if (!traffic.enabled) return;
    // (a traffic car sent round to turn up somewhere else is a new car: see shapeOf)
    for (const car of traffic.vehicles) if (car.edge && car.car.visible && near(car.position.x, car.position.z)) visit({ car, generation: car.generation });
    for (const car of traffic.woken) if (car.parked && near(car.position.x, car.position.z)) visit({ bay: car.parked });
    for (const chunk of this.vehicle.scenery?.values() ?? []) {
      const bounds = chunk?.collisionBounds;
      if (!bounds || p.x < bounds.minX - far || p.x > bounds.maxX + far || p.z < bounds.minZ - far || p.z > bounds.maxZ + far) continue;
      for (const solid of chunk.features.colliders) if (solid.parked?.ready && !solid.woken && near(solid.x, solid.z)) visit({ bay: solid });
    }
  }
  // Where a car they could get into (as candidates finds one) stands now:
  // { x, z, y, heading, halfWidth, halfLength, top } (one record, reused),
  // or null if it is no longer there to get into
  shapeOf(found) {
    const shape = this.shape ??= {}, traffic = this.traffic;
    const of = (car, height) => Object.assign(shape, { x: car.position.x, z: car.position.z, y: car.position.y, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2, along: doorAlong(car.spec), seat: car.spec.seat ?? .3, top: height });
    if (found.own) return found.car === this.parked ? of(found.car, found.car.profile?.height ?? 1.6) : null;
    if (found.car) {
      const car = found.car, same = found.generation === undefined || car.generation === found.generation;
      return same && traffic.enabled && car.edge && car.car.visible && traffic.vehicles.includes(car) ? of(car, car.profile?.height ?? 1.6) : null;
    }
    const bay = found.bay;
    if (!traffic.enabled || !bay.parked?.ready) return null;
    const standIn = traffic.woken.find(car => car.parked === bay);
    if (standIn) return of(standIn, standIn.profile?.height ?? 1.6);
    if (bay.woken) return null;
    // (the height of the traffic's own car of that shape)
    const model = TRAFFIC_MODELS.find(each => each.name === bay.parked.model), top = traffic.profiles?.get(model.name)?.height ?? 1.6;
    return Object.assign(shape, { x: bay.x, z: bay.z, y: this.vehicle.groundedPosition.y, heading: traffic.bayPose(bay).heading, halfWidth: model.width / 2, halfLength: model.length / 2, along: doorAlong(model), seat: .3, top });
  }
  // The car E or Y would get them into: of those within ENTER, the one they
  // face and are nearest, by San Andreas's score (how nearly they face it
  // times how far inside ENTER it is), those within REACH first, their own a
  // little before the rest. { ...found, gap } or null.
  target() {
    const v = this.vehicle, p = v.groundedPosition, fx = Math.sin(v.heading), fz = -Math.cos(v.heading);
    let best = null, score = -Infinity;
    this.candidates(found => {
      const shape = this.shapeOf(found);
      if (!shape || Math.abs(p.y - shape.y) > 1.5) return;
      const gap = gapTo(p, shape);
      if (gap > ENTER) return;
      const dx = shape.x - p.x, dz = shape.z - p.z, d = Math.hypot(dx, dz) || 1, facing = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
      const value = (1 - facing / (Math.PI * 2)) * (ENTER - gap) + (gap <= REACH ? ENTER : 0) + (found.own ? 1 : 0);
      if (value > score) { score = value; best = { ...found, gap }; }
    });
    return best;
  }
  // The door of a car they could get into on the side they are, and its
  // seat, beside the driver's ({ x, z }, { x, y, z } and the side, -1 left),
  // where the car stands now, or null
  doorOf(found, side = 0) {
    const shape = this.shapeOf(found), p = this.vehicle.groundedPosition;
    if (!shape) return null;
    const rx = Math.cos(shape.heading), rz = Math.sin(shape.heading), fx = Math.sin(shape.heading), fz = -Math.cos(shape.heading);
    side ||= (p.x - shape.x) * rx + (p.z - shape.z) * rz < 0 ? -1 : 1;
    const out = this.doorway ??= { x: 0, z: 0, seat: { x: 0, y: 0, z: 0 }, side: 0, heading: 0 };
    const across = side * (shape.halfWidth + WALKER_SPEC.radius + CLEAR), along = shape.along;
    out.x = shape.x + rx * across + fx * along; out.z = shape.z + rz * across + fz * along;
    out.seat.x = shape.x + rx * side * .3 + fx * along; out.seat.z = shape.z + rz * side * .3 + fz * along; out.seat.y = shape.y + shape.seat;
    out.side = side; out.heading = shape.heading;
    return out;
  }
  // Near enough to get in, `gap` from its side: a bus at its front door,
  // rather than anywhere along its side (the hop there would be a leap)
  reached(found, gap) {
    if (!(gap <= REACH)) return false;
    if (this.shapeOf(found)?.along < 2) return true;
    const door = this.doorOf(found), p = this.vehicle.groundedPosition;
    return Boolean(door) && Math.hypot(door.x - p.x, door.z - p.z) < 1.5;
  }
  // A traffic car they are going to, or hopping into, waits for them (see CityTraffic)
  hold(found) {
    if (found.car && !found.own) found.car.waiting = this.traffic.time + .5;
  }
  // Into a car within reach: a hop to its door and in (see Walker.boardCar),
  // then theirs to drive. One of the traffic's caught going by (not one
  // stopping for them) is not stopped: they dive in quicker, and drive it on
  // as it was going.
  board(found) {
    const walker = this.vehicle.walker, door = this.doorOf(found), waiting = Boolean(this.approach);
    this.approach = null;
    if (!door) return;
    const side = door.side, moving = Boolean(!waiting && found.car && !found.own && Math.abs(found.car.speed) > 2);
    this.boarding = { target: found, side, moving };
    if (!moving) this.hold(found);
    walker.boardCar(() => this.doorOf(found, side), moving ? BOARD * .6 : BOARD);
  }
  enter(found) {
    const side = this.boarding?.side ?? -1;
    this.boarding = null;
    const said = found.own ? this.getBackIn() : found.bay ? this.borrowParked(found.bay) : this.borrow(found.car);
    // (the car dips on its springs toward the side they climbed in)
    if (!this.walking) rockFrom(this.vehicle.jolt, 0, side * CLIMB);
    return said;
  }
  // Out beside the car, hopping down from its seat. Their own car stays
  // parked. A borrowed one goes back to its driver, or stands where they left it.
  getOut() {
    const v = this.vehicle, spot = this.exit(), pilot = v.pilot;
    this.leaving = false;
    if (!spot) return 'No room to get out here';
    const pose = { s: v.s, u: v.u, heading: v.heading, yawRate: v.yawRate }, spec = v.spec, seat = this.seatOf(spot), kept = v.stepOut(this.appearance);
    const car = this.leave(kept, pose, spec, pilot);
    // (the car rocks on its springs as they climb out)
    if (car) rockFrom(car.drone?.jolt ?? (car.rock ??= { pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 }), 0, spot.across * CLIMB);
    v.s = -spot.z; v.u = spot.x; v.walker.takeOver(spot.y); v.update(0, {});
    v.walker.alightFrom(seat, pose.heading);
    return '';
  }
  // High up in something flying, out anyway: they leap clear of its door and
  // fall until their parachute opens (see Walker.leap), and it lands itself
  // with nobody aboard (see fly)
  jump() {
    const v = this.vehicle, pilot = v.pilot, p = v.groundedPosition, spec = v.spec;
    this.leaving = false;
    const { x: vx, z: vz } = v.velocity, rise = Math.max(0, pilot.vy ?? 0);
    const pose = { s: v.s, u: v.u, heading: v.heading, yawRate: v.yawRate }, y = p.y + (spec.seat ?? 1);
    const rx = Math.cos(v.heading), rz = Math.sin(v.heading), fx = Math.sin(v.heading), fz = -Math.cos(v.heading);
    // (out of the door on the left, the driver's side)
    const out = spec.width / 2 + WALKER_SPEC.radius + .3, along = doorAlong(spec), x = p.x - rx * out + fx * along, z = p.z - rz * out + fz * along;
    this.leave(v.stepOut(this.appearance), pose, spec, pilot);
    v.s = -z; v.u = x;
    v.walker.leap(y, vx * .85 - rx * 3, rise + 2.5, vz * .85 - rz * 3);
    v.update(0, {});
    return '';
  }
  // Going too fast to stop, out anyway, as GTA's bail out: they leap clear
  // and tumble on (see Walker.bail), and the car rolls on without them,
  // skidding to a stop as a car knocked loose does, into whatever is in its way
  bail() {
    const v = this.vehicle, spot = this.exit();
    this.leaving = false;
    if (!spot) return 'No room to jump out here';
    const { x: vx, z: vz } = v.velocity, pose = { s: v.s, u: v.u, heading: v.heading, yawRate: v.yawRate }, spec = v.spec, pilot = v.pilot, kept = v.stepOut(this.appearance);
    const car = this.leave(kept, pose, spec, pilot);
    if (car?.loose && !car.drone) { car.loose.vx = vx; car.loose.vz = vz; car.moved = true; }
    v.s = -spot.z; v.u = spot.x; v.walker.takeOver(spot.y); v.update(0, {});
    const rx = Math.cos(pose.heading), rz = Math.sin(pose.heading), side = spot.across || -1;
    v.walker.bail(vx, vz, rx * side, rz * side);
    return '';
  }
  // The car they have just got out of, `kept` (see stepOut) where it stood
  // at `pose`: their own is parked (something flying handed on as `pilot`
  // left it: see drone), a borrowed one given back. Returns the car's
  // record, as the traffic keeps it.
  leave(kept, pose, spec, pilot = null) {
    if (!this.borrowed && !this.bay) { this.park(kept, pose, spec, pilot); return this.parked; }
    kept.model.car.removeFromParent(); kept.model.disposeModel();
    let car;
    if (this.borrowed) { car = this.borrowed; this.traffic.giveBack(car, pose); } else { this.traffic.leaveParked(this.bay, pose); car = this.traffic.woken.find(each => each.parked === this.bay); }
    this.borrowed = this.bay = null;
    return car;
  }
  // The driver's seat of the car they are in, on the side of `spot` (see exit)
  seatOf(spot) {
    const v = this.vehicle, p = v.groundedPosition, side = spot.across || -1, along = doorAlong(v.spec);
    const rx = Math.cos(v.heading), rz = Math.sin(v.heading), fx = Math.sin(v.heading), fz = -Math.cos(v.heading);
    return new THREE.Vector3(p.x + rx * side * .3 + fx * along, p.y + (v.spec.seat ?? .3), p.z + rz * side * .3 + fz * along);
  }
  // Where to stand, getting out: where the machine says to step down (the
  // plane's, behind its wing), else the first of the DOORS with room for them
  // ({ x, z, y, across })
  exit() {
    const v = this.vehicle, p = v.groundedPosition, r = WALKER_SPEC.radius, halfWidth = v.spec.width / 2, halfLength = v.spec.length / 2;
    const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    for (const side of v.spec.exit ? [-1, 1] : []) {
      const [out, along] = v.spec.exit, x = p.x + rx * side * out + fx * along, z = p.z + rz * side * out + fz * along, y = this.room(x, z, p.y);
      if (Number.isFinite(y)) return { x, z, y, across: side };
    }
    for (const [across, along] of DOORS) {
      const side = across * (halfWidth + r + CLEAR), ahead = across ? doorAlong(v.spec) : along * (halfLength + r + CLEAR);
      const x = p.x + rx * side + fx * ahead, z = p.z + rz * side + fz * ahead, y = this.room(x, z, p.y);
      if (Number.isFinite(y)) return { x, z, y, across };
    }
    return null;
  }
  // How high someone could stand at (x, z), or NaN if they can't: on dry
  // ground or a roof about as high as the car (`y`), clear of the scenery
  // and of every car
  room(x, z, y) {
    const route = this.vehicle.route, r = WALKER_SPEC.radius, s = -z, u = x, chunks = this.vehicle.scenery, at = { x, z };
    const floor = Math.max(route.height(s, u), chunks ? roofAt(chunks.values(), at, y + STEP) : -Infinity);
    if (route.water?.(s, u) || Math.abs(floor - y) > STEP) return NaN;
    let blocked = false;
    // (the roof they would stand on is no wall)
    if (chunks) sceneryContacts(() => ({ x, z, heading: 0, halfWidth: r, halfLength: r, radius: r }), chunks.values(), (contact, solid) => {
      if (solid.top === undefined || floor < roofSurface(solid, at) - STEP) blocked = true;
    });
    if (blocked) return NaN;
    const traffic = this.traffic, cars = [...(traffic.enabled ? [...traffic.vehicles, ...traffic.woken.filter(car => car.parked)] : []), ...(this.parked ? [this.parked] : [])];
    return cars.some(car => {
      const dx = x - car.position.x, dz = z - car.position.z, cos = Math.cos(car.heading), sin = Math.sin(car.heading);
      return Math.abs(dx * cos + dz * sin) < car.spec.width / 2 + r && Math.abs(dx * sin - dz * cos) < car.spec.length / 2 + r;
    }) ? NaN : floor;
  }
  // The garage car, left standing where it stopped: lights off, handbrake
  // on. Something flying (`pilot`, as the player left it) goes on as it
  // was, flown by nobody, until it has set down and stopped (see drone, fly).
  park(kept, pose, spec, pilot = null) {
    const model = kept.model;
    const car = this.parked = {
      kept, car: model.car, spec, profile: spec.profile, s: pose.s, u: pose.u, heading: pose.heading, speed: 0, handbrake: true, generation: 0, index: -1, dazed: 0, moved: false,
      loose: { vx: 0, vz: 0, spin: 0 }, rock: null, drone: null,
      position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion(),
    };
    if (pilot) {
      const drone = car.drone = this.drone(kept, pose, pilot);
      car.position.copy(drone.groundedPosition); car.quaternion.copy(drone.car.quaternion);
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      return;
    }
    model.body.rotation.set(0, 0, 0);
    for (const wheel of model.wheels) if (wheel.front) wheel.pivot.rotation.y = 0;
    for (const light of model.nightLights) light.material.emissiveIntensity = light.day;
    this.traffic.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
    this.traffic.playerCars.push(car);
  }
  // A controller of its own for something flying left with nobody aboard
  // (see fly), in its model as it stands, flying on just as the player's
  // pilot left it
  drone(kept, pose, pilot) {
    const v = this.vehicle, drone = new DrivingController(v.route, pose, kept.carId, kept.paint, kept.model);
    Object.assign(drone, { freeDriving: true, scenery: v.scenery, props: v.props, yawRate: pose.yawRate ?? 0 });
    for (const key of Object.keys(pilot)) if (key !== 'vehicle' && key !== 'feet') drone.pilot[key] = pilot[key];
    drone.pilot.unmanned = true; drone.pilot.events = [];
    drone.setLights(v.night);
    drone.update(0, {});
    return drone;
  }
  unpark() {
    const list = this.traffic.playerCars, at = list.indexOf(this.parked);
    if (at >= 0) list.splice(at, 1);
    this.parked = null;
  }
  // Into their own car, where it stands (a rotor or a propeller still
  // winding down picks up from there)
  getBackIn() {
    const v = this.vehicle, car = this.parked, winding = car.drone?.pilot;
    this.unpark();
    v.s = car.s; v.u = car.u; v.heading = car.heading; v.speed = 0;
    v.stepIn(car.kept);
    if (winding && v.pilot) { v.pilot.power = winding.power; v.pilot.angle = winding.angle; }
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
  // Into a parked car where it stands, in its bay or where it was knocked
  // to, in its own paint
  borrowParked(collider) {
    const v = this.vehicle, info = collider.parked, at = this.traffic.woken.find(car => car.parked === collider) ?? this.traffic.bayPose(collider);
    const { s, u, heading } = at;
    if (!this.traffic.takeParked(collider)) return '';
    v.s = s; v.u = u; v.heading = heading; v.speed = 0;
    v.setCar(info.model, { paint: info.colour });
    this.bay = collider;
    return `${carEntry(info.model).name} · borrowed`;
  }
}

// A marker over the car E or Y would get them into (see OnFoot.target), as
// Sleeping Dogs and Hit & Run float one over a car to take: a small point in
// free drive's teal, bobbing and turning over its roof, a little bigger
// while they go to it
const MARKER_LIFT = .55;
export class EnterMarker {
  constructor(scene) {
    const geometry = new THREE.ConeGeometry(.19, .34, 4);
    geometry.rotateX(Math.PI);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#5fd0c0' }));
    this.mesh.name = 'enter-marker'; this.mesh.visible = false; this.mesh.userData.ambientOcclusion = false;
    scene.add(this.mesh);
    this.target = null; this.checked = -Infinity;
  }
  // (its program, compiled with the city)
  warmupObjects() { return [new THREE.Mesh(this.mesh.geometry, this.mesh.material)]; }
  // Over the car `onFoot` would get into now (picked again every tenth of a second)
  update(onFoot, time, origin) {
    const walker = onFoot.vehicle.walker, mesh = this.mesh;
    if (!walker?.standing || onFoot.boarding) { mesh.visible = false; this.target = null; return; }
    if (onFoot.approach) this.target = onFoot.approach.target;
    else if (!(time - this.checked < .1 && time >= this.checked)) { this.checked = time; this.target = onFoot.target(); }
    const shape = this.target && onFoot.shapeOf(this.target);
    mesh.visible = Boolean(shape);
    if (!shape) return;
    mesh.position.set(shape.x, shape.y + shape.top + MARKER_LIFT + Math.sin(time * 3.4) * .07, shape.z + origin);
    mesh.rotation.y = time * 1.6;
    mesh.scale.setScalar(onFoot.approach ? 1.25 : 1);
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
