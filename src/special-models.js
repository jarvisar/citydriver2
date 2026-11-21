import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stableShadowDepth } from './world/shadow-depth.js';
import { bodyMaterial, lampGlow, markedBody, busGeometry, BUS_MODEL, BUS_AXLES, BUS_WHEEL, TRAFFIC_MODELS } from './traffic-models.js';

// The garage's oddballs: machines that share no bodywork with the road fleet
// and are not meant to drive like it either. Like the coupe and the racer they
// are chooser-only, so the roads keep their ordinary-looking traffic.
//
// Each shape carries its own wheels, because none of them wears the road cars'
// set: `x` is the wheel's center from the middle of the car, and the collision
// width is measured to the outside of the widest tire. `eye` is where the
// first-person camera sits, and `chaseLift` raises the chase camera over a tall roof.
export const SPECIAL_SHAPES = {
  buggy: {
    name: 'buggy', width: 1.96, length: 3.4, eye: [0, 1.38, -.55],
    wheels: { front: { radius: .4, width: .26, x: .85, z: -1.15 }, rear: { radius: .52, width: .42, x: .77, z: 1.05 } },
  },
  monster: {
    name: 'monster', width: 2.7, length: 4.8, eye: [0, 2.6, -.95], chaseLift: 1,
    wheels: { front: { radius: .85, width: .7, x: 1, z: -1.55 }, rear: { radius: .85, width: .7, x: 1, z: 1.55 } },
  },
  hotrod: {
    name: 'hotrod', width: 2.02, length: 4, eye: [0, 1.4, -.3],
    wheels: { front: { radius: .36, width: .2, x: .86, z: -1.5 }, rear: { radius: .56, width: .46, x: .78, z: 1.15 } },
  },
  rig: {
    name: 'rig', width: 2.5, length: 7.3, eye: [0, 2.5, -1.6], chaseLift: 2.2,
    wheels: {
      front: { radius: .56, width: .3, x: 1.08, z: -2.5 },
      drive: { radius: .56, width: .62, x: .94, z: 1.85 },
      rear: { radius: .56, width: .62, x: .94, z: 3.05 },
    },
  },
  micro: {
    name: 'micro', width: 1.5, length: 2.4, eye: [0, 1.3, -.72],
    wheels: { front: { radius: .3, width: .18, x: .66, z: -.78 }, rear: { radius: .3, width: .18, x: .66, z: .78 } },
  },
  // The traffic's bus (see busGeometry), the driver up front on the left
  bus: {
    name: 'bus', width: BUS_MODEL.width, length: BUS_MODEL.length, eye: [-.62, 2.05, -4.95], chaseLift: 2.4,
    wheels: Object.fromEntries(['front', 'rear'].map((axle, k) => [axle, { radius: BUS_WHEEL.radius, width: BUS_WHEEL.width, x: BUS_MODEL.width / 2 - BUS_WHEEL.inset, z: BUS_AXLES[k] }])),
  },
  // The emergency vehicles, which also stand parked at the fire station and
  // the hospital (see PARKED_SPECIALS). `door` is how far ahead of the middle
  // the driver gets in (m), and `seat` how high the seat is.
  fireengine: {
    name: 'fireengine', width: 2.5, length: 8.4, eye: [-.52, 2.45, -3.35], chaseLift: 2.2, door: 2.85, seat: 1.25,
    wheels: { front: { radius: .55, width: .34, x: 1.06, z: -2.75 }, rear: { radius: .55, width: .56, x: .97, z: 2.3 } },
  },
  ambulance: {
    name: 'ambulance', width: 2.3, length: 6.3, eye: [-.45, 1.85, -1.6], chaseLift: 1.2, door: 1.6, seat: .95,
    wheels: { front: { radius: .42, width: .26, x: .95, z: -1.95 }, rear: { radius: .42, width: .44, x: .9, z: 1.75 } },
  },
};
// Specials that stand parked about the city as the curb's cars do (see
// CityChunk.parkedCar), to be knocked loose or borrowed on foot: the shape,
// its weight in a blow (t), how hard its stand-in pulls away (see
// CityTraffic) and its paint
export const PARKED_SPECIALS = [
  { name: 'fireengine', mass: 8, accel: 1.4, paint: '#c23a2e' },
  { name: 'ambulance', mass: 3.2, accel: 2.2, paint: '#eceee8' },
].map(({ name, ...more }) => {
  const { width, length, door, seat } = SPECIAL_SHAPES[name];
  return { name, width, length, door, seat, ...more };
});
// What a parked car of `name` is: one of the traffic's shapes or a parked special
export const parkedSpec = name => TRAFFIC_MODELS.find(spec => spec.name === name) ?? PARKED_SPECIALS.find(spec => spec.name === name);

const DARK = '#2b3434', CHROME = '#bfc4b9', GLASS = '#344e55', ENGINE = '#59625f', SEAT = '#3a4441', BED = '#414c4b';
const SHOCK = '#d9a441', AMBER = '#e0a23a', CANVAS = '#e9e2cb', LEATHER = '#8a5a3a';

