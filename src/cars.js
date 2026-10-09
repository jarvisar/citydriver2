import { TRAFFIC_MODELS, SPORTS_MODEL, BUS_MODEL, BUS_PAINT } from './traffic-models.js';
import { FORMULA_SHAPE } from './formula-model.js';
import { SPECIAL_SHAPES } from './special-models.js';
import { HELICOPTER_SHAPE } from './helicopter.js';
import { PLANE_SHAPE } from './plane-model.js';
import { EXOTIC_MODEL } from './exotic-model.js';

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
// chooser-only cars are the exceptions: the GT and Exotic reach further,
// the Formula racer is quicker again, and each of
// the specials trades one thing away to be the best in the garage at another.
//
//   topSpeed            meters per second, the speed ceiling (drag may limit it first)
//   offRoad             the same off the tarmac: two thirds or so of topSpeed,
//                       and the car eases down to it rather than snapping
//   acceleration        meters per second squared under full throttle
//   braking             meters per second squared on the brakes
//   grip                cornering capacity and tire recovery relative to the wagon
//   turnRadius          optional low-speed full-lock radius in meters
//
// A car weighs what its footprint covers (see impact.js) unless it gives its
// own `mass` in tonnes, which decides how a collision with traffic is shared.
const BASE = { topSpeed: 33, acceleration: 14.5, braking: 20, grip: 1, offRoad: 21.8 };

