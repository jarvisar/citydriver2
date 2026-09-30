import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DrivingController } from '../src/vehicle.js';
import { collideScenery, shapeHeight, shapeSlope } from '../src/collision.js';
import { CityTraffic } from '../src/city-traffic.js';
import { DriveSoundModel } from '../src/audio/model.js';
import { engineFor } from '../src/audio/profiles.js';
import { ThirdPersonCamera } from '../src/third-person-camera.js';
import { citydriverRoute, journeyStart } from '../src/world/city-route.js';

// A straight road north at 24 m, unless `height` and `water` say otherwise
const GROUND = 24, WATER = 17.8;
const road = (height = () => GROUND, water = () => false) => ({
  grid: true, laneAssist: false, frame: () => ({ angle: 0, scale: 1 }), position: (s, u, y = height(s, u)) => ({ x: u, y, z: -s }),
  height, water, bounds: () => [-1e9, 1e9], looseness: () => 0,
});
// A ramp in the road, its foot `at` metres north, climbing `rise` over `run`
// and a level top `flat` long, facing north
function ramp({ at = 40, rise = 1.4, run = 7, curve = .5, flat = 1.5, width = 3, base = GROUND } = {}) {
  const length = run + flat, z0 = -at, z1 = -(at + length);
  const corners = [{ x: -width / 2, z: z0 }, { x: width / 2, z: z0 }, { x: width / 2, z: z1 }, { x: -width / 2, z: z1 }];
  return { corners, x: 0, z: (z0 + z1) / 2, reach: Math.hypot(width / 2, length / 2), heading: 0, top: base + rise, shape: { kind: 'ramp', x: 0, z: z0, dx: 0, dz: -1, run, rise, curve, flat, base } };
}
function mound({ at = 40, rx = 10, rz = 7, height = 1.8, base = GROUND } = {}) {
  const corners = Array.from({ length: 16 }, (_, k) => ({ x: Math.cos(k / 16 * Math.PI * 2) * (rz + .2), z: -at + Math.sin(k / 16 * Math.PI * 2) * (rx + .2) }));
  // (its long axis along the road: the ellipse turned a quarter)
  return { corners, x: 0, z: -at, reach: rx + .2, heading: 0, top: base + height, shape: { kind: 'mound', x: 0, z: -at, rx, rz, cos: 0, sin: 1, height, base } };
}
const chunks = (...solids) => new Map([['test', { collisionBounds: { minX: -50, maxX: 50, minZ: -400, maxZ: 50 }, features: { colliders: solids } }]]);
function car(route = road(), scenery = null, id = 'taxi') {
  const c = new DrivingController(route, { s: 0, u: 0, heading: 0 }, id);
  c.freeDriving = true; c.scenery = scenery; c.update(0, {});
  return c;
}
// Holds `speed` along the road for `seconds` (the throttle only, as a player
// would), with the scenery met as the game meets it. Returns what happened on the way
function drive(c, seconds, speed, input = {}) {
  c.speed = speed; c.update(0, {});
  const seen = { events: [], peak: -Infinity, air: 0, lowest: Infinity, aloft: false, took: null };
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    const keep = typeof input === 'function' ? input(c) : input;
    c.update(1 / 120, { forward: c.speed < speed ? 1 : 0, ...keep });
    if (c.scenery) collideScenery(c, c.scenery, 1 / 120);
    seen.peak = Math.max(seen.peak, c.y - GROUND); seen.lowest = Math.min(seen.lowest, c.y - c.route.height(c.s, c.u));
    if (c.aloft) { seen.air += 1 / 120; seen.aloft = true; if (!seen.took) seen.took = { speed: c.speed }; }
    seen.events.push(...c.drain());
  }
  return seen;
}