// The same faceted kit the road cars and the racer are cut from: boxes, a box
// with one end pulled in, sloped glass, and the odd tube. Paint takes the
// garage color; everything in `details` carries its own, and so do an
// emergency vehicle's two sets of beacons (see markedBody).
function partsKit() {
  const parts = { paint: [], details: [], headlights: [], taillights: [], beaconA: [], beaconB: [] };
  function add(geometry, location, category = 'paint', color) {
    geometry.deleteAttribute('uv');
    geometry.translate(...location);
    if (color) {
      const tint = new THREE.Color(color), colors = [];
      for (let i = 0; i < geometry.attributes.position.count; i++) colors.push(tint.r, tint.g, tint.b);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    parts[category].push(geometry);
  }
  return {
    parts,
    // A positive tilt leans the top of the box back toward the tail.
    box(size, location, category, color, tilt = 0) {
      const geometry = new THREE.BoxGeometry(...size);
      if (tilt) geometry.rotateX(tilt);
      add(geometry, location, category, color);
    },
    tapered(size, location, { at, x = 1, y = 1, lift = 0 }, category, color) {
      const geometry = new THREE.BoxGeometry(...size), position = geometry.attributes.position;
      for (let i = 0; i < position.count; i++) if (Math.sign(position.getZ(i)) === at) {
        position.setX(i, position.getX(i) * x); position.setY(i, position.getY(i) * y + lift);
      }
      geometry.computeVertexNormals(); add(geometry, location, category, color);
    },
    // Glass slopes the way the road cars' does, so the oddballs still belong.
    glass(size, location, rake = .24) {
      const geometry = new THREE.BoxGeometry(...size), position = geometry.attributes.position;
      for (let i = 0; i < position.count; i++) if (position.getY(i) > 0) {
        position.setX(i, position.getX(i) * .94);
        position.setZ(i, position.getZ(i) + (position.getZ(i) < 0 ? rake : -rake / 2));
      }
      geometry.computeVertexNormals(); add(geometry, location, 'details', GLASS);
    },
    tube(radius, length, location, axis, color) {
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
      if (axis === 'x') geometry.rotateZ(Math.PI / 2); else if (axis === 'z') geometry.rotateX(Math.PI / 2);
      add(geometry, location, 'details', color);
    },
  };
}

const BUILDERS = {
  // A bare tub in a roll cage, with the engine hung out behind the seats on a
  // frame that the cage's back stays come down to.
  buggy(kit) {
    const { box, tapered, tube } = kit;
    // The tub: a floor, a bulkhead under the cowl, a deck behind the seats and
    // sides between them, so the seats sit down inside it.
    box([1.16, .16, 2.2], [0, .57, .1]);
    box([1.16, .2, .35], [0, .74, -.8]);
    box([1.16, .2, .55], [0, .74, .925]);
    tapered([1.1, .34, .75], [0, .66, -1.3], { at: -1, x: .55, y: .45, lift: -.06 });
    box([1.16, .2, .3], [0, .93, -.78]);
    box([1, .06, 2], [0, .47, .05], 'details', DARK);
    for (const side of [-1, 1]) {
      box([.1, .2, 1.32], [side * .53, .74, 0]);
      box([.42, .14, .5], [side * .28, .72, .2], 'details', SEAT);
      box([.42, .56, .13], [side * .28, 1, .5], 'details', SEAT);
      // Cage: a rear hoop, a raked front one and roof rails.
      box([.07, .95, .07], [side * .56, 1.3, .68], 'details', DARK);
      box([.07, .9, .07], [side * .56, 1.33, -.78], 'details', DARK, .272);
      box([.07, .07, 1.41], [side * .56, 1.76, .01], 'details', DARK);
      // The engine frame: rails back from the tub, and stays from the hoop
      // down to where they meet the bumper, clear of the engine and the tires.
      box([.06, .06, .55], [side * .43, .74, 1.445], 'details', DARK);
      box([.07, 1.435, .07], [side * .5, 1.2525, 1.1875], 'details', DARK, -Math.PI / 4);
      // Wishbones out to the wheels, round lamps on the cowl, lamps on the hoop.
      box([.5, .05, .08], [side * .6, .5, -1.15], 'details', DARK);
      box([.4, .07, .1], [side * .56, .56, 1.05], 'details', DARK);
      tube(.1, .12, [side * .42, .98, -.985], 'z', DARK);
      strut(kit, [side * .42, .98, -1.04], [side * .42, .98, -1.06], .085, null, 'headlights');
      box([.12, .16, .05], [side * .56, 1.15, .74], 'taillights');
      // Tailpipes turned up off the ends of the silencer.
      strut(kit, [side * .3, .84, 1.73], [side * .33, 1, 1.77], .035, CHROME);
    }
    for (const z of [-.66, .68]) box([1.19, .07, .07], [0, 1.76, z], 'details', DARK);
    box([1.12, .05, 1.3], [0, 1.82, -.05]);
    // The wheel on a raked column out of the cowl.
    strut(kit, [-.28, .96, -.64], [-.28, 1.04, -.45], .025, DARK);
    strut(kit, [-.28, 1.04, -.45], [-.28, 1.052, -.422], .16, DARK);
    // A roof light bar, because every buggy has one.
    for (const x of [-.33, -.11, .11, .33]) box([.17, .13, .06], [x, 1.905, -.66], 'headlights');
    box([.82, .42, .62], [0, .95, 1.38], 'details', ENGINE);
    box([1.06, .07, .07], [0, .74, 1.72], 'details', DARK);
    // A silencer across the back of the engine, resting on the bumper.
    tube(.075, .72, [0, .84, 1.72], 'x', CHROME);
    tube(.13, .26, [0, 1.29, 1.38], 'y', CHROME);
  },

  // A pickup body lifted clear of four tires that come up to its door handles.
  monster({ box, glass }) {
    box([.9, .24, 4.1], [0, 1.1, 0], 'details', DARK);
    for (const z of [-1.55, 1.55]) {
      box([2, .18, .18], [0, .85, z], 'details', DARK);
      box([.4, .36, .4], [0, .85, z], 'details', ENGINE);
      // Long-travel shocks in a V from each axle up under the fenders.
      for (const side of [-1, 1]) for (const lean of [-1, 1]) box([.09, 1, .09], [side * .56, 1.3, z + lean * .2], 'details', SHOCK, lean * .42);
    }
    // The body clears the tires: a fender line over them, the cab's sills
    // down between them, and a bed sunk into the back.
    box([2.05, .38, 2.8], [0, 1.92, -.85]);
    box([2.05, .22, 1.7], [0, 1.84, 1.4]);
    box([2.05, .3, 1.64], [0, 1.6, 0]);
    box([1.2, .1, 1.2], [0, 2.16, -1.5]);
    glass([1.8, .7, 1.55], [0, 2.46, -.25]);
    box([1.78, .12, 1.3], [0, 2.85, -.19]);
    // A painted cab back under the rear window, which is also the bed's front.
    box([1.84, .32, .1], [0, 2.27, .5]);
    box([1.75, .06, 1.64], [0, 1.96, 1.37], 'details', BED);
    box([1.75, .6, .08], [0, 2.1, 2.23]);
    box([.3, .05, .02], [0, 2.3, 2.28], 'details', DARK);
    for (const side of [-1, 1]) {
      box([.085, .7, .12], [side * .88, 2.46, -.1]);
      box([.09, .72, .1], [side * .86, 2.46, .465], 'paint', undefined, -.17);
      box([.15, .48, 1.72], [side * .95, 2.19, 1.39]);
      // Mirrors on stalks off the doors.
      box([.1, .18, .24], [side * 1.12, 2.32, -.8]);
      box([.26, .04, .04], [side * .96, 2.24, -.8], 'details', DARK);
      box([.09, 1, .09], [side * .8, 2.49, .75], 'details', DARK);
      box([.36, .2, .05], [side * .66, 1.94, -2.275], 'headlights');
      box([.13, .42, .04], [side * .95, 2.12, 2.27], 'taillights');
    }
    // Roll bar across the bed with a row of spots on it, lenses to the front.
    box([1.69, .09, .09], [0, 2.95, .75], 'details', DARK);
    for (const x of [-.5, -.17, .17, .5]) {
      box([.24, .18, .1], [x, 3.08, .76], 'details', DARK);
      box([.2, .14, .02], [x, 3.08, .7], 'headlights');
    }
    box([.76, .22, .05], [0, 1.94, -2.275], 'details', DARK);
    for (const z of [-2.3, 2.3]) box([2.1, .24, .22], [0, 1.64, z], 'details', CHROME);
  },

  // A chopped coupe on bare rails: skinny fronts, fat rears, and a blower
  // standing out of the bonnet.
  hotrod(kit) {
    const { box, tapered, tube } = kit;
    // Half the bonnet's width along its length, for the headers to leave from.
    const bonnet = z => .37 + .13 * (z + 1.79) / 1.62;
    for (const side of [-1, 1]) {
      box([.12, .15, 3.9], [side * .4, .525, 0], 'details', DARK);
      // Four headers sweeping down into a side pipe that stops short of both tires.
      for (let i = 0; i < 4; i++) {
        const z = -1.25 + i * .2;
        strut(kit, [side * (bonnet(z) - .03), .86, z], [side * .72, .64, z + .14], .042, CHROME);
      }
      tube(.07, 1.65, [side * .72, .62, -.325], 'z', CHROME);
      // Bucket lamps on stalks from a bar across the frame horns.
      box([.05, .22, .05], [side * .58, .765, -1.76], 'details', CHROME);
      tube(.11, .16, [side * .58, .98, -1.76], 'z', CHROME);
      strut(kit, [side * .58, .98, -1.835], [side * .58, .98, -1.855], .09, null, 'headlights');
      strut(kit, [side * .4, .86, 1.97], [side * .4, .86, 2.02], .075, null, 'taillights');
    }
    box([1.3, .06, .06], [0, .63, -1.76], 'details', CHROME);
    box([1.6, .1, .08], [0, .4, -1.5], 'details', CHROME);
    box([1.3, .12, .12], [0, .56, 1.15], 'details', DARK);
    box([.92, .06, .06], [0, .52, 1.93], 'details', CHROME);
    // The grille shell, barred.
    box([.74, .66, .12], [0, .88, -1.84], 'details', CHROME);
    box([.56, .5, .04], [0, .88, -1.91], 'details', DARK);
    for (const x of [-.18, -.06, .06, .18]) box([.02, .5, .02], [x, .88, -1.935], 'details', CHROME);
    tapered([1, .52, 1.62], [0, .86, -.98], { at: -1, x: .74 });
    // The blower, and its scoop's open mouth facing the wind.
    box([.4, .22, .56], [0, 1.21, -1], 'details', CHROME);
    block(kit, [-1.22, -1.22, .21, .21, 1.31, 1.53], [-.88, -.88, .19, .17, 1.31, 1.42], 'details', CHROME);
    box([.34, .16, .02], [0, 1.43, -1.225], 'details', DARK);
    // A three-window cab: door glass, then a painted back sloping from the
    // roof to the deck, with a small window let into it.
    box([1.34, .6, 1.35], [0, .9, .47]);
    block(kit, [-.05, .11, .61, .575, 1.2, 1.56], [.8, .66, .61, .575, 1.2, 1.56], 'details', GLASS);
    block(kit, [.7, .6, .615, .58, 1.2, 1.56], [1.145, .93, .615, .58, 1.2, 1.56]);
    block(kit, [1.0736, .9704, .38, .36, 1.3039, 1.4767], [1.0908, .9876, .38, .36, 1.3142, 1.487], 'details', GLASS);
    box([1.2, .1, .86], [0, 1.6, .5]);
    tapered([1.34, .6, .85], [0, .9, 1.55], { at: 1, x: .8, y: .55, lift: -.05 });
  },

  // A long-nose tractor unit running bobtail: a raised-roof sleeper, twin
  // stacks and a fifth wheel with nothing on it.
  rig({ box, tapered, glass, tube }) {
    const RED = '#e0513d', BLUE = '#3f68b0';
    // Two rails, the axles under them, and the fifth wheel on its mounting
    // with its throat open to the back.
    for (const side of [-1, 1]) box([.2, .3, 7.1], [side * .4, .75, .05], 'details', DARK);
    box([1.76, .15, .15], [0, .56, -2.5], 'details', DARK);
    for (const z of [1.85, 3.05]) {
      box([1.26, .16, .16], [0, .56, z], 'details', DARK);
      box([.36, .3, .3], [0, .56, z], 'details', ENGINE);
    }
    box([.9, .1, .5], [0, .94, 2.25], 'details', DARK);
    tube(.46, .12, [0, 1.04, 2.25], 'y', ENGINE);
    box([.16, .02, .42], [0, 1.105, 2.5], 'details', DARK);
    // A 1.9 m hood; the rest of the length goes behind the cab.
    tapered([1.7, .95, 1.9], [0, 1.5, -2.5], { at: -1, x: .88, y: .9, lift: -.04 });
    box([1.3, .85, .08], [0, 1.46, -3.49], 'details', CHROME);
    box([1.08, .66, .025], [0, 1.46, -3.54], 'details', DARK);
    for (const y of [1.25, 1.46, 1.67]) box([1.06, .035, .03], [0, y, -3.56], 'details', CHROME);
    box([2.4, .3, .25], [0, .7, -3.525], 'details', CHROME);
    box([2.2, .95, 1.8], [0, 1.5, -.65]);
    glass([2.05, .75, 1.7], [0, 2.35, -.65]);
    box([2, .12, 1.565], [0, 2.78, -.5325]);
    box([.06, .74, .055], [0, 2.35, -1.38], 'paint', undefined, .31);
    // The sleeper, its roof rising off the cab's in a short slope.
    box([2.1, 1.85, 1.4], [0, 1.95, .95]);
    box([2.1, .3, .95], [0, 3.025, 1.175]);
    tapered([2.1, .3, .45], [0, 3.025, .475], { at: -1, y: .1, lift: -.135 });
    // Its back, which the chase camera looks at all day: a lamp bar along the
    // top, a chrome skirt along the bottom, and the trailer's air lines
    // coiled up on a bracket between them.
    box([2.02, .12, .04], [0, 3.05, 1.67], 'details', CHROME);
    for (const x of [-.8, -.3, 0, .3, .8]) box([.14, .07, .03], [x, 3.05, 1.705], 'taillights');
    box([2.12, .22, .04], [0, 1.16, 1.67], 'details', CHROME);
    box([.5, .05, .06], [0, 1.9, 1.68], 'details', CHROME);
    box([.11, .55, .11], [-.11, 1.6, 1.71], 'details', RED);
    box([.11, .55, .11], [.11, 1.6, 1.71], 'details', BLUE);
    // A chrome bar across the tail carries the lamps, the mud flaps under it.
    box([2.2, .12, .08], [0, .94, 3.61], 'details', CHROME);
    for (const side of [-1, 1]) {
      // Fenders run back to the cab, with a mud flap behind each front wheel.
      tapered([.4, .25, 1.72], [side * 1.05, 1.22, -2.41], { at: -1, y: .55 });
      box([.36, .44, .03], [side * 1.05, .88, -1.6], 'details', DARK);
      box([.09, .75, .12], [side * 1, 2.35, -.4]);
      box([.065, .78, .065], [side * .99, 2.35, -1.37], 'details', CHROME, .31);
      box([.07, .065, 1.62], [side * 1.04, 1.99, -.65], 'details', CHROME);
      // West Coast mirrors on two arms, glass to the back.
      box([.06, .46, .2], [side * 1.24, 2.25, -1.25], 'details', CHROME);
      box([.05, .4, .02], [side * 1.24, 2.25, -1.14], 'details', GLASS);
      for (const y of [2.06, 2.44]) box([.26, .03, .03], [side * 1.1, y, -1.25], 'details', CHROME);
      box([.03, .3, .5], [side * 1.055, 2.5, 1.05], 'details', GLASS);
      box([.35, .24, .05], [side * 1.05, 1.2, -3.3], 'headlights');
      box([.3, .08, .03], [side * .78, .94, 3.665], 'taillights');
      box([.035, .075, .28], [side * 1.115, 1.84, -.15], 'details', CHROME);
      box([.25, .16, .8], [side * 1.08, .77, -.8], 'details', CHROME);
      box([.18, .12, .66], [side * 1.08, 1, -.8], 'details', ENGINE);
      tube(.09, 2.5, [side * 1.14, 2.25, .13], 'y', CHROME);
      tube(.3, 1.35, [side * .92, .82, .55], 'z', CHROME);
      box([.62, .62, .03], [side * .94, .58, 3.625], 'details', DARK);
    }
    for (const x of [-.7, -.35, 0, .35, .7]) box([.12, .07, .1], [x, 2.87, -1.23], 'details', AMBER);
  },

  // The traffic's own bus, its wheels left to turn
  bus({ parts }) {
    for (const [part, geometry] of Object.entries(busGeometry(BUS_MODEL, { wheels: false }))) parts[part].push(geometry);
  },

  // A cab-forward pumper after the fire station's old engine: a crew cab of
  // sloped glass under a white roof, roll-up lockers down the body, the
  // ladder on its rack over the hose bed, chrome at both ends, and beacons
  // on the cab's roof, in its nose and at the body's top corners.
  fireengine(kit) {
    const { box, glass, tube } = kit;
    const LOCKER = '#c3c7bf', WHITE = '#efebde', LADDER = '#d9dcd4', HOSE = '#d6c7a2', VALVE = '#c23a2e';
    const beacon = (side, size, at) => box(size, at, side < 0 ? 'beaconA' : 'beaconB', side < 0 ? '#e01e16' : '#e8e6dc');
    // Rails and axles
    for (const side of [-1, 1]) box([.2, .28, 7.6], [side * .42, .69, .05], 'details', DARK);
    box([1.9, .14, .14], [0, .55, -2.75], 'details', DARK);
    box([1.5, .16, .16], [0, .55, 2.3], 'details', DARK);
    box([.4, .3, .3], [0, .55, 2.3], 'details', ENGINE);
    // The cab's lower body, round the front wheels' arches
    box([2.44, .8, 2.55], [0, 1.6, -2.825]);
    box([2.44, .7, .63], [0, .85, -3.785]);
    box([2.44, .7, .48], [0, .85, -1.79]);
    // The crew cab: glass all round, its back solid where the body meets it,
    // pillars at the windscreen's corners and middle, and posts between the doors
    glass([2.3, .85, 2.3], [0, 2.425, -2.95], .28);
    // (up to the roof's underside: to its top, the two backs shared a plane over the body)
    box([2.36, .85, .25], [0, 2.425, -1.675]);
    box([2.22, .12, 2.36], [0, 2.91, -2.73], 'details', WHITE);
    for (const x of [-1.115, 0, 1.115]) box([x ? .09 : .06, .9, x ? .09 : .07], [x, 2.425, -3.96], 'paint', undefined, .318);
    // The grille, the lamps in chrome either side of it, a white band over
    // them all, and the bumper
    box([1.3, .6, .05], [0, 1.47, -4.12], 'details', CHROME);
    box([1.16, .48, .03], [0, 1.47, -4.155], 'details', DARK);
    for (const y of [1.34, 1.47, 1.6]) box([1.14, .035, .03], [0, y, -4.175], 'details', CHROME);
    box([2.44, .1, .03], [0, 1.87, -4.115], 'details', WHITE);
    box([2.46, .28, .18], [0, .64, -4.17], 'details', CHROME);
    // The light bar on the cab, a white lamp between its beacons, and air horns behind it
    box([1.7, .08, .3], [0, 3.01, -3.55], 'details', DARK);
    box([.36, .12, .26], [0, 3.11, -3.55], 'details', '#e8e6dc');
    // The body: lockers between the cab and the back wheels, over them and
    // behind them, all to the same top
    box([2.44, 2.2, 3.13], [0, 1.65, .015]);
    box([2.44, 1.55, 1.44], [0, 1.975, 2.3]);
    box([2.44, 2.2, 1.03], [0, 1.65, 3.535]);
    // The ladder on its rack, over the hose bed
    box([1.6, .14, 1.5], [0, 2.82, 3.15], 'details', HOSE);
    for (let z = -1.15; z < 3.95; z += .4) box([.94, .035, .035], [0, 3, z], 'details', LADDER);
    // The roll-up doors at the back, the tail lamps, and a step under them
    box([1.5, 1.7, .03], [0, 1.6, 4.065], 'details', LOCKER);
    for (let y = 1.05; y < 2.4; y += .35) box([1.5, .02, .02], [0, y, 4.087], 'details', DARK);
    box([.75, .05, .02], [0, .87, 4.087], 'details', CHROME);
    box([2.3, .1, .22], [0, .55, 4.11], 'details', CHROME);
    for (const side of [-1, 1]) {
      const x = side * 1.235, out = side * 1.256;
      // Pillars between the doors, handles, a white band along the cab and
      // the body, and a dark step behind the front wheel
      for (const z of [-3.25, -2.4]) box([.08, .85, .1], [side * 1.12, 2.425, z]);
      box([.03, .1, 2.55], [x, 1.87, -2.825], 'details', WHITE);
      box([.03, .1, 5.6], [x, 2.61, 1.25], 'details', WHITE);
      for (const z of [-2.55, -1.95]) box([.03, .04, .18], [x, 1.66, z], 'details', CHROME);
      box([.02, .3, .4], [side * 1.23, .85, -1.79], 'details', DARK);
      // Lamps, and beacons beside the grille
      box([.42, .3, .03], [side * .92, 1.4, -4.11], 'details', CHROME);
      box([.34, .22, .04], [side * .92, 1.4, -4.125], 'headlights');
      beacon(side, [.3, .12, .04], [side * .92, 1.66, -4.12]);
      // West Coast mirrors on two arms, glass to the back
      box([.05, .4, .16], [side * 1.265, 2.38, -3.78], 'details', CHROME);
      box([.03, .34, .02], [side * 1.265, 2.38, -3.69], 'details', GLASS);
      for (const y of [2.24, 2.52]) box([.14, .03, .03], [side * 1.18, y, -3.78], 'details', CHROME);
      for (const x of [.36, .64]) beacon(side, [.26, .14, .28], [side * x, 3.12, -3.55]);
      tube(.05, .36, [side * .8, 3.02, -3.05], 'z', CHROME);
      // The pump panel behind the cab: gauges and valves
      box([.03, 1.5, .6], [x, 1.65, -1.2], 'details', CHROME);
      for (const z of [-1.38, -1.2, -1.02]) box([.02, .12, .12], [out, 2.05, z], 'details', DARK);
      for (const z of [-1.32, -1.08]) box([.02, .08, .14], [out, 1.45, z], 'details', VALVE);
      // Roll-up locker doors between the wheels, over the back ones and behind them
      for (const [z, length, low, high] of [[-.3, 1.1, .7, 2.45], [.95, 1.1, .7, 2.45], [2.3, 1.3, 1.35, 2.5], [3.53, .9, .7, 2.45]]) {
        box([.03, high - low, length], [x, (low + high) / 2, z], 'details', LOCKER);
        for (let y = low + .3; y < high - .1; y += .35) box([.02, .02, length], [out, y, z], 'details', DARK);
        box([.02, .05, length * .5], [out, low + .12, z], 'details', CHROME);
      }
      // Rails along the top, the ladder's rails on their posts
      box([.05, .08, 5.5], [side * 1.17, 2.79, 1.25], 'details', CHROME);
      box([.06, .1, 5.3], [side * .5, 3, 1.35], 'details', LADDER);
      for (const z of [-1.1, 3.8]) box([.06, .2, .06], [side * .5, 2.85, z], 'details', DARK);
      // Dark liners inside the arches, and mud flaps behind the back wheels
      box([.06, .7, 1.44], [side * .82, .85, -2.75], 'details', DARK);
      box([.06, .65, 1.44], [side * .63, .875, 2.3], 'details', DARK);
      box([.48, .42, .03], [side * .96, .41, 3.06], 'details', DARK);
      // At the back: tail lamps and indicators in chrome (red on red was lost);
      // beacons on the body's top corners, seen from the side and behind
      box([.28, .7, .02], [side, 1.27, 4.06], 'details', CHROME);
      box([.2, .44, .04], [side, 1.15, 4.07], 'taillights');
      box([.2, .14, .04], [side, 1.48, 4.07], 'details', AMBER);
      for (const z of [-1.42, 3.88]) beacon(side, [.26, .26, .26], [side, 2.88, z]);
    }
  },

  // A box ambulance on a van's cab: white, with a red stripe and a cross on
  // each side, a side door at the curb, two doors at the back, and beacons
  // at the box's corners and in the grille.
  ambulance(kit) {
    const { box, glass } = kit, RED = '#c9362f';
    const beacon = (side, size, at) => box(size, at, side < 0 ? 'beaconA' : 'beaconB', side < 0 ? '#e01e16' : '#1f56e0');
    for (const side of [-1, 1]) box([.16, .2, 5.6], [side * .38, .55, .1], 'details', DARK);
    // The cab: a short bonnet falling to the grille, its body round the front
    // wheels' arches, sloped glass and a roof up to the box
    block(kit, [-3.05, -3.05, 1.08, 1.08, .92, 1.16], [-2.2, -2.2, 1.08, 1.08, .92, 1.3]);
    box([2.16, .38, 1.15], [0, 1.11, -1.625]);
    box([2.16, .47, .52], [0, .685, -2.79]);
    box([2.16, .47, .32], [0, .685, -1.21]);
    glass([2, .75, 1.15], [0, 1.675, -1.625], .3);
    box([1.96, .1, .9], [0, 2.1, -1.5]);
    // The grille, its lamps and beacons either side, and the bumper
    box([1, .36, .04], [0, .88, -3.07], 'details', CHROME);
    box([.88, .26, .02], [0, .88, -3.095], 'details', DARK);
    box([.86, .03, .02], [0, .88, -3.11], 'details', CHROME);
    box([2.14, .22, .16], [0, .52, -3.1], 'details', CHROME);
    // The box, its floor over the back wheels' arches, under a roof cap and
    // the air conditioning
    box([2.26, 2.25, 2.25], [0, 1.625, .075]);
    box([2.26, 1.83, 1.1], [0, 1.835, 1.75]);
    box([2.26, 2.25, .75], [0, 1.625, 2.675]);
    box([2.18, .06, 4.06], [0, 2.78, 1]);
    box([.9, .22, .8], [0, 2.92, 2.2], 'details', '#d8dcd6');
    // Its front over the cab: a red band and a white lamp between the beacons
    box([2.26, .1, .02], [0, 2.4, -1.06], 'details', RED);
    box([.9, .14, .05], [0, 2.6, -1.075], 'details', '#e8e6dc');
    // The curb side's door, its window and handle; a window opposite
    for (const z of [-.8, .2]) box([.02, 1.75, .03], [1.14, 1.5, z], 'details', DARK);
    box([.02, .45, .6], [1.14, 2.05, -.3], 'details', GLASS);
    box([.03, .04, .14], [1.16, 1.75, .05], 'details', CHROME);
    box([.02, .5, .8], [-1.14, 2.05, -.3], 'details', GLASS);
    // The back doors, their windows and handles, a red band between the
    // lamps, and the step
    box([.03, 2, .03], [0, 1.6, 3.065], 'details', DARK);
    box([1.6, .22, .02], [0, 1.45, 3.06], 'details', RED);
    box([2, .1, .18], [0, .5, 3.12], 'details', DARK);
    for (const side of [-1, 1]) {
      const x = side * 1.145;
      box([.08, .8, .08], [side * .97, 1.675, -2.05], 'paint', undefined, .38);
      box([.03, .12, 2], [side * 1.095, 1.04, -2.05], 'details', RED);
      box([.03, .04, .16], [side * 1.095, 1.2, -1.45], 'details', CHROME);
      box([.3, .18, .04], [side * .72, .96, -3.07], 'headlights');
      beacon(side, [.24, .08, .04], [side * .72, .8, -3.07]);
      box([.05, .34, .16], [side * 1.17, 1.62, -1.95], 'details', CHROME);
      box([.03, .28, .02], [side * 1.17, 1.62, -1.86], 'details', GLASS);
      for (const y of [1.5, 1.74]) box([.14, .03, .03], [side * 1.08, y, -1.95], 'details', CHROME);
      // The stripes down the box, and a cross over the back wheel: its
      // upright and two arms, no piece over another
      box([.03, .24, 4.1], [x, 1.45, 1], 'details', RED);
      box([.03, .08, 4.1], [x, 2.47, 1], 'details', RED);
      box([.02, .6, .2], [side * 1.14, 2, 1.75], 'details', RED);
      for (const dz of [-.2, .2]) box([.02, .2, .2], [side * 1.14, 2, 1.75 + dz], 'details', RED);
      // Beacons at the box's corners, front and back, on its face and round its sides
      for (const z of [-1.08, 3.08]) beacon(side, [.28, .2, .06], [side * .93, 2.6, z]);
      for (const z of [-.85, 2.85]) beacon(side, [.05, .2, .26], [side * 1.155, 2.63, z]);
      box([.66, .5, .02], [side * .45, 2.15, 3.06], 'details', GLASS);
      box([.12, .04, .03], [side * .2, 1.75, 3.065], 'details', CHROME);
      box([.16, .5, .04], [side, 1, 3.07], 'taillights');
      box([.16, .14, .04], [side, 1.35, 3.07], 'details', AMBER);
      // Dark liners in the arches, mud flaps behind the back wheels
      box([.06, .47, 1.16], [side * .78, .685, -1.95], 'details', DARK);
      box([.06, .42, 1.1], [side * .64, .71, 1.75], 'details', DARK);
      box([.44, .36, .03], [side * .9, .38, 2.4], 'details', DARK);
    }
  },

  // A bubble of glass on a roller skate, with the weekend's luggage on top.
  micro(kit) {
    const { box } = kit;
    // The tub in two halves meeting at its widest, under a canopy drawn in
    // toward a canvas roof; the canopy's foot is down inside the tub.
    const waist = [0, 0, .63, .63, .32, .9];
    block(kit, [-1.15, -1.08, .5, .508, .34, .78], waist);
    block(kit, waist, [1.15, 1.09, .54, .545, .34, .8]);
    block(kit, [-.8, -.6, .5, .5, .76, 1.12], [.74, .7, .53, .525, .76, 1.12], 'details', GLASS);
    block(kit, [-.6, -.28, .5, .4, 1.12, 1.5], [.7, .46, .525, .4, 1.12, 1.5], 'details', GLASS);
    // The pillar between the side windows: a slab through the canopy, only
    // its edges standing proud of the glass.
    block(kit, [.1, .1, .53, .526, .8, 1.12], [.17, .17, .53, .526, .8, 1.12]);
    block(kit, [.1, .1, .526, .412, 1.12, 1.5], [.17, .17, .526, .412, 1.12, 1.5]);
    box([.86, .05, .78], [0, 1.52, .08], 'details', CANVAS);
    for (const side of [-1, 1]) {
      strut(kit, [side * .33, .6, -1.16], [side * .33, .6, -1.04], .085, null, 'headlights');
      strut(kit, [side * .4, .62, 1.15], [side * .4, .62, 1.09], .06, null, 'taillights');
      box([.04, .04, .56], [side * .26, 1.565, .1], 'details', DARK);
    }
    // A chrome bar across the front between the lamps, as on a front-door
    // bubble car, and the engine's vent between the lamps at the back.
    box([.4, .03, .03], [0, .6, -1.115], 'details', CHROME);
    box([.34, .1, .03], [0, .66, 1.11], 'details', DARK);
    for (const z of [-1.16, 1.16]) box([1.06, .08, .1], [0, .42, z], 'details', CHROME);
    box([.46, .16, .38], [0, 1.66, .12], 'details', LEATHER);
    box([.48, .17, .04], [0, 1.66, .12], 'details', DARK);
  },
};

// Shapes the kit has no call for, cut from its own pieces as they go in: a
// tube from one point to another (pipes and stays that lean both ways, round
// lamps), and a block given by its two ends, each [bottom z, top z, half width
// at the bottom, half width at the top, bottom, top] (a canopy, a rounded tub).
function strut(kit, from, to, radius, color, category = 'details') {
  const a = new THREE.Vector3(...from), axis = new THREE.Vector3(...to).sub(a);
  kit.tube(radius, axis.length(), [0, 0, 0], 'y', color ?? '#ffffff');
  const geometry = kit.parts.details.pop();
  // A flat top and bottom to the octagon where it lies level.
  geometry.rotateY(Math.PI / 8);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize()));
  geometry.translate(...a.addScaledVector(axis, .5).toArray());
  if (!color) geometry.deleteAttribute('color');
  kit.parts[category].push(geometry);
}

