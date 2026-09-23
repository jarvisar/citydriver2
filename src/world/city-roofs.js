import * as THREE from 'three';
import { compactGeometry } from './compact-geometry.js';

// Reusable closed solids replace stacks of overlapping boxes at sloped ends.
// All roof pieces keep the building's rigid frame at both detail levels.
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
export const mansardGeometry = new THREE.BoxGeometry(1, 1, 1);
const vertices = mansardGeometry.attributes.position;
for (let i = 0; i < vertices.count; i++) {
  const upper = vertices.getY(i) > 0;
  vertices.setXYZ(i, vertices.getX(i) * (upper ? .7 : 1), vertices.getY(i) + .5, vertices.getZ(i) * (upper ? .7 : 1));
}
mansardGeometry.computeVertexNormals();

export function wedge(c, x, s, base, width, rise, depth, color, descending = false) {
  c.item('roof-fill', roofWedge, c.materials.solid, [x, base, -s], [width, rise, depth], color, descending ? Math.PI : 0);
}

// Eave is the underside at the OUTER roof edge, independent of roof width.
export function pitchedRoof(c, x, s, width, depth, eave, color, gable = null, pitch = .36, options = {}) {
  const { wallWidth = width - .8, wallDepth = depth - .8, thickness = .34, trim = '#d9c9a9', ridge = true } = options;
  const run = width / 2, rise = run * Math.tan(pitch), center = eave + rise / 2 + thickness / (2 * Math.cos(pitch));
  for (const side of [-1, 1]) {
    c.box(x + side * run / 2, center, s, run / Math.cos(pitch), thickness, depth, color, 'solid', 0, -side * pitch);
    if (trim) for (const end of [-1, 1]) c.box(x + side * run / 2, center - .04, s + end * (depth / 2 + .03), run / Math.cos(pitch), thickness + .12, .16, trim, 'solid', 0, -side * pitch);
  }
  // A small raised ridge covers the panel meeting line without coplanar faces.
  if (ridge) {
    // The ridge also caps the two fascia ends. Its front/back extend beyond
    // those trims, so their crossing never exposes competing coplanar faces.
    const top = eave + rise + thickness / Math.cos(pitch) + .1;
    c.box(x, top - .35, s, .5, .7, depth + .3, color);
  }
  if (gable) {
    const foot = eave + (width - wallWidth) / 2 * Math.tan(pitch), h = wallWidth / 2 * Math.tan(pitch);
    for (const side of [-1, 1]) wedge(c, x + side * wallWidth / 4, s, foot, wallWidth / 2, h, wallDepth, gable, side > 0);
  }
  return { eave, ridge: eave + rise, top: eave + rise + thickness / Math.cos(pitch) + .1 };
}

