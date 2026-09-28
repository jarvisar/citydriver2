import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Pigeons } from '../src/world/city-pigeons.js';

const GROUND = 24.12;
// A chunk of benches along x at z = 0, and a building if given
function chunkOf(benches, building = null) {
  const colliders = benches.map(x => ({ x, z: 0, reach: 1.1, heading: 0, halfWidth: .35, halfLength: 1, prop: { pieces: [{ kind: 'bench' }] } }));
  if (building) colliders.push(building);
  return { collisionBounds: { minX: -1e3, maxX: 1e3, minZ: -1e3, maxZ: 1e3 }, features: { colliders } };
}
// Pavement everywhere but a road north of z = -6
const ground = (x, z) => z < -6 ? NaN : GROUND;
const pose = {};

test('flocks keep to a share of the benches near the player, off the road', () => {
  const pigeons = new Pigeons(new THREE.Scene(), new THREE.MeshStandardMaterial());
  try {
    // (a lot of benches, all near: which ones get a flock depends on the city's seed)
    const benches = Array.from({ length: 90 }, (_, i) => i * 1.5 - 67), chunks = [chunkOf(benches)];
    pigeons.gather(chunks, 0, 0, 0, ground);
    const share = pigeons.flocks.length / benches.length;
    assert.ok(share > .15 && share < .6, `${pigeons.flocks.length} flocks round ${benches.length} benches`);
    for (const flock of pigeons.flocks) {
      assert.ok(flock.birds.length >= 1 && flock.birds.length <= 9);
      for (const bird of flock.birds) {
        assert.ok(bird.z >= -6 && bird.y === GROUND, 'never on the road');
        assert.ok(Math.hypot(bird.x, bird.z) > 1.2, 'nor on the bench');
      }
    }
    // The same benches have the same flocks, found again
    const again = pigeons.flocks.map(flock => flock.x).join();
    pigeons.gather(chunks, 0, 0, 5, ground);
    assert.equal(pigeons.flocks.map(flock => flock.x).join(), again);
    // Far off, none
    pigeons.gather(chunks, 0, 600, 10, ground);
    assert.equal(pigeons.flocks.length, 0);
  } finally { pigeons.dispose(); }
});

test('someone running at a flock puts it up, each bird taking off, looping and landing where it would be, without a jump', () => {
  const pigeons = new Pigeons(new THREE.Scene(), new THREE.MeshStandardMaterial());
  try {
    // (benches well apart, so only one flock is near, moved along until one has a flock)
    const benches = Array.from({ length: 8 }, (_, i) => i * 20 - 70);
    let chunks = [], flock = null;
    for (let shift = 0; shift < 600 && !flock; shift += 6) { chunks = [chunkOf(benches.map(x => x + shift))]; pigeons.gather(chunks, 0, 0, shift, ground); flock = pigeons.flocks[0]; }
    const bird = flock.birds[0];
    let flights = 0;
    pigeons.onFlight = () => flights++;
    // Walking past slowly, they stay put. Running at them, they go up.
    pigeons.scare({ x: flock.x + 2, z: flock.z, speed: 1, car: false }, 10, chunks);
    assert.equal(flights, 0, 'a stroll past leaves them');
    pigeons.scare({ x: flock.x + bird.x + 1.5, z: flock.z + bird.z, speed: 5, car: false }, 10, chunks);
    assert.equal(flights, 1);
    // Up in the air in the middle of the flight, and on the ground either side of it, meeting it
    const start = flock.scared + bird.delay, end = start + bird.flight;
    assert.ok(pigeons.pose(flock, bird, start + bird.flight / 2, pose).y > GROUND + 3, 'flying');
    for (const [t, dt] of [[start, .001], [end, -.001]]) {
      const a = { ...pigeons.pose(flock, bird, t - dt, {}) }, b = { ...pigeons.pose(flock, bird, t + dt, {}) };
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < .05, `no jump at ${t === start ? 'take-off' : 'landing'}`);
    }
    // Once down, not again straight away, but a car going by fast puts them up again later
    pigeons.scare({ x: flock.x, z: flock.z + 5, speed: 12, car: true }, flock.until + .5, chunks);
    assert.equal(flights, 1);
    pigeons.scare({ x: flock.x, y: GROUND + 40, z: flock.z + 5, speed: 12, car: true }, flock.until + 3, chunks);
    assert.equal(flights, 1, 'the helicopter well up above them leaves them be');
    pigeons.scare({ x: flock.x, z: flock.z + 5, speed: 12, car: true }, flock.until + 3, chunks);
    assert.equal(flights, 2);
    // Drawn: a body and two wings a bird
    pigeons.render(0, 11);
    assert.ok(pigeons.bodies.count > 0 && pigeons.rights.count === pigeons.bodies.count && pigeons.lefts.count === pigeons.bodies.count);
  } finally { pigeons.dispose(); }
});

test('a flock flies its loop clear of the buildings', () => {
  const pigeons = new Pigeons(new THREE.Scene(), new THREE.MeshStandardMaterial());
  try {
    // A tall building south of a lone bench, running right past it
    const building = { corners: [{ x: -40, z: 3 }, { x: 40, z: 3 }, { x: 40, z: 40 }, { x: -40, z: 40 }], x: 0, z: 21.5, reach: 45, top: 44 };
    // (and nobody stands in it: the game's ground is the pavement only)
    const beside = (x, z) => z >= 3 ? NaN : ground(x, z);
    let chunks = [], flock = null;
    for (let x = 0; x < 600 && !flock; x += 6) { chunks = [chunkOf([x], { ...building, x, corners: building.corners.map(c => ({ x: c.x + x, z: c.z })) })]; pigeons.gather(chunks, x, 0, x, beside); flock = pigeons.flocks[0]; }
    assert.ok(flock, 'a flock by the building');
    // Scared from the north, their way away is south, into the building: they loop another way
    pigeons.scare({ x: flock.x, z: flock.z - 3, speed: 12, car: true }, 1000, chunks);
    for (const bird of flock.birds) for (let u = .05; u < 1; u += .05) {
      const p = pigeons.pose(flock, bird, flock.scared + bird.delay + u * bird.flight, pose);
      assert.ok(p.z < 3 || p.y > GROUND + 44, `bird ${bird.k} at ${u.toFixed(2)} is outside it (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
  } finally { pigeons.dispose(); }
});
