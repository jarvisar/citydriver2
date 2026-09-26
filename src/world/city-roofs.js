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

// A glasshouse's visible structure follows the very same twelve roof facets.
// Broad ribs, at most nine, are enough to explain the curved glass surface.
// Reuse the closed shell as a thin arch; no per-site geometry or new material.
export function vaultRibs(c, x, s, halfWidth, rise, depth, base, yaw = 0, wallBottom = null) {
  if (c.distant) return;
  const count = Math.min(8, Math.max(2, Math.round(depth / 3.5)));
  for (let i = 0; i <= count; i++) {
    const along = (i / count - .5) * (depth - .16);
    c.item('roof-vault-rib', vaultGeometry, c.materials.solid,
      [x - Math.sin(yaw) * along, base + .035, -(s + Math.cos(yaw) * along)],
      [halfWidth + .035, rise + .035, .14], '#e1e5d7', yaw);
    if (wallBottom !== null && Math.abs(along) > 1.5) for (const side of [-1, 1]) {
      const across = side * (halfWidth + .03);
      c.box(x + Math.cos(yaw) * across - Math.sin(yaw) * along, (base + wallBottom) / 2,
        s + Math.sin(yaw) * across + Math.cos(yaw) * along, .14, base - wallBottom, .14, '#e1e5d7', 'solid', yaw);
    }
  }
  c.box(x, base + rise + .055, s, .16, .14, depth, '#e1e5d7', 'solid', yaw);
}
