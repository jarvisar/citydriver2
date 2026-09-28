import { TRAFFIC_MODELS, SPORTS_MODEL, BUS_MODEL, BUS_PAINT } from './traffic-models.js';
import { FORMULA_SHAPE } from './formula-model.js';
import { SPECIAL_SHAPES } from './special-models.js';
import { HELICOPTER_SHAPE } from './helicopter.js';
import { PLANE_SHAPE } from './plane-model.js';

// The player's original car. Its collision box is the footprint the game has
// always used; the extra fields only describe it for the chooser's artwork.
export const CLASSIC_SHAPE = {
  name: 'classic', width: 2, length: 3.92, cabin: [1.77, .81, 1.9], cabinZ: .12,
  cabinY: 1.165, wheelRadius: .48, wheelZ: 1.195,
};

const shape = name => TRAFFIC_MODELS.find(spec => spec.name === name);

// The default car dresses for the scenery; every other car brings its own paint.
export const ROUTE_PAINT = { coast: '#d96143', desert: '#78977b', snow: '#9fc4d5', jungle: '#e0b44a', plains: '#4f8f8b', city: '#7a3b47' };

// The road fleet is the same kind of relaxed tourer. Stats stay within about
// a tenth of the coastal wagon so a choice changes character, not the game. The
// chooser-only cars are the exceptions: the coupe reaches noticeably further,
// the formula racer is quicker again by the same margin over it, and each of
// the specials trades one thing away to be the best in the garage at another.
//
//   topSpeed            metres per second, the speed ceiling (drag may limit it first)
//   offRoad             the same off the tarmac: two thirds or so of topSpeed,
//                       and the car eases down to it rather than snapping
//   acceleration        metres per second squared under full throttle
//   braking             metres per second squared on the brakes
//   grip                cornering capacity and tire recovery relative to the wagon
//   turnRadius          optional low-speed full-lock radius in metres
//
// A car weighs what its footprint covers (see impact.js) unless it gives its
// own `mass` in tonnes, which decides how a collision with traffic is shared.
const BASE = { topSpeed: 28, acceleration: 11.3, braking: 20, grip: 1, offRoad: 18.5 };

