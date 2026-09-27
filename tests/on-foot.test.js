import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DrivingController } from '../src/vehicle.js';
import { WALKER_SPEC, walkingInput } from '../src/walker.js';
import { OnFoot } from '../src/on-foot.js';
import { circleContact, collideScenery, sightLine } from '../src/collision.js';
import { CityTraffic } from '../src/city-traffic.js';
import { LooseProps } from '../src/loose-props.js';
import { PedestrianContacts } from '../src/world/pedestrian-reactions.js';
import { ThirdPersonCamera } from '../src/third-person-camera.js';
import { GamepadInput } from '../src/gamepad.js';
import { XRInput } from '../src/xr-input.js';
import { DriveSoundModel } from '../src/audio/model.js';
import { engineFor } from '../src/audio/profiles.js';
import { citydriverRoute, journeyStart, onRoadAt } from '../src/world/city-route.js';

// Flat ground at 24 m, a kerb 12 cm up east of u = 20, and north of s = 200 water, 6 m lower
const GROUND = 24, KERB = 20;
const flat = {
  grid: true,
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u, y = flat.height(s, u)) => ({ x: u, y, z: -s }),
  height: (s, u) => s > 200 ? 17.8 : u > KERB ? GROUND + .12 : GROUND,
  water: s => s > 200,
  bounds: () => [-1e9, 1e9],
  nearestLane: (s, u, heading) => ({ s: Math.min(s, 190), u: 0, heading }),
};
const step = 1 / 120;
// A traffic car on its rails `back` metres behind (s, u), in the lane going the way `heading` points
function behind(traffic, car, s, u, heading, back, speed) {
  const hit = traffic.nav.nearest(s, u), edge = hit.edge, direction = Math.sin(heading) * hit.tx + Math.cos(heading) * hit.ty >= 0 ? 1 : -1;
  const along = (direction > 0 ? hit.along : edge.length - hit.along) - back;
  Object.assign(car, { edge, direction, along, lane: edge.profile.lane, next: null, turn: null, after: null, loose: null, recover: null, dazed: 0, speed, claim: null, leaving: null });
  traffic.choose(car); traffic.pose(car);
  return car;
}
function onFoot(state = { s: 0, u: 0, heading: 0 }, car = 'sedan') {
  const scene = new THREE.Scene(), vehicle = new DrivingController(flat, state, car);
  vehicle.freeDriving = true; scene.add(vehicle.car);
  return { scene, vehicle };
}
const walk = (vehicle, seconds, input = {}, chunks = null) => {
  for (let i = 0; i < Math.round(seconds / step); i++) { vehicle.update(step, input); if (chunks) collideScenery(vehicle, chunks, step); }
};
const north = { walk: { x: 0, z: -1 } };
// One chunk holding `colliders`
const chunkOf = (...colliders) => new Map([['a', { collisionBounds: { minX: -1e3, maxX: 1e3, minZ: -1e3, maxZ: 1e3 }, features: { colliders } }]]);
// A building 10 m square whose south face is at s = 20
const building = { corners: [{ x: -5, z: -20 }, { x: 5, z: -20 }, { x: 5, z: -30 }, { x: -5, z: -30 }], x: 0, z: -25, reach: 8, top: 34 };

test('a round footprint meets posts and outlines from outside and in, and slides off corners', () => {
  const post = { x: 0, z: 0, reach: .2 };
  assert.equal(circleContact({ x: 1, z: 0, radius: .3 }, post), null);
  const touch = circleContact({ x: .4, z: 0, radius: .3 }, post);
  assert.ok(Math.abs(touch.depth - .1) < 1e-9 && touch.x === 1 && touch.z === 0, 'pushed straight out, away from the post');
  // Beside the south face, over a corner, and inside
  const face = circleContact({ x: 0, z: -19.8, radius: .32 }, building);
  assert.ok(Math.abs(face.depth - .12) < 1e-9 && face.z === 1, 'out through the face it overlaps');
  const corner = circleContact({ x: 5.2, z: -19.8, radius: .32 }, building);
  assert.ok(corner && Math.abs(corner.x - Math.SQRT1_2) < 1e-6 && Math.abs(corner.z - Math.SQRT1_2) < 1e-6, 'out along the diagonal off a corner');
  const inside = circleContact({ x: 0, z: -21, radius: .32 }, building);
  assert.ok(inside.z === 1 && Math.abs(inside.depth - 1.32) < 1e-9, 'from inside, out through the nearest face');
  assert.equal(circleContact({ x: 5.3, z: -19.7, radius: .32 }, building), null, 'a corner it only nearly touches');
  // A turned box without corners
  assert.ok(circleContact({ x: 0, z: 1.1, radius: .3 }, { x: 0, z: 0, heading: 0, halfWidth: 1, halfLength: 1, reach: 1.5 }));
});

