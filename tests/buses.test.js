import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityTraffic, lanesOf } from '../src/city-traffic.js';
import { BUS_MODEL, BUS_ROADS, BUS_DOORS, TRAFFIC_MODELS } from '../src/traffic-models.js';
import { OnFoot } from '../src/on-foot.js';
import { BusStops } from '../src/world/bus-stops.js';
import { placeStreetFurniture, findBridges } from '../src/world/city-streets.js';
import { navGraph } from '../src/world/nav-graph.js';
import { citydriverRoute, journeyStart, roadAt, surfaceAt } from '../src/world/city-route.js';
import { createWalkerMaterial, createWalkerAlert } from '../src/world/city-life.js';
import { PedestrianContacts } from '../src/world/pedestrian-reactions.js';

// The shelters, gathered once for the file
let shelters = null;
function city() {
  if (!shelters) {
    shelters = [];
    placeStreetFurniture(navGraph(), findBridges(), piece => { if (piece.kind === 'shelter') shelters.push(piece); });
  }
  return { nav: navGraph(), shelters };
}
const busStops = () => { const { nav, shelters } = city(); return new BusStops(null, createWalkerMaterial(), createWalkerAlert(), shelters, nav); };
// Someone watching from the block behind a stop, out of everyone's way
const watcher = (s, u) => ({ s, u, heading: 0, speed: 0, airborne: true, groundedPosition: new THREE.Vector3(1e5, 0, 1e5), velocity: new THREE.Vector3(), spec: { width: 1.9, length: 4.4 } });

// The bus on a stop's street `before` metres short of it at its own pace
// (room to stop from a boulevard's), the rest of the traffic out of the
// way, and whoever is to wait there
function stage(waiting = 2, before = 90) {
  const stops = busStops(), stop = stops.stops.find(each => each.along > before + 5);
  const player = watcher(stop.s + stop.ny * 8, stop.x + stop.nx * 8);
  const traffic = new CityTraffic(new THREE.Scene(), citydriverRoute, player.s, 'city', player.u);
  traffic.stops = stops;
  for (const car of traffic.vehicles) { car.edge = null; car.car.visible = false; car.s = car.u = 1e6; car.position.set(1e6, 0, 1e6); }
  traffic.spawn = () => false;
  const bus = traffic.vehicles.find(car => car.service), edge = stop.edge;
  Object.assign(bus, { edge, direction: stop.direction, along: stop.along - before, next: null, turn: null, after: null, loose: null, recover: null, rock: null, dazed: 0, shoved: false, tries: 0, stranded: 0, stopWait: 0 });
  bus.service.rest = 0; traffic.leaveStop(bus); traffic.settle(bus, edge.profile.lane);
  bus.pace = .8; bus.cruiseSpeed = bus.speed = edge.profile.speed * .8;
  traffic.choose(bus); traffic.pose(bus); bus.car.visible = true;
  const state = stops.state(stop);
  state.waiting.length = 0; state.next = Infinity;
  for (let k = 0; k < waiting; k++) stops.wait(stop, state, stops.person(stop));
  return { stops, stop, state, traffic, bus, player, riders: [...state.waiting], contacts: new PedestrianContacts() };
}
// The game's order: the traffic steps, then the people are drawn
function run(scene, seconds, each = () => {}) {
  const { traffic, stops, player, contacts } = scene;
  for (let f = 0; f < seconds * 60; f++) {
    const time = (scene.time = (scene.time ?? 0) + 1 / 60);
    traffic.update(1 / 60, player);
    contacts.update(player, traffic, time, null);
    stops.animate(time, contacts);
    if (each(time) === false) return;
  }
}

