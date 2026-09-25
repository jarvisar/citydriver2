import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverWorld, CityChunk } from '../src/world/citydriver-world.js';
import { planLot } from '../src/world/city-buildings.js';
import { cityTrees } from '../src/world/city-assets.js';
import { cityCell, CITY, CITY_CELL } from '../src/world/city.js';
import { journeyStart, PAVEMENT_LEVEL, roadAt } from '../src/world/city-route.js';
import { setResidentWindow } from '../src/world/resident.js';
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

test('roofs follow the buildings under them and trees keep their crowns off the walls', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    const plans = [], roofs = {};
    for (const lots of world.lotsByChunk.values()) for (const lot of lots) {
      const plan = planLot({ east: 0, start: 0 }, lot);
      if (plan.kind !== 'building') continue;
      plans.push(plan);
      roofs[plan.roofType] = (roofs[plan.roofType] ?? 0) + 1;
      // A pitched roof sits on a four-sided building of a few storeys, its
      // eave along a street front unless it is a shed's
      if (plan.roofType === 'gable') {
        assert.equal(plan.footprint.length, 4);
        assert.ok(plan.floors <= 6 && !plan.court.length);
        if (!['warehouse', 'pavilion'].includes(plan.type)) assert.ok(plan.street[plan.eaves], 'a terrace roof runs along its street');
      }
      // A house has an ordinary ground floor, not a shopfront's base
      if (plan.domestic) assert.ok(!plan.shopfront);
    }
    assert.ok(roofs.gable > 50 && roofs.flat > 50, JSON.stringify(roofs));
    // No tree crown reaches a metre into a building
    const cells = new Map(), key = (x, y) => `${Math.floor(x / 30)},${Math.floor(y / 30)}`;
    for (const plan of plans) {
      const seen = new Set();
      for (const p of plan.footprint) for (const [dx, dy] of [[-12, -12], [12, -12], [12, 12], [-12, 12], [0, 0]]) {
        const k = key(p.x + dx, p.y + dy);
        if (seen.has(k)) continue;
        seen.add(k); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(plan.footprint);
      }
    }
    const crown = Math.max(...cityTrees.map(tree => tree.radius));
    let trees = 0;
    for (let ix = CITY.ix0; ix <= CITY.ix1; ix++) for (let iz = CITY.iz0; iz <= CITY.iz1; iz++) {
      const chunk = new CityChunk(world, ix, iz);
      for (const tree of chunk.features.trees ?? []) {
        const p = { x: tree.x + chunk.east, y: tree.s + chunk.start }, reach = crown * tree.scale * 1.06;
        for (const footprint of cells.get(key(p.x, p.y)) ?? []) {
          assert.ok(!insidePolygon(p, footprint), `a tree in a building at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
          const into = reach - distanceToPolyline(p, [...footprint, footprint[0]]);
          assert.ok(into < 1.5, `a tree crown ${into.toFixed(1)} m into a wall at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
        }
        trees++;
      }
      chunk.dispose();
    }
    assert.ok(trees > 2000, `${trees} trees`);
  } finally { world.dispose(); }
});

