import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from './world/route.js';
import { citydriverRoute } from './world/city-route.js';
import { stableShadowDepth } from './world/shadow-depth.js';
import { CARS, DEFAULT_CAR, DRAG, ROUTE_PAINT, carEntry, carStats } from './cars.js';
import { createShapeCar } from './car-models.js';
import { wheelGeometry } from './traffic-models.js';
import { createFormulaCar } from './formula-model.js';
import { createSpecialCar } from './special-models.js';
import { createHelicopter, Helicopter } from './helicopter.js';
import { createPlane } from './plane-model.js';
import { Plane } from './plane.js';
import { createWalkerModel, Walker, WALKER_SPEC, WALKER_STATS } from './walker.js';
import { collisionImpulse, footprintMass, heft, leadingPoint, rock, rockFrom, SCENERY_SURFACE } from './impact.js';
import { steerCurve, steeringResponse, turnRate, corneringLoad, travelHeading } from './handling.js';
import { carProfile, tailPipes } from './car-profile.js';
import { RAINBOW_PAINT } from './car-paint.js';
import { Actor, actorBody } from './actors.js';
import { CarAir, GRAVITY } from './car-air.js';
import { Drift, DRIFT_MIN, BRAKE_SHARE, DRAG as DRIFT_DRAG, POWER as DRIFT_POWER, TURBOS } from './drift.js';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, flatShading: true, ...extra });
function box(group, size, location, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...location); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
}
// A slab cut to a side-view outline of [z, y] points, running across the car
// from x0 to x1.
function outline(group, points, [x0, x1], material) {
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(-z, y))), { depth: x1 - x0, bevelEnabled: false });
  geometry.rotateY(Math.PI / 2); geometry.translate(x0, 0, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
}
// Fixed parts of a group that share a material draw together; `keep` stays loose.
function mergeParts(group, keep) {
  const batches = new Map();
  for (const mesh of group.children) {
    if (mesh === keep || !mesh.isMesh) continue;
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push(mesh);
  }
  for (const [material, parts] of batches) {
    if (parts.length < 2) continue;
    const geometries = parts.map(part => { part.updateMatrix(); return part.geometry.applyMatrix4(part.matrix); });
    const loose = geometries.some(geometry => !geometry.index);
    const mesh = new THREE.Mesh(mergeGeometries(loose ? geometries.map(g => g.index ? g.toNonIndexed() : g) : geometries), material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    for (const part of parts) { group.remove(part); part.geometry.dispose(); }
    group.add(mesh);
  }
}
export function createClassicCar(entry = carEntry(DEFAULT_CAR)) {
  const car = new THREE.Group();
  const body = new THREE.Group(); car.add(body);
  const paint = mat('#d96143'); const roof = mat('#f5e8c8'); const glass = mat('#36545a', { roughness: .3, metalness: .16 });
  const tires = mat('#303b36'); const chrome = mat('#c9cbb6', { metalness: .2 });
  const front = mat('#fff5cf', { emissive: '#e9cc84', emissiveIntensity: .24 });
  const rear = mat('#8e3328', { emissive: '#b8220d', emissiveIntensity: .1 });
  const nightLights = [{ material: front, day: .24, night: 2.2 }, { material: rear, day: .1, night: 2.5 }];
  // A boxy tourer: the tub, a bonnet and a boot stepped up from it, and the
  // glasshouse under a cream hardtop.
  box(body, [2.05, .64, 3.9], [0, .9, 0], paint);
  box(body, [1.96, .24, 1.12], [0, 1.3, -1.32], paint);
  box(body, [1.92, .22, .82], [0, 1.28, 1.47], paint);
  box(body, [1.77, .81, 1.9], [0, 1.57, .12], glass);
  box(body, [1.89, .16, 2.03], [0, 2.04, .13], roof);
  for (const side of [-1, 1]) {
    // Pillars stop inside the hardtop, the end ones just proud of the glass.
    for (const z of [-.795, .23, 1.035]) box(body, [.09, .78, .09], [side * .895, 1.58, z], paint);
    box(body, [.085, .16, 2], [side * .92, 1.24, .14], paint);
    for (const z of [.06, .7]) box(body, [.05, .05, .2], [side * 1.04, 1.14, z], chrome);
    // A door mirror on a foot at the sill, its glass facing back.
    box(body, [.1, .1, .1], [side * .97, 1.34, -.68], paint);
    box(body, [.2, .13, .07], [side * 1.1, 1.42, -.68], paint);
    box(body, [.17, .1, .01], [side * 1.1, 1.42, -.64], glass);
    // Squared arches stand out over the tires, their feet just under the sill.
    for (const z of [-1.18, 1.21]) {
      const arch = [[z - .7, .575], [z - .46, 1.07], [z + .46, 1.07], [z + .7, .575], [z + .58, .575], [z + .37, .99], [z - .37, .99], [z - .58, .575]];
      outline(body, arch, side < 0 ? [-1.175, -.995] : [.995, 1.175], paint);
    }
    // Lamps sit in chrome bezels either side of the grille.
    box(body, [.48, .31, .02], [side * .64, 1.03, -1.955], chrome);
    box(body, [.42, .25, .04], [side * .64, 1.03, -1.965], front);
    box(body, [.33, .18, .05], [side * .72, 1.03, 1.97], rear);
  }
  box(body, [.74, .24, .02], [0, 1.03, -1.955], chrome);
  box(body, [.68, .18, .035], [0, 1.03, -1.9625], tires);
  box(body, [1.98, .14, .17], [0, .64, -1.97], chrome);
  box(body, [1.98, .14, .17], [0, .64, 1.97], chrome);
  const plate = box(body, [.6, .22, .03], [0, .91, 1.96], roof);
  // The plate still moves for the spare tire; accessories and animated
  // wheels stay separate.
  mergeParts(body, plate);
  // One roof or tail accessory per wagon trim (see cars.js). The rack's bars
  // stand on feet at the hardtop's edges, and every load rests on them, or on
  // the hardtop between them.
  const RACK = 2.24;
  const rack = new THREE.Group(); rack.name = 'roof-rack'; body.add(rack);
  for (const z of [-.48, .75]) {
    box(rack, [1.72, .09, .12], [0, RACK - .045, z], tires);
    for (const side of [-1, 1]) box(rack, [.1, .045, .15], [side * .8, 2.1325, z], tires);
  }
  mergeParts(rack);
  const surfboard = new THREE.Group(); surfboard.name = 'surfboard'; body.add(surfboard);
  const boardShape = new THREE.Shape();
  boardShape.moveTo(0, -1.65); boardShape.quadraticCurveTo(.5, -1.35, .47, .65); boardShape.quadraticCurveTo(.43, 1.55, 0, 1.65); boardShape.quadraticCurveTo(-.43, 1.55, -.47, .65); boardShape.quadraticCurveTo(-.5, -1.35, 0, -1.65);
  const board = new THREE.Mesh(new THREE.ExtrudeGeometry(boardShape, { depth: .11, bevelEnabled: false, curveSegments: 3 }), roof);
  board.rotation.x = Math.PI / 2; board.position.set(.14, RACK + .11, .04); board.castShadow = true; surfboard.add(board);
  box(surfboard, [.065, .02, 2.85], [.14, RACK + .115, .02], paint);
  // The spare hangs on the tail, clear of the lamps and the plate.
  const spare = new THREE.Group(); spare.name = 'desert-spare'; spare.position.set(0, 1.22, 2.095); body.add(spare);
  const spareTire = new THREE.Mesh(new THREE.CylinderGeometry(.48, .48, .28, 12), tires);
  spareTire.rotation.x = Math.PI / 2; spareTire.castShadow = true; spare.add(spareTire);
  const spareHub = new THREE.Mesh(new THREE.CylinderGeometry(.23, .23, .295, 10), roof);
  spareHub.rotation.x = Math.PI / 2; spare.add(spareHub);
  const roofBox = new THREE.Group(); roofBox.name = 'alpine-roof-box'; body.add(roofBox);
  // The box's nose is chamfered top and bottom, like a real one's.
  outline(roofBox, [[-.8, RACK + .07], [-.66, RACK], [1, RACK], [1.06, RACK + .05], [1.06, RACK + .3], [-.74, RACK + .3], [-.8, RACK + .25]], [-.62, .62], tires);
  box(roofBox, [1.16, .12, 1.72], [0, RACK + .36, .13], mat('#536774'));
  for (const x of [-.4, .4]) box(roofBox, [.07, .025, 1.74], [x, RACK + .4325, .13], chrome);
  mergeParts(roofBox);
  // Round loads lie across the car; `open` leaves a strap's band without ends.
  const across = (group, radius, length, [x, y, z], material, segments, open = false) => {
    const part = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments, 1, open), material);
    part.rotation.z = Math.PI / 2; part.position.set(x, y, z); part.castShadow = true; group.add(part);
  };
  // Two cases on the front bar, a rolled tent strapped to the back one.
  const cargo = new THREE.Group(); cargo.name = 'jungle-cargo'; body.add(cargo);
  const olive = mat('#5f6b3f'), canvas = mat('#c9b48b');
  for (const x of [-.52, .52]) box(cargo, [.44, .34, .3], [x, RACK + .17, -.55], olive);
  across(cargo, .19, 1.5, [0, RACK + .19, .75], canvas, 8);
  for (const x of [-.45, .45]) across(cargo, .2, .05, [x, RACK + .19, .75], olive, 8, true);
  mergeParts(cargo);
  // A round bale lies on the hardtop between the bars, strapped round.
  const bale = new THREE.Group(); bale.name = 'plains-bale'; body.add(bale);
  const straw = mat('#d8b566'), cutEnd = mat('#b8964f'), strap = mat('#5e4c33');
  across(bale, .42, 1.4, [0, 2.515, .135], straw, 10);
  for (const side of [-1, 1]) {
    across(bale, .36, .03, [side * .7, 2.515, .135], cutEnd, 10);
    across(bale, .2, .03, [side * .72, 2.515, .135], straw, 10);
    across(bale, .435, .06, [side * .4, 2.515, .135], strap, 10, true);
  }
  mergeParts(bale);
  // A bicycle stands in a wheel tray across the bars, held by an arm at its
  // down tube, for the city commute.
  const bike = new THREE.Group(); bike.name = 'city-bike'; body.add(bike);
  const frameMat = mat('#c9453f'), rubber = mat('#2f3336');
  const axle = RACK + .355;
  box(bike, [.12, .045, 1.64], [0, RACK + .0225, .02], rubber);
  for (const z of [-.58, .58]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(.3, .035, 5, 14), rubber);
    wheel.rotation.y = Math.PI / 2; wheel.position.set(0, axle, z); wheel.castShadow = true; bike.add(wheel);
  }
  const tube = (a, b, radius = .03, material = frameMat) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 5), material);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    mesh.position.copy(from.add(to).multiplyScalar(.5)); mesh.castShadow = true; bike.add(mesh);
  };
  // Fork and stem, top tube, down tube, seat tube and post, stays.
  const bracket = [0, axle - .04, .08], cluster = [0, axle + .5, .26], rearHub = [0, axle, .58];
  tube([0, axle, -.58], [0, axle + .6, -.316]); tube([0, axle + .5, -.36], cluster); tube([0, axle + .42, -.395], bracket);
  tube(bracket, [0, axle + .62, .3]); tube(cluster, rearHub); tube(bracket, rearHub);
  box(bike, [.09, .04, .22], [0, axle + .64, .27], rubber); box(bike, [.44, .035, .035], [0, axle + .6, -.316], rubber);
  across(bike, .1, .02, [.045, axle - .04, .08], chrome, 10);
  tube([.05, RACK + .045, -.16], [.05, axle + .22, -.16], .022, rubber); box(bike, [.1, .07, .07], [.025, axle + .19, -.158], rubber);
  mergeParts(bike);
  // One draw per wheel (see wheelGeometry)
  const wheels = [], wheelMaterial = mat('#ffffff', { vertexColors: true });
  for (const x of [-1.02, 1.02]) for (const z of [-1.18, 1.21]) {
    const pivot = new THREE.Group(); pivot.position.set(x, .48, z); car.add(pivot);
    const tire = new THREE.CylinderGeometry(.48, .48, .28, 12), hub = new THREE.CylinderGeometry(.23, .23, .295, 10);
    const wheel = new THREE.Mesh(wheelGeometry(tire, hub, '#303b36', '#f5e8c8'), wheelMaterial); wheel.rotation.z = Math.PI / 2; wheel.castShadow = true; pivot.add(wheel);
    tire.dispose(); hub.dispose();
    wheels.push({ pivot, wheel, hub: wheel, front: z < 0 });
  }
  // Reuse the model and its materials so repeated route changes stay bounded.
  // A chosen trim ignores the route; the default car follows it. A garage color
  // outranks both, so a repainted car keeps that color wherever it drives.
  let customPaint = null, kitJourney = 'coast';
  function applyTrim(journey) {
    kitJourney = journey;
    const kit = entry.trim ?? journey;
    paint.color.set(customPaint ?? ROUTE_PAINT[kit] ?? ROUTE_PAINT.coast);
    surfboard.visible = kit === 'coast'; spare.visible = kit === 'desert'; roofBox.visible = kit === 'snow'; cargo.visible = kit === 'jungle'; bale.visible = kit === 'plains'; bike.visible = kit === 'city';
    rack.visible = surfboard.visible || roofBox.visible || cargo.visible || bale.visible || bike.visible;
    // With the spare on, the plate drops to the bumper beside it, under a lamp.
    plate.position.set(spare.visible ? -.69 : 0, spare.visible ? .825 : .91, 1.96);
  }
  function paintCar(color) { customPaint = color || null; applyTrim(kitJourney); }
  applyTrim('coast');
  car.traverse(stableShadowDepth);
  function disposeModel() {
    const materials = new Set();
    car.traverse(object => { if (object.isMesh) { object.geometry.dispose(); materials.add(object.material); } });
    for (const material of materials) material.dispose();
  }
  return { car, body, wheels, nightLights, applyTrim, paintCar, disposeModel };
}