function block(kit, front, rear, category = 'paint', color) {
  kit.box([2, 2, 2], [0, 0, 0], category, color);
  const geometry = kit.parts[category].at(-1), position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const [bottomZ, topZ, bottomHalf, topHalf, bottom, top] = position.getZ(i) < 0 ? front : rear, up = position.getY(i) > 0;
    position.setXYZ(i, Math.sign(position.getX(i)) * (up ? topHalf : bottomHalf), up ? top : bottom, up ? topZ : bottomZ);
  }
  geometry.computeVertexNormals();
}

// The kit's parts, each merged into one (a car without beacons has none)
function mergedParts(kit) {
  const parts = Object.fromEntries(Object.entries(kit.parts).filter(([, geometries]) => geometries.length).map(([key, geometries]) => [key, mergeGeometries(geometries)]));
  for (const geometries of Object.values(kit.parts)) for (const geometry of geometries) geometry.dispose();
  return parts;
}

// A special as the traffic draws it, in one (see createTrafficModels): its
// parts with the wheels fixed on as trim, which never turn. The demolition
// truck drives about in the traffic, and the emergency vehicles' stand-ins
// are knocked about in it (see PARKED_SPECIALS).
export function specialGeometry(shape) {
  const kit = partsKit();
  BUILDERS[shape.name](kit);
  for (const { radius, width, x, z } of Object.values(shape.wheels)) for (const side of [-1, 1]) {
    // (a vertex at the bottom keeps the tire on the road, as the traffic's do)
    const tire = new THREE.CylinderGeometry(radius, radius, width, 10);
    tire.rotateY(Math.PI / 2); tire.rotateZ(Math.PI / 2);
    kit.parts.details.push(tinted(tire, [side * x, radius, z], DARK));
    const hub = new THREE.CircleGeometry(radius * .48, 8); hub.rotateY(side * Math.PI / 2);
    kit.parts.details.push(tinted(hub, [side * (x + width / 2 + .006), radius, z], CHROME));
  }
  return mergedParts(kit);
}
function tinted(geometry, location, color) {
  geometry.deleteAttribute('uv');
  const tint = new THREE.Color(color), colors = [];
  for (let i = 0; i < geometry.attributes.position.count; i++) colors.push(tint.r, tint.g, tint.b);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry.translate(...location);
}

