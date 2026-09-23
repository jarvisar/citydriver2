import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { cityCell } from '../src/world/city.js';
import { journeyStart, PAVEMENT_LEVEL } from '../src/world/city-route.js';
import { collideScenery } from '../src/collision.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute } from '../src/world/city-route.js';

test('the world streams detailed chunks around the car and keeps the skyline everywhere else', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  try {
    const start = journeyStart();
    world.update(start.s, start.u);
    while (world.pending.length) world.update(start.s, start.u);
    assert.ok(world.chunks.size >= 9, `${world.chunks.size} detailed chunks`);
    assert.equal(world.distantPending.length, 0);
    assert.ok(world.distant.size > 100);
    for (const chunk of world.chunks.values()) {
      assert.ok(chunk.collisionBounds);
      assert.equal(world.distant.get(chunk.index).group.visible, false, 'the skyline hides under a detailed chunk');
      for (const c of chunk.features.colliders) {
        assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z) && c.reach > 0);
        if (c.corners) assert.equal(c.corners.length >= 3, true);
      }
    }
    const colliders = [...world.chunks.values()].reduce((n, c) => n + c.features.colliders.length, 0);
    const lamps = [...world.chunks.values()].reduce((n, c) => n + c.features.lamps.length, 0);
    const walkers = [...world.chunks.values()].reduce((n, c) => n + (c.walkers?.length ?? 0), 0);
    assert.ok(colliders > 100 && lamps > 10 && walkers > 10, `${colliders} colliders, ${lamps} lamps, ${walkers} walkers`);
    assert.ok(scene.getObjectByName('citydriver-roads') && scene.getObjectByName('citydriver-ground') && scene.getObjectByName('citydriver-water'));
    // Moving far away frees the old detail and streams new chunks within a frame budget
    const far = { s: start.s + 800, u: start.u - 600 }, cell = cityCell(far.s, far.u);
    const before = world.chunks.size;
    world.update(far.s, far.u, { budgetMs: 2 });
    for (const chunk of world.chunks.values()) {
      assert.ok(Math.max(Math.abs(chunk.ix - cell.ix), Math.abs(chunk.iz - cell.iz)) <= world.radius, `old detail released (${chunk.index})`);
    }
    for (let ix = cell.ix - 1; ix <= cell.ix + 1; ix++) for (let iz = cell.iz - 1; iz <= cell.iz + 1; iz++) {
      if (world.inCity(ix, iz)) assert.ok(world.chunks.has(`${ix},${iz}`), `the collision neighbourhood is complete (${ix},${iz})`);
    }
    assert.ok(world.chunks.size < before, 'the far ring waits for later frames');
    assert.ok(world.pending.length > 0, 'the outer ring streams in over later frames');
    for (let i = 0; i < 400 && world.pending.length; i++) world.update(far.s, far.u, { budgetMs: 2 });
    assert.equal(world.pending.length, 0);
    world.animate(1, 1, null, null); world.animate(2, 2, null, null);
    world.setWetness(.5); assert.ok(world.materials.road.roughness < .6);
    assert.ok(world.warmupObjects().length > 5);
  } finally { world.dispose(); }
  assert.equal(scene.getObjectByName('citydriver-roads'), undefined);
});

test('buildings block the car and the parks and water stay open', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  const car = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  try {
    car.toggleFreeDriving();
    world.update(car.s, car.u); while (world.pending.length) world.update(car.s, car.u);
    // Aim the car at the nearest building footprint and drive into it
    const target = [...world.chunks.values()].flatMap(c => c.features.colliders).filter(c => c.corners && c.corners.length === 4)
      .sort((a, b) => Math.hypot(a.x - car.u, a.z + car.s) - Math.hypot(b.x - car.u, b.z + car.s))[0];
    assert.ok(target, 'a building near the start');
    car.heading = Math.atan2(target.x - car.u, -target.z - car.s);
    let closest = Infinity;
    for (let i = 0; i < 60 * 12; i++) {
      car.update(1 / 60, { forward: true });
      collideScenery(car, world.chunks, 1 / 60);
      closest = Math.min(closest, Math.hypot(target.x - car.u, -target.z - car.s));
    }
    assert.ok(closest > 1, `the car stopped ${closest} m from the building centre`);
    assert.ok(closest < target.reach + 6, 'the car reached the building');
  } finally { world.dispose(); car.disposeModel(); }
});
