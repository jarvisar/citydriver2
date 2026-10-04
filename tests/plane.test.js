import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CARS, CAR_IDS, GARAGE_IDS, carMeters } from '../src/cars.js';
import { createCar, DrivingController } from '../src/vehicle.js';
import { PLANE_SHAPE } from '../src/plane-model.js';
import { carArt } from '../src/car-art.js';
import { collideScenery } from '../src/collision.js';
import { DriveSoundModel } from '../src/audio/model.js';
import { engineFor } from '../src/audio/profiles.js';

// Flat ground at 24 m; north of s = 2000 it is water, 6 m lower
const GROUND = 24, WATER = 17.8;
const flat = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u, y = flat.height(s, u)) => ({ x: u, y, z: -s }),
  height: s => s > 2000 ? WATER : GROUND,
  water: s => s > 2000,
  bounds: () => [-1e9, 1e9],
  nearestLane: (s, u, heading) => ({ s: Math.min(s, 1990), u, heading }),
};
const plane = (state = {}) => { const p = new DrivingController(flat, state, 'plane'); p.freeDriving = true; return p; };
const fly = (p, seconds, input = {}, fps = 120, each = null) => { for (let i = 0; i < Math.round(seconds * fps); i++) { p.update(1 / fps, input); each?.(p); } };
const height = p => p.groundedPosition.y - GROUND;
// Up in the air at `up` meters, going `speed`, level
const aloft = (p, up = 40, speed = 34) => { p.pilot.takeOver(p.heading, speed, GROUND + up); p.pilot.landed = false; p.pilot.speed = speed; p.update(0, {}); };
// Two quick presses of `key` (a double tap)
function doubleTap(p, key, value = 1) {
  for (const input of [{ [key]: value }, {}, { [key]: value }, {}]) fly(p, .08, input);
}

test('the plane is in the garage with the helicopter, not the wheeled fleet, and has a model, art and meters', () => {
  assert.ok(GARAGE_IDS.includes('plane') && !CAR_IDS.includes('plane') && CARS.plane.flies && !CARS.plane.taxi);
  assert.equal(carMeters('plane').length, 4);
  assert.match(carArt('plane'), /^<svg[^>]*>.*<\/svg>$/);
  const model = createCar('plane');
  try {
    const { propeller, disc, wheels, nose, surfaces } = model.rotors;
    assert.ok(propeller && disc && nose && wheels.length === 3 && surfaces.aileronLeft && surfaces.aileronRight && surfaces.elevator && surfaces.rudder);
    assert.equal(model.wheels.length, 0, 'the controller turns no wheels of its own');
    assert.equal(model.nightLights.length, 2, 'landing lights and a beacon');
    model.car.traverse(object => { if (object.isMesh) assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite)); });
    disc.visible = false;
    const box = new THREE.Box3().setFromObject(model.car);
    assert.ok(Math.abs(box.min.y) < .02, `its tires stand on the ground: ${box.min.y}`);
    assert.ok(Math.abs(box.max.x - box.min.x - PLANE_SHAPE.span) < .3, `the wings span ${(box.max.x - box.min.x).toFixed(2)} m`);
    // Each moving part turns about its own hinge, axle or shaft
    for (const part of [propeller, nose, ...wheels.map(w => w.group), ...Object.values(surfaces)]) {
      const before = new THREE.Box3().setFromObject(part), centre = part.getWorldPosition(new THREE.Vector3());
      part.rotation.x += .3; part.rotation.y += .2; part.rotation.z += .4; part.updateMatrixWorld(true);
      assert.ok(part.getWorldPosition(new THREE.Vector3()).distanceTo(centre) < 1e-9, 'turns in place');
      part.rotation.set(0, 0, 0); part.updateMatrixWorld(true);
      assert.ok(new THREE.Box3().setFromObject(part).equals(before));
    }
  } finally { model.disposeModel(); }
});

