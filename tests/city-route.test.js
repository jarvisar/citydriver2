import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY, cityDistrict, cityCell } from '../src/world/city.js';
import { citydriverRoute, journeyStart, nearestLanePose, roadAt, onRoadAt, cityHeight, waterAt, surfaceAt, ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL } from '../src/world/city-route.js';
import { insidePolygon } from '../src/mapgen/polygon-util.js';
import { carriagewayScore } from '../src/mapgen/generate.js';
import { MEDIAN_KERB } from '../src/world/city-medians.js';
import { DrivingController } from '../src/vehicle.js';

test('the drive starts in a lane of a wide road near the middle of the city, facing along it', () => {
  const start = journeyStart();
  assert.deepEqual(start, journeyStart());
  assert.ok(Math.hypot(start.s, start.u) < 600, `${start.s},${start.u}`);
  const road = roadAt(start.s, start.u);
  assert.ok(road && ['main', 'major', 'ring', 'coast'].includes(road.road.kind));
  assert.ok(Math.abs(road.distance - road.road.profile.lane) < .05);
  const roadHeading = Math.atan2(road.tx, road.ty);
  assert.ok(Math.abs(Math.sin(start.heading - roadHeading)) < .01);
  assert.equal(cityHeight(start.s, start.u), ROAD_LEVEL);
});

test('heights come from the kerbs, the roadway and the water, and bridges stay dry', () => {
  let roadPoints = 0, pavementPoints = 0, waterPoints = 0, bridgePoints = 0, medianPoints = 0;
  // All over the city, out to the ring road
  for (let s = -CITY.height / 2; s <= CITY.height / 2; s += 23) for (let u = -CITY.width / 2; u <= CITY.width / 2; u += 29) {
    const height = cityHeight(s, u), surface = surfaceAt(s, u);
    // Inside a block's kerb is pavement, and a kerb never reaches onto a carriageway
    const kerbed = CITY.blocks.some(block => block.kerb.length >= 3 && insidePolygon({ x: u, y: s }, block.kerb));
    // (a carriageway ending square across its road's end, as it is drawn)
    if (kerbed) { assert.equal(surface, 'pavement'); const road = CITY.roadIndex.nearest(u, s, 26, carriagewayScore); assert.ok(!road || road.score > -.6, `pavement on a road at ${u},${s}`); }
    if (surface === 'pavement') { pavementPoints++; assert.equal(height, PAVEMENT_LEVEL); }
    // A boulevard's median stands a kerb above its carriageway, down its middle
    else if (surface === 'median') { medianPoints++; assert.equal(height, ROAD_LEVEL + MEDIAN_KERB); assert.ok(roadAt(s, u).distance < roadAt(s, u).road.profile.median + .01); }
    else if (surface === 'water') { waterPoints++; assert.equal(height, WATER_LEVEL); assert.equal(citydriverRoute.water(s, u), true); assert.ok(!onRoadAt(s, u)); }
    else {
      assert.equal(height, ROAD_LEVEL);
      if (onRoadAt(s, u)) roadPoints++;
      if (waterAt(s, u)) { bridgePoints++; assert.ok(onRoadAt(s, u)); assert.equal(citydriverRoute.water(s, u), false); }
    }
  }
  assert.ok(roadPoints > 100 && pavementPoints > 500, `${roadPoints} road, ${pavementPoints} pavement`);
  assert.ok(waterPoints > 20, `${waterPoints} water points`);
  assert.ok(bridgePoints > 0, 'no road crosses the water');
  assert.ok(medianPoints > 0, 'no boulevard has a median');
});

test('the nearest lane pose faces the way the car was heading and every district has a name', () => {
  const start = journeyStart();
  const pose = nearestLanePose(start.s + 3, start.u + 3, start.heading);
  assert.ok(Math.hypot(pose.s - start.s, pose.u - start.u) < 12);
  assert.ok(Math.cos(pose.heading - start.heading) > .9);
  const reversed = nearestLanePose(start.s, start.u, start.heading + Math.PI);
  assert.ok(Math.cos(reversed.heading - start.heading) < -.9);
  assert.equal(typeof cityDistrict(start.s, start.u), 'string');
  assert.equal(cityCell(0, 0).key, '0,0');
  assert.ok(CITY.lots.length > 200 && CITY.land.length >= 1);
});

test('the car drives forward from the start and stays on the road surface', () => {
  const car = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  try {
    car.toggleFreeDriving();
    assert.ok(Math.abs(car.car.position.y - ROAD_LEVEL - .13) < 1e-6);
    for (let i = 0; i < 180; i++) car.update(1 / 60, { forward: true });
    assert.ok(car.distance > 15, `${car.distance}`);
    assert.ok(car.speed > 5);
    assert.ok(onRoadAt(car.s, car.u), 'left the road while driving straight');
  } finally { car.disposeModel(); }
});

test('the pavement index answers as a full point-in-polygon test, before and after it is sealed', async () => {
  const { PolygonIndex } = await import('../src/world/city.js');
  let seed = 7; const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const index = new PolygonIndex(32), polygons = [];
  for (let k = 0; k < 40; k++) {
    const cx = (random() - .5) * 400, cy = (random() - .5) * 400, n = 5 + Math.floor(random() * 80), polygon = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, r = 10 + random() * 60; polygon.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
    index.add(polygon, k); polygons.push(polygon);
  }
  // (one trimmed in place after it was indexed, as the city trims promenades)
  polygons[3].splice(0, polygons[3].length, ...polygons[3].filter((p, i) => i % 2 === 0));
  const full = (x, y) => {
    for (const { polygon, value, b } of index.cells.get(Math.floor(x / 32) * 65536 + Math.floor(y / 32)) ?? []) {
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && insidePolygon({ x, y }, polygon)) return value;
    }
    return null;
  };
  const points = [];
  for (let i = 0; i < 20000; i++) points.push([(random() - .5) * 560, (random() - .5) * 560]);
  for (const polygon of polygons) for (const p of polygon) for (const d of [0, 1e-9, -1e-6, .01]) points.push([p.x + d, p.y - d]);
  for (const [x, y] of points) assert.equal(index.find(x, y), full(x, y));
  index.seal();
  for (const [x, y] of points) assert.equal(index.find(x, y), full(x, y), `at ${x},${y}`);
  assert.ok(CITY.pavement.sealed, 'the city seals its pavement once its kerbs are final');
});
