import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { cityCell, CITY } from '../src/world/city.js';
import { journeyStart, PAVEMENT_LEVEL, roadAt } from '../src/world/city-route.js';
import { insidePolygon, distanceToPolyline } from '../src/mapgen/polygon-util.js';
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
    // Well across the city, to a built-up street about 750 m away
    const far = CITY.lots.map(lot => ({ s: lot[0].y, u: lot[0].x })).sort((a, b) => Math.abs(Math.hypot(a.s - start.s, a.u - start.u) - 750) - Math.abs(Math.hypot(b.s - start.s, b.u - start.u) - 750))[0];
    const cell = cityCell(far.s, far.u);
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
    // Stand the car on the pavement a few metres in front of the nearest
    // building with nothing else in the way, facing it, and drive into it
    const colliders = [...world.chunks.values()].flatMap(c => c.features.colliders);
    const footprint = c => c.corners.map(p => ({ x: p.x, y: -p.z }));
    const near = (o, p, margin) => o.corners
      ? insidePolygon(p, footprint(o)) || distanceToPolyline(p, [...footprint(o), footprint(o)[0]]) < margin
      : Math.hypot(o.x - p.x, -o.z - p.y) < (o.radius ?? .5) + margin;
    let target = null, spot = null;
    for (const building of colliders.filter(c => c.corners && c.corners.length >= 4 && c.reach > 6)
      .sort((a, b) => Math.hypot(a.x - car.u, a.z + car.s) - Math.hypot(b.x - car.u, b.z + car.s))) {
      const centre = { x: building.x, y: -building.z }, road = roadAt(centre.y, centre.x, 80);
      if (!road) continue;
      // Out of the footprint toward the street, then a little further
      const dx = road.x - centre.x, dy = road.y - centre.y, length = Math.hypot(dx, dy) || 1, outline = footprint(building);
      let d = 0;
      while (d < length && insidePolygon({ x: centre.x + dx / length * d, y: centre.y + dy / length * d }, outline)) d += .25;
      const p = { x: centre.x + dx / length * (d + 3), y: centre.y + dy / length * (d + 3) };
      if (colliders.some(o => o !== building && near(o, p, 2.5))) continue;
      target = building; spot = p; break;
    }
    assert.ok(target, 'a building near the start');
    const outline = footprint(target);
    car.u = spot.x; car.s = spot.y; car.heading = Math.atan2(target.x - spot.x, -target.z - spot.y); car.speed = 0; car.update(0, {});
    let entered = false, closest = Infinity;
    for (let i = 0; i < 60 * 4; i++) {
      car.update(1 / 60, { forward: true });
      collideScenery(car, world.chunks, 1 / 60);
      const p = { x: car.u, y: car.s };
      if (insidePolygon(p, outline)) entered = true;
      closest = Math.min(closest, distanceToPolyline(p, [...outline, outline[0]]));
    }
    assert.ok(!entered, 'the car drove into the building');
    assert.ok(closest < 3, `the car reached the building (${closest.toFixed(1)} m)`);
  } finally { world.dispose(); car.disposeModel(); }
});
