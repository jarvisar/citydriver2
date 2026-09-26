import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { citydriverRoute, journeyStart, roadAt, surfaceAt, ROAD_LEVEL, PAVEMENT_LEVEL } from '../src/world/city-route.js';
import { DrivingController } from '../src/vehicle.js';
import { collideScenery } from '../src/collision.js';
import { LooseProps } from '../src/loose-props.js';

// One city for every test here, built round the start
let city = null;
function world() {
  if (city) return city;
  const scene = new THREE.Scene(), built = new CitydriverWorld(scene), start = journeyStart();
  built.update(start.s, start.u); while (built.pending.length) built.update(start.s, start.u);
  city = { scene, world: built, start };
  return city;
}
test.after(() => city?.world.dispose());
const colliders = () => [...world().world.chunks.values()].flatMap(chunk => chunk.features.colliders);
const nearest = (kind, test = () => true) => colliders().filter(c => c.prop?.ready && !c.woken && c.prop.pieces[0].kind === kind && test(c))
  .sort((a, b) => Math.hypot(a.x - world().start.u, -a.z - world().start.s) - Math.hypot(b.x - world().start.u, -b.z - world().start.s))[0];
// Every point of a loose piece above the ground under it
function aboveGround(body) {
  const points = body.shape.points, p = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 3) {
    p.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(body.q).add(body.p);
    const surface = surfaceAt(-p.z, p.x);
    if (surface !== 'water' && p.y < (surface === 'pavement' ? PAVEMENT_LEVEL : ROAD_LEVEL) - .05) return false;
  }
  return true;
}
// A car driven along the nearest road into `target`, its side over it by .6 m,
// for `seconds` (braking half a second after it, with `brake`): its speed just
// before the knock and just after, and the loose pieces
function drive(target, id = 'taxi', speed = 20, seconds = 4, brake = false) {
  const { scene, world: built } = world(), props = new LooseProps(scene, built.materials.props), car = new DrivingController(citydriverRoute, journeyStart(), id);
  car.toggleFreeDriving();
  const road = roadAt(-target.z, target.x, 40), heading = Math.atan2(road.tx, road.ty);
  let du = road.x - target.x, ds = road.y + target.z;
  const l = Math.hypot(du, ds) || 1, lateral = car.spec.width / 2 - .6, back = 6 + car.spec.length / 2;
  du /= l; ds /= l;
  car.u = target.x + du * lateral - Math.sin(heading) * back; car.s = -target.z + ds * lateral - Math.cos(heading) * back;
  car.heading = car.slideHeading = heading; car.speed = speed; car.update(0, {});
  const result = { props, car, before: null, after: null };
  for (let i = 0, knocked = null; i < seconds * 120; i++) {
    const was = car.speed;
    car.update(1 / 120, { brake: brake && knocked !== null && i > knocked + 60 });
    collideScenery(car, built.chunks, 1 / 120, (c, contact) => c.prop ? props.hit(c, contact, car) : false);
    props.update(1 / 120, car, null, built.chunks);
    if (target.woken && knocked === null) { knocked = i; result.before = was; }
    if (i === knocked + 4) result.after = car.speed;
  }
  return result;
}
const tilt = body => Math.acos(new THREE.Vector3(0, 1, 0).applyQuaternion(body.q).y) * 180 / Math.PI;

test('a lamp post hit at speed snaps and falls over, dark, and the car carries on with a bite taken out of its speed', () => {
  const lamp = nearest('lamp');
  assert.ok(lamp, 'a lamp post near the start');
  const light = [...world().world.chunks.values()].flatMap(chunk => chunk.features.lamps).find(l => lamp.prop.items.includes(l.item));
  const { props, car, before, after } = drive(lamp);
  try {
    assert.ok(lamp.woken && lamp.prop.bodies.length === 1, 'knocked loose');
    const [post] = lamp.prop.bodies;
    assert.ok(tilt(post) > 70, `lying down (${tilt(post).toFixed(0)}°)`);
    assert.ok(post.asleep && aboveGround(post), 'and still, on the ground');
    assert.ok(Math.hypot(post.p.x - lamp.x, post.p.z - lamp.z) < 12, 'where it stood, not flung down the street');
    const lost = (before - after) / before;
    assert.ok(lost > .05 && lost < .3, `the car lost ${(lost * 100).toFixed(0)}% of its speed`);
    assert.ok(light?.item.render.hidden, 'and its light is out');
    assert.ok(props.sounds.length === 0 || props.sounds.every(s => ['metal'].includes(s.kind)));
    assert.ok(car.trauma < .3, 'a post is no wall: the camera barely shakes');
  } finally { props.reset(); props.dispose(); car.disposeModel(); }
});

test('a post stands firm against a slow nudge, as a wall would', () => {
  const lamp = nearest('lamp');
  const { props, car } = drive(lamp, 'taxi', 3, 2);
  try {
    assert.ok(!lamp.woken, 'still standing');
    assert.equal(props.bodies.length, 0);
    assert.ok(car.speed < 1, 'and the car stopped against it');
  } finally { props.reset(); props.dispose(); car.disposeModel(); }
});

test('weight decides what a post costs: the light racer loses most, the truck hardly anything', () => {
  const lost = id => {
    const lamp = nearest('lamp'), { props, car, before, after } = drive(lamp, id, 20, .5);
    try { return (before - after) / before; } finally { props.reset(); props.dispose(); car.disposeModel(); }
  };
  const taxi = lost('taxi'), racer = lost('taxiFormula'), truck = lost('rig');
  assert.ok(racer > taxi && taxi > truck && truck < .05, JSON.stringify({ racer, taxi, truck }));
});

