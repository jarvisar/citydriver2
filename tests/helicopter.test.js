import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CARS, CAR_IDS, GARAGE_IDS, carMeters } from '../src/cars.js';
import { createCar, DrivingController } from '../src/vehicle.js';
import { HELICOPTER_SHAPE } from '../src/helicopter.js';
import { carArt } from '../src/car-art.js';
import { collideScenery, roofUnder } from '../src/collision.js';
import { ThirdPersonCamera } from '../src/third-person-camera.js';
import { GamepadInput } from '../src/gamepad.js';
import { XRInput } from '../src/xr-input.js';
import { DriveSoundModel } from '../src/audio/model.js';
import { engineFor } from '../src/audio/profiles.js';
import { CityTraffic } from '../src/city-traffic.js';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { LooseProps, propTop } from '../src/loose-props.js';
import { citydriverRoute, journeyStart } from '../src/world/city-route.js';

// Flat ground at 24 m; north of s = 200 it is water, 6 m lower, with no quay railing
const GROUND = 24, WATER = 17.8;
const flat = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u, y = GROUND) => ({ x: u, y, z: -s }),
  height: s => s > 200 ? WATER : GROUND,
  water: s => s > 200,
  bounds: () => [-1e9, 1e9],
};
const helicopter = (state = {}) => { const heli = new DrivingController(flat, state, 'helicopter'); heli.freeDriving = true; return heli; };
const fly = (heli, seconds, input = {}, fps = 120) => { for (let i = 0; i < Math.round(seconds * fps); i++) heli.update(1 / fps, input); };
const height = heli => heli.groundedPosition.y - GROUND;
// A chunk holding one building, 20 m square with its roof at `top`, its middle `z` along -z
function block(top, z = -60, extra = {}) {
  const building = { corners: [{ x: -10, z: z - 10 }, { x: 10, z: z - 10 }, { x: 10, z: z + 10 }, { x: -10, z: z + 10 }], x: 0, z, reach: Math.hypot(10, 10), top, ...extra };
  return { collisionBounds: { minX: -10, maxX: 10, minZ: z - 10, maxZ: z + 10 }, features: { colliders: [building] } };
}

test('the helicopter is in the garage but not the wheeled fleet, and has a model, art and meters', () => {
  assert.ok(GARAGE_IDS.includes('helicopter') && !CAR_IDS.includes('helicopter'));
  assert.deepEqual(GARAGE_IDS.filter(id => !CARS[id].flies), CAR_IDS, 'every car is still in the garage, in order');
  assert.ok(!CARS.helicopter.taxi, 'free drive only');
  assert.equal(carMeters('helicopter').length, 4);
  assert.match(carArt('helicopter'), /^<svg[^>]*>.*<ellipse/);
  const model = createCar('helicopter');
  try {
    assert.equal(model.wheels.length, 0);
    assert.equal(model.nightLights.length, 1, 'a beacon, and no headlights to wash the street');
    assert.ok(model.rotors.rotor && model.rotors.tail && model.rotors.disc);
    model.car.traverse(object => {
      if (object.isMesh) assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
    });
    model.rotors.disc.visible = false;
    const box = new THREE.Box3().setFromObject(model.car);
    assert.ok(Math.abs(box.min.y) < .01, `the skids stand on the ground: ${box.min.y}`);
    assert.ok(box.max.x - box.min.x > 8 && box.max.x - box.min.x < HELICOPTER_SHAPE.rotor * 2 + .1, 'the rotor spans the machine');
  } finally { model.disposeModel(); }
});

