import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverWorld, CityChunk } from '../src/world/citydriver-world.js';
import { planLot } from '../src/world/city-buildings.js';
import { convexPieces, convexHull } from '../src/world/colliders.js';
import { union, difference, region } from '../src/mapgen/booleans.js';
import { cityTrees } from '../src/world/city-assets.js';
import { cityCell, CITY, CITY_CELL } from '../src/world/city.js';
import { journeyStart, roadAt } from '../src/world/city-route.js';
import { setResidentWindow } from '../src/world/resident.js';
import { offsetWalkerPose, pairLag } from '../src/world/city-life.js';
import { walkPose, nearestOnLoop } from '../src/world/pedestrian-reactions.js';
import { WalkSpace, WALK_OUT, PAIR, BODY, CLOSE } from '../src/world/city-walks.js';
import { insidePolygon, distanceToPolyline } from '../src/mapgen/polygon-util.js';
import { collideScenery, sightLine } from '../src/collision.js';
import { CityTraffic } from '../src/city-traffic.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute, nearestLanePose, PAVEMENT_LEVEL, surfaceAt } from '../src/world/city-route.js';
import { ThirdPersonCamera } from '../src/third-person-camera.js';
import { PlayerFog } from '../src/player-fog.js';
import { DemolitionRun } from '../src/demolition-run.js';

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
    // Moving to a built-up street about 750 m away frees the old detail and
    // streams new chunks within a frame budget
    const far = CITY.lots.map(lot => ({ s: lot[0].y, u: lot[0].x })).sort((a, b) => Math.abs(Math.hypot(a.s - start.s, a.u - start.u) - 750) - Math.abs(Math.hypot(b.s - start.s, b.u - start.u) - 750))[0];
    const cell = cityCell(far.s, far.u);
    const before = world.chunks.size;
    world.update(far.s, far.u, { budgetMs: 2 });
    for (const chunk of world.chunks.values()) {
      assert.ok(Math.max(Math.abs(chunk.ix - cell.ix), Math.abs(chunk.iz - cell.iz)) <= world.radius, `old detail released (${chunk.index})`);
    }
    for (let ix = cell.ix - 1; ix <= cell.ix + 1; ix++) for (let iz = cell.iz - 1; iz <= cell.iz + 1; iz++) {
      if (world.inCity(ix, iz)) assert.ok(world.chunks.has(`${ix},${iz}`), `the collision neighborhood is complete (${ix},${iz})`);
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

// Demolition's red residents rely on the draw order: every building before
// the mask (-1), everything else after it, and a mask and ghost on every
// chunk's residents, switched together with their glow
test('the residents of every chunk carry the demolition warning, drawn between the buildings and the rest', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  try {
    const start = journeyStart();
    world.update(start.s, start.u);
    while (world.pending.length) world.update(start.s, start.u);
    let residents = 0;
    for (const chunk of world.chunks.values()) {
      for (const mesh of chunk.group.children) assert.ok(mesh.renderOrder === -2 || mesh.renderOrder >= 0, `${mesh.name} draws at ${mesh.renderOrder}`);
      if (!chunk.peopleMesh) continue;
      residents++;
      const [mask, ghost] = chunk.peopleMesh.children;
      assert.equal(mask.material, world.peopleAlert.mask); assert.equal(ghost.material, world.peopleAlert.ghost);
      assert.equal(mask.instanceMatrix, chunk.peopleMesh.instanceMatrix);
    }
    assert.ok(residents >= 5, `${residents} chunks with residents`);
    const glow = world.materials.residents.userData.alert;
    world.setPeopleAlert(true, true);
    assert.equal(glow.value, 1); assert.equal(world.peopleAlert.mask.visible, true); assert.equal(world.peopleAlert.ghost.visible, true);
    // (with no stencil buffer the ghost would show through walls: glow only)
    world.setPeopleAlert(true, false);
    assert.equal(glow.value, 1); assert.equal(world.peopleAlert.ghost.visible, false); assert.equal(world.peopleAlert.mask.visible, false);
    world.setPeopleAlert(false, true);
    assert.equal(glow.value, 0); assert.equal(world.peopleAlert.ghost.visible, false);
  } finally { world.dispose(); }
});

