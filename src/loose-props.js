import * as THREE from 'three';
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
// lamp post takes a bite. Trees, railings, shelters and the heavy pieces
// stand firm (see CityChunk.knockable).

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
};
// A little heavier than real, so flung furniture does not hang in the air
const GRAVITY = 13;
// Loose pieces go back where they stood once the player is this far off, as
// the parked cars do (see CityTraffic); and no more than this many are loose
// at once, the furthest going back first
const RETURN = 150, MOST = 80;
// The ground is never higher than a median's kerb, so a point above it needs no lookup
const TOP = ROAD_LEVEL + MEDIAN_KERB + .01;
// Friction: the ground under a sliding piece, a car's bumper dragging one
// along, and its roof, which something landing on it slides off
const GRIP = 1, DRAG = .4, SLICK = .08;
// Below this a piece lands, or is pushed, without bouncing (as in impact.js)
const REST = 1.5;
// How high a bumper meets what it hits, and how high a car's body reaches:
// a roof, or a heavy car's cab
const BUMPER = .45, ROOF = 1.5, CAB = 3.2;
// A blow felt in the car counts for this much more in its thud and shake
const FELT = 1.5;
// A post knocked over snaps at its foot and starts to fall at this many rad/s
// for each m/s of the blow, at least TOPPLE_LEAST, and never so fast that
// its foot would leave the ground (its weight has to hold the foot down, so a
// tall lamp post falls slower than a short sign); its foot slides on at this
// share of the blow (up to 2.5 m/s), and it leans this much away from the
// car's path. While it is still more upright than FALLING the car goes past it.
const TOPPLE = .1, TOPPLE_LEAST = .9, SLIDE = .1, OUTWARD = .6, FALLING = Math.cos(50 * Math.PI / 180);
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
function shapeOf(geometry) {
  if (shapes.has(geometry)) return shapes.get(geometry);
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
    points, com, size, radius, height: size.y,
    inertia: new THREE.Vector3((size.y ** 2 + size.z ** 2) / 12, (size.x ** 2 + size.z ** 2) / 12, (size.x ** 2 + size.y ** 2) / 12),
  };
  shapes.set(geometry, shape);
  return shape;
}

// The ground under a point: a pavement, a median's kerb or the road, and
// none (NaN) over the water
function level(x, z) {
  const surface = surfaceAt(-z, x);
  return surface === 'pavement' ? PAVEMENT_LEVEL : surface === 'median' ? ROAD_LEVEL + MEDIAN_KERB : surface === 'water' ? NaN : ROAD_LEVEL;
}

// How far a point (x, z) stands inside a collider, and the way out of it:
// { x, z, depth }, or null outside
const way = { x: 0, z: 0, depth: 0 };
function inside(solid, x, z) {
  const dx = x - solid.x, dz = z - solid.z;
  if (solid.corners) {
    const corners = solid.corners;
    way.depth = Infinity;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length], length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-8) continue;
      // (the edge's normal, turned out from the middle)
      let ex = (b.z - a.z) / length, ez = -(b.x - a.x) / length;
      if (ex * ((a.x + b.x) / 2 - solid.x) + ez * ((a.z + b.z) / 2 - solid.z) < 0) { ex = -ex; ez = -ez; }
      const d = (a.x - x) * ex + (a.z - z) * ez;
      if (d <= 0) return null;
      if (d < way.depth) { way.depth = d; way.x = ex; way.z = ez; }
    }
    return way;
  }
  if (solid.heading === undefined) {
    const d = Math.hypot(dx, dz);
    if (d >= solid.reach) return null;
    way.depth = solid.reach - d; way.x = d > 1e-6 ? dx / d : 1; way.z = d > 1e-6 ? dz / d : 0;
    return way;
  }
  const cos = Math.cos(solid.heading), sin = Math.sin(solid.heading), across = dx * cos + dz * sin, along = dx * sin - dz * cos;
  const side = solid.halfWidth - Math.abs(across), end = solid.halfLength - Math.abs(along);
  if (side <= 0 || end <= 0) return null;
  if (side < end) { way.depth = side; way.x = Math.sign(across) * cos; way.z = Math.sign(across) * sin; }
  else { way.depth = end; way.x = Math.sign(along) * sin; way.z = -Math.sign(along) * cos; }
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