test('out of the car the controller walks one of the residents, and the car it left is kept whole', () => {
  const { scene, vehicle } = onFoot();
  const car = vehicle.car, parked = vehicle.stepOut();
  try {
    assert.ok(vehicle.walker && !vehicle.pilot);
    assert.equal(vehicle.spec, WALKER_SPEC); assert.equal(vehicle.carId, 'walker');
    assert.equal(parked.model.car, car, 'the car model is handed back as it stands');
    assert.equal(car.parent, scene, 'still standing in the scene');
    assert.equal(vehicle.car.parent, scene); assert.notEqual(vehicle.car, car);
    assert.equal(vehicle.car.getObjectByName('walker-figure').isInstancedMesh, true);
    assert.equal(vehicle.nightLights.length, 0, 'no headlights on a person');
    assert.ok(vehicle.car.userData.leash && vehicle.car.userData.chaseScale < 1, 'the chase camera frames a person');
    assert.equal(vehicle.groundedPosition.y, GROUND);
    // Back into the same car, just as it was
    vehicle.s = 0; vehicle.u = 0; vehicle.stepIn(parked);
    assert.equal(vehicle.car, car); assert.equal(vehicle.carId, 'sedan'); assert.ok(!vehicle.walker);
    assert.ok(!vehicle.car.userData.leash, 'the car keeps its own framing');
    walk(vehicle, 1, { forward: 1 });
    assert.ok(vehicle.speed > 8, 'and it drives');
  } finally { vehicle.disposeModel(); }
});

test('on foot they jog, walk at a gentle push, sprint, turn to face the way they go and hop', () => {
  const { vehicle } = onFoot();
  vehicle.stepOut();
  try {
    walk(vehicle, 2, north);
    assert.ok(Math.abs(vehicle.speed - 4.4) < .01 && vehicle.s > 7.5, `jogs ${vehicle.speed.toFixed(2)} m/s`);
    assert.ok(Math.abs(vehicle.heading) < 1e-6);
    walk(vehicle, 1, { walk: { x: 0, z: -.4 } });
    assert.ok(Math.abs(vehicle.speed - 1.76) < .01, 'a gentle push walks');
    walk(vehicle, 1.5, { walk: { x: 1, z: 0 }, sprint: true });
    assert.ok(Math.abs(vehicle.speed - 7.4) < .01, 'sprints');
    assert.ok(Math.abs(vehicle.heading - Math.PI / 2) < .01, 'facing east, the way they run');
    assert.ok(vehicle.boosting, 'the sprint shows as the Boost button');
    walk(vehicle, 1, {});
    assert.equal(vehicle.speed, 0, 'and stop when let go');
    // A hop, once per press
    let top = 0;
    for (let i = 0; i < 240; i++) { vehicle.update(step, { jump: true }); top = Math.max(top, vehicle.groundedPosition.y - GROUND); }
    assert.ok(top > .5 && top < .75, `hopped ${top.toFixed(2)} m`);
    assert.ok(vehicle.walker.grounded && vehicle.groundedPosition.y === GROUND, 'and landed, however long it was held');
    // Through their own eyes, back is a step back and the sides turn them
    const heading = vehicle.heading;
    walk(vehicle, 1, { walk: { x: -Math.sin(heading), z: Math.cos(heading) }, face: false });
    assert.ok(Math.abs(vehicle.heading - heading) < 1e-9 && vehicle.speed > 4, 'backed up, still facing on');
    walk(vehicle, 1, { turn: 1 });
    assert.ok(Math.abs(vehicle.heading - heading - 1) < 1e-6);
    // Up and down a kerb in their stride, but never into the water
    vehicle.s = 0; vehicle.u = 18; vehicle.update(0, {});
    walk(vehicle, 1, { walk: { x: 1, z: 0 } });
    assert.ok(vehicle.u > KERB && Math.abs(vehicle.groundedPosition.y - GROUND - .12) < 1e-9, 'stepped up the kerb');
    vehicle.s = 198; vehicle.u = 0; vehicle.update(0, {});
    walk(vehicle, 2, { walk: { x: .3, z: -1 } });
    assert.ok(vehicle.s <= 200 && vehicle.u > 1, 'stopped at the water, and went along its edge');
  } finally { vehicle.disposeModel(); }
});

