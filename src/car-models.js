import * as THREE from 'three';
import { vehicleGeometry, WHEEL } from './traffic-models.js';
import { stableShadowDepth } from './world/shadow-depth.js';

// Drive one of the road-car shapes. The bodywork is the same merged geometry
// traffic uses, with the wheels left loose so they can steer and spin.
export function createShapeCar(entry) {
  const { paint: paintGeometry, details: trimGeometry, headlights: frontGeometry, taillights: rearGeometry, wheels: placements } =
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
    const part = (size, p, material) => {
      const geometry = new THREE.BoxGeometry(...size), mesh = new THREE.Mesh(geometry, material);
      taxiGeometry.push(geometry); mesh.position.set(...p); body.add(mesh); return mesh;
    };
    const roof = (entry.shape.cabinY ?? 1.22) + entry.shape.cabin[1] - (entry.shape.drop ?? 0);
    part([1.25, .45, .5], [0, roof + .26, 0], light).name = 'taxi-sign';
    for (const side of [-1, 1]) for (let i = 0; i < 10; i++) {
      part([.035, .14, .16], [side * (entry.shape.width / 2 + .015), .95 + (i % 2) * .14, -.8 + i * .17], black);
    }
    if (globalThis.document) {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 48;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff0b6'; ctx.fillRect(0, 0, 128, 48);
      ctx.fillStyle = '#222820'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('TAXI', 64, 37);
      taxiTexture = new THREE.CanvasTexture(canvas); taxiTexture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: taxiTexture }); taxiMaterials.push(material);
      for (const side of [-1, 1]) {
        const geometry = new THREE.PlaneGeometry(1.19, .42), mesh = new THREE.Mesh(geometry, material); taxiGeometry.push(geometry);
        mesh.position.set(0, roof + .26, side * .256); mesh.rotation.y = side < 0 ? Math.PI : 0; body.add(mesh);
      }
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
