import * as THREE from 'three';
import { roofUnder } from '../collision.js';
import { randomAt } from './route.js';

// Pigeons: small flocks pecking about near benches (about a third of them:
// round the squares, beside park walks and along the quays) within reach of
// the player. Someone on foot running at a flock, or the player's car going
// by fast, puts it up: each bird takes off a moment after the last, flaps up
// and away round a loop clear of the buildings, and comes down again where
// it was. Where each bird is follows from the clock and the flock's last
// scare alone, as the residents' walks do, so there is nothing to step. One
// instanced draw for the bodies and one for each side's wings, casting no
// shadows (a pigeon's would be a texel or two).

// Flocks within NEAR (m) of the player are about, SHARE of the benches have
// one, and at most MOST birds are drawn
const NEAR = 70, SHARE = .36, MOST = 72;
// A flock takes off from someone on foot within SCARE_FOOT (m) moving
// faster than SCARE_PACE (m/s) or jumping, and from the player's car within
// SCARE_CAR going faster than SCARE_FAST, but not from ABOVE m or more over
// it (the helicopter). Once down again, it is put up again only after SETTLE s.
const SCARE_FOOT = 3.4, SCARE_PACE = 1.4, SCARE_CAR = 7, SCARE_FAST = 3, SETTLE = 2, ABOVE = 8;
// Seconds a bird takes to take off after the one before (at most), and in the air
const STAGGER = .4, FLIGHT = [5.5, 8];
// How far a bird potters from its spot, either way along x and z (see ground)
const POTTER = .42;
// The hinge of the right wing on the body, and its sweep folded back along the back
const HINGE = new THREE.Vector3(.036, .122, -.03), FOLDED = -1.3, DROOP = -.95;

// The bird, facing -z, its feet at the origin: a lathed body from tail to
// neck, a head and beak, and two short legs. Each wing is a flat blade of
// four feathers with a dark bar across it, hinged at the shoulder.
function part(geometry, colour, parts) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const count = g.attributes.position.count, colours = new Float32Array(count * 3), c = new THREE.Color(colour);
  for (let i = 0; i < count; i++) c.toArray(colours, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  parts.push(g);
}
function merge(parts) {
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'color']) {
    const array = new Float32Array(count * 3);
    let at = 0;
    for (const g of parts) { array.set(g.attributes[name].array, at); at += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(array, 3));
  }
  out.computeVertexNormals();
  return out;
}
// Rings of [z, y, half width, half height, color] from the tail to the neck
const RINGS = [[.17, .085, .034, .007, '#5f6672'], [.11, .09, .05, .032, '#98a1ae'], [.03, .094, .064, .058, '#a3acb8'], [-.05, .104, .06, .06, '#84a196'], [-.095, .128, .038, .04, '#8e84a8']];
function bodyGeometry() {
  const parts = [], sides = 6;
  const at = (ring, k) => { const [z, y, w, h] = RINGS[ring], a = k / sides * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * w, y + Math.sin(a) * h, z); };
  for (let r = 0; r + 1 < RINGS.length; r++) {
    const positions = [];
    for (let k = 0; k < sides; k++) {
      const a = at(r, k), b = at(r, k + 1), c = at(r + 1, k + 1), d = at(r + 1, k);
      positions.push(...a.toArray(), ...c.toArray(), ...b.toArray(), ...a.toArray(), ...d.toArray(), ...c.toArray());
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    part(g, RINGS[r + 1][4], parts);
  }
  // (the tail's end closed, and the breast's front under the head)
  for (const [r, sign] of [[0, 1], [RINGS.length - 1, -1]]) {
    const positions = [], centre = new THREE.Vector3(0, RINGS[r][1], RINGS[r][0] + sign * .012);
    for (let k = 0; k < sides; k++) positions.push(...(sign > 0 ? [at(r, k), at(r, k + 1), centre] : [at(r, k + 1), at(r, k), centre]).flatMap(p => p.toArray()));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    part(g, RINGS[r][4], parts);
  }
  const head = new THREE.IcosahedronGeometry(.036, 0); head.scale(1, .95, 1.1); head.translate(0, .158, -.118); part(head, '#848d9b', parts);
  const beak = new THREE.ConeGeometry(.011, .03, 4); beak.rotateX(-Math.PI / 2); beak.translate(0, .153, -.162); part(beak, '#3c3b3f', parts);
  const cere = new THREE.IcosahedronGeometry(.009, 0); cere.translate(0, .163, -.148); part(cere, '#e6e1d6', parts);
  for (const side of [-1, 1]) { const leg = new THREE.CylinderGeometry(.005, .006, .06, 4); leg.translate(side * .018, .03, .005); part(leg, '#c26d6b', parts); }
  return merge(parts);
}
// The right wing, spread along +x from the hinge, both faces
function wingGeometry(side) {
  const hinge = [0, 0, -.035], feathers = [[.09, 0, -.05], [.2, 0, -.02], [.23, 0, .03], [.16, 0, .09], [0, 0, .075]];
  // (pale, with a dark bar across the wing and grayer tips)
  const colours = ['#b3bbc6', '#a7b0bc', '#4c525c', '#7d8591'], parts = [];
  for (let i = 0; i + 1 < feathers.length; i++) {
    const a = feathers[i], b = feathers[i + 1], flip = p => [p[0] * side, p[1], p[2]];
    const front = [hinge, a, b].map(flip), positions = side > 0 ? [...front[0], ...front[2], ...front[1]] : [...front[0], ...front[1], ...front[2]];
    // (and its underside)
    positions.push(...positions.slice(0, 3), ...positions.slice(6, 9), ...positions.slice(3, 6));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    part(g, colours[i], parts);
  }
  return merge(parts);
}