test('it sits still on the ground, climbs, holds its height hands off and comes down gently', () => {
  const heli = helicopter();
  try {
    fly(heli, 2);
    assert.equal(height(heli), 0); assert.ok(heli.pilot.landed && !heli.airborne);
    assert.ok(heli.pilot.power < .35, 'the rotor idles on the ground');
    fly(heli, 3, { climb: 1 });
    const up = height(heli);
    assert.ok(up > 12 && up < 26, `climbed ${up.toFixed(1)} m in three seconds`);
    assert.ok(heli.airborne && !heli.pilot.landed);
    fly(heli, 2);
    const settled = height(heli);
    fly(heli, 5);
    assert.ok(Math.abs(height(heli) - settled) < .01, 'hands off, it holds its height');
    assert.ok(Math.abs(heli.s - 24) < .01 && Math.abs(heli.u - 2.4) < .01, 'and stays put');
    // Down: it slows as the ground comes up, so it sets down softly
    let touchdown = 0;
    for (let i = 0; i < 120 * 12 && !heli.pilot.landed; i++) { touchdown = -heli.pilot.vy; heli.update(1 / 120, { descend: 1 }); }
    assert.ok(heli.pilot.landed && height(heli) === 0);
    assert.ok(touchdown < 1.5, `touched down at ${touchdown.toFixed(2)} m/s`);
    fly(heli, 4);
    assert.ok(heli.pilot.power < .35, 'and the rotor winds down');
  } finally { heli.disposeModel(); }
});

test('it flies forward to its top speed, turns and banks, and slows to a hover on its own', () => {
  const heli = helicopter(), top = heli.stats.topSpeed;
  try {
    fly(heli, 3, { climb: 1 });
    fly(heli, 1.5, { forward: 1 });
    assert.ok(heli.bodyPitch < -.05, 'the nose dips as it pulls away');
    fly(heli, 10, { forward: 1 });
    const speed = Math.hypot(heli.velocity.x, heli.velocity.z);
    assert.ok(speed > top * .95 && speed <= top + 1e-9, `${speed.toFixed(1)} m/s against ${top}`);
    assert.ok(heli.car.userData.speedRush > .9);
    const heading = heli.heading;
    fly(heli, 1, { forward: 1, right: 1 });
    assert.ok(heli.heading - heading > .8, 'turns right');
    assert.ok(heli.bodyRoll < -.2, 'banking into the turn');
    fly(heli, 8);
    assert.ok(Math.hypot(heli.velocity.x, heli.velocity.z) < 3, 'eases to a hover');
    assert.ok(Math.abs(heli.bodyRoll) < .02);
    // Backwards on the brake, but slowly
    fly(heli, 4, { brake: 1 });
    assert.ok(heli.speed < -8 && heli.speed > -12.5);
    // At the same rates whatever the frame rate
    const heights = [30, 60, 144].map(fps => { const h = helicopter(); fly(h, 3, { climb: 1, forward: 1 }, fps); const y = height(h); h.disposeModel(); return y; });
    assert.ok(Math.max(...heights) - Math.min(...heights) < .3, heights.join(', '));
  } finally { heli.disposeModel(); }
});

test('a pedal on the ground lifts it off, and it cannot climb out of sight', () => {
  const heli = helicopter();
  try {
    fly(heli, 2, { forward: 1 });
    assert.ok(height(heli) > .8 && height(heli) < 2.5, `a low hover: ${height(heli).toFixed(2)} m`);
    assert.ok(heli.speed > 10 && !heli.airborne, 'low enough to meet traffic and furniture');
    fly(heli, 30, { climb: 1 });
    assert.ok(height(heli) <= 120 + 1e-6 && height(heli) > 110, `ceiling ${height(heli).toFixed(1)} m`);
  } finally { heli.disposeModel(); }
});

test('over the water it only hovers, and it meets the quay from below as a wall', () => {
  const heli = helicopter({ s: 230, u: 0, heading: Math.PI });
  try {
    fly(heli, 6, { descend: 1 });
    assert.ok(Math.abs(heli.groundedPosition.y - (WATER + 1.2)) < 1e-6, 'held clear of the water');
    assert.ok(!heli.pilot.landed && heli.pilot.power > .9, 'never set down on it');
    // Flying at the land from down there: stopped at the quay's edge
    fly(heli, 6, { forward: 1 });
    assert.ok(heli.s > 200 && heli.s < 206, `stopped at ${heli.s.toFixed(1)}`);
    assert.ok(heli.groundedPosition.y < GROUND, 'not lifted onto it');
    // Above it, on it goes
    fly(heli, 2, { climb: 1 }); fly(heli, 3, { forward: 1 });
    assert.ok(heli.s < 195, 'over the quay');
  } finally { heli.disposeModel(); }
});