test('shapes: a ramp climbs from its foot to its lip, steeper at the lip, and a mound is a smooth hump', () => {
  const r = ramp().shape, at = t => ({ x: 0, z: -40 - t });
  assert.equal(shapeHeight(r, at(-1)), GROUND); assert.equal(shapeHeight(r, at(0)), GROUND);
  assert.ok(Math.abs(shapeHeight(r, at(7)) - (GROUND + 1.4)) < 1e-9 && shapeHeight(r, at(8)) === GROUND + 1.4, 'up to its top, then level');
  const slope = t => -shapeSlope(r, at(t)).z;
  assert.ok(slope(.5) < slope(3.5) && slope(3.5) < slope(6.9), 'steepening toward the lip');
  assert.ok(Math.abs(slope(6.99) - 1.4 / 7 * 1.5) < .01, 'as steep at the lip as curve says');
  const m = mound().shape, p = { x: 0, z: -40 };
  assert.ok(Math.abs(shapeHeight(m, p) - (GROUND + 1.8)) < 1e-9 && shapeHeight(m, { x: 0, z: -40 - 10.1 }) === GROUND, 'its top in the middle, the lawn at its rim');
  // (the slope agrees with the height)
  const q = { x: 1.3, z: -44.1 }, e = 1e-4, g = shapeSlope(m, q, {});
  assert.ok(Math.abs(g.x - (shapeHeight(m, { x: q.x + e, z: q.z }) - shapeHeight(m, { x: q.x - e, z: q.z })) / (2 * e)) < 1e-4);
  assert.ok(Math.abs(g.z - (shapeHeight(m, { x: q.x, z: q.z + e }) - shapeHeight(m, { x: q.x, z: q.z - e })) / (2 * e)) < 1e-4);
});

test('a ramp throws a car into the air, and it comes down on its wheels with nearly all its speed', () => {
  const c = car(road(), chunks(ramp()));
  try {
    const seen = drive(c, 4, 25);
    assert.ok(seen.aloft && seen.air > .7 && seen.air < 1.6, `in the air ${seen.air.toFixed(2)} s`);
    assert.ok(seen.peak > 2 && seen.peak < 4.5, `up to ${seen.peak.toFixed(2)} m`);
    const jump = seen.events.find(e => e.kind === 'jump');
    assert.ok(jump && jump.distance > 18 && jump.distance < 32 && jump.landing === 'clean', JSON.stringify({ ...jump, from: null }));
    assert.ok(!c.aloft && Math.abs(c.y - GROUND) < .02 && Math.abs(c.pitch) < .05, 'back on the road, level');
    assert.ok(seen.lowest > -.02, 'never through the road');
    assert.ok(jump.speed > 24 && c.speed > 23, 'the air takes little of its speed');
  } finally { c.disposeModel(); }
});

test('the faster the run at a ramp, the further the jump', () => {
  const distance = speed => { const c = car(road(), chunks(ramp())); try { return drive(c, 5, speed).events.find(e => e.kind === 'jump')?.distance ?? 0; } finally { c.disposeModel(); } };
  const slow = distance(18), fast = distance(30), faster = distance(38);
  assert.ok(slow < fast && fast < faster, `${slow.toFixed(1)} < ${fast.toFixed(1)} < ${faster.toFixed(1)} m`);
});

test('kerbs up and down never lift a car off its tyres', () => {
  // A pavement 12 cm up, 20 m long, and back down
  const c = car(road(s => s > 30 && s < 50 ? GROUND + .12 : GROUND));
  try {
    const seen = drive(c, 3, 30);
    assert.ok(!seen.aloft && !seen.events.some(e => e.kind === 'jump'), 'no jump');
    // (astride a kerb it rests on the plane through its wheels)
    assert.ok(seen.lowest > -.08, `never into the ground (${seen.lowest.toFixed(3)})`);
    assert.ok(c.audioTelemetry.bumpSerial >= 2, 'each kerb thumps');
  } finally { c.disposeModel(); }
});