export function createCar(id = DEFAULT_CAR) {
  const entry = carEntry(id);
  if (entry.kind === 'formula') return createFormulaCar(entry);
  if (entry.kind === 'special') return createSpecialCar(entry);
  if (entry.kind === 'helicopter') return createHelicopter(entry);
  if (entry.kind === 'plane') return createPlane(entry);
  return entry.kind === 'classic' ? createClassicCar(entry) : createShapeCar(entry);
}
// Every machine the player drives or flies knocks over trees and bus shelters (see LooseProps)
const BREAKS = ['tree', 'shelter'];
// Each kind of car's flame points (see tailPipes), worked out once a visit
const TAILS = new Map();
// Who flies each kind of flying machine (see fit)
const PILOTS = { helicopter: Helicopter, plane: Plane };

// Ground steeper than this is a cliff face rather than a hillside.
const STEEP = 1.2;
// The ground has to be sound this far round the car's middle, a little over half its
// length, so whichever way it faces no corner hangs over a quay or a cliff.
const FOOTING = 2.5;
export const impassable = ground => ground.blocked;
// How fast the tires take back what a collision knocked into the car: the
// slide within about half a second, the turn a little sooner. The fastest a
// blow can set the car turning, in radians a second.
const SLIDE_GRIP = 5, SPIN_GRIP = 8, SPIN_MOST = 5;
// A blow slower than this (m/s where they meet) is a touch: no thud or shake.
const TOUCH = 1;
// What the runs count as a crash: a blow that takes CRASH m/s off the car's
// speed (nose into a wall, a tree or the back of a car), or changes its
// velocity by HARD m/s any way (T-boned). A scrape or trading paint turns the
// car more than it slows it, so a 20° graze at 25 m/s doesn't count. One hit
// can land as blows a frame or two apart (a car met, then met again as it is
// shoved), so the speed lost is summed, fading over CRASH_FADE seconds.
const CRASH = 6, HARD = 9, CRASH_FADE = .1;
// Pushing another car, the engine can only drive as hard as the tires grip
// (m/s²), however quick the car is, so weight decides who moves whom: a truck
// bulldozes a hatchback, the taxi shoves one aside, and a light racer cannot
// shift a van. PUSHING is how long, in seconds, a touch counts as a push.
const PUSH_GRIP = 9, PUSHING = .15;
// How far the body leans, in radians, when the tires are giving everything.
const LEAN = .105;
// How far, in meters, render() may carry the last step forward, so that a
// collision correction (the one step that is not smooth motion) cannot throw
// the body ahead of itself.
const LEAD_REACH = .5;
// The share of the game's air drag a car in the air feels
const AIR_DRAG = .12;
// What a pose carries besides where the car is and which way it faces
const POSE_KEYS = ['bodyPitch', 'bodyRoll', 'bodyLift', 'wheelSpin', 'steer', 'slip'];