test('every bus stop is a shelter by a bus road, where the bus stops by the kerb with its front door at the shelter', () => {
  const { shelters } = city(), stops = busStops().stops;
  assert.ok(stops.length > 50 && stops.length > shelters.length * .3, `${stops.length} stops of ${shelters.length} shelters`);
  const { nav } = city();
  for (const stop of stops) {
    const profile = stop.edge.profile, half = BUS_MODEL.width / 2;
    assert.ok(BUS_ROADS.has(stop.edge.kind), stop.edge.kind);
    // (pulled in from the kerb lane to just short of the kerb)
    assert.ok(stop.lane >= profile.lane && stop.lane + half <= stop.kerb - .25 && stop.kerb - stop.lane - half < 1.5, `lane ${stop.lane} kerb ${stop.kerb}`);
    const at = nav.pose(stop.edge, stop.along, stop.direction, stop.lane);
    assert.equal(surfaceAt(at.s, at.u), 'road', 'the bus waits in the road');
    const door = nav.pose(stop.edge, stop.along + BUS_DOORS.on, stop.direction, stop.kerb);
    assert.ok(Math.hypot(door.u - stop.x, door.s - stop.s) < 3, 'its front door by the shelter');
  }
});

test('the bus calls where someone waits: pulls in by the kerb, lets them on and someone off, and pulls out into its lane', () => {
  const scene = stage(2), { traffic, bus, stop, state, stops, riders } = scene;
  // (someone on board wants to get off here)
  stops.random = () => .2;
  const home = lanesOf(stop.edge.profile)[0];
  let arrived = null, waited = 0, left = null, back = null, offRoad = 0;
  try {
    // (until it is back in its lane: past there it may call at the next stop)
    run(scene, 45, () => {
      if (surfaceAt(bus.s, bus.u) !== 'road') offRoad++;
      if (bus.service.state === 'wait') {
        arrived ??= { lane: bus.lane, along: bus.along };
        waited += 1 / 60;
        // (it rolls up at a walking pace, and stands once the brakes have it)
        assert.ok(bus.speed < (waited > .25 ? .05 : .8), `still at the stop (${bus.speed.toFixed(2)} m/s)`);
      } else if (arrived && !left) left = { off: stops.walking.length };
      else if (left && !bus.service.state) { back = { lane: bus.lane, speed: bus.speed, edge: bus.edge, along: bus.along }; return false; }
    });
    assert.ok(arrived, 'the bus called');
    assert.ok(Math.abs(arrived.lane - stop.lane) < .05 && Math.abs(arrived.along - stop.along) < .5, `stopped at lane ${arrived.lane.toFixed(2)}, ${(stop.along - arrived.along).toFixed(2)} m short`);
    assert.ok(waited > 3 && waited < 12, `waited ${waited.toFixed(1)} s`);
    assert.ok(riders.every(rider => rider.gone) && !state.waiting.length, 'everyone waiting got on');
    assert.equal(left.off, 1, 'and someone got off');
    const off = stops.walking[0];
    assert.notEqual(surfaceAt(off.s, off.x), 'road', 'walking off along the pavement');
    assert.ok(off.pace > 0);
    assert.ok(back, 'it pulled out');
    assert.equal(back.lane, home, 'back in its lane');
    assert.ok(back.speed > 3 && (back.edge !== stop.edge || back.along > stop.along + 5), `and on its way (${back.speed.toFixed(1)} m/s, ${(back.along - stop.along).toFixed(1)} m on)`);
    assert.equal(offRoad, 0);
  } finally { traffic.dispose(); }
});

test('with nobody waiting and nobody getting off, the bus drives on past the stop', () => {
  const scene = stage(0), { traffic, bus, stop, stops } = scene;
  stops.random = () => .99;
  let slowest = Infinity, passed = false;
  try {
    // (until it is well past: the next stop may have people waiting)
    run(scene, 12, () => {
      assert.equal(bus.edge, stop.edge);
      assert.notEqual(bus.service.state, 'wait');
      assert.equal(bus.lane, lanesOf(stop.edge.profile)[0], 'in its lane');
      if (Math.abs(bus.along - stop.along) < 20) slowest = Math.min(slowest, bus.speed);
      if (bus.along > stop.along + 20) { passed = true; return false; }
    });
    assert.ok(passed && slowest > 6, `slowed to ${slowest.toFixed(1)} m/s`);
  } finally { traffic.dispose(); }
});