test('buildings block the car and the parks and water stay open', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  const car = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  try {
    car.toggleFreeDriving();
    world.update(car.s, car.u); while (world.pending.length) world.update(car.s, car.u);
    // Stand the car on the pavement a few meters in front of the nearest
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
      // A pitched roof sits on a four-sided building of a few stories, its
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
    // No tree crown reaches a meter into a building
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

// Basic detail keeps one ring of detailed chunks. Building a new ring at once
// on crossing into a cell stalls a phone, so the ring starts a whole cell
// ahead: it streams over later frames, is built ahead of time when the car is
// heading for it, and what the car has just left is kept aside.
test('at the lowest detail the ring ahead streams in, is built ahead of time, and the ring left behind is kept', () => {
  setResidentWindow({ behind: 1, ahead: 3 });
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  try {
    const start = journeyStart(), cell = cityCell(start.s, start.u), s = (cell.iz + .5) * CITY_CELL, middle = (cell.ix + .5) * CITY_CELL;
    const key = (ix, iz) => `${ix},${iz}`, column = ix => [-1, 0, 1].map(dz => key(ix, cell.iz + dz));
    world.update(s, middle); while (world.pending.length) world.update(s, middle);
    assert.equal(world.radius, 1); assert.equal(world.chunks.size, 9);
    const left = column(cell.ix - 1).map(k => world.chunks.get(k));
    // A meter into the next cell east: the new column is a cell ahead and waits
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

test('at low shadow detail only buildings, trees, vehicles and tall posts cast, and nothing costs another draw', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  const small = /^citydriver-(residents|lantern|bin|bollard|railing|signal|signal-head|stop|yield|parking-sign|mooring-line|square-flowers-.*|structure-square-flowers-.*)$/;
  // (what a box is drawn at: its instance's columns, give or take float rounding)
  const casts = (matrix, give) => {
    const e = matrix.elements, [x, y, z] = [0, 4, 8].map(o => Math.hypot(e[o], e[o + 1], e[o + 2]) + give);
    return Math.min(x, y, z) >= .3 || Math.min(x, z) >= .6;
  };
  const meshes = () => [...world.chunks.values()].flatMap(chunk => chunk.group.children);
  try {
    const start = journeyStart();
    world.update(start.s, start.u);
    while (world.pending.length) world.update(start.s, start.u);
    const matrix = new THREE.Matrix4();
    let trimmed = 0, partial = 0;
    for (const mesh of meshes()) {
      const from = mesh.userData.shadowFrom;
      if (small.test(mesh.name) && mesh.castShadow) assert.equal(from, 0, `${mesh.name} casts only at full detail`);
      if (mesh.name === 'citydriver-structure-solid' && from !== undefined) {
        // A building's boxes: what casts first, then its trim
        trimmed++;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          assert.ok(i < from ? casts(matrix, 1e-4) : !casts(matrix, -1e-4), `box ${i} of ${mesh.count}, casting ${from}`);
        }
      }
      if (mesh.userData.batches && from > 0) partial++;
      if (/bodies|tree|parked|shelter|lamp|signal-mast/.test(mesh.name)) assert.notEqual(from, 0, `${mesh.name} always casts`);
    }
    assert.ok(trimmed > 3, `${trimmed} blocks' boxes put their trim last`);
    const calls = meshes().filter(mesh => mesh.castShadow).length;
    world.setShadowDetail(false);
    for (const mesh of meshes()) {
      const from = mesh.userData.shadowFrom;
      if (from === 0) assert.equal(mesh.castShadow, false, mesh.name);
      if (!(from > 0)) continue;
      // The shadow pass draws only the front of it, and the rest comes back
      const range = mesh.geometry.drawRange, drawn = mesh.isInstancedMesh ? mesh.count : range.count;
      mesh.onBeforeShadow();
      assert.equal(mesh.isInstancedMesh ? mesh.count : range.count, from, mesh.name);
      mesh.onAfterShadow();
      assert.equal(mesh.isInstancedMesh ? mesh.count : range.count, drawn, mesh.name);
    }
    assert.ok(meshes().filter(mesh => mesh.castShadow).length < calls, 'fewer shadow draws');
    // Chunks that stream in later take the detail as it is
    const away = CITY.lots.map(lot => ({ s: lot[0].y, u: lot[0].x })).sort((a, b) => Math.abs(Math.hypot(a.s - start.s, a.u - start.u) - 750) - Math.abs(Math.hypot(b.s - start.s, b.u - start.u) - 750))[0];
    world.update(away.s, away.u);
    while (world.pending.length) world.update(away.s, away.u);
    for (const mesh of meshes()) if (mesh.userData.shadowFrom === 0) assert.equal(mesh.castShadow, false, `new ${mesh.name}`);
    world.setShadowDetail(true);
    for (const mesh of meshes()) {
      if (mesh.userData.shadowFrom === 0) assert.equal(mesh.castShadow, true, mesh.name);
      if (!(mesh.userData.shadowFrom > 0)) continue;
      const drawn = mesh.isInstancedMesh ? mesh.count : mesh.geometry.drawRange.count;
      mesh.onBeforeShadow(); assert.equal(mesh.isInstancedMesh ? mesh.count : mesh.geometry.drawRange.count, drawn, 'full detail draws it all');
      mesh.onAfterShadow();
    }
  } finally { world.dispose(); }
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
    // A headset's pair of eyes carries one frustum round both (as three sets
    // it for its own culling), and culls as any lens with that frustum does
    const culled = drawn.map(chunk => chunk.group.visible);
    const eyes = new THREE.ArrayCamera([camera]);
    eyes.projectionMatrix.copy(camera.projectionMatrix); eyes.matrixWorldInverse.copy(camera.matrixWorldInverse);
    world.cull(null, shadow);
    assert.ok(drawn.every(chunk => chunk.group.visible));
    world.cull(eyes, shadow);
    assert.deepEqual(drawn.map(chunk => chunk.group.visible), culled);
    // Even completely fog-hidden geometry must still cast into visible light.
    const fog = new PlayerFog('white'); fog.origin.set(100000, 100000, 100000);
    world.cull(camera, shadow, fog);
    for (const chunk of drawn) for (const mesh of chunk.group.children) {
      if (shadow.intersectsObject(mesh)) assert.ok(chunk.group.visible, 'fog must retain off-screen shadow casters');
    }
    assert.ok(drawn.some(chunk => chunk.group.visible));
    world.cull(camera, null, fog);
    assert.ok(drawn.every(chunk => !chunk.group.visible), 'fully hidden chunks can be skipped without a shadow pass');
    // The streets are tiled, so the renderer can leave out those off screen
    for (const name of ['ground', 'roads', 'walls']) {
      const tiles = world.staticGroup.children.filter(mesh => mesh.name === `citydriver-${name}`);
      assert.ok(tiles.length > 10, `${tiles.length} ${name} tiles`);
      assert.ok(tiles.filter(tile => view.intersectsObject(tile)).length < tiles.length / 4, `most ${name} tiles off screen`);
    }
  } finally { world.dispose(); }
});

test('a parked car the player runs into is knocked loose, and put back in its bay once the player has gone', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  const car = new DrivingController(citydriverRoute, journeyStart(), 'rig');
  const traffic = new CityTraffic(scene, citydriverRoute, car.s, 'city', car.u);
  try {
    car.toggleFreeDriving();
    world.update(car.s, car.u); while (world.pending.length) world.update(car.s, car.u);
    // The nearest parked car, met square at its tail from a few meters behind
    const parked = [...world.chunks.values()].flatMap(c => c.features.colliders).filter(c => c.parked?.ready)
      .sort((a, b) => Math.hypot(a.x - car.u, -a.z - car.s) - Math.hypot(b.x - car.u, -b.z - car.s))[0];
    assert.ok(parked, 'a parked car near the start');
    const nose = parked.parked.nose, back = 2.6 + car.spec.length / 2 + 1;
    car.u = parked.x - nose.u * back; car.s = -parked.z - nose.s * back; car.heading = car.slideHeading = Math.atan2(nose.u, nose.s); car.speed = 8; car.update(0, {});
    traffic.vehicles.forEach(c => { c.edge = null; c.car.visible = false; c.position.set(1e6, 0, 1e6); });
    traffic.spawn = () => false;
    const from = { x: parked.x, z: parked.z };
    // (a demolition run is paid for it, as a parked car: see DemolitionRun)
    const run = new DemolitionRun(); run.start();
    traffic.onDamage = (struck, closing) => run.damageCar(struck, closing);
    let stand = null;
    for (let i = 0; i < 120 * 2; i++) {
      car.update(1 / 120, { forward: i < 60 });
      collideScenery(car, world.chunks, 1 / 120, c => traffic.wake(c));
      traffic.update(1 / 120, car, world.chunks);
      stand ??= traffic.woken.find(c => c.parked === parked);
    }
    assert.ok(stand && parked.woken, 'knocked loose');
    assert.ok(run.drainEvents().some(event => event.kind === 'dent' && event.label.startsWith('Parked ')), 'and priced as a parked car');
    assert.ok(Math.hypot(stand.u - from.x, -stand.s - from.z) > 1, 'and shoved along');
    assert.equal(stand.car.visible, true);
    assert.equal(parked.parked.hidden, true, 'its bay stands empty while it is out of it');
    // Once the player is far off it goes back where it was
    car.s += 400; car.update(0, {});
    traffic.update(1 / 120, car, world.chunks);
    assert.equal(parked.woken, false);
    assert.equal(stand.parked, null);
    assert.equal(stand.car.visible, false);
    assert.equal(parked.parked.hidden, false);
  } finally { traffic.dispose(); world.dispose(); car.disposeModel(); }
});

test('a parked car still comes loose with every stand-in of its model out: more are made, up to a limit, then only one at rest is taken', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene), start = journeyStart();
  const traffic = new CityTraffic(scene, citydriverRoute, start.s, 'city', start.u);
  try {
    world.update(start.s, start.u); while (world.pending.length) world.update(start.s, start.u);
    const parked = [...world.chunks.values()].flatMap(c => c.features.colliders).filter(c => c.parked?.ready);
    const counts = Object.groupBy(parked, c => c.parked.model);
    const same = Object.values(counts).sort((a, b) => b.length - a.length)[0], pool = traffic.woken.filter(c => c.spec.name === same[0].parked.model).length;
    assert.ok(same.length > pool + 1, `${same.length} parked ${same[0].parked.model}s`);
    for (const collider of same.slice(0, pool + 1)) assert.equal(traffic.wake(collider), true);
    // The last took the stand-in of one resting in its bay, which is back there
    assert.equal(same[pool].woken, true);
    const back = same.slice(0, pool).filter(c => !c.woken);
    assert.equal(back.length, 1);
    assert.equal(back[0].parked.hidden, false);
    // With all of them moving, another is made while there are under the limit
    for (const car of traffic.woken) if (car.parked) car.loose.vx = 3;
    assert.equal(traffic.wake(back[0]), true);
    assert.equal(traffic.woken.filter(c => c.spec.name === same[0].parked.model).length, pool + 1);
    assert.equal(back[0].woken, true);
    // and at the limit, none is taken while they are all still moving
    traffic.standInLimit = pool + 1;
    for (const car of traffic.woken) if (car.parked) car.loose.vx = 3;
    assert.equal(traffic.wake(same.find(c => !c.woken)), false);
  } finally { traffic.dispose(); world.dispose(); }
});

