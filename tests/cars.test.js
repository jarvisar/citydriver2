import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CARS, CAR_IDS, DEFAULT_CAR, ROUTE_PAINT, DRAG, carMeters, carStats } from '../src/cars.js';
import { createCar, DrivingController } from '../src/vehicle.js';
import { TRAFFIC_MODELS } from '../src/traffic-models.js';
import { JOURNEYS } from '../src/journeys.js';
import { PAINTS, DEFAULT_PAINT, isPaint, paintName } from '../src/car-paint.js';

const straightRoute = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0,
  bounds: () => [-100, 100],
};
const flatOut = (id, seconds = 90) => {
  const car = new DrivingController(straightRoute, {}, id);
  for (let i = 0; i < 60 * seconds; i++) car.update(1 / 60, { forward: true });
  return car;
};
// The speed ceiling can sit above the engine's equilibrium against air drag.
const cruisingSpeed = id => {
  const { topSpeed, acceleration } = carStats(id);
  return Math.min(topSpeed, Math.sqrt((acceleration - DRAG.rolling) / DRAG.air));
};

test('every car builds a solid, steerable model', () => {
  for (const id of CAR_IDS) {
    const model = createCar(id);
    assert.equal(model.wheels.length, id === 'rig' ? 6 : 4, `${id} needs its full set of wheels`);
    assert.equal(model.wheels.filter(wheel => wheel.front).length, 2, `${id} needs two steered wheels`);
    assert.equal(model.nightLights.length, id === 'formula' ? 1 : 2, `${id} needs its running lamps`);
    let meshes = 0;
    model.car.traverse(object => {
      if (!object.isMesh) return;
      meshes++;
      const position = object.geometry.attributes.position;
      assert.ok(position.count > 0, `${id} has an empty mesh`);
      assert.ok([...position.array].every(Number.isFinite), `${id} has a broken mesh`);
    });
    assert.ok(meshes >= 8, `${id} is missing bodywork`);
    // Wheels rest on the ground the car is placed on.
    const box = new THREE.Box3().setFromObject(model.car);
    assert.ok(Math.abs(box.min.y) < .05, `${id} floats or sinks: ${box.min.y}`);
    model.disposeModel();
  }
});

// The chooser-only cars are the ones allowed to break the tourer's mould: the
// two racers by being quicker at everything, the specials by being lopsided.
const RACERS = ['sports', 'formula'];
const SPECIALS = ['buggy', 'monster', 'hotrod', 'rig', 'micro'];
const TAXIS = CAR_IDS.filter(id => CARS[id].taxi);
const CHOOSER_ONLY = [...RACERS, ...SPECIALS, ...TAXIS];

test('every car can reverse from rest and after braking off road', () => {
  for (const id of CAR_IDS) for (const fps of [30, 60, 144]) for (const startingSpeed of [0, 12]) {
    const car = new DrivingController(straightRoute, {}, id);
    car.u = 8; car.speed = startingSpeed;
    for (let i = 0; i < fps * 8; i++) {
      car.u = 8; // Keep the whole trial off road, even with lane assistance.
      car.update(1 / fps, { brake: 1 });
    }
    assert.ok(car.speed < -3, `${id} could not reverse off road at ${fps} fps after starting at ${startingSpeed}`);
    car.disposeModel();
  }
});