export class ActorMotion {
  // (`model`: one createCar already built, to drive instead of building another)
  constructor(route = citydriverRoute, state = {}, carId = DEFAULT_CAR, paint = null, model = null, actor = null) {
    const walking = carId === WALKER_SPEC.name;
    this.actor = actor ?? new Actor(actorBody(state), { source: walking ? 'person' : 'garage', kind: walking ? 'person' : 'vehicle' });
    this.actor.motion = this;
    this.route = route;
    this.freeDriving = false;
    this.rainbowHue = 0; this.rainbowColor = new THREE.Color();
    this.night = false; this.journeyId = 'coast';
    // A flying machine's pilot stays with it through changes of control
    // (see helicopter.js and plane.js); `airborne` is true once it is up
    // above the traffic, and `scenery` (the world's chunks) holds the roofs
    // it can set down on. A person has a Walker (see walker.js), and
    // `props` (LooseProps) takes
    // them when a car knocks them over. `traffic` (CityTraffic) has the cars
    // a car can come down on (see CarAir).
    this.pilot = null; this.airborne = false; this.scenery = null; this.walker = null; this.props = null; this.traffic = null;
    // A car on its wheels goes up and down with what it drives over, and off
    // a ramp into the air (see CarAir), and drifts (see Drift) as
    // `driftMode` has it, held or tapped. `events` is what happened, for the
    // game to hear (see drain)
    this.carAir = null; this.drift = null; this.driftMode = 'hold'; this.events = []; this.crashSeen = 0;
    // (whether the player has the jetpack on foot: the game sets it from the fleet)
    this.jetpack = true;
    this.fit(walking ? carId : CARS[carId] ? carId : DEFAULT_CAR, model ?? (walking ? createWalkerModel() : createCar(carId)), { paint });
    this.s = state.s ?? 24; this.u = state.u ?? 2.4; this.speed = 0; this.steer = 0; this.heading = state.heading ?? route.frame(this.s).angle;
    this.distance = state.distance ?? 0; this.pitch = 0; this.roll = 0;
    this.reverseDelay = 0; this.driftAmount = 0; this.driftDirection = 0; this.drifting = false; this.boosting = false; this.slip = 0;
    // Where the car's weight is: -1 over the back under power, +1 over the nose on the brakes.
    this.weight = 0; this.load = 0;
    this.bodyPitch = 0; this.bodyRoll = 0; this.bodyLift = 0; this.wheelSpin = 0;
    // Motion a collision leaves the car with that its own drive did not make,
    // and the swing it leaves the body with.
    this.knock = { x: 0, z: 0, spin: 0 }; this.jolt = { pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 };
    // The turn the driver is making, and how shaken the view is (0 to 1).
    this.yawRate = 0; this.trauma = 0; this.lost = 0; this.pushing = 0;
    this.audioTelemetry = { speed: 0, throttle: 0, brake: 0, offRoad: 0, handbrake: 0, impact: 0, impactSerial: 0, crashSerial: 0, scrape: 0, boost: 0, bump: 0, bumpSerial: 0, step: 0, stepSerial: 0 };
    const pose = () => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), bodyPitch: 0, bodyRoll: 0, bodyLift: 0, wheelSpin: 0, steer: 0, slip: 0 });
    this.previousPose = pose(); this.currentPose = pose();
    this.previousPose.position = this.actor.body.previousPosition; this.previousPose.quaternion = this.actor.body.previousQuaternion;
    this.currentPose.position = this.actor.body.position; this.currentPose.quaternion = this.actor.body.quaternion;
    if (walking) { this.spec = WALKER_SPEC; this.stats = WALKER_STATS; this.walker = new Walker(this, this.model); this.walker.takeOver(); }
    this.update(0, {});
  }
  // Model setup belongs to this actor's lifetime, not a change of driver.
  fit(carId, model, { paint = null } = {}) {
    // (the rotors, a propeller and whatever else a flying machine turns stay
    // with its model, so one stepped out of is flown again as it was)
    this.carId = carId; this.rotors = model.rotors ?? null;
    this.actor.addModel('driving', model); this.actor.show('driving');
    this.model = { ...model, car: this.actor.visual };
    for (const [key, value] of Object.entries(model)) if (key !== 'car' && key !== 'disposeModel') this[key] = value;
    const entry = carEntry(carId);
    const Pilot = PILOTS[entry.kind];
    this.pilot = Pilot && this.rotors ? new Pilot(this, this.rotors) : null; this.walker = null; this.airborne = false;
    const { width, length, cabin, cabinZ, cabinY = 1.22, drop = 0, eye, chaseLift = 0, door, seat, exit } = entry.shape;
    // (only a car on its wheels: a flying machine and someone on foot keep their own height)
    const wheeled = !this.pilot && carId !== WALKER_SPEC.name;
    this.carAir = wheeled ? this.carAir ?? new CarAir(this) : null;
    this.carAir?.fit(model.wheels, width, length);
    this.drift = wheeled ? this.drift ?? new Drift(this) : null;
    this.drift?.reset();
    this.bodyBase = model.body?.position.y ?? 0;
    // Center the view just in front of the windshield for every body shape.
    // Traffic-shaped cabins slope back by .24 m at the top of the glass, and a
    // car that is not cut from a road-car cabin says where its driver sits.
    const glassSlope = entry.kind === 'classic' ? 0 : .24 * .7;
    this.car.userData.driverEye = eye
      ? new THREE.Vector3(...eye)
      : new THREE.Vector3(0, cabinY + cabin[1] * .7 - drop, cabinZ - cabin[2] / 2 + glassSlope - .18);
    this.car.userData.chaseLift = chaseLift;
    // (its shape along its length, for loose pieces to meet: see carProfile)
    const profile = carProfile(model.car, length);
    // (and for someone getting in and out, where its door is, meters ahead of
    // its middle, how high its seat, and where to step down: see OnFoot)
    // (and where its boost flames come out, the same for every car of a kind)
    const tail = wheeled ? TAILS.get(carId) ?? TAILS.set(carId, tailPipes(model.body)).get(carId) : null;
    this.spec = this.drivingSpec = { name: carId, width, length, height: profile.height, profile, tail, mass: entry.mass ?? footprintMass(width, length), breaks: BREAKS, door, seat, exit };
    this.stats = carStats(carId);
    this.setLights(Number(this.night)); this.setAppearance(this.journeyId); this.setPaint(paint);
    Object.assign(model.car.userData, this.car.userData);
  }
  disposeModel() { this.actor.dispose(); }
  // A garage color, the rainbow, or null for the finish the car left the factory in.
  setPaint(color) { this.paintColor = color ?? null; this.updatePaint(); }
  get rainbow() { return this.paintColor === RAINBOW_PAINT; }
  updatePaint(dt = 0) {
    if (this.rainbow) {
      // A smooth three-second RGB loop
      this.rainbowHue = (this.rainbowHue + dt / 2.8) % 1;
      this.rainbowColor.setHSL(this.rainbowHue, 1, .5, THREE.SRGBColorSpace);
      this.paintCar(this.rainbowColor);
    } else this.paintCar(this.paintColor);
  }
  reset() {
    this.pilot?.land(); this.carAir?.reset(); this.drift?.reset();
    this.speed = 0; this.steer = 0; this.weight = 0; this.load = 0; this.knock.x = this.knock.z = this.knock.spin = 0;
    Object.assign(this.jolt, { pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 }); this.yawRate = 0; this.trauma = 0; this.lost = 0; this.pushing = 0; this.audioTelemetry.scrape = 0;
    // A generated street network has no lane at u = 2.4: settle into the nearest lane instead.
    if (this.route.nearestLane) { const pose = this.route.nearestLane(this.s, this.u, this.heading); this.s = pose.s; this.u = pose.u; this.heading = pose.heading; }
    else { this.u = 2.4; this.heading = this.route.frame(this.s).angle; }
    // (someone on foot stands there, even if they were up on a roof)
    this.walker?.takeOver();
    this.update(0, {});
  }
  toggleFreeDriving() {
    this.freeDriving = !this.freeDriving;
    if (!this.freeDriving) this.reset();
    return this.freeDriving;
  }
  // Lamps from daytime (0) to night (1); a storm runs them part way up.
  setLights(level) { this.night = level; for (const light of this.nightLights) light.material.emissiveIntensity = light.day + (light.night - light.day) * level; }
  setAppearance(journey) { this.journeyId = journey; this.applyTrim(journey); this.updatePaint(); }
  setRoute(route, state = {}) {
    this.route = route; this.s = state.s ?? 24; this.distance = state.distance ?? 0;
    if (state.u !== undefined) this.u = state.u;
    if (state.heading !== undefined) this.heading = state.heading;
    this.pitch = 0; this.roll = 0; this.bodyPitch = 0; this.bodyRoll = 0; this.reset();
  }
  copyPose(target, source) {
    target.position.copy(source.position); target.quaternion.copy(source.quaternion);
    for (const key of POSE_KEYS) target[key] = source[key];
  }
  // What happened to the car since last asked (a jump landed, a splash: see CarAir)
  drain() { const events = this.events; this.events = []; return events; }
  // Which way the car is really going: its own drive, and any knock on top.
  get velocity() { if (this.pilot) return this.pilot.velocity; if (this.walker) return this.walker.velocity; const heading = this.slideHeading ?? this.heading; return { x: Math.sin(heading) * this.speed + this.knock.x, z: -Math.cos(heading) * this.speed + this.knock.z }; }
  // A move in world meters, in the road's terms, as a step of driving is.
  shift(dx, dz) {
    const frame = this.route.frame(this.s);
    this.s += (dx * Math.sin(frame.angle) - dz * Math.cos(frame.angle)) / frame.scale;
    this.u += dx * Math.cos(frame.angle) + dz * Math.sin(frame.angle);
  }
  // A slide and a turn fade as the tires bite, and then are gone altogether.
  // In the air (`grip` false) there is nothing to bite, and a knock carries on.
  carryKnock(dt, grip = true) {
    const knock = this.knock;
    if (!knock.x && !knock.z && !knock.spin) return;
    this.shift(knock.x * dt, knock.z * dt); this.heading += knock.spin * dt;
    if (!grip) return;
    const slide = Math.exp(-dt * SLIDE_GRIP);
    knock.x *= slide; knock.z *= slide; knock.spin *= Math.exp(-dt * SPIN_GRIP);
    if (Math.hypot(knock.x, knock.z) < .05 && Math.abs(knock.spin) < .01) knock.x = knock.z = knock.spin = 0;
  }
  // A blow: a change of velocity and of turn (see impact.js), `impact` m/s
  // where the two met and `scrape` m/s of sliding past. The part along the
  // car's travel becomes speed, though never through rest into the other
  // direction, and the rest is a slide and a turn that carryKnock wears off.
  // The body rocks with it (see rock in impact.js).
  strike(dvx, dvz, spin, impact, scrape = 0) {
    if (this.pilot) { this.pilot.strike(dvx, dvz, spin, impact, scrape); return; }
    if (this.walker) { this.walker.strike(dvx, dvz, spin, impact); return; }
    if (impact > TOUCH) {
      this.audioTelemetry.impact = impact; this.audioTelemetry.impactSerial++;
      this.trauma = Math.min(1, this.trauma + (impact - TOUCH) / 28);
    }
    const v = this.velocity, moving = Math.hypot(v.x, v.z), lost = this.lost;
    if (moving > 0) this.lost += clamp(-(dvx * v.x + dvz * v.z) / moving, 0, moving);
    if ((lost < CRASH && this.lost >= CRASH) || Math.hypot(dvx, dvz) >= HARD) this.audioTelemetry.crashSerial++;
    this.audioTelemetry.scrape = Math.max(this.audioTelemetry.scrape, scrape);
    const heading = this.slideHeading ?? this.heading, cos = Math.cos(heading), sin = Math.sin(heading), along = dvx * sin - dvz * cos;
    const speed = this.speed < 0 ? Math.min(0, this.speed + along) : Math.max(0, this.speed + along), taken = speed - this.speed;
    this.knock.x += dvx - sin * taken; this.knock.z += dvz + cos * taken;
    this.knock.spin = clamp(this.knock.spin + spin, -SPIN_MOST, SPIN_MOST);
    this.speed = speed; this.audioTelemetry.speed = speed;
    const bodyCos = Math.cos(this.heading), bodySin = Math.sin(this.heading);
    rockFrom(this.jolt, dvx * bodySin - dvz * bodyCos, dvx * bodyCos + dvz * bodySin);
  }
  // Where the car stands now, after a collision has moved it: the one step
  // that is not smooth motion.
  placeAfterCollision() {
    if (this.pilot) { this.pilot.pose(); return; }
    if (this.walker) { this.walker.pose(); return; }
    // (at the height it is at: on a ramp, or in the air)
    const p = this.route.position(this.s, this.u, Number.isFinite(this.y) ? this.y : undefined);
    this.groundedPosition.set(p.x, p.y, p.z);
    this.currentPose.position.copy(this.groundedPosition);
    this.currentPose.bodyPitch = this.bodyPitch + this.jolt.pitch; this.currentPose.bodyRoll = this.bodyRoll + this.jolt.roll;
    this.render(0);
  }
  // Another car gives way as far as its weight allows. This one is put back
  // outside it and takes its share of the blow (see impact.js and strike),
  // and while `pushing` a car its engine holds to its tires' grip (a loose
  // piece of furniture is no car to push: see LooseProps).
  resolveTrafficCollision(dx, dz, dvx = 0, dvz = 0, spin = 0, impact = Math.hypot(dvx, dvz), scrape = 0, pushing = true) {
    if (this.walker) { this.walker.resolveTrafficCollision(dx, dz, dvx, dvz, spin, impact); return; }
    this.strike(dvx, dvz, spin, impact, scrape); if (pushing) this.pushing = PUSHING;
    this.shift(dx, dz);
    if (!this.freeDriving) this.u = clamp(this.u, ...this.route.bounds(this.s));
    this.placeAfterCollision();
  }
  // How the car moves as a body, for a blow to read: its velocity, the turn
  // both the tires and any earlier knock are giving it, and what it weighs
  // against another car (see heft).
  motion() {
    const p = this.groundedPosition, v = this.velocity;
    return { x: p.x, z: p.z, heading: this.heading, halfWidth: this.spec.width / 2, halfLength: this.spec.length / 2, mass: heft(this.spec.mass, true), vx: v.x, vz: v.z, spin: this.yawRate + this.knock.spin };
  }
  // Standing scenery gives nothing. The car is put back outside it along the
  // contact normal and takes the whole blow at `point`, where they touch: a
  // little bounce off the face, a scrape along it, and a turn when the blow
  // lands away from its middle. A corner clipped at speed swings the car
  // round; a glancing blow turns the nose back along the wall, so the car
  // slides off it instead of grinding to a halt against it.
  resolveSceneryCollision(nx, nz, depth, dt, point = null) {
    if (this.pilot) { this.pilot.resolveSceneryCollision(nx, nz, depth, point); return; }
    if (this.walker) { this.walker.resolveSceneryCollision(nx, nz, depth); return; }
    const car = this.motion(), normal = { x: nx, z: nz };
    point ??= leadingPoint(car, normal);
    const blow = collisionImpulse(car, { x: point.x, z: point.z, vx: 0, vz: 0, mass: Infinity }, normal, point, SCENERY_SURFACE);
    if (blow) this.strike(blow.a.x, blow.a.z, blow.a.spin, blow.closing, blow.slide);
    // Away from the road (s, u) is not a rigid frame, so the push is carried
    // back through the route's own mapping rather than the road's angle.
    const at = (s, u) => this.route.position(s, u, 0), p = at(this.s, this.u), a = at(this.s + 1, this.u), b = at(this.s, this.u + 1);
    const sx = a.x - p.x, sz = a.z - p.z, ux = b.x - p.x, uz = b.z - p.z, det = sx * uz - sz * ux, push = depth + .005;
    const s = this.s + (nx * uz - nz * ux) * push / det, u = this.u + (sx * nz - sz * nx) * push / det;
    // A trunk on a quay must not shove the car over the edge behind it (in
    // the air, there is no edge to keep it from).
    if (this.aloft || !impassable(this.ground(s, u)) || impassable(this.ground(this.s, this.u))) { this.s = s; this.u = u; }
    if (!this.freeDriving) this.u = clamp(this.u, ...this.route.bounds(this.s));
    this.placeAfterCollision();
  }
  // Whether the player's machine clears a standing thing rather than hitting
  // it (see collideScenery): a flying machine over it, a car up on a ramp or
  // jumping over it (`contact`, where they would meet: see CarAir.passes), or
  // someone on foot on a roof, standing on it or above it. A car sinking in
  // the harbor meets nothing more.
  passes(solid, contact = null) {
    if (this.pilot) return this.pilot.passes(solid);
    if (this.walker) return this.walker.passes(solid);
    return Boolean(this.sinking || this.carAir?.passes(solid, contact));
  }
  // The ground under the car: its height, and its fall along and across the
  // road over about a wheelbase and a track. Free driving also asks whether
  // the car may stand here: not on water or a cliff face, nor with either of
  // them within its own reach. The road itself is always sound.
  ground(s, u) {
    const terrainHeight = this.route.height, height = terrainHeight(s, u);
    const ground = { s, u, height, slope: (terrainHeight(s + 1.5, u) - terrainHeight(s - 1.5, u)) / 3, lateralSlope: (terrainHeight(s, u + .7) - terrainHeight(s, u - .7)) / 1.4, blocked: false };
    if (!this.freeDriving) return ground;
    const unsound = (s, u, h) => Boolean(this.route.water?.(s, u, h)) || Math.abs(h - height) > STEEP * FOOTING;
    ground.blocked = Math.hypot(ground.slope, ground.lateralSlope) > STEEP || unsound(s, u, height)
      || Math.abs(u) + FOOTING > 7 && [[FOOTING, 0], [-FOOTING, 0], [0, FOOTING], [0, -FOOTING]].some(([ds, du]) => unsound(s + ds, u + du, terrainHeight(s + ds, u + du)));
    return ground;
  }
  // `lead` is how far past the last completed simulation step this display
  // frame falls, from 0 to a whole step. Carrying the last step forward by it
  // puts the car where it is now; interpolating between the last two steps
  // instead would show it a whole step in the past, every frame, for nothing.
  render(lead = 0, origin = 0) {
    const a = this.previousPose, b = this.currentPose;
    const reach = a.position.distanceTo(b.position);
    const t = 1 + clamp(lead, 0, 1) * (reach > LEAD_REACH ? LEAD_REACH / reach : 1);
    // Project in global coordinates, then rebase once for the entire display frame.
    this.car.position.lerpVectors(a.position, b.position, t); this.car.position.z += origin;
    this.car.quaternion.slerpQuaternions(a.quaternion, b.quaternion, t);
    this.car.userData.slip = THREE.MathUtils.lerp(a.slip, b.slip, t);
    this.body.rotation.x = THREE.MathUtils.lerp(a.bodyPitch, b.bodyPitch, t);
    this.body.rotation.z = THREE.MathUtils.lerp(a.bodyRoll, b.bodyRoll, t);
    // (riding up on its springs in the air, squatting into a landing)
    if (this.carAir) this.body.position.y = this.bodyBase + THREE.MathUtils.lerp(a.bodyLift, b.bodyLift, t);
    const steer = THREE.MathUtils.lerp(a.steer, b.steer, t);
    const spin = THREE.MathUtils.lerp(a.wheelSpin, b.wheelSpin, t);
    for (const w of this.wheels) {
      if (w.front) w.pivot.rotation.y = -steer * .38;
      w.wheel.rotation.x = w.hub.rotation.x = spin * (w.spinRatio ?? 1);
    }
    this.pilot?.animate(spin); this.walker?.animate(spin, origin);
  }
  update(dt, input) {
    if (this.rainbow) this.updatePaint(dt);
    if (this.pilot) { this.pilot.update(dt, input); return; }
    if (this.walker) { this.walker.update(dt, input); return; }
    this.copyPose(this.previousPose, this.currentPose);
    const { frame: roadFrame, position: positionAt } = this.route;
    const stats = this.stats;
    // Off its wheels the tires have nothing to push against (see CarAir), and
    // sinking in the harbor nothing answers the controls
    const aloft = this.aloft && dt > 0;
    if (this.sinking) input = {};
    const touch = aloft ? null : input.touchDrive;
    const arcade = Boolean(this.arcade);
    const forward = clamp(Number(input.forward) || 0, 0, 1); const brake = clamp(Number(input.brake) || 0, 0, 1);
    // Boost needs the gas. A taxi run meters it (TaxiRun.controls); free drive
    // passes the button straight through.
    const boosting = Boolean(input.boost) && (forward > 0 || touch?.amount > .1);
    const steering = touch ? 0 : clamp((Number(input.right) || 0) - (Number(input.left) || 0), -1, 1);
    // Quick response is independent of turning strength: do not hide sharp
    // steering behind a slow input filter. The precision curve is applied to
    // what the player asked for, so a keypress reaches full lock in about
    // 30 ms; release and countersteer are quicker still.
    this.steer = steeringResponse(this.steer, steerCurve(steering), dt, stats, this.speed);
    this.reverseDelay = arcade && brake && !touch && dt > 0 ? Math.max(0, this.reverseDelay - dt) : 0;
    // How far off the tarmac the car is: 0 on the road, 1 out on open ground,
    // ramped across about half a car's width so putting two wheels on the verge
    // costs a fraction of what leaving altogether does. The same number sets
    // the surface's resistance, grip and sound.
    const looseness = aloft ? 0 : this.route.looseness?.(this.s, this.u) ?? clamp((Math.abs(this.u) - 4.8) / 1.1, 0, 1);
    // Loose ground takes the speed rather than the game capping it: resistance
    // that full throttle balances at the off-road figure, plus a little more
    // the further above it the car arrives, so leaving the road at speed bleeds
    // off over a second or so instead of at the white line.
    // Tire resistance builds with motion. Applying the full high-speed drag
    // at a standstill can exceed reverse torque and trap the car in the grass.
    const surface = looseness * (stats.loose * Math.min(1, Math.abs(this.speed) / stats.offRoad)
      + .35 * Math.max(0, Math.abs(this.speed) - stats.offRoad));
    // Grip goes with it: lost turn-in is what makes grass feel like grass.
    // Losing only a quarter keeps the car recoverable, and the alignment assist
    // still works here, so a straightened wheel points the car back at the road.
    const grip = stats.grip * (1 - .25 * looseness);
    // Drifting (see Drift): the button hops the car, and steered either way
    // commits it to a drift until it is let go. A crash ends the drift and
    // loses its charge.
    const drift = this.drift, crashes = this.audioTelemetry.crashSerial;
    if (crashes !== this.crashSeen) { this.crashSeen = crashes; drift.crash(); }
    drift.control(dt, input, steering, aloft, Boolean(touch));
    const drifting = drift.active && !aloft;
    this.drifting = drifting; this.driftDirection = drift.dir;
    // (let go, the tires take the slide back over a moment: see travelHeading)
    this.driftAmount = dt && !touch ? THREE.MathUtils.damp(this.driftAmount, drifting ? 1 : 0, drifting ? 10 : 22, dt) : 0;
    let acceleration = 0;
    // The handbrake: the drift button when too slow to drift, or `stop`
    // (the touch stick let go, the car being left) at any speed
    const parkingBrake = !aloft && (Boolean(input.stop) || (drift.held && !drift.active && Math.abs(this.speed) < DRIFT_MIN));
    // A little extra low-speed pull makes starts and corner exits lively. It
    // fades out before cruising and leaves each car's top speed intact.
    const launch = 1 + .22 * (1 - looseness) * clamp(1 - this.speed / 12, 0, 1);
    if (forward && !brake && !parkingBrake && !aloft) acceleration += forward * (this.speed < -.3 ? stats.launch : stats.acceleration * launch) * (drifting ? DRIFT_POWER : 1);
    // (braking in a drift tightens it and takes speed off more gently: a brake drift)
    if (brake && !parkingBrake && !aloft) acceleration -= brake * (this.speed > .3 ? stats.braking : stats.creep) * (drifting ? BRAKE_SHARE : 1);
    if (parkingBrake) acceleration -= Math.sign(this.speed) * stats.handbrake;
    // What the driver is asking of the car, before the tires, the air and the
    // grass take their share. Weight transfer reads this rather than the total:
    // a verge is not a brake pedal and must not hand the front tires grip.
    let pedals = acceleration;
    // A drift scrubs a little speed, not enough to make the turbo not worth it
    if (drifting) acceleration -= Math.sign(this.speed) * DRIFT_DRAG;
    // Up a ramp takes speed, and down one gives it back
    const grade = aloft ? 0 : this.carAir?.grade(this.heading) ?? 0;
    if (grade) acceleration -= GRAVITY * grade / Math.hypot(1, grade);
    // (in the air only the air holds the car back, and the game's air drag is
    // there to cap top speed: a jump keeps nearly all its way)
    const drag = DRAG.rolling + DRAG.air * this.speed * this.speed + surface;
    if (Math.abs(this.speed) > .015) acceleration -= Math.sign(this.speed) * (aloft ? DRAG.air * AIR_DRAG * this.speed * this.speed : drag);
    if (touch) {
      this.speed = Math.abs(this.speed);
      // Raise the stick's speed target too, or its braking cancels the boost.
      const targetSpeed = input.handbrake ? 0 : touch.amount * (stats.topSpeed + (boosting ? 10 : 0) + (stats.offRoad - stats.topSpeed) * looseness);
      acceleration = dt ? clamp((targetSpeed - this.speed) / dt, -stats.touchBraking, stats.acceleration) : 0;
      pedals = acceleration;
      if (touch.amount) this.heading = touch.heading;
    }
    this.boosting = boosting && !parkingBrake && !brake && !aloft;
    if (this.boosting) { acceleration += stats.acceleration * .9; pedals += stats.acceleration * .9; }
    // A drift's turbo (see Drift): a kick at once, then a push past top speed
    // while it lasts, off the ground only once it is down again
    const turbo = !aloft && drift.turbo > 0 ? TURBOS[drift.turboStage] : null, turboTop = turbo ? stats.topSpeed * (1 + turbo.top) : 0;
    if (turbo && drift.kick) { this.speed = Math.max(this.speed, Math.min(turboTop, this.speed + stats.topSpeed * drift.kick)); drift.kick = 0; }
    if (turbo && !brake && !parkingBrake) { acceleration += stats.acceleration * turbo.push; pedals += stats.acceleration * turbo.push; }
    if (this.pushing > 0) {
      this.pushing = Math.max(0, this.pushing - dt);
      if (acceleration * Math.sign(this.speed || acceleration) > PUSH_GRIP) acceleration = Math.sign(acceleration) * PUSH_GRIP;
    }
    const oldSpeed = this.speed;
    const boostCoast = Math.max(0, this.speed - stats.topSpeed - stats.braking * .4 * dt);
    // (a boosted car keeps its way in the air: no tires to shed it)
    if (aloft) this.speed += acceleration * dt;
    else this.speed = clamp(this.speed + acceleration * dt, touch ? 0 : -stats.reverseSpeed, Math.max(stats.topSpeed + (boosting ? 10 : boostCoast), turboTop));
    // A held brake should settle the cab long enough to board/drop off before
    // backing up. Releasing and pressing again still selects reverse immediately.
    if (arcade && brake && !touch) {
      if (oldSpeed > 0 && this.speed <= 0) this.reverseDelay = .5;
      if (this.reverseDelay > 0) this.speed = Math.max(0, this.speed);
    }
    if (!forward && !brake && oldSpeed * this.speed < 0) this.speed = 0;
    if ((parkingBrake || input.handbrake) && oldSpeed * this.speed < 0) this.speed = 0;
    // Weight transfer as a share of what this car can do in each direction.
    // Taken along the direction of travel, so the brake pedal used as a reverse
    // throttle lifts the nose rather than pretending to brake. It eases in over
    // about a tenth of a second: the car settling, not an input filter.
    const effort = pedals * Math.sign(this.speed);
    const transfer = clamp(-effort / (effort > 0 ? stats.acceleration : stats.braking), -1, 1);
    this.weight = dt ? THREE.MathUtils.damp(this.weight, transfer, 9, dt) : transfer;
    // In a drift the way the car travels turns on the drift's own arc (see
    // Drift.turn), and the nose leads it into the bend
    const yaw = aloft ? 0 : drifting ? drift.turn(this.speed, stats, looseness) : turnRate(this.speed, this.steer, stats, looseness, this.driftAmount, this.weight);
    this.yawRate = touch ? 0 : yaw;
    this.load = aloft ? 0 : corneringLoad(this.speed, yaw, stats, looseness, this.weight);
    const frame = roadFrame(this.s);
    const assist = !aloft && !drifting && this.route.laneAssist !== false && (!this.freeDriving || looseness === 0);
    if (aloft) {
      // In the air the nose leans or spins with the steering while the car
      // flies on the way it left the ground (see CarAir.steer), spinning with
      // the drift button pressed again up there
      const before = this.heading;
      this.heading = this.carAir.steer(dt, steering, drift.spinning, this.slideHeading);
      this.yawRate = (this.heading - before) / dt;
    } else if (drifting) {
      this.slideHeading += yaw * dt;
      this.heading = this.slideHeading + drift.lead(dt);
    } else if (!touch) this.heading += yaw * dt;
    let difference = Math.atan2(Math.sin(this.heading - frame.angle), Math.cos(this.heading - frame.angle));
    // Free driving keeps the chosen heading off-road; normal driving assists bends.
    if (!touch && assist && Math.abs(this.steer) < .08 && Math.abs(this.speed) > .2 && Math.abs(difference) < 1.15) {
      const laneCorrection = clamp((this.u - 2.4) * .026, -.12, .12) * Math.sign(this.speed);
      this.heading -= (difference + laneCorrection) * Math.min(1, dt * .85);
      difference = this.heading - frame.angle;
    }
    const step = this.speed * dt, fromS = this.s, fromU = this.u;
    // (a landing a little off the way the car is going slides a moment before the tires bite: see CarAir.grip)
    if (!aloft && !drifting) {
      if (!dt || touch || oldSpeed * this.speed <= 0 || !Number.isFinite(this.slideHeading)) this.slideHeading = this.heading;
      this.slideHeading = travelHeading(this.slideHeading, this.heading, dt, grip * (this.carAir?.grip ?? 1), this.driftAmount, this.load);
    }
    const travelAngle = this.slideHeading - frame.angle;
    this.s += touch?.amount ? touch.along * step : Math.cos(travelAngle) * step / frame.scale;
    this.u += touch?.amount ? touch.across * step : Math.sin(travelAngle) * step;
    this.carryKnock(dt, !aloft); rock(this.jolt, dt);
    if (!touch && assist && Math.abs(difference) < 1.15) this.heading += (roadFrame(this.s).angle - frame.angle) * (1 - Math.abs(this.steer)) * .92;
    this.distance += Math.abs(step);
    if (!this.freeDriving) {
      const [coastLimit, inlandLimit] = this.route.bounds(this.s);
      if (this.u < coastLimit || this.u > inlandLimit) {
        this.u = clamp(this.u, coastLimit, inlandLimit); this.speed *= Math.exp(-dt * 4);
      }
    }
    let ground = this.ground(this.s, this.u);
    // The roadside limits already keep a car off bad ground. With them lifted,
    // water and cliffs stop it instead. Whichever half of the move stays on
    // firm ground is kept, so the car runs along a shore rather than sticking
    // to it; a car already standing somewhere impassable may always leave.
    // (in the air, or up on a ramp out over the water, the water is no wall)
    if (this.freeDriving && !aloft && !this.carAir?.raised && impassable(ground)) {
      const from = this.ground(fromS, fromU);
      if (!impassable(from)) {
        let kept = this.ground(this.s, fromU);
        if (impassable(kept)) kept = this.ground(fromS, this.u);
        ground = impassable(kept) ? from : kept;
        this.s = ground.s; this.u = ground.u; this.speed *= ground === from ? 0 : Math.exp(-dt * 4);
      }
    }
    // Up and down with what the wheels drive over, or off it into the air
    // (see CarAir). Models put their tire bottoms at zero.
    const v = this.velocity;
    this.carAir.update(dt, -v.z, v.x);
    const p = positionAt(this.s, this.u, this.y);
    this.groundedPosition.set(p.x, p.y, p.z); this.car.position.copy(this.groundedPosition);
    this.carAir.tilt(dt, this.speed);
    this.car.rotation.set(0, -this.heading, 0, 'YXZ'); this.car.rotateX(this.pitch); this.car.rotateZ(this.roll);
    // Lean and dive read the same numbers the tires do (in the air there are none).
    this.bodyRoll = THREE.MathUtils.damp(this.bodyRoll, aloft ? 0 : -clamp(yaw * this.speed * .0042, -LEAN, LEAN), 11, dt);
    this.bodyPitch = THREE.MathUtils.damp(this.bodyPitch, aloft ? 0 : -clamp(acceleration, -15, 12) * .0034, 7, dt);
    this.bodyLift = this.lift;
    this.wheelSpin -= step / .48;
    // The chase camera widens and drops back once the car is really moving.
    // Nothing below two fifths of its top speed, everything by the time the
    // needle is against the stop. Once the car moves, a camera the mouse
    // turned swings back behind it. In the air it looks the way the car
    // flies, not the way a spinning nose points.
    this.car.userData.speedRush = clamp((Math.abs(this.speed) / stats.topSpeed - .4) / .6, 0, 1);
    this.car.userData.speed = this.speed;
    // (a turbo opens the chase lens a moment: see ThirdPersonCamera)
    this.car.userData.turbo = turbo ? Math.min(1, drift.boost * 1.5) : 0;
    this.car.userData.travel = this.aloft ? this.slideHeading : null; this.car.userData.chasePitch = this.aloft ? 0 : null;
    // (off the ground on a drift's hop: the chase camera lets it go by, see ThirdPersonCamera)
    this.car.userData.hopping = !this.aloft && this.carAir.free > 0;
    // A crash shakes the view, and that fades within about a second.
    this.trauma = Math.max(0, this.trauma - dt * 1.4); this.car.userData.trauma = this.trauma;
    this.lost *= Math.exp(-dt / CRASH_FADE);
    // Report actual driving effort for keyboard, analog triggers, and touch.
    // This is read-only telemetry: sound never feeds back into driving physics.
    this.audioTelemetry.speed = this.speed;
    this.audioTelemetry.throttle = parkingBrake ? 0 : touch ? clamp((acceleration + (this.speed > .015 ? drag : 0)) / stats.acceleration, 0, 1) : this.speed < -.3 ? brake : brake ? 0 : forward;
    this.audioTelemetry.brake = parkingBrake ? 1 : touch ? clamp(-acceleration / stats.touchBraking, 0, 1) : this.speed < -.3 ? forward : brake;
    this.audioTelemetry.offRoad = looseness;
    // (the handbrake on, not the drift button held)
    this.audioTelemetry.handbrake = parkingBrake ? 1 : 0;
    // (a turbo sounds as the boost does, and a drift's stages and turbos have their own: see DriveAudio)
    this.audioTelemetry.boost = this.boosting || turbo ? 1 : 0;
    this.audioTelemetry.driftStage = drift.stage; this.audioTelemetry.driftStages = drift.stagesReached;
    this.audioTelemetry.turbos = drift.turbos; this.audioTelemetry.turboStage = drift.turboStage;
    // (in the air the wheels spin free: the engine revs and the tires go quiet)
    this.audioTelemetry.aloft = this.aloft ? 1 : 0;
    this.slip = Math.atan2(Math.sin(this.heading - this.slideHeading), Math.cos(this.heading - this.slideHeading));
    // Scraping along a wall or a car sounds only while it goes on.
    this.audioTelemetry.scrape *= Math.exp(-dt * 14);
    if (dt === 0) { this.audioTelemetry.impact = 0; this.reverseDelay = 0; this.drifting = false; }
    this.currentPose.position.copy(this.groundedPosition); this.currentPose.quaternion.copy(this.car.quaternion);
    for (const key of POSE_KEYS) this.currentPose[key] = this[key];
    this.currentPose.bodyPitch += this.jolt.pitch; this.currentPose.bodyRoll += this.jolt.roll;
    // Resets and route changes are teleports, so never blend from the old location.
    if (dt === 0) this.copyPose(this.previousPose, this.currentPose);
    this.render(0);
  }
}

