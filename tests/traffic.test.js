import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Traffic, TRAFFIC_CRUISE_SPEED, trafficContact } from '../src/traffic.js';
import { collisionImpulse, contactPoint } from '../src/impact.js';
import { TRAFFIC_MODELS } from '../src/traffic-models.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute } from '../src/world/city-route.js';

const straightRoute = {
  frame: s => ({ x: 0, y: 0, z: -s, nx: 1, nz: 0, angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0,
  bounds: () => [-4.65, 4.65],
};
function setup(route = straightRoute, s = 24) {
  const scene = new THREE.Scene(), player = new DrivingController(route, { s });
  const traffic = new Traffic(scene, route, s);
  return { scene, player, traffic };
}
function footprint(car) {
  return { x: car.position.x, z: car.position.z, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2 };
}
function playerFootprint(player) {
  return { x: player.groundedPosition.x, z: player.groundedPosition.z, heading: player.heading, halfWidth: 1, halfLength: 1.96 };
}

test('disabled traffic hides the fleet and prevents movement and collisions across route changes', () => {
  const { player, traffic } = setup();
  const car = traffic.vehicles[0];
  traffic.respawn(car, player.s);
  let collisions = 0;
  player.resolveTrafficCollision = () => { collisions++; };
  traffic.collide(player);
  assert.ok(collisions > 0, 'the overlapping car collides when enabled');
  collisions = 0;
  traffic.setEnabled(false, player);
  const positions = traffic.vehicles.map(car => car.s);
  traffic.update(1, player); traffic.collide(player); traffic.render(1);
  assert.equal(collisions, 0);
  assert.equal(traffic.group.visible, false);
  assert.deepEqual(traffic.vehicles.map(car => car.s), positions);
  traffic.reset(citydriverRoute, 2000, 'snow');
  traffic.render(1);
  assert.equal(traffic.enabled, false);
  assert.equal(traffic.group.visible, false);
  player.s = 5000;
  traffic.setEnabled(true, player); traffic.render(1, 4096);
  assert.equal(traffic.group.visible, true);
  assert.equal(traffic.journey, 'snow');
  assert.ok(traffic.vehicles.every(car => Math.abs(car.s - player.s) >= 18 && Math.abs(car.s - player.s) < 625 * traffic.spacing));
  assert.ok(traffic.vehicles.every(car => car.car.position.equals(car.position)));
  traffic.dispose();
});

test('traffic has five distinct shapes, varied paint, and ample initial gaps', () => {
  const { traffic } = setup();
  assert.equal(traffic.vehicles.length, 6);
  assert.equal(new Set(traffic.vehicles.map(car => car.spec.name)).size, 5);
  assert.ok(new Set(traffic.vehicles.map(car => car.paint.color.getHex())).size >= 3);
  assert.equal(new Set(TRAFFIC_MODELS.map(spec => `${spec.length}/${spec.cabin.join('/')}`)).size, 5);
  for (const car of traffic.vehicles) {
    assert.equal(car.car.children.length, 4);
    for (const mesh of car.car.children) {
      assert.ok(mesh.geometry.attributes.position.count > 0);
      assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));
    }
    assert.ok(Math.abs(car.s - 24) > 70);
    for (const other of traffic.vehicles) if (other !== car && other.direction === car.direction) assert.ok(Math.abs(other.s - car.s) > 300);
  }
  traffic.dispose();
});

test('opposite lanes pass without collision and rotated footprints collide accurately', () => {
  const a = { x: 2.4, z: 0, heading: 0, halfWidth: 1, halfLength: 2 };
  assert.equal(trafficContact(a, { ...a, x: -2.4, heading: Math.PI }), null);
  assert.equal(trafficContact(a, { ...a, z: 4.1 }), null);
  const sideways = { ...a, x: 4.8, heading: Math.PI / 2 };
  const contact = trafficContact(a, sideways);
  assert.ok(contact && contact.depth > .5);
  assert.equal(trafficContact({ ...a, x: a.x + contact.x * (contact.depth + .01), z: a.z + contact.z * (contact.depth + .01) }, sideways), null);
});

