import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityTraffic } from '../src/city-traffic.js';
import { CityAutodrive } from '../src/city-autodrive.js';
import { junctionControls, cityGreen, JunctionTraffic } from '../src/city-junctions.js';
import { turnPath } from '../src/world/lane-paths.js';
import { trafficContact } from '../src/traffic.js';
import { navGraph } from '../src/world/nav-graph.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute, journeyStart, onRoadAt, roadAt, surfaceAt } from '../src/world/city-route.js';

test('traffic spawns on the streets around the car, drives on and stays on the road', () => {
  const scene = new THREE.Scene(), player = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  const traffic = new CityTraffic(scene, player.route, player.s, 'city', player.u);
  try {
    assert.equal(traffic.vehicles.length, 24);
    for (const car of traffic.vehicles) {
      assert.ok(car.edge && Number.isFinite(car.s) && Number.isFinite(car.u));
      assert.ok(Math.hypot(car.s - player.s, car.u - player.u) < 400);
      assert.ok(onRoadAt(car.s, car.u), 'spawned on a street');
      assert.ok(Math.abs(car.position.y - 24) < 1e-6);
    }
    let moved = 0;
    for (let i = 0; i < 600; i++) traffic.update(1 / 60, player);
    for (const car of traffic.vehicles) {
      assert.ok(Number.isFinite(car.speed) && car.speed >= 0);
      // On the carriageway: a road, or a corner the kerb rounds off
      assert.equal(surfaceAt(car.s, car.u), 'road', 'still on a street after ten seconds');
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
      assert.ok(['signal', 'stop', 'yield', 'priority'].includes(approach.kind));
      // The stop line stands behind the crosswalk, which starts where the road leaves the junction
      assert.ok(approach.clear >= 1 && approach.clear <= 34 && approach.clear <= edge.length * .45 + 1e-9, `clear ${approach.clear} on a ${Math.round(edge.length)} m street`);
      assert.ok(approach.stopDistance > approach.clear + 3 && (!approach.link || approach.kind === 'priority'));
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
  const direction = edge.b === node.id ? 1 : -1, junctions = new JunctionTraffic(nav);
  const next = nav.choices(edge, direction)[0], spec = { width: 2, length: 4.4 };
  const driver = { edge, direction, next, turn: turnPath(nav, edge, direction, next), along: edge.length - approach.stopDistance - 20, speed: 10, spec };
  junctions.tick(approach.axis === 'north' ? 15 : 5);
  const red = junctions.limit(driver, [], null, 1 / 60);
  assert.ok(red < 20 && red > 0, `red limit ${red}`);
  junctions.tick(junctions.time + 10);
  driver.along = edge.length - approach.stopDistance - 10;
  assert.equal(junctions.limit(driver, [], null, 1 / 60), Infinity);
});

test('two cars never cross paths in a junction: the second waits until the first is through', () => {
  const nav = navGraph(), controls = junctionControls(nav), spec = { width: 2, length: 4.4 };
  // A junction where a side street stops for a road that does not
  const [node, control] = [...controls].find(([, c]) => !c.signal && [...c.approaches.values()].some(a => a.kind === 'stop') && [...c.approaches.values()].some(a => a.kind === 'priority' && !a.link));
  const arm = kind => [...control.approaches].find(([, a]) => a.kind === kind && !a.link);
  const drive = ([edge, approach], along) => {
    const direction = edge.b === node.id ? 1 : -1, choices = nav.choices(edge, direction);
    return { edge, direction, choices, approach, along: edge.length - approach.stopDistance - along, speed: 0, spec };
  };
  const junctions = new JunctionTraffic(nav);
  const main = drive(arm('priority'), 10), side = drive(arm('stop'), 1.9);
  // The main road's car goes straight on; the side street's crosses its path
  const plan = (driver, choice) => { driver.next = choice; driver.turn = turnPath(nav, driver.edge, driver.direction, choice); };
  plan(main, main.choices[0]);
  const crossing = side.choices.find(choice => { plan(side, choice); return junctions.conflict(junctions.movement(main.edge, main.direction, main.next, main.turn), junctions.movement(side.edge, side.direction, side.next, side.turn)); });
  assert.ok(crossing, 'the side street crosses the main road');
  plan(side, crossing);
  main.speed = 12;
  // The side street's car has stopped at its line; the main road's car, close, has the right of way
  for (let i = 0; i < 60; i++) junctions.limit(side, [main], null, 1 / 60);
  assert.ok(junctions.limit(side, [main], null, 1 / 60) < 1, 'gives way to the main road');
  assert.equal(junctions.limit(main, [side], null, 1 / 60), Infinity);
  // Once the main road's car has the junction, the side street's cannot take it
  main.speed = 0;
  assert.ok(junctions.limit(side, [main], null, 1 / 60) < 1, 'waits while the junction is taken');
  // and once it is through and clear, it can
  main.edge = main.next.edge; main.direction = main.next.direction; main.along = 30; main.next = null; main.turn = null;
  junctions.limit(main, [side], null, 1 / 60);
  assert.equal(junctions.limit(side, [main], null, 1 / 60), Infinity);
});

test('a minute of traffic round the start: no two cars ever overlap and none is left stuck', () => {
  const scene = new THREE.Scene(), start = journeyStart();
  // The player's car parked off the road near the start, out of everyone's way
  const spot = (() => { for (let r = 10; r < 90; r += 4) for (let a = 0; a < 12; a++) { const s = start.s + Math.sin(a) * r, u = start.u + Math.cos(a) * r, road = roadAt(s, u, 30); if (!road || road.distance > road.road.profile.halfWidth + 6) return { s, u }; } return start; })();
  const player = { s: spot.s, u: spot.u, heading: 0, speed: 0, groundedPosition: new THREE.Vector3(1e5, 0, 1e5), velocity: new THREE.Vector3(), spec: { width: 1.9, length: 4.4, mass: 1300 }, resolveTrafficCollision() {} };
  const traffic = new CityTraffic(scene, citydriverRoute, spot.s, 'city', spot.u);
  try {
    const still = new Map(), box = car => ({ x: car.u, z: -car.s, heading: car.heading, halfWidth: car.spec.width / 2 - .05, halfLength: car.spec.length / 2 - .1 });
    let longest = 0, travelled = 0;
    for (let f = 0; f < 60 * 60; f++) {
      traffic.update(1 / 60, player);
      const cars = traffic.vehicles.filter(car => car.edge && car.car.visible);
      for (const car of cars) {
        travelled += car.speed / 60;
        still.set(car, car.speed < .3 ? (still.get(car) ?? 0) + 1 / 60 : 0);
        longest = Math.max(longest, still.get(car));
      }
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (Math.abs(a.s - b.s) > 8 || Math.abs(a.u - b.u) > 8) continue;
        const contact = trafficContact(box(a), box(b));
        assert.ok(!contact || contact.depth < .1, `cars ${a.index} and ${b.index} overlap at ${a.u.toFixed(0)},${a.s.toFixed(0)}`);
      }
    }
    assert.ok(longest < 40, `a car stood still for ${longest.toFixed(0)} s`);
    assert.ok(travelled / 60 / 24 > 4, `traffic moved at ${(travelled / 60 / 24).toFixed(1)} m/s`);
  } finally { traffic.dispose(); }
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

test('autodrive never loses its way: it never whips round, circles on the spot or leaves the tarmac', () => {
  // (the streams of turns that, before, lost the car in a wide road's outer
  // lane beside a side street leaving at a slant, and in a junction's turns)
  for (const seed of [7, 108, 209]) {
    const player = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
    const traffic = new CityTraffic(new THREE.Scene(), player.route, player.s, 'city', player.u);
    let k = seed;
    const autodrive = new CityAutodrive({ random: () => (k = (k * 16807) % 2147483647) / 2147483647 });
    try {
      player.toggleFreeDriving(); autodrive.toggle();
      let heading = player.heading, whips = 0, offRoad = 0;
      const trail = [];
      for (let i = 0; i < 60 * 150; i++) {
        const state = autodrive.update(player, traffic, player.stats.topSpeed, 1 / 60);
        player.update(1 / 60, state);
        traffic.update(1 / 60, player);
        const turned = Math.abs(Math.atan2(Math.sin(player.heading - heading), Math.cos(player.heading - heading)));
        if (turned > Math.PI / 2 && Math.abs(player.speed) > 2) whips++;
        heading = player.heading;
        if (surfaceAt(player.s, player.u) !== 'road') offRoad++;
        trail.push({ s: player.s, u: player.u, moving: Math.abs(player.speed) > 3 });
        // Moving, it gets somewhere: over ten seconds at speed it covers ground
        if (i >= 600 && i % 60 === 0 && trail.slice(i - 600).every(p => p.moving)) {
          const then = trail[i - 600];
          assert.ok(Math.hypot(player.s - then.s, player.u - then.u) > 20, `circling at ${player.u.toFixed(0)},${player.s.toFixed(0)}`);
        }
      }
      assert.equal(whips, 0, `whipped round ${whips} times`);
      assert.ok(offRoad < 60, `${offRoad} ticks off the tarmac`);
      assert.ok(player.distance > 800, `drove ${player.distance.toFixed(0)} m`);
    } finally { traffic.dispose(); player.disposeModel(); }
  }
});