test('the coastal wagon keeps the original handling and every car stays close to it', () => {
  const base = carStats(DEFAULT_CAR);
  assert.equal(base.topSpeed, 28); assert.equal(base.acceleration, 11.3); assert.equal(base.braking, 20);
  assert.equal(base.grip, 1); assert.equal(base.offRoad, 18.5);
  for (const id of CAR_IDS) {
    if (CHOOSER_ONLY.includes(id)) continue;
    const stats = carStats(id);
    assert.ok(Math.abs(stats.topSpeed / base.topSpeed - 1) < .1, `${id} top speed is too far from the original`);
    assert.ok(Math.abs(stats.acceleration / base.acceleration - 1) < .15, `${id} acceleration is too far from the original`);
    assert.ok(Math.abs(stats.grip - 1) < .12, `${id} handling is too far from the original`);
  }
  // The coupe is allowed to feel quick, and the racer quicker again.
  const sports = carStats('sports'), formula = carStats('formula');
  assert.ok(sports.topSpeed > base.topSpeed * 1.13 && sports.topSpeed < base.topSpeed * 1.25);
  assert.ok(sports.acceleration > base.acceleration * 1.15);
  assert.ok(formula.topSpeed > sports.topSpeed * 1.15, 'the racer should clear the coupe by a wide margin');
  assert.ok(formula.acceleration > sports.acceleration * 1.25 && formula.braking > sports.braking);
  assert.ok(formula.grip > sports.grip, 'slicks should turn in harder than the coupe');
  assert.equal(formula.topSpeed, 100); assert.equal(formula.acceleration, 60);
  const racer = flatOut('formula', 30);
  try {
    assert.ok(Math.abs(racer.speed - cruisingSpeed('formula')) < .01, 'the Formula car must reach its drag-limited cruising speed');
    assert.ok(racer.speed > 78 && racer.speed < 80, 'the faster Formula tuning must remain available');
  } finally { racer.disposeModel(); }
  // Leaving the tarmac costs every car a third of its top end, give or take,
  // and the order is the character: off-roaders keep most, racers least.
  // The specials sit outside that band on purpose, in both directions.
  const share = id => carStats(id).offRoad / carStats(id).topSpeed;
  const looseShare = { taxiFormula: [.55, .57], formula: [.19, .21], hotrod: [.5, .6], buggy: [.88, .95], monster: [.88, .95] };
  for (const id of CAR_IDS) {
    const [least, most] = looseShare[id] ?? [.6, .7];
    assert.ok(share(id) >= least && share(id) <= most, `${id} keeps ${(share(id) * 100).toFixed(0)}% off the tarmac`);
  }
  assert.ok(share('pickup') > share('van') && share('jungle') > share('hatchback'));
  assert.ok(share('formula') < share('sports'), 'slicks should be the worst of it');
  assert.ok(share('sports') < share(DEFAULT_CAR));
});

test('each special is the best in the garage at one thing and pays for it', () => {
  const road = CAR_IDS.filter(id => !CHOOSER_ONLY.includes(id));
  const best = (key, ids = road) => Math.max(...ids.map(id => carStats(id)[key]));
  const worst = (key, ids = road) => Math.min(...ids.map(id => carStats(id)[key]));
  const { buggy, monster, hotrod, rig, micro } = Object.fromEntries(SPECIALS.map(id => [id, carStats(id)]));
  // The buggy is the quickest thing across open ground, racers included.
  assert.ok(buggy.offRoad > best('offRoad', CAR_IDS.filter(id => !['buggy', ...TAXIS].includes(id))));
  assert.ok(buggy.acceleration > best('acceleration') && buggy.topSpeed < worst('topSpeed'));
  // The monster truck gives up the least when the road ends, and is clumsy on it.
  assert.ok(monster.offRoad > best('offRoad', [...road, ...RACERS]) && monster.topSpeed - monster.offRoad <= 2);
  assert.ok(monster.grip < worst('grip') && monster.braking < worst('braking'));
  // The hot rod beats the coupe in a straight line and nothing at a corner.
  const sports = carStats('sports');
  assert.ok(hotrod.topSpeed > sports.topSpeed && hotrod.acceleration > sports.acceleration && hotrod.topSpeed < carStats('formula').topSpeed);
  assert.ok(hotrod.grip < worst('grip') && hotrod.braking < worst('braking'));
  // The rig keeps up once it is rolling, and is last away and last to stop.
  assert.ok(Math.abs(rig.topSpeed / carStats(DEFAULT_CAR).topSpeed - 1) < .1);
  assert.ok(CAR_IDS.every(id => id === 'rig' || (carStats(id).acceleration > rig.acceleration && carStats(id).braking > rig.braking)));
  // The microcar is the slowest car here and the nimblest with number plates.
  assert.ok(CAR_IDS.every(id => id === 'micro' || carStats(id).topSpeed > micro.topSpeed));
  assert.ok(micro.grip > best('grip', [...road, 'sports']) && micro.grip < carStats('formula').grip && micro.braking > best('braking'));
  // Every one of them can still hold the top speed on its card against the air.
  for (const id of SPECIALS) assert.ok(Math.abs(flatOut(id, 60).speed - carStats(id).topSpeed) < .01, `${id} cannot reach its top speed`);
});