test('a hump taken fast leaves the ground, and taken slowly keeps its tyres on it', () => {
  const air = speed => { const c = car(road(), chunks(mound({ rx: 9, height: 2 }))); try { return drive(c, 4, speed); } finally { c.disposeModel(); } };
  assert.ok(!air(8).aloft, 'slowly, it goes over');
  const fast = air(24);
  assert.ok(fast.aloft && fast.peak > 2, `fast, it flies: ${fast.peak.toFixed(2)} m`);
});

test('steering leans the nose in the air; with drift held it spins, and let go in time it lands straight', () => {
  const big = () => ramp({ rise: 3, run: 10, curve: .6, flat: 0 });
  // A lean: the nose off the way the car flies, straight again once let go
  const c = car(road(), chunks(big()));
  try {
    let lean = 0;
    drive(c, 3.2, 30, car => { if (car.aloft) lean = Math.max(lean, Math.abs(Math.atan2(Math.sin(car.heading - car.slideHeading), Math.cos(car.heading - car.slideHeading)))); return car.aloft ? { right: 1 } : {}; });
    assert.ok(lean > .3 && lean < .5, `leaned ${lean.toFixed(2)} rad`);
  } finally { c.disposeModel(); }
  // A spin, let go with time to come round: a whole turn, landed
  const spin = car(road(), chunks(big()));
  try {
    let held = 0;
    const seen = drive(spin, 4, 34, car => { if (car.aloft) held += 1 / 120; return car.aloft && held < .8 ? { right: 1, handbrake: true } : {}; });
    const jump = seen.events.find(e => e.kind === 'jump');
    assert.ok(jump && Math.abs(jump.turns) >= 1 && jump.landing !== 'spun', JSON.stringify({ ...jump, from: null }));
  } finally { spin.disposeModel(); }
  // Held all the way down, it lands part way round and spins out
  const out = car(road(), chunks(big()));
  try {
    const seen = drive(out, 4, 34, car => car.aloft ? { right: 1, handbrake: true } : {});
    const jump = seen.events.find(e => e.kind === 'jump');
    assert.ok(jump, 'a jump');
    if (jump.landing === 'spun') assert.ok(Math.abs(out.knock.spin) > 0 || Math.hypot(out.knock.x, out.knock.z) > 0 || out.speed < 30, 'the tyres take the slide');
  } finally { out.disposeModel(); }
});

test('up a ramp the car passes over it; into its side, it is a wall', () => {
  const r = ramp(), c = car(road(), chunks(r));
  try {
    // Beside the ramp, heading into its side at road level
    c.s = 44; c.u = -4; c.heading = Math.PI / 2; c.update(0, {});
    c.speed = 8;
    for (let i = 0; i < 120; i++) { c.update(1 / 120, { forward: 1 }); collideScenery(c, c.scenery, 1 / 120); }
    assert.ok(c.u < -1.4 && c.y < GROUND + .2, `kept out of it: u ${c.u.toFixed(2)}`);
    assert.ok(!c.passes(r, { point: { x: -1.5, z: -44 } }), 'its side is no step');
    // Up on it, it is the ground
    c.s = 44; c.u = 0; c.heading = 0; c.update(0, {});
    assert.ok(Math.abs(c.y - shapeHeight(r.shape, { x: 0, z: -44 })) < .35 && c.passes(r, { point: { x: 0, z: -44 } }));
  } finally { c.disposeModel(); }
});

test('in the air a car clears what it is over: a parked car, a railing, a wall, not a building', () => {
  const c = car(road());
  try {
    const parked = { parked: { height: 1.7 } }, railing = { base: GROUND, height: 1.15 }, wall = {}, building = { top: GROUND + 9, corners: [], x: 0, z: 0 };
    assert.ok(![parked, railing, wall].some(solid => c.passes(solid)), 'on the road it meets them all');
    c.y = GROUND + 3; c.aloft = true;
    assert.ok(c.passes(parked) && c.passes(railing) && c.passes(wall), 'three metres up it clears them');
    assert.ok(!c.passes(building, { point: { x: 0, z: 0 } }), 'but not a building');
  } finally { c.disposeModel(); }
});

