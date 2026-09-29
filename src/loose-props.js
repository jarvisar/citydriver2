import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { surfaceAt, ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL } from './world/city-route.js';
import { MEDIAN_KERB } from './world/city-medians.js';
import { collisionImpulse } from './impact.js';
import { stableShadowDepth } from './world/shadow-depth.js';

// Street furniture a car can knock loose, the way the arcade driving games
// did it: Crazy Taxi's benches and phone boxes fly off the bonnet by their
// weight and the taxi's momentum, GTA's lamp posts give way at the foot and
// fall, and Midtown Madness put its uprooted meters and mailboxes back once
// the player had gone. A piece that comes loose is a small rigid body, its own
// model drawn instanced, standing on a few dozen points of its surface: it
// falls, bounces, tumbles and slides until it lies still, and a car that
// meets it again shoves it on. It stays where it lands until the player is
// well away, then goes back where it stood. The car loses speed by what the
// piece weighs against it (see impact.js), so a bin barely checks it and a
// lamp post takes a bite. Railings and the heavy pieces stand firm, and
// trees and shelters give way only to a car that breaks them (see
// CityChunk.knockable and breaks).

// Each kind: what it weighs in a blow, in tonnes against a car's heft (a lamp
// post's breakaway foot makes it lighter than it looks); the closing speed
// (m/s) below which it stands firm; whether it `topples` from its foot rather
// than flying off; how far a bumper `lifts` it; its bounce off the ground;
// the sound it makes; and the bits it sheds.
const KINDS = {
  lamp: { mass: .3, firm: 5, topples: true, lift: .25, bounce: .2, sound: 'metal', bits: 'glass' },
  lantern: { mass: .12, firm: 4, topples: true, lift: .25, bounce: .2, sound: 'metal', bits: 'glass' },
  signal: { mass: .18, firm: 4, topples: true, lift: .25, bounce: .2, sound: 'metal', bits: 'glass' },
  mast: { mass: .45, firm: 6, topples: true, lift: .25, bounce: .15, sound: 'metal', bits: 'glass' },
  sign: { mass: .05, firm: 3, topples: true, lift: .3, bounce: .25, sound: 'metal' },
  bench: { mass: .08, firm: 0, lift: .3, bounce: .2, sound: 'wood', bits: 'wood' },
  bin: { mass: .03, firm: 0, lift: .45, bounce: .35, sound: 'bin', bits: 'litter' },
  table: { mass: .05, firm: 0, lift: .3, bounce: .3, sound: 'light' },
  chair: { mass: .01, firm: 0, lift: .5, bounce: .3, sound: 'light' },
  stall: { mass: .35, firm: 2, lift: .15, bounce: .15, sound: 'wood', bits: 'fruit' },
  // The kerbside fittings (see placeStreetFurniture). A hydrant snapped off
  // its stump sprays a jet of water a while (see spout)
  hydrant: { mass: .12, firm: 6, topples: true, lift: .2, bounce: .15, sound: 'metal', bits: 'splash' },
  // (a post box spills its letters as it goes: `spill` bursts the bits at the knock, as for what does not topple)
  'post-box': { mass: .16, firm: 5, topples: true, lift: .2, bounce: .15, sound: 'metal', bits: 'litter', spill: true },
  cabinet: { mass: .12, firm: 3, topples: true, lift: .25, bounce: .2, sound: 'metal', bits: 'litter' },
  'news-boxes': { mass: .06, firm: 0, lift: .4, bounce: .3, sound: 'bin', bits: 'litter' },
  'bike-rack': { mass: .06, firm: 2, lift: .3, bounce: .25, sound: 'light' },
  // A pedestrian a car meets (see person): scooped off their feet, they
  // tumble, land and slide to a stop, then get up (see PedestrianContacts)
  person: { mass: .07, firm: 0, lift: .45, bounce: .1, sound: 'thud' },
  // Stand firm unless the player drives a car that `breaks` them (see this.breaks),
  // and then give way at any speed, so they have no `firm`
  tree: { mass: 1.4, topples: true, lift: .25, bounce: .1, sound: 'wood', bits: 'leaves', only: true },
  shelter: { mass: .6, lift: .35, bounce: .15, sound: 'metal', bits: 'glass', only: true },
};
// A little heavier than real, so flung furniture does not hang in the air
const GRAVITY = 13;
// Loose pieces go back where they stood once the player is this far off, as
// the parked cars do (see CityTraffic), and no car stands there; and no more
// than this many are loose at once, the furthest going back first
const RETURN = 150, MOST = 80;
// A broken hydrant sprays this long (s), this many drops a second, and no more than this many at once
const SPOUT = 7, SPRAY = 40, SPOUTS = 2;
// A pedestrian's body nobody has drawn for this long (their fare taken, or
// their block streamed out) is put away, so nothing unseen lies in the road
const UNSEEN = 4;
// The ground is never higher than a median's kerb, so a point above it needs no lookup
const TOP = ROAD_LEVEL + MEDIAN_KERB + .01;
// Friction: the ground under a sliding piece, a car's bumper dragging one
// along, and its roof, which something landing on it slides off
const GRIP = 1, DRAG = .4, SLICK = .08;
// Below this a piece lands, or is pushed, without bouncing (as in impact.js)
const REST = 1.5;
// How high a bumper meets what it hits, and how high a car's body reaches
// when it does not say (see Vehicle.spec); and someone on foot, from just
// over their feet to their head
const BUMPER = .45, ROOF = 1.5, FEET = .05, TALL = 1.75;
// A blow felt in the car counts for this much more in its thud and shake
const FELT = 1.5;
// A post knocked over snaps at its foot and starts to fall at this many rad/s
// for each m/s of the blow, at least TOPPLE_LEAST, and never so fast that
// its foot would leave the ground (its weight has to hold the foot down, so a
// tall lamp post falls slower than a short sign); its foot slides on at this
// share of the blow (up to 2.5 m/s), and it leans this much away from the
// car's path. A car that meets it as it falls pushes it, as any piece (see contact).
const TOPPLE = .1, TOPPLE_LEAST = .9, SLIDE = .1, OUTWARD = .6;
// A piece flung off a bumper is swept this much aside, and pops up at most this fast (m/s)
const ASIDE = .5, POP = 3.5;
// The air slows a flying piece this much a second, and each hard landing
// scuffs off this share of its speed along the ground
const AIR = .3, SCUFF = .2;
// and rolling on the ground takes this much a second off it
const ROLL = 1;
// A post meets a car as a body of its weight (see impact.js): a little bounce, some scrape
const PROP_SURFACE = { bounce: .2, friction: .4 };
// A loose piece looks again for what stands near it once it has moved this far (m)
const NEAR = 2;
// Two pieces meeting slower than this (m/s) leave one lying still where it
// lies; they are parted by at most this much (m) a step, and no nearer than SLOP
const WAKE = .6, PART = .2, SLOP = .01;
// A piece this heavy (tonnes: a lamp post, not a sign) meeting a parked car
// faster than this (m/s) knocks it loose (see wall)
const HEAVY = .2, KNOCKS = 1.5;
// The traffic brakes for pieces this heavy (tonnes) lying in its way, and
// shoves lighter ones aside; each is this many of its points to it (see lying)
const SHOVED = .05, SPREAD = 8;
// Someone on foot, tried against a piece's parts: points round their outline
// (unit directions), at their shins, waist and chest (m over their feet)
const OUTLINE = Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4), Math.sin(k * Math.PI / 4)]), OUTLINE_HEIGHTS = [.15, .7, 1.3];
// How far behind a piece a wall is looked for, to tell whether a car's push
// would drive it into one, and how far from where it is pushed (see pinned);
// and the fastest (m/s) a car can go and be only pushing a piece
const PIN = .1, BEHIND = .8, PUSHED = 3;
// A piece in a car or a wall is put out of it a point at a time, the deepest
// first, up to this many a step (a post fallen across a roof, or a tree's
// crown against a wall, has several points in it)
const PASSES = 3;
// A car's body stands this high off the road (m): what lies lower, a fallen
// post, a sign, passes under it, and is driven over rather than shoved on;
// and its roof and bonnet fall away this much (m) to its sides, so what
// lands on them slides off rather than riding along
const CLEARANCE = .2, CROWN = .2;
// A piece a car pushes, or pushes through other pieces, that a wall or a
// parked car puts straight back (within 60° of the way the car pushes it)
// this many steps running is jammed (see squeeze); only by a car that
// outweighs it this many times over
const SQUEEZED = 2, JAMS = 2;
// Standing furniture gives way to a car at its `firm` speed, or slower to a
// heavier car: at the same push (speed times heft) as a car this heavy
// (the taxi's heft), so a truck crawling along a pavement snaps the lamps
const FIRM_HEFT = 2;

const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
const r = new THREE.Vector3(), pv = new THREE.Vector3(), rel = new THREE.Vector3(), n = new THREE.Vector3(), slip = new THREE.Vector3();
const J = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), foot = new THREE.Vector3(), landing = new THREE.Vector3();
const spin = new THREE.Quaternion(), inverse = new THREE.Quaternion(), frame = new THREE.Matrix4(), matrix = new THREE.Matrix4();
const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), white = new THREE.Color(1, 1, 1);

