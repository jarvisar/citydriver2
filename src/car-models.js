import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bodyProfile, heightAt, vehicleGeometry, WHEEL } from './traffic-models.js';
import { stableShadowDepth } from './world/shadow-depth.js';

// A taxi's chequers run along its doors in two rows of squares, clear of the
// wheel arches and under the shoulder (heights before the shape's drop).
export function taxiChequers(shape) {
  const { body, bottom, top } = bodyProfile(shape);
  const size = .13, high = heightAt(top, 0) - body.shoulder[1] - .03, low = high - 2 * size;
  let reach = 0;
  while (heightAt(bottom, reach + .01) < low - .03 && heightAt(bottom, -reach - .01) < low - .03) reach += .01;
  const count = Math.floor((2 * reach - .1) / size);
  return { size, low, count, start: -count * size / 2 };
}

// Drive one of the road-car shapes. The bodywork is the same merged geometry
// traffic uses, with the wheels left loose so they can steer and spin.
export function createShapeCar(entry) {
  const { paint: paintGeometry, details: trimGeometry, headlights: frontGeometry, taillights: rearGeometry, wheels: placements, roof } =
    vehicleGeometry(entry.shape, { separateWheels: true });
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, flatShading: true, ...extra });
  const paint = mat(entry.paint);
  const trim = mat('#ffffff', { vertexColors: true });
  const front = mat('#fff5cf', { emissive: '#e9cc84', emissiveIntensity: .24 });
  const rear = mat('#8e3328', { emissive: '#b8220d', emissiveIntensity: .1 });
  const tireMaterial = mat('#2b3434'), hubMaterial = mat('#bfc4b9');
  const car = new THREE.Group(); car.name = `car-${entry.shape.name}`;
  const body = new THREE.Group(); car.add(body);
  const taxiGeometry = [], taxiMaterials = []; let taxiTexture;
  if (entry.taxi) {
    const black = mat('#242925'), light = mat('#fff0b6', { emissive: '#ffe997', emissiveIntensity: .35 });
    taxiMaterials.push(black, light);
    const mesh = (geometry, material, name) => {
      const part = new THREE.Mesh(geometry, material); part.name = name; taxiGeometry.push(geometry); body.add(part); return part;
    };
    const boxAt = (size, [x, y, z]) => new THREE.BoxGeometry(...size).translate(x, y, z);
    // A roof sign on a slim black foot, centred on the roof itself.
    const sign = [.9, .3, .34], signY = roof.y + .04 + sign[1] / 2;
    mesh(boxAt(sign, [0, signY, roof.z]), light, 'taxi-sign');
    // The chequers are thin plates, so the paint shows between them.
    const { size, low, count, start } = taxiChequers(entry.shape), drop = entry.shape.drop ?? 0;
    const plates = [boxAt([sign[0] + .04, .04, sign[2] + .04], [0, roof.y + .02, roof.z])];
    for (const side of [-1, 1]) for (let i = 0; i < count; i++) {
      plates.push(boxAt([.012, size, size], [side * (entry.shape.width / 2 + .006), low + size * (i % 2 + .5) - drop, start + size * (i + .5)]));
    }
    mesh(mergeGeometries(plates), black, 'taxi-chequers');
    plates.forEach(g => g.dispose());
    if (globalThis.document) {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 52;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff0b6'; ctx.fillRect(0, 0, 160, 52);
      ctx.fillStyle = '#222820'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('TAXI', 80, 41);
      taxiTexture = new THREE.CanvasTexture(canvas); taxiTexture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: taxiTexture }); taxiMaterials.push(material);
      const faces = [-1, 1].map(side => {
        const face = new THREE.PlaneGeometry(sign[0] - .06, sign[1] - .04);
        if (side < 0) face.rotateY(Math.PI);
        return face.translate(0, signY, roof.z + side * (sign[2] / 2 + .006));
      });
      mesh(mergeGeometries(faces), material, 'taxi-sign-faces');
      faces.forEach(g => g.dispose());
    }
  }
  const shells = [[paintGeometry, paint], [trimGeometry, trim], [frontGeometry, front], [rearGeometry, rear]];
  for (const [geometry, material] of shells) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
  }
  const tireGeometry = new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.width, 12);
  const hubGeometry = new THREE.CylinderGeometry(WHEEL.hubRadius, WHEEL.hubRadius, WHEEL.hubWidth, 10);
  const wheels = placements.map(({ x, y, z, front: steered }) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, z); car.add(pivot);
    const wheel = new THREE.Mesh(tireGeometry, tireMaterial); wheel.rotation.z = Math.PI / 2; wheel.castShadow = true; pivot.add(wheel);
    const hub = new THREE.Mesh(hubGeometry, hubMaterial); hub.rotation.z = Math.PI / 2; pivot.add(hub);
    return { pivot, wheel, hub, front: steered };
  });
  car.traverse(stableShadowDepth);
  return {
    car, body, wheels,
    nightLights: [{ material: front, day: .24, night: 2.2 }, { material: rear, day: .1, night: 2.5 }],
    // A chosen car keeps its own paint and kit.
    applyTrim() {},
    paintCar(color) { paint.color.set(color || entry.paint); },
    disposeModel() {
      taxiTexture?.dispose(); taxiGeometry.forEach(g => g.dispose()); taxiMaterials.forEach(m => m.dispose());
      for (const geometry of [paintGeometry, trimGeometry, frontGeometry, rearGeometry, tireGeometry, hubGeometry]) geometry.dispose();
      for (const material of [paint, trim, front, rear, tireMaterial, hubMaterial]) material.dispose();
    },
  };
}