test('it taxis on its nose wheel, and lifts off on full throttle, sooner with climb held', () => {
  const p = plane();
  try {
    fly(p, 2);
    assert.ok(p.pilot.landed && height(p) === 0 && p.speed === 0, 'standing still');
    fly(p, 1, { forward: 1, right: 1 });
    assert.ok(p.pilot.landed && p.heading > .2, 'turns on the ground at a crawl');
    const taxi = plane();
    let lifted = null;
    fly(taxi, 6, { forward: 1 }, 120, t => { if (lifted === null && !t.pilot.landed) lifted = t.pilot.speed; });
    assert.ok(lifted > 24 && lifted < 27, `off at ${lifted?.toFixed(1)} m/s on the throttle alone`);
    assert.ok(height(taxi) > .5 && height(taxi) < 6, 'and hands off it climbs no further than a hop');
    const pulled = plane();
    lifted = null;
    fly(pulled, 4, { forward: 1, climb: 1 }, 120, t => { if (lifted === null && !t.pilot.landed) lifted = t.pilot.speed; });
    assert.ok(lifted > 18 && lifted < 21, `off at ${lifted?.toFixed(1)} m/s pulling up`);
    assert.ok(height(pulled) > 15, `climbed ${height(pulled).toFixed(1)} m`);
    // Braking on the ground stops it, and then it backs up slowly
    const rolling = plane();
    fly(rolling, 1.5, { forward: 1 }); fly(rolling, 3, { brake: 1 });
    assert.ok(rolling.pilot.landed && rolling.speed < 0 && rolling.speed >= -4.001);
  } finally { p.disposeModel(); }
});

test('hands off it cruises level; the pedals take it between its slowest and its fastest, and steering banks it round', () => {
  const p = plane();
  try {
    aloft(p, 40, 50);
    fly(p, 10);
    assert.ok(Math.abs(p.pilot.speed - 34) < .5, `cruising at ${p.pilot.speed.toFixed(1)}`);
    assert.ok(Math.abs(height(p) - 40) < 1.5 && Math.abs(p.pilot.pitch) < .01 && Math.abs(p.pilot.bank) < .01, 'level');
    fly(p, 8, { forward: 1 });
    assert.ok(Math.abs(p.pilot.speed - p.stats.topSpeed) < .5, 'flat out');
    fly(p, 8, { brake: 1 });
    assert.ok(Math.abs(p.pilot.speed - 17) < .5, 'slowest');
    fly(p, 4);
    const heading = p.heading;
    fly(p, 3, { right: 1 });
    assert.ok(p.pilot.bank > .9 && p.bodyRoll < -.9, 'banked hard right');
    assert.ok(p.heading - heading > 1.5, `turned ${(p.heading - heading).toFixed(2)} rad in 3 s`);
    fly(p, 3);
    assert.ok(Math.abs(p.pilot.bank) < .01, 'and levels its wings again');
    // Climbing and diving
    const before = height(p);
    fly(p, 2, { climb: 1 });
    assert.ok(height(p) > before + 20 && p.bodyPitch > .4, 'nose up and climbing');
    fly(p, 2, { descend: 1 });
    assert.ok(p.bodyPitch < -.3, 'nose down');
    // At the same rates whatever the frame rate
    const heights = [30, 60, 144].map(fps => { const q = plane(); fly(q, 4, { forward: 1, climb: 1 }, fps); const y = height(q); q.disposeModel(); return y; });
    assert.ok(Math.max(...heights) - Math.min(...heights) < .5, heights.join(', '));
  } finally { p.disposeModel(); }
});