// A model's shape, for the ground and a car to push on: points spread over its
// surface (every edge walked in short steps, then the point furthest from
// those taken so far, until none is more than a third of its size, and at
// most .45 m, from one, or 56 are taken: a chair keeps all four feet),
// about its centre of mass (the middle of that surface); and its turning
// inertia per tonne, as a box its size.
const shapes = new WeakMap();
// How high a piece of standing furniture reaches (the world height of its
// top: a tree's crown, a lamp's head), worked out once, for the helicopter
// to fly over it or into it
const topBox = new THREE.Box3(), topFrame = new THREE.Matrix4(), topBase = new THREE.Matrix4();
export function propTop(collider) {
  const prop = collider.prop;
  if (prop.top === undefined) {
    prop.matrix(topBase); prop.top = -Infinity;
    for (const piece of prop.pieces) {
      const geometry = piece.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      topFrame.copy(topBase); if (piece.at) topFrame.multiply(piece.at);
      prop.top = Math.max(prop.top, topBox.copy(geometry.boundingBox).applyMatrix4(topFrame).max.y);
    }
  }
  return prop.top;
}
function shapeOf(geometry) {
  if (shapes.has(geometry)) return shapes.get(geometry);
  if (geometry.userData.contact) return contactShape(geometry);
  const position = geometry.attributes.position, index = geometry.index?.array, count = index ? index.length : position.count;
  const vertex = i => index ? index[i] : i, a = new THREE.Vector3(), b = new THREE.Vector3(), samples = [];
  for (let t = 0; t + 2 < count; t += 3) for (let e = 0; e < 3; e++) {
    a.fromBufferAttribute(position, vertex(t + e)); b.fromBufferAttribute(position, vertex(t + (e + 1) % 3));
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / .1));
    for (let k = 0; k < steps; k++) samples.push(a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps, a.z + (b.z - a.z) * k / steps);
  }
  const total = samples.length / 3, com = new THREE.Vector3(), low = new THREE.Vector3(Infinity, Infinity, Infinity), high = low.clone().negate();
  for (let i = 0; i < total; i++) { a.fromArray(samples, i * 3); com.add(a); low.min(a); high.max(a); }
  com.divideScalar(total);
  const nearest = new Float32Array(total).fill(Infinity), chosen = [], spacing = Math.min(.45, high.distanceTo(low) / 6);
  let pick = 0, far = -1;
  for (let i = 0; i < total; i++) {
    const d = (samples[i * 3] - com.x) ** 2 + (samples[i * 3 + 1] - com.y) ** 2 + (samples[i * 3 + 2] - com.z) ** 2;
    if (d > far) { far = d; pick = i; }
  }
  while (chosen.length < 56) {
    chosen.push(pick); far = 0;
    const x = samples[pick * 3], y = samples[pick * 3 + 1], z = samples[pick * 3 + 2];
    for (let i = 0; i < total; i++) {
      const d = (samples[i * 3] - x) ** 2 + (samples[i * 3 + 1] - y) ** 2 + (samples[i * 3 + 2] - z) ** 2;
      if (d < nearest[i]) nearest[i] = d;
      if (nearest[i] > far) { far = nearest[i]; pick = i; }
    }
    if (far < spacing ** 2) break;
  }
  const points = new Float32Array(chosen.length * 3);
  let radius = 0;
  chosen.forEach((i, k) => {
    points[k * 3] = samples[i * 3] - com.x; points[k * 3 + 1] = samples[i * 3 + 1] - com.y; points[k * 3 + 2] = samples[i * 3 + 2] - com.z;
    radius = Math.max(radius, Math.hypot(points[k * 3], points[k * 3 + 1], points[k * 3 + 2]));
  });
  const size = high.clone().sub(low), shape = {
    points, com, size, radius, height: size.y, parts: partsOf(geometry, com),
    inertia: new THREE.Vector3((size.y ** 2 + size.z ** 2) / 12, (size.x ** 2 + size.z ** 2) / 12, (size.x ** 2 + size.y ** 2) / 12),
  };
  shapes.set(geometry, shape);
  return shape;
}
// A model that gives its own points to stand on (`userData.contact`, a person:
// see walkerContact), about their middle
function contactShape(geometry) {
  const given = geometry.userData.contact, com = new THREE.Vector3(), a = new THREE.Vector3();
  const low = new THREE.Vector3(Infinity, Infinity, Infinity), high = low.clone().negate();
  for (let i = 0; i < given.length; i += 3) { a.fromArray(given, i); com.add(a); low.min(a); high.max(a); }
  com.divideScalar(given.length / 3);
  const points = new Float32Array(given.length);
  let radius = 0;
  for (let i = 0; i < given.length; i += 3) {
    a.fromArray(given, i).sub(com); a.toArray(points, i);
    radius = Math.max(radius, a.length());
  }
  const size = high.clone().sub(low), shape = {
    points, com, size, radius, height: size.y, parts: partsOf(geometry, com),
    inertia: new THREE.Vector3((size.y ** 2 + size.z ** 2) / 12, (size.x ** 2 + size.z ** 2) / 12, (size.x ** 2 + size.y ** 2) / 12),
  };
  shapes.set(geometry, shape);
  return shape;
}
// A model's solid parts, for other loose pieces to meet it (see meet). The
// furniture is built of simple solids (a pole, an arm, a lamp's head, a
// chair's legs and seat), merged but not joined, so each separate part (its
// triangles joined by shared corners) is nearly convex: its convex hull
// stands for it, as the planes of its faces about the centre of mass (an
// outward normal and how far out along it the face lies, four numbers
// each), within a sphere ({ x, y, z, r }) that turns most points away first.
// (One hull round the whole piece would fill in a lamp's arm and a cafe
// parasol's shade.) Null if it has none.
function partsOf(geometry, com) {
  const position = geometry.attributes.position, index = geometry.index?.array, count = index ? index.length : position.count;
  // (corners welded where parts of one solid meet, then joined triangle by triangle)
  const weld = new Map(), parent = [], corners = [], at = new THREE.Vector3();
  const corner = i => {
    at.fromBufferAttribute(position, index ? index[i] : i);
    const key = `${Math.round(at.x * 1e4)},${Math.round(at.y * 1e4)},${Math.round(at.z * 1e4)}`;
    if (!weld.has(key)) { weld.set(key, corners.length); parent.push(corners.length); corners.push(at.clone().sub(com)); }
    return weld.get(key);
  };
  const root = k => { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
  for (let t = 0; t + 2 < count; t += 3) {
    const a = corner(t), b = corner(t + 1), c = corner(t + 2);
    parent[root(a)] = root(b); parent[root(b)] = root(c);
  }
  const groups = new Map();
  corners.forEach((p, k) => { const r = root(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  const parts = [];
  for (const points of groups.values()) {
    let hull;
    try { hull = new ConvexHull().setFromPoints(points); } catch { continue; }
    if (!hull.faces.length) continue;
    // (each face once: a box's faces come as pairs of triangles)
    const planes = [];
    for (const face of hull.faces) {
      const { x, y, z } = face.normal, c = face.constant;
      let same = false;
      for (let k = 0; k < planes.length && !same; k += 4) same = planes[k] * x + planes[k + 1] * y + planes[k + 2] * z > .9999 && Math.abs(planes[k + 3] - c) < 1e-4;
      if (!same) planes.push(x, y, z, c);
    }
    const middle = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    const r = Math.sqrt(Math.max(...points.map(p => p.distanceToSquared(middle))));
    parts.push({ x: middle.x, y: middle.y, z: middle.z, r, planes: new Float32Array(planes) });
  }
  return parts.length ? parts : null;
}

// A shape scaled by `s` (a Vector3), for a piece drawn scaled
function scaledShape(unit, s) {
  const points = unit.points.slice();
  for (let i = 0; i < points.length; i += 3) { points[i] *= s.x; points[i + 1] *= s.y; points[i + 2] *= s.z; }
  const size = unit.size.clone().multiply(s);
  // (a face n · p = c of the unit shape is (n / s) · (s p) = c scaled)
  const parts = unit.parts?.map(part => {
    const planes = part.planes.slice();
    for (let i = 0; i < planes.length; i += 4) {
      const x = planes[i] / s.x, y = planes[i + 1] / s.y, z = planes[i + 2] / s.z, length = Math.hypot(x, y, z);
      planes[i] = x / length; planes[i + 1] = y / length; planes[i + 2] = z / length; planes[i + 3] /= length;
    }
    return { x: part.x * s.x, y: part.y * s.y, z: part.z * s.z, r: part.r * Math.max(s.x, s.y, s.z), planes };
  }) ?? null;
  return {
    points, com: unit.com.clone().multiply(s), size, radius: unit.radius * Math.max(s.x, s.y, s.z), height: size.y, parts,
    inertia: new THREE.Vector3((size.y ** 2 + size.z ** 2) / 12, (size.x ** 2 + size.z ** 2) / 12, (size.x ** 2 + size.y ** 2) / 12),
  };
}

// The ground under a point: a pavement, a median's kerb or the road, and
// none (NaN) over the water
export function level(x, z) {
  const surface = surfaceAt(-z, x);
  return surface === 'pavement' ? PAVEMENT_LEVEL : surface === 'median' ? ROAD_LEVEL + MEDIAN_KERB : surface === 'water' ? NaN : ROAD_LEVEL;
}

// How far a point (x, z) stands inside a collider, and the way out of it:
// { x, z, depth }, or null outside. The way out is through the nearest
// face; or, for a point that was outside at (fromX, fromZ) a step ago,
// back through the face it came in by, so nothing flung at a railing or a
// thin wall comes out the far side of it.
const way = { x: 0, z: 0, depth: 0 };
function inside(solid, x, z, fromX = NaN, fromZ = NaN) {
  const dx = x - solid.x, dz = z - solid.z;
  if (!solid.corners && solid.heading === undefined) {
    const d = Math.hypot(dx, dz);
    if (d >= solid.reach) return null;
    // (come in from outside, it goes back out the side it came in at)
    const fx = fromX - solid.x, fz = fromZ - solid.z, from = Math.hypot(fx, fz), back = from >= solid.reach;
    const ux = back ? fx / from : d > 1e-6 ? dx / d : 1, uz = back ? fz / from : d > 1e-6 ? dz / d : 0;
    way.depth = solid.reach - (dx * ux + dz * uz); way.x = ux; way.z = uz;
    return way;
  }
  // (each face as a way out along its normal: how far in the point is, and was)
  let entered = -Infinity;
  way.depth = Infinity;
  const face = (ex, ez, reach) => {
    const d = reach - (dx * ex + dz * ez);
    if (d <= 0) return false;
    const was = reach - ((fromX - solid.x) * ex + (fromZ - solid.z) * ez);
    // (crossed coming in: the last such face is the one it came in by)
    if (was <= 0) {
      const t = was / (was - d);
      if (t > entered) { entered = t; way.depth = d; way.x = ex; way.z = ez; }
    } else if (entered === -Infinity && d < way.depth) { way.depth = d; way.x = ex; way.z = ez; }
    return true;
  };
  if (solid.corners) {
    const corners = solid.corners;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length], length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-8) continue;
      // (the edge's normal, turned out from the middle)
      let ex = (b.z - a.z) / length, ez = -(b.x - a.x) / length;
      if (ex * ((a.x + b.x) / 2 - solid.x) + ez * ((a.z + b.z) / 2 - solid.z) < 0) { ex = -ex; ez = -ez; }
      if (!face(ex, ez, (a.x - solid.x) * ex + (a.z - solid.z) * ez)) return null;
    }
    return way;
  }
  const cos = Math.cos(solid.heading), sin = Math.sin(solid.heading);
  for (const side of [1, -1]) if (!face(side * cos, side * sin, solid.halfWidth) || !face(side * sin, -side * cos, solid.halfLength)) return null;
  return way;
}

// A body's turn for a twist `torque` (world), through its inertia, into `out`
function turnBy(body, torque, out) {
  inverse.copy(body.q).invert();
  out.copy(torque).applyQuaternion(inverse);
  const inertia = body.shape.inertia, mass = body.kind.mass;
  return out.set(out.x / (inertia.x * mass), out.y / (inertia.y * mass), out.z / (inertia.z * mass)).applyQuaternion(body.q);
}
// How far a unit blow along `dir` at `at` (from its centre) changes that point's speed along `dir`
function give(body, at, dir) {
  turnBy(body, t1.crossVectors(at, dir), t1);
  return 1 / body.kind.mass + t2.crossVectors(t1, at).dot(dir);
}
// (a light piece clipped off-centre would otherwise spin like a propeller)
const SPIN_MOST = 20;
function impulse(body, at, blow) {
  body.v.addScaledVector(blow, 1 / body.kind.mass);
  body.w.add(turnBy(body, t1.crossVectors(at, blow), t1)).clampLength(0, SPIN_MOST);
}
const velocityAt = (body, at, out) => out.crossVectors(body.w, at).add(body.v);
// How deep a point (x, y, z) is inside a car's body (0 or less outside it):
// its footprint, from CLEARANCE over the road (or its `floor`) up to its
// height there along its length (its `profile`, see carProfile, else its
// `height` all along), less its CROWN toward its sides. `exit` is the way
// out: through the nearest side, the nearest end at that height (over the
// bonnet, a piece leaves forward past the windscreen's foot, not the
// bumper), or up through the top, leaning out the way the crown falls.
const exit = { x: 0, z: 0, roof: false };
function inBody(car, x, y, z) {
  const up = y - car.y;
  if (up < (car.floor ?? CLEARANCE)) return 0;
  const cos = Math.cos(car.heading), sin = Math.sin(car.heading), dx = x - car.x, dz = z - car.z;
  const across = dx * cos + dz * sin, along = dx * sin - dz * cos, beside = car.halfWidth - Math.abs(across);
  if (beside <= 0 || Math.abs(along) >= car.halfLength) return 0;
  // (as high over the crown's fall at this point)
  const profile = car.profile, over = up + CROWN * Math.abs(across) / car.halfWidth;
  let top, ahead, behind;
  if (profile) {
    const heights = profile.heights, n = heights.length, slice = profile.slice, tail = -profile.length / 2;
    const k = Math.min(n - 1, Math.max(0, Math.floor((along - tail) / slice)));
    top = heights[k] - over;
    if (top <= 0) return 0;
    let f = k + 1, b = k - 1;
    while (f < n && heights[f] > over) f++;
    while (b >= 0 && heights[b] > over) b--;
    ahead = Math.min(car.halfLength, tail + f * slice) - along; behind = along - Math.max(-car.halfLength, tail + (b + 1) * slice);
  } else {
    top = car.height - over;
    if (top <= 0) return 0;
    ahead = car.halfLength - along; behind = car.halfLength + along;
  }
  const d = Math.min(beside, ahead, behind, top);
  exit.roof = d === top;
  // (up through the top, leaning out as the crown falls there)
  if (exit.roof) { const slope = Math.sign(across) * CROWN / car.halfWidth; exit.x = slope * cos; exit.z = slope * sin; }
  else if (d === beside) { const s = Math.sign(across) || 1; exit.x = s * cos; exit.z = s * sin; }
  else { const s = ahead <= behind ? 1 : -1; exit.x = s * sin; exit.z = -s * cos; }
  return d;
}
// How deep a loose piece is in a car's body, as contact finds it (see inBody)
export function pieceInCar(body, car) {
  const points = body.shape.points;
  let deepest = 0;
  for (let i = 0; i < points.length; i += 3) {
    t1.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(body.q);
    deepest = Math.max(deepest, inBody(car, body.p.x + t1.x, body.p.y + t1.y, body.p.z + t1.z));
  }
  return deepest;
}
// How far two pieces overlap: the deepest point of either inside a part of
// the other (m), or 0
export function overlap(a, b) {
  const reach = a.shape.radius + b.shape.radius;
  if (!a.shape.parts || !b.shape.parts || a.p.distanceToSquared(b.p) > reach * reach) return 0;
  return Math.max(deepestIn(a, b).depth, deepestIn(b, a).depth);
}
// The deepest of `body`'s points inside one of `other`'s parts (see
// partsOf): `depth` (0 if none is), the point (from body's centre, in the
// world) `at`, and the way out through that part's nearest face (in the world) `n`.
// With `entry`, a point that was outside a step ago goes back out the face it
// came in by instead, as against a wall: a person falling onto a bench went
// more than halfway through a 6.5 cm slat in a step and out underneath.
const depthIn = { depth: 0, at: new THREE.Vector3(), n: new THREE.Vector3() }, found = { depth: 0, at: new THREE.Vector3(), n: new THREE.Vector3() };
const into = new THREE.Quaternion(), turned = new THREE.Quaternion(), offset = new THREE.Vector3(), local = new THREE.Vector3(), outerAt = new THREE.Vector3(), middle = new THREE.Vector3();
const wasTurned = new THREE.Quaternion(), wasOffset = new THREE.Vector3(), was = new THREE.Vector3();
function deepestIn(body, other, entry = false) {
  const parts = other.shape.parts, points = body.shape.points, reach = other.shape.radius ** 2;
  into.copy(other.q).invert(); turned.copy(into).multiply(body.q);
  offset.copy(body.p).sub(other.p).applyQuaternion(into);
  if (entry) {
    into.copy(other.last.q).invert(); wasTurned.copy(into).multiply(body.last.q);
    wasOffset.copy(body.last.p).sub(other.last.p).applyQuaternion(into);
  }
  let deepest = 0, best = -1, planes = null, face = -1;
  for (let i = 0; i < points.length; i += 3) {
    local.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(turned).add(offset);
    if (local.lengthSq() > reach) continue;
    for (const part of parts) {
      if ((local.x - part.x) ** 2 + (local.y - part.y) ** 2 + (local.z - part.z) ** 2 > part.r * part.r) continue;
      const faces = part.planes;
      let out = -Infinity, nearest = -1;
      for (let k = 0; k < faces.length; k += 4) {
        const d = faces[k] * local.x + faces[k + 1] * local.y + faces[k + 2] * local.z - faces[k + 3];
        if (d > out) { out = d; nearest = k; if (d >= 0) break; }
      }
      if (out >= 0) continue;
      if (entry) {
        // (the face its path crossed last on the way in)
        was.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(wasTurned).add(wasOffset);
        let latest = -1;
        for (let k = 0; k < faces.length; k += 4) {
          const before = faces[k] * was.x + faces[k + 1] * was.y + faces[k + 2] * was.z - faces[k + 3];
          if (before <= 0) continue;
          const now = faces[k] * local.x + faces[k + 1] * local.y + faces[k + 2] * local.z - faces[k + 3], t = before / (before - now);
          if (t > latest) { latest = t; out = now; nearest = k; }
        }
      }
      if (-out <= deepest) continue;
      deepest = -out; best = i; planes = faces; face = nearest;
    }
  }
  depthIn.depth = deepest;
  if (best >= 0) {
    depthIn.at.set(points[best], points[best + 1], points[best + 2]).applyQuaternion(body.q);
    depthIn.n.set(planes[face], planes[face + 1], planes[face + 2]).applyQuaternion(other.q);
  }
  return depthIn;
}

// A burst of small bits off a smash: glass from a lamp's head, splinters,
// litter from a bin, a stall's fruit, a splash. One instanced draw, each bit
// a tiny flat-shaded octahedron that bounces once or twice and shrinks away.
// Puffs of dust or snow are rounder, in a draw of their own while any are about.
const BITS = {
  glass: { colours: ['#e6efe9', '#c4d8d6', '#f3edd5'], size: [.05, .09], shape: [1, .3, 1], count: 10, speed: 3.5, up: 3, life: 1.4 },
  wood: { colours: ['#8a6a45', '#6b5a48', '#a3845c', '#5d4a38'], size: [.1, .18], shape: [1, .22, .3], count: 10, speed: 4, up: 3, life: 2.2 },
  litter: { colours: ['#ebe5d3', '#cfc9b8', '#7fa06f', '#d9b24a', '#b8574a'], size: [.08, .13], shape: [1, .08, .8], count: 12, speed: 3.5, up: 4, life: 3, drag: 2.5 },
  fruit: { colours: ['#c96246', '#d8af51', '#819d4e', '#d58c43'], size: [.1, .13], shape: [1, .9, 1], count: 22, speed: 4.5, up: 3.5, life: 4.5, rolls: true },
  splash: { colours: ['#e3f1f2', '#b4d6d9', '#ffffff'], size: [.07, .14], shape: [1, 1, 1], count: 16, speed: 1.6, up: 5, life: 1.1 },
  // (a broken hydrant's jet, a drop at a time: see spout. A `streak` stays
  // upright and unturned, and is gone where it lands)
  jet: { colours: ['#e3f1f2', '#b4d6d9', '#ffffff', '#cfe6ea'], size: [.1, .17], shape: [.55, 2.6, .55], count: 1, speed: .45, up: 11, life: 1.6, streak: true },
  leaves: { colours: ['#63924d', '#80a85c', '#4f8054', '#93ab65', '#6b5a48'], size: [.1, .18], shape: [1, .12, .7], count: 20, speed: 3, up: 3.5, life: 2.6, drag: 2.2 },
  // Kicked up underfoot (see Walker.puff): dust, or a wet street's spray.
  // A `puff` hangs in the air, swelling as it goes, rather than falling.
  dust: { colours: ['#dcd8cf', '#cfcac0', '#e8e5de'], size: [.16, .26], shape: [1, .8, 1], count: 5, speed: 1.6, up: 1.6, life: .5, puff: true },
  spray: { colours: ['#dbe8eb', '#b9d0d6', '#f2f6f7'], size: [.04, .07], shape: [1, 1, 1], count: 4, speed: .9, up: 2, life: .45 },
};
const BIT_LIMIT = 160, PUFF_LIMIT = 48;
function bitMesh(geometry, material, name, count) {
  geometry.deleteAttribute('uv');
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3));
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) mesh.setColorAt(i, white);
  return mesh;
}
class Bits {
  constructor(group, material) {
    this.mesh = bitMesh(new THREE.OctahedronGeometry(.5), material, 'loose-bits', BIT_LIMIT);
    this.puffs = bitMesh(new THREE.IcosahedronGeometry(.5), material, 'loose-puffs', PUFF_LIMIT);
    this.puffs.visible = false;
    group.add(this.mesh, this.puffs);
    this.list = []; this.colour = new THREE.Color(); this.euler = new THREE.Euler(); this.seed = 1;
  }
  random() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  // `kind` of bits from (x, y, z), carried along at (vx, vz): its own number
  // of them, or `count`, thrown out `spread` times as fast from a ring `ring` m across
  burst(kind, x, y, z, vx = 0, vz = 0, count = BITS[kind].count, spread = 1, ring = 0) {
    const style = BITS[kind], floor = level(x, z);
    let room = style.puff ? PUFF_LIMIT - this.list.filter(bit => bit.style.puff).length : BIT_LIMIT - this.list.filter(bit => !bit.style.puff).length;
    for (let k = 0; k < count && room-- > 0; k++) {
      const a = this.random() * Math.PI * 2, out = style.speed * spread * (.4 + this.random() * .6), size = style.size[0] + this.random() * (style.size[1] - style.size[0]);
      this.list.push({
        style, x: x + Math.cos(a) * ring, y, z: z + Math.sin(a) * ring, floor, vx: vx + Math.cos(a) * out, vy: style.up * (.5 + this.random() * .7), vz: vz + Math.sin(a) * out,
        rx: this.random() * 6, ry: this.random() * 6, rz: this.random() * 6, turn: style.streak ? 0 : (this.random() - .5) * 16,
        size, age: 0, life: style.life * (.7 + this.random() * .5), colour: style.colours[Math.floor(this.random() * style.colours.length)],
      });
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const bit = this.list[i], style = bit.style;
      bit.age += dt;
      if (bit.age > bit.life || (Number.isNaN(bit.floor) && bit.y < WATER_LEVEL - .5)) { this.list[i] = this.list.at(-1); this.list.pop(); continue; }
      // (a puff slows in the air and sinks only a little)
      if (style.puff) { const drag = Math.exp(-dt * 5); bit.vx *= drag; bit.vy *= drag; bit.vz *= drag; bit.turn *= drag; }
      bit.vy -= GRAVITY * (style.puff ? .05 : 1) * dt;
      if (style.drag) { const drag = Math.exp(-dt * style.drag); bit.vx *= drag; bit.vz *= drag; bit.vy = Math.max(bit.vy, -2.5); }
      bit.x += bit.vx * dt; bit.y += bit.vy * dt; bit.z += bit.vz * dt;
      bit.rx += bit.turn * dt; bit.rz += bit.turn * .7 * dt;
      if (bit.y < bit.floor && style.streak) { this.list[i] = this.list.at(-1); this.list.pop(); continue; }
      if (bit.y < bit.floor) {
        bit.y = bit.floor;
        bit.vy = bit.vy < -1.5 ? -bit.vy * .3 : 0;
        const rub = style.rolls ? .92 : .6;
        bit.vx *= rub; bit.vz *= rub; bit.turn *= rub;
      }
    }
  }
  render() {
    const mesh = this.mesh, puffs = this.puffs;
    if (!this.list.length && !mesh.count && !puffs.count) return;
    let bits = 0, puffed = 0;
    for (const bit of this.list) {
      const fade = Math.min(1, (bit.life - bit.age) / .35), [sx, sy, sz] = bit.style.shape, puff = bit.style.puff;
      // (a puff swells as it goes, then shrinks away, turning only a little)
      const size = bit.size * fade * (puff ? .5 + Math.min(1, bit.age / bit.life * 2) * .7 : 1);
      position.set(bit.x, bit.y + size * sy * .5, bit.z);
      if (bit.style.streak) rotation.identity();
      else rotation.setFromEuler(this.euler.set(puff ? bit.rx * .2 : bit.rx, bit.ry, puff ? bit.rz * .2 : bit.rz));
      const target = puff ? puffs : mesh, i = puff ? puffed++ : bits++;
      target.setMatrixAt(i, matrix.compose(position, rotation, scale.set(size * sx, size * sy, size * sz)));
      target.setColorAt(i, this.colour.set(bit.colour));
    }
    mesh.count = bits; puffs.count = puffed; puffs.visible = puffed > 0;
    for (const each of [mesh, puffs]) { each.instanceMatrix.needsUpdate = true; each.instanceColor.needsUpdate = true; }
  }
  clear() { this.list = []; }
}

