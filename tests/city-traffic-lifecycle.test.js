import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityTraffic } from '../src/city-traffic.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute, journeyStart } from '../src/world/city-route.js';
import { TRAFFIC_MODELS } from '../src/traffic-models.js';
import { trafficContact } from '../src/collision.js';

function setup(t) {
  const scene = new THREE.Scene(), player = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  const traffic = new CityTraffic(scene, player.route, player.s, 'city', player.u);
  t.after(() => { if (traffic.group.parent) traffic.dispose(); player.disposeModel(); });
  return { scene, player, traffic };
}

test('disabled city traffic stays hidden and still through resets, then respawns clear of the player', t => {
  const { player, traffic } = setup(t);
  traffic.setEnabled(false, player);
  const positions = traffic.vehicles.map(car => car.position.clone());
  let collisions = 0;
  player.resolveTrafficCollision = () => { collisions++; };
  traffic.update(1, player); traffic.render(1);
  assert.equal(collisions, 0);
  assert.equal(traffic.group.visible, false);
  assert.deepEqual(traffic.vehicles.map(car => car.position), positions);
  traffic.reset(player.route, player.s, 'city', player.u);
  assert.equal(traffic.enabled, false);
  assert.equal(traffic.group.visible, false);
  traffic.setEnabled(true, player);
  assert.equal(traffic.group.visible, true);
  const active = traffic.vehicles.filter(car => car.edge);
  assert.ok(active.length > 10);
  for (const car of active) {
    assert.equal(trafficContact(player.motion(), traffic.motion(car)), null, 'respawns without overlapping the player');
    assert.deepEqual(car.previousPosition, car.position);
  }
});

test('the city fleet uses all road-car shapes, varied paint and finite shared geometry', t => {
  const { traffic } = setup(t);
  const cars = traffic.vehicles.filter(car => !car.service);
  assert.deepEqual(new Set(cars.map(car => car.spec.name)), new Set(TRAFFIC_MODELS.map(spec => spec.name)));
  assert.ok(new Set(cars.map(car => car.paint.color.getHex())).size >= 3);
  for (const car of cars) {
    const meshes = [];
    car.car.traverse(object => { if (object.isMesh) meshes.push(object); });
    assert.equal(meshes.length, 1);
    const positions = meshes[0].geometry.attributes.position;
    assert.ok(positions.count > 0 && [...positions.array].every(Number.isFinite));
  }
});

test('city traffic interpolates and rebases without changing simulation or actor identity', t => {
  const { player, traffic } = setup(t);
  traffic.update(1 / 60, player);
  const car = traffic.vehicles.find(car => car.edge), actor = car.actor;
  const state = { s: car.s, u: car.u, heading: car.heading, position: car.position.clone(), quaternion: car.quaternion.clone() };
  const expected = car.previousPosition.clone().lerp(car.position, .5);
  const orientation = car.previousQuaternion.clone().slerp(car.quaternion, .5);
  for (const origin of [0, 1024, -1024, 0]) {
    traffic.render(.5, origin);
    assert.deepEqual(car.car.position, expected);
    assert.deepEqual(car.car.quaternion.toArray(), orientation.toArray());
    assert.deepEqual(car.car.getWorldPosition(new THREE.Vector3()), expected.clone().add(new THREE.Vector3(0, 0, origin)));
    assert.deepEqual({ s: car.s, u: car.u, heading: car.heading, position: car.position, quaternion: car.quaternion }, state);
    assert.equal(car.actor, actor);
  }
});

test('city traffic resets reuse meshes, update lamp glow and dispose the whole fleet', t => {
  const { scene, player, traffic } = setup(t);
  const geometries = new Set(), disposed = new Set(), actors = [...traffic.fleet, ...traffic.woken].map(car => car.actor);
  traffic.group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
  });
  for (const geometry of geometries) geometry.addEventListener('dispose', () => disposed.add(geometry));
  for (let i = 0; i < 3; i++) {
    traffic.reset(player.route, player.s, 'city', player.u);
    traffic.render(1);
    traffic.group.traverse(object => { if (object.geometry) assert.ok(geometries.has(object.geometry)); });
    for (const car of traffic.vehicles) assert.deepEqual(car.previousPosition, car.position);
  }
  traffic.models.setLights(1);
  const night = traffic.models.glow.head.value.clone();
  traffic.models.setLights(0);
  assert.ok(night.r > traffic.models.glow.head.value.r);
  traffic.dispose();
  assert.equal(scene.children.includes(traffic.group), false);
  assert.ok(actors.every(actor => actor.disposed));
  assert.deepEqual(disposed, geometries);
});