test('low over the river it goes under a bridge, and its piers are solid', () => {
  // A deck across the water from s = 240 to 260, and a pier under it at u = 12
  const deck = (s, u) => s > 240 && s < 260 && Math.abs(u) < 40;
  const river = {
    ...flat, grid: true,
    height: (s, u) => s > 200 && !deck(s, u) ? WATER : GROUND,
    water: (s, u) => s > 200 && !deck(s, u),
    under: (s, u) => deck(s, u) ? { lid: GROUND - 1.4, water: WATER } : null,
  };
  const pier = { corners: [{ x: 11, z: -245 }, { x: 13, z: -245 }, { x: 13, z: -255 }, { x: 11, z: -255 }], x: 12, z: -250, reach: 5.2, top: GROUND - 1.4 };
  // (and a railing along the deck's near edge, which it meets nose first)
  const railing = { x: 0, z: -240.3, heading: Math.PI / 2, halfWidth: .12, halfLength: 30, reach: 30 };
  const chunks = new Map([[0, { collisionBounds: { minX: -30, maxX: 30, minZ: -255, maxZ: -240 }, features: { colliders: [railing], piers: [pier] } }]]);
  const run = u => {
    const heli = new DrivingController(river, { s: 215, u, heading: 0 }, 'helicopter'), events = [];
    heli.freeDriving = true; heli.scenery = chunks;
    try {
      fly(heli, 4, { descend: 1 });
      for (let i = 0; i < 120 * 5; i++) { heli.update(1 / 120, { forward: 1 }); collideScenery(heli, chunks, 1 / 120); events.push(...heli.pilot.drain().map(event => event.text)); }
      return { s: heli.s, top: heli.groundedPosition.y + 3, events, hits: heli.audioTelemetry.impactSerial };
    } finally { heli.disposeModel(); }
  };
  const clear = run(0);
  assert.ok(clear.s > 270 && clear.events.includes('Under the bridge'), `through, to s ${clear.s.toFixed(0)}`);
  assert.equal(clear.hits, 0, 'the railing on the deck overhead is no wall');
  assert.ok(clear.top <= GROUND - 1.4 + 1e-6, 'its rotor under the deck');
  const pierHit = run(12);
  assert.ok(pierHit.s < 245 && pierHit.hits > 0, `stopped by the pier at s ${pierHit.s.toFixed(1)}`);
});

test('it sets down on a roof, bounces off walls below one and passes over them above', () => {
  const heli = helicopter({ s: 24, u: 0, heading: 0 }), chunks = new Map([[0, block(GROUND + 30)]]);
  heli.scenery = chunks;
  const step = (seconds, input) => { for (let i = 0; i < seconds * 120; i++) { heli.update(1 / 120, input); collideScenery(heli, chunks, 1 / 120); } };
  try {
    // Low, straight at the wall: stopped short of it, and the blow is felt
    step(1.5, { climb: 1 });
    const serial = heli.audioTelemetry.impactSerial;
    let shaken = 0, back = 0;
    for (let i = 0; i < 4 * 120; i++) {
      heli.update(1 / 120, { forward: 1 }); collideScenery(heli, chunks, 1 / 120);
      shaken = Math.max(shaken, heli.trauma); back = Math.max(back, heli.velocity.z);
    }
    assert.ok(-heli.groundedPosition.z < 50 - 7.3 / 2 + .1, `kept outside the wall at s ${heli.s.toFixed(1)}`);
    assert.ok(heli.audioTelemetry.impactSerial > serial && shaken > .3, 'a crash');
    assert.ok(back > 2, 'it bounced back off the wall');
    // Up over the roof and down onto it
    step(5, { climb: 1 }); step(1, { forward: 1 }); step(.8, { brake: 1 }); step(2, {});
    assert.ok(heli.s > 50 && heli.s < 70, `over the building at s ${heli.s.toFixed(1)}`);
    step(8, { descend: 1 });
    assert.equal(heli.groundedPosition.y, GROUND + 30); assert.ok(heli.pilot.landed && heli.airborne, 'landed on the roof, over the traffic');
    // A pitched roof is landed on at its ridge
    assert.equal(roofUnder(new Map([[0, block(GROUND + 30, -60, { ridge: GROUND + 34 })]]).values(), [{ x: 0, z: -60 }], Infinity), GROUND + 34);
    assert.equal(roofUnder(chunks.values(), [{ x: 0, z: -60 }], GROUND + 29), -Infinity, 'a roof above the reach is a wall, not a floor');
    assert.equal(roofUnder(chunks.values(), [{ x: 30, z: -60 }], Infinity), -Infinity);
  } finally { heli.disposeModel(); }
});

