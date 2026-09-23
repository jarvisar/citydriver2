import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyWalkerHop, walkerTravelTime, holdWalkerTravel, PedestrianContacts,
  PEDESTRIAN_HOP_SECONDS as DURATION, PEDESTRIAN_HOP_HEIGHT as HEIGHT, PEDESTRIAN_PIVOT as PIVOT } from '../src/world/pedestrian-reactions.js';
import { walkerPose } from '../src/world/city-life.js';
import { TaxiView } from '../src/taxi-view.js';

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≈ ${b}`);
const car = (x = 0, z = 0, heading = 0) => ({ groundedPosition: new THREE.Vector3(x, 24.2, z),
  spec: { width: 2, length: 4 }, heading, speed: 12 });

test('hop makes exactly one smooth Z roll about a fixed center and lands without changing the original transform', () => {
  const original = new THREE.Matrix4().compose(new THREE.Vector3(12, 24.4, -30),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, .7, .03)), new THREE.Vector3(.95, 1.12, .95));
  const originalCenter = new THREE.Vector3(0, PIVOT, 0).applyMatrix4(original);
  const rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), translation = new THREE.Vector3();
  original.decompose(translation, rotation, scale);
  const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation), localY = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
  let previousAngle = 0;
  for (let i = 0; i <= 64; i++) {
    const walker = { hopStart: 10 }, matrix = original.clone(), t = i / 64;
    applyWalkerHop(walker, matrix, 10 + t * DURATION);
    const center = new THREE.Vector3(0, PIVOT, 0).applyMatrix4(matrix);
    close(center.x, originalCenter.x); close(center.z, originalCenter.z);
    close(center.y - originalCenter.y, HEIGHT * 16 * t * t * (1 - t) ** 2);
    const yAxis = new THREE.Vector3().setFromMatrixColumn(matrix, 1).normalize();
    let angle = Math.atan2(-yAxis.dot(localX), yAxis.dot(localY));
    if (angle < -1e-8) angle += Math.PI * 2;
    if (i === 64) angle = Math.PI * 2;
    assert.ok(angle >= previousAngle - 1e-8); previousAngle = angle;
    for (let axis = 0; axis < 3; axis++) close(new THREE.Vector3().setFromMatrixColumn(matrix, axis).length(), scale.getComponent(axis));
    if (i === 0 || i === 64) matrix.elements.forEach((n, k) => close(n, original.elements[k]));
  }
  // Endpoint motion tends to zero, so entering and leaving the hop cannot pop.
  for (const t of [1e-5, 1 - 1e-5]) {
    const matrix = original.clone(); applyWalkerHop({ hopStart: 0 }, matrix, t * DURATION);
    matrix.elements.forEach((n, k) => close(n, original.elements[k], 1e-7));
  }
});

test('swept contacts catch fast cars, respect heading and height, and ignore stopped cars and teleports', () => {
  const contacts = new PedestrianContacts(), vehicle = car(0, 5);
  vehicle.speed = 100;
  contacts.update(vehicle, null, 0); vehicle.groundedPosition.z = -5; contacts.update(vehicle, null, .1);
  assert.equal(contacts.hit({}, 0, 24.4, 0, .28, .1), true, 'crossed entirely between rendered frames');
  assert.equal(contacts.hit({}, 2, 24.4, 0, .28, .1), false, 'beside the footprint');
  assert.equal(contacts.hit({}, 0, 30, 0, .28, .1), false, 'different elevation');
  vehicle.groundedPosition.z = 0; vehicle.heading = Math.PI / 2; contacts.update(vehicle, null, 1);
  assert.equal(contacts.hit({}, 1.9, 24.4, 0, .28, 1), true);
  assert.equal(contacts.hit({}, 0, 24.4, 1.9, .28, 1), false);
  vehicle.speed = 0; contacts.update(vehicle, null, 2);
  assert.equal(contacts.hit({}, 0, 24.4, 0, .28, 2), false);
  vehicle.speed = 12; vehicle.groundedPosition.x = 1000; contacts.update(vehicle, null, 2.016);
  assert.equal(contacts.hit({}, 500, 24.4, 0, .28, 2.016), false);
});

test('traffic can trigger a hop and overlap cannot keep restarting it', () => {
  const contacts = new PedestrianContacts(), vehicle = car(100, 100), trafficCar = car(), walker = {};
  const traffic = { enabled: true, vehicles: [trafficCar] };
  contacts.update(vehicle, traffic, 0);
  assert.equal(contacts.hit(walker, 0, 24.4, 0, .28, 0), true);
  for (const time of [.1, .5, 1, 2]) {
    contacts.update(vehicle, traffic, time);
    assert.equal(contacts.hit(walker, 0, 24.4, 0, .28, time), false);
    assert.equal(walker.hopStart, 0);
  }
  traffic.enabled = false; contacts.update(vehicle, traffic, 3);
  assert.equal(contacts.hit(walker, 0, 24.4, 0, .28, 3), false);
  traffic.enabled = true; contacts.update(vehicle, traffic, 4);
  assert.equal(contacts.hit(walker, 0, 24.4, 0, .28, 4), true);
  assert.equal(walker.hopStart, 4);
});

test('travel freezes for the hop, resumes continuously, and paired walkers wait together', () => {
  const a = { phase: 12, speed: .9, direction: 1 }, b = { ...a };
  const start = walkerPose(a, 20);
  holdWalkerTravel(a, b, 20);
  for (const time of [20, 20.1, 20.4, 20 + DURATION]) {
    assert.deepEqual(walkerPose(a, walkerTravelTime(a, time)), start);
    assert.deepEqual(walkerPose(b, walkerTravelTime(b, time)), start);
  }
  close(walkerTravelTime(a, 21), 21 - DURATION); close(walkerTravelTime(b, 21), 21 - DURATION);
  holdWalkerTravel(a, b, 22); holdWalkerTravel(b, a, 22.2);
  close(walkerTravelTime(a, 22.5), 22 - DURATION);
  close(walkerTravelTime(a, 10000), 10000 - DURATION * 2 - .2);
  close(walkerTravelTime(b, 10000), walkerTravelTime(a, 10000));
});

test('taxi passengers hop in their rotated curb frame and keep reactions through marker rebuilds', () => {
  const view = new TaxiView(new THREE.Scene()), player = car(200, 200), contacts = new PedestrianContacts();
  const run = { running: true, status: 'pickup', revision: 1,
    customers: [{ id: 'hop-group', s: 24, u: 3, axis: 'north', side: 1, heading: 0, passengers: 2, color: '#ffffff' }] };
  try {
    view.render(run, player, 0, 10);
    const marker = view.markers[0], matrix = new THREE.Matrix4();
    marker.person.getMatrixAt(0, matrix);
    const local = new THREE.Vector3().setFromMatrixPosition(matrix);
    marker.group.updateMatrix(); local.applyMatrix4(marker.group.matrix);
    player.groundedPosition.set(local.x, 24.2, local.z); contacts.update(player, null, 10);
    view.render(run, player, 0, 10, contacts);
    assert.equal(marker.reactions[0].hopStart, 10);
    view.render(run, player, 0, 10 + DURATION / 2, contacts);
    marker.person.getMatrixAt(0, matrix);
    assert.ok(matrix.elements[5] < 0, 'upside down at the apex');
    const reactions = marker.reactions;
    view.rebuild(run); assert.equal(view.markers[0].reactions, reactions);
    view.render(run, player, 10000, 11, contacts);
    view.markers[0].person.getMatrixAt(0, matrix);
    assert.ok(matrix.elements[5] > 0); assert.equal(reactions[0].hopStart, undefined);
    view.reset(); view.render(run, player, 10000, 12);
    assert.notEqual(view.markers[0].reactions, reactions);
  } finally { view.dispose(); }
});
