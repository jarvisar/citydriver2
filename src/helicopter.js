import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stableShadowDepth } from './world/shadow-depth.js';
import { clamp } from './world/route.js';
import { collisionImpulse, leadingPoint, rock, rockFrom, SCENERY_SURFACE } from './impact.js';
import { footprintContact, roofUnder } from './collision.js';
import { propTop } from './loose-props.js';

// The garage's one machine that leaves the road: a small bubble-canopy
// helicopter, flown on the driving controls plus climb and descend. It is an
// arcade toy, not a flight model: it holds its height hands off, turns on the
// spot, banks and dips for show, and sets down on streets and flat roofs.
//
// The footprint (width, length) is the fuselage and tail boom, which is what
// bumps into buildings and traffic; the rotor passes over them. `rotor` is
// the main rotor's radius. Like the specials' shapes, `eye` seats the
// first-person camera and `chaseLift` raises the chase camera over the rotor,
// and `door` (meters ahead of the middle) and `seat` (meters up) are where
// someone climbs in and out (see OnFoot).
export const HELICOPTER_SHAPE = { name: 'helicopter', width: 2.3, length: 7.3, eye: [.3, 1.72, -2.5], chaseLift: 1.4, rotor: 4.2, door: 1.7, seat: .9 };

// The mast, which the body tilts and banks about: in car space, nose to -z.
const MAST = new THREE.Vector3(0, 1.6, -1.35);
// (the bubble is lighter than a car's glass: that much of it read as a black ball)
const DARK = '#2b3434', CHROME = '#bfc4b9', GLASS = '#4d737c';

// Faceted parts in the road cars' manner, merged by material. Paint takes the
// garage color; `details` carry their own. Everything is placed in car space
// and moved to hang from `pivot` (the mast here; the plane has its own).
// A category is a list of parts to merge, started by the first part put in it.
export function partsKit(pivot = MAST) {
  const parts = {};
  const add = (geometry, category, color) => {
    geometry.deleteAttribute('uv');
    if (color) {
      const tint = new THREE.Color(color), colors = [];
      for (let i = 0; i < geometry.attributes.position.count; i++) colors.push(tint.r, tint.g, tint.b);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    (parts[category] ??= []).push(geometry);
  };
  const place = (geometry, [x, y, z], category, color) => { geometry.translate(x - pivot.x, y - pivot.y, z - pivot.z); add(geometry, category, color); };
  return {
    parts, add, place,
    box(size, location, category = 'paint', color) { place(new THREE.BoxGeometry(...size), location, category, color); },
    // A tube from one point to another, thinner at the far end if asked
    rod(from, to, radius, category, color, end = radius) {
      const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), along = b.clone().sub(a);
      const geometry = new THREE.CylinderGeometry(end, radius, along.length(), 8);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize()));
      place(geometry, a.add(b).multiplyScalar(.5).toArray(), category, color);
    },
    // A box whose corners `corner(x, y, z)` places in car space, from the
    // signs (±1) of the corner it is
    solid(corner, category = 'paint', color) {
      const geometry = new THREE.BoxGeometry(2, 2, 2), position = geometry.attributes.position;
      for (let i = 0; i < position.count; i++) position.setXYZ(i, ...corner(position.getX(i), position.getY(i), position.getZ(i)));
      geometry.computeVertexNormals(); place(geometry, [0, 0, 0], category, color);
    },
    // The cabin: one egg, glass over paint. A sphere with its pole tipped
    // `tilt` toward the nose is glass within `glass` of its `rings` of the
    // pole, so the glass comes down to the chin and back over the crown, and
    // paint below; its back half is drawn out, narrowed and lifted into the
    // boom, and its belly flattened at `floor` under the middle. Painted
    // frames run down the middle of the glass, from the roof to the chin, and
    // over it where the doors begin, a hoop tipped back `door` from the pole.
    pod({ centre: [cx, cy, cz], radii: [rx, ry], front, back, taper, rise, tilt, rings, glass, floor, door }) {
      const cos = Math.cos(tilt), sin = Math.sin(tilt), cut = Math.PI * glass / rings;
      // (a point of the upright unit sphere, in car space)
      const at = (x, y, z) => {
        [y, z] = [y * cos + z * sin, z * cos - y * sin];
        const t = Math.max(0, z), narrow = 1 - taper * t * t;
        return new THREE.Vector3(cx + x * narrow * rx, cy + Math.max((y * narrow + rise * t * t) * ry, -floor), cz + z * (t ? back : front));
      };
      for (const [geometry, color] of [
        [new THREE.SphereGeometry(1, 12, glass, 0, Math.PI * 2, 0, cut), GLASS],
        [new THREE.SphereGeometry(1, 12, rings - glass, 0, Math.PI * 2, cut, Math.PI - cut), null],
      ]) {
        const position = geometry.attributes.position;
        for (let i = 0; i < position.count; i++) position.setXYZ(i, ...at(position.getX(i), position.getY(i), position.getZ(i)).toArray());
        geometry.computeVertexNormals(); place(geometry, [0, 0, 0], color ? 'details' : 'paint', color);
      }
      // Each frame stands proud of the glass along a curve on it, and sinks
      // into it far enough to meet the facets
      const middle = new THREE.Vector3(cx, cy, cz), width = .035, proud = .018, points = [];
      const triangle = (a, b, c, out) => {
        const n = b.clone().sub(a).cross(c.clone().sub(a));
        points.push(...a.toArray(), ...(n.dot(out) < 0 ? [c, b] : [b, c]).flatMap(v => v.toArray()));
      };
      const quad = (a, b, c, d, out) => { triangle(a, b, c, out); triangle(a, c, d, out); };
      const strip = (curve, sunk) => {
        const stations = curve.map((p, k) => {
          const along = curve[Math.min(k + 1, curve.length - 1)].clone().sub(curve[Math.max(k - 1, 0)]).normalize();
          const out = p.clone().sub(middle), side = new THREE.Vector3();
          out.addScaledVector(along, -out.dot(along)).normalize(); side.crossVectors(along, out).multiplyScalar(width);
          const edge = (sign, lift) => p.clone().addScaledVector(out, lift).addScaledVector(side, sign);
          return { out, along, side, top: [edge(-1, proud), edge(1, proud)], foot: [edge(-1, -sunk), edge(1, -sunk)] };
        });
        stations.forEach((a, k) => {
          const b = stations[k + 1];
          if (!k) quad(a.top[0], a.top[1], a.foot[1], a.foot[0], a.along.clone().negate());
          if (!b) { quad(a.top[0], a.top[1], a.foot[1], a.foot[0], a.along); return; }
          quad(a.top[0], a.top[1], b.top[1], b.top[0], a.out.clone().add(b.out));
          quad(a.top[0], b.top[0], b.foot[0], a.foot[0], a.side.clone().negate());
          quad(a.top[1], b.top[1], b.foot[1], a.foot[1], a.side);
        });
      };
      strip(Array.from({ length: glass * 2 + 1 }, (_, k) => at(0, Math.cos(k * cut / glass - cut), Math.sin(k * cut / glass - cut))), .012);
      strip(Array.from({ length: 13 }, (_, k) => at(Math.cos(k * Math.PI / 12), Math.sin(k * Math.PI / 12) * Math.cos(door), Math.sin(k * Math.PI / 12) * Math.sin(door))), .06);
      const frame = new THREE.BufferGeometry();
      frame.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      frame.setIndex([...Array(points.length / 3).keys()]);
      frame.computeVertexNormals(); place(frame, [0, 0, 0], 'paint');
    },
  };
}

