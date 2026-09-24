import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolveWorldSeed } from '../src/world/generation.js';
import { citydriverRoute, journeyStart } from '../src/world/city-route.js';
import { DrivingController } from '../src/vehicle.js';
import { CityAutodrive } from '../src/city-autodrive.js';

test('world seeds use fresh entropy and accept reproducible unsigned URL seeds', () => {
  let next = 80;
  const entropy = () => next++;
  assert.equal(resolveWorldSeed('', entropy), 80);
  assert.equal(resolveWorldSeed('', entropy), 81);
  for (const seed of [0, 1, 4817, 0xffffffff]) assert.equal(resolveWorldSeed(`?seed=${seed}`, entropy), seed);
  assert.equal(next, 82);
  for (const value of ['', '-1', '1.5', 'abc', '4294967296', 'Infinity', ' 12']) {
    const before = next;
    assert.equal(resolveWorldSeed(`?seed=${encodeURIComponent(value)}`, entropy), before);
    assert.equal(next, before + 1);
  }
  const fresh = resolveWorldSeed();
  assert.ok(Number.isInteger(fresh) && fresh >= 0 && fresh <= 0xffffffff);
});

test('the city starts grounded on a street and a saved position is restored', () => {
  const state = journeyStart();
  assert.deepEqual(state, journeyStart());
  const car = new DrivingController(citydriverRoute, state);
  try {
    assert.equal(car.s, state.s); assert.equal(car.u, state.u); assert.equal(car.distance, 0); assert.equal(car.speed, 0);
    assert.ok(Math.abs(car.car.position.y - citydriverRoute.height(car.s, car.u) - .13) < 1e-8);
    // Drive on along the streets for ten seconds
    car.toggleFreeDriving();
    const autodrive = new CityAutodrive({ random: () => .3 }), traffic = { enabled: false, vehicles: [], time: 0 };
    autodrive.toggle();
    for (let i = 0; i < 600; i++) car.update(1 / 60, autodrive.update(car, traffic, car.stats.topSpeed, 1 / 60));
    assert.ok(car.distance > 100);
    const saved = { s: car.s, u: car.u, heading: car.heading, distance: car.distance };
    car.setRoute(citydriverRoute, journeyStart());
    car.setRoute(citydriverRoute, saved);
    assert.equal(car.distance, saved.distance); assert.equal(car.speed, 0);
    assert.ok(Math.hypot(car.s - saved.s, car.u - saved.u) < 20, 'reset settles into the nearest lane');
  } finally { car.disposeModel(); }
});

function sampleWorld(seed) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      globalThis.location = { search: '?seed=' + workerData.seed };
      (async () => {
        const route = await import(workerData.routeUrl);
        const city = await import(workerData.cityUrl);
        const cityRoute = await import(workerData.cityRouteUrl);
        parentPort.postMessage({ seed: route.SEED, start: cityRoute.journeyStart(), lots: city.CITY.lots.length, roads: city.CITY.roads.length,
          first: city.CITY.lots[0].map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) });
      })().catch(error => { throw error; });
    `, { eval: true, execArgv: [], workerData: { seed,
      routeUrl: new URL('../src/world/route.js', import.meta.url).href,
      cityUrl: new URL('../src/world/city.js', import.meta.url).href,
      cityRouteUrl: new URL('../src/world/city-route.js', import.meta.url).href } });
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`World sampler exited with ${code}`)); });
  });
}

test('reloading a seed reproduces the city; different seeds change the streets and lots', async () => {
  let previous;
  for (const seed of [0, 4817, 8675309]) {
    const world = await sampleWorld(seed);
    assert.equal(world.seed, seed);
    assert.deepEqual(world, await sampleWorld(seed));
    if (previous) { assert.notDeepEqual(world.first, previous.first); assert.notDeepEqual(world.start, previous.start); }
    previous = world;
  }
});
