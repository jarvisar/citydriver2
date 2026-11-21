import * as THREE from 'three';
import { CITY, cityStyleDistrict } from './city.js';
import { PAVEMENT_LEVEL } from './city-route.js';
import { seededRandom } from './route.js';
import { WalkSpace } from './city-walks.js';
import { KERBSIDE } from './city-streets.js';
import { cityWalker, walkerFloat, walkerAppearance, setWalkerAppearance, setWalkerTurn, addWalkerAlert } from './city-life.js';
import { lookYaw, glance, lean, nearestOnLoop, walkPose, walkedAt } from './pedestrian-reactions.js';
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

// How far in from the curb a shelter stands (see placeStreetFurniture).
// A stop needs the bus's tail STREET_CLEAR m into its street and its nose
// LINE_CLEAR m short of the stop line, room to pull out before the junction.
const SHELTER_IN = KERBSIDE.shelter, STREET_CLEAR = 19, LINE_CLEAR = 12;
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
// and along it (+z up the road, where the bus comes from), the front row
// first, the second clear of the bench's edge (they stood in it)
export const SPOTS = [[-1.15, 0], [-1.15, 1.1], [-1.15, -1.1], [-.62, .55], [-.62, -.55]];
// People walk behind the shelter, along the lot line, and get to its front
// round one of its ends, never through it: the first way across the
// pavement clear of its bin, ENDS m from its middle, to FRONT m across it,
// and from there along the curb, clear of the flag's post, to their spot
const ENDS = [2.5, 3, 3.6, 4.3, 5, 5.8], FRONT = [-1.4, -1.2];
// Riders on a walk keep GAP m from whoever else is on it (m along it)
const GAP = 2;
const NONE = [], IDENTITY = new THREE.Matrix4(), transform = new THREE.Object3D(), float = {}, watching = { x: 0, z: 0 };
const yawAlong = (du, ds) => Math.atan2(-du, ds);