test('it clears street furniture once airborne, and hits it low', () => {
  const post = { x: 0, z: -40, reach: .3 }, chunks = new Map([[0, { collisionBounds: { minX: -1, maxX: 1, minZ: -41, maxZ: -39 }, features: { colliders: [post] } }]]);
  for (const [lift, hits] of [[0, true], [4, false]]) {
    const heli = helicopter({ s: 24, u: 0, heading: 0 });
    heli.scenery = chunks;
    try {
      heli.pilot.y = GROUND + lift; heli.update(0, {});
      let hit = false;
      // (the pedal lifts it off the ground to a low hover, still under the post's top)
      for (let i = 0; i < 120 * 2; i++) { heli.update(1 / 120, { forward: 1, descend: lift ? 0 : 1 }); collideScenery(heli, chunks, 1 / 120, () => { hit = true; return false; }); }
      assert.equal(heli.s > 45, !hits, `${lift} m up it ${hits ? 'hit' : 'passed'} the post`);
    } finally { heli.disposeModel(); }
  }
});

test('traffic neither stops for nor collides with it up in the air', () => {
  const heli = new DrivingController(citydriverRoute, journeyStart(), 'helicopter');
  const traffic = new CityTraffic(new THREE.Scene(), heli.route, heli.s, 'city', heli.u);
  try {
    heli.toggleFreeDriving();
    const car = traffic.vehicles.find(c => c.edge && c.edge.length - c.along > 40);
    for (const other of traffic.vehicles) if (other !== car) { other.edge = null; other.s = other.u = 1e6; other.position.set(1e6, 0, 1e6); }
    // Just ahead of the car, in its lane, facing across it
    const ahead = traffic.ahead(car, 12);
    heli.s = ahead.s; heli.u = ahead.u; heli.heading = car.heading + Math.PI / 2; heli.pilot.land(); heli.update(0, {});
    assert.ok(!heli.airborne && Number.isFinite(traffic.following(car, heli)), 'on the ground it is in the way');
    heli.pilot.y += 6; heli.update(0, {});
    assert.ok(heli.airborne && traffic.following(car, heli) === Infinity, 'up above, it is not');
    // Right on top of the car: nothing moves
    heli.s = car.s; heli.u = car.u; heli.update(0, {});
    const before = heli.groundedPosition.clone();
    traffic.collidePlayer(car, heli);
    assert.ok(heli.groundedPosition.equals(before));
  } finally { traffic.dispose(); heli.disposeModel(); }
});