test('the chase camera stays out of the buildings whichever way the car faces', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  try {
    const start = journeyStart();
    world.update(start.s, start.u); while (world.pending.length) world.update(start.s, start.u);
    // (not a jump's ramp or mound, whose top is a `shape` the camera passes
    // over, nor a step or a stand someone on foot climbs, which it looks over)
    const tops = [...world.chunks.values()].flatMap(c => c.features.colliders.filter(s => s.top !== undefined && !s.shape));
    assert.ok(tops.every(b => b.corners), 'everything with a top has its outline');
    const buildings = tops.filter(b => b.top > PAVEMENT_LEVEL + 3);
    assert.ok(buildings.length > 100, 'every building has its roof height');
    const outline = b => b.corners.map(p => ({ x: p.x, y: p.z }));
    const sight = (from, to) => sightLine(world.chunks.values(), from, to, world.origin);
    let poses = 0, pulled = 0;
    for (let i = 0; i < 48; i++) {
      const lane = nearestLanePose(start.s + (i % 8 - 3.5) * 45, start.u + (Math.floor(i / 8) - 2.5) * 45);
      if (!lane.road) continue;
      const driven = new DrivingController(citydriverRoute, lane, 'taxi');
      driven.render(0, world.origin);
      const car = new THREE.Object3D(); car.position.copy(driven.car.position); driven.disposeModel?.();
      for (let h = 0; h < 8; h++) {
        car.rotation.y = -(lane.heading + h * Math.PI / 4);
        const rig = new ThirdPersonCamera(); rig.sight = sight; rig.update(car, 0);
        const p = { x: rig.camera.position.x, y: rig.camera.position.z - world.origin };
        for (const b of buildings) if (rig.camera.position.y < b.top) {
          assert.ok(!insidePolygon(p, outline(b)) && distanceToPolyline(p, [...outline(b), outline(b)[0]]) > .49, `camera at ${p.x.toFixed(1)}, ${p.y.toFixed(1)} against a building`);
        }
        poses++; if (rig.reach < 1) pulled++;
      }
    }
    assert.ok(poses > 200 && pulled > poses / 10, `${pulled} of ${poses} views pulled in`);
  } finally { world.dispose(); }
});

