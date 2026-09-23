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
