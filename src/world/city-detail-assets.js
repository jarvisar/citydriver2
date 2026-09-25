import * as THREE from 'three';
import { Parts } from './city-assets.js';

// Shared, static templates: modest facets for recognizable silhouettes, with
// trim baked into the same instance instead of separate meshes per detail.
const cream = '#ede0bf', dark = '#354e58', metal = '#b9c2b7';
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
export const signalLens = new THREE.CircleGeometry(1, 12);

export function round(c, x, y, s, w, h, d, color, axis = 'y', kind = 'solid', yaw = 0) {
  const scale = axis === 'x' ? [h / 2, w, d / 2] : axis === 'z' ? [h / 2, d, w / 2] : [w / 2, h, d / 2];
  c.item(`detail-round-${kind}`, cylinder, c.materials[kind], [x, y, -s], scale, color,
    yaw + (axis === 'z' ? Math.PI / 2 : 0), axis === 'y' ? 0 : Math.PI / 2);
}

function clockGeometry() {
  const p = new Parts();
  // Inlaid markings share one surface with the dial. Stacked planes only a few
  // millimetres apart flicker as depth precision falls off down the street.
  p.add(new THREE.RingGeometry(.89, 1, 24), [0, 0, .05], '#577e77');
  const dial = new THREE.Shape(Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * Math.PI * 2; return new THREE.Vector2(Math.cos(a) * .89, Math.sin(a) * .89);
  }));
  const inlay = points => {
    const vertices = points.map(([x, y]) => new THREE.Vector2(x, y));
    dial.holes.push(new THREE.Path(vertices));
    p.add(new THREE.ShapeGeometry(new THREE.Shape(vertices)), [0, 0, .05], dark);
  };
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, h = (i % 3 ? .09 : .15) / 2;
    inlay([[-.0225, .75 - h], [.0225, .75 - h], [.0225, .75 + h], [-.0225, .75 + h]]
      .map(([x, y]) => [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)]));
  }
  inlay([[-.04, -.04], [.44, -.04], [.44, .04], [.04, .04], [.04, .535], [-.04, .535]]);
  p.add(new THREE.ShapeGeometry(dial), [0, 0, .05], '#f5e9bf');
  return p.finish();
}
export const clockFace = clockGeometry();
export function clock(c, x, y, s, diameter, yaw = 0) {
  c.item('detail-clock', clockFace, c.materials.clock, [x, y, -s], [diameter / 2, diameter / 2, 1], '#ffffff', yaw);
}

// Sloped cab glazing and ten-sided tires match the ordinary traffic fleet.
function fireEngineGeometry() {
  const p = new Parts(), red = '#b94f3e';
  p.box([0, 1.05, 0], [4.7, .5, 11.6], dark);
  p.box([0, 1.8, 0], [4.8, 1.35, 11.8], red);
  p.box([0, 2.4, -3.65], [4.65, 1, 4.1], red);
  const cab = new THREE.BoxGeometry(4.5, 1.3, 3.8), v = cab.attributes.position;
  for (let i = 0; i < v.count; i++) if (v.getY(i) > 0) {
    v.setX(i, v.getX(i) * .94);
    v.setZ(i, v.getZ(i) + (v.getZ(i) < 0 ? .3 : -.08));
  }
  cab.computeVertexNormals(); p.add(cab, [0, 3.35, -3.65], '#45646b');
  p.box([0, 4.07, -3.52], [4.4, .18, 3.55], cream);
  p.box([0, 3.35, -5.45], [.12, 1.25, .2], red);
  p.box([0, 2.75, 1.9], [4.7, .9, 7.6], red);
  for (const side of [-1, 1]) {
    p.box([side * 2.32, 3.35, -2.6], [.14, 1.4, .18], red);
    p.box([side * 2.6, 3.25, -4.9], [.32, .48, .24], dark);
    p.box([side * 2.41, 2.25, 0], [.05, .18, 11.5], cream);
    for (const z of [-.65, 1.8, 4.25]) {
      p.box([side * 2.39, 2.65, z], [.07, .9, 2.1], metal);
      p.box([side * 2.44, 2.35, z], [.07, .08, .5], dark);
    }
    p.cylinder([side * 1.65, 1.75, -5.96], .26, .26, .12, '#f5deb0', 10, [Math.PI / 2, 0, 0]);
    p.box([side * 1.95, 1.6, 5.96], [.35, .55, .1], '#d27755');
    p.cylinder([side * 1.25, 4.35, -3.8], .25, .3, .4, '#df795b', 8);
    for (const z of [-3.8, 3.8]) {
      p.cylinder([side * 2.4, .8, z], .8, .8, .65, '#293437', 10, [0, 0, Math.PI / 2]);
      p.cylinder([side * 2.4, .8, z], .4, .4, .69, metal, 8, [0, 0, Math.PI / 2]);
    }
    p.box([side * 1.25, 3.55, 1.8], [.16, .2, 7.5], metal);
  }
  for (let z = -1.4; z < 5.6; z += 1) p.box([0, 3.55, z], [2.5, .14, .14], metal);
  p.box([0, 1.9, -5.97], [2.2, .7, .1], dark);
  for (const y of [1.7, 1.95, 2.2]) p.box([0, y, -6.04], [2.1, .065, .07], metal);
  for (const z of [-6, 6]) p.box([0, 1.03, z], [4.9, .28, .3], metal);
  return p.finish();
}
export const fireEngine = fireEngineGeometry();
