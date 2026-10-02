import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY, cityStyleDistrict } from '../src/world/city.js';
import { cityJumps, inJumpZone } from '../src/world/city-jumps.js';
import { cityParks } from '../src/world/city-parks.js';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { shapeHeight, collideScenery } from '../src/collision.js';
import { waterAt, roadAt, journeyStart, citydriverRoute, PAVEMENT_LEVEL, ROAD_LEVEL } from '../src/world/city-route.js';
import { CityTraffic } from '../src/city-traffic.js';
import { insidePolygon, distanceToPolyline } from '../src/mapgen/polygon-util.js';
import { LooseProps } from '../src/loose-props.js';
import { cityAssets } from '../src/world/city-assets.js';
import { DrivingController } from '../src/vehicle.js';
import { WALKER_SPEC } from '../src/walker.js';
import { JumpBook } from '../src/jump-book.js';
import { TaxiRun, TIPS } from '../src/taxi-run.js';
import { DemolitionRun, chainSeconds } from '../src/demolition-run.js';

const { sites } = cityJumps();
// A point `t` metres along a jump from its foot, as map points
const along = (site, t) => ({ x: site.u + Math.sin(site.heading) * t, y: site.s + Math.cos(site.heading) * t });
let world = null;
const built = () => world ??= new CitydriverWorld(new THREE.Scene());
const furniture = () => [...built().furnitureByChunk.values()].flat();

test('loading ramps stand in the warehouse district\'s parking bays, facing the traffic on their side', () => {
  const ramps = sites.filter(site => site.kind === 'loading');
  assert.ok(ramps.length <= 5);
  for (const ramp of ramps) {
    const at = `at ${ramp.u.toFixed(0)},${ramp.s.toFixed(0)}`, middle = along(ramp, ramp.size.run / 2);
    assert.equal(cityStyleDistrict(ramp.s, ramp.u), 'Warehouse district', at);
    const road = CITY.roadIndex.nearest(middle.x, middle.y, 20, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance);
    assert.ok(road?.road.profile.parking, `on a street with parking ${at}`);
    assert.ok(road.distance > road.road.profile.parking - 1.3 && road.distance < road.road.profile.halfWidth, `in a bay ${at}: ${road.distance.toFixed(2)} m out`);
    assert.ok(Math.abs(Math.sin(ramp.heading) * road.ty - Math.cos(ramp.heading) * road.tx) < .06, `along the street ${at}`);
    // (and on the traffic's side: the right, going the way it faces)
    const right = (middle.x - road.x) * Math.cos(ramp.heading) - (middle.y - road.y) * Math.sin(ramp.heading);
    assert.ok(right > 0, `on the right of its way ${at}`);
    assert.ok(ramp.stars[0] < ramp.stars[1] && ramp.stars[1] < ramp.stars[2]);
  }
});

test('the river jump reaches out over the water at a far bank a car can reach, well clear of the bridges', () => {
  const river = sites.find(site => site.kind === 'river');
  if (!CITY.hasRiver) { assert.ok(!river); return; }
  assert.ok(river, 'a city with a river has its river jump');
  const run = river.size.run, lip = along(river, run - .5), far = along(river, run + river.gap + 3);
  assert.ok(!waterAt(river.s, river.u), 'its foot on the promenade');
  assert.ok(waterAt(lip.y, lip.x), 'its lip out over the water');
  assert.ok(river.gap >= 36 && river.gap <= 74 && !waterAt(far.y, far.x), `a far bank ${river.gap} m off`);
  assert.equal(shapeHeight(river.shape, { x: river.u, z: -river.s }), PAVEMENT_LEVEL);
  const top = along(river, run);
  assert.ok(Math.abs(shapeHeight(river.shape, { x: top.x, z: -top.y }) - (PAVEMENT_LEVEL + river.size.rise)) < 1e-6, 'up to its rise at the lip');
  // A straight street to run up, and no bridge anywhere near the flight
  assert.ok(roadAt(river.runup.s, river.runup.u, 16)?.score < 0, 'a run at it down a street');
  const flight = [along(river, 0), along(river, run + river.gap + 40)];
  for (const bridge of CITY.bridges ?? []) assert.ok(bridge.points.every(p => distanceToPolyline(p, flight) >= 70), 'clear of the bridges');
  // The far bank's end of the bridge: out over the water from the quay wall,
  // with a gap in the railing behind it to come down through
  const end = river.abutment;
  if (!end) return;
  const wall = p => Math.min(...CITY.walls.map(line => distanceToPolyline(p, line)));
  const [bl, br, fr, fl] = end.outline;
  assert.ok(wall(bl) < .3 && wall(br) < .3, 'its back along the quay wall');
  assert.ok(wall(fr) > 1.5 && wall(fl) > 1.5, 'its front out over the water');
  assert.ok(river.stars[0] <= river.gap + end.front + 1, 'a star for coming down on it');
  const ju = Math.sin(river.heading), js = Math.cos(river.heading);
  for (const piece of furniture().filter(piece => piece.kind === 'railing')) {
    const du = piece.u - river.far.u, ds = piece.s - river.far.s, ahead = du * ju + ds * js, aside = Math.abs(du * js - ds * ju);
    assert.ok(Math.abs(ahead) > 4 || aside > end.width / 2 + 2, `a railing across the landing at ${piece.u.toFixed(1)},${piece.s.toFixed(1)}`);
  }
});