test("strollers keep to the parks' and squares' walks, never out on a roadway", () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    const loops = [...world.blocksByChunk.values()].flat().filter(loop => loop.index >= 2e5);
    assert.ok(loops.length > 0, 'some walks are strolled');
    for (const loop of loops) for (const p of loop.points) assert.notEqual(surfaceAt(p.y, p.x), 'road', `a stroll out at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`);
  } finally { world.dispose(); }
});

// How far (x, z) is from a collider (under 0 inside it)
function offCollider(c, x, z) {
  if (!c.corners) return Math.hypot(x - c.x, z - c.z) - c.reach;
  const ring = c.corners.map(p => ({ x: p.x, y: p.z })), d = distanceToPolyline({ x, y: z }, [...ring, ring[0]]);
  return insidePolygon({ x, y: z }, ring) ? -d : d;
}

test('people walk the clear band by the lot line: through no collider, never off the pavement, and all one way round at one pace', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    const start = journeyStart();
    world.update(start.s, start.u);
    while (world.pending.length) world.update(start.s, start.u);
    // (what stands in the built cells, by 8 m cell: not roof plant, parked cars, ramps or flat steps)
    const grid = new Map(), key = (ix, iz) => ix * 65536 + iz;
    for (const chunk of world.chunks.values()) for (const c of chunk.features.colliders) {
      if (c.clutter || c.parked || c.shape || c.top - PAVEMENT_LEVEL <= .3) continue;
      for (let ix = Math.floor((c.x - c.reach - 1) / 8); ix <= Math.floor((c.x + c.reach + 1) / 8); ix++) for (let iz = Math.floor((c.z - c.reach - 1) / 8); iz <= Math.floor((c.z + c.reach + 1) / 8); iz++) {
        if (!grid.has(key(ix, iz))) grid.set(key(ix, iz), []);
        grid.get(key(ix, iz)).push(c);
      }
    }
    const loops = new Map();
    let samples = 0, pairs = 0;
    for (const chunk of world.chunks.values()) for (const walker of chunk.walkers) {
      // (a block's residents: the squares' and parks' strollers have their own test)
      if (walker.loop.index >= 1e5 || walker.loop.blocked) continue;
      if (!loops.has(walker.loop)) loops.set(walker.loop, []);
      loops.get(walker.loop).push(walker);
      if (walker.pairOffset) pairs++;
      for (let d = 0; d < walker.loop.perimeter; d += .5) {
        const pose = offsetWalkerPose(walkPose({ ...walker, phase: d }, 0), walker);
        // (a walk runs on into cells not built here, whose colliders nobody has)
        if (!world.chunks.has(cityCell(pose.s, pose.x).key)) continue;
        samples++;
        assert.equal(surfaceAt(pose.s, pose.x), 'pavement', `walking off the pavement at ${pose.x.toFixed(1)}, ${pose.s.toFixed(1)}`);
        for (const c of grid.get(key(Math.floor(pose.x / 8), Math.floor(-pose.s / 8))) ?? []) {
          const off = offCollider(c, pose.x, -pose.s);
          assert.ok(off > .25 - .03, `walking ${off.toFixed(2)} m from a ${c.prop?.pieces[0].kind ?? (c.corners ? 'wall' : 'post')} at ${pose.x.toFixed(1)}, ${pose.s.toFixed(1)}`);
        }
      }
    }
    assert.ok(loops.size > 20 && samples > 5000 && pairs > 4, `${loops.size} walks, ${samples} places on them, ${pairs} people in pairs`);
    for (const [loop, walkers] of loops) {
      assert.ok(walkers.every(walker => walker.direction === loop.direction && walker.speed === loop.pace), 'one way round, at one pace');
      // (each pair or person on their own stretch, so nobody walks through anybody)
      const marks = walkers.filter(walker => !(walker.pairOffset > 0)).map(walker => walker.phase);
      for (let i = 0; i < marks.length; i++) for (let k = 0; k < i; k++) {
        const apart = Math.abs(marks[i] - marks[k] - Math.round((marks[i] - marks[k]) / loop.perimeter) * loop.perimeter);
        assert.ok(apart > 5, `${apart.toFixed(1)} m apart on a walk of ${loop.perimeter.toFixed(0)} m`);
      }
      for (const walker of walkers) if (walker.pairOffset > 0) assert.equal(walker.phase, walkers[walkers.indexOf(walker) - 1].phase, 'a pair walks together');
    }
  } finally { world.dispose(); }
});