test('changing machine: a car takes off where it stood, and a car set down from the air lands in a lane', () => {
  const car = new DrivingController(flat, { s: 40, u: 2.4, heading: 0 }, 'taxi');
  try {
    car.speed = 10; car.update(0, {});
    car.setCar('helicopter');
    assert.ok(car.pilot && car.s === 40 && car.groundedPosition.y === GROUND);
    assert.ok(Math.abs(car.velocity.z + 10) < 1e-9, 'carrying on as the car was going');
    car.update(1 / 120, { climb: 1 });
    assert.ok(Number.isFinite(car.groundedPosition.y) && car.pilot.vy > 0, 'and can climb at once');
    fly(car, 3, { climb: 1, right: 1 });
    car.u = 30; car.setCar('sedan');
    assert.ok(!car.pilot && !car.airborne);
    assert.equal(car.speed, 0); assert.equal(car.u, 2.4, 'in the lane'); assert.equal(car.groundedPosition.y, GROUND);
    // and it drives as a car again
    for (let i = 0; i < 120; i++) car.update(1 / 120, { forward: 1 });
    assert.ok(car.speed > 5);
    // A reset sets the helicopter down on the road
    car.setCar('helicopter'); fly(car, 3, { climb: 1 }); car.reset();
    assert.ok(car.pilot.landed && car.groundedPosition.y === GROUND && car.u === 2.4);
  } finally { car.disposeModel(); }
});

test('a blow from traffic or furniture shoves it, and the camera looks down from high up', () => {
  const heli = helicopter();
  try {
    fly(heli, 2, { climb: 1 });
    heli.strike(3, 0, .5, 3);
    assert.ok(heli.velocity.x > 2.9 && heli.trauma > 0 && heli.audioTelemetry.impact === 3);
    fly(heli, 3);
    assert.ok(Math.hypot(heli.velocity.x, heli.velocity.z) < 1, 'and the push fades');
    // The chase camera: from high up it looks down on the streets
    const aim = dip => {
      const rig = new ThirdPersonCamera(); rig.resize(16 / 9);
      heli.car.userData.chaseDip = dip; rig.update(heli.car, 0);
      return rig.camera.getWorldDirection(new THREE.Vector3()).y;
    };
    assert.ok(aim(1) < aim(0) - .2, 'looking further down');
    heli.car.userData.chaseDip = undefined;
    assert.equal(aim(undefined), aim(0), 'a car, which says nothing, is framed as before');
  } finally { heli.disposeModel(); }
});