const hash = (x, z, salt) => randomAt(Math.round(x * 10), Math.round(z * 10) + salt * 7919);
const smooth = t => t * t * (3 - 2 * t);
const body = new THREE.Matrix4(), wing = new THREE.Matrix4(), turn = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
const at = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), hinge = new THREE.Vector3(), sweep = new THREE.Matrix4(), droop = new THREE.Matrix4();

export class Pigeons {
  constructor(scene, material) {
    this.group = new THREE.Group(); this.group.name = 'pigeons'; scene.add(this.group);
    const mesh = (geometry, name) => {
      const made = new THREE.InstancedMesh(geometry, material, MOST);
      made.name = name; made.count = 0; made.frustumCulled = false; made.castShadow = false; made.receiveShadow = true;
      made.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < MOST; i++) made.setColorAt(i, new THREE.Color('#ffffff'));
      made.userData.ambientOcclusion = false;
      this.group.add(made);
      return made;
    };
    this.bodies = mesh(bodyGeometry(), 'pigeon-bodies'); this.rights = mesh(wingGeometry(1), 'pigeon-wings-right'); this.lefts = mesh(wingGeometry(-1), 'pigeon-wings-left');
    // The flocks about now, the benches they keep to, and when they were last looked for
    this.flocks = []; this.known = new WeakMap(); this.lookedAt = -Infinity;
    // Told of each flock put up: `(x, z, birds)`, for its wings' flutter (see DriveAudio)
    this.onFlight = null;
  }
  // (their program, compiled with the city: instanced, colored, as they are drawn)
  warmupObjects() {
    const stand = new THREE.InstancedMesh(this.bodies.geometry, this.bodies.material, 1);
    stand.setColorAt(0, new THREE.Color('#ffffff'));
    return [stand];
  }
  // The flocks near (x, z) (the player), found again every second or two:
  // round the benches of the chunks about (see CitydriverWorld)
  gather(chunks, x, z, time, ground) {
    if (time - this.lookedAt < 1.5 && time >= this.lookedAt) return;
    this.lookedAt = time;
    const flocks = [];
    for (const chunk of chunks) {
      const bounds = chunk?.collisionBounds;
      if (!bounds || x < bounds.minX - NEAR || x > bounds.maxX + NEAR || z < bounds.minZ - NEAR || z > bounds.maxZ + NEAR) continue;
      for (const solid of chunk.features.colliders) {
        if (solid.prop?.pieces[0]?.kind !== 'bench' || Math.abs(solid.x - x) > NEAR || Math.abs(solid.z - z) > NEAR) continue;
        let flock = this.known.get(solid);
        if (flock === undefined) { flock = hash(solid.x, solid.z, 1) < SHARE ? this.settle(solid, ground) : null; this.known.set(solid, flock); }
        if (flock) flocks.push(flock);
      }
    }
    this.flocks = flocks;
  }
  // A flock for a bench: five to nine birds about it, not on the bench, the
  // road or the water, each with its own spot, ground and ways
  settle(bench, ground) {
    const count = 5 + Math.floor(hash(bench.x, bench.z, 2) * 5), birds = [];
    for (let i = 0; i < count * 3 && birds.length < count; i++) {
      const a = hash(bench.x, bench.z, 10 + i) * Math.PI * 2, r = 1.3 + hash(bench.x, bench.z, 40 + i) * 1.6;
      const x = bench.x + Math.cos(a) * r, z = bench.z + Math.sin(a) * r, y = ground(x, z);
      // (on the pavement all the way round where it potters, not only at its spot)
      if (!Number.isFinite(y) || ![[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([dx, dz]) => Number.isFinite(ground(x + dx * POTTER, z + dz * POTTER)))) continue;
      const k = i + 1;
      birds.push({ x: x - bench.x, z: z - bench.z, y, a: hash(x, z, 3) * 6.3, b: hash(x, z, 4) * 6.3, c: hash(x, z, 5), delay: hash(x, z, 6) * STAGGER,
        flight: FLIGHT[0] + hash(x, z, 7) * (FLIGHT[1] - FLIGHT[0]), radius: 5.5 + hash(x, z, 8) * 4, height: 4.5 + hash(x, z, 9) * 3.5, lean: (hash(x, z, 11) - .5) * .8, k });
    }
    return birds.length ? { x: bench.x, z: bench.z, birds, scared: -Infinity, way: 0, spin: 1, until: -Infinity } : null;
  }
  // Put up by someone on foot or the player's car (`player`: { x, y, z,
  // speed, car, airborne }): a flock near enough takes off, away from them.
  // (The helicopter well up above them leaves them be.)
  scare(player, time, chunks) {
    for (const flock of this.flocks) {
      if (time < flock.until + SETTLE || player.y > flock.birds[0].y + ABOVE) continue;
      const dx = flock.x - player.x, dz = flock.z - player.z, reach = player.car ? SCARE_CAR : SCARE_FOOT + 1.2;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (player.car ? player.speed < SCARE_FAST : player.speed < SCARE_PACE && !player.airborne) continue;
      // (and not only the flock's middle: any bird near enough)
      if (!player.car && !flock.birds.some(bird => Math.hypot(flock.x + bird.x - player.x, flock.z + bird.z - player.z) < SCARE_FOOT)) continue;
      this.launch(flock, Math.atan2(dx, dz), time, chunks);
    }
  }
  // Up and away round a loop: of a dozen ways, the nearest to straight away
  // from what scared them whose loop keeps clear of the buildings
  launch(flock, away, time, chunks) {
    const radius = Math.max(...flock.birds.map(bird => bird.radius)), height = flock.birds[0].y, points = [];
    // (each bird loops from its own spot, up to `spread` from the flock's middle)
    const spread = Math.max(...flock.birds.map(bird => Math.hypot(bird.x, bird.z))) + POTTER * Math.SQRT2, reach = radius + spread + 1.5;
    let best = null;
    for (let k = 0; k < 12 && !best; k++) {
      const way = away + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 6;
      for (const spin of [1, -1]) {
        const cx = flock.x + Math.sin(way) * radius, cz = flock.z + Math.cos(way) * radius;
        points.length = 0;
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; points.push({ x: cx + Math.cos(a) * reach, z: cz + Math.sin(a) * reach }); }
        if (!(roofUnder(chunks, points, Infinity) > height + 2)) { best = { way, spin }; break; }
      }
    }
    // (hemmed in, they go up and come down where they were)
    Object.assign(flock, best ?? { way: away, spin: 0 }, { scared: time });
    flock.until = time + Math.max(...flock.birds.map(bird => bird.delay + bird.flight));
    this.onFlight?.(flock.x, flock.z, flock.birds.length);
  }
  // Where a bird is on the ground at `time`, pottering round its spot and
  // pecking now and then, into `out` ({ x, y, z, yaw, pitch, roll, flap, fold })
  ground(flock, bird, time, out) {
    const t = time + bird.k * 17.3;
    out.x = flock.x + bird.x + Math.sin(t * .31 + bird.a) * .3 + Math.sin(t * .83 + bird.b) * .12;
    out.z = flock.z + bird.z + Math.cos(t * .27 + bird.b) * .3 + Math.cos(t * .71 + bird.a) * .12;
    out.y = bird.y;
    const vx = .3 * .31 * Math.cos(t * .31 + bird.a) + .12 * .83 * Math.cos(t * .83 + bird.b), vz = -.3 * .27 * Math.sin(t * .27 + bird.b) - .12 * .71 * Math.sin(t * .71 + bird.a);
    out.yaw = Math.atan2(-vx, -vz);
    // (a peck every few seconds, and the head's bob as they walk)
    const peck = (t * .43 + bird.c) % 1;
    out.pitch = peck > .86 ? -.55 * Math.sin((peck - .86) / .14 * Math.PI) : Math.sin(t * 9) * .05;
    out.roll = 0; out.flap = 0; out.fold = 1;
    return out;
  }
  // Where a bird is at `time`, in the air or not
  pose(flock, bird, time, out) {
    const start = flock.scared + bird.delay, u = (time - start) / bird.flight;
    if (!(u > 0 && u < 1)) return this.ground(flock, bird, time, out);
    const from = this.ground(flock, bird, start, this.from ??= {}), to = this.ground(flock, bird, start + bird.flight, this.to ??= {});
    // Round a loop through where they took off, and down to where they will be
    const r = bird.radius, cx = from.x + Math.sin(flock.way) * r, cz = from.z + Math.cos(flock.way) * r;
    const a0 = Math.atan2(from.z - cz, from.x - cx), a = a0 + flock.spin * Math.PI * 2 * smooth(u) * (1 + bird.lean * .1);
    const home = smooth(Math.max(0, (u - .72) / .28));
    out.x = (cx + Math.cos(a) * r) * (1 - home) + to.x * home; out.z = (cz + Math.sin(a) * r) * (1 - home) + to.z * home;
    // (up quickly, down more gently, and no faster than wings would at either end)
    out.y = from.y + bird.height * Math.sin(Math.PI * u) * (1 + .6 * (1 - u)) / 1.3;
    // (along the loop and banked into it, nose up climbing and flaring to land)
    const tx = -Math.sin(a) * flock.spin, tz = Math.cos(a) * flock.spin;
    out.yaw = flock.spin ? Math.atan2(-tx, -tz) : from.yaw;
    out.roll = -flock.spin * (.45 + bird.lean * .2) * Math.sin(Math.PI * u);
    out.pitch = u < .15 ? .5 * (1 - u / .15) : u > .85 ? .45 * (u - .85) / .15 : 0;
    // Hard at first, easier up top, and a flutter coming down
    const beat = time - start;
    out.flap = u < .2 ? Math.sin(beat * 62) * .9 : u > .85 ? .55 + Math.sin(beat * 30) * .35 : Math.sin(beat * 40) * .45 * (Math.sin(beat * 2.3) > -.3 ? 1 : .15);
    out.fold = u < .06 ? 1 - u / .06 : u > .94 ? (u - .94) / .06 : 0;
    return out;
  }
  // The birds, where they are at `time`, in the scene `origin` along z
  render(origin, time) {
    this.group.position.z = origin;
    let n = 0;
    const out = this.out ??= {};
    for (const flock of this.flocks) for (const bird of flock.birds) {
      if (n >= MOST) break;
      this.pose(flock, bird, time, out);
      body.compose(at.set(out.x, out.y, out.z), turn.setFromEuler(euler.set(out.pitch, out.yaw, out.roll)), ONE);
      this.bodies.setMatrixAt(n, body);
      for (const [mesh, side] of [[this.rights, 1], [this.lefts, -1]]) {
        // (folded back along the back and down its side, or spread and flapping)
        sweep.makeRotationY(side * FOLDED * out.fold); droop.makeRotationZ(side * (DROOP * out.fold + out.flap * (1 - out.fold)));
        wing.makeTranslation(hinge.set(HINGE.x * side, HINGE.y, HINGE.z)).multiply(sweep).multiply(droop).premultiply(body);
        mesh.setMatrixAt(n, wing);
      }
      n++;
    }
    for (const mesh of [this.bodies, this.rights, this.lefts]) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; }
    this.group.visible = n > 0;
  }
  dispose() {
    for (const mesh of [this.bodies, this.rights, this.lefts]) { mesh.geometry.dispose(); mesh.dispose(); }
    this.group.removeFromParent();
  }
}
