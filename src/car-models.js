import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bodyMaterial, bodyProfile, heightAt, lampGlow, markedBody, vehicleGeometry, wheelGeometry, WHEEL } from './traffic-models.js';
import { stableShadowDepth } from './world/shadow-depth.js';
import { exoticGeometry } from './exotic-model.js';

// A taxi's checkers run along its doors in two rows of squares, clear of the
// wheel arches and under the shoulder (heights before the shape's drop).
export function taxiChequers(shape) {
  const { body, bottom, top } = bodyProfile(shape);
  const size = .13, high = heightAt(top, 0) - body.shoulder[1] - .03, low = high - 2 * size;
  let reach = 0;
  while (heightAt(bottom, reach + .01) < low - .03 && heightAt(bottom, -reach - .01) < low - .03) reach += .01;
  const count = Math.floor((2 * reach - .1) / size);
  return { size, low, count, start: -count * size / 2 };
}

// A cab's roof sign on a slim black foot, centered on the roof, and the
// checkers, thin plates so the paint shows between them. The garage's cabs
// and the traffic's share them.
const SIGN = [.9, .3, .34];
function cabTrim(shape, roof) {
  const boxAt = (size, [x, y, z]) => new THREE.BoxGeometry(...size).translate(x, y, z);
  const signY = roof.y + .04 + SIGN[1] / 2;
  const { size, low, count, start } = taxiChequers(shape), drop = shape.drop ?? 0;
  const plates = [boxAt([SIGN[0] + .04, .04, SIGN[2] + .04], [0, roof.y + .02, roof.z])];
  for (const side of [-1, 1]) for (let i = 0; i < count; i++) {
    plates.push(boxAt([.012, size, size], [side * (shape.width / 2 + .006), low + size * (i % 2 + .5) - drop, start + size * (i + .5)]));
  }
  const chequers = mergeGeometries(plates);
  plates.forEach(g => g.dispose());
  return { sign: boxAt(SIGN, [0, signY, roof.z]), signY, chequers };
}

// TAXI in bars across both faces of a sign at `signY`: the traffic's cabs
// can't have the garage's lettering, a texture. Each letter is the same
// either way round, so the far face only needs them in the other order.
function signLetters(roof, signY) {
  const h = .15, w = .032, wide = .1, gap = .045, bars = [];
  const bar = (x, y, across, high, tilt, z) => bars.push(new THREE.BoxGeometry(across, high, .012).rotateZ(tilt).translate(x, y, z));
  for (const side of [-1, 1]) {
    const z = roof.z + side * (SIGN[2] / 2 + .004);
    [...'TAXI'].forEach((letter, i) => {
      const x = side * (i - 1.5) * (wide + gap), y = signY, half = (wide - w) / 2, lean = Math.atan2(half, h), leg = Math.hypot(half, h);
      if (letter === 'T') { bar(x, y + (h - w) / 2, wide, w, 0, z); bar(x, y - w / 2, w, h - w, 0, z); }
      else if (letter === 'I') bar(x, y, w, h, 0, z);
      else if (letter === 'A') { bar(x - half / 2, y, w, leg, -lean, z); bar(x + half / 2, y, w, leg, lean, z); bar(x, y - h * .18, wide * .5, w * .8, 0, z); }
      else { const cross = Math.atan2(2 * half, h), long = Math.hypot(2 * half, h); bar(x, y, w, long, -cross, z); bar(x, y, w, long, cross, z); }
    });
  }
  const letters = mergeGeometries(bars);
  bars.forEach(g => g.dispose());
  return letters;
}

// A cab in the traffic, in one draw (see createTrafficModels): the sedan with
// the sign and checkers, the sign lit as a headlamp so it glows after dark.
export function cabGeometry(shape) {
  const parts = vehicleGeometry(shape), { sign, signY, chequers } = cabTrim(shape, parts.roof);
  const tint = (geometry, color) => {
    geometry.deleteAttribute('uv');
    const c = new THREE.Color(color), colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  };
  sign.deleteAttribute('uv');
  const join = (geometry, ...more) => { const joined = mergeGeometries([geometry, ...more]); for (const each of [geometry, ...more]) each.dispose(); return joined; };
  return { paint: parts.paint, details: join(parts.details, tint(chequers, '#242925'), tint(signLetters(parts.roof, signY), '#222820')), headlights: join(parts.headlights, sign), taillights: parts.taillights };
}

// Road cars share traffic's bodywork. The Exotic brings its own shell, with
// the same paint, lamps and loose wheels so they can steer and spin.
export function createShapeCar(entry) {
  const { paint: paintGeometry, details: trimGeometry, headlights: frontGeometry, taillights: rearGeometry, wheels: placements, roof } =
    entry.shape.name === 'exotic' ? exoticGeometry(WHEEL) : vehicleGeometry(entry.shape, { separateWheels: true });
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .74, flatShading: true, ...extra });
  // One draw for the body and one per wheel (see markedBody, wheelGeometry)
  const head = lampGlow('#e9cc84', .24), tail = lampGlow('#b8220d', .1);
  const paint = bodyMaterial(entry.paint, { head: head.uniform, tail: tail.uniform });
  const wheelMaterial = mat('#ffffff', { vertexColors: true });
  const car = new THREE.Group(); car.name = `car-${entry.shape.name}`;
  const body = new THREE.Group(); car.add(body);
  const taxiGeometry = [], taxiMaterials = []; let taxiTexture;
  if (entry.taxi) {
    const black = mat('#242925'), light = mat('#fff0b6', { emissive: '#ffe997', emissiveIntensity: .35 });
    taxiMaterials.push(black, light);
    const mesh = (geometry, material, name) => {
      const part = new THREE.Mesh(geometry, material); part.name = name; taxiGeometry.push(geometry); body.add(part); return part;
    };
    const { sign: signGeometry, signY, chequers } = cabTrim(entry.shape, roof), sign = SIGN;
    mesh(signGeometry, light, 'taxi-sign');
    mesh(chequers, black, 'taxi-chequers');
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
  const shellGeometry = markedBody({ paint: paintGeometry, details: trimGeometry, headlights: frontGeometry, taillights: rearGeometry }, { head: '#fff5cf', tail: '#8e3328' });
  const shell = new THREE.Mesh(shellGeometry, paint);
  shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
  const tireGeometry = new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.width, 12);
  const hubGeometry = new THREE.CylinderGeometry(WHEEL.hubRadius, WHEEL.hubRadius, WHEEL.hubWidth, 10);
  const wheelShape = wheelGeometry(tireGeometry, hubGeometry, '#2b3434', '#bfc4b9');
  tireGeometry.dispose(); hubGeometry.dispose();
  const wheels = placements.map(({ x, y, z, front: steered }) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, z); car.add(pivot);
    const wheel = new THREE.Mesh(wheelShape, wheelMaterial); wheel.rotation.z = Math.PI / 2; wheel.castShadow = true; pivot.add(wheel);
    return { pivot, wheel, hub: wheel, front: steered };
  });
  car.traverse(stableShadowDepth);
  return {
    car, body, wheels,
    nightLights: [{ material: head.material, day: .24, night: 2.2 }, { material: tail.material, day: .1, night: 2.5 }],
    // A chosen car keeps its own paint and kit.
    applyTrim() {},
    paintCar(color) { paint.color.set(color || entry.paint); },
    disposeModel() {
      taxiTexture?.dispose(); taxiGeometry.forEach(g => g.dispose()); taxiMaterials.forEach(m => m.dispose());
      shellGeometry.dispose(); wheelShape.dispose();
      for (const material of [paint, wheelMaterial]) material.dispose();
    },
  };
}