test('the specials are their own shapes, on their own wheels', () => {
  const bounds = id => { const model = createCar(id), box = new THREE.Box3().setFromObject(model.car); model.disposeModel(); return box; };
  for (const id of SPECIALS) {
    const box = bounds(id), { width, length, wheels, eye } = CARS[id].shape;
    // The collision box is the footprint the model actually has.
    assert.ok(Math.abs(box.max.x - box.min.x - width) < .12, `${id} is ${(box.max.x - box.min.x).toFixed(2)} m wide, not ${width}`);
    assert.ok(Math.abs(box.max.z - box.min.z - length) < .12, `${id} is ${(box.max.z - box.min.z).toFixed(2)} m long, not ${length}`);
    assert.ok(Math.abs(box.max.x + box.min.x) < .01, `${id} is not symmetrical`);
    assert.ok(wheels.front.z < 0 && wheels.rear.z > 0);
    // First person looks out from inside the model, above the wheels.
    assert.ok(eye[1] > wheels.front.radius * 2 - .3 && eye[1] < box.max.y && Math.abs(eye[2]) < length / 2, `${id} has its driver outside the car`);
    const car = new DrivingController(straightRoute, {}, id);
    assert.deepEqual(car.car.userData.driverEye.toArray(), eye);
    car.disposeModel();
  }
  const height = id => bounds(id).max.y;
  assert.ok(height('monster') > height('van') * 1.15 && height('rig') > height('monster'));
  assert.ok(height('micro') < height('hatchback') && height('hotrod') < height('sedan'));
  // Tall tyres turn slower than small ones at the same road speed.
  const car = new DrivingController(straightRoute, {}, 'hotrod');
  for (let i = 0; i < 30; i++) car.update(1 / 60, { forward: true });
  const [front, rear] = [car.wheels.find(wheel => wheel.front), car.wheels.find(wheel => !wheel.front)];
  assert.ok(Math.abs(rear.wheel.rotation.x) < Math.abs(front.wheel.rotation.x) * .7);
  car.disposeModel();
});

test('loose ground takes the speed instead of the game capping it', () => {
  // Open ground is past the ramp; anything nearer the tarmac costs less.
  const shoulder = (id, seconds, { at = 7, input = { forward: true } } = {}) => {
    const car = new DrivingController(straightRoute, {}, id);
    for (let i = 0; i < 60 * 90; i++) car.update(1 / 60, { forward: true });
    const entry = car.speed, trace = [];
    for (let i = 0; i < 60 * seconds; i++) { car.u = at; car.update(1 / 60, input); trace.push(car.speed); }
    return { car, entry, trace };
  };
  for (const id of CAR_IDS) {
    const { car, entry, trace } = shoulder(id, 12);
    const stats = carStats(id);
    // Full throttle balances on the off-road figure: the number on the card is
    // where the physics settles, not a limit clamped on top of it.
    assert.ok(Math.abs(trace.at(-1) - stats.offRoad) < .35, `${id} settled at ${trace.at(-1)}, not ${stats.offRoad}`);
    // It gets there over seconds, not in the frame that crosses the line.
    assert.ok(trace[0] > stats.offRoad + (entry - stats.offRoad) * .95,
      `${id} lost more than 5% of its excess road speed in one frame`);
    assert.ok(trace[60] > stats.offRoad + .5 && trace[60] < trace[10], `${id} does not ease down`);
    // Compare with actual braking at the same speed: air resistance contributes
    // to both, especially for the Formula's much higher cruising speed.
    const braking = new DrivingController(straightRoute, {}, id);
    try {
      for (let i = 0; i < trace.length; i++) {
        const before = i ? trace[i - 1] : entry;
        braking.speed = before; braking.update(1 / 60, { brake: 1 });
        assert.ok(trace[i] > braking.speed, `${id} decelerates harder than it brakes`);
        assert.ok(trace[i] <= before + 1e-9 && trace[i] >= stats.offRoad - .01, `${id} must ease down without undershooting`);
      }
    } finally { braking.disposeModel(); }
    // Back on the road, the full cruising speed is available again.
    car.u = 2.4;
    for (let i = 0; i < 60 * 30; i++) car.update(1 / 60, { forward: true });
    assert.ok(Math.abs(car.speed - cruisingSpeed(id)) < .35, `${id} could not recover its road speed`);
    car.disposeModel();
  }
  // The throttle is worth holding: a closed one keeps bleeding speed well past
  // the off-road top, where a held one stops there.
  assert.ok(shoulder('auto', 3, { input: {} }).trace.at(-1) < carStats('auto').offRoad * .75);
  // A brief excursion is a glance, not a penalty.
  const { entry, trace } = shoulder('formula', .2);
  assert.ok(entry - trace.at(-1) < (entry - carStats('formula').offRoad) * .25,
    `a fifth of a second off the road cost ${(entry - trace.at(-1)).toFixed(1)} m/s`);
});