test('walls stop them without knocking anything loose: they slide along and round a building', () => {
  const { vehicle } = onFoot({ s: 10, u: 0, heading: 0 });
  vehicle.stepOut();
  const chunks = chunkOf(building), prop = { x: 0, z: -15, reach: .3, prop: { ready: true } };
  try {
    walk(vehicle, 3, north, chunks);
    assert.ok(Math.abs(vehicle.s - (20 - .32)) < .01, `stopped at the wall, ${vehicle.s.toFixed(3)}`);
    const pressed = vehicle.wheelSpin;
    walk(vehicle, 1, north, chunks);
    assert.ok(Math.abs(vehicle.s - (20 - .32)) < .01 && vehicle.wheelSpin === pressed, 'held there, not walking on the spot');
    walk(vehicle, 5, { walk: { x: .4, z: -1 } }, chunks);
    assert.ok(vehicle.u > 5 && vehicle.s > 20, 'slid along it and round its corner');
    // A lamp or a bin is a post like any other (on foot nothing is woken:
    // main.js passes no `wake`), and stays standing
    vehicle.s = 12; vehicle.u = 0; vehicle.walker.stop(); vehicle.update(0, {});
    walk(vehicle, 2, north, chunkOf(prop));
    assert.ok(Math.abs(vehicle.s - (15 - .3 - .32)) < .01, `stopped at the post, ${vehicle.s.toFixed(3)}`);
    assert.ok(!prop.woken);
  } finally { vehicle.disposeModel(); }
});

test('the controls point the way to walk from the camera: chased, from above and through their eyes', () => {
  const chase = new THREE.PerspectiveCamera(), close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
  // Looking north and a little down: up is north, right is east
  chase.position.set(0, 3, 5); chase.lookAt(0, 1, 0);
  let out = walkingInput({ moveY: 1 }, chase);
  close(out.walk.x, 0); close(out.walk.z, -1); assert.ok(out.face);
  out = walkingInput({ moveX: 1 }, chase);
  close(out.walk.x, 1); close(out.walk.z, 0);
  out = walkingInput({ moveX: .5, moveY: .5 }, chase);
  close(Math.hypot(out.walk.x, out.walk.z), Math.SQRT1_2); close(out.walk.x, -out.walk.z);
  // The touch stick takes over from the keys, as far as it is pushed
  out = walkingInput({ moveY: 1, touchStick: { x: 0, y: -.5 } }, chase);
  close(out.walk.z, .5);
  // From above: the ground direction that crosses the screen the way the stick does
  const above = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 1000);
  above.position.set(-220, 245, 260); above.lookAt(0, 0, 0);
  for (const [x, y] of [[0, 1], [1, 0], [.7, .7]]) {
    out = walkingInput({ moveX: x, moveY: y }, above);
    above.updateMatrixWorld();
    const screen = new THREE.Vector3(out.walk.x, 0, out.walk.z).applyMatrix4(new THREE.Matrix4().extractRotation(above.matrixWorldInverse));
    close(Math.atan2(screen.x, screen.y), Math.atan2(x, y));
  }
  // Through their own eyes: forward and back along the way they face, the sides turn them
  out = walkingInput({ moveY: -1, moveX: 1 }, chase, { firstPerson: true, heading: Math.PI / 2 });
  close(out.walk.x, -1); close(out.walk.z, 0); assert.equal(out.face, false); assert.ok(out.turn > 0);
  out = walkingInput({ lookX: -1 }, chase, { firstPerson: true });
  assert.ok(out.turn < 0, 'the right stick turns them too');
  assert.equal(walkingInput({ jump: 1, sprint: 1 }, chase).jump && walkingInput({ jump: 1, sprint: 1 }, chase).sprint, true);
});