test('traffic neither meets a car jumping over its roof nor one under a bridge it crosses', () => {
  const player = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  const traffic = new CityTraffic(new THREE.Scene(), player.route, player.s, 'city', player.u);
  try {
    player.toggleFreeDriving();
    const other = traffic.vehicles.find(v => v.edge);
    for (const v of traffic.vehicles) if (v !== other) { v.edge = null; v.position.set(1e6, 0, 1e6); }
    player.s = other.s; player.u = other.u; player.heading = other.heading + Math.PI / 2; player.update(0, {});
    const on = player.groundedPosition.clone();
    // Over its roof: nothing moves
    player.groundedPosition.y = other.position.y + other.profile.height + .1;
    const over = player.groundedPosition.clone();
    traffic.collidePlayer(other, player);
    assert.ok(player.groundedPosition.equals(over), 'over it');
    // Down beside it on the road, they meet
    player.groundedPosition.copy(on);
    traffic.collidePlayer(other, player);
    assert.ok(!player.groundedPosition.equals(on), 'on the road they meet');
  } finally { traffic.dispose(); player.disposeModel(); }
});

// A kerb-parked car 40 m up the road, facing north: bonnet and boot low, the roof high
function parkedCar(at = 40) {
  const heights = new Float32Array(18).map((_, k) => k < 4 ? .8 : k < 7 ? .95 : k < 12 ? 1.45 : k < 14 ? 1.1 : .85);
  const corners = [{ x: -.9, z: -at + 2.2 }, { x: .9, z: -at + 2.2 }, { x: .9, z: -at - 2.2 }, { x: -.9, z: -at - 2.2 }];
  return { corners, x: 0, z: -at, reach: 2.5, heading: 0, parked: { model: 'sedan', nose: { u: 0, s: 1 }, profile: { heights, slice: .25, length: 4.5, height: 1.45 }, height: 1.45, base: GROUND } };
}

test('a car come down on a parked car lands on its roof, not beside it, and the car takes the blow', () => {
  const solid = parkedCar(), c = car(road(), chunks(solid));
  try {
    // Dropped onto its roof
    c.s = 40; c.u = .2; c.update(0, {});
    c.y = GROUND + 3.5; c.vy = 0; c.aloft = true; c.speed = 0;
    const events = [];
    for (let i = 0; i < 120; i++) { c.update(1 / 120, {}); collideScenery(c, c.scenery, 1 / 120); events.push(...c.drain()); }
    assert.ok(Math.abs(c.u - .2) < .05, `not shoved aside (${c.u.toFixed(2)})`);
    assert.ok(c.y > GROUND + 1, `on its roof, ${(c.y - GROUND).toFixed(2)} m up`);
    const stomp = events.find(e => e.kind === 'stomp');
    assert.ok(stomp && stomp.on === solid && stomp.impact > 5, JSON.stringify(stomp && { impact: stomp.impact }));
    // Down on its belly it still gets along, and driven off the end drops back to the street
    for (let i = 0; i < 360; i++) { c.update(1 / 120, { forward: c.speed < 6 ? 1 : 0 }); collideScenery(c, c.scenery, 1 / 120); }
    assert.ok(c.s > 44 && Math.abs(c.y - GROUND) < .05, `off it at ${c.s.toFixed(1)}, ${(c.y - GROUND).toFixed(2)} m up`);
    // From the street it is a wall, as ever: no driving up onto it
    c.s = 30; c.u = 0; c.update(0, {});
    const into = drive(c, 3, 8);
    assert.ok(c.s < 38 && !into.events.some(e => e.kind === 'stomp'), `stopped at ${c.s.toFixed(1)}`);
  } finally { c.disposeModel(); }
});