test('a walk keeps a fixed way out from the lot line, and routed again round something new it moves nobody along it', () => {
  const walks = new WalkSpace();
  let loop = null, at = 0, block = null;
  for (let index = 0; index < CITY.blocks.length && !loop; index++) {
    const each = walks.block(index), n = each?.points.length ?? 0;
    for (let i = 0; i < n && !loop; i++) if (each.cumulative[i + 1] - each.cumulative[i] > 40) { loop = each; at = (each.cumulative[i] + each.cumulative[i + 1]) / 2; block = CITY.blocks[index]; }
  }
  assert.ok(loop, 'a walk with a long straight side');
  // (with nothing on the pavement, WALK_OUT from the lot line all the way round, inside the curb)
  const line = [...block.inner, block.inner[0]], curb = [...block.kerb, block.kerb[0]];
  for (const p of loop.points) {
    // (round a corner, within what the arc's chords, its samples and their thinning cut off it)
    assert.ok(Math.abs(distanceToPolyline(p, line) - WALK_OUT) < .12 && !insidePolygon(p, block.inner), `${distanceToPolyline(p, line).toFixed(2)} m out from the lot line`);
    assert.ok(insidePolygon(p, block.kerb) && distanceToPolyline(p, curb) > 1.5);
  }
  const pose = d => walkPose({ loop, phase: d, direction: 1 }, 0), before = [];
  for (let d = 0; d < loop.perimeter; d += 1) before.push(pose(d));
  // Something standing just to the wall's side of it: passed on the curb's side, a pair's width clear
  const here = pose(at), ahead = pose(at + 1), out = { x: ahead.s - here.s, y: -(ahead.x - here.x) }, post = { x: here.x - out.x * .3, y: here.s - out.y * .3 };
  const perimeter = loop.perimeter;
  walks.obstacle(post.x, post.y, .2, { kind: 'post' });
  walks.route(loop);
  assert.equal(loop.perimeter, perimeter); assert.equal(loop.cumulative.at(-1), perimeter); assert.equal(loop.cumulative.length, loop.points.length + 1);
  let bent = 0;
  for (let d = 0, i = 0; d < perimeter; d += 1, i++) {
    const now = pose(d), moved = Math.hypot(now.x - before[i].x, now.s - before[i].s), along = Math.abs(d - at);
    // (elsewhere, where they were to within what thinning the line's points allows)
    if (along > 8) assert.ok(moved < .041, `moved ${moved.toFixed(3)} m, ${along.toFixed(0)} m from it`);
    else { bent = Math.max(bent, moved); assert.ok(moved < 1.6, 'aside, never along'); }
    assert.ok(Math.hypot(now.x - post.x, now.s - post.y) > .2 + PAIR + BODY, 'clear of it for two abreast');
  }
  assert.ok(bent > .5 && !loop.tight && !loop.blocked, `bent ${bent.toFixed(2)} m round it`);
  // (and whoever is knocked down beside it rejoins the walk where they are)
  const beside = pose(at + .5);
  assert.ok(Math.abs(nearestOnLoop(loop, beside.x, beside.s) - (at + .5)) < .05);
  // With no room for two abreast a pair closes up, and with none at all nobody walks it
  walks.obstacle(here.x + out.x * 1.45, here.s + out.y * 1.45, .2, { kind: 'post' });
  walks.route(loop);
  assert.ok(loop.tight && !loop.blocked, `squeezed by ${loop.squeeze.toFixed(2)} m`);
  const pair = offsetWalkerPose(pose(0), { loop, pairOffset: PAIR }), middle = pose(0);
  assert.ok(Math.abs(Math.hypot(pair.x - middle.x, pair.s - middle.s) - PAIR * CLOSE) < 1e-9, 'shoulder to shoulder');
  walks.obstacle(here.x + out.x, here.s + out.y, .2, { kind: 'post' });
  walks.route(loop);
  assert.ok(loop.file && !loop.blocked && pairLag({ loop, pairOffset: PAIR }) > .5 && pairLag({ loop, pairOffset: -PAIR }) === 0, `squeezed by ${loop.squeeze.toFixed(2)} m: one behind the other`);
  const behind = offsetWalkerPose(pose(0), { loop, pairOffset: PAIR });
  assert.ok(Math.hypot(behind.x - middle.x, behind.s - middle.s) < 1e-9, 'in single file');
  for (const k of [-.8, 0, .8, 1.6, 2.4]) walks.obstacle(here.x + out.x * k, here.s + out.y * k, .45, { kind: 'wall' });
  walks.route(loop);
  assert.ok(loop.blocked, 'a pavement blocked right across');
});