test('the edge of the road is a ramp, not a line', () => {
  const stats = carStats('auto');
  // Two wheels on the verge costs real speed, but nothing like leaving.
  const settled = at => {
    const car = new DrivingController(straightRoute, {}, 'auto');
    for (let i = 0; i < 60 * 102; i++) { if (i > 60 * 90) car.u = at; car.update(1 / 60, { forward: true }); }
    return car.speed;
  };
  const verge = settled(5.35), open = settled(7);
  assert.ok(Math.abs(settled(4.6) - stats.topSpeed) < .35, 'the shoulder itself is still road');
  assert.ok(verge < stats.topSpeed - 1 && verge > open + 3, `the verge (${verge}) should sit between road and open ground`);
  assert.ok(Math.abs(open - stats.offRoad) < .35);
  // Riding the line is steady rather than flickering between two surfaces.
  const car = new DrivingController(straightRoute, {}, 'auto');
  for (let i = 0; i < 60 * 90; i++) car.update(1 / 60, { forward: true });
  const speeds = [];
  for (let i = 0; i < 120; i++) { car.u = 5.1 + Math.sin(i / 4) * .35; car.update(1 / 60, { forward: true }); speeds.push(car.speed); }
  assert.ok(Math.max(...speeds) - Math.min(...speeds) < .6, 'skimming the edge should not jitter the car');
  // What the surface does and what it sounds like come from the same number.
  car.u = 7; car.update(1 / 60, { forward: true });
  assert.equal(car.audioTelemetry.offRoad, 1);
  car.u = 4.8; car.update(1 / 60, { forward: true });
  assert.equal(car.audioTelemetry.offRoad, 0);
});

test('loose ground costs grip as well as speed', () => {
  // Same car, same speed, same lock: the only difference is the surface.
  const turnIn = at => {
    const car = new DrivingController(straightRoute, {}, 'auto');
    car.u = at; car.speed = 20; car.update(0, {});
    const heading = car.heading;
    for (let i = 0; i < 30; i++) { car.u = at; car.speed = 20; car.update(1 / 60, { right: 1 }); }
    return Math.abs(car.heading - heading);
  };
  const road = turnIn(2.4), verge = turnIn(5.35), open = turnIn(7);
  assert.ok(verge < road && open < verge, 'turn-in should fall away with the surface');
  // A quarter of it, so the car still answers the wheel out there.
  assert.ok(open > road * .7 && open < road * .8, `open ground turns in at ${(open / road * 100).toFixed(0)}% of the road`);
});

test('choosing a car keeps the drive going and swaps the model in the scene', () => {
  const scene = new THREE.Scene();
  const car = new DrivingController(straightRoute, { s: 400 }, 'auto');
  scene.add(car.car);
  for (let i = 0; i < 300; i++) car.update(1 / 60, { forward: true });
  const { s, u, distance } = car, previous = car.car;
  car.setCar('sports');
  assert.equal(car.carId, 'sports');
  assert.equal(car.s, s); assert.equal(car.u, u); assert.equal(car.distance, distance);
  assert.equal(previous.parent, null); assert.equal(car.car.parent, scene);
  assert.equal(scene.children.filter(child => child.isGroup).length, 1);
  assert.equal(car.stats.topSpeed, carStats('sports').topSpeed);
  // A slower car cannot inherit a faster one's speed.
  car.speed = 33; car.setCar('van');
  assert.ok(car.speed <= carStats('van').topSpeed);
  assert.equal(car.spec.width, CARS.van.shape.width);
});

const palette = car => {
  const colors = new Set();
  car.car.traverse(object => { if (object.isMesh) colors.add(object.material.color.getHexString()); });
  return [...colors].sort().join(' ');
};

test('a chosen car keeps its own paint and kit on every route', () => {
  for (const id of CAR_IDS.filter(id => id !== 'auto')) {
    const car = new DrivingController(straightRoute, {}, id), own = palette(car);
    for (const journey of Object.keys(JOURNEYS)) { car.setAppearance(journey); assert.equal(palette(car), own, `${id} changed with the scenery`); }
  }
  // Route Match is the one that still dresses for the scenery.
  const matching = new DrivingController(straightRoute, {}, 'auto'), paints = new Set();
  for (const journey of Object.keys(JOURNEYS)) { matching.setAppearance(journey); paints.add(palette(matching)); }
  assert.equal(paints.size, Object.keys(JOURNEYS).length);
});