export class LooseProps {
  // `material`: the street furniture's own (vertex colours, instanced)
  constructor(scene, material) {
    this.group = new THREE.Group(); this.group.name = 'loose-props'; scene.add(this.group);
    this.material = material; this.pools = new Map(); this.bodies = []; this.loose = []; this.people = []; this.alpha = 1;
    // What the player's car breaks (see Vehicle.spec): while they drive it,
    // those kinds give way to anything, at any speed, a car they shove included
    this.breaks = [];
    this.bits = new Bits(this.group, material);
    // What a footstep kicks up with the weather (see Walker.puff): 'dust',
    // or 'spray' off a wet street
    this.underfoot = 'dust';
    // What was heard: { kind, strength (m/s), x, z }, for the sound to take (see DriveAudio)
    this.sounds = [];
    // Told of each piece of furniture knocked loose, by whatever car:
    // `(kinds, point)`, its pieces' kinds and where it was met (see DemolitionRun)
    this.onSmash = null;
    // Hydrants knocked off their stumps, spraying: { x, y, z, left, due }
    this.spouts = [];
  }
  // A car running into standing furniture (`contact` as sceneryContacts
  // gives it, `car` as motion() gives it plus its ground height `y`): null if
  // it stands firm, too heavy for the speed or not built yet; otherwise it
  // comes loose, the piece the car met takes the blow, and the blow the car
  // takes back is returned. The rest of it (a cafe's other chairs) waits for
  // the car to reach them.
  knock(collider, contact, car) {
    const prop = collider.prop;
    if (!prop?.ready || collider.woken) return null;
    const closing = -(car.vx * contact.x + car.vz * contact.z), piece = prop.pieces[0].kind, type = KINDS[piece];
    if (type.only && !this.breaks.includes(piece)) return null;
    if (closing < Math.max(.2, type.only ? 0 : type.firm * Math.min(1, FIRM_HEFT / car.mass))) return null;
    const point = contact.point ?? { x: collider.x, z: collider.z }, bodies = this.loosen(collider);
    const hit = bodies.reduce((a, b) => Math.hypot(a.p.x - point.x, a.p.z - point.z) <= Math.hypot(b.p.x - point.x, b.p.z - point.z) ? a : b), kind = hit.kind;
    const blow = kind.topples ? this.topple(hit, car, contact, point) : this.fling(hit, car, contact, point);
    if (kind.bits && (!kind.topples || kind.spill)) this.bits.burst(kind.bits, hit.p.x, hit.p.y, hit.p.z, hit.v.x * .4, hit.v.z * .4);
    if (piece === 'hydrant') this.spout(collider.x, collider.z);
    this.sound(kind.sound, closing, point.x, point.z);
    this.onSmash?.(prop.pieces.map(each => each.kind), { x: point.x, y: car.y ?? hit.p.y, z: point.z });
    return blow ?? { x: 0, z: 0, spin: 0, closing };
  }
  // Flung off the bumper, a piece is swept a little aside out of the car's
  // path, like a skittle, and pops up no higher than POP
  fling(hit, car, contact, point) {
    const ax = Math.cos(car.heading), az = Math.sin(car.heading), side = Math.sign((hit.p.x - car.x) * ax + (hit.p.z - car.z) * az) || 1;
    let nx = -contact.x + ax * side * ASIDE, nz = -contact.z + az * side * ASIDE;
    const length = Math.hypot(nx, nz); nx /= length; nz /= length;
    // (met on the furniture's own outline, which for a cafe's chair can be
    // a metre off it: the blow lands on the chair's side, not beyond it)
    r.set(point.x - hit.p.x, 0, point.z - hit.p.z);
    const reach = Math.max(hit.shape.size.x, hit.shape.size.z) / 4, off = Math.hypot(r.x, r.z);
    if (off > reach) r.multiplyScalar(reach / off);
    r.y = Math.min(car.y + BUMPER, hit.p.y) - hit.p.y;
    const blow = this.blow(hit, car, r, nx, nz, hit.kind.lift);
    if (blow) { this.tumble(hit, nx, nz, blow.closing); hit.v.y = Math.min(hit.v.y, POP); }
    return blow;
  }
  // A pedestrian (`geometry` drawn by `matrix`, in the world) that `car` (as
  // for knock) has run into: a body in their place, its points scaled to
  // them, flung off the car. Their owner draws it (see PedestrianContacts).
  // Returns { body, blow }, the blow being what the car takes back.
  person(geometry, matrix, car) {
    const body = this.add({ kind: 'person', geometry, person: true }, matrix);
    body.slept = 0; body.unseen = 0; this.people.push(body);
    // Met on the face of the car nearest them
    const cos = Math.cos(car.heading), sin = Math.sin(car.heading), dx = body.p.x - car.x, dz = body.p.z - car.z;
    const across = dx * cos + dz * sin, along = dx * sin - dz * cos, contact = { x: 0, z: 0 };
    if (Math.abs(across) / car.halfWidth > Math.abs(along) / car.halfLength) { contact.x = -(Math.sign(across) || 1) * cos; contact.z = -(Math.sign(across) || 1) * sin; }
    else { contact.x = -(Math.sign(along) || 1) * sin; contact.z = (Math.sign(along) || 1) * cos; }
    const blow = this.fling(body, car, contact, { x: body.p.x, z: body.p.z });
    if (blow) this.sound('thud', blow.closing, body.p.x, body.p.z);
    return { body, blow };
  }
  // Someone leaping from a moving car (see Walker.bail): a body where
  // `matrix` has them, going at `v` and tumbling at `w` (vectors)
  thrown(geometry, matrix, v, w) {
    const body = this.add({ kind: 'person', geometry, person: true }, matrix);
    body.slept = 0; body.unseen = 0; this.people.push(body);
    body.v.copy(v); body.w.copy(w);
    return body;
  }
  // A pedestrian's body put away: they are back on their feet
  release(body) {
    if (body.removed) return;
    body.removed = true; this.remove(body);
    this.people[this.people.indexOf(body)] = this.people.at(-1); this.people.pop();
  }
  // Where a pedestrian's body is drawn from, in the world, between steps as render left it
  personMatrix(body, out) {
    const a = this.alpha;
    position.lerpVectors(body.last.p, body.p, a); rotation.slerpQuaternions(body.last.q, body.q, a);
    position.sub(t1.copy(body.shape.com).applyQuaternion(rotation));
    body.unseen = 0;
    return out.compose(position, rotation, body.scale);
  }
  // The player's car running into standing furniture: true if it gave way,
  // and the car has taken its share of the blow
  hit(collider, contact, player) {
    const blow = this.knock(collider, contact, this.carOf(player));
    if (blow) player.strike(blow.x, blow.z, blow.spin, Math.hypot(blow.x, blow.z) * FELT);
    return Boolean(blow);
  }
  // A loose piece as a car, where its point (x, y, z) meets someone (see
  // PedestrianContacts): headed the way that point is going, as fast, and
  // as heavy as the piece
  motionOf(body, x, y, z) {
    r.set(x - body.p.x, y - body.p.y, z - body.p.z);
    velocityAt(body, r, pv);
    return { x, z, y: y - BUMPER, heading: Math.atan2(pv.x, -pv.z), halfWidth: .3, halfLength: .3, vx: pv.x, vz: pv.z, spin: 0, mass: body.kind.mass };
  }
  // How fast a piece's point (x, y, z) is going, m/s
  speedAt(body, x, y, z) {
    r.set(x - body.p.x, y - body.p.y, z - body.p.z);
    return velocityAt(body, r, pv).length();
  }
  // The player as a body a loose piece meets: their car's body (see
  // inBody), or, on foot, a round one (see Walker) from just over their feet
  // (what is under those they have hopped over) to their head
  carOf(player) {
    const car = player.motion();
    car.y = player.groundedPosition.y; car.height = player.walker ? TALL : player.spec.height ?? ROOF;
    if (player.walker) { car.radius = player.spec.radius; car.floor = FEET; } else car.profile = player.spec.profile;
    car.owner = player;
    this.breaks = player.spec.breaks ?? [];
    return car;
  }
  // A jet of water up out of a hydrant's stump for SPOUT seconds, at most
  // SPOUTS at once (the oldest stops first), SPRAY drops a second
  spout(x, z) {
    const y = level(x, z);
    if (Number.isNaN(y)) return;
    if (this.spouts.length >= SPOUTS) this.spouts.shift();
    this.spouts.push({ x, y: y + .3, z, left: SPOUT, due: 0 });
  }
  // Its bodies take the furniture's place
  loosen(collider) {
    const prop = collider.prop, base = prop.matrix(new THREE.Matrix4());
    prop.bodies = prop.pieces.map(piece => this.add(piece, base));
    collider.woken = true; prop.hide(true); this.loose.push(collider);
    return prop.bodies;
  }
  // Back where it stood
  restore(collider) {
    const prop = collider.prop;
    for (const body of prop.bodies ?? []) this.remove(body);
    prop.bodies = null; collider.woken = false; prop.hide(false);
    this.loose.splice(this.loose.indexOf(collider), 1);
  }
  reset() {
    while (this.loose.length) this.restore(this.loose[0]);
    while (this.people.length) this.release(this.people[0]);
    this.bits.clear(); this.sounds = []; this.spouts = [];
  }
  add(piece, base) {
    const kind = KINDS[piece.kind];
    frame.copy(base); if (piece.at) frame.multiply(piece.at);
    frame.decompose(position, rotation, scale);
    // (a piece drawn scaled, a tree or a person, stands on its points scaled)
    const scaled = Math.abs(scale.x - 1) + Math.abs(scale.y - 1) + Math.abs(scale.z - 1) > 1e-4;
    const shape = scaled ? scaledShape(shapeOf(piece.geometry), scale) : shapeOf(piece.geometry);
    const p = shape.com.clone().applyMatrix4(frame.compose(position, rotation, ONE)), body = {
      piece, kind, shape, p, q: rotation.clone(), v: new THREE.Vector3(), w: new THREE.Vector3(),
      last: { p: p.clone(), q: rotation.clone() }, rest: { p: p.clone(), q: rotation.clone() }, asleep: false, still: 0, awake: 0, grounded: true, sunk: false, splashed: false, clatter: 0, squeezed: 0,
      // Where each point last looked up the ground (x, z) and what it found
      ground: new Float32Array(shape.points.length).fill(NaN),
      // A turn of its own, either way, for a little variety
      jitter: Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453 % 1,
      scale: scaled ? scale.clone() : ONE,
    };
    // (a pedestrian is drawn by their owner, among the other people)
    let pool = piece.person ? { bodies: [], dirty: false } : this.pools.get(piece.geometry);
    if (!pool) this.pools.set(piece.geometry, pool = { geometry: piece.geometry, mesh: null, capacity: 0, bodies: [], dirty: true });
    pool.bodies.push(body); body.pool = pool; pool.dirty = true;
    if (!piece.person && pool.bodies.length > pool.capacity) {
      pool.mesh?.removeFromParent(); pool.mesh?.dispose();
      pool.capacity = Math.max(8, pool.capacity * 2);
      const mesh = pool.mesh = new THREE.InstancedMesh(piece.geometry, this.material, pool.capacity);
      mesh.name = 'loose-prop'; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
      for (let i = 0; i < pool.capacity; i++) mesh.setColorAt(i, white);
      stableShadowDepth(mesh); this.group.add(mesh);
    }
    // (pieces that stood tangled, as a lamp post can in a tree's crown, are
    // left to come apart by themselves: see meetAll)
    for (const other of this.bodies) if (overlap(body, other)) { (body.tangled ??= new Set()).add(other); (other.tangled ??= new Set()).add(body); }
    this.bodies.push(body);
    return body;
  }
  remove(body) {
    for (const other of body.tangled ?? []) other.tangled.delete(body);
    const list = body.pool.bodies;
    list[list.indexOf(body)] = list.at(-1); list.pop(); body.pool.dirty = true;
    this.bodies[this.bodies.indexOf(body)] = this.bodies.at(-1); this.bodies.pop();
  }
  sound(kind, strength, x, z) { if (this.sounds.length < 8) this.sounds.push({ kind, strength, x, z }); }