test("a bus shelter's collider takes in its bench, and the walk behind it is clear", () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    const piece = world.shelters.find(each => CITY.pavement.find(each.u, each.s)?.kind === 'block'), cell = cityCell(piece.s, piece.u);
    const chunk = new CityChunk(world, cell.ix, cell.iz, false, true);
    chunk.buildUntil();
    const collider = chunk.features.colliders.find(c => c.prop?.pieces[0].kind === 'shelter' && Math.hypot(c.x - piece.u, c.z + piece.s) < 1);
    assert.ok(collider, 'the shelter is solid');
    // (its seat, across the middle of it, and its glass back; not the pavement in front or behind)
    const nx = Math.cos(piece.yaw), ny = Math.sin(piece.yaw), off = across => offCollider(collider, piece.u + nx * across, -(piece.s + ny * across));
    assert.ok(off(0) < 0 && off(-.2) < 0 && off(.62) < 0, 'bench and back');
    assert.ok(off(-.5) > 0 && off(1) > 0, 'open in front and behind');
    const loop = world.walks.block(CITY.pavement.find(piece.u, piece.s).block);
    for (let d = 0; d < loop.perimeter; d += .5) {
      const p = walkPose({ loop, phase: d, direction: 1 }, 0);
      if (Math.hypot(p.x - piece.u, p.s - piece.s) < 6) assert.ok(loop.blocked || offCollider(collider, p.x, -p.s) > .25, 'the walk passes behind it');
    }
    chunk.dispose();
  } finally { world.dispose(); }
});