// Basic detail keeps one ring of detailed chunks. Crossing into a cell used to
// build its new ring at once, a long stall on a phone; the ring starts a whole
// cell ahead, so it streams over later frames, is built ahead of time when
// the car is heading for it, and what the car has just left is kept aside.
test('at the lowest detail the ring ahead streams in, is built ahead of time, and the ring left behind is kept', () => {
  setResidentWindow({ behind: 1, ahead: 3 });
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  try {
    const start = journeyStart(), cell = cityCell(start.s, start.u), s = (cell.iz + .5) * CITY_CELL, middle = (cell.ix + .5) * CITY_CELL;
    const key = (ix, iz) => `${ix},${iz}`, column = ix => [-1, 0, 1].map(dz => key(ix, cell.iz + dz));
    world.update(s, middle); while (world.pending.length) world.update(s, middle);
    assert.equal(world.radius, 1); assert.equal(world.chunks.size, 9);
    const left = column(cell.ix - 1).map(k => world.chunks.get(k));
    // A metre into the next cell east: the new column is a cell ahead and waits
    world.update(s, (cell.ix + 1) * CITY_CELL + 1, { budgetMs: 0 });
    assert.deepEqual(world.pending.map(next => next.key).sort(), column(cell.ix + 2).sort());
    assert.ok(column(cell.ix + 2).every(k => !world.chunks.has(k)), 'nothing a cell ahead is built at once');
    for (const chunk of left) {
      assert.ok(world.spare.get(chunk.index) === chunk && !chunk.group.parent, 'the column left behind is kept out of the scene');
      assert.ok(world.distant.get(chunk.index).group.parent && world.distant.get(chunk.index).group.visible, 'and its skyline is back');
    }
    // Near enough for its colliders to reach the car, a chunk is built at once
    world.update(s, (cell.ix + 2) * CITY_CELL - 70, { budgetMs: 0 });
    assert.ok(world.chunks.has(key(cell.ix + 2, cell.iz)));
    assert.equal(world.distant.get(key(cell.ix + 2, cell.iz)).group.parent, null, 'the skyline under it leaves the scene');
    // Back again: the column left behind returns as it was, with no build
    world.update(s, middle, { budgetMs: 0 });
    assert.equal(world.pending.length, 0);
    for (const chunk of left) assert.equal(world.chunks.get(chunk.index), chunk);
    // Heading west in spare frame time, the column beyond is built ahead of the car
    for (let u = middle; u > cell.ix * CITY_CELL + 4; u -= 10) world.update(s, u, { budgetMs: 1000 });
    assert.ok(column(cell.ix - 2).every(k => world.spare.has(k)), 'the column ahead is ready');
    world.update(s, cell.ix * CITY_CELL - 1, { budgetMs: 0 });
    assert.equal(world.pending.length, 0, 'crossing into the next cell needs no build');
    assert.ok(column(cell.ix - 2).every(k => world.chunks.has(k)));
    assert.ok(world.spare.size <= world.spareLimit);
  } finally { world.dispose(); setResidentWindow(); }
  assert.equal(world.spare.size, 0);
});

test('whole chunks are culled only when neither the camera nor the sun could draw any of their meshes', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  try {
    const start = journeyStart();
    world.update(start.s, start.u); while (world.pending.length) world.update(start.s, start.u);
    scene.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(60, 1.6, 1, 300);
    camera.position.set(start.u, 30, -start.s); camera.lookAt(start.u + 100, 24, -start.s); camera.updateMatrixWorld();
    const sun = new THREE.OrthographicCamera(-60, 60, 60, -60, 1, 500);
    sun.position.set(start.u - 110, 240, -start.s + 100); sun.lookAt(start.u, 24, -start.s); sun.updateMatrixWorld();
    const frustum = c => new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
    const view = frustum(camera), shadow = frustum(sun);
    world.cull(camera, shadow);
    const drawn = [...world.chunks.values(), ...[...world.distant.values()].filter(chunk => chunk.group.parent)];
    let hidden = 0;
    for (const chunk of drawn) {
      if (chunk.group.visible) continue;
      hidden++;
      for (const mesh of chunk.group.children) assert.ok(!view.intersectsObject(mesh) && !shadow.intersectsObject(mesh), `${mesh.name} of ${chunk.index} was visible`);
    }
    assert.ok(hidden > drawn.length / 2 && hidden < drawn.length, `${hidden} of ${drawn.length} chunks culled`);
    // Out of range, the skyline is not in the scene at all
    for (const chunk of world.distant.values()) if (!chunk.group.parent) assert.equal(chunk.group.visible, false);
    // A headset's pair of eyes is left to the renderer
    world.cull(new THREE.ArrayCamera([camera]), shadow);
    assert.ok(drawn.every(chunk => chunk.group.visible));
    // The streets are tiled, so the renderer can leave out those off screen
    for (const name of ['ground', 'roads', 'walls']) {
      const tiles = world.staticGroup.children.filter(mesh => mesh.name === `citydriver-${name}`);
      assert.ok(tiles.length > 10, `${tiles.length} ${name} tiles`);
      assert.ok(tiles.filter(tile => view.intersectsObject(tile)).length < tiles.length / 4, `most ${name} tiles off screen`);
    }
  } finally { world.dispose(); }
});