test('mounds sit on the parks\' open lawns, clear of the walks, with nothing standing on them', () => {
  const mounds = sites.filter(site => site.kind === 'mound'), pieces = furniture();
  for (const mound of mounds) {
    const at = `at ${mound.u.toFixed(0)},${mound.s.toFixed(0)}`;
    const park = cityParks().find(entry => !entry.park.square && insidePolygon({ x: mound.u, y: mound.s }, entry.park.lawn));
    assert.ok(park && mound.outline.every(p => insidePolygon(p, park.park.lawn)), `on a park's lawn ${at}`);
    const path = CITY.roadIndex.nearest(mound.u, mound.s, 40, (segment, distance) => distance - segment.road.profile.halfWidth);
    assert.ok(!path || path.score > mound.size.rx, `clear of the walks ${at}`);
    const on = pieces.filter(piece => piece.kind !== 'jump' && insidePolygon({ x: piece.u, y: piece.s }, mound.outline));
    assert.equal(on.length, 0, `nothing on it ${at}: ${on.map(piece => piece.kind).join(' ')}`);
  }
});

test('nothing else stands in a jump\'s zone, and every jump is placed once', () => {
  const pieces = furniture(), jumps = pieces.filter(piece => piece.kind === 'jump' && !piece.part);
  assert.equal(jumps.length, sites.length);
  assert.deepEqual(new Set(jumps.map(piece => piece.site)), new Set(sites));
  // (and the river jump's far end in a piece of its own, in its own cell)
  assert.deepEqual(pieces.filter(piece => piece.part === 'far').map(piece => piece.site), sites.filter(site => site.abutment));
  for (const piece of pieces) if (piece.kind !== 'jump') assert.ok(!inJumpZone(piece.u, piece.s), `${piece.kind} at ${piece.u.toFixed(1)},${piece.s.toFixed(1)}`);
});

test('a jump\'s cell gives it a collider, the shape it is drawn with as its top', () => {
  const site = sites.find(each => each.kind === 'loading') ?? sites[0], w = built();
  w.update(site.s, site.u);
  const colliders = [...w.chunks.values()].flatMap(chunk => chunk.features?.colliders ?? []), solid = colliders.find(each => each.jump === site);
  assert.ok(solid && solid.shape === site.shape && solid.top === site.top);
  assert.equal(solid.corners.length, site.outline.length);
  for (let i = 0; i < site.outline.length; i++) assert.ok(Math.abs(solid.corners[i].x - site.outline[i].x) < 1e-9 && Math.abs(solid.corners[i].z + site.outline[i].y) < 1e-9);
  // The river jump's far end is level with the promenade, to drive off
  const end = sites.find(each => each.abutment)?.abutment;
  if (!end) return;
  w.update(end.s, end.u);
  const plate = [...w.chunks.values()].flatMap(chunk => chunk.features?.colliders ?? []).find(each => each.top === end.top && each.shape?.rise === 0);
  assert.ok(plate, 'a collider for the far end');
  const middle = { x: (end.outline[0].x + end.outline[2].x) / 2, z: -(end.outline[0].y + end.outline[2].y) / 2 };
  assert.equal(shapeHeight(plate.shape, middle), PAVEMENT_LEVEL + .02);
});

