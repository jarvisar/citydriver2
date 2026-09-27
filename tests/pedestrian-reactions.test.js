import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PedestrianContacts, PEDESTRIAN_EASE as EASE, PEDESTRIAN_LIE, PEDESTRIAN_RISE, PEDESTRIAN_MEET, PEDESTRIAN_REJOIN_AHEAD,
  walkedAt, paceAt, setStride, standing, hurrying, nearestOnLoop, rejoinWalk, stopWalkers, regroupWalkers, lookYaw,
  applyHop, PEDESTRIAN_HOP as HOP, PEDESTRIAN_HOP_HEIGHT as HOP_HEIGHT, PEDESTRIAN_PIVOT as PIVOT } from '../src/world/pedestrian-reactions.js';
import { TaxiView } from '../src/taxi-view.js';
import { LooseProps } from '../src/loose-props.js';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { journeyStart, roadAt, ROAD_LEVEL } from '../src/world/city-route.js';

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≈ ${b}`);
const car = (x = 0, z = 0, heading = 0) => ({ groundedPosition: new THREE.Vector3(x, 24.2, z),
  spec: { width: 2, length: 4 }, heading, speed: 12 });
// A car that drives itself straight on and takes the blows it is given
const driven = (x, z, heading, speed) => ({
  groundedPosition: new THREE.Vector3(x, ROAD_LEVEL, z), heading, speed, spec: { width: 2, length: 4.4, mass: 1.4 },
  motion() { return { x: this.groundedPosition.x, z: this.groundedPosition.z, heading: this.heading, halfWidth: 1, halfLength: 2.2, mass: 1.6, vx: Math.sin(this.heading) * this.speed, vz: -Math.cos(this.heading) * this.speed, spin: 0 }; },
  strike(x, z) { this.speed += x * Math.sin(this.heading) - z * Math.cos(this.heading); },
  drive(dt) { this.groundedPosition.x += Math.sin(this.heading) * this.speed * dt; this.groundedPosition.z -= Math.cos(this.heading) * this.speed * dt; },
});

test('swept contacts catch fast cars, respect heading and height, and ignore stopped cars and teleports', () => {
  const contacts = new PedestrianContacts(), vehicle = car(0, 5);
  vehicle.speed = 100;
  contacts.update(vehicle, null, 0); vehicle.groundedPosition.z = -5; contacts.update(vehicle, null, .1);
  assert.ok(contacts.hit({}, 0, 24.4, 0, .28), 'crossed entirely between rendered frames');
  assert.equal(contacts.hit({}, 2, 24.4, 0, .28), null, 'beside the footprint');
  assert.equal(contacts.hit({}, 0, 30, 0, .28), null, 'different elevation');
  vehicle.groundedPosition.z = 0; vehicle.heading = Math.PI / 2; contacts.update(vehicle, null, 1);
  assert.equal(contacts.hit({}, 1.9, 24.4, 0, .28)?.car, vehicle);
  assert.equal(contacts.hit({}, 0, 24.4, 1.9, .28), null);
  vehicle.speed = 0; contacts.update(vehicle, null, 2);
  assert.equal(contacts.hit({}, 0, 24.4, 0, .28), null);
  vehicle.speed = 12; vehicle.groundedPosition.x = 1000; contacts.update(vehicle, null, 2.016);
  assert.equal(contacts.hit({}, 500, 24.4, 0, .28), null);
});

test('traffic and loose parked cars meet a person once per touch', () => {
  const contacts = new PedestrianContacts(), vehicle = car(100, 100), trafficCar = car(), walker = {};
  const traffic = { enabled: true, vehicles: [trafficCar], woken: [] };
  contacts.update(vehicle, traffic, 0);
  assert.equal(contacts.hit(walker, 0, 24.4, 0, .28)?.car, trafficCar);
  for (const time of [.1, .5, 1, 2]) {
    contacts.update(vehicle, traffic, time);
    assert.equal(contacts.hit(walker, 0, 24.4, 0, .28), null);
  }
  traffic.enabled = false; contacts.update(vehicle, traffic, 3);
  assert.equal(contacts.hit(walker, 0, 24.4, 0, .28), null);
  traffic.enabled = true; contacts.update(vehicle, traffic, 4);
  assert.equal(contacts.hit(walker, 0, 24.4, 0, .28)?.car, trafficCar);
  // A parked car knocked loose has no speed of its own, only its slide
  const parked = { ...car(0, 20), position: new THREE.Vector3(0, 24.2, 20), speed: 0, parked: {}, loose: { vx: 4, vz: 0 } };
  delete parked.groundedPosition; traffic.woken.push(parked); contacts.update(vehicle, traffic, 5);
  assert.equal(contacts.hit({}, 0, 24.4, 20, .28)?.car, parked);
});

// A 40 x 20 m block walked anticlockwise from its south-west corner
const square = (() => {
  const points = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }], cumulative = [0, 40, 60, 100, 120];
  return { points, cumulative, perimeter: 120 };
})();
const resident = (extra = {}) => ({ loop: square, phase: 10, speed: 1.4, direction: 1, ...extra });
// Where round the block a resident is, 0-120 m
const onLoop = (walker, time) => (((walker.phase + walkedAt(walker, time) * walker.direction) % 120) + 120) % 120;

test('a stride eases into each stop, hurry and walk on, worked out from the time alone', () => {
  const walker = resident();
  close(walkedAt(walker, 10), 14); close(paceAt(walker, 10), 1.4);
  // Stopping, they slow over EASE and come to rest half of that on
  setStride(walker, 10, 0);
  close(walkedAt(walker, 10), 14); close(paceAt(walker, 10 + EASE / 2), .7);
  close(walkedAt(walker, 1000), 14 + 1.4 * EASE / 2);
  assert.ok(standing(walker, 500) && !hurrying(walker, 500));
  setStride(walker, 20, 3, 22);
  assert.ok(hurrying(walker, 21) && !standing(walker, 21));
  close(paceAt(walker, 20), 0); close(paceAt(walker, 21), 3);
  close(walkedAt(walker, 22) - walkedAt(walker, 20), 3 * 2 - 3 * EASE / 2);
  // then back to their own pace, with no jump or jolt where the stride ends
  close(paceAt(walker, 22 + EASE / 2), (3 + 1.4) / 2);
  close(walkedAt(walker, 25) - walkedAt(walker, 22 + EASE), 1.4 * (3 - EASE), 1e-9);
  for (const t of [20 + EASE, 22, 22 + EASE]) {
    close(walkedAt(walker, t + 1e-6), walkedAt(walker, t - 1e-6), 1e-5);
    close(paceAt(walker, t + 1e-6), paceAt(walker, t - 1e-6), 1e-4);
  }
  assert.ok(!hurrying(walker, 23) && !standing(walker, 23));
});
test('a resident back on their feet rejoins their walk from where they landed, a step on', () => {
  for (const direction of [1, -1]) {
    const walker = resident({ direction, phase: 25 });
    stopWalkers(walker, null, 5);
    const knocked = onLoop(walker, 5);
    // Thrown 6 m on along the south side and 3 m off it, into the road
    const landed = knocked + 6 * direction;
    rejoinWalk(walker, landed, -3, 7);
    close(onLoop(walker, 7), landed + PEDESTRIAN_REJOIN_AHEAD * direction, 1e-6);
    assert.ok(standing(walker, 9), 'waits there until they are back on it');
    // across the seam where the loop starts again
    rejoinWalk(walker, 1, 25, 8);
    close(onLoop(walker, 8), (((80 + 19 + PEDESTRIAN_REJOIN_AHEAD * direction) % 120) + 120) % 120, 1e-6);
  }
  close(nearestOnLoop(square, 43, 10), 50); close(nearestOnLoop(square, -2, 5), 115);
});

test('a pair knocked apart waits, hurries and meets up, then walks on side by side', () => {
  for (const [direction, gap, arrival] of [[1, 6, 0], [-1, 6, 1.6], [1, 30, 2.2], [-1, -30, 0], [1, -55, 1.6], [1, .4, 1.6], [1, -.3, 0], [1, -.3, 2.2], [-1, -1, 2.4]]) {
    const a = resident({ direction, phase: 30 }), b = resident({ direction, phase: 30 });
    // `a` is knocked over; `b` slows to a stop at once, and waits while `a` is down
    a.away = true; stopWalkers(a, b, 4);
    assert.ok(standing(b, 20));
    // (rejoining their walk `gap` metres on from where the other waits, arriving at `arrival` m/s)
    setStride(a, 6, 0, Infinity, walkedAt(b, 6) + gap, 0);
    a.away = false; regroupWalkers(a, b, 10, arrival);
    close(paceAt(a, 10), arrival);
    const apart = ((gap % 120) + 180) % 120 - 60;
    const [ahead, behind] = apart > 0 ? [a, b] : [b, a];
    if (Math.abs(apart) > 2) assert.ok(hurrying(behind, 10.1), `${gap}: the one behind hurries`);
    if (Math.abs(apart) > PEDESTRIAN_MEET) assert.ok(ahead.stride.rate < 0, `${gap}: far apart, the other comes back to meet them`);
    else assert.ok(ahead.stride.rate >= 0 && behind.stride.rate >= 0, `${gap}: close by, nobody turns back`);
    if (Math.abs(apart) > 2 && Math.abs(apart) <= PEDESTRIAN_MEET) assert.equal(ahead.stride.rate, 0, `${gap}: the other waits`);
    const meet = ahead.stride.until;
    assert.ok(meet >= 10 + EASE - 1e-9 && meet < 10 + Math.abs(apart) / 2.4 + EASE, `${gap}: meet at ${meet}`);
    // Together once both are back to their pace, and at one pace after
    for (const time of [meet + EASE, meet + 1, meet + 30]) close(onLoop(a, time), onLoop(b, time), 1e-6);
    close(walkedAt(a, meet + 10) - walkedAt(a, meet + EASE), 1.4 * (10 - EASE), 1e-6);
  }
  // Back first, one waits for the other to get up
  const a = resident(), b = resident({ away: true });
  regroupWalkers(a, b, 3);
  assert.ok(standing(a, 100));
  // and alone, a resident walks straight on from the pace they arrived at
  const solo = resident();
  regroupWalkers(solo, null, 3, 1.8);
  close(paceAt(solo, 3), 1.8); close(paceAt(solo, 3 + EASE), 1.4);
  assert.ok(!standing(solo, 3.01));
});

test('turning to look is a spring: it starts gently and settles without snapping', () => {
  const person = {}, dt = 1 / 60;
  lookYaw(person, 0, null, 0);
  let yaw = 0, fastest = 0, last = 0;
  for (let t = dt; t < 3; t += dt) {
    yaw = lookYaw(person, 0, Math.PI * .9, t);
    fastest = Math.max(fastest, Math.abs(yaw - last) / dt); last = yaw;
    if (t < dt * 1.5) assert.ok(Math.abs(yaw) < .02, 'no sudden start');
  }
  close(yaw, Math.PI * .9, .01);
  assert.ok(fastest < 6, `at most ${fastest.toFixed(1)} rad/s`);
  // and back to facing on
  for (let t = 3; t < 6; t += dt) yaw = lookYaw(person, 1, null, t);
  close(yaw, 1, .01);
});
// Drive `vehicle` at a person standing at `home` (in `frame`) and follow them
// until they are back: what they did, frame by frame
function knockOver(vehicle, home, frame = new THREE.Matrix4(), seconds = 30) {
  const props = new LooseProps(new THREE.Scene(), new THREE.MeshBasicMaterial()), contacts = new PedestrianContacts();
  const person = {}, matrix = new THREE.Matrix4(), frames = [], dt = 1 / 120;
  for (let i = 0; i < seconds / dt; i++) {
    const time = i * dt;
    vehicle.drive(dt); props.update(dt, vehicle); props.render(1, 0);
    contacts.update(vehicle, null, time, props);
    const away = contacts.person(person, matrix.copy(home), frame, .3, time);
    const state = person.body ? (person.body.asleep ? 'lying' : 'flying') : person.rise ? 'rising' : person.back ? 'back' : 'home';
    frames.push({ time, away, state, matrix: matrix.clone(), world: new THREE.Matrix4().multiplyMatrices(frame, matrix), body: person.body });
    if (frames.some(f => f.state === 'flying') && state === 'home') break;
  }
  return { frames, props };
}

test('a person a car meets is thrown, lies still, gets up and walks back to carry on, unharmed', () => {
  const start = journeyStart(), road = roadAt(start.s, start.u, 40), heading = Math.atan2(road.tx, road.ty);
  const x = road.x + road.tx * 20, z = -(road.y + road.ty * 20);
  const home = new THREE.Matrix4().compose(new THREE.Vector3(x, ROAD_LEVEL, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading + Math.PI / 2), new THREE.Vector3(1, 1.05, 1));
  for (const speed of [5, 15, 30]) {
    const vehicle = driven(road.x, -road.y, heading, speed), { frames, props } = knockOver(vehicle, home);
    const order = frames.map(f => f.state).filter((s, i, all) => s !== all[i - 1]);
    // (a person may land, be shoved on by the car and lie down again)
    assert.deepEqual(order.filter((s, i, all) => !(s === 'flying' && all[i - 1] === 'lying') && !(s === 'lying' && all[i - 1] === 'flying' && all.slice(0, i - 1).includes('lying'))),
      ['home', 'flying', 'lying', 'rising', 'back', 'home'], `${speed} m/s: ${order}`);
    const thrown = frames.find(f => f.state === 'rising'), p = new THREE.Vector3().setFromMatrixPosition(thrown.world);
    assert.ok(Math.hypot(p.x - x, p.z - z) > 1, `${speed} m/s: thrown ${Math.hypot(p.x - x, p.z - z).toFixed(1)} m`);
    assert.ok(Math.hypot(p.x - x, p.z - z) < 60, `${speed} m/s: not across town`);
    assert.ok(vehicle.speed < speed && vehicle.speed > speed * .8, `${speed} m/s: the car loses a little speed (${vehicle.speed.toFixed(2)})`);
    // They lie still a moment before getting up, and take a moment to
    const lying = frames.findLast(f => f.state === 'lying'), rising = frames.filter(f => f.state === 'rising');
    assert.ok(lying.body.slept >= PEDESTRIAN_LIE - .02);
    close(rising.at(-1).time - rising[0].time, PEDESTRIAN_RISE, .02);
    // then stand upright, feet on the ground, and walk back without a jump
    const up = new THREE.Vector3();
    for (const f of frames.filter(f => f.state === 'back')) {
      assert.ok(up.setFromMatrixColumn(f.world, 1).normalize().y > .985, 'upright, or leaning a little into a hurry');
      assert.ok(Math.abs(new THREE.Vector3().setFromMatrixPosition(f.world).y - ROAD_LEVEL) < .2, 'on the ground');
    }
    // (a car catching a thrown person puts them straight out of its way, a
    // step as big as its speed: only getting up and walking back are checked)
    for (let i = 1; i < frames.length; i++) {
      if (['flying', 'lying'].includes(frames[i].state) || frames[i - 1].state === 'flying') continue;
      const a = new THREE.Vector3().setFromMatrixPosition(frames[i - 1].world), b = new THREE.Vector3().setFromMatrixPosition(frames[i].world);
      assert.ok(a.distanceTo(b) < .5, `${speed} m/s: no jump at ${frames[i].time.toFixed(2)} s (${frames[i - 1].state} -> ${frames[i].state})`);
    }
    // Back where they were, exactly as they would have been, and nothing left lying
    const last = frames.at(-1);
    assert.equal(last.away, false);
    last.matrix.elements.forEach((n, k) => close(n, home.elements[k]));
    assert.equal(props.people.length, 0); assert.equal(props.bodies.length, 0);
  }
});

test('a person nobody draws is put away, and comes back home when next drawn', () => {
  const props = new LooseProps(new THREE.Scene(), new THREE.MeshBasicMaterial()), contacts = new PedestrianContacts();
  const start = journeyStart(), road = roadAt(start.s, start.u, 40), heading = Math.atan2(road.tx, road.ty);
  const vehicle = driven(road.x, -road.y, heading, 12), person = {}, frame = new THREE.Matrix4();
  const home = new THREE.Matrix4().makeTranslation(road.x + road.tx * 3, ROAD_LEVEL, -(road.y + road.ty * 3)), matrix = new THREE.Matrix4();
  let time = 0;
  for (; !person.body && time < 2; time += 1 / 60) { vehicle.drive(1 / 60); contacts.update(vehicle, null, time, props); contacts.person(person, matrix.copy(home), frame, .3, time); }
  assert.ok(person.body, 'knocked flying');
  for (let i = 0; i < 60 * 5; i++) props.update(1 / 60, vehicle);
  assert.equal(props.people.length, 0);
  assert.equal(contacts.person(person, matrix.copy(home), frame, .3, time + 5), false);
  assert.equal(person.body, null);
});

test('a hop leaps one cartwheel about their middle and lands exactly where it started', () => {
  const original = new THREE.Matrix4().compose(new THREE.Vector3(12, 24.4, -30),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, .7, .03)), new THREE.Vector3(1.25, 1.3, 1.25));
  const centre = new THREE.Vector3(0, PIVOT, 0).applyMatrix4(original), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), at = new THREE.Vector3();
  original.decompose(at, rotation, scale);
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation), y = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
  for (const spin of [1, -1]) {
    let peak = 0, turned = 0, last = 0, lowest = Infinity;
    for (let i = 0; i <= 120; i++) {
      const person = { hopStart: 10, hopSpin: spin }, matrix = original.clone(), t = i / 120 * HOP;
      const hopping = applyHop(person, matrix, 10 + t);
      const middle = new THREE.Vector3(0, PIVOT, 0).applyMatrix4(matrix), up = new THREE.Vector3().setFromMatrixColumn(matrix, 1).normalize();
      // (it stays over the same spot, rising and falling, and turns one way only)
      if (i < 120) assert.ok(hopping);
      close(middle.x, centre.x, .15); close(middle.z, centre.z, .15);
      peak = Math.max(peak, middle.y - centre.y); lowest = Math.min(lowest, new THREE.Vector3().setFromMatrixPosition(matrix).y);
      let angle = Math.atan2(-up.dot(x), up.dot(y)) * spin;
      while (angle < last - Math.PI) angle += Math.PI * 2;
      assert.ok(angle >= last - 1e-6, `turns one way (${angle.toFixed(3)} after ${last.toFixed(3)})`); last = angle; turned = Math.max(turned, angle);
    }
    close(peak, HOP_HEIGHT, .15);
    assert.ok(turned > Math.PI * 1.9, 'a whole turn');
    assert.ok(lowest > at.y - .01, 'never through the pavement');
  }
  // Before and after, and at each end, exactly as they stand
  const person = { hopStart: 5, hopSpin: 1 }, after = original.clone();
  assert.equal(applyHop(person, after, 5 + HOP + 1e-9), false);
  after.elements.forEach((n, k) => close(n, original.elements[k]));
  assert.equal(person.hopStart, undefined);
  for (const t of [0, HOP - 1e-6]) { const m = original.clone(); applyHop({ hopStart: 0 }, m, t); m.elements.forEach((n, k) => close(n, original.elements[k], 1e-4)); }
});

test('a waiting fare hopped over by a car is still at their spot, and a party keeps its state through marker rebuilds', () => {
  const view = new TaxiView(new THREE.Scene()), contacts = new PedestrianContacts();
  const props = new LooseProps(new THREE.Scene(), new THREE.MeshBasicMaterial());
  const start = journeyStart();
  const run = { running: true, status: 'pickup', revision: 1,
    customers: [{ id: 'hop-group', s: start.s, u: start.u, axis: 'north', side: 1, heading: 0, passengers: 2, color: '#ffffff' }] };
  try {
    view.render(run, car(1e4, 1e4), 0, 10);
    const marker = view.markers[0], matrix = new THREE.Matrix4(), standing = new THREE.Matrix4();
    marker.person.getMatrixAt(0, standing);
    marker.group.updateMatrix();
    const at = new THREE.Vector3().setFromMatrixPosition(standing).applyMatrix4(marker.group.matrix);
    // A car driving east through where the first one stands
    const vehicle = driven(at.x - 6, at.z, Math.PI / 2, 14);
    vehicle.groundedPosition.y = at.y - .1;
    let time = 10, highest = 0;
    for (; time < 12; time += 1 / 60) {
      vehicle.drive(1 / 60); props.update(1 / 60, vehicle); props.render(1, 0);
      contacts.update(vehicle, null, time, props); view.render(run, vehicle, 0, time, contacts);
      marker.person.getMatrixAt(0, matrix);
      highest = Math.max(highest, matrix.elements[13] - standing.elements[13]);
      assert.equal(marker.reactions[0].body, undefined, 'never thrown');
    }
    assert.ok(highest > 1, `hopped (${highest.toFixed(2)} m)`);
    assert.equal(props.people.length, 0);
    // and back on their spot, still waiting, as they stood (their bob aside)
    marker.person.getMatrixAt(0, matrix);
    close(matrix.elements[12], standing.elements[12], 1e-6); close(matrix.elements[14], standing.elements[14], 1e-6);
    const reactions = marker.reactions;
    view.rebuild(run); assert.equal(view.markers[0].reactions, reactions);
    view.reset(); view.render(run, vehicle, 0, time + 1);
    assert.notEqual(view.markers[0].reactions, reactions);
  } finally { view.dispose(); props.dispose(); }
});

test('in the city, a pair knocked apart gets back together and walks on', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene), start = journeyStart();
  const props = new LooseProps(scene, new THREE.MeshBasicMaterial()), contacts = new PedestrianContacts();
  try {
    world.update(start.s, start.u); while (world.pending.length) world.update(start.s, start.u);
    const chunks = [...world.chunks.values()].filter(c => c.peopleMesh && c.walkers.some(w => w.pairOffset));
    chunks.sort((p, q) => Math.hypot(p.east - start.u, p.start - start.s) - Math.hypot(q.east - start.u, q.start - start.s));
    const chunk = chunks[0], i = chunk.walkers.findIndex(w => w.pairOffset < 0), walker = chunk.walkers[i], partner = chunk.walkers[i + 1];
    assert.ok(walker && partner?.pairOffset > 0, 'a pair walking round a block');
    const dt = 1 / 60, matrix = new THREE.Matrix4(), at = t => {
      chunk.animate(t, t, true, contacts);
      chunk.peopleMesh.getMatrixAt(i, matrix);
      return new THREE.Vector3().setFromMatrixPosition(matrix).add(new THREE.Vector3(chunk.east, 0, -chunk.start));
    };
    // A car from across their path, aimed where they will be
    let time = 50;
    const here = at(time), ahead = at(time + .5), dx = ahead.x - here.x, dz = ahead.z - here.z, l = Math.hypot(dx, dz);
    // (square across their way: x += sin h, z -= cos h as it drives)
    const heading = Math.atan2(-dz / l, -dx / l), vehicle = driven(0, 0, heading, 12);
    vehicle.groundedPosition.set(ahead.x - Math.sin(heading) * 6, here.y - .12, ahead.z + Math.cos(heading) * 6);
    const log = [];
    for (let k = 0; k < 60 * 45; k++, time += dt) {
      if (k < 90) vehicle.drive(dt); else vehicle.speed = 0;
      props.update(dt, vehicle, null, world.chunks); props.render(1, 0);
      contacts.update(vehicle, null, time, props);
      at(time);
      log.push({ time, away: walker.away, partnerStill: standing(partner, time), hurry: hurrying(walker, time) || hurrying(partner, time),
        apart: Math.hypot(walker.drawn.x - partner.drawn.x, walker.drawn.z - partner.drawn.z) });
      if (k > 90 && !walker.away && walker.stride && partner.stride && time > Math.max(walker.stride.until, partner.stride.until) + 2) break;
    }
    const knocked = log.findIndex(f => f.away);
    assert.ok(knocked >= 0, 'knocked over');
    assert.ok(log.slice(knocked, knocked + 30).every(f => f.partnerStill), 'the other stops at once');
    const back = log.findIndex((f, k) => k > knocked && !f.away);
    assert.ok(back > knocked, 'back on their feet');
    // Walking on side by side at the end, as a pair walks
    const last = log.at(-1);
    assert.ok(!standing(walker, last.time) && !standing(partner, last.time) && !last.hurry, 'walking on');
    close(onLoopOf(walker, last.time), onLoopOf(partner, last.time), 1e-6);
    assert.ok(Math.abs(last.apart - .92) < .25, `side by side (${last.apart.toFixed(2)} m apart)`);
  } finally { props.dispose(); world.dispose(); }
});
const onLoopOf = (walker, time) => { const p = walker.loop.perimeter; return (((walker.phase + walkedAt(walker, time) * walker.direction) % p) + p) % p; };

test('loose furniture flung at someone knocks them over, and so does someone already sent flying', async () => {
  const { cityAssets } = await import('../src/world/city-assets.js');
  const start = journeyStart(), road = roadAt(start.s, start.u, 40), heading = Math.atan2(road.tx, road.ty);
  const x = road.x + road.tx * 20, z = -(road.y + road.ty * 20), across = { x: Math.cos(heading), z: Math.sin(heading) };
  const at = (dx, dz) => new THREE.Matrix4().makeTranslation(x + dx, ROAD_LEVEL, z + dz);
  // A bin thrown at a standing person from 6 m off, `height` metres up, at 10 m/s
  const throwAt = (height, speed = 10, person = {}) => {
    const props = new LooseProps(new THREE.Scene(), new THREE.MeshBasicMaterial()), contacts = new PedestrianContacts();
    const bystander = driven(x + across.x * 40, z + across.z * 40, heading, 0), matrix = new THREE.Matrix4(), frame = new THREE.Matrix4();
    const bin = props.add({ kind: 'bin', geometry: cityAssets.bin }, at(-across.x * 6, -across.z * 6).multiply(new THREE.Matrix4().makeTranslation(0, height, 0)));
    bin.v.set(across.x * speed, height > 1 ? 4 : 0, across.z * speed); props.wake(bin);
    let knocked = null;
    for (let i = 0; i < 120 * 1.5; i++) {
      const time = i / 120;
      props.update(1 / 120, bystander); props.render(1, 0);
      contacts.update(bystander, null, time, props);
      contacts.person(person, matrix.copy(at(0, 0)), frame, .3, time);
      if (person.body && knocked === null) knocked = Math.hypot(bin.v.x, bin.v.z);
    }
    return { knocked, bin, person };
  };
  const low = throwAt(.3);
  assert.ok(low.person.body, 'a bin at knee height knocks them over');
  assert.ok(low.knocked < 10, `and gives up some of its way (${low.knocked?.toFixed(1)} m/s)`);
  // (thrown up from 3.5 m, it is still over 3 m up as it passes)
  const over = throwAt(3.5);
  assert.equal(over.person.body, undefined, 'one over their head does not');
  const slow = throwAt(.3, 1.2);
  assert.equal(slow.person.body, undefined, 'nor one rolling to a stop at their feet');
  // Someone sent flying at another person knocks them over too
  const { cityWalker } = await import('../src/world/city-walkers.js');
  const props = new LooseProps(new THREE.Scene(), new THREE.MeshBasicMaterial()), contacts = new PedestrianContacts();
  const bystander = driven(x + across.x * 40, z + across.z * 40, heading, 0), other = {}, matrix = new THREE.Matrix4();
  const flying = props.add({ kind: 'person', geometry: cityWalker, person: true }, at(-across.x * 4, -across.z * 4).multiply(new THREE.Matrix4().makeTranslation(0, .4, 0)));
  flying.v.set(across.x * 7, 1, across.z * 7); props.wake(flying);
  for (let i = 0; i < 120 && !other.body; i++) {
    props.update(1 / 120, bystander); props.render(1, 0);
    contacts.update(bystander, null, i / 120, props);
    contacts.person(other, matrix.copy(at(0, 0)), new THREE.Matrix4(), .3, i / 120);
  }
  assert.ok(other.body, 'they go over too');
});
