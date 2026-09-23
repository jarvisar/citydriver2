import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { balancingBeam } from '../src/world/city-sculptures.js';

test('balancing sculpture keeps its silhouette with one face at every beam join, front and rear', () => {
  const material = new THREE.MeshBasicMaterial();
  const orange = new THREE.Mesh(new THREE.BoxGeometry(5, 22, 5), material);
  orange.position.set(-3, 11, 0); orange.rotation.z = -.35; orange.updateMatrixWorld();
  const originalGold = new THREE.Mesh(new THREE.BoxGeometry(5, 17, 5), material);
  originalGold.position.set(4, 19, 0); originalGold.rotation.z = .8; originalGold.updateMatrixWorld();
  const gold = new THREE.Mesh(balancingBeam, material); gold.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  let joinedSamples = 0;
  try {
    for (const side of [-1, 1]) for (let x = -10.13; x < 13; x += .47) for (let y = .19; y < 28; y += .53) {
      ray.set(new THREE.Vector3(x, y, side * 10), new THREE.Vector3(0, 0, -side));
      const onOrange = ray.intersectObject(orange).length > 0;
      const onOriginalGold = ray.intersectObject(originalGold).length > 0;
      const onGold = ray.intersectObject(gold).length > 0;
      assert.equal(onOrange || onGold, onOrange || onOriginalGold, 'the combined silhouette stays intact');
      assert.equal(onOrange && onGold, false, 'the colored beams never compete for the same surface');
      if (onOrange && onOriginalGold) joinedSamples++;
    }
    assert.ok(joinedSamples > 50, 'exercise the overlapping region from both sides');
  } finally {
    orange.geometry.dispose(); originalGold.geometry.dispose(); material.dispose();
  }
});