test('the chase camera trails someone on foot on a leash and frames them closer, and leaves a car as it was', () => {
  const figure = new THREE.Object3D(), camera = new ThirdPersonCamera(), dt = 1 / 60;
  camera.resize(1.6);
  figure.userData = { leash: true, chaseScale: .36, chaseLift: .75, velocity: { x: 0, z: 0 } };
  camera.update(figure, 0);
  assert.equal(camera.scale, .36);
  const behind = () => camera.camera.position.distanceTo(figure.position);
  assert.ok(behind() > 4 && behind() < 7, `about 5 m from them: ${behind().toFixed(1)}`);
  // Walking toward the camera does not swing it round
  figure.userData.velocity.z = 4.4;
  for (let i = 0; i < 60; i++) { figure.position.z += 4.4 * dt; camera.update(figure, dt); }
  assert.ok(Math.abs(camera.heading) < 1e-9, 'the camera backs away rather than turning');
  // Walking across its view turns it gradually, behind them
  figure.userData.velocity.z = 0; figure.userData.velocity.x = 4.4;
  for (let i = 0; i < 60; i++) { figure.position.x += 4.4 * dt; camera.update(figure, dt); }
  assert.ok(camera.heading > .3 && camera.heading < Math.PI / 2, `turned ${camera.heading.toFixed(2)} rad toward the way they go`);
  // The mouse turns it for good
  const heading = camera.heading;
  figure.userData.velocity.x = 0; camera.look(.5, 0); camera.update(figure, dt);
  assert.ok(Math.abs(camera.heading - heading - .5) < 1e-9 && camera.lookYaw === 0);
  // Into a car, it eases back to a car's framing and swings round behind it
  const car = new THREE.Object3D();
  car.position.copy(figure.position); car.rotation.y = -1;
  for (let i = 0; i < 240; i++) camera.update(car, dt);
  assert.equal(camera.scale, 1); assert.equal(camera.lift, 0);
  assert.ok(Math.abs(camera.heading - 1) < .01, 'behind the car');
});

test('cars come between someone on foot and the camera; a car camera still looks over them', () => {
  const chunks = chunkOf(), from = new THREE.Vector3(0, 25.2, 0), to = new THREE.Vector3(0, 26.3, 5);
  const bodies = [{ x: 0, z: 2.5, heading: Math.PI / 2, halfWidth: 1, halfLength: 2.2, y: 24 }];
  assert.equal(sightLine(chunks.values(), from, to), 1, 'no building in the way');
  const open = sightLine(chunks.values(), from, to, 0, { ground: 24, bodies });
  assert.ok(open > .1 && open < .5, `pulled in in front of the car: ${open.toFixed(2)}`);
  // A car camera's line runs over the roofs
  assert.equal(sightLine(chunks.values(), new THREE.Vector3(0, 27.2, 0), new THREE.Vector3(0, 29, 14), 0, { ground: 24, bodies }), 1);
  // A trunk the camera would stand in brings it in to just before it; one it looks past does not
  const trunk = { x: 0, z: 4.9, reach: .28 }, trees = chunkOf(trunk), none = { ground: 24, bodies: [] };
  const before = sightLine(trees.values(), from, to, 0, none);
  assert.ok(before > .8 && before < .9, `just short of the trunk: ${before.toFixed(3)}`);
  assert.equal(sightLine(trees.values(), from, to), 1, 'a car camera looks through trunks as ever');
  trunk.z = 2.5;
  assert.equal(sightLine(trees.values(), from, to, 0, none), 1, 'a trunk between is only glimpsed past');
});

test('traffic brakes for someone on foot, a car barely leaning on them carries them, and one that hits them knocks them over', () => {
  const scene = new THREE.Scene(), start = journeyStart(), vehicle = new DrivingController(citydriverRoute, start, 'taxi');
  scene.add(vehicle.car); vehicle.freeDriving = true;
  const traffic = new CityTraffic(scene, vehicle.route, vehicle.s, 'city', vehicle.u), props = new LooseProps(scene, new THREE.MeshStandardMaterial());
  vehicle.props = props; vehicle.stepOut();
  try {
    // A car coming up the lane behind them, standing in the road, stops short
    const car = behind(traffic, traffic.vehicles[0], vehicle.s, vehicle.u, vehicle.heading, 12, 10);
    assert.ok(traffic.following(car, vehicle) < 10 && traffic.blocker === vehicle, 'braking for them');
    // Leaned on at a crawl: carried along, still standing
    const touching = car.spec.length / 2 + WALKER_SPEC.radius - .1;
    behind(traffic, car, vehicle.s, vehicle.u, vehicle.heading, touching, 1.5);
    traffic.collidePlayer(car, vehicle);
    assert.ok(!vehicle.walker.down, 'a nudge does not knock them over');
    assert.ok(vehicle.walker.vx * Math.sin(car.heading) - vehicle.walker.vz * Math.cos(car.heading) > 1, 'carried along');
    // The car takes nothing from a person on foot
    assert.ok(car.loose === null && car.speed === 1.5);
    // Hit at speed: knocked flying, down a while, then up where they landed
    vehicle.walker.stop(); vehicle.update(0, {});
    behind(traffic, car, vehicle.s, vehicle.u, vehicle.heading, touching, 12);
    traffic.collidePlayer(car, vehicle);
    assert.ok(vehicle.walker.down, 'knocked over');
    assert.ok(!vehicle.walker.standing);
    let up = null;
    for (let i = 0; i < 120 * 12 && !up; i++) {
      props.update(step, vehicle, null, null); vehicle.update(step, north);
      const body = vehicle.walker.down?.body;
      if (body) props.personMatrix(body, new THREE.Matrix4());
      if (vehicle.walker.standing) up = i * step;
    }
    assert.ok(up !== null && up > 1, `back on their feet after ${up?.toFixed(1)} s`);
    assert.ok(Number.isFinite(vehicle.s) && Number.isFinite(vehicle.groundedPosition.y));
  } finally { traffic.dispose(); props.dispose(); vehicle.disposeModel(); }
});