export const CARS = {
  taxi: {
    name: 'Taxi', kind: 'built', taxi: true, paint: '#f5c42e', shape: { ...shape('sedan'), name: 'taxi' },
    stats: { topSpeed: 47, acceleration: 27, braking: 32, grip: 1.4, offRoad: 32.9 },
  },
  taxiGT: {
    name: 'GT Taxi', kind: 'built', taxi: true, paint: '#f5c42e', shape: SPORTS_MODEL,
    stats: { topSpeed: 54, acceleration: 37, braking: 34, grip: 1.55, offRoad: 32.9 },
  },
  taxiFormula: {
    name: 'Formula Taxi', mass: .95, kind: 'formula', taxi: true, paint: '#f5c42e',
    shape: { ...FORMULA_SHAPE, name: 'taxi-formula', cabin: [1.12, .34, 1.1], eye: [-.28, .88, -.76] },
    stats: { topSpeed: 59, acceleration: 51, braking: 36, grip: 2.2, offRoad: 32.9, turnRadius: 3.6 },
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
    stats: { topSpeed: 32.1, acceleration: 14.1, braking: 19.4, grip: .97, offRoad: 22.4 },
  },
  snow: {
    name: 'Winter Wagon', kind: 'classic', trim: 'snow', paint: '#9fc4d5', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 32.3, acceleration: 14, braking: 21, grip: 1.06, offRoad: 21.7 },
  },
  jungle: {
    name: 'Utility Wagon', kind: 'classic', trim: 'jungle', paint: '#e0b44a', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 31.4, acceleration: 14.7, braking: 19.2, grip: .96, offRoad: 21.9 },
  },
  plains: {
    name: 'Country Wagon', kind: 'classic', trim: 'plains', paint: '#4f8f8b', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 32.8, acceleration: 14.3, braking: 19.8, grip: .99, offRoad: 22.2 },
  },
  city: {
    name: 'City Wagon', kind: 'classic', trim: 'city', paint: '#7a3b47', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 31.2, acceleration: 15.1, braking: 20.4, grip: 1.02, offRoad: 20.8 },
  },
  hatchback: {
    name: 'City Hatch', kind: 'built', paint: '#6fa9c2', shape: shape('hatchback'),
    stats: { topSpeed: 30.9, acceleration: 15.5, braking: 20.6, grip: 1.1, offRoad: 19.8 },
  },
  sedan: {
    name: 'Highway Sedan', kind: 'built', paint: '#e7e3d5', shape: shape('sedan'),
    stats: { topSpeed: 33.7, acceleration: 14.2, braking: 20.2, grip: 1.01, offRoad: 21.2 },
  },
  wagon: {
    name: 'Estate Wagon', kind: 'built', paint: '#5f7a5a', shape: shape('wagon'),
    stats: { topSpeed: 33, acceleration: 13.7, braking: 19.6, grip: .97, offRoad: 21.6 },
  },
  pickup: {
    name: 'Work Pickup', kind: 'built', paint: '#b06a3a', shape: shape('pickup'),
    stats: { topSpeed: 31.2, acceleration: 13.2, braking: 18.6, grip: .92, offRoad: 21.7 },
  },
  van: {
    name: 'Delivery Van', kind: 'built', paint: '#9aa6ad', shape: shape('van'),
    stats: { topSpeed: 31.9, acceleration: 12.7, braking: 18.8, grip: .9, offRoad: 19.7 },
  },
  sports: {
    name: 'GT', kind: 'built', paint: '#b8232f', shape: SPORTS_MODEL,
    stats: { topSpeed: 38.9, acceleration: 17.3, braking: 23, grip: 1.14, offRoad: 23.7 },
  },
  exotic: {
    name: 'Exotic', kind: 'built', paint: '#407394', shape: EXOTIC_MODEL,
    stats: { topSpeed: 44.3, acceleration: 19.5, braking: 23, grip: 1.22, offRoad: 23.7 },
  },
  // Light, short and on knobbly tires: it barely notices the tarmac ending.
  buggy: {
    name: 'Buggy', mass: .7, kind: 'special', paint: '#e2a23b', shape: SPECIAL_SHAPES.buggy,
    stats: { topSpeed: 30.1, acceleration: 18.6, braking: 19, grip: 1.12, offRoad: 27.7 },
  },
  // Goes anywhere at the same unhurried pace, and leans on its tires to stop or turn.
  monster: {
    name: 'Monster Truck', mass: 4.5, kind: 'special', paint: '#3f7fb5', shape: SPECIAL_SHAPES.monster,
    stats: { topSpeed: 27.7, acceleration: 13.3, braking: 16.5, grip: .8, offRoad: 25.7 },
  },
  // All engine: quicker in a straight line than the coupe, and nowhere else.
  hotrod: {
    name: 'Hot Rod', kind: 'special', paint: '#1f2326', shape: SPECIAL_SHAPES.hotrod,
    stats: { topSpeed: 43.7, acceleration: 22.4, braking: 17, grip: .86, offRoad: 24.2 },
  },
  // Eight tonnes of tractor unit. It gets there, and it needs the room to stop.
  rig: {
    name: 'Truck', mass: 8, kind: 'special', paint: '#a3312c', shape: SPECIAL_SHAPES.rig,
    stats: { topSpeed: 31.9, acceleration: 11, braking: 15.5, grip: .78, offRoad: 19.2, turnRadius: 5.4 },
  },
  // The city's bus, as heavy as the truck and bigger: it goes through what
  // the truck does, is nearly as slow away, and swings wide at a corner.
  bus: {
    name: 'City Bus', mass: BUS_MODEL.mass, kind: 'special', paint: BUS_PAINT, shape: SPECIAL_SHAPES.bus,
    stats: { topSpeed: 29.5, acceleration: 11.8, braking: 16.2, grip: .8, offRoad: 18.9, turnRadius: 6.8 },
  },
  // Out of breath by 57 mph, but it changes lanes like a thought.
  micro: {
    name: 'Micro', kind: 'special', paint: '#8fcfc0', shape: SPECIAL_SHAPES.micro,
    stats: { topSpeed: 25.4, acceleration: 16.1, braking: 22, grip: 1.26, offRoad: 15.6, turnRadius: 3.2 },
  },
  formula: {
    name: 'Formula', mass: .8, kind: 'formula', paint: '#d8452f', shape: FORMULA_SHAPE,
    // 100 m/s ceiling; air drag balances full throttle near 79 m/s (177 mph).
    stats: { topSpeed: 100, acceleration: 60, braking: 30, grip: 2.25, offRoad: 20, turnRadius: 3.6 },
  },
  // Not a car at all: it flies (see helicopter.js), so the road never slows
  // it. Its stats set its top speed, its pull and how hard it can stop. It
  // weighs in heavy enough to keep going: a tree takes about a tenth of its speed.
  helicopter: {
    name: 'Helicopter', mass: 4, kind: 'helicopter', flies: true, paint: '#c9362f', shape: HELICOPTER_SHAPE,
    stats: { topSpeed: 47, acceleration: 16.6, braking: 16, grip: 1.2, offRoad: 47 },
  },
  // A light plane on big soft tires (see plane.js): it needs a run at it to
  // take off, and after that it is the quickest thing in the garage. It is
  // weighed in heavier than it is, as the helicopter is, so a tree it flies
  // through only costs it a bite of its speed.
  plane: {
    name: 'Plane', mass: 2.2, kind: 'plane', flies: true, paint: '#2f6fa8', shape: PLANE_SHAPE,
    stats: { topSpeed: 66, acceleration: 15.4, braking: 14, grip: 1.1, offRoad: 66 },
  },
};

// The demolition contractor's truck: the garage's in site-work orange. It
// isn't sold. One drives about in the traffic, and getting into it (or
// Demolition on the menus) puts a demolition run on standby.
CARS.demolition = { ...CARS.rig, name: 'Demolition truck', job: 'demolition', paint: '#e27a24' };