test("a building's colliders are the walls it is drawn with: no wall nobody can see across a wing's yard, and none left out", () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x), span = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const area = points => Math.abs(points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0) / 2);
    const areaOf = shapes => shapes.reduce((sum, shape) => sum + area(shape.outer) - shape.holes.reduce((holes, hole) => holes + area(hole), 0), 0);
    let buildings = 0, cut = 0, most = 0, hulls = 0, unseen = 0;
    for (const lots of world.lotsByChunk.values()) for (const lot of lots) {
      const plan = planLot({ east: 0, start: 0 }, lot);
      if (plan.kind !== 'building') continue;
      const ring = plan.footprint, pieces = convexPieces(ring), at = `${ring[0].x.toFixed(0)},${ring[0].y.toFixed(0)}`;
      buildings++; most = Math.max(most, pieces.length); hulls += area(convexHull(ring)) - area(ring);
      if (pieces.length === 1) {
        // Its hull, where that adds next to nothing: a dip no deeper than a sill, a notch nobody fits into
        const extra = area(pieces[0].points) - area(ring);
        assert.ok(extra < Math.max(.05 * area(ring), 1) && extra < 8, `a hull ${extra.toFixed(1)} m2 bigger than its building of ${area(ring).toFixed(0)} m2 at ${at}`);
        unseen += extra;
        continue;
      }
      cut++;
      const solid = union(pieces.map(piece => piece.points)), phantom = areaOf(difference(region(solid), [ring])), bare = areaOf(difference([ring], region(solid)));
      assert.ok(phantom < Math.max(.05 * area(ring), 1) && phantom < 8, `${phantom.toFixed(1)} m2 of collider outside the walls of a building of ${area(ring).toFixed(0)} m2 at ${at}`);
      assert.ok(bare < .5, `${bare.toFixed(2)} m2 of the building at ${at} outside its collider`);
      unseen += phantom;
      // Every piece convex, and no seam ending at a corner the building has (see convexPieces)
      const filled = p => pieces.reduce((sum, piece) => sum + piece.points.reduce((turn, q, i) => {
        const n = piece.points.length, b = piece.points[(i + 1) % n], a = piece.points[(i + n - 1) % n];
        if (span(q, p) < 1e-6) return turn + Math.abs(Math.atan2(cross(q, b, a), (b.x - q.x) * (a.x - q.x) + (b.y - q.y) * (a.y - q.y)));
        const along = ((p.x - q.x) * (b.x - q.x) + (p.y - q.y) * (b.y - q.y)) / span(q, b) ** 2;
        return span(b, p) > 1e-6 && along > 0 && along < 1 && Math.abs(cross(q, b, p)) / span(q, b) < 1e-6 ? turn + Math.PI : turn;
      }, 0), 0);
      for (const piece of pieces) piece.points.forEach((p, i) => {
        const n = piece.points.length;
        assert.ok(cross(piece.points[(i + n - 1) % n], p, piece.points[(i + 1) % n]) > -1e-6, `a piece that is not convex at ${at}`);
        if (piece.seams[i] || piece.seams[(i + n - 1) % n]) assert.ok(filled(p) > Math.PI - 1e-3, `a seam ending at a corner of the building at ${at}`);
      });
    }
    assert.ok(cut > 300 && most <= 12, `${cut} of ${buildings} buildings in pieces, ${most} at most`);
    // (their hulls: over 30,000 m2 of the city walled off that is drawn open)
    assert.ok(hulls > 10000 && unseen < hulls / 10, `${unseen.toFixed(0)} m2 of unseen wall left of ${hulls.toFixed(0)}`);
    // and so they stand in the chunks: the pieces of one footprint one after another, knowing their seams and its hull
    const start = journeyStart();
    world.update(start.s, start.u); while (world.pending.length) world.update(start.s, start.u);
    let seen = 0;
    for (const chunk of world.chunks.values()) chunk.features.colliders.forEach((solid, i, all) => {
      if (!solid.seams) { assert.equal(solid.hull, undefined); return; }
      seen++;
      assert.ok(solid.top !== undefined && solid.corners.length === solid.seams.length && solid.hull.length >= 3);
      assert.ok(all[i - 1]?.hull === solid.hull || all[i + 1]?.hull === solid.hull, 'a piece stands beside the next piece of its footprint');
    });
    assert.ok(seen > 20, `${seen} pieces round the start`);
  } finally { world.dispose(); }
});