test('knocked loose at a stop, the bus leaves those not yet on to wait for the next', () => {
  const scene = stage(3), { traffic, bus, state, riders } = scene;
  let struck = false;
  try {
    run(scene, 30, () => {
      if (bus.service.state !== 'wait' || struck) return struck && !bus.loose ? false : undefined;
      // (shoved off toward the middle of the road, before anyone is on)
      const h = bus.heading;
      traffic.strike(bus, -Math.cos(h) * 5, -Math.sin(h) * 5, 0);
      struck = true;
    });
    assert.ok(struck && bus.service.state === null);
    assert.ok(riders.every(rider => !rider.gone) && riders.every(rider => state.waiting.includes(rider)), 'all of them back waiting');
    assert.ok(state.waiting.every(rider => !rider.hidden));
  } finally { traffic.dispose(); }
});

test('the bus keeps to the main roads, comes by now and then, rests out of sight between, and can be borrowed', () => {
  const start = journeyStart();
  // (parked off the road near the start, as the traffic's soak test is)
  const spot = (() => { for (let r = 10; r < 90; r += 4) for (let a = 0; a < 12; a++) { const s = start.s + Math.sin(a) * r, u = start.u + Math.cos(a) * r, road = roadAt(s, u, 30); if (!road || road.distance > road.road.profile.halfWidth + 6) return { s, u }; } return start; })();
  const player = { ...watcher(spot.s, spot.u), airborne: false };
  const traffic = new CityTraffic(new THREE.Scene(), citydriverRoute, spot.s, 'city', spot.u);
  traffic.stops = busStops();
  const bus = traffic.vehicles.find(car => car.service);
  let duty = 0, rest = 0, onRoutes = 0, calls = 0, state = null;
  try {
    assert.equal(traffic.vehicles.length, 28);
    for (let f = 0; f < 60 * 240; f++) {
      traffic.update(1 / 60, player);
      if (bus.edge) {
        duty++;
        if (BUS_ROADS.has(bus.edge.kind)) onRoutes++;
        assert.ok(bus.car.visible && !bus.loose);
        assert.equal(surfaceAt(bus.s, bus.u), 'road');
      } else {
        rest++;
        assert.ok(!bus.car.visible && Math.hypot(bus.s - player.s, bus.u - player.u) > 1e5, 'resting out of sight and out of the way');
      }
      if (bus.service.state === 'wait' && state !== 'wait') calls++;
      state = bus.service.state;
    }
    assert.ok(duty > 60 * 30 && rest > 60 * 20, `${(duty / 60).toFixed(0)} s on duty, ${(rest / 60).toFixed(0)} s resting`);
    assert.ok(onRoutes / duty > .9, `${(onRoutes / duty * 100).toFixed(0)}% on the main roads`);
    assert.ok(calls > 0, 'it called at a stop');
    // (driven as the garage's bus, and given back to drive on)
    assert.ok(traffic.take(bus) && !traffic.vehicles.includes(bus) && bus.service.state === null);
    traffic.giveBack(bus);
    assert.ok(traffic.vehicles.includes(bus) && bus.service);
  } finally { traffic.dispose(); }
});

test('on foot, a bus is got into at its front door, and a car parked near one still at its own', () => {
  const bus = { spec: BUS_MODEL, position: new THREE.Vector3(10, 24, 0), heading: 0, edge: {}, car: { visible: true }, profile: { height: 3.1 } };
  const bay = { x: 0, z: 5, woken: false, parked: { ready: true, model: 'sedan' } };
  const traffic = { enabled: true, vehicles: [bus], woken: [], profiles: new Map(), bayPose: () => ({ heading: 0 }) };
  const feet = new OnFoot({ groundedPosition: new THREE.Vector3(0, 24, 0) }, traffic);
  assert.equal(feet.shapeOf({ car: bus }).along, BUS_DOORS.on);
  // (one record is filled again for each car asked about: the bay must not keep the bus's door)
  const sedan = TRAFFIC_MODELS.find(model => model.name === 'sedan');
  assert.equal(feet.shapeOf({ bay }).along, sedan.length / 2 * .15);
});