export function butterflyRoof(c, b, roof) {
  const { x, s, width: w, depth: d } = b;
  const gutter = .9, width = w + .6, depth = d + .7;
  const run = (width - gutter) / 2, rise = Math.min(3.2, Math.max(1.6, w * .09));
  const pitch = Math.atan2(rise, run), low = roof + .9, thickness = .38;
  const trim = '#ded1b2', sideWall = .28, endWall = .26;
  // The roof starts above the wall, including its LOWEST point at the gutter.
  // Glazed end infills and a continuous fascia explain the deliberate V shape.
  // Keep the backing inside the enclosure: full-width faces would overlap
  // the glazing and side walls, causing z-fighting as the camera moves.
  c.box(x, roof + .4, s, w - 2 * sideWall, .8, d - 2 * endWall, b.wall);
  for (const side of [-1, 1]) {
    const cx = x + side * (gutter / 2 + run / 2), center = low + rise / 2 + thickness / (2 * Math.cos(pitch));
    c.box(cx, center, s, run / Math.cos(pitch), thickness, depth, b.accent, 'solid', 0, side * pitch);
    for (const end of [-1, 1]) {
      c.box(cx, center - .06, s + end * (depth / 2 + .03), run / Math.cos(pitch), .58, .2, trim, 'solid', 0, side * pitch);
      // The infill top meets the roof underside; its lower edge joins the wall.
      // Stop at the inner side-wall face so the corner has only one exterior.
      const wallRun = (w - gutter) / 2 - sideWall, h = wallRun * Math.tan(pitch);
      const wx = x + side * (gutter / 2 + wallRun / 2), ws = s + end * (d / 2 - endWall / 2);
      wedge(c, wx, ws, low, wallRun, h, endWall, '#668e91', side < 0);
      c.box(wx, roof + .45, ws, wallRun, .9, endWall, '#668e91');
      for (let i = 1; i <= 3; i++) {
        const dx = gutter / 2 + wallRun * i / 4, height = .9 + wallRun * i / 4 * Math.tan(pitch);
        c.box(x + side * dx, roof + height / 2, ws + end * .16, .16, height, .15, trim);
      }
    }
    const eave = low + (w - gutter) / 2 * Math.tan(pitch);
    c.box(x + side * (w / 2 - sideWall / 2), (roof + eave) / 2, s, sideWall, eave - roof, d, b.wall);
    c.box(x + side * (width / 2), low + rise + .13, s, .22, .52, depth + .2, trim);
  }
  // A shallow, narrow drainage channel replaces the old exposed black trough.
  c.box(x, low + .02, s, gutter + .14, .18, depth + .14, '#768e8e');
  for (const side of [-1, 1]) c.box(x + side * (gutter / 2 - .08), low + .215, s, .12, .21, depth + .14, '#a9b9af');
  for (const end of [-1, 1]) {
    c.box(x, roof + .45, s + end * (d / 2 - endWall / 2), gutter, .9, endWall, b.wall);
    if (!c.distant) c.box(x, roof - 1.3, s + end * (d / 2 + .17), .18, 4.3, .18, '#869e97');
  }
}

export function mansardRoof(c, x, s, w, d, base, rise, color) {
  c.item('roof-mansard', mansardGeometry, c.materials.solid, [x, base, -s], [w, rise, d], color);
}

export function barrelRoof(c, x, s, w, d, eave, color, trim = '#ede0bf') {
  c.item('roof-vault', vaultGeometry, c.materials.solid, [x, eave, -s], [w / 2, w * .275, d], color);
  for (const side of [-1, 1]) c.item('roof-vault', vaultGeometry, c.materials.solid,
    [x, eave + .05, -(s + side * (d / 2 - .14))], [w / 2 + .18, w * .275 + .18, .5], trim);
}

export function sawtoothRoof(c, b, roof) {
  const count = Math.max(2, Math.floor(b.width / 9)), span = b.width - 2, run = span / count, depth = b.depth - 3;
  const rise = run * Math.tan(.22), base = roof + .4, thickness = .25;
  for (let i = 0; i < count; i++) {
    const x = b.x - span / 2 + (i + .5) * run;
    c.box(x, base + rise / 2 + thickness / (2 * Math.cos(.22)), b.s, run / Math.cos(.22), thickness, depth, b.roof, 'solid', 0, .22);
    // Close the high glazed face and both triangular ends all the way to the deck.
    c.box(x + run / 2 - .06, base + rise / 2, b.s, .12, rise, depth - .48, '#829d9f', 'glass');
    for (const end of [-1, 1]) {
      wedge(c, x, b.s + end * (depth / 2 - .12), base, run, rise, .24, b.wall);
      c.box(x, base + rise / 2 + .1, b.s + end * (depth / 2 + .02), run / Math.cos(.22), .38, .15, '#d4c4a6', 'solid', 0, .22);
    }
    c.box(x + run / 2, base + rise + thickness / Math.cos(.22) + .07, b.s, .24, .18, depth + .15, '#bfc1ad');
  }
  c.box(b.x, roof + .2, b.s, span, .4, depth, b.wall);
}