test('out of the car and back in: by the driver\'s door, stopping first, and the car left parked in the traffic\'s way', () => {
  const scene = new THREE.Scene(), start = journeyStart(), vehicle = new DrivingController(citydriverRoute, start, 'coast');
  scene.add(vehicle.car); vehicle.freeDriving = true;
  const traffic = new CityTraffic(scene, vehicle.route, vehicle.s, 'city', vehicle.u), feet = new OnFoot(vehicle, traffic);
  try {
    assert.deepEqual(feet.offer(), { out: true, stopping: false });
    // Moving, it stops first
    for (let i = 0; i < 120; i++) vehicle.update(step, { forward: 1 });
    assert.ok(vehicle.speed > 5);
    assert.equal(feet.use(), ''); assert.ok(feet.leaving && !feet.walking);
    for (let i = 0; i < 600 && !feet.walking; i++) { vehicle.update(step, feet.control({ forward: 1 })); feet.update(step); }
    assert.ok(feet.walking && !feet.leaving, 'out once it had stopped');
    const car = feet.parked;
    assert.ok(car && traffic.playerCars.includes(car), 'the car is left parked, in the traffic\'s way');
    assert.equal(car.kept.carId, 'coast');
    // By the driver's door: on its left, beside the middle
    const dx = vehicle.groundedPosition.x - car.position.x, dz = vehicle.groundedPosition.z - car.position.z;
    const across = dx * Math.cos(car.heading) + dz * Math.sin(car.heading);
    assert.ok(across < -car.spec.width / 2 && across > -car.spec.width / 2 - 1, `beside the left side: ${across.toFixed(2)}`);
    assert.ok(Math.abs(vehicle.heading - car.heading) < 1e-9, 'facing the way the car does');
    // The traffic brakes for it: a car coming up behind it in its lane
    const other = behind(traffic, traffic.vehicles.find(c => c.edge), car.s, car.u, car.heading, 12, 10);
    vehicle.s += 30; vehicle.update(0, {});
    const limit = traffic.following(other, vehicle);
    assert.ok(traffic.blocker === car && limit < 10, 'the traffic brakes for it');
    vehicle.s -= 30; vehicle.update(0, {});
    // Walking into it moves it not at all
    const at = car.position.clone();
    for (let i = 0; i < 240; i++) { vehicle.update(step, { walk: { x: at.x - vehicle.groundedPosition.x, z: at.z - vehicle.groundedPosition.z } }); feet.update(step); }
    assert.ok(car.position.distanceTo(at) < 1e-6, 'leaned on, it stays put');
    // Paint reaches it where it stands
    assert.ok(feet.paint('#123456'));
    // Back in
    assert.equal(feet.offer().own, true); assert.equal(feet.offer().name, 'Surf Wagon');
    assert.equal(feet.use(), '');
    assert.ok(!feet.walking && !feet.parked && !traffic.playerCars.length);
    assert.equal(vehicle.car, car.car); assert.equal(vehicle.paintColor, '#123456');
    assert.ok(Math.abs(vehicle.s - car.s) < 1e-9 && Math.abs(vehicle.heading - car.heading) < 1e-9);
  } finally { feet.clear(); traffic.dispose(); vehicle.disposeModel(); }
});

