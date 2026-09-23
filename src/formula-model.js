import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stableShadowDepth } from './world/shadow-depth.js';

// An open-wheel racer: a narrow carbon tub slung between four exposed slicks,
// with a front wing, sidepods, an airbox and a rear wing. Like the coupe it is
// chooser-only, so the roads keep their ordinary-looking fleet.
export const FORMULA_SHAPE = {
  name: 'formula', width: 1.9, length: 5.2,
  // The chooser reads these the way it reads a road car's measurements.
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
  // One end of a box pulled in, the way the road cars' glass is, keeps the
  // nose cone and engine cover faceted rather than smoothly lofted.
  const tapered = (size, location, { at, x, y = 1, lift = 0 }) => {
    const geometry = new THREE.BoxGeometry(...size), position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) if (Math.sign(position.getZ(i)) === at) {
      position.setX(i, position.getX(i) * x); position.setY(i, position.getY(i) * y + lift);
    }
    geometry.computeVertexNormals(); add(geometry, location);
  };

  // Floor plank and rear diffuser: the flat carbon the whole car sits on.
  box([.78, .1, 3.5], [0, .15, .2], 'details', CARBON);
  box([.86, .22, .34], [0, .21, 2.25], 'details', CARBON);
  // Nose cone, tub and the raised cockpit sides.
  tapered([.56, .3, 1.25], [0, .42, -2], { at: -1, x: .5, y: .5, lift: -.05 });
  const halfCabin = entry.taxi ? .57 : .3;
  box([halfCabin * 2 + .06, .34, 2.5], [0, .37, -.15]);
  for (const side of [-1, 1]) box([.1, .22, 1.3], [side * halfCabin, .63, .05]);
  box([halfCabin * 2 - .08, .06, 1.3], [0, .57, .05], 'details', DARK);
  // Driver: a helmet and visor sunk into the opening.
  const driverX = entry.taxi ? -.28 : 0;
  add(new THREE.SphereGeometry(.16, 8, 6), [driverX, .84, -.04], 'details', SUIT);
  box([.25, .07, .04], [driverX, .85, -.2], 'details', DARK);
  if (entry.taxi) {
    // A real second seat beside the driver, with its own back and headrest.
    box([.4, .09, .64], [.28, .61, -.02], 'details', CARBON);
    box([.4, .33, .12], [.28, .74, .32], 'details', CARBON);
    box([.23, .16, .12], [.28, .97, .32], 'details', SUIT);
    for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
      box([.018, .1, .13], [side * .615, .4 + (i % 2) * .1, -.7 + i * .14], 'details', DARK);
    }
    box([.68, .2, .25], [0, 1.1, .85]);
  }
  // Halo: two side rails meeting a single pillar ahead of the driver.
  box([.09, .28, .09], [0, .75, -.62], 'details', CARBON);
  box([halfCabin * 2 + .04, .07, .09], [0, .89, -.6], 'details', CARBON);
  for (const side of [-1, 1]) box([.07, .07, 1.3], [side * (halfCabin + .01), .89, -.03], 'details', CARBON);
  // Sidepods with dark radiator inlets, and mirrors on their leading edge.
  for (const side of [-1, 1]) {
    tapered([.4, .38, 1.5], [side * .42, .38, .45], { at: 1, x: .45, y: .6 });
    box([.34, .3, .06], [side * .42, .4, -.32], 'details', DARK);
    box([.17, .08, .07], [side * .45, .72, -.42]);
  }
  // Airbox and the engine cover tapering into the rear wing.
  box([.4, .42, .34], [0, .78, .85]);
  box([.26, .2, .05], [0, .82, .67], 'details', DARK);
  tapered([.5, .44, 1.6], [0, .56, 1.35], { at: 1, x: .38, y: .5, lift: -.1 });
  // Front wing, its flap and endplates.
  box([1.5, .07, .5], [0, .26, -2.32], 'details', CARBON);
  box([1.42, .06, .28], [0, .36, -2.5], 'details', CARBON);
  for (const side of [-1, 1]) box([.06, .3, .62], [side * .78, .35, -2.36], 'details', CARBON);
  // Rear wing on a central pylon, carbon like the wing it carries so it does
  // not read as a fin in the paint colour from behind.
  box([.14, .42, .3], [0, .84, 2.1], 'details', CARBON);
  box([1.05, .07, .42], [0, 1.08, 2.15], 'details', CARBON);
  box([1, .06, .26], [0, 1.22, 2.28], 'details', CARBON);
  for (const side of [-1, 1]) box([.06, .52, .66], [side * .5, 1.02, 2.14], 'details', CARBON);
  // Pushrods and wishbones reaching out to each exposed wheel.
  for (const side of [-1, 1]) for (const z of [-FORMULA_SHAPE.wheelZ, FORMULA_SHAPE.wheelZ]) {
    for (const y of [.3, .56]) box([.62, .05, .07], [side * .42, y, z], 'details', CARBON);
    box([.07, .05, .5], [side * .42, .43, z + (z < 0 ? .3 : -.3)], 'details', CARBON);
  }
  // A rear rain light keeps the racer visible on the midnight route.
  box([.14, .12, .05], [0, .92, 2.28], 'taillights');
  if (entry.taxi) for (const side of [-1, 1]) box([.2, .1, .05], [side * .54, .39, -2.57], 'headlights');

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
      sign.position.set(0, 1.1, .85 + side * .126); sign.rotation.y = side < 0 ? Math.PI : 0; body.add(sign);
    }
  }
  for (const [key, geometry] of shells) {
    const mesh = new THREE.Mesh(geometry, { paint, details: trim, taillights: rear, headlights: front }[key]);
    mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
  }
  const { radius, width, rearWidth, hubRadius, x } = FORMULA_WHEEL;
  const frontTire = new THREE.CylinderGeometry(radius, radius, width, 12);
  const rearTire = new THREE.CylinderGeometry(radius, radius, rearWidth, 12);
  const hubGeometry = new THREE.CylinderGeometry(hubRadius, hubRadius, rearWidth + .02, 10);
  const wheels = [];
  for (const side of [-1, 1]) for (const z of [-FORMULA_SHAPE.wheelZ, FORMULA_SHAPE.wheelZ]) {
    const steered = z < 0;
    const pivot = new THREE.Group(); pivot.position.set(side * x, radius, z); car.add(pivot);
    const wheel = new THREE.Mesh(steered ? frontTire : rearTire, tireMaterial);
    wheel.rotation.z = Math.PI / 2; wheel.castShadow = true; pivot.add(wheel);
    const hub = new THREE.Mesh(hubGeometry, hubMaterial); hub.rotation.z = Math.PI / 2; pivot.add(hub);
    wheels.push({ pivot, wheel, hub, front: steered });
  }
  car.traverse(stableShadowDepth);
  return {
    car, body, wheels,
    nightLights: [{ material: rear, day: .15, night: 2.6 }, ...(front ? [{ material: front, day: .3, night: 2.2 }] : [])],
    // A chosen car keeps its own paint and kit on every route.
    applyTrim() {},
    paintCar(color) { paint.color.set(color || entry.paint); },
    disposeModel() {
      for (const [, geometry] of shells) geometry.dispose();
      for (const geometry of [frontTire, rearTire, hubGeometry]) geometry.dispose();
      for (const material of [paint, trim, rear, tireMaterial, hubMaterial]) material.dispose();
      front?.dispose();
      for (const resource of signResources) resource.dispose();
    },
  };
}
