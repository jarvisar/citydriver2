import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DrivingController } from '../src/vehicle.js';
import { EmergencyGear } from '../src/emergency.js';
import { parkedSpec } from '../src/special-models.js';
import { buildLandmark } from '../src/world/city-landmarks.js';
import { cityPlaces } from '../src/city-exploration.js';
import { Surface } from '../src/world/surface.js';
import { PAVEMENT_LEVEL, citydriverRoute, journeyStart } from '../src/world/city-route.js';
import { CityTraffic } from '../src/city-traffic.js';
import { insidePolygon, distanceToPolyline } from '../src/mapgen/polygon-util.js';

// Flat ground at 24 m, as on-foot.test.js has it, to get out on
const flat = {
  grid: true,
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u, y = 24) => ({ x: u, y, z: -s }),
  height: () => 24,
  water: () => false,
  bounds: () => [-1e9, 1e9],
  nearestLane: (s, u, heading) => ({ s, u: 0, heading }),
};

test('driven, an emergency vehicle flashes one set of beacons at a time and Boost sounds its siren; out of it, both stop', () => {
  const vehicle = new DrivingController(flat, { s: 0, u: 0, heading: 0 }, 'fireengine'), gear = new EmergencyGear();
  try {
    const beacons = vehicle.actor.motion.beacons, seen = { first: 0, second: 0, both: 0 };
    assert.deepEqual(beacons.toArray(), [0, 0], 'dark until driven');
    for (let i = 0; i < 120; i++) {
      gear.update(1 / 60, vehicle, false);
      const [first, second] = beacons.toArray();
      seen.first += first > 0; seen.second += second > 0; seen.both += first > 0 && second > 0;
    }
    assert.ok(seen.first > 15 && seen.second > 15 && seen.both === 0, JSON.stringify(seen));
    assert.equal(gear.siren, null, 'no siren without Boost');
    gear.update(1 / 60, vehicle, true);
    assert.equal(gear.siren, 'wail');
    // Brighter after dark
    let day = 0, night = 0;
    for (let i = 0; i < 60; i++) { gear.update(1 / 60, vehicle); day = Math.max(day, ...beacons.toArray()); }
    vehicle.setLights(1);
    for (let i = 0; i < 60; i++) { gear.update(1 / 60, vehicle); night = Math.max(night, ...beacons.toArray()); }
    assert.ok(night > day * 1.5, `${day} by day, ${night} at night`);
    // Out of it: the siren stops and the engine left standing goes dark
    const left = vehicle.stepOut();
    gear.update(1 / 60, vehicle, true);
    assert.equal(gear.siren, null);
    assert.deepEqual(left.motion.beacons.toArray(), [0, 0]);
    // Back in, they flash again; the ambulance has its own siren, and any other car neither
    vehicle.stepIn(left);
    let lit = 0;
    for (let i = 0; i < 60; i++) { gear.update(1 / 60, vehicle, true); lit += beacons.x > 0 || beacons.y > 0; }
    assert.ok(lit > 20 && gear.siren === 'wail');
    vehicle.setCar('ambulance'); gear.update(1 / 60, vehicle, true);
    assert.equal(gear.siren, 'hilo');
    vehicle.setCar('van'); gear.update(1 / 60, vehicle, true);
    assert.equal(gear.siren, null);
  } finally { vehicle.disposeModel(); }
});

// What a landmark puts up that matters here: its building's footprint, the
// car parked on its grounds, and the posts standing round it (flag poles,
// a canopy's posts and anything with a round collider)
function recordLandmark(place) {
  const parked = [], solids = [], posts = [], G = PAVEMENT_LEVEL;
  const c = {
    east: 0, start: 0, distant: false, bodies: new Surface(), materials: { solid: {}, glass: {}, props: {} }, features: { buildings: [], shopLights: [] }, grassAreas: null,
    box() {}, prop() { return {}; }, polygon() {}, tree() {}, signFace() {}, standingSign() {}, solid() {}, rigid(x, s, fn) { fn(); }, knockable() {},
    item(key, geometry, material, p, scale) { if (key.startsWith('detail-round') && p[1] - scale[1] / 2 < G + 1) posts.push({ x: p[0], s: -p[2], radius: scale[0] }); return {}; },
    polygonSolid(points) { solids.push(points.map(([x, y]) => ({ x, y }))); return {}; },
    post(x, s, radius) { posts.push({ x, s, radius }); },
    parkedCar(model, x, s, yaw, colour, base) { parked.push({ model, x, s, yaw, colour, base }); return {}; },
  };
  buildLandmark(c, { polygon: place.polygon, seed: 123 }, place);
  return { parked, solids, posts };
}

