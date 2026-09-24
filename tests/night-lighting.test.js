import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NightLighting } from '../src/night-lighting.js';
import { CityChunk, CitydriverWorld, blockBatches } from '../src/world/citydriver-world.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute, journeyStart } from '../src/world/city-route.js';
import { CityTraffic } from '../src/city-traffic.js';

test('night lighting has a fixed budget, switches off by day, and survives rebasing and car changes', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  const player = new DrivingController(citydriverRoute, journeyStart()), traffic = new CityTraffic(scene, player.route, player.s, 'city', player.u);
  const lighting = new NightLighting(scene);
  try {
    world.update(player.s, player.u); player.render(0, world.origin); traffic.render(1, world.origin);
    lighting.update(world, player, traffic, 1);
    assert.equal(lighting.group.children.length, 3);
    assert.ok(lighting.pools.count > 0 && lighting.pools.count <= 96);
    assert.ok(lighting.beams.count > 0 && lighting.beams.count <= 25);
    lighting.group.traverse(object => {
      assert.ok(!object.isLight); assert.ok(!object.castShadow);
      if (object.isMesh) assert.equal(object.userData.ambientOcclusion, false);
    });
    const before = new THREE.Matrix4(); lighting.pools.getMatrixAt(0, before);
    world.origin += 1024; player.car.position.z += 1024; traffic.render(1, world.origin);
    lighting.update(world, player, traffic, 1);
    const after = new THREE.Matrix4(); lighting.pools.getMatrixAt(0, after);
    assert.ok(Math.abs(after.elements[14] - before.elements[14] - 1024) < .001);
    const headlights = new THREE.Matrix4(); lighting.beams.getMatrixAt(0, headlights);
    // Ahead of the car, whichever way it faces (x east, z south)
    const ahead = (headlights.elements[12] - player.car.position.x) * Math.sin(player.heading) - (headlights.elements[14] - player.car.position.z) * Math.cos(player.heading);
    assert.ok(ahead > 0, 'player beam points forward');
    traffic.setEnabled(false, player); lighting.update(world, player, traffic, 1);
    assert.equal(lighting.beams.count, 1);
    player.setCar('formula'); lighting.update(world, player, traffic, 1);
    assert.equal(lighting.beams.count, 0, 'rear-only race lights do not gain headlights');
    lighting.update(world, player, traffic, 0); assert.equal(lighting.group.visible, false);
    lighting.update(world, player, traffic, .8); assert.equal(lighting.group.visible, true);
    assert.ok(lighting.pools.material.opacity > 0 && lighting.pools.material.opacity < .48);
  } finally { lighting.dispose(); traffic.dispose(); world.dispose(); }
  assert.equal(lighting.group.parent, null);
});

test('lamp light sources match rendered lenses on curved streets and bridges', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    let lit = 0;
    for (const [ix, iz] of [[0, 0], [3, 0], [-2, -3], [1, 1], [-1, 2]]) {
      const chunk = new CityChunk(world, ix, iz);
      const lamps = [...blockBatches(chunk.group)].find(batch => batch.name === 'lamp');
      if (!lamps) { assert.equal(chunk.features.lamps.length, 0); chunk.dispose(); continue; }
      lit++;
      assert.equal(chunk.features.lamps.length, lamps.count);
      for (let i = 0; i < lamps.count; i++) {
        const matrix = new THREE.Matrix4(); lamps.matrixAt(i, matrix);
        const point = new THREE.Vector3(-1.75, 7.36, 0).applyMatrix4(matrix);
        const source = chunk.features.lamps[i];
        assert.ok(Math.abs(point.x + chunk.east - source.x) < .0001);
        assert.ok(Math.abs(point.y - source.y) < .0001);
        assert.ok(Math.abs(point.z - chunk.start - source.z) < .0001);
      }
      chunk.dispose();
    }
    assert.ok(lit > 0, 'some chunk has lamps');
  } finally { world.dispose(); }
});