test('controllers and headsets climb and descend without touching the car controls', () => {
  const pad = (axes, pressed = []) => ({ connected: true, index: 0, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
  let device = pad([0, 0, 0, 0]);
  const input = new GamepadInput(() => {}, () => {}, () => [device]);
  input.update(); input.update();
  device = pad([0, 0, 0, -1]); input.update();
  assert.equal(input.state.climb, 1); assert.equal(input.state.descend, 0);
  device = pad([0, 0, 0, .8]); input.update();
  assert.ok(input.state.descend > .7 && input.state.climb === 0);
  device = pad([0, 0, 0, 0], [5]); input.update();
  assert.equal(input.state.climb, 1); assert.equal(input.state.boost, 1, 'RB still boosts a car');
  device = pad([0, 0, 0, 0], [4]); input.update();
  assert.equal(input.state.descend, 1); assert.equal(input.state.handbrake, 1, 'LB still drifts a car');

  // (the same controllers throughout: a new one must be let go of first)
  const controller = handedness => ({ handedness, gamepad: { mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: [{ value: 0 }, { value: 0 }, {}, {}, {}, {}] } });
  const left = controller('left'), right = controller('right'), xr = new XRInput(() => {});
  xr.update([left, right]); xr.update([left, right]);
  right.gamepad.axes[3] = -1; xr.update([left, right]);
  assert.equal(xr.state.climb, 1, 'right stick up');
  right.gamepad.axes[3] = 0; left.gamepad.buttons[1].value = 1; xr.update([left, right]);
  assert.equal(xr.state.descend, 1, 'left grip'); assert.equal(xr.state.handbrake, true, 'which still drifts a car');
  // With only the right controller, its stick steers, so it does not also climb
  const only = controller('right'), alone = new XRInput(() => {});
  alone.update([only]); alone.update([only]);
  only.gamepad.axes[2] = .9; only.gamepad.axes[3] = -1; alone.update([only]);
  assert.ok(alone.state.right > .8 && alone.state.climb === 0);
});

test('its sound is a turbine spooling with the rotor under the blades beat, with no gears or tyres', () => {
  const profile = engineFor('helicopter'), model = new DriveSoundModel();
  model.setProfile(profile, 36);
  assert.ok(profile.rotor > 10);
  let state = model.update({ rotor: .3, speed: 0 }, .1);
  for (let i = 0; i < 30; i++) state = model.update({ rotor: .3, speed: 0 }, .1);
  const idle = state.rpm, idleChop = state.chop;
  for (let i = 0; i < 30; i++) state = model.update({ rotor: 1, throttle: 1, speed: 40 }, .1);
  assert.ok(state.rpm > idle + 1000 && state.chop > idleChop, 'spooled up, higher and faster');
  assert.equal(state.shiftSerial, 0, 'never shifts');
  assert.equal(state.roadLevel, 0); assert.ok(state.roughLevel > .3 && state.windLevel > .05);
  for (const id of CAR_IDS) assert.ok(!engineFor(id).rotor, `${id} keeps its engine`);
});

test('like the truck, it smashes through street trees, up in the crown too, and flies over them above', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene), start = journeyStart();
  world.update(start.s, start.u); while (world.pending.length) world.update(start.s, start.u);
  const props = new LooseProps(scene, world.materials.props), colliders = [...world.chunks.values()].flatMap(c => c.features.colliders);
  // A street tree with nothing else within 4 m of a run from 26 m before it to 18 m past it
  const clear = (tree, heading) => colliders.every(o => {
    if (o === tree) return true;
    const px = o.x - tree.x, pz = o.z - tree.z, dx = -Math.sin(heading), dz = Math.cos(heading), t = px * dx + pz * dz;
    return t + o.reach < -18 || t - o.reach > 26 || Math.abs(px * dz - pz * dx) > 4 + o.reach;
  });
  let tree = null, heading = 0;
  for (const c of colliders) {
    if (tree || !c.prop?.ready || c.prop.pieces[0].kind !== 'tree') continue;
    for (let k = 0; k < 8 && !tree; k++) if (clear(c, k * Math.PI / 4)) { tree = c; heading = k * Math.PI / 4; }
  }
  assert.ok(tree, 'a clear street tree');
  const top = propTop(tree) - GROUND;
  assert.ok(top > 5 && top < 12, `the tree stands ${top.toFixed(1)} m`);
  try {
    for (const [lift, breaks] of [[1.5, true], [top - 2, true], [top + 3, false]]) {
      const heli = new DrivingController(citydriverRoute, {}, 'helicopter');
      heli.toggleFreeDriving(); heli.scenery = world.chunks;
      heli.heading = heading; heli.u = tree.x - Math.sin(heading) * 20; heli.s = -(tree.z + Math.cos(heading) * 20);
      heli.pilot.land(); heli.update(0, {}); heli.pilot.takeOver(heading, 20, heli.pilot.y + lift); heli.update(0, {});
      let before = 20, after = null;
      for (let i = 0; i < 120 * 2; i++) {
        heli.update(1 / 120, { forward: 1 });
        collideScenery(heli, world.chunks, 1 / 120, (collider, contact) => collider.prop ? props.hit(collider, contact, heli) : false);
        props.update(1 / 120, heli, null, world.chunks);
        const speed = Math.hypot(heli.velocity.x, heli.velocity.z);
        if (!tree.woken) before = speed; else if (after === null) after = i + 30; else if (i === after) after = -speed;
      }
      assert.equal(tree.woken, breaks, `${lift.toFixed(1)} m up it ${breaks ? 'broke' : 'cleared'} the tree`);
      // (a crown met square on is carried a moment before it falls away)
      if (breaks) assert.ok(-after > before * .75, `kept ${(-after).toFixed(1)} of ${before.toFixed(1)} m/s`);
      if (tree.woken) props.restore(tree);
      heli.disposeModel();
    }
  } finally { props.dispose(); world.dispose(); }
});