test('it settles onto the ground rather than flying into it, and says how the landing went', () => {
  const p = plane();
  try {
    aloft(p, 60, 30);
    let sink = 0;
    for (let i = 0; i < 120 * 20 && !p.pilot.landed; i++) { sink = -p.pilot.vy; p.update(1 / 120, { descend: 1, brake: 1 }); }
    assert.ok(p.pilot.landed && height(p) === 0, 'down');
    assert.ok(sink < 1.5, `touched down at ${sink.toFixed(2)} m/s`);
    assert.deepEqual(p.pilot.drain().map(event => event.text), ['Smooth landing']);
    fly(p, 5, { brake: 1 });
    assert.ok(Math.abs(p.speed) < 4.1);
    // Stalled right down, it drops its nose and flies again before the ground
    const stalled = plane();
    aloft(stalled, 30, 0);
    let lowest = Infinity;
    fly(stalled, 6, {}, 120, q => { lowest = Math.min(lowest, height(q)); });
    assert.ok(!stalled.pilot.landed && stalled.pilot.speed > 25 && lowest > 5, `recovered, ${lowest.toFixed(1)} m up at the lowest`);
    // and stalled low down (a wall met head on), it sinks and gathers speed, and never noses up
    const low = plane();
    aloft(low, 8, 0);
    let steepest = -Infinity;
    fly(low, 4, { forward: 1 }, 120, q => { steepest = Math.max(steepest, q.pilot.pitch); });
    assert.ok(steepest < .15 && low.pilot.speed > 25, `pitched at most ${steepest.toFixed(2)}`);
    low.disposeModel(); stalled.disposeModel();
  } finally { p.disposeModel(); }
});

test('over the water it only skims, and landing by itself it makes for the shore', () => {
  const p = plane({ s: 2200, u: 0, heading: 0 });
  try {
    aloft(p, 20, 30);
    fly(p, 8, { descend: 1 });
    assert.ok(!p.pilot.landed && Math.abs(p.groundedPosition.y - (WATER + 1.1)) < .05, 'skimming the water');
    assert.ok(p.pilot.speed > 16, 'still flying');
    // Heading out to sea, told to land, it turns back for the land and comes down on it
    let landed = null;
    fly(p, 40, { land: true }, 120, q => { if (landed === null && q.pilot.landed) landed = q.s; });
    assert.ok(landed !== null && landed < 2000, `down on land at s ${landed?.toFixed(0)}`);
    fly(p, 8, { land: true });
    assert.ok(Math.abs(p.speed) < .01, 'and stopped');
  } finally { p.disposeModel(); }
});

test('low over the river it goes under a bridge, a pier is solid, and a deck met higher up is a wall', () => {
  // Water from s = 2000 to 2400, a bridge's deck across it from s = 2140 to 2160, and a pier under it at u = 12
  const deck = (s, u) => s > 2140 && s < 2160 && Math.abs(u) < 40;
  const river = {
    ...flat, grid: true,
    height: (s, u) => s > 2000 && s < 2400 && !deck(s, u) ? WATER : GROUND,
    water: (s, u) => s > 2000 && s < 2400 && !deck(s, u),
    under: (s, u) => deck(s, u) ? { lid: GROUND - 1.4, water: WATER } : null,
  };
  const pier = { corners: [{ x: 11, z: -2145 }, { x: 13, z: -2145 }, { x: 13, z: -2155 }, { x: 11, z: -2155 }], x: 12, z: -2150, reach: 5.2, top: GROUND - 1.4 };
  const railing = { x: 0, z: -2140.2, reach: .3 };
  const chunks = new Map([[0, { collisionBounds: { minX: -40, maxX: 40, minZ: -2160, maxZ: -2140 }, features: { colliders: [railing], piers: [pier] } }]]);
  const run = (up, u, events) => {
    const p = new DrivingController(river, { s: 2060, u, heading: 0 }, 'plane');
    p.freeDriving = true; p.scenery = chunks;
    p.pilot.takeOver(0, 30, WATER + up); p.pilot.landed = false; p.pilot.speed = 30; p.update(0, {});
    let lowest = Infinity, highest = -Infinity, through = 0;
    for (let i = 0; i < 120 * 5; i++) {
      p.update(1 / 120, {}); collideScenery(p, chunks, 1 / 120);
      if (deck(p.s, p.u)) { highest = Math.max(highest, p.groundedPosition.y); lowest = Math.min(lowest, p.groundedPosition.y); }
      // (in the deck's way: its middle over the deck, and too tall to be under it)
      if (deck(p.s, p.u) && p.groundedPosition.y + 2.8 > GROUND - 1.4 + .01) through++;
      events.push(...p.pilot.drain().map(event => event.text));
    }
    const result = { s: p.s, u: p.u, highest, lowest, through, hits: p.audioTelemetry.impactSerial };
    p.disposeModel();
    return result;
  };
  let events = [];
  const under = run(1.1, 0, events);
  assert.ok(under.s > 2200, `through, to s ${under.s.toFixed(0)}`);
  assert.ok(under.highest <= GROUND - 1.4 - 2.8 + 1e-6 && under.lowest >= WATER + 1.1 - 1e-6, 'under the deck, over the water');
  assert.equal(under.hits, 0, 'the railing on the deck overhead is no wall');
  assert.ok(events.includes('Under the bridge'));
  events = [];
  const pierHit = run(1.1, 12, events);
  assert.ok(pierHit.hits > 0 && pierHit.s < 2150, 'a pier is solid');
  // Too high to pass under, it meets the deck's side, and never goes through it
  const high = run(5, 0, events = []);
  assert.ok(high.hits > 0 && high.through === 0, 'the side of the deck is a wall higher up');
});

