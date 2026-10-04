import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stableShadowDepth } from './world/shadow-depth.js';

// An open-wheel racer: a narrow carbon tub slung between four exposed slicks,
// with a front wing, sidepods, an airbox and a rear wing. Like the coupe it is
// chooser-only, so the roads keep their ordinary-looking fleet.
export const FORMULA_SHAPE = {
  name: 'formula', width: 1.9, length: 5.2,
  // The chooser draws the wheels from `wheelRadius` and `wheelZ`.
  cabin: [.62, .34, 1.1], cabinZ: .12, cabinY: .52, wheelRadius: .38, wheelZ: 1.66,
  // First person sits just ahead of the halo rather than behind a windshield.
  eye: [0, .88, -.76],
};

export const FORMULA_WHEEL = { radius: .38, width: .34, rearWidth: .42, hubRadius: .17, x: .74 };

const CARBON = '#2e3538', DARK = '#161b1d', SUIT = '#e7e3d5';

export function createFormulaCar(entry) {
  const parts = { paint: [], details: [], taillights: [] };
  if (entry.taxi) parts.headlights = [];
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
  const box = (size, location, category, color) => add(new THREE.BoxGeometry(...size), location, category, color);
  // One end of a box pulled in (and slid across by `shift`), the way the road
  // cars' glass is, keeps the nose cone and engine cover faceted rather than
  // smoothly lofted.
  const tapered = (size, location, { at, x = 1, y = 1, lift = 0, shift = 0 }, category, color) => {
    const geometry = new THREE.BoxGeometry(...size), position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) if (Math.sign(position.getZ(i)) === at) {
      position.setX(i, position.getX(i) * x + shift); position.setY(i, position.getY(i) * y + lift);
    }
    geometry.computeVertexNormals(); add(geometry, location, category, color);
  };
  // A carbon bar from one point to another (wishbones, pushrods, the halo),
  // run on past both ends by its thickness so joints close.
  const strut = (from, to, thick = .045) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const geometry = new THREE.BoxGeometry(thick, thick, a.distanceTo(b) + thick);
    geometry.lookAt(b.clone().sub(a));
    add(geometry, a.add(b).multiplyScalar(.5).toArray(), 'details', CARBON);
  };
  const taxi = Boolean(entry.taxi);
  const halfCabin = taxi ? .57 : .3, halfTub = halfCabin + .03;

  // Floor plank, the wider floor between the wheels (its edge shows under the
  // sidepods) and the diffuser ramping up under the gearbox.
  box([.78, .1, 3.5], [0, .15, .2], 'details', CARBON);
  box([1.28, .05, 2.3], [0, .17, 0], 'details', CARBON);
  tapered([.86, .22, .72], [0, .21, 2.06], { at: -1, y: .3, lift: -.075 }, 'details', CARBON);
  // Nose cone flush with the tub, and a scuttle rising from the tub to the
  // front of the cockpit rim, where the halo stands.
  tapered([.66, .34, 1.23], [0, .37, -2.015], { at: -1, x: .42, y: .5, lift: -.03 });
  box([.66, .34, 2.5], [0, .37, -.15]);
  tapered([halfTub * 2, .24, .5], [0, .62, -.85], { at: -1, x: .33 / halfTub, y: .1, lift: -.087 });
  for (const side of [-1, 1]) box([.1, .22, 1.3], [side * halfCabin, .63, .05]);
  box([halfCabin * 2 - .08, .06, 1.3], [0, .57, .05], 'details', DARK);
  // Driver: a helmet sunk into the opening, its visor a band of the same
  // facets just proud of it across the front quarter.
  const driverX = taxi ? -.28 : 0;
  add(new THREE.SphereGeometry(.16, 8, 6), [driverX, .87, -.04], 'details', SUIT);
  add(new THREE.SphereGeometry(.166, 2, 1, Math.PI * 1.25, Math.PI / 2, Math.PI / 2, Math.PI / 6), [driverX, .87, -.04], 'details', DARK);
  // Sidepods: dark radiator inlets in their fronts, sweeping in and down to
  // the engine cover behind. The two-seater's run forward, square, to make
  // its wider tub, and taper only behind the cockpit.
  const podFront = taxi ? -1.05 : -.3;
  for (const side of [-1, 1]) {
    if (taxi) {
      box([.32, .38, 1.85], [side * .46, .38, -.125]);
      tapered([.32, .38, .5], [side * .46, .38, 1.05], { at: 1, x: .5, shift: -side * .21, y: .5, lift: -.095 });
    } else tapered([.4, .38, 1.5], [side * .42, .38, .45], { at: 1, x: .4, shift: -side * .16, y: .45, lift: -.1045 });
    box([taxi ? .24 : .32, .28, .03], [side * (taxi ? .46 : .42), .38, podFront - .01], 'details', DARK);
    // Mirrors on short stalks from the cockpit sides.
    box([.15, .07, .06], [side * (halfCabin + .17), .72, -.42]);
    box([.08, .035, .03], [side * (halfCabin + .085), .71, -.42]);
  }
  if (taxi) {
    // A real second seat beside the driver, with its own back and headrest.
    box([.4, .09, .64], [.28, .61, -.02], 'details', CARBON);
    box([.4, .33, .12], [.28, .74, .32], 'details', CARBON);
    box([.23, .16, .12], [.28, .97, .32], 'details', CARBON);
    for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
      box([.018, .1, .13], [side * .628, .4 + (i % 2) * .1, -.5 + i * .14], 'details', DARK);
    }
    // The roof sign stands on a plinth, so it sits level on the sloping airbox.
    box([.24, .16, .22], [0, .9, .845]);
    box([.68, .2, .25], [0, 1.05, .845]);
  }
  // Halo: a pillar on the scuttle and a hoop round the driver's head that
  // drops to the cockpit rim behind it.
  const hoop = [[0, .94, -.6], [halfCabin - .08, .96, -.4], [halfCabin - .03, .95, .05], [halfCabin - .01, .73, .32]];
  strut([0, .68, -.69], hoop[0], .07);
  for (const side of [-1, 1]) for (let i = 1; i < hoop.length; i++) {
    const [ax, ay, az] = hoop[i - 1], [bx, by, bz] = hoop[i];
    strut([side * ax, ay, az], [side * bx, by, bz], .06);
  }
  // Engine cover down to the gearbox, the airbox over the driver's head
  // sweeping back into it, and the crash structure under the rear wing.
  tapered([.5, .58, 1.6], [0, .49, 1.35], { at: 1, x: .38, y: .53, lift: -.075 });
  tapered([.36, .44, .8], [0, .76, .93], { at: 1, x: .5, y: .45, lift: -.2 });
  box([.24, .2, .04], [0, .84, .52], 'details', DARK);
  box([.16, .14, .3], [0, .36, 2.28], 'details', CARBON);
  // Front wing: the main plane leading, the flap above and behind it, both
  // meeting the endplates.
  box([1.5, .06, .36], [0, .24, -2.44], 'details', CARBON);
  box([1.5, .05, .26], [0, .34, -2.24], 'details', CARBON);
  for (const side of [-1, 1]) box([.05, .26, .56], [side * .77, .33, -2.38], 'details', CARBON);
  // Rear wing on a central pylon from the crash structure, carbon like the
  // wing it carries so it does not read as a fin in the paint color.
  box([.07, .64, .22], [0, .74, 2.14], 'details', CARBON);
  box([1.05, .07, .42], [0, 1.08, 2.15], 'details', CARBON);
  box([1, .06, .26], [0, 1.22, 2.28], 'details', CARBON);
  for (const side of [-1, 1]) box([.06, .52, .66], [side * .5, 1.02, 2.14], 'details', CARBON);
  // Double wishbones from the tub to each upright (inside the hub), and a
  // pushrod from the front upright up to the top of the nose.
  for (const side of [-1, 1]) for (const z of [-FORMULA_SHAPE.wheelZ, FORMULA_SHAPE.wheelZ]) {
    const front = z < 0, inner = front ? .19 : .09, legs = front ? [z - .22, z + .24] : [z - .24, z + .22];
    for (const [from, to] of [[.47, .5], [.3, .28]]) for (const leg of legs) strut([side * inner, from, leg], [side * .62, to, z]);
    if (front) strut([side * .6, .3, z + .03], [side * .13, .49, z + .12], .035);
  }
  // A rain light on the crash structure keeps the racer visible at night.
  box([.12, .08, .03], [0, .37, 2.44], 'taillights');
  if (taxi) for (const side of [-1, 1]) box([.18, .06, .05], [side * .5, .3, -2.6], 'headlights');

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .58, flatShading: true, ...extra });
  const paint = mat(entry.paint);
  const trim = mat('#ffffff', { vertexColors: true });
  const rear = mat('#8e3328', { emissive: '#e02a12', emissiveIntensity: .15 });
  const front = entry.taxi ? mat('#fff0b6', { emissive: '#ffe997', emissiveIntensity: .3 }) : null;
  const tireMaterial = mat('#23282b', { roughness: .9 }), hubMaterial = mat('#c8ccbe', { metalness: .25 });
  const shells = Object.entries(parts).map(([key, geometries]) => [key, mergeGeometries(geometries)]);
  for (const geometries of Object.values(parts)) for (const geometry of geometries) geometry.dispose();

  const car = new THREE.Group(); car.name = `car-${entry.shape.name}`;
  car.userData.seats = entry.taxi ? 2 : 1;
  const body = new THREE.Group(); car.add(body);
  const signResources = [];
  if (entry.taxi && globalThis.document) {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 40;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff0b6'; ctx.fillRect(0, 0, 128, 40);
    ctx.fillStyle = '#172229'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('TAXI', 64, 32);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const geometry = new THREE.PlaneGeometry(.66, .19);
    signResources.push(texture, material, geometry);
    for (const side of [-1, 1]) {
      const sign = new THREE.Mesh(geometry, material); sign.name = 'taxi-sign';
      sign.position.set(0, 1.05, .845 + side * .13); sign.rotation.y = side < 0 ? Math.PI : 0; body.add(sign);
    }
  }
  for (const [key, geometry] of shells) {
    const mesh = new THREE.Mesh(geometry, { paint, details: trim, taillights: rear, headlights: front }[key]);
    mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
  }
  const { radius, width, rearWidth, hubRadius, x } = FORMULA_WHEEL;
  const frontTire = new THREE.CylinderGeometry(radius, radius, width, 12);
  const rearTire = new THREE.CylinderGeometry(radius, radius, rearWidth, 12);
  // Each hub just proud of its own tire: a rear-width hub stood out of the
  // narrower fronts' inner faces.
  const frontHub = new THREE.CylinderGeometry(hubRadius, hubRadius, width + .02, 10);
  const rearHub = new THREE.CylinderGeometry(hubRadius, hubRadius, rearWidth + .02, 10);
  const wheels = [];
  for (const side of [-1, 1]) for (const z of [-FORMULA_SHAPE.wheelZ, FORMULA_SHAPE.wheelZ]) {
    const steered = z < 0;
    const pivot = new THREE.Group(); pivot.position.set(side * x, radius, z); car.add(pivot);
    const wheel = new THREE.Mesh(steered ? frontTire : rearTire, tireMaterial);
    wheel.rotation.z = Math.PI / 2; wheel.castShadow = true; pivot.add(wheel);
    const hub = new THREE.Mesh(steered ? frontHub : rearHub, hubMaterial); hub.rotation.z = Math.PI / 2; pivot.add(hub);
    wheels.push({ pivot, wheel, hub, front: steered });
  }
  car.traverse(stableShadowDepth);
  return {
    car, body, wheels,
    nightLights: [{ material: rear, day: .15, night: 2.6 }, ...(front ? [{ material: front, day: .3, night: 2.2 }] : [])],
    // A chosen car keeps its own paint and kit.
    applyTrim() {},
    paintCar(color) { paint.color.set(color || entry.paint); },
    disposeModel() {
      for (const [, geometry] of shells) geometry.dispose();
      for (const geometry of [frontTire, rearTire, frontHub, rearHub]) geometry.dispose();
      for (const material of [paint, trim, rear, tireMaterial, hubMaterial]) material.dispose();
      front?.dispose();
      for (const resource of signResources) resource.dispose();
    },
  };
}