test('a borrowed traffic car is driven as it was going, and given back drives on its way without turning back', () => {
  const scene = new THREE.Scene(), start = journeyStart(), vehicle = new DrivingController(citydriverRoute, start, 'coast');
  scene.add(vehicle.car); vehicle.freeDriving = true;
  const traffic = new CityTraffic(scene, vehicle.route, vehicle.s, 'city', vehicle.u), feet = new OnFoot(vehicle, traffic);
  try {
    for (let i = 0; i < 240; i++) traffic.update(step, vehicle);
    feet.use();
    const car = traffic.vehicles.find(c => c.edge && !c.loose && c.speed > 3);
    // Beside its door
    vehicle.s = car.s + Math.sin(car.heading) * 1.4; vehicle.u = car.u - Math.cos(car.heading) * 1.4; vehicle.update(0, {});
    const offer = feet.offer();
    assert.equal(offer.car, car); assert.equal(offer.own, false);
    const speed = car.speed, count = traffic.vehicles.length;
    assert.match(feet.use(), /borrowed$/);
    assert.equal(feet.borrowed, car); assert.equal(traffic.vehicles.length, count - 1, 'out of the traffic while borrowed');
    assert.ok(!car.car.visible);
    assert.equal(vehicle.carId, car.spec.name); assert.equal(vehicle.paintColor, `#${car.paint.color.getHexString()}`);
    assert.ok(Math.abs(vehicle.speed - speed) < 1e-6, 'moving as it was');
    assert.ok(feet.parked, 'their own car still parked');
    // Drive it on a little, stop, and get out
    for (let i = 0; i < 120; i++) { vehicle.update(step, { forward: 1 }); traffic.update(step, vehicle); }
    for (let i = 0; i < 360; i++) { vehicle.update(step, { handbrake: 1 }); traffic.update(step, vehicle); }
    const left = { s: vehicle.s, u: vehicle.u, heading: vehicle.heading };
    feet.use();
    assert.ok(feet.walking && !feet.borrowed);
    assert.ok(traffic.vehicles.includes(car) && car.car.visible, 'back in the traffic where they left it');
    assert.ok(Math.hypot(car.s - left.s, car.u - left.u) < 1e-6);
    // Its driver drives on, back to its lane the way it faces, never back the way it came
    let driving = false, back = 0;
    for (let i = 0; i < 120 * 20 && !driving; i++) {
      traffic.update(step, vehicle);
      back = Math.min(back, (car.u - left.u) * Math.sin(left.heading) + (car.s - left.s) * Math.cos(left.heading));
      driving = !car.loose && !car.recover && car.speed > 1;
    }
    assert.ok(driving, 'on its rails again, and moving');
    assert.ok(Math.cos(car.heading - left.heading) > 0, 'going the way it faced');
    assert.ok(back > -1, `never backed along the way it came (${back.toFixed(2)} m)`);
    assert.ok(onRoadAt(car.s, car.u), 'in a street');
    // Garage or a run: the borrowed car goes back, the parked one away
    feet.clear();
    assert.ok(!feet.parked && !traffic.playerCars.length);
  } finally { feet.clear(); traffic.dispose(); vehicle.disposeModel(); }
});

test('no getting out of the helicopter, and nobody gets in a car lying on the ground', () => {
  const scene = new THREE.Scene(), start = journeyStart(), vehicle = new DrivingController(citydriverRoute, start, 'helicopter');
  scene.add(vehicle.car);
  const traffic = new CityTraffic(scene, vehicle.route, vehicle.s, 'city', vehicle.u), feet = new OnFoot(vehicle, traffic);
  try {
    assert.equal(feet.offer(), null); assert.equal(feet.use(), ''); assert.ok(!feet.walking && !feet.leaving);
    vehicle.setCar('taxi'); feet.use(); assert.ok(feet.walking);
    vehicle.walker.down = { body: { p: new THREE.Vector3(), asleep: false } };
    assert.equal(feet.offer(), null); assert.equal(feet.use(), '');
    vehicle.walker.down = null;
  } finally { feet.clear(); traffic.dispose(); vehicle.disposeModel(); }
});