test('a bin is knocked flying with hardly a check to the car, and comes to rest on the ground', () => {
  const bin = nearest('bin');
  assert.ok(bin, 'a bin near the start');
  const { props, car, before, after } = drive(bin, 'taxi', 18, 5, true);
  try {
    const [body] = bin.prop.bodies;
    assert.ok((before - after) / before < .03, `the car lost ${before - after} m/s`);
    assert.ok(Math.hypot(body.p.x - bin.x, body.p.z - bin.z) > 5, 'thrown clear');
    assert.ok(body.asleep && aboveGround(body), `and settled on the ground: ${body.asleep ? 'asleep' : 'awake'} ${body.v.length().toFixed(2)} m/s ${body.w.length().toFixed(2)} rad/s ${aboveGround(body) ? 'above' : 'below'} ground`);
    assert.ok(props.bodies.every(b => [b.p.x, b.p.y, b.p.z, b.q.w].every(Number.isFinite)));
  } finally { props.reset(); props.dispose(); car.disposeModel(); }
});

test('loose pieces go back where they stood once the player has driven well away', () => {
  const lamp = nearest('lamp'), bin = nearest('bin'), { props, car } = drive(lamp, 'taxi', 20, 1);
  try {
    const { props: others, car: other } = drive(bin, 'taxi', 18, 1);
    for (const [set, driver, piece] of [[props, car, lamp], [others, other, bin]]) {
      assert.ok(piece.woken && piece.prop.items.every(item => item.render.hidden), 'loose, its standing model hidden');
      driver.s += 400; driver.update(0, {});
      set.update(1 / 120, driver, null, world().world.chunks);
      assert.equal(set.loose.length, 0);
      assert.ok(!piece.woken && piece.prop.items.every(item => !item.render.hidden), 'standing again');
    }
    other.disposeModel(); others.dispose();
  } finally { props.reset(); props.dispose(); car.disposeModel(); }
});

test('trees and buildings stand firm; lamps, signals, signs, bins and benches can be knocked loose', () => {
  const all = colliders(), loose = all.filter(c => c.prop);
  const kinds = new Set(loose.map(c => c.prop.pieces[0].kind));
  for (const kind of ['lamp', 'lantern', 'sign', 'bin', 'bench']) assert.ok(kinds.has(kind), `${kind} can be knocked loose`);
  for (const kind of kinds) assert.ok(['lamp', 'lantern', 'signal', 'mast', 'sign', 'bin', 'bench', 'table', 'stall'].includes(kind), `nothing else: ${kind}`);
  let trees = 0;
  for (const chunk of world().world.chunks.values()) for (const tree of chunk.features.trees ?? []) {
    const at = { x: chunk.east + tree.x, z: -(chunk.start + tree.s) }, post = all.find(c => c.reach === .28 && Math.hypot(c.x - at.x, c.z - at.z) < .01);
    if (post) { trees++; assert.equal(post.prop, undefined, 'a tree stands firm'); }
  }
  assert.ok(trees > 50, `${trees} trees checked`);
  assert.ok(all.some(c => c.corners && !c.prop), 'buildings stand firm');
});

test('a cafe table and its four chairs come loose as five pieces, and settle apart', () => {
  const { scene, world: built } = world();
  const piece = [...built.furnitureByChunk.values()].flat().filter(p => p.kind === 'cafe')
    .sort((a, b) => Math.hypot(a.u - world().start.u, a.s - world().start.s) - Math.hypot(b.u - world().start.u, b.s - world().start.s))[0];
  assert.ok(piece, 'a cafe in the city');
  built.update(piece.s, piece.u); while (built.pending.length) built.update(piece.s, piece.u);
  const cafe = [...built.chunks.values()].flatMap(chunk => chunk.features.colliders).find(c => c.prop?.pieces.length === 5 && Math.hypot(c.x - piece.u, c.z + piece.s) < .1);
  assert.ok(cafe?.prop.ready, 'its collider knows its pieces');
  const props = new LooseProps(scene, built.materials.props), player = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  try {
    player.toggleFreeDriving(); player.s = piece.s + 60; player.u = piece.u; player.update(0, {});
    const car = { x: cafe.x - 3, z: cafe.z, y: PAVEMENT_LEVEL, height: 1.5, heading: Math.PI / 2, halfWidth: .9, halfLength: 2.3, vx: 16, vz: 0, spin: 0, mass: 2.2 };
    const blow = props.knock(cafe, { x: -1, z: 0, depth: .05, point: { x: cafe.x - 1.2, z: cafe.z } }, car);
    assert.ok(blow && blow.x < 0, 'the car takes a little of the blow');
    assert.equal(cafe.prop.bodies.length, 5);
    assert.deepEqual(cafe.prop.bodies.map(b => b.piece.kind).sort(), ['chair', 'chair', 'chair', 'chair', 'table']);
    for (let i = 0; i < 120 * 5; i++) props.update(1 / 120, player, null, built.chunks);
    assert.deepEqual(cafe.prop.bodies.filter(b => !b.asleep).map(b => `${b.piece.kind} ${b.v.length().toFixed(2)} ${b.w.length().toFixed(2)} ${b.grounded}`), [], 'all settled');
    assert.ok(cafe.prop.bodies.every(aboveGround), 'on the ground');
    assert.ok(cafe.prop.bodies.some(b => b.v.lengthSq() === 0 && Math.hypot(b.p.x - cafe.x, b.p.z - cafe.z) > 3), 'the one it met was thrown clear');
  } finally { props.reset(); props.dispose(); player.disposeModel(); }
});