// A burst of small bits off a smash: glass from a lamp's head, splinters,
// litter from a bin, a stall's fruit, a splash. One instanced draw, each bit
// a tiny flat-shaded octahedron that bounces once or twice and shrinks away.
const BITS = {
  glass: { colours: ['#e6efe9', '#c4d8d6', '#f3edd5'], size: [.05, .09], shape: [1, .3, 1], count: 10, speed: 3.5, up: 3, life: 1.4 },
  wood: { colours: ['#8a6a45', '#6b5a48', '#a3845c', '#5d4a38'], size: [.1, .18], shape: [1, .22, .3], count: 10, speed: 4, up: 3, life: 2.2 },
  litter: { colours: ['#ebe5d3', '#cfc9b8', '#7fa06f', '#d9b24a', '#b8574a'], size: [.08, .13], shape: [1, .08, .8], count: 12, speed: 3.5, up: 4, life: 3, drag: 2.5 },
  fruit: { colours: ['#c96246', '#d8af51', '#819d4e', '#d58c43'], size: [.1, .13], shape: [1, .9, 1], count: 22, speed: 4.5, up: 3.5, life: 4.5, rolls: true },
  splash: { colours: ['#e3f1f2', '#b4d6d9', '#ffffff'], size: [.07, .14], shape: [1, 1, 1], count: 16, speed: 1.6, up: 5, life: 1.1 },
};
const BIT_LIMIT = 160;
class Bits {
  constructor(group, material) {
    const geometry = new THREE.OctahedronGeometry(.5);
    geometry.deleteAttribute('uv');
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3));
    this.mesh = new THREE.InstancedMesh(geometry, material, BIT_LIMIT);
    this.mesh.name = 'loose-bits'; this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < BIT_LIMIT; i++) this.mesh.setColorAt(i, white);
    group.add(this.mesh);
    this.list = []; this.colour = new THREE.Color(); this.euler = new THREE.Euler(); this.seed = 1;
  }
  random() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  // `kind` of bits from (x, y, z), carried along at (vx, vz)
  burst(kind, x, y, z, vx = 0, vz = 0) {
    const style = BITS[kind], floor = level(x, z);
    for (let k = 0; k < style.count && this.list.length < BIT_LIMIT; k++) {
      const a = this.random() * Math.PI * 2, out = style.speed * (.4 + this.random() * .6), size = style.size[0] + this.random() * (style.size[1] - style.size[0]);
      this.list.push({
        style, x, y, z, floor, vx: vx + Math.cos(a) * out, vy: style.up * (.5 + this.random() * .7), vz: vz + Math.sin(a) * out,
        rx: this.random() * 6, ry: this.random() * 6, rz: this.random() * 6, turn: (this.random() - .5) * 16,
        size, age: 0, life: style.life * (.7 + this.random() * .5), colour: style.colours[Math.floor(this.random() * style.colours.length)],
      });
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const bit = this.list[i], style = bit.style;
      bit.age += dt;
      if (bit.age > bit.life || (Number.isNaN(bit.floor) && bit.y < WATER_LEVEL - .5)) { this.list[i] = this.list.at(-1); this.list.pop(); continue; }
      bit.vy -= GRAVITY * dt;
      if (style.drag) { const drag = Math.exp(-dt * style.drag); bit.vx *= drag; bit.vz *= drag; bit.vy = Math.max(bit.vy, -2.5); }
      bit.x += bit.vx * dt; bit.y += bit.vy * dt; bit.z += bit.vz * dt;
      bit.rx += bit.turn * dt; bit.rz += bit.turn * .7 * dt;
      if (bit.y < bit.floor) {
        bit.y = bit.floor;
        bit.vy = bit.vy < -1.5 ? -bit.vy * .3 : 0;
        const rub = style.rolls ? .92 : .6;
        bit.vx *= rub; bit.vz *= rub; bit.turn *= rub;
      }
    }
  }
  render() {
    const mesh = this.mesh;
    if (!this.list.length && !mesh.count) return;
    for (let i = 0; i < this.list.length; i++) {
      const bit = this.list[i], fade = Math.min(1, (bit.life - bit.age) / .35), size = bit.size * fade, [sx, sy, sz] = bit.style.shape;
      position.set(bit.x, bit.y + size * sy * .5, bit.z);
      rotation.setFromEuler(this.euler.set(bit.rx, bit.ry, bit.rz));
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale.set(size * sx, size * sy, size * sz)));
      mesh.setColorAt(i, this.colour.set(bit.colour));
    }
    mesh.count = this.list.length;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.list = []; }
}