// Traffic and player movement write the same physical state. The navigation
// driver's fields stay on the traffic body, with no extra lookups in its step.
for (const [name, field] of Object.entries({ s: 's', u: 'u', speed: 'speed', heading: 'heading', spec: 'spec', car: 'car', groundedPosition: 'position' })) {
  Object.defineProperty(ActorMotion.prototype, name, {
    get() { return this.actor.body[field]; }, set(value) { this.actor.body[field] = value; },
  });
}

// (the rainbow's hue carries over, so a car swapped in picks up the color where it was)
const CONTEXT = ['route', 'freeDriving', 'arcade', 'scenery', 'props', 'traffic', 'driftMode', 'jetpack', 'night', 'journeyId', 'rainbowHue', 'distance'];

// The player holds a controller, not a replaceable car body. Camera, input and
// HUD callers keep this handle while cars and the pedestrian live independently.
export class PlayerController {
  constructor(route = citydriverRoute, state = {}, carId = DEFAULT_CAR, paint = null, model = null) {
    const motion = new ActorMotion(route, state, carId, paint, model);
    this.actor = motion.actor; this.person = null; this.owned = new Set([this.actor]);
    this.actor.transfer('player');
  }
  context(motion, previous) {
    if (!previous) return;
    for (const key of CONTEXT) motion[key] = previous[key];
    Object.assign(motion.audioTelemetry, previous.audioTelemetry);
  }
  releasePerson() {
    const actor = this.actor, motion = actor.motion;
    if (actor.kind !== 'person') return;
    if (motion.walker.down) motion.props?.release(motion.walker.down.body);
    motion.walker.down = null;
    actor.transfer('inactive'); actor.visual.removeFromParent();
  }
  setCar(id, { paint = null } = {}) {
    const old = this.actor, previous = old.motion, parent = old.visual.parent;
    const state = { s: previous.s, u: previous.u, heading: previous.heading, distance: previous.distance };
    const speed = previous.speed, height = previous.groundedPosition.y, flew = Boolean(previous.pilot);
    const motion = new ActorMotion(previous.route, state, CARS[id] ? id : DEFAULT_CAR, paint);
    this.context(motion, previous); this.releasePerson(); this.actor = motion.actor; this.owned.add(this.actor);
    this.actor.transfer('player', parent); this.actor.visual.visible = true;
    if (old.source === 'garage') { old.dispose(); this.owned.delete(old); }
    motion.setLights(motion.night); motion.setAppearance(motion.journeyId); motion.setPaint(paint);
    motion.speed = clamp(speed, -motion.stats.reverseSpeed, motion.stats.topSpeed);
    motion.pilot?.takeOver(motion.heading, motion.speed, height);
    if (flew && !motion.pilot) motion.reset(); else motion.update(0, {});
  }
  stepOut(appearance) {
    const left = this.actor, previous = left.motion, parent = left.visual.parent;
    const state = { s: previous.s, u: previous.u, heading: previous.heading, distance: previous.distance };
    if (!this.person || this.person.disposed) {
      const motion = new ActorMotion(previous.route, state, WALKER_SPEC.name, null, createWalkerModel(appearance));
      this.person = motion.actor; this.owned.add(this.person);
    }
    const motion = this.person.motion;
    this.context(motion, previous);
    motion.s = state.s; motion.u = state.u; motion.heading = state.heading;
    motion.speed = 0; motion.knock.x = motion.knock.z = motion.knock.spin = 0;
    motion.trauma = motion.lost = motion.pushing = 0;
    Object.assign(motion.jolt, { pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 });
    motion.walker = new Walker(motion, motion.model);
    this.actor = this.person; this.actor.transfer('player', parent); this.actor.visual.visible = true;
    left.transfer('parked');
    motion.walker.takeOver(); motion.update(0, {});
    return left;
  }
  // A traffic car creates its drivable view once. Its body and scene root
  // are retained through every subsequent borrow, knock and return.
  takeControl(actor, { paint = actor.paint, speed = actor.body.speed } = {}) {
    if (actor.disposed) throw new Error('Cannot control a disposed actor');
    const previous = this.actor.motion, parent = this.actor.visual.parent;
    const body = actor.body, state = { s: body.s, u: body.u, heading: body.heading };
    const motion = actor.motion ?? new ActorMotion(previous.route, state, body.spec.name, paint, null, actor);
    this.context(motion, previous);
    this.releasePerson();
    this.actor = actor; actor.transfer('player', parent); actor.show('driving'); actor.visual.visible = true;
    body.spec = motion.drivingSpec; body.profile = body.spec.profile; body.perch = undefined;
    motion.speed = clamp(speed || 0, -motion.stats.reverseSpeed, motion.stats.topSpeed);
    motion.knock.x = motion.knock.z = motion.knock.spin = 0;
    motion.steer = motion.trauma = motion.lost = motion.pushing = 0; motion.drift?.reset();
    motion.wheelSpin = 0; motion.bodyPitch = motion.bodyRoll = 0;
    Object.assign(motion.jolt, { pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 });
    if (motion.pilot) { motion.pilot.unmanned = false; motion.pilot.events = []; }
    motion.setLights(motion.night); motion.setAppearance(motion.journeyId); motion.setPaint(paint);
    motion.update(0, {});
    return actor;
  }
  stepIn(actor) { return this.takeControl(actor, { speed: 0 }); }
  disposeModel() { for (const actor of this.owned) actor.dispose(); this.owned.clear(); }
  get generation() { return this.actor.id; }
}