test('the racers and specials stay in the chooser, and traffic keeps its own five shapes', () => {
  for (const id of CHOOSER_ONLY) {
    assert.ok(CARS[id], `the chooser needs the ${id} car`);
    assert.ok(!TRAFFIC_MODELS.some(spec => spec.name === CARS[id].shape.name), `${id} must not join traffic`);
    assert.ok(!Object.values(JOURNEYS).some(data => data.car === id), `no route may default to ${id}`);
  }
  assert.equal(DEFAULT_CAR, 'auto');
  for (const id of CAR_IDS) {
    assert.equal(carMeters(id).length, 4);
    for (const { level } of carMeters(id)) assert.ok(level >= 6 && level <= 100, `${id} meter out of range`);
  }
  // The meters are scaled for cars with number plates, so the racer pegs the
  // first three and shows what its slicks cost on the fourth. The coupe leads
  // everything that is still an ordinary tourer, and no bar sits at either stop.
  const [, , , looseMeter] = carMeters('formula');
  assert.ok(carMeters('formula').slice(0, 3).every(({ level }) => level === 100));
  assert.ok(looseMeter.label === 'Off road' && looseMeter.level < 80);
  for (const [index, meter] of carMeters('sports').entries()) {
    const road = CAR_IDS.filter(id => !['formula', ...TAXIS, ...SPECIALS].includes(id));
    assert.ok(road.every(id => carMeters(id)[index].level <= meter.level), `${meter.label} should top out at the coupe`);
  }
  for (const id of CAR_IDS.filter(id => !['formula', ...TAXIS].includes(id))) for (const { label, level } of carMeters(id)) {
    assert.ok(level > 6 && level < 100, `${id} is off the ${label} scale`);
  }
  assert.ok(carMeters('buggy')[3].level > 90 && carMeters('hotrod')[0].level > 90 && carMeters('micro')[2].level > 90);
});

test('the racer is an open-wheeler, not a road car with new numbers', () => {
  const formula = createCar('formula'), wagon = createCar('coast');
  const bounds = model => { const box = new THREE.Box3().setFromObject(model.car); return box.max.clone().sub(box.min); };
  const racer = bounds(formula), tourer = bounds(wagon);
  assert.ok(racer.z > tourer.z, 'the racer should be the longer car');
  assert.ok(racer.y < tourer.y * .6, 'and much lower');
  assert.equal(CARS.formula.shape.name, 'formula');
  assert.ok(Math.abs(racer.x - CARS.formula.shape.width) < .1, 'its exposed wheels set the collision width');
  formula.disposeModel(); wagon.disposeModel();
});

test('one colour dresses the whole garage and follows the car swap', () => {
  const blue = '#2f4a6d', wears = (car, color) => palette(car).includes(color.slice(1));
  const car = new DrivingController(straightRoute, {}, 'sports', blue);
  assert.ok(wears(car, blue), 'the chosen colour should reach the model');
  // It is the garage's colour, not the car's: every car picked up wears it.
  for (const id of CAR_IDS) {
    car.setCar(id, { paint: blue });
    assert.ok(wears(car, blue), `${id} ignored the garage colour`);
    assert.equal(car.paintColor, blue);
  }
  // And it stays on through a route change, kit and all.
  for (const journey of Object.keys(JOURNEYS)) { car.setAppearance(journey); assert.ok(wears(car, blue)); }
  // Clearing it hands every car the finish it arrived in back. The default
  // car's own finish is the route's, so put it back on the coast road first.
  car.setAppearance('coast');
  for (const id of CAR_IDS) {
    car.setCar(id); car.setPaint(null);
    assert.equal(car.paintColor, null);
    assert.ok(wears(car, CARS[id].paint), `${id} did not get its own colour back`);
  }
  // The default car goes back to dressing for the scenery, not to one colour.
  car.setCar('auto');
  const scenic = new Set();
  for (const journey of Object.keys(JOURNEYS)) { car.setAppearance(journey); scenic.add(palette(car)); }
  assert.equal(scenic.size, Object.keys(JOURNEYS).length);
  car.setAppearance('desert');
  assert.ok(wears(car, ROUTE_PAINT.desert));
});

test('the paint counter offers usable colours, and one swatch that is not one', () => {
  assert.ok(PAINTS.length >= 8);
  for (const { name, color } of PAINTS) {
    assert.ok(name && isPaint(color), `${name} is not a usable swatch`);
    assert.equal(paintName(color), name);
  }
  assert.equal(new Set(PAINTS.map(paint => paint.color)).size, PAINTS.length, 'no two swatches may share a colour');
  assert.equal(paintName('#010203'), null, 'a mixed colour has no catalogue name');
  // Default clears the garage rather than naming a colour, so it must never
  // read as one or collide with a swatch.
  assert.equal(isPaint(DEFAULT_PAINT), false);
  assert.ok(!PAINTS.some(paint => paint.color === DEFAULT_PAINT));
  for (const value of ['red', '#fff', '#12345g', '', null, 42]) assert.equal(isPaint(value), false);
});