export class LooseProps {
  // `material`: the street furniture's own (vertex colours, instanced)
  constructor(scene, material) {
    this.group = new THREE.Group(); this.group.name = 'loose-props'; scene.add(this.group);
    this.material = material; this.pools = new Map(); this.bodies = []; this.loose = [];
    this.bits = new Bits(this.group, material);
    // What was heard: { kind, strength (m/s), x, z }, for the sound to take (see DriveAudio)
    this.sounds = [];
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
    const closing = -(car.vx * contact.x + car.vz * contact.z);
    if (closing < Math.max(.2, KINDS[prop.pieces[0].kind].firm)) return null;
    const point = contact.point ?? { x: collider.x, z: collider.z }, bodies = this.loosen(collider);
    const hit = bodies.reduce((a, b) => Math.hypot(a.p.x - point.x, a.p.z - point.z) <= Math.hypot(b.p.x - point.x, b.p.z - point.z) ? a : b), kind = hit.kind;
    let blow;
    if (kind.topples) blow = this.topple(hit, car, contact, point);
    else {
      // Flung off the bumper, it is swept a little aside out of the car's
      // path, like a skittle, and pops up no higher than POP
      const ax = Math.cos(car.heading), az = Math.sin(car.heading), side = Math.sign((hit.p.x - car.x) * ax + (hit.p.z - car.z) * az) || 1;
      let nx = -contact.x + ax * side * ASIDE, nz = -contact.z + az * side * ASIDE;
      const length = Math.hypot(nx, nz); nx /= length; nz /= length;
      // (met on the furniture's own outline, which for a cafe's chair can be
      // a metre off it: the blow lands on the chair's side, not beyond it)
      r.set(point.x - hit.p.x, 0, point.z - hit.p.z);
      const reach = Math.max(hit.shape.size.x, hit.shape.size.z) / 4, off = Math.hypot(r.x, r.z);
      if (off > reach) r.multiplyScalar(reach / off);
      r.y = Math.min(car.y + BUMPER, hit.p.y) - hit.p.y;
      blow = this.blow(hit, car, r, nx, nz, kind.lift);
      if (blow) { this.tumble(hit, nx, nz, blow.closing); hit.v.y = Math.min(hit.v.y, POP); }
    }
    if (kind.bits && !kind.topples) this.bits.burst(kind.bits, hit.p.x, hit.p.y, hit.p.z, hit.v.x * .4, hit.v.z * .4);
    this.sound(kind.sound, closing, point.x, point.z);
    return blow ?? { x: 0, z: 0, spin: 0, closing };
  }
  // The player's car running into standing furniture: true if it gave way,
  // and the car has taken its share of the blow
  hit(collider, contact, player) {
    const blow = this.knock(collider, contact, this.carOf(player));
    if (blow) player.strike(blow.x, blow.z, blow.spin, Math.hypot(blow.x, blow.z) * FELT);
    return Boolean(blow);
  }
  carOf(player) {
    const car = player.motion();
    car.y = player.groundedPosition.y; car.height = player.spec.mass > 3 ? CAB : ROOF;
    return car;
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
  reset() { while (this.loose.length) this.restore(this.loose[0]); this.bits.clear(); this.sounds = []; }
  add(piece, base) {
    const shape = shapeOf(piece.geometry), kind = KINDS[piece.kind];
    frame.copy(base); if (piece.at) frame.multiply(piece.at);
    frame.decompose(position, rotation, scale);
    const p = shape.com.clone().applyMatrix4(frame), body = {
      piece, kind, shape, p, q: rotation.clone(), v: new THREE.Vector3(), w: new THREE.Vector3(),
      last: { p: p.clone(), q: rotation.clone() }, rest: { p: p.clone(), q: rotation.clone() }, asleep: false, still: 0, awake: 0, grounded: true, sunk: false, splashed: false, clatter: 0,
      // Where each point last looked up the ground (x, z) and what it found
      ground: new Float32Array(shape.points.length).fill(NaN),
      // A turn of its own, either way, for a little variety
      jitter: Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453 % 1,
    };
    let pool = this.pools.get(piece.geometry);
    if (!pool) this.pools.set(piece.geometry, pool = { geometry: piece.geometry, mesh: null, capacity: 0, bodies: [], dirty: true });
    pool.bodies.push(body); body.pool = pool; pool.dirty = true;
    if (pool.bodies.length > pool.capacity) {
      pool.mesh?.removeFromParent(); pool.mesh?.dispose();
      pool.capacity = Math.max(8, pool.capacity * 2);
      const mesh = pool.mesh = new THREE.InstancedMesh(piece.geometry, this.material, pool.capacity);
      mesh.name = 'loose-prop'; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
      for (let i = 0; i < pool.capacity; i++) mesh.setColorAt(i, white);
      stableShadowDepth(mesh); this.group.add(mesh);
    }
    this.bodies.push(body);
    return body;
  }
  remove(body) {
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
  // A car against a loose piece: the deepest of the piece's points inside the
  // car's body (its footprint, up to its roof) is put out through the nearest
  // side, or the roof for a piece coming down on it, and takes the blow there.
  // Returns what the car takes back, or null.
  contact(body, car) {
    if (body.kind.topples && !body.asleep && t1.copy(UP).applyQuaternion(body.q).y > FALLING) return null;
    const reach = Math.hypot(car.halfWidth, car.halfLength) + body.shape.radius;
    if (Math.abs(body.p.x - car.x) > reach || Math.abs(body.p.z - car.z) > reach || body.p.y - body.shape.radius > car.y + car.height) return null;
    const cos = Math.cos(car.heading), sin = Math.sin(car.heading), points = body.shape.points;
    let depth = 0, best = -1, nx = 0, nz = 0, roof = false;
    for (let i = 0; i < points.length; i += 3) {
      r.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(body.q);
      const y = body.p.y + r.y, top = car.y + car.height - y;
      if (y < car.y - .3 || top < 0) continue;
      const dx = body.p.x + r.x - car.x, dz = body.p.z + r.z - car.z, across = dx * cos + dz * sin, along = dx * sin - dz * cos;
      const side = car.halfWidth - Math.abs(across), end = car.halfLength - Math.abs(along), d = Math.min(side, end, top);
      if (d <= depth) continue;
      depth = d; best = i; roof = top === d;
      if (side < end) { nx = (Math.sign(across) || 1) * cos; nz = (Math.sign(across) || 1) * sin; }
      else { nx = (Math.sign(along) || 1) * sin; nz = -(Math.sign(along) || 1) * cos; }
    }
    if (best < 0) return null;
    if (roof) { nx = nz = 0; body.p.y += depth + .01; }
    else { body.p.x += nx * (depth + .01); body.p.z += nz * (depth + .01); }
    body.pool.dirty = true;
    r.set(points[best], points[best + 1], points[best + 2]).applyQuaternion(body.q);
    return roof ? this.blow(body, car, r, 0, 0, 1, SLICK) : this.blow(body, car, r, nx, nz, .3);
  }
  wake(body) { body.asleep = false; body.still = 0; body.awake = 0; }
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
    // on its side would otherwise roll on down the street)
    w.multiplyScalar(Math.exp(-dt * (body.grounded ? 2.5 : .2)));
    if (!body.grounded) v.multiplyScalar(Math.exp(-dt * AIR));
    else { const roll = Math.exp(-dt * ROLL); v.x *= roll; v.z *= roll; }
    body.awake += dt; body.clatter = Math.max(0, body.clatter - dt);
    // Nearly still on the ground, it stops. It is judged by how far it has
    // gone lately rather than how fast it is going: a piece rocking on a kerb
    // or balanced on a chair's back jitters without getting anywhere. Slow,
    // it is held down, unless it is sinking: a topple starts slow, and held,
    // a post lying on its lamp's arm took seconds to roll off it.
    const slow = body.grounded && v.lengthSq() < .25 && w.lengthSq() < .5;
    if (slow && v.y > -.02) { const hold = Math.exp(-dt * 6); v.multiplyScalar(hold); w.multiplyScalar(hold); }
    const rest = body.rest;
    if (slow && rest.p.distanceToSquared(p) < .03 ** 2 && rest.q.angleTo(q) < .03) body.still += dt;
    else { rest.p.copy(p); rest.q.copy(q); body.still = 0; }
    if (body.still > .4 || body.awake > 12) this.sleep(body);
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
    const { p, q, shape } = body, points = shape.points;
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
    if (!near.length) return;
    let depth = 0, best = -1, nx = 0, nz = 0;
    for (let i = 0; i < points.length; i += 3) {
      r.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(q);
      for (const solid of near) {
        if (solid.woken) continue;
        const way = inside(solid, p.x + r.x, p.z + r.z);
        if (way && way.depth > depth) { depth = way.depth; best = i; nx = way.x; nz = way.z; }
      }
    }
    if (best < 0) return;
    p.x += nx * depth; p.z += nz * depth;
    r.set(points[best], points[best + 1], points[best + 2]).applyQuaternion(q);
    velocityAt(body, r, pv);
    const into = pv.x * nx + pv.z * nz;
    if (into >= 0) return;
    n.set(nx, 0, nz);
    J.copy(n).multiplyScalar(-(1 + (-into > REST ? body.kind.bounce : 0)) * into / give(body, r, n));
    slip.copy(pv).addScaledVector(n, -into);
    const slide = slip.length();
    if (slide > 1e-4) { slip.divideScalar(slide); J.addScaledVector(slip, -Math.min(slide / give(body, r, slip), GRIP * .5 * J.length())); }
    impulse(body, r, J);
  }
  // A step of everything loose: what has been left far behind goes back, the
  // player's car and the traffic shove what they meet, and the rest fly,
  // tumble and settle. The traffic takes nothing back from a loose piece.
  update(dt, player, traffic = null, chunks = null) {
    const at = player.groundedPosition;
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const collider = this.loose[i];
      if (Math.hypot(collider.x - at.x, collider.z - at.z) > RETURN) this.restore(collider);
    }
    while (this.bodies.length > MOST) {
      const furthest = this.loose.reduce((a, b) => Math.hypot(a.x - at.x, a.z - at.z) >= Math.hypot(b.x - at.x, b.z - at.z) ? a : b);
      this.restore(furthest);
    }
    if (this.bodies.length) {
      const car = this.carOf(player), cars = traffic?.enabled ? [...traffic.vehicles, ...traffic.woken ?? []] : [];
      for (const body of this.bodies) {
        if (body.sunk) continue;
        body.last.p.copy(body.p); body.last.q.copy(body.q);
        const blow = this.contact(body, car);
        if (blow) player.strike(blow.x, blow.z, blow.spin, Math.hypot(blow.x, blow.z) * FELT);
        for (const other of cars) {
          if (!other.car.visible || Math.abs(other.position.x - body.p.x) > 8 || Math.abs(other.position.z - body.p.z) > 8) continue;
          const motion = traffic.motion(other);
          motion.y = other.position.y; motion.height = ROOF;
          this.contact(body, motion);
        }
        if (!body.asleep) this.step(body, dt, chunks);
      }
    }
    this.bits.update(dt);
  }
  render(alpha = 1, origin = 0) {
    this.group.position.z = origin;
    const a = Math.min(1, Math.max(0, alpha));
    for (const pool of this.pools.values()) {
      if (!pool.dirty && !pool.bodies.some(body => !body.asleep && !body.sunk)) continue;
      pool.bodies.forEach((body, i) => {
        if (body.sunk) matrix.makeScale(0, 0, 0);
        else {
          position.lerpVectors(body.last.p, body.p, a); rotation.slerpQuaternions(body.last.q, body.q, a);
          position.sub(t1.copy(body.shape.com).applyQuaternion(rotation));
          matrix.compose(position, rotation, ONE);
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
    this.bits.mesh.geometry.dispose(); this.bits.mesh.dispose();
  }
}
