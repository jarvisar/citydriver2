import * as THREE from 'three';
import { CITY, cityStyleDistrict } from './city.js';
import { PAVEMENT_LEVEL } from './city-route.js';
import { seededRandom } from './route.js';
import { offsetPolygon } from '../mapgen/polygon-util.js';
import { cityWalker, walkerFloat, walkerAppearance, setWalkerAppearance, setWalkerTurn, addWalkerAlert } from './city-life.js';
import { lookYaw, glance, lean, nearestOnLoop, walkPose } from './pedestrian-reactions.js';
import { BUS_MODEL, BUS_DOORS, BUS_ROADS } from '../traffic-models.js';
import { approachControl } from '../city-junctions.js';

// The bus stops, and the people at them (see CityTraffic's serve). Each
// shelter by a bus road is a stop for the bus going its way along the curb.
// A few people wait at one, and now and then someone else walks up along
// the pavement. When the bus calls they file on at its front door, and a few
// get off at its middle one and walk off round the block as the residents
// do. Nobody is followed anywhere after that: a stop far from the player is
// forgotten, and so is anyone who walked off. They are residents to
// everything else (knocked flying, shoved, red in a demolition run), drawn
// as one instanced mesh near the player.

// How far in from the curb a shelter stands (see placeStreetFurniture), and
// how far in from the curb people walk (see CitydriverWorld.prepareLots).
// A stop needs the bus's tail STREET_CLEAR m into its street and its nose
// LINE_CLEAR m short of the stop line, room to pull out before the junction.
const SHELTER_IN = 1.7, WALK_IN = 1.5, STREET_CLEAR = 19, LINE_CLEAR = 12;
// A stop keeps its people while the player is within KEEP m, and they are
// drawn within DRAW m, at most PEOPLE of them. At most WALKING are walking
// off round the blocks at once.
const KEEP = 400, DRAW = 180, PEOPLE = 48, WALKING = 16;
// At most WAITING wait at a stop (one more in the BUSY districts), and
// someone new comes along about every ARRIVAL s (twice as often in the busy
// ones). Those more than BOARD m from the door when the bus calls miss it.
const WAITING = 3, ARRIVAL = 70, BOARD = 20;
const BUSY = new Set(['Midtown', 'Market district']);
// Where they wait, in front of the shelter: across it (+x into the block)
// and along it (+z up the road, where the bus comes from), the front row first
const SPOTS = [[-1, .1], [-1, 1.35], [-1, -1.2], [-.4, .7], [-.4, -.5]];
const NONE = [], IDENTITY = new THREE.Matrix4(), transform = new THREE.Object3D(), float = {}, watching = { x: 0, z: 0 };
const yawAlong = (du, ds) => Math.atan2(-du, ds);

// Where a rider is at `time`, along their legs, each starting where the last
// ended: a `pause` (`hidden` while still in the bus), a straight walk `to` a
// point, or a walk round a block's pavement (`loop`, see walkPose) for
// `distance` meters. Into their x, s, heading (null standing) and pace.
// Anyone who walks `to` the door with `board` is gone.
function follow(rider, time) {
  for (;;) {
    const leg = rider.legs[0], from = rider.from, t = time - rider.at;
    rider.hidden = Boolean(leg?.hidden);
    if (!leg || leg.pause !== undefined) {
      if (leg && t >= leg.pause) { rider.at += leg.pause; rider.legs.shift(); continue; }
      rider.x = from.x; rider.s = from.s; rider.heading = null; rider.pace = 0;
      return;
    }
    if (leg.to) {
      const dx = leg.to.x - from.x, ds = leg.to.s - from.s, length = Math.hypot(dx, ds), d = Math.max(0, t * leg.speed);
      if (d >= length) { rider.at += length / leg.speed; rider.from = leg.to; rider.legs.shift(); rider.gone ||= Boolean(leg.board); continue; }
      rider.x = from.x + dx * d / length; rider.s = from.s + ds * d / length; rider.heading = yawAlong(dx, ds); rider.pace = leg.speed;
      return;
    }
    const walked = Math.max(0, t * leg.speed);
    if (walked >= leg.distance) {
      const end = walkPose(leg, leg.distance);
      rider.at += leg.distance / leg.speed; rider.from = { x: end.x, s: end.s }; rider.legs.shift();
      continue;
    }
    const p = walkPose(leg, walked);
    rider.x = p.x; rider.s = p.s; rider.heading = p.yaw; rider.pace = leg.speed;
    return;
  }
}