test('the truck come down on a parked car wrecks it and stands on it, woken under it or not', () => {
  const w = built(), start = journeyStart(), scene = new THREE.Scene();
  w.update(start.s, start.u); while (w.pending.length) w.update(start.s, start.u);
  const parked = [...w.chunks.values()].flatMap(c => c.features.colliders).filter(c => c.parked?.profile && !c.woken)
    .sort((a, b) => Math.hypot(a.x - start.u, -a.z - start.s) - Math.hypot(b.x - start.u, -b.z - start.s))[0];
  assert.ok(parked, 'a parked car near the start');
  const truck = new DrivingController(citydriverRoute, start, 'rig'), traffic = new CityTraffic(scene, truck.route, truck.s, 'city', truck.u);
  try {
    truck.toggleFreeDriving(); truck.scenery = w.chunks; truck.traffic = traffic;
    const damage = []; traffic.onDamage = (car, closing) => damage.push({ car, closing });
    truck.s = -parked.z; truck.u = parked.x; truck.heading = Math.atan2(parked.parked.nose.u, parked.parked.nose.s); truck.update(0, {});
    truck.y = parked.parked.base + parked.parked.height + 4; truck.vy = 0; truck.aloft = true;
    for (let i = 0; i < 240; i++) {
      truck.update(1 / 120, {});
      for (const event of truck.drain()) if (event.kind === 'stomp') traffic.stomp(event.on, event.impact, event);
      collideScenery(truck, w.chunks, 1 / 120, (collider) => traffic.wake(collider));
      traffic.update(1 / 120, truck, w.chunks);
    }
    assert.ok(parked.woken, 'woken to take the blow');
    assert.equal(damage.length, 1, 'one blow');
    assert.ok(damage[0].closing > 16, `hard enough to write it off (${damage[0].closing.toFixed(1)} m/s)`);
    const car = traffic.woken.find(each => each.parked === parked);
    assert.ok(truck.y > ROAD_LEVEL + 1.2 && Math.hypot(car.u - parked.x, car.s + parked.z) < .1, `up on it, and it where it was (${(truck.y - ROAD_LEVEL).toFixed(2)} m)`);
  } finally { traffic.dispose(); truck.disposeModel(); }
});

// A ramp on the road at the start, facing along it, for what stands on it
function rampAt(start, t0 = 30) {
  const ju = Math.sin(start.heading), js = Math.cos(start.heading), foot = { u: start.u + ju * t0, s: start.s + js * t0 };
  const run = 7, flat = 1.5, width = 3, rise = 1.4, ru = js, rs = -ju;
  const at = (t, a) => ({ x: foot.u + ju * t + ru * a, z: -(foot.s + js * t + rs * a) });
  const corners = [at(0, -width / 2), at(0, width / 2), at(run + flat, width / 2), at(run + flat, -width / 2)];
  const x = corners.reduce((sum, p) => sum + p.x, 0) / 4, z = corners.reduce((sum, p) => sum + p.z, 0) / 4;
  const solid = { corners, x, z, heading: 0, reach: 6, top: ROAD_LEVEL + rise, shape: { kind: 'ramp', x: foot.u, z: -foot.s, dx: ju, dz: -js, run, rise, curve: .5, flat, base: ROAD_LEVEL } };
  return { solid, at, chunks: new Map([['ramp', { collisionBounds: { minX: x - 12, maxX: x + 12, minZ: z - 12, maxZ: z + 12 }, features: { colliders: [solid] } }]]) };
}

test('a loose piece dropped on a ramp comes to rest on it, not in it', () => {
  const start = journeyStart(), { solid, at, chunks } = rampAt(start), props = new LooseProps(new THREE.Scene(), new THREE.MeshBasicMaterial());
  try {
    const spot = at(4, 0), surface = shapeHeight(solid.shape, spot);
    const body = props.add({ kind: 'bin', geometry: cityAssets.bin }, new THREE.Matrix4().makeTranslation(spot.x, surface + .6, spot.z));
    for (let i = 0; i < 120 * 4 && !body.asleep; i++) props.step(body, 1 / 120, chunks);
    const under = shapeHeight(solid.shape, { x: body.p.x, z: body.p.z });
    assert.ok(body.p.y > under - .05 && body.p.y < under + .9, `resting at ${(body.p.y - under).toFixed(2)} m over the ramp, not the road under it`);
  } finally { props.dispose(); }
});