// These are the player-facing movement fields used by the simulation, menus
// and review tools. Forwarding on the prototype avoids a Proxy in hot loops.
const PLAYER_FIELDS = ['air', 'airborne', 'aloft', 'arcade', 'audioTelemetry', 'body', 'bodyLift', 'bodyPitch', 'bodyRoll', 'boosting', 'canopy', 'car', 'carAir', 'carId', 'currentPose', 'distance', 'figure', 'sinking', 'vy', 'y',
  'drift', 'driftAmount', 'driftDirection', 'driftMode', 'drifting', 'freeDriving', 'groundedPosition', 'heading', 'jetpack', 'jolt', 'journeyId', 'knock',
  'load', 'lost', 'model', 'night', 'nightLights', 'paintColor', 'pilot', 'pitch', 'previousPose', 'props', 'pushing', 'rainbowColor',
  'rainbowHue', 'reverseDelay', 'roll', 'rotors', 'route', 's', 'scenery', 'slideHeading', 'slip', 'spec', 'speed', 'stats', 'steer', 'traffic', 'trauma', 'u',
  'velocity', 'walker', 'weight', 'wheels', 'wheelSpin', 'yawRate'];
for (const name of PLAYER_FIELDS) Object.defineProperty(PlayerController.prototype, name, {
  get() { return this.actor.motion[name]; }, set(value) { this.actor.motion[name] = value; },
});
for (const name of Object.getOwnPropertyNames(ActorMotion.prototype)) {
  if (name === 'constructor' || name === 'fit' || name in PlayerController.prototype) continue;
  if (typeof Object.getOwnPropertyDescriptor(ActorMotion.prototype, name).value !== 'function') continue;
  PlayerController.prototype[name] = function(a, b, c, d, e, f, g, h) { return this.actor.motion[name](a, b, c, d, e, f, g, h); };
}
export { PlayerController as DrivingController };