// The wheeled fleet, which the handling is built for, and the garage, which
// has the flying machines too. Neither has the demolition truck, a copy of the Truck.
export const CAR_IDS = Object.keys(CARS).filter(id => !CARS[id].flies && !CARS[id].job);
// Citydriver 1's wagons, one per old route, and the plain Default card are
// near copies of the Surf Wagon. They still drive (the handling and audio
// tests use the Default as their baseline) but the garage leaves them out.
const RETIRED = new Set(['auto', 'desert', 'snow', 'jungle', 'plains', 'city']);
export const GARAGE_IDS = Object.keys(CARS).filter(id => !RETIRED.has(id) && !CARS[id].job);
// What the garage sells each one for, out of the one fleet balance every mode
// pays into. An average player makes about $500 a minute (a taxi shift at
// 16-19 m/s with its goals, or a B-rated demolition run), so the first car
// is a few minutes away, the specials an hour or two, and the aircraft are
// the long goal: three and five hours or so. The cars that turn up in the
// traffic, which can be borrowed on foot anyway, are the cheapest. Everyone
// starts with the Taxi and the Surf Wagon. See docs/economy.md.
export const GARAGE_PRICES = {
  taxi: 0, taxiGT: 10000, taxiFormula: 40000,
  coast: 0, hatchback: 2000, sedan: 2500, wagon: 3000, pickup: 4000, van: 4500, sports: 12000, exotic: 45000,
  micro: 5000, buggy: 8000, hotrod: 15000, bus: 18000, rig: 25000, monster: 30000, formula: 65000,
  helicopter: 90000, plane: 140000,
  jetpack: 60000,
};
export const carPrice = id => typeof id === 'string' && Object.hasOwn(GARAGE_PRICES, id) ? GARAGE_PRICES[id] : null;
// What the garage sells that isn't a vehicle, in its own section. The
// jetpack works on foot (see Walker): until it is bought, a held jump in
// the air does nothing more. The parachute stays free.
export const GEAR = { jetpack: { name: 'Jetpack', about: 'Hold jump in the air to fly, up to 90 m over the street. Let go to drop, and land on your feet.' } };
export const SHOP_IDS = [...GARAGE_IDS, ...Object.keys(GEAR)];
export const shopName = id => GEAR[id]?.name ?? carEntry(id).name;
// A test drive lasts this long. The first of each car is free, and each
// one after costs a small share of its price, rounded to $50.
export const TEST_DRIVE_SECONDS = 120;
export const testDrivePrice = id => Math.max(50, Math.round(carPrice(id) * .025 / 50) * 50);
// The garage's sections, in order
export const GARAGE_GROUPS = [['cab', 'Cabs'], ['car', 'Cars'], ['special', 'Specials'], ['air', 'Aircraft']];
export const garageGroup = id => {
  const entry = carEntry(id);
  return entry.taxi ? 'cab' : entry.flies ? 'air' : ['special', 'formula'].includes(entry.kind) ? 'special' : 'car';
};
export const DEFAULT_CAR = 'auto';
// What a new player has: the Taxi for shifts, and Citydriver 1's Surf Wagon
// for free drive. Free drive used to start in the cab, with fares waiting all
// round it, which read as a taxi shift that hadn't been asked for.
export const STARTING_CAB = 'taxi', STARTING_CAR = 'coast';
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
    // Full-lock radius in meters at city-corner speeds. Keep the heavy cars
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
  { label: 'Top speed', key: 'topSpeed', low: 23.6, high: 44.8 },
  { label: 'Acceleration', key: 'acceleration', low: 9.6, high: 23.7 },
  { label: 'Handling', key: 'grip', low: .72, high: 1.3 },
  { label: 'Off road', key: 'offRoad', low: 14.2, high: 28.9 },
];
// The cabs are tuned past every road car, so on that scale all three pegged
// every bar. They get one of their own from zero (the old Taxi fleet's), so
// the Taxi, GT Taxi and Formula Taxi still tell apart in the garage.
const CAB_METERS = [
  { label: 'Top speed', key: 'topSpeed', low: 0, high: 65 },
  { label: 'Acceleration', key: 'acceleration', low: 0, high: 54 },
  { label: 'Handling', key: 'grip', low: 0, high: 2.3 },
  { label: 'Off road', key: 'offRoad', low: 0, high: 38 },
];
export function carMeters(id) {
  const { stats, taxi } = carEntry(id);
  return (taxi ? CAB_METERS : METERS).map(({ label, key, low, high }) => ({ label, level: Math.round(Math.min(1, Math.max(.06, (stats[key] - low) / (high - low))) * 100) }));
}
