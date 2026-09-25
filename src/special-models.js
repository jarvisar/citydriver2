import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stableShadowDepth } from './world/shadow-depth.js';

// The garage's oddballs: machines that share no bodywork with the road fleet
// and are not meant to drive like it either. Like the coupe and the racer they
// are chooser-only, so the roads keep their ordinary-looking traffic.
//
// Each shape carries its own wheels, because none of them wears the road cars'
// set: `x` is the wheel's centre from the middle of the car, and the collision
// width is measured to the outside of the widest tyre. `eye` is where the
// first-person camera sits, `chaseLift` raises the chase camera over a tall roof,
// and `open` marks a car with no cabin to muffle it.
export const SPECIAL_SHAPES = {
  buggy: {
    name: 'buggy', width: 1.96, length: 3.4, eye: [0, 1.38, -.55], open: true,
    wheels: { front: { radius: .4, width: .26, x: .85, z: -1.15 }, rear: { radius: .52, width: .42, x: .77, z: 1.05 } },
  },
  monster: {
    name: 'monster', width: 2.7, length: 4.8, eye: [0, 2.6, -.95], chaseLift: 1,
    wheels: { front: { radius: .85, width: .7, x: 1, z: -1.55 }, rear: { radius: .85, width: .7, x: 1, z: 1.55 } },
  },
  hotrod: {
    name: 'hotrod', width: 2.02, length: 4, eye: [0, 1.4, -.3], open: true,
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
};

const DARK = '#2b3434', CHROME = '#bfc4b9', GLASS = '#344e55', ENGINE = '#59625f', SEAT = '#3a4441', BED = '#414c4b';
const SHOCK = '#d9a441', AMBER = '#e0a23a', CANVAS = '#e9e2cb', LEATHER = '#8a5a3a';

// The same faceted kit the road cars and the racer are cut from: boxes, a box
// with one end pulled in, sloped glass, and the odd tube. Paint takes the
// garage colour; everything in `details` carries its own.
function partsKit() {
  const parts = { paint: [], details: [], headlights: [], taillights: [] };
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
  // A bare tub in a roll cage, with the engine hung out behind the seats.
  buggy({ box, tapered, tube }) {
    box([1.16, .34, 2.2], [0, .66, .1]);
    tapered([1.1, .34, .75], [0, .66, -1.3], { at: -1, x: .55, y: .45, lift: -.06 });
    box([1.16, .2, .3], [0, .93, -.78]);
    box([1, .06, 2], [0, .47, .05], 'details', DARK);
    for (const side of [-1, 1]) {
      box([.42, .14, .5], [side * .28, .88, .2], 'details', SEAT);
      box([.42, .56, .13], [side * .28, 1.16, .5], 'details', SEAT);
      // Cage: a rear hoop, a raked front one, roof rails, and stays down to the engine.
      box([.07, .95, .07], [side * .56, 1.3, .68], 'details', DARK);
      box([.07, .9, .07], [side * .56, 1.33, -.78], 'details', DARK, .272);
      box([.07, .07, 1.41], [side * .56, 1.76, .01], 'details', DARK);
      box([.07, 1.02, .07], [side * .56, 1.38, 1.015], 'details', DARK, -.723);
      // Wishbones out to the wheels, lamp pods on the cowl, and lamps on the hoop.
      box([.5, .05, .08], [side * .6, .5, -1.15], 'details', DARK);
      box([.4, .07, .1], [side * .56, .56, 1.05], 'details', DARK);
      box([.2, .2, .1], [side * .5, .98, -.98], 'headlights');
      box([.12, .16, .05], [side * .56, 1.15, .74], 'taillights');
      tube(.05, .55, [side * .3, 1.32, 1.6], 'y', CHROME);
    }
    for (const z of [-.66, .68]) box([1.19, .07, .07], [0, 1.76, z], 'details', DARK);
    box([1.12, .05, 1.2], [0, 1.82, 0]);
    tube(.16, .04, [-.28, 1.12, -.5], 'z', DARK);
    // A roof light bar, because every buggy has one.
    for (const x of [-.33, -.11, .11, .33]) box([.17, .13, .06], [x, 1.91, -.68], 'headlights');
    box([.78, .42, .62], [0, .95, 1.38], 'details', ENGINE);
    tube(.13, .26, [0, 1.29, 1.38], 'y', CHROME);
  },

  // A pickup body lifted clear of four tyres that come up to its door handles.
  monster({ box, glass }) {
    box([.9, .24, 4.1], [0, 1.1, 0], 'details', DARK);
    for (const z of [-1.55, 1.55]) {
      box([2, .18, .18], [0, .85, z], 'details', DARK);
      box([.4, .36, .4], [0, .85, z], 'details', ENGINE);
      // Long-travel shocks in a V over each axle.
      for (const side of [-1, 1]) for (const lean of [-1, 1]) box([.09, .74, .09], [side * .62, 1.18, z + lean * .17], 'details', SHOCK, -lean * .42);
    }
    box([2.05, .66, 4.5], [0, 1.78, 0]);
    box([1.2, .1, 1.2], [0, 2.16, -1.5]);
    glass([1.8, .7, 1.55], [0, 2.46, -.25]);
    box([1.78, .12, 1.3], [0, 2.85, -.19]);
    box([1.75, .06, 1.6], [0, 2.13, 1.4], 'details', BED);
    box([2.05, .32, .15], [0, 2.27, 2.18]);
    for (const side of [-1, 1]) {
      box([.085, .7, .12], [side * .88, 2.46, -.1]);
      box([.15, .32, 1.72], [side * .95, 2.27, 1.39]);
      box([.2, .16, .26], [side * 1.1, 2.3, -.8]);
      box([.09, .85, .09], [side * .8, 2.55, .75], 'details', DARK);
      box([.42, .24, .05], [side * .68, 1.86, -2.275], 'headlights');
      box([.22, .3, .05], [side * .85, 1.8, 2.275], 'taillights');
    }
    // Roll bar across the bed with a row of spots on it.
    box([1.69, .09, .09], [0, 2.95, .75], 'details', DARK);
    for (const x of [-.5, -.17, .17, .5]) box([.24, .18, .08], [x, 3.08, .73], 'headlights');
    box([.8, .3, .05], [0, 1.84, -2.275], 'details', DARK);
    for (const z of [-2.3, 2.3]) box([2.1, .24, .22], [0, 1.4, z], 'details', CHROME);
  },

  // A chopped coupe on bare rails: skinny fronts, fat rears, and a blower
  // standing out of the bonnet.
  hotrod({ box, tapered, glass, tube }) {
    for (const side of [-1, 1]) {
      box([.12, .14, 3.9], [side * .4, .52, 0], 'details', DARK);
      box([.08, .36, .1], [side * .58, 1.38, .55]);
      // Four header stubs into a side pipe, and a lamp on a stalk.
      for (let i = 0; i < 4; i++) tube(.045, .3, [side * .56, .84, -1.45 + i * .28], 'x', CHROME);
      tube(.07, 2, [side * .72, .62, -.35], 'z', CHROME);
      box([.22, .22, .14], [side * .58, .98, -1.78], 'headlights');
      box([.05, .3, .05], [side * .58, .74, -1.78], 'details', CHROME);
      box([.13, .13, .05], [side * .4, .88, 1.995], 'taillights');
    }
    box([1.6, .08, .08], [0, .4, -1.5], 'details', CHROME);
    box([1.3, .12, .12], [0, .56, 1.15], 'details', DARK);
    box([.74, .66, .12], [0, .88, -1.84], 'details', CHROME);
    box([.56, .5, .04], [0, .88, -1.91], 'details', DARK);
    tapered([1, .52, 1.62], [0, .86, -.98], { at: -1, x: .74 });
    box([.42, .26, .6], [0, 1.24, -1], 'details', CHROME);
    box([.46, .16, .4], [0, 1.45, -1.05], 'details', DARK);
    box([1.34, .6, 1.35], [0, .9, .47]);
    glass([1.22, .36, 1], [0, 1.38, .45], .16);
    box([1.2, .1, .86], [0, 1.6, .5]);
    tapered([1.34, .6, .85], [0, .9, 1.55], { at: 1, x: .8, y: .55, lift: -.05 });
  },

  // A long-nose tractor unit running bobtail: a sleeper, twin stacks and
  // a fifth wheel with nothing on it.
  rig({ box, tapered, glass, tube }) {
    box([1, .3, 7.1], [0, .75, .05], 'details', DARK);
    // A 1.9 m hood; the rest of the length goes behind the cab.
    tapered([1.7, .95, 1.9], [0, 1.5, -2.5], { at: -1, x: .88, y: .9, lift: -.04 });
    box([1.3, .85, .08], [0, 1.46, -3.49], 'details', CHROME);
    box([1.08, .66, .025], [0, 1.46, -3.54], 'details', DARK);
    for (const y of [1.25, 1.46, 1.67]) box([1.06, .035, .03], [0, y, -3.56], 'details', CHROME);
    box([2.4, .3, .25], [0, .7, -3.525], 'details', CHROME);
    box([2.2, .95, 1.8], [0, 1.5, -.65]);
    glass([2.05, .75, 1.7], [0, 2.35, -.65]);
    box([2, .12, 1.45], [0, 2.78, -.59]);
    box([.06, .74, .055], [0, 2.35, -1.38], 'paint', undefined, .31);
    box([2.1, 1.85, 1.4], [0, 1.95, .95]);
    tapered([2, .5, 1.4], [0, 3.12, .95], { at: -1, y: .2, lift: -.2 });
    tube(.46, .12, [0, 1.02, 2.25], 'y', ENGINE);
    for (const side of [-1, 1]) {
      tapered([.4, .25, 1.55], [side * 1.05, 1.22, -2.5], { at: -1, y: .55 });
      box([.09, .75, .12], [side * 1, 2.35, -.4]);
      box([.065, .78, .065], [side * .99, 2.35, -1.37], 'details', CHROME, .31);
      box([.07, .065, 1.62], [side * 1.04, 1.99, -.65], 'details', CHROME);
      box([.2, .3, .14], [side * 1.15, 2.2, -1.35]);
      box([.35, .24, .05], [side * 1.05, 1.2, -3.3], 'headlights');
      box([.3, .16, .05], [side * .34, .78, 3.625], 'taillights');
      box([.035, .075, .28], [side * 1.115, 1.84, -.15], 'details', CHROME);
      box([.25, .16, .8], [side * 1.08, .77, -.8], 'details', CHROME);
      box([.18, .12, .66], [side * 1.08, 1, -.8], 'details', ENGINE);
      tube(.09, 2.3, [side * 1.14, 2.25, .13], 'y', CHROME);
      tube(.3, 1.35, [side * .92, .82, .55], 'z', CHROME);
      box([.62, .5, .04], [side * .94, .7, 3.63], 'details', DARK);
    }
    for (const x of [-.7, -.35, 0, .35, .7]) box([.12, .07, .1], [x, 2.87, -1.23], 'details', AMBER);
  },

  // A bubble of glass on a roller skate, with the weekend's luggage on top.
  micro({ box, tapered, glass }) {
    tapered([1.3, .6, 1.3], [0, .64, -.5], { at: -1, x: .78, y: .7 });
    tapered([1.3, .6, 1.3], [0, .64, .5], { at: 1, x: .84, y: .8 });
    glass([1.2, .6, 1.5], [0, 1.24, -.05], .3);
    box([1.04, .07, .98], [0, 1.56, .03], 'details', CANVAS);
    for (const side of [-1, 1]) {
      box([.07, .6, .09], [side * .58, 1.24, .1]);
      box([.2, .2, .06], [side * .36, .74, -1.165], 'headlights');
      box([.14, .12, .05], [side * .4, .74, 1.165], 'taillights');
      box([.05, .05, .8], [side * .34, 1.62, .1], 'details', DARK);
    }
    for (const z of [-1.16, 1.16]) box([1.06, .08, .1], [0, .42, z], 'details', CHROME);
    box([.52, .22, .7], [0, 1.76, .1], 'details', LEATHER);
    for (const z of [-.1, .3]) box([.54, .24, .05], [0, 1.76, z], 'details', DARK);
  },
};

export function createSpecialCar(entry) {
  const shape = entry.shape, kit = partsKit();
  BUILDERS[shape.name](kit);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, flatShading: true, ...extra });
  const paint = mat(entry.paint);
  const trim = mat('#ffffff', { vertexColors: true });
  const front = mat('#fff5cf', { emissive: '#e9cc84', emissiveIntensity: .24 });
  const rear = mat('#8e3328', { emissive: '#b8220d', emissiveIntensity: .1 });
  const tireMaterial = mat('#2b3434', { roughness: .9 }), hubMaterial = mat(CHROME);
  const shells = Object.entries(kit.parts).map(([key, geometries]) => [key, mergeGeometries(geometries)]);
  for (const geometries of Object.values(kit.parts)) for (const geometry of geometries) geometry.dispose();

  const car = new THREE.Group(); car.name = `car-${shape.name}`;
  const body = new THREE.Group(); car.add(body);
  for (const [key, geometry] of shells) {
    const mesh = new THREE.Mesh(geometry, { paint, details: trim, headlights: front, taillights: rear }[key]);
    mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
  }
  const wheels = [], wheelGeometries = [];
  for (const [axle, { radius, width, x, z }] of Object.entries(shape.wheels)) {
    const tire = new THREE.CylinderGeometry(radius, radius, width, 14);
    const hubGeometry = new THREE.CylinderGeometry(radius * .48, radius * .48, width + .02, 10);
    wheelGeometries.push(tire, hubGeometry);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * x, radius, z); car.add(pivot);
      const wheel = new THREE.Mesh(tire, tireMaterial); wheel.rotation.z = Math.PI / 2; wheel.castShadow = true; pivot.add(wheel);
      const hub = new THREE.Mesh(hubGeometry, hubMaterial); hub.rotation.z = Math.PI / 2; pivot.add(hub);
      // The controller spins wheels for the wagon's tyre; these turn at their own size.
      wheels.push({ pivot, wheel, hub, front: axle === 'front', spinRatio: .48 / radius });
    }
  }
  car.traverse(stableShadowDepth);
  return {
    car, body, wheels,
    nightLights: [{ material: front, day: .24, night: 2.2 }, { material: rear, day: .1, night: 2.5 }],
    // A chosen car keeps its own paint and kit.
    applyTrim() {},
    paintCar(color) { paint.color.set(color || entry.paint); },
    disposeModel() {
      for (const [, geometry] of shells) geometry.dispose();
      for (const geometry of wheelGeometries) geometry.dispose();
      for (const material of [paint, trim, front, rear, tireMaterial, hubMaterial]) material.dispose();
    },
  };
}