export const CARS = {
  taxi: {
    name: 'Taxi', kind: 'built', taxi: true, paint: '#f5c42e', shape: { ...shape('sedan'), name: 'taxi' },
    stats: { topSpeed: 40, acceleration: 21, braking: 32, grip: 1.4, offRoad: 28 },
  },
  taxiGT: {
    name: 'GT Taxi', kind: 'built', taxi: true, paint: '#f5c42e', shape: SPORTS_MODEL,
    stats: { topSpeed: 46, acceleration: 29, braking: 34, grip: 1.55, offRoad: 28 },
  },
  taxiFormula: {
    name: 'Formula Taxi', mass: .95, kind: 'formula', taxi: true, paint: '#f5c42e',
    shape: { ...FORMULA_SHAPE, name: 'taxi-formula', cabin: [1.12, .34, 1.1], eye: [-.28, .88, -.76] },
    stats: { topSpeed: 50, acceleration: 40, braking: 36, grip: 2.2, offRoad: 28, turnRadius: 3.6 },
  },
  auto: {
    name: 'Default',
    // No portrait and no meters in the chooser: this card is whichever car the road brings.
    plain: true, kind: 'classic', trim: null, paint: '#d96143', shape: CLASSIC_SHAPE, stats: BASE,
  },
  coast: {
    name: 'Surf Wagon', kind: 'classic', trim: 'coast', paint: '#d96143', shape: CLASSIC_SHAPE, stats: BASE,
  },
  desert: {
    name: 'Off-road Wagon', kind: 'classic', trim: 'desert', paint: '#78977b', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 27.2, acceleration: 11, braking: 19.4, grip: .97, offRoad: 19 },
  },
  snow: {
    name: 'Winter Wagon', kind: 'classic', trim: 'snow', paint: '#9fc4d5', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 27.4, acceleration: 10.9, braking: 21, grip: 1.06, offRoad: 18.4 },
  },
  jungle: {
    name: 'Utility Wagon', kind: 'classic', trim: 'jungle', paint: '#e0b44a', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 26.6, acceleration: 11.5, braking: 19.2, grip: .96, offRoad: 18.6 },
  },
  plains: {
    name: 'Country Wagon', kind: 'classic', trim: 'plains', paint: '#4f8f8b', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 27.8, acceleration: 11.2, braking: 19.8, grip: .99, offRoad: 18.8 },
  },
  city: {
    name: 'City Wagon', kind: 'classic', trim: 'city', paint: '#7a3b47', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 26.4, acceleration: 11.8, braking: 20.4, grip: 1.02, offRoad: 17.6 },
  },
  hatchback: {
    name: 'City Hatch', kind: 'built', paint: '#6fa9c2', shape: shape('hatchback'),
    stats: { topSpeed: 26.2, acceleration: 12.1, braking: 20.6, grip: 1.1, offRoad: 16.8 },
  },
  sedan: {
    name: 'Highway Sedan', kind: 'built', paint: '#e7e3d5', shape: shape('sedan'),
    stats: { topSpeed: 28.6, acceleration: 11.1, braking: 20.2, grip: 1.01, offRoad: 18 },
  },
  wagon: {
    name: 'Estate Wagon', kind: 'built', paint: '#5f7a5a', shape: shape('wagon'),
    stats: { topSpeed: 28, acceleration: 10.7, braking: 19.6, grip: .97, offRoad: 18.3 },
  },
  pickup: {
    name: 'Work Pickup', kind: 'built', paint: '#b06a3a', shape: shape('pickup'),
    stats: { topSpeed: 26.4, acceleration: 10.3, braking: 18.6, grip: .92, offRoad: 18.4 },
  },
  van: {
    name: 'Delivery Van', kind: 'built', paint: '#9aa6ad', shape: shape('van'),
    stats: { topSpeed: 27, acceleration: 9.9, braking: 18.8, grip: .9, offRoad: 16.7 },
  },
  sports: {
    name: 'GT', kind: 'built', paint: '#b8232f', shape: SPORTS_MODEL,
    stats: { topSpeed: 33, acceleration: 13.5, braking: 23, grip: 1.14, offRoad: 20.1 },
  },
  // Light, short and on knobbly tyres: it barely notices the tarmac ending.
  buggy: {
    name: 'Buggy', mass: .7, kind: 'special', paint: '#e2a23b', shape: SPECIAL_SHAPES.buggy,
    stats: { topSpeed: 25.5, acceleration: 14.5, braking: 19, grip: 1.12, offRoad: 23.5 },
  },
  // Goes anywhere at the same unhurried pace, and leans on its tyres to stop or turn.
  monster: {
    name: 'Monster Truck', mass: 4.5, kind: 'special', paint: '#3f7fb5', shape: SPECIAL_SHAPES.monster, breaks: ['shelter'],
    stats: { topSpeed: 23.5, acceleration: 10.4, braking: 16.5, grip: .8, offRoad: 21.5 },
  },
  // All engine: quicker in a straight line than the coupe, and nowhere else.
  hotrod: {
    name: 'Hot Rod', kind: 'special', paint: '#1f2326', shape: SPECIAL_SHAPES.hotrod,
    stats: { topSpeed: 37, acceleration: 17.5, braking: 17, grip: .86, offRoad: 20.5 },
  },
  // Eight tonnes of tractor unit. It gets there, and it needs the room to stop.
  rig: {
    name: 'Truck', mass: 8, kind: 'special', paint: '#a3312c', shape: SPECIAL_SHAPES.rig, breaks: ['tree', 'shelter'],
    stats: { topSpeed: 27, acceleration: 8.6, braking: 15.5, grip: .78, offRoad: 16.2, turnRadius: 5.4 },
  },
  // The city's bus, as heavy as the truck and bigger: it goes through what
  // the truck does, is nearly as slow away, and swings wide at a corner.
  bus: {
    name: 'City Bus', mass: BUS_MODEL.mass, kind: 'special', paint: BUS_PAINT, shape: SPECIAL_SHAPES.bus, breaks: ['tree', 'shelter'],
    stats: { topSpeed: 25, acceleration: 9.2, braking: 16.2, grip: .8, offRoad: 16, turnRadius: 6.8 },
  },
  // Out of breath by 48 mph, but it changes lanes like a thought.
  micro: {
    name: 'Micro', kind: 'special', paint: '#8fcfc0', shape: SPECIAL_SHAPES.micro,
    stats: { topSpeed: 21.5, acceleration: 12.6, braking: 22, grip: 1.26, offRoad: 13.2, turnRadius: 3.2 },
  },
  formula: {
    name: 'Formula', mass: .8, kind: 'formula', paint: '#d8452f', shape: FORMULA_SHAPE,
    // 100 m/s ceiling; air drag balances full throttle near 79 m/s (177 mph).
    stats: { topSpeed: 100, acceleration: 60, braking: 30, grip: 2.25, offRoad: 20, turnRadius: 3.6 },
  },
  // Not a car at all: it flies (see helicopter.js), so the road never slows
  // it. Its stats set its top speed, its pull and how hard it can stop. Like
  // the truck it smashes through trees and bus shelters, and it weighs in
  // heavy enough to keep going: a tree takes about a tenth of its speed.
  helicopter: {
    name: 'Helicopter', mass: 4, kind: 'helicopter', flies: true, paint: '#c9362f', shape: HELICOPTER_SHAPE, breaks: ['tree', 'shelter'],
    stats: { topSpeed: 40, acceleration: 13, braking: 16, grip: 1.2, offRoad: 40 },
  },
  // A light plane on big soft tyres (see plane.js): it needs a run at it to
  // take off, and after that it is the quickest thing in the garage. It is
  // weighed in heavier than it is, as the helicopter is, so a tree it flies
  // through only costs it a bite of its speed.
  plane: {
    name: 'Plane', mass: 2.2, kind: 'plane', flies: true, paint: '#2f6fa8', shape: PLANE_SHAPE, breaks: ['tree', 'shelter'],
    stats: { topSpeed: 56, acceleration: 12, braking: 14, grip: 1.1, offRoad: 56 },
  },
};