// A flat painted plate, tapering and swept: its root chord (from, to) at one
// end and its tip chord at the other, `thick` through. `fin` stands up the
// middle, from the root at height `root[2]` to the tip at `tip[2]`; `plane`
// spans out sideways, at height `y`, from x = `root[2]` to x = `tip[2]`. (The
// lower end takes the box's lower corners, so a plate hanging down or out to
// the left is not turned inside out.)
const fin = (solid, root, tip, thick) => solid((sx, sy, sz) => {
  const [from, to, height] = (sy < 0) === (root[2] < tip[2]) ? root : tip;
  return [sx * thick / 2, height, sz < 0 ? from : to];
});
const plane = (solid, root, tip, y, thick) => solid((sx, sy, sz) => {
  const [from, to, across] = (sx < 0) === (root[2] < tip[2]) ? root : tip;
  return [across, y + sy * thick / 2, sz < 0 ? from : to];
});

function build({ box, rod, solid, pod }) {
  // Skids on splayed struts, turned up at the front
  for (const side of [-1, 1]) {
    rod([side * 1.05, .055, .55], [side * 1.05, .055, -2.85], .055, 'details', DARK);
    rod([side * 1.05, .055, -2.85], [side * 1.05, .3, -3.2], .055, 'details', DARK);
    rod([side * 1.05, .06, -2.3], [side * .5, 1, -2.15], .045, 'details', DARK);
    rod([side * 1.05, .06, -.2], [side * .38, 1.26, -1.2], .045, 'details', DARK);
  }
  // The cabin, with the engine inside its tail, and its exhaust under the boom
  pod({ centre: [0, 1.5, -2.2], radii: [.8, .8], front: 1.3, back: 1.75, taper: .35, rise: .35, tilt: .87, rings: 10, glass: 5, floor: .72, door: 1.05 });
  rod([0, 1.52, -.8], [0, 1.47, -.3], .075, 'details', DARK);
  // The mast out of a fairing along the cabin roof, highest at the mast and
  // falling away onto the boom, and the hub
  for (const [front, rear] of [[[-2, .24, 2.27], [-1.3, .26, 2.42]], [[-1.3, .26, 2.42], [-.3, .15, 2.06]]]) {
    solid((x, y, z) => { const [at, half, top] = z < 0 ? front : rear; return [x * half * (y < 0 ? 1 : .6), y < 0 ? 1.95 : top, at]; });
  }
  rod([0, 2.35, -1.35], [0, 2.78, -1.35], .07, 'details', DARK);
  box([.34, .14, .34], [0, 2.78, -1.35], 'details', CHROME);
  // The tail: a tapering boom, a swept tailplane and fin, and a lower fin that
  // guards the rotor, which turns on a gearbox on the right
  rod([0, 1.78, -.9], [0, 1.96, 3.55], .22, 'paint', null, .09);
  for (const side of [-1, 1]) plane(solid, [2.78, 3.2, 0], [2.98, 3.2, side * .7], 1.9, .05);
  fin(solid, [3.0, 3.7, 1.9], [3.5, 3.85, 2.9], .07);
  fin(solid, [3.3, 3.7, 2], [3.55, 3.72, 1.42], .06);
  box([.18, .14, .2], [.1, 2.05, 3.5], 'details', DARK);
  rod([.18, 2.05, 3.5], [.24, 2.05, 3.5], .07, 'details', CHROME);
  // Anti-collision beacons, on the fin and under the belly
  box([.1, .1, .16], [0, 2.94, 3.74], 'beacon');
  box([.14, .08, .16], [0, .77, -2], 'beacon');
  // The rotors, which turn: two main blades through the hub and the tail pair
  box([8.4, .045, .26], [0, 2.84, -1.35], 'rotor', DARK);
  box([.36, .07, .36], [0, 2.84, -1.35], 'rotor', CHROME);
  box([.035, 1.28, .11], [.22, 2.05, 3.5], 'tail', DARK);
}