export function createSpecialCar(entry) {
  const shape = entry.shape, kit = partsKit();
  BUILDERS[shape.name](kit);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, flatShading: true, ...extra });
  // One draw for the body (see markedBody), its beacons dark until lit (see flash in vehicle.js)
  const head = lampGlow('#e9cc84', .24), tail = lampGlow('#b8220d', .1), beacons = { value: new THREE.Vector2() };
  const paint = bodyMaterial(entry.paint, { head: head.uniform, tail: tail.uniform, beacons });
  const tireMaterial = mat('#2b3434', { roughness: .9 }), hubMaterial = mat(CHROME);
  const shells = mergedParts(kit), flashes = Boolean(shells.beaconA || shells.beaconB);
  const shellGeometry = markedBody(shells, { head: '#fff5cf', tail: '#8e3328' });

  const car = new THREE.Group(); car.name = `car-${shape.name}`;
  const body = new THREE.Group(); car.add(body);
  const shell = new THREE.Mesh(shellGeometry, paint);
  shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
  const wheels = [], wheelGeometries = [];
  for (const [axle, { radius, width, x, z }] of Object.entries(shape.wheels)) {
    const tire = new THREE.CylinderGeometry(radius, radius, width, 14);
    const hubGeometry = new THREE.CylinderGeometry(radius * .48, radius * .48, width + .02, 10);
    wheelGeometries.push(tire, hubGeometry);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * x, radius, z); car.add(pivot);
      const wheel = new THREE.Mesh(tire, tireMaterial); wheel.rotation.z = Math.PI / 2; wheel.castShadow = true; pivot.add(wheel);
      const hub = new THREE.Mesh(hubGeometry, hubMaterial); hub.rotation.z = Math.PI / 2; pivot.add(hub);
      // The controller spins wheels for the wagon's tire; these turn at their own size.
      wheels.push({ pivot, wheel, hub, front: axle === 'front', spinRatio: .48 / radius });
    }
  }
  car.traverse(stableShadowDepth);
  return {
    car, body, wheels, beacons: flashes ? beacons.value : null,
    nightLights: [{ material: head.material, day: .24, night: 2.2 }, { material: tail.material, day: .1, night: 2.5 }],
    // A chosen car keeps its own paint and kit.
    applyTrim() {},
    paintCar(color) { paint.color.set(color || entry.paint); },
    disposeModel() {
      shellGeometry.dispose();
      for (const geometry of wheelGeometries) geometry.dispose();
      for (const material of [paint, tireMaterial, hubMaterial]) material.dispose();
    },
  };
}