export class BusStops {
  // `shelters` are the street furniture's (see placeStreetFurniture), and
  // `material` and `alert` the residents' (see CitydriverWorld)
  constructor(scene, material, alert, shelters, nav) {
    this.loops = new Map();
    this.stops = shelters.map(piece => this.stopAt(piece, nav)).filter(Boolean);
    this.byEdge = new Map();
    this.stops.forEach((stop, index) => {
      stop.index = index;
      const key = stop.edge.id * 2 + (stop.direction > 0 ? 1 : 0);
      if (!this.byEdge.has(key)) this.byEdge.set(key, []);
      this.byEdge.get(key).push(stop);
    });
    for (const list of this.byEdge.values()) list.sort((a, b) => a.along - b.along);
    // Who is at each stop near the player, the bus's calls under way, and
    // those who got off, walking round the blocks
    this.states = new Map(); this.visits = []; this.walking = [];
    this.random = seededRandom(CITY.seed ^ 0x6b75); this.time = 0; this.bus = null;
    this.mesh = new THREE.InstancedMesh(cityWalker, material, PEOPLE);
    this.mesh.name = 'citydriver-bus-riders'; this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // (every slot dressed before the warning's copies share its colors and morphs)
    const anyone = walkerAppearance(0);
    for (let i = 0; i < PEOPLE; i++) setWalkerAppearance(this.mesh, i, anyone);
    this.slots = new Array(PEOPLE).fill(null); this.drawn = { count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    this.mesh.boundingSphere = new THREE.Sphere();
    addWalkerAlert(this.mesh, alert);
    this.mesh.count = 0; this.mesh.visible = false;
    for (const copy of this.mesh.children) copy.count = 0;
    scene?.add(this.mesh);
  }
  // A shelter as a stop: the street and way along it the bus comes (the one
  // with the shelter on its right, since traffic keeps right), where the bus
  // stops (`along`, its middle, with the front door just past the shelter)
  // and how far out (`lane`, by the curb), and the curb of the block or park
  // behind it (see walk). Null if it is not by a bus road, or too near
  // either end of its street.
  stopAt(piece, nav) {
    const nx = Math.cos(piece.yaw), ny = Math.sin(piece.yaw), tx = ny, ty = -nx;
    const kx = piece.u - nx * SHELTER_IN, ky = piece.s - ny * SHELTER_IN;
    const hit = nav.index.nearest(kx, ky, 24, (segment, distance) => BUS_ROADS.has(segment.road.edge.kind) ? distance : Infinity);
    const place = CITY.pavement.find(piece.u, piece.s), ring = place?.kind === 'block' ? CITY.blocks[place.block]?.kerb : place?.kind === 'park' ? CITY.parkPlans[place.park]?.kerb : null;
    if (!hit || !(ring?.length >= 3)) return null;
    const edge = hit.road.edge, at = edge.cumulative[hit.segment.index] + hit.t * hit.segment.length;
    const direction = -tx * hit.tx - ty * hit.ty >= 0 ? 1 : -1, beside = direction > 0 ? at : edge.length - at;
    const centre = nav.pose(edge, beside, direction, 0), kerb = (kx - centre.u) * Math.cos(centre.heading) - (ky - centre.s) * Math.sin(centre.heading);
    const profile = edge.profile, along = beside + 1 - BUS_DOORS.on, half = BUS_MODEL.length / 2;
    const control = approachControl(nav, edge, direction), line = control?.kind ? edge.length - control.stopDistance : edge.length;
    if (kerb < profile.lane + 2 || kerb > profile.halfWidth + 2 || along - half < STREET_CLEAR || along + half > line - LINE_CLEAR) return null;
    const lane = Math.max(profile.lane, kerb - BUS_MODEL.width / 2 - .3);
    return { x: piece.u, s: piece.s, nx, ny, tx, ty, edge, direction, along, lane, kerb, ring, loop: undefined, phase: 0, district: cityStyleDistrict(piece.s, piece.u) };
  }
  // The pavement a stop's people walk, and where on it the stop is, worked
  // out when first wanted: only the stops near the player ever need it
  walk(stop) {
    if (stop.loop === undefined) { stop.loop = this.loop(stop.ring); stop.phase = stop.loop ? nearestOnLoop(stop.loop, stop.x, stop.s) : 0; }
    return stop.loop;
  }
  // The residents' walk just inside a curb (as CitydriverWorld.prepareLots makes it)
  loop(ring) {
    if (!ring || ring.length < 3) return null;
    if (!this.loops.has(ring)) {
      const points = offsetPolygon(ring, -WALK_IN), cumulative = [0];
      for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; cumulative.push(cumulative[i] + Math.hypot(b.x - a.x, b.y - a.y)); }
      const perimeter = cumulative[points.length];
      this.loops.set(ring, points.length >= 3 && perimeter >= 30 ? { points, cumulative, perimeter } : null);
    }
    return this.loops.get(ring);
  }
  // The stops the bus passes along an edge the way it goes, nearest first
  on(edge, direction) { return this.byEdge.get(edge.id * 2 + (direction > 0 ? 1 : 0)) ?? NONE; }
  // Whether the bus coming up to `stop` calls there: someone waiting near
  // enough to get on, or someone on board who wants to get off
  calling(stop, bus) {
    const state = this.state(stop);
    this.bus = bus;
    state.alight = stop.loop && this.random() < (state.busy ? .55 : .35) ? 1 + Math.floor(this.random() * (state.busy ? 3 : 2)) : 0;
    return state.alight > 0 || state.waiting.some(rider => this.near(rider, stop));
  }
  near(rider, stop) {
    follow(rider, rider.held ?? this.time);
    return rider.held === null && Math.hypot(rider.x - stop.x, rider.s - stop.s) < BOARD;
  }
  // The bus has stopped: those waiting walk to its front door one after
  // another, the furthest hurrying, and those getting off step down from its
  // middle one a second or so apart. How long the bus waits (s).
  arrive(stop, bus) {
    const state = this.state(stop), time = this.time, h = bus.heading, out = stop.kerb - bus.lane + .1;
    const door = along => ({ x: bus.u + Math.sin(h) * along + Math.cos(h) * out, s: bus.s + Math.cos(h) * along - Math.sin(h) * out });
    const on = door(BUS_DOORS.on), off = door(BUS_DOORS.off), gap = rider => Math.hypot(rider.x - on.x, rider.s - on.s);
    const boarders = state.waiting.filter(rider => this.near(rider, stop)).sort((a, b) => gap(a) - gap(b));
    state.waiting = state.waiting.filter(rider => !boarders.includes(rider));
    let done = 2;
    boarders.forEach((rider, k) => {
      const far = gap(rider), speed = far > 6 ? 2.6 : 1.4, pause = .6 + k * 1.1;
      rider.from = { x: rider.x, s: rider.s }; rider.at = time; rider.legs = [{ pause }, { to: on, speed, board: true }];
      done = Math.max(done, pause + far / speed + .8);
    });
    // (onto the pavement, and off round the block one way or the other)
    const phase = state.alight ? nearestOnLoop(stop.loop, off.x, off.s) : 0, pavement = state.alight && walkPose({ loop: stop.loop, phase, direction: 1 }, 0);
    for (let k = 0; k < state.alight && this.walking.length < WALKING; k++) {
      const rider = this.person(stop), pause = .8 + k * 1.2, direction = this.random() < .5 ? 1 : -1;
      rider.from = off; rider.at = time;
      rider.legs = [{ pause, hidden: true }, { to: { x: pavement.x, s: pavement.s }, speed: 1.3 }, { loop: stop.loop, phase, direction, speed: rider.speed, distance: Infinity }];
      this.walking.push(rider);
      done = Math.max(done, pause + 1.5);
    }
    state.alight = 0; this.bus = bus;
    this.visits.push({ stop, bus, boarders });
    return done + 1;
  }
  // A stop's people, made the first time it is asked about: a few waiting already
  state(stop) {
    let state = this.states.get(stop);
    if (!state) {
      const busy = BUSY.has(stop.district);
      state = { waiting: [], busy, most: this.walk(stop) ? WAITING + (busy ? 1 : 0) : 0, alight: 0, next: this.time + this.random() * ARRIVAL * (busy ? .5 : 1) };
      for (let n = Math.floor(this.random() * (state.most + 1)); n > 0; n--) this.wait(stop, state, this.person(stop));
      this.states.set(stop, state);
    }
    return state;
  }
  person(stop) {
    const random = this.random;
    return {
      appearance: walkerAppearance(Math.floor(random() * 0x7fffffff), stop.district), size: .9 + random() * .22, width: .92 + random() * .16,
      speed: 1.1 + random() * .7, phase: random() * 6.3, twist: random() * .7 - .15,
      legs: [], from: null, at: this.time, x: 0, s: 0, heading: null, pace: 0, face: 0, spot: -1, hidden: false, gone: false, held: null,
    };
  }
  // Someone takes a free spot at the stop, walking there from where they
  // are (at once, with nowhere given), and waits facing the road, turned a
  // little up it, where the bus comes from. Someone who missed the bus
  // (`back`) always finds a spot.
  wait(stop, state, rider, from = null, back = false) {
    let spot = SPOTS.findIndex((_, i) => !state.waiting.some(other => other.spot === i));
    if (!back && (spot < 0 || state.waiting.length >= state.most)) return false;
    if (spot < 0) spot = 0;
    const [x, z] = SPOTS[spot], at = { x: stop.x + stop.nx * x + stop.tx * z, s: stop.s + stop.ny * x + stop.ty * z };
    rider.spot = spot; rider.face = yawAlong(-stop.nx * Math.cos(rider.twist) + stop.tx * Math.sin(rider.twist), -stop.ny * Math.cos(rider.twist) + stop.ty * Math.sin(rider.twist));
    rider.from = from ?? at; rider.at = rider.held ?? this.time; rider.legs = from ? [{ to: at, speed: rider.speed }] : [];
    state.waiting.push(rider);
    return true;
  }
  // Someone new walks up along the pavement from one way or the other
  arrival(stop, state) {
    const rider = this.person(stop), distance = 15 + this.random() * 20, direction = this.random() < .5 ? 1 : -1;
    const phase = stop.phase - distance * direction, start = walkPose({ loop: stop.loop, phase, direction }, 0);
    if (!this.wait(stop, state, rider, { x: start.x, s: start.s })) return;
    rider.legs.unshift({ loop: stop.loop, phase, direction, speed: rider.speed, distance });
  }
  // `contacts` (PedestrianContacts) has the player, and knocks people flying
  animate(time, contacts = null) {
    this.time = time;
    const player = contacts?.player;
    if (!player) { this.mesh.visible = false; return; }
    const ps = player.s, pu = player.u;
    // A call is over once the bus has gone: anyone not yet on goes back to
    // wait for the next (a stop forgotten meanwhile forgets them too)
    for (let i = this.visits.length - 1; i >= 0; i--) {
      const { stop, bus, boarders } = this.visits[i], service = bus.service;
      if (service?.stop === stop && service.state === 'wait') continue;
      const state = this.states.get(stop);
      for (const rider of boarders) if (!rider.gone && state) {
        follow(rider, rider.held ?? time);
        this.wait(stop, state, rider, { x: rider.x, s: rider.s }, true);
      }
      this.visits.splice(i, 1);
    }
    // Stops near the player have people; those far off are forgotten
    for (const stop of this.stops) if (Math.abs(stop.x - pu) < DRAW && Math.abs(stop.s - ps) < DRAW) this.state(stop);
    for (const [stop, state] of this.states) {
      let calling = false;
      for (const visit of this.visits) calling ||= visit.stop === stop;
      if ((Math.abs(stop.x - pu) > KEEP || Math.abs(stop.s - ps) > KEEP) && !calling) { this.states.delete(stop); continue; }
      if (time < state.next || calling) continue;
      if (state.waiting.length < state.most) this.arrival(stop, state);
      state.next = time + ARRIVAL * (state.busy ? .5 : 1) * (.5 + this.random());
    }
    for (let i = this.walking.length - 1; i >= 0; i--) {
      const rider = this.walking[i];
      follow(rider, rider.held ?? time);
      if (Math.abs(rider.x - pu) > KEEP / 2 || Math.abs(rider.s - ps) > KEEP / 2) this.walking.splice(i, 1);
    }
    // Everyone near enough, into the mesh
    const drawn = this.drawn;
    drawn.count = 0; drawn.minX = drawn.minZ = Infinity; drawn.maxX = drawn.maxZ = -Infinity;
    for (const state of this.states.values()) for (const rider of state.waiting) this.draw(rider, time, contacts);
    for (const visit of this.visits) for (const rider of visit.boarders) this.draw(rider, time, contacts);
    for (const rider of this.walking) this.draw(rider, time, contacts);
    const mesh = this.mesh, count = drawn.count;
    mesh.count = count; mesh.visible = count > 0;
    for (const copy of mesh.children) copy.count = count;
    if (!count) return;
    // (round them all, with room for anyone knocked flying)
    mesh.boundingSphere.center.set((drawn.minX + drawn.maxX) / 2, PAVEMENT_LEVEL + 1, (drawn.minZ + drawn.maxZ) / 2);
    mesh.boundingSphere.radius = Math.hypot(drawn.maxX - drawn.minX, drawn.maxZ - drawn.minZ) / 2 + 40;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  }
  // A rider into the mesh, if near enough to the player and not in the bus.
  // They walk and bob as the residents do, and look round at the bus as it
  // pulls up, or at the player.
  draw(rider, time, contacts) {
    const mesh = this.mesh, drawn = this.drawn, player = contacts.player, index = drawn.count;
    follow(rider, rider.held ?? time);
    if (index >= PEOPLE || rider.gone || rider.hidden || Math.abs(rider.x - player.u) > DRAW || Math.abs(rider.s - player.s) > DRAW) return;
    const motion = walkerFloat(rider, time, float), bob = .3 + .7 * Math.min(1, rider.pace / rider.speed), width = rider.size * rider.width;
    const yaw = lookYaw(rider, 0, rider.heading ?? rider.face, time);
    transform.position.set(rider.x, PAVEMENT_LEVEL + motion.lift * bob, -rider.s);
    transform.rotation.set(0, yaw, motion.roll * bob);
    transform.scale.set(width, rider.size * motion.stretch, width);
    transform.updateMatrix();
    const matrix = lean(transform.matrix, rider.pace - rider.speed - .3);
    // (knocked flying, where their legs had them is held until they are back)
    const away = contacts.person(rider, matrix, IDENTITY, .28 * width, time);
    if (away && rider.held === null) rider.held = time;
    else if (!away && rider.held !== null) { rider.at += time - rider.held; rider.held = null; }
    if (this.slots[index] !== rider) { setWalkerAppearance(mesh, index, rider.appearance); this.slots[index] = rider; }
    mesh.setMatrixAt(index, matrix);
    const bus = this.bus?.car.visible ? this.bus.position : null, near = bus && Math.abs(bus.x - rider.x) < 20 && Math.abs(bus.z + rider.s) < 20;
    watching.x = near ? bus.x : player.u; watching.z = near ? bus.z : -player.s;
    setWalkerTurn(mesh, index, rider.held === null ? glance(rider, yaw, rider.x, -rider.s, watching, time) : 0);
    const x = matrix.elements[12], z = matrix.elements[14];
    drawn.minX = Math.min(drawn.minX, x); drawn.maxX = Math.max(drawn.maxX, x); drawn.minZ = Math.min(drawn.minZ, z); drawn.maxZ = Math.max(drawn.maxZ, z);
    drawn.count++;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); }
}