test('a blow lands where the cars overlap and conserves momentum and spin', () => {
  const car = { x: 0, z: 0, heading: 0, halfWidth: 1, halfLength: 2, vx: 0, vz: -20 };
  // Square behind a slower car: the point is the nose, and nothing turns.
  const ahead = { ...car, z: -3.9, vz: -10 };
  let point = contactPoint(car, ahead);
  assert.ok(Math.abs(point.x) < 1e-9 && Math.abs(point.z + 1.95) < 1e-9);
  let blow = collisionImpulse(car, ahead, trafficContact(car, ahead), point);
  assert.ok(Math.abs(blow.a.spin) < 1e-12 && Math.abs(blow.b.spin) < 1e-12);
  // Equal cars part at a fifth of the speed they met at.
  assert.ok(Math.abs((-10 + blow.b.z) - (-20 + blow.a.z) + .2 * 10) < 1e-9);
  // Offset to the right: the point is the middle of the overlap. The car behind
  // is held back by its right corner and the one ahead is pushed on by its left,
  // so both swing their noses to the right.
  const offset = { ...ahead, x: 1.2 };
  point = contactPoint(car, offset);
  assert.ok(Math.abs(point.x - .6) < 1e-9 && Math.abs(point.z + 1.95) < 1e-9);
  blow = collisionImpulse(car, offset, trafficContact(car, offset), point);
  assert.ok(blow.a.spin > 0 && blow.b.spin > 0);
  assert.ok(blow.a.z > 0 && blow.a.z < 6, 'an offset hit moves the pair less than a square one');
  // A heavy car into the side of a light one, off-centre.
  const van = { x: -3.2, z: .4, heading: Math.PI / 2, halfWidth: 1.05, halfLength: 2.4, vx: 15, vz: 0 }, hatch = { ...car, halfWidth: .9, halfLength: 1.7, vz: -16 };
  const normal = trafficContact(van, hatch);
  point = contactPoint(van, hatch);
  assert.ok(Math.abs(point.x + .8) < 1e-9 && Math.abs(point.z - .4) < 1e-9);
  blow = collisionImpulse(van, hatch, normal, point);
  const mass = body => 4 * body.halfWidth * body.halfLength, inertia = body => mass(body) * (body.halfWidth ** 2 + body.halfLength ** 2) / 3;
  assert.ok(Math.abs(mass(van) * blow.a.x + mass(hatch) * blow.b.x) < 1e-9 && Math.abs(mass(van) * blow.a.z + mass(hatch) * blow.b.z) < 1e-9);
  const turning = (body, change) => inertia(body) * change.spin + mass(body) * (body.x * change.z - body.z * change.x);
  assert.ok(Math.abs(turning(van, blow.a) + turning(hatch, blow.b)) < 1e-9, 'angular momentum about the origin');
  assert.ok(Math.hypot(blow.b.x, blow.b.z) > Math.hypot(blow.a.x, blow.a.z) * 1.5, 'the light car moves more');
  assert.ok(blow.b.spin < 0, 'struck behind its middle from the left, the hatchback swings its nose left');
  // Already coming apart: no blow at all.
  assert.equal(collisionImpulse({ ...car, vz: -5 }, ahead, trafficContact(car, ahead), contactPoint(car, ahead)), null);
});

