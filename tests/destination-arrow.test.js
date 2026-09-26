import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DestinationArrow } from '../src/destination-arrow.js';

test('3D compass points directly to the destination relative to each camera heading', () => {
  const arrow = new DestinationArrow();
  const vehicle = { s: 120000, u: -42000, heading: 1.3 };
  try {
    for (const camera of [new THREE.PerspectiveCamera(45, 1.5, .1, 1200), new THREE.OrthographicCamera(-60, 60, 40, -40, 1, 1200)]) {
      for (const heading of [0, .7, -2.4, Math.PI]) {
        camera.position.set(500, 45, -1000);
        camera.lookAt(500 + Math.sin(heading) * 10, 35, -1000 - Math.cos(heading) * 10);
        for (const bearing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const target = { s: vehicle.s + Math.cos(bearing) * 500, u: vehicle.u + Math.sin(bearing) * 500 };
          arrow.update({ running: true, status: 'driving', target }, vehicle, camera);
          assert.equal(arrow.group.visible, true);
          assert.ok(Math.abs(Math.sin(arrow.mesh.rotation.y - (heading - bearing))) < 1e-8);
        }
      }
    }
    assert.ok(arrow.geometry.getAttribute('position').count / 3 < 150, 'a small mesh keeps the compass inexpensive');
    assert.equal(arrow.mesh.castShadow, false);
    for (const status of ['idle', 'pickup', 'over']) {
      arrow.update({ running: status === 'pickup', status, target: { s: 0, u: 0 } }, vehicle);
      assert.equal(arrow.group.visible, false, `${status} cannot show fare directions`);
    }
  } finally { arrow.dispose(); }
  assert.equal(arrow.scene.children.length, 0);
});

test('in a headset the arrow floats over the car, tilted to the camera and pointing at the drop-off', () => {
  const arrow = new DestinationArrow(), scene = new THREE.Scene(), car = new THREE.Object3D(), face = new THREE.Vector3(), toCamera = new THREE.Vector3();
  scene.add(arrow.headset); car.position.set(12, 1, -40);
  const vehicle = { s: 40, u: 12, heading: .4 }, camera = new THREE.PerspectiveCamera();
  try {
    for (const bearing of [0, 1.1, -2.5]) {
      const run = { running: true, status: 'driving', target: { s: vehicle.s + Math.cos(bearing) * 300, u: vehicle.u + Math.sin(bearing) * 300 } };
      for (const heading of [0, 2.2]) {
        camera.position.set(car.position.x - Math.sin(heading) * 14, 5.5, car.position.z + Math.cos(heading) * 14);
        camera.lookAt(car.position); camera.updateMatrixWorld();
        arrow.float(run, vehicle, car, camera, { visible: true });
        assert.equal(arrow.headset.visible, true);
        assert.ok(arrow.headset.position.y > car.position.y + 3, 'clear of the roof');
        // Turned as the card's arrow is, under a lens facing the camera's way
        assert.ok(Math.abs(Math.sin(arrow.headsetArrow.rotation.y - (heading - bearing))) < 1e-6);
        assert.ok(Math.abs(Math.sin(arrow.headset.rotation.y + heading)) < 1e-6);
        arrow.headset.updateMatrixWorld(true);
        face.set(0, 1, 0).transformDirection(arrow.headsetArrow.matrixWorld);
        toCamera.subVectors(camera.position, arrow.headset.position).normalize();
        assert.ok(face.dot(toCamera) > .4, 'its top faces the camera, rather than edge on');
      }
    }
    arrow.float({ running: true, status: 'pickup', target: null }, vehicle, car, camera, { visible: true });
    assert.equal(arrow.headset.visible, false, 'no drop-off, no arrow');
    arrow.float({ running: true, status: 'driving', target: { s: 0, u: 0 } }, vehicle, car, camera, { visible: false });
    assert.equal(arrow.headset.visible, false, 'only in a headset');
  } finally { arrow.dispose(); }
  assert.equal(arrow.headset.parent, null);
});