export function createHelicopter(entry) {
  const kit = partsKit();
  build(kit);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, flatShading: true, ...extra });
  const paint = mat(entry.paint), trim = mat('#ffffff', { vertexColors: true });
  const beacon = mat('#8e2a22', { emissive: '#e8261a', emissiveIntensity: .35 });
  // A faint disc where the blades blur, only while the rotor is up to speed
  const discMaterial = new THREE.MeshBasicMaterial({ color: '#1f2a2c', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const shells = Object.fromEntries(Object.entries(kit.parts).map(([key, geometries]) => [key, mergeGeometries(geometries)]));
  for (const geometries of Object.values(kit.parts)) for (const geometry of geometries) geometry.dispose();

  const car = new THREE.Group(); car.name = 'car-helicopter';
  const body = new THREE.Group(); body.position.copy(MAST); car.add(body);
  const mesh = (geometry, material, parent = body) => {
    const part = new THREE.Mesh(geometry, material);
    part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
  };
  mesh(shells.paint, paint); mesh(shells.details, trim); mesh(shells.beacon, beacon);
  // The rotors turn about their own hubs, so each is re-centered on its pivot
  const rotor = new THREE.Group(), tail = new THREE.Group();
  rotor.position.set(0, 2.84 - MAST.y, 0); tail.position.set(.22, 2.05 - MAST.y, 3.5 - MAST.z);
  shells.rotor.translate(0, -rotor.position.y, 0); shells.tail.translate(-tail.position.x, -tail.position.y, -tail.position.z);
  mesh(shells.rotor, trim, rotor); mesh(shells.tail, trim, tail); body.add(rotor, tail);
  const discGeometry = new THREE.CircleGeometry(HELICOPTER_SHAPE.rotor, 28).rotateX(-Math.PI / 2);
  const disc = new THREE.Mesh(discGeometry, discMaterial); disc.position.copy(rotor.position); disc.visible = false; body.add(disc);
  car.traverse(stableShadowDepth);
  return {
    car, body, wheels: [],
    nightLights: [{ material: beacon, day: .35, night: 2.6 }],
    rotors: { rotor, tail, disc },
    applyTrim() {},
    paintCar(color) { paint.color.set(color || entry.paint); },
    disposeModel() {
      for (const geometry of [...Object.values(shells), discGeometry]) geometry.dispose();
      for (const material of [paint, trim, beacon, discMaterial]) material.dispose();
    },
  };
}

// How it flies. Speeds in m/s, rates in 1/s, heights in meters.
//   CLIMB, SINK      vertical speed with climb or descend held
//   LIFT, LOW        a pedal on the ground lifts it at LIFT to LOW, so W takes off
//   FLARE            descending, it slows to FLARE m/s per meter left, so it sets down gently
//   YAW, YAW_FAST    turn rate at a hover and at full speed
//   SIDE             how fast a sideways slide is taken back into the travel
//   HOVER            how fast it slows with neither pedal held
//   BACKWARD         the speed it backs up at
//   SKIDS            friction on the ground
//   STEP             the highest a roof or curb can be above the skids to be set down on;
//                    anything higher is a wall
//   AIRBORNE         above the street by this much it clears traffic, people, walls and
//                    railings; furniture it clears only over its top
//   WATER            the least it hovers over water
//   CEILING          its highest, over the road
//   IDLE             the rotor's share of full speed while it sits on the ground
//   SETTLE, STILL    setting down by itself (see `land` in update): how fast it comes
//                    down, and how fast it takes the way off. High up it drops
//                    faster, SETTLE_HIGH at most, easing to SETTLE by SETTLE_HIGH /
//                    SETTLE_SLOPE m over what it lands on, so E from high up
//                    isn't ten seconds of waiting
//   WASH             how high over the ground its downwash kicks up dust or spray
const CLIMB = 8, SINK = 9, LIFT = 3, LOW = 1.2, FLARE = 2.2, VERTICAL = 3.5;
const YAW = 1.9, YAW_FAST = 1.1, YAW_EASE = 5, SIDE = 1.6, HOVER = .45, BACKWARD = 12, SKIDS = 4;
const STEP = .7, AIRBORNE = 2.5, WATER = 1.2, CEILING = 120, IDLE = .3, SPOOL = 1.5, SETTLE = 6.5, SETTLE_HIGH = 15, SETTLE_SLOPE = .5, STILL = 1.2, WASH = 8;
// How tall it stands, skids to rotor, for going under a bridge; a deck a
// little too low to pass under (by no more than DUCK) it ducks under at DUCKING m/s
const TOP = 3, DUCK = 1.2, DUCKING = 10;
// Setting down by itself over the water, how high over it it climbs before
// making for the shore: over the quay, and the lamps and trusses on a bridge
// (a lamp's head is 14 m over the water)
const SHORE = 16;
// Where it stands: the skids' ends (across, along) from the middle of the footprint
const FEET = [[0, 0], [-1.05, 2.85], [1.05, 2.85], [-1.05, -.55], [1.05, -.55]];
// A touchdown faster than this (m/s) thumps; one faster than HARD shakes it
const TOUCHDOWN = .6, HARD = 5;
// A blow this hard (m/s) is a crash, as a car's is (see vehicle.js): the pad rumbles
const TOUCH = 1, CRASH = 6;

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// Bridge piers are kept out of the colliders (a car on the deck above would
// hit them), so the flying machines check them here. `box()` is the
// footprint, as sceneryContacts takes it.
export function meetPiers(pilot, box) {
  const v = pilot.vehicle, p = v.groundedPosition;
  for (const chunk of v.scenery?.values() ?? []) for (const pier of chunk?.features?.piers ?? []) {
    if (pilot.y >= pier.top || Math.abs(pier.x - p.x) > pier.reach + 12 || Math.abs(pier.z - p.z) > pier.reach + 12) continue;
    const contact = footprintContact(box(), pier);
    if (contact) pilot.resolveSceneryCollision(contact.x, contact.z, contact.depth, contact.point);
  }
}

// How far to look for a street from far out at sea (see landward and Walker.ashore)
export const SEA_REACH = 4000;

// Setting down by itself over the water, a flying machine (`pilot`, with
// `vehicle` and `time`) makes for the nearest street first: the way to it,
// looked up again once a second, or null with no street near
export function landward(pilot) {
  const v = pilot.vehicle, seek = pilot.seeking ??= { at: -Infinity, heading: null };
  if (pilot.time - seek.at < 1 && seek.at <= pilot.time) return seek.heading;
  seek.at = pilot.time;
  // (far out at sea no street is within the usual reach: look further)
  let lane = v.route.nearestLane?.(v.s, v.u, v.heading);
  if (lane && Math.hypot(lane.s - v.s, lane.u - v.u) < 1) lane = v.route.nearestLane(v.s, v.u, v.heading, SEA_REACH);
  const ds = lane ? lane.s - v.s : 0, du = lane ? lane.u - v.u : 0;
  seek.heading = Math.hypot(ds, du) > 1 ? Math.atan2(du, ds) : null;
  return seek.heading;
}

// Setting down by itself under a bridge, it first flies out from under the
// deck, the shortest way to open water (the way ashore climbs to clear the
// quay, and under a deck that pinned it to the deck). Looked up again once a
// second, null when it is not under one.
function outFromUnder(pilot) {
  const v = pilot.vehicle, seek = pilot.unbridging ??= { at: -Infinity, heading: null };
  if (pilot.time - seek.at < 1 && seek.at <= pilot.time) return seek.heading;
  seek.at = pilot.time; seek.heading = null;
  let nearest = Infinity;
  for (let k = 0; k < 16; k++) {
    const heading = k / 16 * Math.PI * 2, ds = Math.cos(heading), du = Math.sin(heading);
    for (let d = 2; d < nearest && d <= 80; d += 2) {
      const s = v.s + ds * d, u = v.u + du * d;
      if (v.route.under?.(s, u)) continue;
      if (v.route.water?.(s, u)) { nearest = d; seek.heading = heading; }
      break;
    }
  }
  return seek.heading;
}

// The pilot: DrivingController hands it the controls while the helicopter is
// the chosen car (see vehicle.js). It keeps the controller's shared state
// (s, u, heading, speed, groundedPosition, poses, telemetry) up to date, so
// the traffic, the furniture, the maps and the cameras need not know it flies.
// `groundedPosition` is where the skids are, however high.
export class Helicopter {
  constructor(vehicle, rotors) {
    this.vehicle = vehicle; this.rotors = rotors;
    this.vx = 0; this.vz = 0; this.vy = 0; this.y = NaN; this.below = NaN;
    this.power = IDLE; this.angle = 0; this.tilt = 0; this.bank = 0; this.landed = true;
    this.blocked = false; this.feet = FEET.map(() => ({ x: 0, z: 0 }));
    // (the street right under it, and whether that is water, as `floor` last found them)
    this.ground = NaN; this.water = false;
    // Flown by nobody (someone bailed out, see OnFoot): it sets itself down
    // and, down, its rotor winds to a stop. (When the downwash last kicked
    // something up, and what it has to tell the player: see drain.)
    this.unmanned = false; this.time = 0; this.washed = 0; this.events = [];
    // How long it has been up this time (a landing on a roof after a flight is worth a word, as the plane's is)
    this.aloft = 0;
  }
  get velocity() { return { x: this.vx, z: this.vz }; }
  // Its height over what is under it
  get height() { return this.y - this.below; }
  // Down on its skids with the rotor stopped: left, it is parked
  get settled() { return this.landed && Math.hypot(this.vx, this.vz) < .3 && this.power < .05; }
  drain() { const events = this.events; this.events = []; return events; }
  // Stop dead where it is, holding its height
  stop() { this.vx = this.vz = this.vy = 0; }
  // Stop and set down on whatever is under it (a reset)
  land() { this.stop(); this.y = NaN; }
  // Taking over from a car: moving as it was, on the ground where it was
  takeOver(heading, speed, y) {
    const v = this.vehicle;
    this.vx = Math.sin(heading) * speed; this.vz = -Math.cos(heading) * speed; this.y = this.below = y;
    this.floor(v.s, v.u, heading, Infinity);
  }
  // What it would stand on at (s, u) facing `heading`, no higher than `below`:
  // the street under each skid end, lifted clear of any water, or a roof
  // there. `blocked` says whether the street under a skid is higher than
  // that: it has run into a quay or a bridge's side, a wall. Low enough
  // under a bridge's deck, the water is under it and the deck a ceiling
  // (`ceiling`, the highest it can be; `bridged`, under one now).
  floor(s, u, heading, below) {
    const route = this.vehicle.route, cos = Math.cos(heading), sin = Math.sin(heading), feet = this.feet;
    let floor = -Infinity, centre = 0;
    this.blocked = false; this.ceiling = Infinity;
    for (let i = 0; i < FEET.length; i++) {
      const [across, along] = FEET[i], fs = s - across * sin + along * cos, fu = u + across * cos + along * sin;
      const deck = route.under?.(fs, fu), under = Boolean(deck) && this.y + TOP <= deck.lid + DUCK;
      const height = under ? deck.water : route.height(fs, fu), water = under || Boolean(route.water?.(fs, fu)), street = water ? height + WATER : height;
      if (under) this.ceiling = Math.min(this.ceiling, deck.lid - TOP);
      if (!i) { centre = street; this.ground = height; this.water = water; this.bridged = under; }
      if (street > below) this.blocked = true; else floor = Math.max(floor, street);
      const p = this.vehicle.route.position(fs, fu, 0); feet[i].x = p.x; feet[i].z = p.z;
    }
    const scenery = this.vehicle.scenery;
    if (scenery) floor = Math.max(floor, roofUnder(scenery.values(), feet, below, true));
    // (standing inside the ground, as only a teleport leaves it, it comes up)
    return floor === -Infinity ? centre : floor;
  }
  // Whether it clears a standing thing (see collideScenery): over a
  // building's roof or the top of a piece of furniture (a tree it breaks,
  // like the truck, however high in the crown it meets it), or, for
  // anything else, high enough over the street. Anything standing on a
  // bridge it is under is over its head (going in, its nose meets the
  // railing along the deck's edge before its middle is under the deck).
  passes(solid) {
    if (solid.top !== undefined) return this.y >= (solid.ridge ?? solid.top) - STEP;
    if ((solid.base ?? this.vehicle.route.height(-solid.z, solid.x)) > this.y + TOP) return true;
    if (solid.prop) return this.y >= propTop(solid);
    return this.vehicle.airborne;
  }
  update(dt, input) {
    const v = this.vehicle, stats = v.stats, telemetry = v.audioTelemetry;
    v.copyPose(v.previousPose, v.currentPose);
    this.time += dt;
    let forward = clamp(Number(input.forward) || 0, 0, 1), back = clamp(Number(input.brake) || 0, 0, 1);
    let steering = clamp((Number(input.right) || 0) - (Number(input.left) || 0), -1, 1);
    let climb = clamp(Number(input.climb) || 0, 0, 1), descend = clamp(Number(input.descend) || 0, 0, 1);
    // An overhead view's stick points where to go: turn that way, and go once facing it
    const touch = input.touchDrive;
    if (touch) {
      const off = touch.amount ? wrap(touch.heading - v.heading) : 0;
      steering = clamp(off * 2.5, -1, 1); forward = touch.amount * clamp(1 - Math.abs(off) / 1.2, 0, 1); back = 0;
    }
    // Setting down by itself (see OnFoot's landing, and one left flying):
    // straight down, taking the way off as it goes, or over the water off to
    // the nearest street first
    const landing = Boolean(input.land) || this.unmanned, out = landing && this.bridged ? outFromUnder(this) : null;
    const seek = landing && this.water && out === null ? landward(this) : null;
    if (landing) { forward = back = steering = climb = 0; descend = 1; }
    if (out !== null) {
      const off = wrap(out - v.heading);
      steering = clamp(off * 2, -1, 1); forward = clamp(1 - Math.abs(off), 0, 1) * .5; descend = 0;
    } else if (seek !== null) {
      const off = wrap(seek - v.heading), clear = this.y - this.ground > SHORE;
      steering = clamp(off * 2, -1, 1); forward = clear ? clamp(1 - Math.abs(off), 0, 1) * .5 : 0; descend = 0; climb = clear ? 0 : 1;
    }
    if (!Number.isFinite(this.y)) this.y = this.below = this.floor(v.s, v.u, v.heading, Infinity);
    const active = forward || back || climb || descend || steering;
    // The rotor idles on the ground and spools up for flight; lift waits on it.
    // Left down on its own, it winds to a stop.
    const rotor = this.landed && this.unmanned ? 0 : this.landed && !active ? IDLE : 1;
    this.power = dt ? THREE.MathUtils.damp(this.power, rotor, SPOOL, dt) : this.power;
    if (!rotor && this.power < .02) this.power = 0;
    const spooled = clamp((this.power - IDLE) / (1 - IDLE), 0, 1);
    // Turning: brisk at a hover, wider at speed, and eased in and out
    const top = stats.topSpeed, speed = Math.hypot(this.vx, this.vz), share = clamp(speed / top, 0, 1);
    const yaw = steering * (YAW + (YAW_FAST - YAW) * share) * (.4 + .6 * spooled), headingBefore = v.heading;
    v.yawRate = dt ? THREE.MathUtils.damp(v.yawRate, yaw, YAW_EASE, dt) : v.yawRate;
    v.heading += (v.yawRate + v.knock.spin) * dt;
    v.knock.spin *= Math.exp(-dt * 4);
    // Along and across the way it faces
    const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    let along = this.vx * fx + this.vz * fz, across = this.vx * rx + this.vz * rz;
    const push = forward * stats.acceleration - back * (along > .5 ? stats.braking : stats.acceleration * .6);
    along += push * dt;
    // The air holds it to its top speed, and with neither pedal it slows to a hover
    along -= Math.sign(along) * stats.acceleration * (along / top) ** 2 * dt;
    if (!forward && !back) along *= Math.exp(-(landing ? STILL : HOVER) * dt);
    along = clamp(along, -BACKWARD, top);
    // A slide sideways is carried round into the travel, as a banked turn does
    const slid = across;
    across *= Math.exp(-SIDE * dt);
    if (Math.abs(along) > 2 && !landing) along = Math.sign(along) * Math.sqrt(along * along + .8 * (slid * slid - across * across));
    if (this.landed) { const grip = Math.exp(-SKIDS * dt); along *= grip; across *= grip; }
    this.vx = along * fx + across * rx; this.vz = along * fz + across * rz;
    // Up and down: held height hands off, a flare near the ground, a ceiling.
    // (the height is over what it stood on at the end of the last step)
    const height = this.y - this.below;
    let lift = climb > descend ? climb * CLIMB : -descend * (landing ? THREE.MathUtils.clamp(height * SETTLE_SLOPE, SETTLE, SETTLE_HIGH) : SINK);
    if ((forward || back) && !descend && height < LOW && !this.water) lift = Math.max(lift, LIFT);
    if (lift > 0) lift *= spooled * clamp((CEILING - (this.y - this.ground)) / 12, 0, 1);
    this.vy = dt ? THREE.MathUtils.damp(this.vy, lift, VERTICAL, dt) : this.vy;
    this.vy = Math.max(this.vy, -(FLARE * Math.max(0, height) + .8));
    this.y += this.vy * dt;
    // Move, unless the ground ahead rises into it (a quay seen from the water,
    // a bridge's side): then keep whichever half of the move stays clear, or
    // failing that stay put, turned back if the turn is what met it
    const fromS = v.s, fromU = v.u, limit = this.y + STEP;
    v.shift(this.vx * dt, this.vz * dt);
    let floor = this.floor(v.s, v.u, v.heading, limit);
    if (this.blocked) {
      const toU = v.u;
      v.u = fromU; floor = this.floor(v.s, v.u, v.heading, limit);
      if (this.blocked) { v.s = fromS; v.u = toU; floor = this.floor(v.s, v.u, v.heading, limit); }
      if (this.blocked) { v.u = fromU; floor = this.floor(v.s, v.u, v.heading, limit); }
      if (this.blocked) { v.heading = headingBefore; v.yawRate = 0; floor = this.floor(v.s, v.u, v.heading, limit); }
      this.vx *= .5; this.vz *= .5;
    }
    this.below = floor;
    if (this.water) meetPiers(this, () => ({ x: v.groundedPosition.x, z: v.groundedPosition.z, heading: v.heading, halfWidth: v.spec.width / 2, halfLength: v.spec.length / 2 }));
    // (under a bridge, no higher than its deck, and out from under it, a word)
    if (this.y > this.ceiling) { this.y = Math.max(this.ceiling, this.y - DUCKING * dt); this.vy = Math.min(0, this.vy); }
    if (this.wasBridged && !this.bridged && dt && !this.unmanned) this.events.push({ kind: 'stunt', text: 'Under the bridge' });
    this.wasBridged = this.bridged;
    // Setting down: on the ground the skids hold it, and a hard landing thumps.
    // Over the water it only hovers.
    const wasLanded = this.landed, water = this.water;
    if (this.y <= floor + .02 && this.vy <= 0 || this.y < floor) {
      const touchdown = -this.vy;
      this.y = floor; this.vy = Math.max(0, this.vy);
      if (dt && !wasLanded && !water && touchdown > TOUCHDOWN) {
        telemetry.bump = Math.min(.5, touchdown * .05); telemetry.bumpSerial++;
        if (touchdown > HARD) this.strike(0, 0, 0, touchdown - HARD + TOUCH);
        v.jolt.pitchRate -= touchdown * .03;
      }
    }
    this.landed = this.y === floor && !water;
    if (this.landed && !wasLanded && dt && this.aloft > 3 && !this.unmanned && floor > this.ground + 1) this.events.push({ kind: 'landing', text: 'Rooftop landing' });
    this.aloft = this.landed ? 0 : this.aloft + dt;
    v.airborne = this.y - this.ground > AIRBORNE;
    v.distance += Math.hypot(v.s - fromS, v.u - fromU);
    rock(v.jolt, dt);
    // For show: the nose dips as it pulls ahead and lifts as it slows, and it
    // banks into turns. Sitting on its skids it stays level.
    const after = this.vx * fx + this.vz * fz;
    const surge = dt ? (Math.hypot(this.vx, this.vz) - speed) / dt * Math.sign(after) : 0;
    const tilt = this.landed ? 0 : clamp(surge * .012 + after / top * .07, -.2, .24);
    const bank = this.landed ? 0 : clamp(v.yawRate * (Math.max(0, after) * .011 + .08), -.4, .4);
    if (dt) { this.tilt = THREE.MathUtils.damp(this.tilt, tilt, 4, dt); this.bank = THREE.MathUtils.damp(this.bank, bank, 4, dt); }
    this.angle += this.power * 26 * dt;
    // Low down, the downwash blows dust off the street, or spray off the water
    const wash = this.power > .6 && dt ? (1 - clamp((this.y - this.below) / WASH, 0, 1)) * (this.power - .6) / .4 : 0;
    if (wash > .05 && this.time - this.washed > .16 - wash * .1) this.downwash(wash);
    // The controller's state, as the rest of the game reads it
    v.speed = after; v.slideHeading = v.heading; v.steer = 0; v.slip = 0;
    v.drifting = false; v.boosting = false; v.driftAmount = 0; v.weight = 0; v.load = 0;
    v.bodyPitch = -this.tilt; v.bodyRoll = -this.bank; v.wheelSpin = this.angle;
    v.pitch = 0; v.roll = 0;
    // (the chase camera widens with speed, looks down the higher it flies, and
    // swings back behind once it moves)
    v.car.userData.speedRush = clamp((speed / top - .4) / .6, 0, 1); v.car.userData.speed = speed;
    v.car.userData.chaseDip = clamp((this.y - this.ground - 6) / 40, 0, 1);
    // (and under a bridge the chase camera keeps under its deck too)
    v.car.userData.lid = this.bridged ? this.ceiling + TOP : null;
    v.trauma = Math.max(0, v.trauma - dt * 1.4); v.car.userData.trauma = v.trauma;
    telemetry.speed = speed; telemetry.throttle = Math.max(forward, back, climb, descend * .4, Math.abs(steering) * .3);
    telemetry.brake = 0; telemetry.offRoad = 0; telemetry.handbrake = 0; telemetry.boost = 0;
    telemetry.rotor = this.power;
    telemetry.scrape *= Math.exp(-dt * 14);
    if (dt === 0) telemetry.impact = 0;
    this.pose(dt === 0);
  }
  // Dust off the street (spray in the wet), or spray off the water, blown
  // out in a ring under it
  downwash(strength) {
    const v = this.vehicle, props = v.props, p = v.groundedPosition;
    this.washed = this.time;
    if (!props?.bits) return;
    // (off the water itself, not the height it hovers at over it)
    const kind = this.water ? 'spray' : props.underfoot ?? 'dust', from = this.water ? this.ground : this.below;
    props.bits.burst(kind, p.x, from + .05, p.z, this.vx * .3, this.vz * .3, kind === 'spray' ? 5 : 2, 1.5 + strength * 2, 2.6);
  }
  // Where it stands now, for the controller's poses and the scene
  pose(teleport = false) {
    const v = this.vehicle, p = v.route.position(v.s, v.u, this.y);
    v.groundedPosition.set(p.x, p.y, p.z); v.car.position.copy(v.groundedPosition);
    v.car.rotation.set(0, -v.heading, 0, 'YXZ');
    v.currentPose.position.copy(v.groundedPosition); v.currentPose.quaternion.copy(v.car.quaternion);
    for (const key of ['bodyPitch', 'bodyRoll', 'wheelSpin', 'steer', 'slip']) v.currentPose[key] = v[key];
    v.currentPose.bodyPitch += v.jolt.pitch; v.currentPose.bodyRoll += v.jolt.roll;
    if (teleport) v.copyPose(v.previousPose, v.currentPose);
    v.render(0);
  }
  // Turning the rotors (from DrivingController.render, with the interpolated angle)
  animate(angle) {
    const { rotor, tail, disc } = this.rotors;
    rotor.rotation.y = angle; tail.rotation.x = angle * 2.3;
    const blur = Math.max(0, this.power - .55) / .45;
    disc.visible = blur > 0; disc.material.opacity = blur * .14;
  }
  // A blow, as DrivingController.strike takes one: a change of velocity, of
  // turn, how hard they met and how fast they slid past
  strike(dvx, dvz, spin, impact, scrape = 0) {
    const v = this.vehicle, telemetry = v.audioTelemetry;
    if (impact > TOUCH) {
      telemetry.impact = impact; telemetry.impactSerial++;
      v.trauma = Math.min(1, v.trauma + (impact - TOUCH) / 28);
      if (impact >= CRASH) telemetry.crashSerial++;
    }
    telemetry.scrape = Math.max(telemetry.scrape, scrape);
    this.vx += dvx; this.vz += dvz;
    v.knock.spin = clamp(v.knock.spin + spin, -3, 3);
    const cos = Math.cos(v.heading), sin = Math.sin(v.heading);
    rockFrom(v.jolt, dvx * sin - dvz * cos, dvx * cos + dvz * sin);
  }
  // A building's wall, a tree or a post: it bounces off, as a car does
  resolveSceneryCollision(nx, nz, depth, point = null) {
    const v = this.vehicle, car = v.motion(), normal = { x: nx, z: nz };
    point ??= leadingPoint(car, normal);
    const blow = collisionImpulse(car, { x: point.x, z: point.z, vx: 0, vz: 0, mass: Infinity }, normal, point, SCENERY_SURFACE);
    if (blow) this.strike(blow.a.x, blow.a.z, blow.a.spin, blow.closing, blow.slide);
    v.shift(nx * (depth + .005), nz * (depth + .005));
    this.pose();
  }
}
