import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraTransition, carryCameraLook } from '../src/camera-transition.js';
import { ThirdPersonCamera } from '../src/third-person-camera.js';
import { FirstPersonCamera } from '../src/first-person-camera.js';

const forward = camera => camera.getWorldDirection(new THREE.Vector3());

test('zoom carries driving and walking gaze between the existing cameras', () => {
  for (const walking of [false, true]) for (const heading of [-2.9, 0, 2.9]) {
    const car = new THREE.Object3D(); car.rotation.y = heading; car.userData.leash = walking;
    const chase = new ThirdPersonCamera(), first = new FirstPersonCamera();
    chase.setZoom(.45); chase.update(car, 0); chase.look(.7, .2); chase.update(car, 0);
    const gaze = forward(chase.camera);
    carryCameraLook(first, chase.camera, car);
    assert.ok(forward(first.camera).distanceTo(gaze) < 1e-9, 'entering first person keeps the gaze');
    chase.snap(); carryCameraLook(chase, first.camera, car);
    assert.ok(forward(chase.camera).distanceTo(gaze) < 1e-9, 'returning to chase keeps the gaze');
    first.update(car, 1 / 60); chase.update(car, 1 / 60);
    assert.ok(forward(first.camera).distanceTo(gaze) < 1e-9);
    assert.ok(forward(chase.camera).distanceTo(gaze) < 1e-9);
  }
});

test('zoom glide starts at the drawn lens and settles at the destination at different frame rates', () => {
  for (const fps of [30, 60, 120]) {
    const car = new THREE.Object3D(), source = new THREE.PerspectiveCamera(45, 16 / 9, .4, 1200);
    const target = new THREE.PerspectiveCamera(70, 16 / 9, .1, 1200), glide = new CameraTransition();
    source.position.set(0, 4, 7); source.lookAt(0, 2, -4);
    target.position.set(-.5, 1.7, -1); target.rotation.y = .6; target.updateMatrixWorld();
    glide.start(source, car); glide.update(target, car, 0);
    assert.ok(glide.camera.position.distanceTo(source.position) < 1e-9);
    assert.ok(glide.camera.quaternion.angleTo(source.quaternion) < 1e-7);
    let distance = source.position.distanceTo(target.position);
    for (let frame = 0; frame < fps; frame++) {
      glide.update(target, car, 1 / fps);
      const next = glide.camera.position.distanceTo(target.position);
      assert.ok(next <= distance + 1e-9, 'the glide approaches without overshoot');
      assert.ok(glide.camera.fov >= source.fov && glide.camera.fov <= target.fov);
      assert.equal(glide.camera.near, .1, 'keep the close clipping plane throughout the glide');
      distance = next;
    }
    assert.equal(glide.active, false);
    assert.ok(distance < 1e-9);
    assert.ok(glide.camera.quaternion.angleTo(target.quaternion) < 1e-7);
    assert.equal(glide.camera.fov, target.fov);
  }
});

test('reversing a glide starts from the current lens and follows movement and world rebasing', () => {
  const car = new THREE.Object3D(), source = new THREE.PerspectiveCamera(45), target = new THREE.PerspectiveCamera(70);
  source.position.set(0, 4, 7); target.position.set(0, 1.7, -1);
  const glide = new CameraTransition(); glide.start(source, car); glide.update(target, car, .1);
  const position = glide.camera.position.clone(), rotation = glide.camera.quaternion.clone(), fov = glide.camera.fov;
  glide.start(glide.camera, car); glide.update(source, car, 0);
  assert.ok(glide.camera.position.distanceTo(position) < 1e-9);
  assert.ok(glide.camera.quaternion.angleTo(rotation) < 1e-7);
  assert.equal(glide.camera.fov, fov);
  const moved = new THREE.Vector3(3, 2, 20000);
  car.position.add(moved); source.position.add(moved);
  glide.update(source, car, 0);
  assert.ok(glide.camera.position.distanceTo(position.add(moved)) < 1e-9, 'a rebase adds no extra travel');
  glide.update(source, new THREE.Object3D(), .1);
  assert.equal(glide.active, false, 'a new subject cancels the old seat change');
});