test('a double tap on climb loops the loop, and on a steering direction rolls it right round', () => {
  const p = plane();
  try {
    aloft(p, 30, 36);
    const heading = p.heading, before = height(p);
    doubleTap(p, 'climb');
    assert.equal(p.pilot.stunt?.kind, 'loop');
    let top = 0, jump = 0;
    fly(p, 6, {}, 120, q => { top = Math.max(top, height(q)); jump = Math.max(jump, Math.abs(q.currentPose.bodyPitch - q.previousPose.bodyPitch)); });
    assert.equal(p.pilot.stunt, null);
    assert.ok(top > before + 35 && top < before + 55, `over the top ${(top - before).toFixed(1)} m up`);
    assert.ok(Math.abs(height(p) - before) < 8, 'back down about where it began');
    assert.ok(Math.abs(p.heading - heading) < 1e-9, 'the same way on');
    assert.ok(jump < .1, `the body turns smoothly all the way round: at most ${jump.toFixed(3)} a step`);
    assert.deepEqual(p.pilot.drain().map(event => event.text), ['Loop the loop']);
    // A roll: right round, a step to the right, and the same way on
    const u = p.u;
    jump = 0;
    doubleTap(p, 'right');
    assert.equal(p.pilot.stunt?.kind, 'roll');
    fly(p, 1.5, {}, 120, q => { jump = Math.max(jump, Math.abs(q.currentPose.bodyRoll - q.previousPose.bodyRoll)); });
    assert.equal(p.pilot.stunt, null);
    assert.ok(p.u - u > 3, `stepped ${(p.u - u).toFixed(1)} m aside`);
    assert.ok(Math.abs(p.heading - heading) < .15 && jump < .15, 'and round smoothly');
    assert.deepEqual(p.pilot.drain().map(event => event.text), ['Barrel roll']);
    // Held down, the controls only fly it: no stunts
    fly(p, 1, { right: 1 }); fly(p, 1, { climb: 1 });
    assert.equal(p.pilot.stunt, null);
    // and none on the ground
    const parked = plane();
    doubleTap(parked, 'climb'); doubleTap(parked, 'left');
    assert.equal(parked.pilot.stunt, null);
    parked.disposeModel();
  } finally { p.disposeModel(); }
});

