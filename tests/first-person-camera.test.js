import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FirstPersonCamera } from '../src/first-person-camera.js';
import { DrivingController } from '../src/vehicle.js';
import { CARS } from '../src/cars.js';

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