test('a car come down on a traffic car stands on its roof, and its driver stops', () => {
  const player = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  const traffic = new CityTraffic(new THREE.Scene(), player.route, player.s, 'city', player.u);
  try {
    player.toggleFreeDriving(); player.traffic = traffic;
    const other = traffic.vehicles.find(v => v.edge);
    for (const v of traffic.vehicles) if (v !== other) { v.edge = null; v.position.set(1e6, 0, 1e6); }
    player.s = other.s; player.u = other.u; player.heading = other.heading; player.update(0, {});
    player.y = other.position.y + other.profile.height + 2; player.vy = 0; player.aloft = true;
    const events = [], start = { s: player.s, u: player.u };
    // (the car standing where it is: the traffic's own update would move it on, or away)
    for (let i = 0; i < 120; i++) {
      player.update(1 / 120, {});
      traffic.collidePlayer(other, player);
      for (const event of player.drain()) { events.push(event); if (event.kind === 'stomp') traffic.stomp(event.on, event.impact, event); }
    }
    const stomp = events.find(e => e.kind === 'stomp');
    assert.ok(stomp?.on.car === other, events.map(e => e.kind).join(' '));
    assert.ok(player.y > other.position.y + 1, `up on it, ${(player.y - other.position.y).toFixed(2)} m`);
    assert.ok(Math.hypot(player.s - start.s, player.u - start.u) < .5, 'not shoved off it');
    assert.ok(other.dazed > 0 && other.rock, 'its driver stops, its body rocked');
  } finally { traffic.dispose(); player.disposeModel(); }
});

test('short of the far bank a car splashes into the water, sinks, and asks to be fished out', () => {
  // Water from 60 m north, 6 m down
  const c = car(road(s => s > 60 ? WATER : GROUND, s => s > 60), chunks(ramp({ at: 40, rise: 1.4 })));
  try {
    const seen = drive(c, 6, 20);
    const kinds = seen.events.map(e => e.kind);
    assert.ok(kinds.includes('splash') && kinds.includes('sunk'), kinds.join(' '));
    assert.equal(seen.events.find(e => e.kind === 'jump')?.landing, 'splash');
    const sunk = seen.events.find(e => e.kind === 'sunk');
    assert.ok(sunk.from && Math.abs(sunk.from.heading) < .01, 'saying where it left the ground');
    // A step of no time puts it back on dry ground, done sinking
    c.s = 10; c.update(0, {});
    assert.ok(!c.sinking && Math.abs(c.y - GROUND) < 1e-9);
  } finally { c.disposeModel(); }
});

test('in the air the engine revs free and the tyres go quiet', () => {
  const model = new DriveSoundModel(); model.setProfile(engineFor('taxi'), 40);
  let ground; for (let i = 0; i < 60; i++) ground = model.update({ speed: 25, throttle: 1 }, 1 / 60);
  let air; for (let i = 0; i < 60; i++) air = model.update({ speed: 25, throttle: 1, aloft: 1 }, 1 / 60);
  assert.ok(air.roadLevel === 0 && ground.roadLevel > 0, 'no tyre noise in the air');
  assert.ok(air.rpm > ground.rpm, 'the revs rise with the wheels free');
});

test('the chase camera looks the way a car flies, and follows its jump loosely', () => {
  const camera = new ThirdPersonCamera(), target = new THREE.Group();
  target.rotation.y = -1.2; target.userData.travel = 0; target.position.set(0, GROUND, 0);
  for (let i = 0; i < 240; i++) camera.update(target, 1 / 60);
  const look = new THREE.Vector3(); camera.camera.getWorldDirection(look);
  assert.ok(Math.abs(Math.atan2(look.x, -look.z)) < .05, 'along the flight, not the nose');
  target.position.y = GROUND + 4; camera.update(target, 1 / 60);
  const rose = camera.height - GROUND;
  assert.ok(rose > 0 && rose < .2, `a jump's height it follows gently (${rose.toFixed(3)} m in a frame)`);
});