  // A post knocked over: the car takes the blow as from a body of the post's
  // weight, and the post snaps at its foot and turns over about it, top
  // first, the way the blow went and leaning away from the car's path, while
  // the foot slides on a little. (A post is no javelin: it falls where it
  // stood, however hard the car hit it.)
  topple(body, car, contact, point) {
    const blow = collisionImpulse(car, { x: point.x, z: point.z, heading: 0, halfWidth: .2, halfLength: .2, vx: 0, vz: 0, mass: body.kind.mass }, contact, point, PROP_SURFACE);
    if (!blow) return null;
    const given = Math.hypot(blow.b.x, blow.b.z) || 1, ax = Math.cos(car.heading), az = Math.sin(car.heading);
    const side = Math.sign((body.p.x - car.x) * ax + (body.p.z - car.z) * az) || Math.sign(body.jitter) || 1;
    let dx = blow.b.x / given + ax * side * OUTWARD, dz = blow.b.z / given + az * side * OUTWARD;
    const length = Math.hypot(dx, dz), slide = Math.min(2.5, given * SLIDE); dx /= length; dz /= length;
    const turn = Math.min(.9 * Math.sqrt(GRAVITY / body.shape.com.y), Math.max(TOPPLE_LEAST, given * TOPPLE));
    body.w.set(dz * turn, body.jitter * .6, -dx * turn);
    foot.copy(body.shape.com).applyQuaternion(body.q);
    body.v.crossVectors(body.w, foot).add(t2.set(dx * slide, .5, dz * slide));
    this.wake(body);
    return { x: blow.a.x, z: blow.a.z, spin: blow.a.spin, closing: blow.closing };
  }
  // A piece flung off a bumper tips over the way it goes, top first, and
  // turns a little either way
  tumble(body, dx, dz, speed) {
    const tip = Math.min(4, speed * .15) / Math.max(.8, body.shape.height), turn = body.jitter * Math.min(4, speed * .15);
    body.w.x += dz * tip; body.w.z -= dx * tip; body.w.y += turn;
  }
  // A car and a piece meeting at `at` (from the piece's centre), the car's
  // side facing out along (nx, nz): the piece takes a blow tipped up by `lift`,
  // as a bumper lifts what it hits, and is dragged along as they slide past.
  // Returns the change in the car's velocity and turn, or null if they are
  // already parting.
  blow(body, car, at, nx, nz, lift, drag = DRAG) {
    n.set(nx, lift, nz).normalize();
    const x = body.p.x + at.x, z = body.p.z + at.z, cx = x - car.x, cz = z - car.z;
    velocityAt(body, at, pv);
    rel.set(pv.x - (car.vx - car.spin * cz), pv.y, pv.z - (car.vz + car.spin * cx));
    const closing = rel.dot(n);
    if (closing >= 0) return null;
    const heavy = 1 / car.mass, j = -(1 + (closing < -REST ? body.kind.bounce : 0)) * closing / (give(body, at, n) + heavy);
    J.copy(n).multiplyScalar(j);
    slip.copy(rel).addScaledVector(n, -closing);
    const slide = slip.length();
    if (slide > 1e-4) { slip.divideScalar(slide); J.addScaledVector(slip, -Math.min(slide / (give(body, at, slip) + heavy), drag * j)); }
    impulse(body, at, J);
    this.wake(body);
    const ix = -J.x, iz = -J.z, inertia = car.mass * (car.halfWidth ** 2 + car.halfLength ** 2) / 3;
    return { x: ix / car.mass, z: iz / car.mass, spin: (cx * iz - cz * ix) / inertia, closing: -closing };
  }
  // Anything that moves against a loose piece (`car` as motion() gives one,
  // with its ground height `y`, its `height` and its `profile` along its
  // length, see carProfile), or, with a `radius`, someone on foot from their
  // `floor` up. The deepest of the piece's points inside it is put out
  // (see inBody: through the nearest side, end or top; round someone on
  // foot, straight out from them), and takes the blow there. The way out is
  // shared by weight, as two cars part (see CityTraffic.collidePlayer):
  // `fixed`, a car on its rails, gives no way, nor does a car's roof.
  // Someone on foot is stopped outright by some pieces (see firm); a car
  // never is: a piece it jams against something that will not give is
  // crushed (see squeeze), or someone lying there let under it (`under`, the
  // car's `owner`). Returns what the mover takes back, and its share of the
  // way out (px, pz), or null.
  contact(body, car) {
    const round = car.radius !== undefined, reach = (round ? car.radius : Math.hypot(car.halfWidth, car.halfLength)) + body.shape.radius;
    if (Math.abs(body.p.x - car.x) > reach || Math.abs(body.p.z - car.z) > reach || body.p.y - body.shape.radius > car.y + car.height) {
      if (body.under === car.owner) body.under = null;
      return null;
    }
    const points = body.shape.points;
    let depth = 0, best = -1, nx = 0, nz = 0, roof = false;
    for (let i = 0; i < points.length; i += 3) {
      r.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(body.q);
      const x = body.p.x + r.x, y = body.p.y + r.y, z = body.p.z + r.z;
      if (round) {
        if (y < car.y + car.floor || y > car.y + car.height) continue;
        const dx = x - car.x, dz = z - car.z, distance = Math.hypot(dx, dz), d = car.radius - distance;
        if (d <= depth) continue;
        depth = d; best = i; nx = distance > 1e-6 ? dx / distance : 1; nz = distance > 1e-6 ? dz / distance : 0;
        continue;
      }
      const d = inBody(car, x, y, z);
      if (d <= depth) continue;
      depth = d; best = i; nx = exit.x; nz = exit.z; roof = exit.roof;
    }
    if (best >= 0) r.set(points[best], points[best + 1], points[best + 2]).applyQuaternion(body.q);
    // Someone on foot is narrower than the gaps between a long piece's
    // points (a fallen post's are up to a metre apart), so their outline
    // is also tried against its solid parts (see partsOf)
    if (round && body.shape.parts) {
      into.copy(body.q).invert();
      for (const [x, z] of OUTLINE) for (const up of OUTLINE_HEIGHTS) {
        local.set(car.x + x * car.radius - body.p.x, car.y + up - body.p.y, car.z + z * car.radius - body.p.z).applyQuaternion(into);
        for (const part of body.shape.parts) {
          if ((local.x - part.x) ** 2 + (local.y - part.y) ** 2 + (local.z - part.z) ** 2 > part.r * part.r) continue;
          const faces = part.planes;
          let out = -Infinity, face = -1;
          for (let k = 0; k < faces.length; k += 4) {
            const d = faces[k] * local.x + faces[k + 1] * local.y + faces[k + 2] * local.z - faces[k + 3];
            if (d > out) { out = d; face = k; if (d >= 0) break; }
          }
          if (out >= 0) continue;
          // (out along the ground: over a top they have not stepped)
          offset.set(faces[face], faces[face + 1], faces[face + 2]).applyQuaternion(body.q);
          if (Math.hypot(offset.x, offset.z) < .3) continue;
          // Out through the side their middle is furthest out of, the least way out for
          // their whole outline. The side nearest this one point put someone landing
          // just past a fallen post back over it.
          middle.set(car.x - body.p.x, car.y + up - body.p.y, car.z - body.p.z).applyQuaternion(into);
          let clear = -Infinity, sx = 0, sz = 0;
          for (let k = 0; k < faces.length; k += 4) {
            offset.set(faces[k], faces[k + 1], faces[k + 2]).applyQuaternion(body.q);
            const flat = Math.hypot(offset.x, offset.z);
            if (flat < .3) continue;
            const d = (faces[k] * middle.x + faces[k + 1] * middle.y + faces[k + 2] * middle.z - faces[k + 3]) / flat;
            if (d > clear) { clear = d; sx = offset.x / flat; sz = offset.z / flat; }
          }
          const way = car.radius - clear;
          if (!(way > depth) || clear === -Infinity) continue;
          depth = way; best = 0; nx = -sx; nz = -sz;
          r.set(car.x + x * car.radius - body.p.x, car.y + up - body.p.y, car.z + z * car.radius - body.p.z);
        }
      }
    }
    if (best < 0 || body.under === car.owner) {
      if (best < 0 && body.under === car.owner) body.under = null;
      return null;
    }
    // To someone on foot a piece gives no way at all if it outweighs them
    // (they shove a bin or a chair aside, but lean on a fallen post in vain),
    // or it is someone lying there (they step round them), or it is pinned
    // against a wall the way they push it: they meet it as they would the wall
    const firm = round && (body.piece.person || body.kind.mass > car.mass || this.pinned(body, r, nx, nz, car));
    const share = roof ? 1 : firm ? 0 : car.fixed ? 1 : car.mass / (car.mass + body.kind.mass);
    const away = depth + .01, px = -nx * away * (1 - share), pz = -nz * away * (1 - share);
    if (roof) { body.p.y += away; body.riding = this.steps; }
    else { body.p.x += nx * away * share; body.p.z += nz * away * share; }
    body.pool.dirty = true;
    if (!round && !roof) this.press(body, car, nx, nz);
    if (firm) {
      const at = { x: body.p.x + r.x, z: body.p.z + r.z }, wall = collisionImpulse(car, { ...at, vx: 0, vz: 0, mass: Infinity }, { x: -nx, z: -nz }, at, PROP_SURFACE);
      // (moving off it, their closing speed is less than none: taken as none,
      // the walker took their own speed for the piece's and was knocked flat)
      return { x: wall?.a.x ?? 0, z: wall?.a.z ?? 0, spin: wall?.a.spin ?? 0, closing: wall?.closing ?? car.vx * nx + car.vz * nz, px, pz };
    }
    // A person met by the nose or tail is swept aside off it, as when first
    // hit, rather than pushed on ahead of the car (anything else is pushed
    // straight out: swept off at a slant, furniture looked thrown aside)
    if (body.kind === KINDS.person && !roof && !round) {
      const cos = Math.cos(car.heading), sin = Math.sin(car.heading);
      if (Math.abs(nx * sin - nz * cos) > .9) {
        const side = Math.sign((body.p.x - car.x) * cos + (body.p.z - car.z) * sin) || Math.sign(body.jitter) || 1;
        nx += cos * side * ASIDE * 2; nz += sin * side * ASIDE * 2;
        const length = Math.hypot(nx, nz); nx /= length; nz /= length;
      }
    }
    const blow = roof ? this.blow(body, car, r, nx, nz, 1, SLICK) : this.blow(body, car, r, nx, nz, .3);
    if (!blow) return share < 1 ? { x: 0, z: 0, spin: 0, closing: 0, px, pz } : null;
    blow.px = px; blow.pz = pz;
    return blow;
  }
  // A piece `car` pushes along (nx, nz) this step, itself or through another
  // (see meet), for a wall to find it jammed (see wall)
  press(body, car, nx, nz) {
    if (car.mass < body.kind.mass * JAMS) return;
    body.pressed = car; body.pressedAt = this.steps;
    (body.push ??= { x: 0, z: 0 }).x = nx; body.push.z = nz;
  }
  // A piece jammed between a car and a wall a few steps running is crushed
  // (see crush), rather than holding the car up as the wall would. (A wall
  // pushes back whatever is pushed into it, but only a car keeps on pushing.)
  squeeze() {
    for (const body of this.bodies) {
      if (body.jammed !== this.steps || body.sunk) body.squeezed = 0;
      else if (++body.squeezed >= SQUEEZED) this.crush(body);
    }
  }
  // Jammed, a piece of furniture is crushed, as an arcade game's debris is:
  // it bursts into bits and is gone until it goes back (see restore). Someone
  // knocked down is let under the car instead (see contact), until it has
  // gone over them.
  crush(body) {
    const car = body.pressed;
    body.squeezed = 0;
    if (body.piece.person) { body.under = car.owner; return; }
    this.bits.burst(body.kind.bits ?? 'litter', body.p.x, body.p.y, body.p.z, car.vx * .5, car.vz * .5);
    this.sound(body.kind.sound, Math.max(4, Math.hypot(car.vx, car.vz)), body.p.x, body.p.z);
    body.sunk = true; body.pool.dirty = true;
  }
  // Whether a piece has a wall hard behind it the way (nx, nz) a push at
  // `at` (a point of it, from its centre) would move it, near enough square
  // on (see CityTraffic.pinned): what stands near it (see walls), behind the
  // part pushed (a wall behind a fallen tree's crown only turns it), and not
  // furniture or a parked car, which is no wall to what is pushed into it.
  // Only a car going slowly, or heading into that wall, pins it there: one
  // going by sweeps it along the wall.
  pinned(body, at, nx, nz, car) {
    const near = body.near?.list, points = body.shape.points;
    if (!near?.length) return false;
    const cx = body.p.x + at.x - car.x, cz = body.p.z + at.z - car.z, vx = car.vx - car.spin * cz, vz = car.vz + car.spin * cx, speed = Math.hypot(vx, vz);
    const against = way => way.x * nx + way.z * nz < -.7 && (speed < PUSHED || -(vx * way.x + vz * way.z) > speed * .7);
    // (a wall that has just put it back out, wherever it touched: a bench
    // tipped back against one is pinned by its foot while its top is pushed)
    if (body.walled >= this.steps - 1 && against(body.wall)) return true;
    for (let i = 0; i < points.length; i += 3) {
      t1.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(body.q);
      if ((t1.x - at.x) ** 2 + (t1.z - at.z) ** 2 > BEHIND ** 2) continue;
      const x = body.p.x + t1.x + nx * PIN, z = body.p.z + t1.z + nz * PIN;
      for (const solid of near) {
        if (solid.woken || solid.prop || solid.parked) continue;
        const way = inside(solid, x, z);
        if (way && against(way)) return true;
      }
    }
    return false;
  }
  // Woken, a piece wakes whatever lay still against it, so nothing is left
  // lying on air when what it lay on is knocked away
  wake(body) {
    const was = body.asleep;
    body.asleep = false; body.still = 0; body.awake = 0; body.slept = 0;
    if (was) for (const other of this.bodies) if (other.asleep && !other.sunk && other.p.distanceToSquared(body.p) < (other.shape.radius + body.shape.radius) ** 2) this.wake(other);
  }
  sleep(body) {
    body.asleep = true; body.v.set(0, 0, 0); body.w.set(0, 0, 0);
    body.last.p.copy(body.p); body.last.q.copy(body.q); body.pool.dirty = true;
  }
  // One step of a piece on its own: it falls, turns, lands on its points and
  // bounces off whatever stands in the way, and lies still once it has
  // settled. In the water it sinks.
  step(body, dt, chunks) {
    const { p, q, v, w } = body;
    v.y -= GRAVITY * dt;
    p.addScaledVector(v, dt);
    spin.set(w.x, w.y, w.z, 0).multiply(q);
    q.set(q.x + spin.x * dt / 2, q.y + spin.y * dt / 2, q.z + spin.z * dt / 2, q.w + spin.w * dt / 2).normalize();
    if (p.y < WATER_LEVEL) {
      if (!body.splashed) { body.splashed = true; this.bits.burst('splash', p.x, WATER_LEVEL, p.z); this.sound('splash', -v.y, p.x, p.z); }
      v.multiplyScalar(Math.exp(-dt * 4)); v.y = Math.max(v.y, -1.2); w.multiplyScalar(Math.exp(-dt * 2));
      if (p.y < WATER_LEVEL - 3) { body.sunk = true; body.pool.dirty = true; }
      return;
    }
    this.land(body);
    if (chunks) this.walls(body, chunks);
    // The air wears it down, and on the ground its turn, and its roll (a bin
    // on its side would otherwise roll on down the street). Lying on another
    // piece is lying on the ground (see meet).
    const resting = body.grounded || body.supported;
    body.supported = false;
    w.multiplyScalar(Math.exp(-dt * (resting ? 2.5 : .2)));
    if (!resting) v.multiplyScalar(Math.exp(-dt * AIR));
    else { const roll = Math.exp(-dt * ROLL); v.x *= roll; v.z *= roll; }
    body.awake += dt; body.clatter = Math.max(0, body.clatter - dt);
    // Nearly still on the ground, it stops. It is judged by how far it has
    // gone lately rather than how fast it is going: a piece rocking on a kerb
    // or balanced on a chair's back jitters without getting anywhere. Slow,
    // it is held down, unless it is sinking: a topple starts slow, and held,
    // a post lying on its lamp's arm took seconds to roll off it.
    // (on another piece, it has only just fallen a step's worth onto it again)
    const slow = resting && v.lengthSq() < .25 && w.lengthSq() < .5;
    if (slow && (v.y > -.02 || !body.grounded)) { const hold = Math.exp(-dt * 6); v.multiplyScalar(hold); w.multiplyScalar(hold); }
    // (never asleep on a car's roof: asleep, it would hang there when the car drove off)
    const riding = body.riding >= this.steps - 1, rest = body.rest;
    if (slow && !riding && rest.p.distanceToSquared(p) < .03 ** 2 && rest.q.angleTo(q) < .03) body.still += dt;
    else { rest.p.copy(p); rest.q.copy(q); body.still = 0; }
    if (body.still > .4 || (body.awake > 12 && !riding)) this.sleep(body);
  }
  // Each point that has gone into the ground is lifted out of it and takes a
  // blow there: a bounce, and friction against its slide
  land(body) {
    const { p, q, shape } = body, points = shape.points, ground = body.ground;
    let deepest = 0, hardest = 0;
    body.grounded = false;
    const at = landing;
    for (let i = 0; i < points.length; i += 3) {
      r.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(q);
      const y = p.y + r.y;
      if (y > TOP) continue;
      const x = p.x + r.x, z = p.z + r.z;
      // (looked up again once it has moved 30 cm, and wherever it is no higher
      // over the ground than a kerb: a kerb is a sharp step, and a point that
      // had looked from the road just beyond it sank into the pavement)
      if (y - ground[i + 2] < .2 || !(Math.abs(x - ground[i]) < .3 && Math.abs(z - ground[i + 1]) < .3)) { ground[i] = x; ground[i + 1] = z; ground[i + 2] = level(x, z); }
      // (none over the water; and a piece fallen below a bridge's deck stays below it)
      const depth = ground[i + 2] - y;
      if (!(depth > 0 && depth < 1)) continue;
      body.grounded = true; deepest = Math.max(deepest, depth);
      velocityAt(body, r, pv);
      if (pv.y >= 0) continue;
      hardest = Math.max(hardest, -pv.y);
      J.set(0, -(1 + (-pv.y > REST ? body.kind.bounce : 0)) * pv.y / give(body, r, UP), 0);
      slip.set(pv.x, 0, pv.z);
      const slide = slip.length();
      if (slide > 1e-4) { slip.divideScalar(slide); J.addScaledVector(slip, -Math.min(slide / give(body, r, slip), GRIP * J.y)); }
      impulse(body, r, J);
      if (-pv.y >= hardest) at.set(p.x + r.x, ground[i + 2], p.z + r.z);
    }
    p.y += deepest;
    if (hardest > REST * 2) { const scuff = 1 - SCUFF; body.v.x *= scuff; body.v.z *= scuff; }
    // A post landing flat clangs, and its lamp breaks on the ground
    if (hardest > 3 && !body.clatter) { body.clatter = .25; this.sound(body.kind.sound, hardest * .6, at.x, at.z); }
    if (hardest > 3 && body.kind.topples && body.kind.bits && !body.shed) { body.shed = true; this.bits.burst(body.kind.bits, at.x, at.y, at.z, body.v.x * .3, body.v.z * .3); }
  }
  // Walls, trees, railings, posts and parked cars stand in its way: the
  // deepest of its points inside one is put back out and takes a blow there,
  // so a post falling against a wall slides down it
  walls(body, chunks) {
    const { p, shape } = body;
    // (what stands near it, gathered again once it has moved a couple of metres)
    if (!body.near || Math.abs(p.x - body.near.x) > NEAR || Math.abs(p.z - body.near.z) > NEAR) {
      const reach = shape.radius + NEAR, list = [];
      for (const chunk of chunks.values()) {
        const bounds = chunk.collisionBounds;
        if (!bounds || p.x + reach < bounds.minX || p.x - reach > bounds.maxX || p.z + reach < bounds.minZ || p.z - reach > bounds.maxZ) continue;
        for (const solid of chunk.features.colliders) {
          if (Math.abs(solid.x - p.x) < reach + solid.reach && Math.abs(solid.z - p.z) < reach + solid.reach) list.push(solid);
        }
      }
      body.near = { x: p.x, z: p.z, list };
    }
    const near = body.near.list;
    // (a point at a time, the deepest first: a fallen tree's crown against a wall has several in it)
    for (let pass = 0; pass < PASSES && near.length && this.wall(body, near); pass++);
  }
  // The deepest of a piece's points inside any of `near` put back out, with
  // its blow; false if none is in one
  wall(body, near) {
    const { p, q, shape, last } = body, points = shape.points;
    let depth = 0, best = -1, nx = 0, nz = 0, met = null;
    for (let i = 0; i < points.length; i += 3) {
      r.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(q);
      // (and where it was a step ago)
      t2.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(last.q).add(last.p);
      for (const solid of near) {
        if (solid.woken) continue;
        const way = inside(solid, p.x + r.x, p.z + r.z, t2.x, t2.z);
        if (way && way.depth > depth) { depth = way.depth; best = i; nx = way.x; nz = way.z; met = solid; }
      }
    }
    if (best < 0) return false;
    r.set(points[best], points[best + 1], points[best + 2]).applyQuaternion(q);
    // Standing furniture it meets hard enough is knocked loose in turn, as by
    // a car (a truck shoving a fallen tree into a lamp post snaps the post)
    if (met.prop) {
      const at = this.motionOf(body, p.x + r.x, p.y + r.y, p.z + r.z), blow = this.knock(met, { x: nx, z: nz, point: { x: at.x, z: at.z } }, at);
      // (the piece takes back what a car would, at the point it met: the knock used r)
      if (blow) { r.set(points[best], points[best + 1], points[best + 2]).applyQuaternion(q); impulse(body, r, J.set(blow.x, 0, blow.z).multiplyScalar(body.kind.mass)); return true; }
    }
    // A heavy piece coming down on a parked car, or thrown into one, knocks
    // it loose as a car would (a felled tree sets a parked car rolling), and
    // meets it as a car from the next step (see update), rather than lying
    // half in it
    if (met.parked && body.kind.mass >= HEAVY && this.traffic?.enabled && velocityAt(body, r, pv).length() > KNOCKS && this.traffic.wake(met)) return true;
    p.x += nx * depth; p.z += nz * depth;
    // (the way the scenery put it out, and when, for someone on foot pushing it: see pinned)
    if (!met.parked) { (body.wall ??= { x: 0, z: 0 }).x = nx; body.wall.z = nz; body.walled = this.steps; }
    // (put straight back at a car still pushing it: jammed, see squeeze)
    if (body.pressedAt >= this.steps - 1 && nx * body.push.x + nz * body.push.z < -.5) body.jammed = this.steps;
    velocityAt(body, r, pv);
    const into = pv.x * nx + pv.z * nz;
    if (into >= 0) return true;
    n.set(nx, 0, nz);
    J.copy(n).multiplyScalar(-(1 + (-into > REST ? body.kind.bounce : 0)) * into / give(body, r, n));
    slip.copy(pv).addScaledVector(n, -into);
    const slide = slip.length();
    if (slide > 1e-4) { slip.divideScalar(slide); J.addScaledVector(slip, -Math.min(slide / give(body, r, slip), GRIP * .5 * J.length())); }
    impulse(body, r, J);
    return true;
  }
  // Loose pieces against each other: every pair near enough, one of them
  // awake, meets where either has a point inside one of the other's parts
  // (see meet); but a pair that came loose already tangled only once it has
  // come apart, rather than being thrown apart
  meetAll() {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (a.sunk || !a.shape.parts) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j], reach = a.shape.radius + b.shape.radius;
        if (b.sunk || !b.shape.parts || (a.asleep && b.asleep) || Math.abs(a.p.x - b.p.x) > reach || Math.abs(a.p.z - b.p.z) > reach || Math.abs(a.p.y - b.p.y) > reach) continue;
        if (a.tangled?.has(b)) { if (overlap(a, b)) continue; a.tangled.delete(b); b.tangled.delete(a); }
        this.meet(a, b);
      }
    }
  }
  // Two loose pieces: the deepest point of either inside a part of the other is
  // put back out, the two sharing the way by weight, and they take a blow
  // there, a bounce and a scrape, as a piece meets a wall. One lying still
  // is a wall to one that comes to rest on it, and is only woken by a real knock.
  meet(a, b) {
    let inner = a, outer = b;
    const first = deepestIn(a, b, true);
    let depth = first.depth;
    if (first.depth) { found.depth = first.depth; found.at.copy(first.at); found.n.copy(first.n); }
    const second = deepestIn(b, a, true);
    if (second.depth > depth) { inner = b; outer = a; depth = second.depth; found.at.copy(second.at); found.n.copy(second.n); }
    if (!depth) return;
    const n = found.n, ri = found.at, ro = outerAt.copy(ri).add(inner.p).sub(outer.p);
    // (one lying on the other is as good as on the ground, for settling: see step)
    if (n.y > .5) inner.supported = true; else if (n.y < -.5) outer.supported = true;
    velocityAt(inner, ri, pv); velocityAt(outer, ro, slip);
    rel.copy(pv).sub(slip);
    const closing = rel.dot(n), knocked = -closing > WAKE;
    // (the one lying still stays still, unless knocked)
    const innerFree = !inner.asleep || knocked, outerFree = !outer.asleep || knocked;
    if (!innerFree && !outerFree) return;
    // (all but the last centimetre, which the blow alone keeps from growing:
    // put right in full, one resting on another is lifted off it every step
    // and falls back, and never lies still)
    const mi = inner.kind.mass, mo = outer.kind.mass, share = !outerFree ? 1 : !innerFree ? 0 : mo / (mi + mo), away = Math.min(depth - SLOP, PART);
    if (away > 0) { inner.p.addScaledVector(n, away * share); outer.p.addScaledVector(n, -away * (1 - share)); inner.pool.dirty = outer.pool.dirty = true; }
    if (innerFree && inner.asleep) this.wake(inner);
    if (outerFree && outer.asleep) this.wake(outer);
    if (closing >= 0) return;
    // (what a car pushes into another piece pushes that on in turn: a step
    // later down a chain whose far end meets first here)
    const flat = Math.hypot(n.x, n.z);
    if (flat > .5) {
      if (outer.pressedAt >= this.steps - 1 && inner.pressedAt !== this.steps) this.press(inner, outer.pressed, n.x / flat, n.z / flat);
      else if (inner.pressedAt >= this.steps - 1 && outer.pressedAt !== this.steps) this.press(outer, inner.pressed, -n.x / flat, -n.z / flat);
    }
    const give2 = (dir, i, o) => (innerFree ? give(inner, i, dir) : 0) + (outerFree ? give(outer, o, dir) : 0);
    const bounce = -closing > REST ? (inner.kind.bounce + outer.kind.bounce) / 2 : 0;
    J.copy(n).multiplyScalar(-(1 + bounce) * closing / give2(n, ri, ro));
    slip.copy(rel).addScaledVector(n, -closing);
    const slide = slip.length();
    if (slide > 1e-4) { slip.divideScalar(slide); J.addScaledVector(slip, -Math.min(slide / give2(slip, ri, ro), GRIP * .5 * J.length())); }
    if (innerFree) impulse(inner, ri, J);
    if (outerFree) impulse(outer, ro, J.negate());
  }
  // What lies in the traffic's way (see CityTraffic.following): each piece
  // too heavy to shove aside (bins and chairs are), and everyone knocked
  // down, as the spread of its points over the ground: records { u, s,
  // reach, discs (u, s pairs), count, person, mass }, kept from call to call
  lying() {
    const list = this.inTheWay ??= [], pool = this.inTheWayPool ??= [];
    list.length = 0;
    for (const body of this.bodies) {
      if (body.sunk || (body.kind.mass < SHOVED && !body.piece.person)) continue;
      const record = pool[list.length] ??= { u: 0, s: 0, reach: 0, discs: new Float32Array(2 + SPREAD * 2), count: 0, person: false, mass: 0 };
      const points = body.shape.points, count = Math.min(SPREAD, points.length / 3), discs = record.discs;
      record.u = discs[0] = body.p.x; record.s = discs[1] = -body.p.z; record.reach = body.shape.radius; record.person = Boolean(body.piece.person); record.mass = body.kind.mass; record.count = count + 1;
      // (the first of a shape's points are the most spread: see shapeOf)
      for (let i = 0; i < count; i++) {
        t1.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).applyQuaternion(body.q);
        discs[2 + i * 2] = body.p.x + t1.x; discs[3 + i * 2] = -(body.p.z + t1.z);
      }
      list.push(record);
    }
    return list;
  }
  // A step of everything loose: what has been left far behind goes back, the
  // player and the traffic shove what they meet and take their share of the
  // blow (a car on its rails takes it as speed: see CityTraffic.strike), the
  // pieces meet each other, and they fly, tumble and settle. Someone on foot
  // kicks light pieces aside and is stopped by heavy ones (see contact).
  update(dt, player, traffic = null, chunks = null) {
    const at = player.groundedPosition;
    this.steps = (this.steps ?? 0) + 1; this.traffic = traffic;
    this.breaks = player.spec?.breaks ?? [];
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const collider = this.loose[i];
      if (Math.hypot(collider.x - at.x, collider.z - at.z) > RETURN && !(traffic?.enabled && traffic.standsIn(collider))) this.restore(collider);
    }
    // A pedestrian lies still a while before getting up (see PedestrianContacts)
    for (let i = this.people.length - 1; i >= 0; i--) {
      const body = this.people[i];
      body.unseen += dt;
      if (body.sunk || body.unseen > UNSEEN || Math.hypot(body.p.x - at.x, body.p.z - at.z) > RETURN) this.release(body);
      else if (body.asleep) body.slept += dt;
    }
    while (this.bodies.length > MOST) {
      const away = o => Math.hypot(o.x - at.x, o.z - at.z), apart = o => Math.hypot(o.p.x - at.x, o.p.z - at.z);
      const collider = this.loose.length ? this.loose.reduce((a, b) => away(a) >= away(b) ? a : b) : null;
      const body = this.people.length ? this.people.reduce((a, b) => apart(a) >= apart(b) ? a : b) : null;
      if (body && (!collider || apart(body) > away(collider))) this.release(body);
      else this.restore(collider);
    }
    if (this.bodies.length) {
      // (the player knocked over is a body here themselves: see Walker; the
      // traffic, the parked cars knocked loose and the player's own car left parked)
      let car = player.walker?.down ? null : this.carOf(player);
      const cars = [...(traffic?.enabled ? [...traffic.vehicles, ...traffic.woken ?? []] : []), ...traffic?.playerCars ?? []];
      for (const body of this.bodies) {
        if (body.sunk) continue;
        body.last.p.copy(body.p); body.last.q.copy(body.q);
        for (let pass = 0; car && pass < PASSES; pass++) {
          const blow = this.contact(body, car);
          if (!blow) break;
          // (a piece is no car to push: the engine is not held to its tyres' grip, see Vehicle.pushing)
          player.resolveTrafficCollision(blow.px, blow.pz, blow.x, blow.z, blow.spin, player.walker ? blow.closing : Math.hypot(blow.x, blow.z) * FELT, 0, false);
          car = player.walker?.down ? null : this.carOf(player);
        }
        for (const other of cars) {
          if (other.actor?.control === 'player') continue;
          if (!other.car.visible || Math.abs(other.position.x - body.p.x) > 8 || Math.abs(other.position.z - body.p.z) > 8) continue;
          for (let pass = 0; pass < PASSES; pass++) {
            const motion = traffic.motion(other), profile = other.profile ?? other.spec.profile;
            motion.y = other.position.y; motion.profile = profile; motion.height = profile?.height ?? ROOF; motion.fixed = !other.loose && !other.recover; motion.owner = other;
            const hit = this.contact(body, motion);
            if (!hit) break;
            traffic.strike(other, hit.x, hit.z, hit.spin);
            if (hit.px || hit.pz) traffic.nudge(other, hit.px, hit.pz);
          }
        }
        if (!body.asleep) this.step(body, dt, chunks);
      }
      this.meetAll();
      this.squeeze();
    }
    for (let i = this.spouts.length - 1; i >= 0; i--) {
      const spout = this.spouts[i];
      spout.left -= dt; spout.due += dt * SPRAY;
      for (; spout.due >= 1; spout.due--) this.bits.burst('jet', spout.x, spout.y, spout.z);
      if (spout.left <= 0) this.spouts.splice(i, 1);
    }
    this.bits.update(dt);
  }
  render(alpha = 1, origin = 0) {
    this.group.position.z = origin;
    const a = this.alpha = Math.min(1, Math.max(0, alpha));
    for (const pool of this.pools.values()) {
      if (!pool.dirty && !pool.bodies.some(body => !body.asleep && !body.sunk)) continue;
      pool.bodies.forEach((body, i) => {
        if (body.sunk) matrix.makeScale(0, 0, 0);
        else {
          position.lerpVectors(body.last.p, body.p, a); rotation.slerpQuaternions(body.last.q, body.q, a);
          position.sub(t1.copy(body.shape.com).applyQuaternion(rotation));
          matrix.compose(position, rotation, body.scale);
        }
        pool.mesh.setMatrixAt(i, matrix);
      });
      pool.mesh.count = pool.bodies.length; pool.mesh.instanceMatrix.needsUpdate = true; pool.dirty = false;
    }
    this.bits.render();
  }
  dispose() {
    this.group.removeFromParent();
    for (const pool of this.pools.values()) pool.mesh?.dispose();
    for (const mesh of [this.bits.mesh, this.bits.puffs]) { mesh.geometry.dispose(); mesh.dispose(); }
  }
}