test('rear, head-on, reverse, and side impacts separate the cars and share the blow', () => {
  for (const scenario of ['rear', 'head-on', 'reverse', 'side']) {
    const { player, traffic } = setup();
    const car = traffic.vehicles[0];
    car.s = player.s + (scenario === 'reverse' ? -3.3 : scenario === 'side' ? 0 : 3.3);
    if (scenario === 'head-on') car.direction = -1;
    player.speed = scenario === 'reverse' ? -7 : 28;
    if (scenario === 'side') { player.u = .9; player.heading = Math.PI / 2; }
    player.update(0, {}); traffic.pose(car);
    const speed = player.speed, distance = player.distance, impacts = player.audioTelemetry.impactSerial;
    const weight = body => body.spec.width * body.spec.length, momentum = () => weight(player) * player.velocity.z - weight(car) * car.direction * car.speed;
    const before = momentum();
    assert.ok(trafficContact(playerFootprint(player), footprint(car)), scenario);
    traffic.collide(player);
    if (scenario === 'rear') {
      // The car ahead is shoved on and the player drops to just under its new speed.
      assert.ok(car.speed > 20 && player.speed < 24 && player.speed > 16, `${player.speed} ${car.speed}`);
      assert.ok(Math.abs(car.speed - player.speed - .2 * 12) < 1e-9);
      assert.ok(Math.abs(momentum() - before) < 1e-9);
    } else if (scenario === 'head-on') {
      // Both are stopped, or nearly. The car is never driven backwards, and the player never sent on through it.
      assert.ok(player.speed >= 0 && player.speed < 8 && car.speed === 0 && player.velocity.z > -8, `${player.speed} ${car.speed}`);
    } else if (scenario === 'reverse') {
      // Backing into a moving car stops the player, who is knocked on ahead of it, never sent forward in gear.
      assert.equal(player.speed, 0);
      assert.ok(player.velocity.z < -3 && car.speed < 4, `${player.velocity.z} ${car.speed}`);
    } else {
      // Into the side of a passing car: it is pushed across its lane and keeps its speed along the road.
      assert.ok(player.speed < 16 && player.speed > 8 && car.drift > 10, `${player.speed} ${car.drift}`);
      assert.ok(Math.abs(car.speed - TRAFFIC_CRUISE_SPEED) < 1e-9);
    }
    assert.ok(Math.abs(player.speed) <= Math.abs(speed) && player.audioTelemetry.impactSerial === impacts + 1, scenario);
    assert.equal(trafficContact(playerFootprint(player), footprint(car)), null, scenario);
    assert.equal(player.distance, distance);
    assert.equal(player.audioTelemetry.speed, player.speed);
    assert.deepEqual(player.currentPose.position, player.groundedPosition);
    assert.ok(player.u >= -4.65 && player.u <= 4.65);
    traffic.dispose();
  }
});

test('a sideswipe costs little speed, turns the player away, and the other car recovers its lane', () => {
  const { player, traffic } = setup();
  const car = traffic.vehicles[0]; car.s = player.s + 1.5; traffic.pose(car);
  // Drawing level with a car in the next lane over, and drifting right into its side.
  player.u = 0; player.heading = .1; player.speed = 24; player.update(0, {});
  let pushed = 0, turned = 0, contacts = 0;
  const resolve = player.resolveTrafficCollision.bind(player);
  player.resolveTrafficCollision = (...args) => { contacts++; resolve(...args); };
  for (let i = 0; i < 60 * 6; i++) {
    player.update(1 / 60, { forward: true }); traffic.update(1 / 60, player);
    pushed = Math.max(pushed, car.u - 2.4); turned = Math.max(turned, Math.abs(car.yaw));
    assert.ok(Math.abs(car.u - 2.4) <= 1.2 + 1e-9 && player.u >= -4.65 && player.u <= 4.65);
    if (i === 30) {
      assert.ok(contacts > 0, 'the cars never met');
      assert.ok(player.speed > 24 * .85, `a glancing blow took the speed down to ${player.speed}`);
      assert.ok(player.heading < .06, `the player was not turned away, heading ${player.heading}`);
    }
  }
  assert.ok(pushed > .05 && turned > .01, `the struck car never moved: ${pushed} m, ${turned} rad`);
  assert.equal(car.u, 2.4); assert.equal(car.yaw, 0); assert.equal(car.drift, 0); assert.equal(car.spin, 0);
  assert.deepEqual(player.knock, { x: 0, z: 0, spin: 0 });
  traffic.dispose();
});