// The wheeled fleet, which the handling is built for, and the garage, which
// has the flying machines too.
export const CAR_IDS = Object.keys(CARS).filter(id => !CARS[id].flies);
export const GARAGE_IDS = Object.keys(CARS);
export const DEFAULT_CAR = 'auto';
export const carEntry = id => CARS[id] ?? CARS[DEFAULT_CAR];

// Rolling and air drag. They live here because the surface figures below are
// sized against them, so how a car slows and what the verge costs stay in step.
export const DRAG = { rolling: .7, air: .0095 };

// Keep low-speed lock separate from cornering capacity: a long Formula car
// needs room to maneuver, but its slicks hold a much tighter line at speed.
// The default lock is drawn from both ends of that: the tires decide how hard
// the car can be hustled, the body decides how much room it needs to swing its
// tail through, so a microcar turns inside a junction that a pickup fills.
export function carStats(id) {
  const entry = carEntry(id);
  const { topSpeed, acceleration, braking, grip, offRoad,
    turnRadius = (3.55 + .26 * entry.shape.length) / Math.sqrt(grip) } = entry.stats;
  return {
    topSpeed, acceleration, braking, grip, offRoad,
    // Full-lock radius in metres at city-corner speeds. Keep the heavy cars
    // less nimble, but give every car enough lock for a small intersection.
    turnRadius,
    // Arcade lateral acceleration budget, tuned for the city's 13 m side
    // streets. Formula cars can take the same corner faster without sliding.
    cornering: 32 * grip,
    reverseSpeed: topSpeed * .25,
    launch: acceleration * 1.68,   // Pulling out of a reverse roll.
    // Brake pedal used as reverse throttle: pulls about as hard as the gas
    // does from rest, so reverse engages at once and the top speed stays low.
    creep: braking * .75,
    handbrake: braking * 2.35,
    touchBraking: braking * 1.2,
    // Loose ground resists exactly hard enough that full throttle settles on
    // the off-road figure, so the number on the card falls out of the physics
    // rather than being clamped on top of it.
    loose: Math.max(0, acceleration - DRAG.rolling - DRAG.air * offRoad * offRoad),
    // The speed full throttle holds on the flat: the top speed, or where the
    // air balances the engine first (the Formula's 79 m/s). Sets the sound's gearing.
    cruise: Math.min(topSpeed, Math.sqrt(Math.max(0, acceleration - DRAG.rolling) / DRAG.air)),
  };
}

// Chooser meters. The ranges sit just outside everything with number plates, so
// the slowest car still shows a little bar and each special nearly fills the one
// it was built for. The formula racer is off that scale by design and pegs the
// first three; what its slicks cost shows on the fourth.
const METERS = [
  { label: 'Top speed', key: 'topSpeed', low: 20, high: 38 },
  { label: 'Acceleration', key: 'acceleration', low: 7.5, high: 18.5 },
  { label: 'Handling', key: 'grip', low: .72, high: 1.3 },
  { label: 'Off road', key: 'offRoad', low: 12, high: 24.5 },
];
export function carMeters(id) {
  const stats = carEntry(id).stats;
  return METERS.map(({ label, key, low, high }) => ({ label, level: Math.round(Math.min(1, Math.max(.06, (stats[key] - low) / (high - low))) * 100) }));
}