// Where a rider is at `time`, along their legs, each starting where the last
// ended: a `pause` (`hidden` while still in the bus), a straight walk `to` a
// point, or a walk round a block's pavement (`loop`, see walkPose) for
// `distance` meters. Into their x, s, heading (null standing) and pace.
// Anyone who walks `to` the door with `board` is gone.
export function follow(rider, time) {
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
  // `walks` knows where people walk and what stands on the pavements (see WalkSpace)
  constructor(scene, material, alert, shelters, nav, walks = null) {
    this.walks = walks;
    if (!walks) { this.walks = new WalkSpace(); for (const piece of shelters) this.walks.add(piece); }
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
    // (the curb on the bus's right, with room for it between its lane and the curb)
    const side = BUS_MODEL.width / 2 + .3;
    if (kerb < profile.lane + side || kerb > profile.halfWidth + 2 || along - half < STREET_CLEAR || along + half > line - LINE_CLEAR) return null;
    const lane = Math.max(profile.lane, kerb - side);
    return { x: piece.u, s: piece.s, nx, ny, tx, ty, edge, direction, along, lane, kerb, ring, place, loop: undefined, phase: 0, gates: NONE, spots: NONE, district: cityStyleDistrict(piece.s, piece.u) };
  }
  // The pavement a stop's people walk (the residents' own walk round its
  // block, or along its park's lawn), where on it the stop is, the spots
  // free to wait at and the ways round the shelter's ends (`gates`: a point
  // on the walk behind it and one in front), worked out when first wanted:
  // only the stops near the player ever need it
  walk(stop) {
    if (stop.loop !== undefined) return stop.loop;
    const walks = this.walks, at = (x, z) => ({ x: stop.x + stop.nx * x + stop.tx * z, y: stop.s + stop.ny * x + stop.ty * z });
    const loop = stop.loop = (stop.place.kind === 'block' ? walks.block(stop.place.block) : walks.park(stop.place.park)) ?? null;
    if (!loop) return null;
    stop.phase = nearestOnLoop(loop, stop.x, stop.s);
    stop.spots = SPOTS.map(([x, z]) => at(x, z)).filter(p => walks.clear(p.x, p.y, .25, .04)).map(p => ({ x: p.x, s: p.y }));
    stop.gates = [];
    for (const end of [1, -1]) search: for (const reach of ENDS) for (const across of FRONT) {
      const phase = stop.phase + end * reach, pose = walkPose({ loop, phase, direction: 1 }, 0), back = { x: pose.x, y: pose.s }, front = at(across, end * reach);
      if (!walks.open(back, front)) continue;
      stop.gates.push({ end, phase, back: { x: back.x, s: back.y }, front: { x: front.x, s: front.y } });
      break search;
    }
    return loop;
  }
  // The way on foot from `from` to `to` ({ x, s }) as the points to walk to
  // in turn: straight there if nothing stands between, else round an end of
  // the shelter, whichever is shorter (and straight there if neither is open)
  way(stop, from, to) {
    const walks = this.walks, open = (a, b) => walks.open({ x: a.x, y: a.s }, { x: b.x, y: b.s }), far = (a, b) => Math.hypot(b.x - a.x, b.s - a.s);
    if (open(from, to)) return [to];
    // (along the curb to level with a spot in front of the shelter, then in to it)
    const along = (to.x - stop.x) * stop.tx + (to.s - stop.s) * stop.ty, front = (to.x - stop.x) * stop.nx + (to.s - stop.s) * stop.ny < -.3;
    const level = front ? [{ x: stop.x + stop.nx * FRONT[0] + stop.tx * along, s: stop.s + stop.ny * FRONT[0] + stop.ty * along }] : [];
    const ways = [level];
    for (const gate of stop.gates) ways.push([gate.front], [gate.front, ...level], [gate.back], [gate.back, gate.front], [gate.back, gate.front, ...level], [gate.front, gate.back]);
    let best = null, least = Infinity;
    for (const via of ways) {
      if (!via.length) continue;
      const points = [from, ...via, to];
      let length = 0, clear = true;
      for (let i = 1; i < points.length && clear; i++) { length += far(points[i - 1], points[i]); clear = length < least && (far(points[i - 1], points[i]) < 1e-6 || open(points[i - 1], points[i])); }
      if (clear) { best = [...via, to]; least = length; }
    }
    return best ?? [to];
  }
  // How long someone joining a stop's walk `at` meters round it at `time`
  // should hold back (s), so as not to fall in on top of anyone on it: all
  // on a walk go one way at one pace, so whoever starts clear stays clear
  hold(loop, at, time) {
    const turn = loop.direction ?? 1, pace = loop.pace, apart = (a, b) => Math.abs(a - b - Math.round((a - b) / loop.perimeter) * loop.perimeter);
    // (where each would be had they all been walking since time 0)
    const marks = [];
    for (const walkers of loop.people ?? []) for (const walker of walkers) marks.push(walker.phase + (walkedAt(walker, time) - pace * time) * turn);
    loop.riders = (loop.riders ?? []).filter(other => !other.rider.gone && other.rider.legs.some(leg => leg.loop === loop));
    for (const other of loop.riders) marks.push(other.mark);
    for (let wait = 0; wait < 12; wait += .25) { const mark = at - pace * (time + wait) * turn; if (marks.every(other => apart(mark, other) >= GAP)) return wait; }
    return 0;
  }
  // (a rider takes their place on the walk, from `time`)
  join(loop, rider, at, time) { (loop.riders ??= []).push({ rider, mark: at - loop.pace * time * (loop.direction ?? 1) }); }
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
      const far = gap(rider), speed = far > 6 ? 2.6 : 1.4, pause = .6 + k * 1.1, from = { x: rider.x, s: rider.s };
      // (anyone still behind the shelter comes round its end)
      const way = this.way(stop, from, on), walk = way.reduce((sum, p, i) => sum + Math.hypot(p.x - (way[i - 1] ?? from).x, p.s - (way[i - 1] ?? from).s), 0);
      rider.from = from; rider.at = time; rider.legs = [{ pause }, ...way.map((to, i) => ({ to, speed, board: i === way.length - 1 }))];
      done = Math.max(done, pause + walk / speed + .8);
    });
    // Onto the pavement, across it to the walk by a way clear of the bin and
    // the trees, and off round the block the way everyone on it goes, at
    // their pace, each once there is room on it (see hold)
    const loop = stop.loop, turn = loop?.direction ?? 1, landings = [];
    if (state.alight) {
      // (the door may open right beside something: a hair's clearance will do)
      const nearest = nearestOnLoop(loop, off.x, off.s), open = (a, b) => this.walks.open({ x: a.x, y: a.s }, { x: b.x, y: b.s }, .25, .02);
      // (straight across if they can, else a step or two along the curb
      // first, and the nearest point of the walk if no way to it is open)
      for (const aside of [0, 1.2, -1.2, 2.4, -2.4]) {
        const from = aside ? { x: off.x + stop.tx * aside, s: off.s + stop.ty * aside } : off;
        if (aside && !open(off, from)) continue;
        for (const on of [0, 1, -1, 2, -2, 3, -3, 4.5, -4.5]) {
          const phase = nearest + aside + on, pose = walkPose({ loop, phase, direction: 1 }, 0), to = { x: pose.x, s: pose.s };
          if (landings.length < 3 && open(from, to)) landings.push({ phase, via: aside ? [from, to] : [to], across: (Math.abs(aside) + Math.hypot(to.x - from.x, to.s - from.s)) / 1.3 });
        }
      }
      if (!landings.length) { const pose = walkPose({ loop, phase: nearest, direction: 1 }, 0); landings.push({ phase: nearest, via: [{ x: pose.x, s: pose.s }], across: Math.hypot(pose.x - off.x, pose.s - off.s) / 1.3 }); }
    }
    for (let k = 0; k < state.alight && this.walking.length < WALKING; k++) {
      const rider = this.person(stop);
      // (which way they went was the next draw: everyone goes the walk's way now)
      this.random();
      let pause = .8 + k * 1.2, land = landings[0], wait = Infinity;
      for (const each of landings) { const hold = this.hold(loop, each.phase, time + pause + each.across); if (hold < wait) { wait = hold; land = each; } }
      pause += wait;
      this.join(loop, rider, land.phase, time + pause + land.across);
      rider.from = off; rider.at = time;
      rider.legs = [{ pause, hidden: true }, ...land.via.map(to => ({ to, speed: 1.3 })), { loop, phase: land.phase, direction: turn, speed: loop.pace, distance: Infinity }];
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
    const random = this.random, rider = {
      appearance: walkerAppearance(Math.floor(random() * 0x7fffffff), stop.district), size: .9 + random() * .22, width: .92 + random() * .16,
      speed: 1.1 + random() * .7, phase: random() * 6.3, twist: random() * .7 - .15,
      legs: [], from: null, at: this.time, x: 0, s: 0, heading: null, pace: 0, face: 0, spot: -1, hidden: false, gone: false, held: null,
    };
    // (their own pace is that of the stop's walk, which they share with its residents)
    if (stop.loop?.pace) rider.speed = stop.loop.pace;
    return rider;
  }
  // Someone takes a free spot at the stop, walking there from where they
  // are (at once, with nowhere given), and waits facing the road, turned a
  // little up it, where the bus comes from. Someone who missed the bus
  // (`back`) always finds a spot.
  wait(stop, state, rider, from = null, back = false) {
    // (the free spot furthest from where they come in: taking the first,
    // they walked straight through whoever stood at the spots before theirs)
    const free = stop.spots.map((_, i) => i).filter(i => !state.waiting.some(other => other.spot === i));
    // (someone standing there from the start takes theirs as if they had come the way arrivals do)
    const gate = stop.gates.find(each => each.end === -(stop.loop?.direction ?? 1)) ?? stop.gates[0], come = from ?? gate?.front;
    const far = i => come ? Math.hypot(stop.spots[i].x - come.x, stop.spots[i].s - come.s) : 0;
    let spot = free.length ? free.reduce((best, i) => far(i) > far(best) + 1e-9 ? i : best) : -1;
    if (!back && (spot < 0 || state.waiting.length >= state.most)) return false;
    if (spot < 0) spot = 0;
    const at = stop.spots[spot] ?? { x: stop.x - stop.nx, s: stop.s - stop.ny };
    rider.spot = spot; rider.face = yawAlong(-stop.nx * Math.cos(rider.twist) + stop.tx * Math.sin(rider.twist), -stop.ny * Math.cos(rider.twist) + stop.ty * Math.sin(rider.twist));
    rider.from = from ?? at; rider.at = rider.held ?? this.time; rider.legs = from ? this.way(stop, from, at).map(to => ({ to, speed: rider.speed })) : [];
    state.waiting.push(rider);
    return true;
  }
  // Someone new walks up along the pavement, the way its walk goes, as far
  // as the shelter's nearer end, and round it to their spot
  arrival(stop, state) {
    const rider = this.person(stop), loop = stop.loop, turn = loop.direction ?? 1;
    let distance = 15 + this.random() * 20;
    // (which way they came was the next draw: the walk's way now)
    this.random();
    const gate = stop.gates.find(each => each.end === -turn) ?? stop.gates[0];
    if (!gate) return;
    // (no nearer anyone on the walk than GAP: a little further back up it)
    distance += this.hold(loop, gate.phase - distance * turn, this.time) * loop.pace;
    const phase = gate.phase - distance * turn;
    if (!this.wait(stop, state, rider, gate.front)) return;
    this.join(loop, rider, phase, this.time);
    const start = walkPose({ loop, phase, direction: turn }, 0);
    rider.from = { x: start.x, s: start.s };
    rider.legs.unshift({ loop, phase, direction: turn, speed: loop.pace, distance }, { to: gate.front, speed: rider.speed });
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