test('full-speed simulation catches an impact between fixed steps', () => {
  const { player, traffic } = setup();
  const car = traffic.vehicles[0]; car.s = player.s + 12; car.speed = 0; car.cruiseSpeed = 0; traffic.pose(car);
  player.speed = 28;
  let hit = false;
  for (let i = 0; i < 60; i++) {
    player.update(1 / 60, { forward: true }); traffic.update(1 / 60, player);
    if (player.speed < 16 && car.speed > 10) hit = true;
    assert.ok(player.s < car.s, 'player tunneled through the stopped car');
  }
  assert.ok(hit);
  traffic.dispose();
});

test('a car hit from behind is pushed on rather than stopped, and a shoved car eases back to its cruise', () => {
  const { player, traffic } = setup();
  const car = traffic.vehicles[0]; car.s = player.s - 3.3; traffic.pose(car);
  player.speed = 4; player.update(0, {});
  traffic.collide(player);
  assert.ok(player.speed > 8 && car.speed < TRAFFIC_CRUISE_SPEED && car.speed > 4, `${player.speed} ${car.speed}`);
  car.s = player.s + 300; car.speed = 24; player.u = 8;
  for (let i = 0; i < 60; i++) traffic.update(1 / 60, player);
  assert.ok(car.speed > 21 && car.speed < 23, `a shoved car should coast down, not brake: ${car.speed}`);
  traffic.dispose();
});

test('weight decides a head-on: a family car is held, the rig ploughs on, and never through the car behind', () => {
  const held = id => {
    const scene = new THREE.Scene(), player = new DrivingController(straightRoute, { s: 24 }, id), traffic = new Traffic(scene, straightRoute, 24);
    const [car, behind] = traffic.vehicles.filter(car => car.direction < 0);
    traffic.respawn(car, player.s + 30); player.u = -2.4; player.speed = 20; player.update(0, {});
    const from = car.s;
    let thrown = 0, furthest = from;
    for (let i = 0; i < 60 * 12; i++) {
      // Another oncoming car draws up behind the struck one part way through.
      if (i === 120) traffic.respawn(behind, car.s + 60);
      player.update(1 / 60, { forward: true }); traffic.update(1 / 60, player);
      thrown = Math.max(thrown, car.recoil); furthest = Math.max(furthest, car.s);
      assert.ok(car.speed >= 0 && car.recoil >= 0 && player.s < car.s);
      if (i >= 120) assert.ok(behind.s - car.s > (car.spec.length + behind.spec.length) / 2, `${id} pushed one car through another`);
    }
    const result = { thrown, pushed: furthest - from, speed: player.speed, mass: player.spec.mass };
    traffic.dispose(); player.disposeModel();
    return result;
  };
  const family = held('auto'), rig = held('rig');
  assert.ok(family.mass < 1.5 && rig.mass === 8);
  assert.ok(family.pushed < 3 && family.speed < 2.5, `a family car bulldozed the oncoming car ${family.pushed} m and is doing ${family.speed}`);
  assert.ok(rig.thrown > family.thrown * 1.5 && rig.pushed > 6, `the rig only pushed the car ${rig.pushed} m`);
  assert.ok(rig.speed < 2.5, 'with a second car stopped behind the first, even the rig is held');
});

test('traffic brakes behind a parked player and maintains a gap', () => {
  const { player, traffic } = setup();
  const car = traffic.vehicles[0]; car.s = player.s - 65; traffic.pose(car);
  const start = player.s;
  for (let i = 0; i < 60 * 15; i++) {
    player.update(1 / 60, {}); traffic.update(1 / 60, player);
    assert.equal(player.s, start);
    assert.equal(trafficContact(playerFootprint(player), footprint(car)), null);
  }
  assert.ok(car.speed < .1); assert.ok(player.s - car.s > 8);
  traffic.dispose();
});