test('residents give way to someone on foot, look round at them, and are bowled over by a charge', () => {
  const contacts = new PedestrianContacts(), scene = new THREE.Scene(), props = new LooseProps(scene, new THREE.MeshStandardMaterial());
  const { vehicle } = onFoot({ s: 0, u: 0, heading: 0 });
  vehicle.props = props; vehicle.stepOut();
  const frame = new THREE.Matrix4(), person = {}, at = (x, z) => new THREE.Matrix4().makeTranslation(x, GROUND, z);
  try {
    contacts.update(vehicle, null, 0, props);
    assert.equal(contacts.count, 0, 'someone on foot is no car');
    // Walking into them: they are moved out of the way, most of the overlap
    vehicle.walker.vx = 0; vehicle.walker.vz = -1.5;
    let matrix = at(0, -.4);
    contacts.person(person, matrix, frame, .28, 1);
    assert.ok(matrix.elements[14] < -.4 - .1, 'pushed on ahead of them');
    assert.ok(person.shove && person.shovedBy?.until > 1, 'and look round at them');
    assert.ok(vehicle.walker.vz > -1.5, 'pushing through costs a little');
    // Left alone, they step back onto their walk
    matrix = at(0, -3);
    contacts.person(person, matrix, frame, .28, 5);
    assert.equal(person.shove, null); assert.equal(matrix.elements[14], -3);
    // Pushed only so far: then the one pushing is stopped instead
    for (let t = 6; t < 7; t += 1 / 60) {
      matrix = at(0, -.3); vehicle.walker.vz = -1; contacts.person(person, matrix, frame, .28, t);
    }
    assert.ok(Math.hypot(person.shove.x, person.shove.z) <= 2.5 + 1e-9);
    // A charge bowls them over
    const charged = {};
    vehicle.s = 0; vehicle.u = 0; vehicle.update(0, {}); vehicle.walker.vz = -7.4;
    assert.equal(contacts.person(charged, at(0, -.4), frame, .28, 8), true);
    assert.ok(charged.body, 'knocked flying');
  } finally { props.dispose(); vehicle.disposeModel(); }
});

test('a controller gets in and out with Y in free drive (still reset in a run), walks on the left stick and looks on the right', () => {
  const device = { index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const actions = [], input = new GamepadInput(action => actions.push(action), () => {}, () => [device]);
  const press = (index, options) => { device.buttons[index] = { pressed: true, value: 1 }; input.update(options); device.buttons[index] = { pressed: false, value: 0 }; input.update(options); };
  input.update(); input.update();
  press(3); press(3, { freeDrive: true });
  assert.deepEqual(actions, ['reset', 'use']);
  device.axes = [.5, -1, 1, .6]; input.update({ freeDrive: true });
  assert.ok(input.state.moveX > .4 && input.state.moveY === 1 && input.state.lookX === 1 && input.state.lookY > .4);
  device.buttons[0] = { pressed: true, value: 1 }; device.buttons[7] = { pressed: true, value: 1 }; input.update({ freeDrive: true });
  assert.equal(input.state.jump, 1); assert.equal(input.state.sprint, 1);
});

test('in a headset Y gets in and out in free drive, and is still the way back in a menu', () => {
  const controller = handedness => ({ handedness, gamepad: { mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ value: 0 })) } });
  const left = controller('left'), right = controller('right'), sources = [right, left], actions = [], input = new XRInput(action => actions.push(action));
  input.update(sources); input.update(sources);
  const press = options => { left.gamepad.buttons[5].value = 1; input.update(sources, options); left.gamepad.buttons[5].value = 0; input.update(sources, options); };
  press({ freeDrive: true }); press({ freeDrive: true, paused: true }); press();
  assert.deepEqual(actions, ['use', 'pause', 'pause']);
  left.gamepad.axes[2] = .5; left.gamepad.axes[3] = -1; right.gamepad.axes[2] = -1; left.gamepad.buttons[1].value = 1;
  input.update(sources, { freeDrive: true });
  assert.ok(input.state.moveX > .3 && input.state.moveY === 1 && input.state.lookX === -1 && input.state.jump);
});

test('on foot the engine, the tyres and the wind are silent', () => {
  const model = new DriveSoundModel();
  model.setProfile(engineFor('walker'), 7.4);
  const state = model.update({ speed: 7, throttle: 1, offRoad: 1 }, 1 / 30);
  for (const key of ['engineLevel', 'roadLevel', 'roughLevel', 'windLevel', 'reverseLevel', 'load']) assert.equal(state[key], 0, key);
  assert.equal(engineFor('walker').rasp, 0); assert.equal(engineFor('walker').intake, 0);
});
