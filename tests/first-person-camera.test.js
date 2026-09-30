import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FirstPersonCamera } from '../src/first-person-camera.js';
import { DrivingController } from '../src/vehicle.js';
import { CARS } from '../src/cars.js';

test('recenter levels first-person walking without turning the player and returns a driver to the road', () => {
  for (const walking of [false, true]) for (const fps of [30, 60, 120]) {
    const rig = new FirstPersonCamera(), car = new THREE.Object3D(); car.userData.leash = walking;
    rig.update(car, 0); rig.look(1, -.5); rig.update(car, 1 / fps);
    const heading = rig.heading; rig.recenter(car);
    for (let i = 0; i < fps * 2; i++) rig.update(car, 1 / fps);
    assert.equal(rig.lookYaw, 0); assert.equal(rig.lookPitch, 0);
    assert.equal(rig.heading, heading, 'walking keeps its heading, the driver keeps the car heading');
    rig.look(.2, .1); assert.equal(rig.centering, false);
  }
});

test('first-person camera follows every windshield and faces the car heading', () => {
  const vehicle = new DrivingController(), rig = new FirstPersonCamera();
  for (const id of Object.keys(CARS)) {
    vehicle.setCar(id);
    for (const heading of [-Math.PI, -.7, 0, 2.9, Math.PI]) {
      const car = vehicle.car;
      car.position.set(15, 8, -300);
      car.rotation.set(0, heading, .25, 'YXZ');
      rig.snap(); rig.update(car, 0);
      const eye = car.userData.driverEye;
      assert.equal(eye.x, CARS[id].shape.eye?.[0] ?? 0, 'view follows the driver seat');
      // The rig and the monster truck seat their drivers well above a road car's roof.
      assert.ok(eye.y > .7 && eye.y < 3);
      const expected = eye.clone().applyQuaternion(car.quaternion).add(car.position);
      assert.ok(rig.camera.position.distanceTo(expected) < 1e-9);
      const forward = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
      assert.ok(rig.camera.getWorldDirection(new THREE.Vector3()).distanceTo(forward) < 1e-9);
      assert.ok(Math.abs(rig.camera.matrixWorld.elements[1]) < 1e-9, 'horizon stays level');
    }
  }
});

test('first-person camera handles terrain, origin rebases, resets, and phone rotation', () => {
  const car = new THREE.Object3D(), rig = new FirstPersonCamera();
  rig.update(car, 0);
  car.rotation.set(.4, 1, .3, 'YXZ');
  rig.update(car, 1 / 60);
  assert.ok(rig.pitch > 0 && rig.pitch < .05, 'terrain pitch eases in');
  for (let i = 0; i < 180; i++) rig.update(car, 1 / 60);
  assert.ok(Math.abs(rig.pitch - .4) < 1e-8);
  const before = rig.camera.position.clone();
  car.position.z += 20000; rig.update(car, 0);
  assert.ok(rig.camera.position.clone().sub(before).distanceTo(new THREE.Vector3(0, 0, 20000)) < 1e-8);
  car.rotation.x = -.2; rig.snap(); rig.update(car, 0);
  assert.equal(rig.pitch, -.2);
  for (const aspect of [390 / 844, 844 / 390, 16 / 9]) {
    rig.resize(aspect);
    assert.equal(rig.camera.aspect, aspect);
    assert.ok(rig.camera.fov >= 70 && rig.camera.fov < 91);
    const roadAhead = rig.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(20).add(rig.camera.position).project(rig.camera);
    assert.ok(Math.abs(roadAhead.x) < 1e-9 && Math.abs(roadAhead.y) < 1e-9);
  }
});

test('cockpit depth precision increases in open air and restores close clipping near scenery', () => {
  const car = new THREE.Object3D(), rig = new FirstPersonCamera();
  let room = 1;
  rig.clearance = () => room;
  rig.update(car, 0); assert.equal(rig.camera.near, .1, 'normal driving stays unchanged');
  car.position.y = 100; car.userData.chaseDip = 1;
  rig.update(car, 0); assert.equal(rig.camera.near, 1);
  const ground = new THREE.Vector3(0, .007, -150), asphalt = new THREE.Vector3(0, 0, -150);
  rig.look(0, .6); rig.update(car, 0);
  const separation = () => Math.abs(ground.clone().project(rig.camera).z - asphalt.clone().project(rig.camera).z);
  const improved = separation();
  room = .1; rig.update(car, 1 / 60);
  assert.equal(rig.camera.near, .1, 'nearby scenery restores the close plane in one frame');
  assert.ok(improved > separation() * 9, 'thin ground layers gain depth precision');
  room = 1; car.userData.lid = rig.camera.position.y + .3; rig.update(car, 0);
  assert.ok(rig.camera.near <= .15 + 1e-9, 'a bridge limits the near plane too');
  car.userData.lid = null; car.userData.chaseDip = 0; rig.snap(); rig.update(car, 0);
  assert.equal(rig.camera.near, .1, 'landing or changing to a car restores the close plane');
  car.userData.chaseDip = 1; rig.clearance = null; rig.update(car, 0);
  assert.equal(rig.camera.near, .1, 'missing scenery information keeps conservative clipping');
});

test('into a car through their eyes, the view turns from where they looked to the road ahead', () => {
  for (const fps of [30, 60, 120]) {
    const rig = new FirstPersonCamera(), walker = new THREE.Object3D(), car = new THREE.Object3D(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
    walker.userData.leash = true; walker.position.set(1.4, 0, 0);
    rig.update(walker, 0); rig.look(1.2, 0); rig.update(walker, 1 / fps);
    const yaw = () => euler.setFromQuaternion(rig.camera.quaternion).y, looked = yaw(), eye = rig.camera.position.clone();
    rig.update(car, 1 / fps);
    assert.ok(Math.abs(yaw() - looked) < .3, `turned ${(yaw() - looked).toFixed(2)} rad in a frame`);
    assert.ok(rig.camera.position.distanceTo(eye) < .5, 'and the eye glides to the seat');
    for (let i = 0; i < fps * 2; i++) rig.update(car, 1 / fps);
    assert.ok(Math.abs(yaw()) < 1e-3, 'looking ahead once in');
  }
});