test('the fire engine and the ambulance stand on their grounds, clear of the building, its doors and its posts, the driver\'s side to the street', () => {
  for (const place of cityPlaces().filter(p => p.footprint && ['firehouse', 'hospital'].includes(p.type))) {
    const { parked, solids, posts } = recordLandmark(place), model = place.type === 'firehouse' ? 'fireengine' : 'ambulance';
    assert.equal(parked.length, 1, `${place.name} has its ${model}`);
    const car = parked[0], spec = parkedSpec(model), site = place.footprint;
    assert.equal(car.model, model); assert.equal(car.colour, spec.paint);
    // In the car's frame: along its nose, and out of its driver's side
    const nose = { x: -Math.sin(car.yaw), y: Math.cos(car.yaw) }, side = { x: -Math.cos(car.yaw), y: -Math.sin(car.yaw) };
    const at = (along, across) => ({ x: car.x + nose.x * along + side.x * across, y: car.s + nose.y * along + side.y * across });
    const gap = p => {
      const dx = p.x - car.x, dy = p.y - car.s;
      return Math.hypot(Math.max(0, Math.abs(dx * nose.x + dy * nose.y) - spec.length / 2), Math.max(0, Math.abs(dx * side.x + dy * side.y) - spec.width / 2));
    };
    const outline = [];
    for (let k = 0; k <= 20; k++) for (const end of [-1, 1]) {
      outline.push(at(-spec.length / 2 + spec.length * k / 20, end * spec.width / 2), at(end * spec.length / 2, -spec.width / 2 + spec.width * k / 20));
    }
    // On the lot: off the pavement, and well off the carriageway
    for (const p of outline) assert.ok(insidePolygon(p, place.polygon), `${place.name}: its ${model} stands off its lot`);
    // Nowhere in the building, nor so close that, knocked loose, it is shoved out of it
    for (const solid of solids) {
      const loop = [...solid, solid[0]];
      for (const p of outline) assert.ok(!insidePolygon(p, solid) && distanceToPolyline(p, loop) > .5, `${place.name}: its ${model} is against the building`);
      for (const p of solid) assert.ok(gap(p) > .5);
    }
    for (const post of posts) assert.ok(gap({ x: post.x, y: post.s }) > post.radius + .2, `${place.name}: its ${model} stands on a post`);
    // Its driver's side to the street, where they come from to get in
    assert.ok(side.x * -site.nx + side.y * -site.ny > .99, `${place.name}: its ${model} faces the wrong way`);
    // The way in: the hospital's doors are a meter clear, and the fire station's staff door
    const front = { x: site.front.x, y: site.front.y };
    if (model === 'ambulance') assert.ok(gap(front) > 1.9 + .9, `${place.name}: the ambulance blocks the doors`);
    else {
      const staff = { x: front.x + site.tx * (site.width / 2 - 1.1), y: front.y + site.ty * (site.width / 2 - 1.1) };
      assert.ok(gap(staff) > .6 + .4, `${place.name}: the engine blocks the staff door`);
    }
  }
});

test('a traffic reset forgets the siren, whose time was on the old clock', () => {
  const start = journeyStart(), traffic = new CityTraffic(new THREE.Scene(), citydriverRoute, start.s, 'city', start.u);
  try {
    traffic.sirenAt = 120;
    traffic.reset(citydriverRoute, start.s, 'city', start.u);
    assert.equal(traffic.sirenAt, -Infinity);
  } finally { traffic.dispose(); }
});