test('someone on foot walks up a ramp and drops off its end', () => {
  const start = journeyStart(), { solid, chunks } = rampAt(start, 12);
  const walker = new DrivingController(start.route ?? undefined, { s: start.s, u: start.u, heading: start.heading }, WALKER_SPEC.name);
  try {
    walker.freeDriving = true; walker.scenery = chunks; walker.update(0, {});
    const ahead = { x: Math.sin(start.heading), z: -Math.cos(start.heading) };
    let highest = -Infinity;
    for (let i = 0; i < 120 * 7; i++) {
      walker.update(1 / 120, { walk: ahead });
      highest = Math.max(highest, walker.groundedPosition.y);
    }
    assert.ok(highest > ROAD_LEVEL + 1.2, `up to ${(highest - ROAD_LEVEL).toFixed(2)} m`);
    assert.ok(Math.abs(walker.groundedPosition.y - ROAD_LEVEL) < .2, 'and down again past its end');
    assert.ok(solid.top > ROAD_LEVEL);
  } finally { walker.disposeModel(); }
});

test('free drive\'s book of jumps: stars by distance, a best for each jump, and records', () => {
  const site = sites.find(each => each.stars), book = new JumpBook();
  if (!site) return;
  const jump = (distance, extra = {}) => ({ kind: 'jump', distance, air: 1.2, turns: 0, landing: 'clean', jump: site, ...extra });
  const first = book.land(jump(site.stars[0] + 1));
  assert.match(first.text, /★☆☆/); assert.equal(first.gained, 1);
  const best = book.land(jump(site.stars[2] + 1));
  assert.match(best.text, /★★★/); assert.match(best.text, /Best here/);
  assert.equal(best.gained, 2, 'only the stars it newly took pay');
  assert.equal(book.land(jump(site.stars[0] + 1)).gained, 0);
  assert.equal(book.best.get(site.id), Math.round(site.stars[2] + 1));
  assert.equal(book.land(jump(site.stars[2] + 30, { landing: 'splash' })), null, 'a splash is no landing');
  assert.equal(book.best.get(site.id), Math.round(site.stars[2] + 1));
  assert.equal(book.landed, 1);
  // Off anything else: a hop is not worth a word, big air and a spin are
  const loose = (distance, air, turns = 0) => book.land({ kind: 'jump', distance, air, turns, landing: 'clean', jump: null });
  assert.equal(loose(6, .5), null);
  assert.match(loose(40, 1.8).text, /^Big air/);
  assert.match(loose(30, 1.2, 1).text, /^360/);
  assert.ok(book.records.longest >= site.stars[2] && book.records.turns === 1);
});

test('a jump with a fare aboard tips as a Crazy jump, and a spin out loses the combo', () => {
  const run = new TaxiRun(null);
  Object.assign(run, { status: 'driving', fare: { mood: null, passengers: 1 }, onboard: 1, combo: 2, crashCooldown: 0 });
  run.onTheWay = () => true;
  run.jumped({ air: 1.5, turns: 0, landing: 'clean' }, {});
  const tip = run.drainEvents().find(event => event.kind === 'tip');
  assert.ok(tip && tip.trick === 'Crazy jump' && tip.tip === Math.round(TIPS.jump * 2 * 1.5) * 2, JSON.stringify(tip));
  run.jumped({ air: 1, turns: 1, landing: 'clean' }, {});
  assert.equal(run.drainEvents().find(event => event.kind === 'tip')?.trick, 'Crazy 360');
  run.jumped({ air: 1, turns: 0, landing: 'spun' }, {});
  assert.equal(run.combo, 1);
  // A nervous rider is shaken by a hard landing
  Object.assign(run, { fare: { mood: 'nervous', passengers: 1 }, shaken: false });
  run.jumped({ air: 1, turns: 0, landing: 'hard' }, {});
  assert.ok(run.shaken);
});

test('in a demolition run a jump landed keeps the chain going, and the wait holds in the air', () => {
  const run = new DemolitionRun(null);
  run.start(); run.chain = 5; run.chainTime = .2;
  run.update(.5, true);
  assert.equal(run.chain, 5, 'waiting while the truck is up');
  run.jumped({ distance: 30, landing: 'clean' });
  assert.equal(run.chainTime, chainSeconds(run.multiplier));
  run.update(chainSeconds(run.multiplier) + .1);
  assert.equal(run.chain, 0, 'banked once it is down and the wait runs out');
});
