import * as THREE from 'three';
import { compactGeometry } from './compact-geometry.js';

// Closed solids for sloped roof ends and vaults, shared by the landmarks and
// monuments.
const triangle = new THREE.Shape();
triangle.moveTo(-.5, 0); triangle.lineTo(.5, 0); triangle.lineTo(.5, 1); triangle.closePath();
export const roofWedge = new THREE.ExtrudeGeometry(triangle, { depth: 1, steps: 1, bevelEnabled: false });
roofWedge.translate(0, 0, -.5);
compactGeometry(roofWedge);
const vaultProfile = new THREE.Shape();
for (let i = 0; i <= 12; i++) {
  const a = i / 12 * Math.PI;
  if (i) vaultProfile.lineTo(Math.cos(a), Math.sin(a)); else vaultProfile.moveTo(1, 0);
}
for (let i = 12; i >= 0; i--) { const a = i / 12 * Math.PI; vaultProfile.lineTo(Math.cos(a), Math.sin(a) - .025); }
vaultProfile.closePath();
export const vaultGeometry = new THREE.ExtrudeGeometry(vaultProfile, { depth: 1, steps: 1, bevelEnabled: false });
vaultGeometry.translate(0, 0, -.5);
compactGeometry(vaultGeometry);