test('its wings meet buildings its wheels would pass beside, and a wingtip clipped swings it round', () => {
  // A building 20 m square whose west face is at u = 5, its roof 40 m up
  const building = { corners: [{ x: 5, z: -80 }, { x: 25, z: -80 }, { x: 25, z: -100 }, { x: 5, z: -100 }], x: 15, z: -90, reach: 15, top: GROUND + 40 };
  const chunks = new Map([[0, { collisionBounds: { minX: 5, maxX: 25, minZ: -100, maxZ: -80 }, features: { colliders: [building] } }]]);
  const p = plane({ s: 20, u: 2, heading: 0 });
  p.scenery = chunks;
  try {
    aloft(p, 10, 30);
    const hits = p.audioTelemetry.impactSerial;
    let spun = 0, inside = 0;
    for (let i = 0; i < 120 * 4; i++) {
      p.update(1 / 120, {}); collideScenery(p, chunks, 1 / 120); spun = Math.min(spun, p.heading);
      // (the middle of the wing, which spans the fuselage, never inside the building)
      const wing = { x: p.groundedPosition.x + Math.sin(p.heading) * .75, z: p.groundedPosition.z - Math.cos(p.heading) * .75 };
      if (wing.x > 5 + .1 && wing.x < 25 && wing.z < -80 - .1 && wing.z > -100) inside++;
    }
    assert.ok(p.audioTelemetry.impactSerial > hits, 'a knock');
    assert.ok(spun < -.1 && spun > -1, `turned away from the wall, ${spun.toFixed(2)} rad`);
    assert.equal(inside, 0, 'kept out of it');
    // Over its roof the wings pass
    const over = plane({ s: 20, u: 2, heading: 0 });
    over.scenery = chunks; aloft(over, 45, 30);
    const serial = over.audioTelemetry.impactSerial;
    for (let i = 0; i < 120 * 4; i++) { over.update(1 / 120, {}); collideScenery(over, chunks, 1 / 120); }
    assert.equal(over.audioTelemetry.impactSerial, serial); assert.ok(Math.abs(over.u - 2) < 1e-6);
    over.disposeModel();
  } finally { p.disposeModel(); }
});

test('taken out of the garage beside a tower, it stays on the street, not on the roof', () => {
  // A tower 20 m square whose south face is at s = 50, its roof 60 m up, and a car against it
  const tower = { corners: [{ x: -10, z: -50 }, { x: 10, z: -50 }, { x: 10, z: -70 }, { x: -10, z: -70 }], x: 0, z: -60, reach: Math.hypot(10, 10), top: GROUND + 60 };
  const chunks = new Map([[0, { collisionBounds: { minX: -10, maxX: 10, minZ: -70, maxZ: -50 }, features: { colliders: [tower] } }]]);
  const p = new DrivingController({ ...flat, grid: true }, { s: 40, u: 0, heading: 0 }, 'taxi');
  p.freeDriving = true; p.scenery = chunks;
  try {
    for (let i = 0; i < 120 * 4; i++) { p.update(1 / 120, { forward: .4 }); collideScenery(p, chunks, 1 / 120); }
    assert.ok(p.s > 47, 'up against it');
    p.speed = 0; p.setCar('plane');
    // (its nose wheel reaches over the tower's footprint)
    assert.ok(p.s + PLANE_SHAPE.length / 2 > 50, 'its nose over the footprint');
    fly(p, 1, {}, 120, () => collideScenery(p, chunks, 1 / 120));
    assert.ok(p.pilot.landed && Math.abs(height(p)) < 1e-6, `on the street, ${height(p).toFixed(2)} m up`);
  } finally { p.disposeModel(); }
});

test('flown by nobody it comes down, stops and its engine dies', () => {
  const p = plane();
  try {
    aloft(p, 50, 34);
    p.pilot.unmanned = true;
    fly(p, 40);
    assert.ok(p.pilot.landed && p.pilot.settled && p.pilot.power === 0);
    assert.deepEqual(p.pilot.drain(), [], 'and says nothing');
  } finally { p.disposeModel(); }
});

test('its sound is an engine and a propeller beat, tied to its power, with no gears', () => {
  const profile = engineFor('plane'), model = new DriveSoundModel();
  model.setProfile(profile, 56);
  assert.ok(profile.rotor > 20);
  let state = model.update({ rotor: .26, speed: 0 }, .1);
  for (let i = 0; i < 30; i++) state = model.update({ rotor: .26, speed: 0 }, .1);
  const idle = state.rpm;
  for (let i = 0; i < 30; i++) state = model.update({ rotor: 1, throttle: 1, speed: 50 }, .1);
  assert.ok(state.rpm > idle + 800 && state.shiftSerial === 0);
  assert.equal(state.roadLevel, 0);
});
