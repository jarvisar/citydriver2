import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityTraffic } from '../src/city-traffic.js';
import { CityAutodrive } from '../src/city-autodrive.js';
import { junctionControls, junctionSpeed, cityGreen } from '../src/city-junctions.js';
import { navGraph } from '../src/world/nav-graph.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute, journeyStart, onRoadAt, roadAt } from '../src/world/city-route.js';

test('traffic spawns on the streets around the car, drives on and stays on the road', () => {
  const scene = new THREE.Scene(), player = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  const traffic = new CityTraffic(scene, player.route, player.s, 'city', player.u);
  try {
    assert.equal(traffic.vehicles.length, 24);
    for (const car of traffic.vehicles) {
      assert.ok(car.edge && Number.isFinite(car.s) && Number.isFinite(car.u));
      assert.ok(Math.hypot(car.s - player.s, car.u - player.u) < 400);
      assert.ok(onRoadAt(car.s, car.u), 'spawned on a street');
      assert.ok(Math.abs(car.position.y - 24.13) < 1e-6);
    }
    let moved = 0;
    for (let i = 0; i < 600; i++) traffic.update(1 / 60, player);
    for (const car of traffic.vehicles) {
      assert.ok(Number.isFinite(car.speed) && car.speed >= 0);
      assert.ok(onRoadAt(car.s, car.u), 'still on a street after ten seconds');
      if (car.speed > 1) moved++;
    }
    assert.ok(moved > 8, `${moved} cars moving`);
    traffic.render(1, 0);
    for (const car of traffic.vehicles) assert.ok(Number.isFinite(car.car.position.x));
  } finally { traffic.dispose(); player.disposeModel(); }
});

test('every junction is controlled and the signal cycle alternates', () => {
  const nav = navGraph(), controls = junctionControls(nav);
  assert.ok(controls.size > 30);
  let signals = 0, stops = 0, priority = 0;
  for (const [node, control] of controls) {
    assert.ok(node.edges.length >= 3);
    for (const [edge, approach] of control.approaches) {
      assert.ok(['signal', 'stop', 'priority'].includes(approach.kind));
      assert.ok(approach.crossHalfWidth > 0);
      if (approach.kind === 'signal') signals++; else if (approach.kind === 'stop') stops++; else priority++;
    }
    if (control.signal) assert.ok([...control.approaches.values()].some(a => a.axis === 'north') && [...control.approaches.values()].some(a => a.axis === 'east'));
  }
  assert.ok(signals > 4 && stops > 4 && priority > 4, `${signals} signal, ${stops} stop, ${priority} priority approaches`);
  assert.equal(cityGreen('north', 5), true); assert.equal(cityGreen('east', 5), false);
  assert.equal(cityGreen('north', 15), false); assert.equal(cityGreen('east', 15), true);
  // A car on red stops at the line; on green it carries on
  const [node, control] = [...controls].find(([, c]) => c.signal);
  const [edge, approach] = [...control.approaches].find(([, a]) => a.kind === 'signal');
  const direction = edge.b === node.id ? 1 : -1, traffic = { time: approach.axis === 'north' ? 15 : 5, vehicles: [] };
  const driver = { stopKey: null, stopWait: 0, stopReleased: false };
  const red = junctionSpeed(driver, traffic, nav, edge, direction, edge.length - approach.crossHalfWidth - 4 - 20, 10, 1 / 60);
  assert.ok(red < 20 && red > 0, `red limit ${red}`);
  traffic.time += 10;
  assert.equal(junctionSpeed(driver, traffic, nav, edge, direction, edge.length - 30, 10, 1 / 60), Infinity);
});

test('autodrive follows the street ahead and keeps the car on the road through junctions', () => {
  const player = new DrivingController(citydriverRoute, journeyStart(), 'taxi'), autodrive = new CityAutodrive({ random: () => .1 });
  const traffic = { enabled: false, vehicles: [], time: 0 };
  try {
    player.toggleFreeDriving();
    assert.ok(autodrive.canStart(player));
    assert.ok(autodrive.toggle());
    let offRoad = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const state = autodrive.update(player, traffic, player.stats.topSpeed, 1 / 60);
      assert.ok(state.touchDrive || state.handbrake, 'autodrive always answers');
      player.update(1 / 60, state);
      const road = roadAt(player.s, player.u);
      if (!road || road.distance > road.road.profile.halfWidth + .5) offRoad++;
    }
    assert.ok(player.distance > 250, `drove ${player.distance} m`);
    assert.ok(offRoad < 60, `${offRoad} ticks off the road`);
  } finally { player.disposeModel(); }
});