test('traffic geometry stays stable through long straight drives, reverse travel, and rebasing', () => {
  for (const [journey, route] of [['city', citydriverRoute]]) {
    const { player, traffic } = setup(route, 1020);
    traffic.reset(route, player.s, journey);
    assert.equal(traffic.spacing, 1);
    const geometries = new Set(traffic.vehicles.flatMap(car => car.car.children.map(mesh => mesh.geometry)));
    // Keep the test driver on the shoulder so it can cover distance unimpeded.
    for (let i = 0; i < 60 * 90; i++) {
      player.s += (i < 60 * 60 ? 28 : -7) / 60; player.u = 8; player.update(0, {});
      traffic.update(1 / 60, player);
      if (i % 120 !== 0) continue;
      const origin = Math.floor(player.s / 1024) * 1024;
      traffic.render(.5, origin);
      for (const car of traffic.vehicles) {
        assert.equal(car.u, car.direction * 2.4);
        assert.ok(Math.abs(car.s - player.s) < 625 * traffic.spacing);
        assert.ok(Math.abs(car.position.y - route.height(car.s, car.u) - .13) < 1e-8);
        assert.ok(car.quaternion.toArray().every(Number.isFinite));
        assert.ok(Math.abs(car.car.getWorldPosition(new THREE.Vector3()).z) < 1024 + 625 * traffic.spacing);
        assert.ok(car.car.children.every(mesh => geometries.has(mesh.geometry)));
      }
    }
    assert.ok(traffic.vehicles.some(car => car.generation > 2));
    for (const s of [100000, -100000, 24]) {
      player.s = s; player.reset(); traffic.update(1 / 60, player);
      assert.ok(traffic.vehicles.every(car => Math.abs(car.s - s) < 625 * traffic.spacing));
    }
    traffic.dispose();
  }
});

test('rendering interpolates without moving simulation, and resets clear nearby traffic', () => {
  const { player, traffic } = setup();
  traffic.update(1 / 60, player);
  const car = traffic.vehicles[0], s = car.s;
  traffic.render(.5, 1024);
  assert.ok(Math.abs(car.car.position.z - (car.previousPosition.z + car.position.z) / 2) < 1e-8);
  const pose = car.car.getWorldPosition(new THREE.Vector3());
  traffic.render(.5, 1024);
  assert.deepEqual(car.car.getWorldPosition(new THREE.Vector3()), pose); assert.equal(car.s, s);
  car.s = player.s; traffic.pose(car); traffic.clearNear(player);
  assert.ok(Math.abs(car.s - player.s) > 250);
  assert.deepEqual(car.previousPosition, car.position);
  traffic.dispose();
});

test('route changes reuse resources, switch lamps, and disposal releases the fleet', () => {
  const { scene, traffic } = setup();
  const car = traffic.vehicles[0], mesh = car.car.children[0], geometry = mesh.geometry;
  const headlights = car.car.children[2].material;
  traffic.reset(citydriverRoute, 2000, 'snow'); assert.ok(headlights.emissiveIntensity > 2);
  traffic.respawn(car, 2020); traffic.render(.5, 1024);
  const { rig, light } = traffic.headlightRigs[0];
  assert.equal(rig.parent, traffic.group);
  assert.deepEqual(rig.position, car.car.position);
  assert.deepEqual(rig.quaternion.toArray(), car.car.quaternion.toArray());
  assert.ok(light.intensity > 0); assert.equal(light.castShadow, false);
  traffic.reset(citydriverRoute, -4000, 'desert'); assert.ok(headlights.emissiveIntensity < 1);
  assert.ok(traffic.headlightRigs.every(({ rig }) => rig.parent === null));
  assert.equal(car.car.children[0].geometry, geometry);
  assert.deepEqual(car.position, car.previousPosition);
  let disposed = false; geometry.addEventListener('dispose', () => { disposed = true; });
  traffic.dispose(); assert.equal(scene.children.length, 0); assert.ok(disposed);
});
