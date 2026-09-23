import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY, cityDistrict, cityCell } from '../src/world/city.js';
import { citydriverRoute, journeyStart, nearestLanePose, roadAt, onRoadAt, cityHeight, waterAt, ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL } from '../src/world/city-route.js';
import { DrivingController } from '../src/vehicle.js';

test('the drive starts in a lane of a wide road near the middle of the city, facing along it', () => {
  const start = journeyStart();
  assert.deepEqual(start, journeyStart());
  assert.ok(Math.hypot(start.s, start.u) < 600, `${start.s},${start.u}`);
  const road = roadAt(start.s, start.u);
  assert.ok(road && ['main', 'major', 'coast'].includes(road.road.kind));
  assert.ok(Math.abs(road.distance - road.road.profile.lane) < .01);
  const roadHeading = Math.atan2(road.tx, road.ty);
  assert.ok(Math.abs(Math.sin(start.heading - roadHeading)) < .01);
  assert.equal(cityHeight(start.s, start.u), ROAD_LEVEL);
});

test('heights come from the road, the pavement and the water, and bridges stay dry', () => {
  let roadPoints = 0, pavementPoints = 0, waterPoints = 0, bridgePoints = 0;
  for (let s = -800; s <= 800; s += 23) for (let u = -1100; u <= 1100; u += 29) {
    const height = cityHeight(s, u);
    if (onRoadAt(s, u)) { roadPoints++; assert.equal(height, ROAD_LEVEL); if (waterAt(s, u)) { bridgePoints++; assert.equal(citydriverRoute.water(s, u), false); } }
    else if (waterAt(s, u)) { waterPoints++; assert.equal(height, WATER_LEVEL); assert.equal(citydriverRoute.water(s, u), true); }
    else { pavementPoints++; assert.equal(height, PAVEMENT_LEVEL); }
  }
  assert.ok(roadPoints > 100 && pavementPoints > 500, `${roadPoints} road, ${pavementPoints} pavement`);
  assert.ok(waterPoints > 20, `${waterPoints} water points`);
  assert.ok(bridgePoints > 0, 'no road crosses the water');
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
