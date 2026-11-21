import * as THREE from 'three';
import { Parts } from './city-assets.js';
import { compactGeometry } from './compact-geometry.js';

// Clipped foliage still has a broad top, but its shoulders taper instead of
// meeting in the sharp right angles of a concrete wall. Twenty shared faces.
const hedgeProfile = new THREE.Shape();
hedgeProfile.moveTo(-.5, 0); hedgeProfile.lineTo(.5, 0);
hedgeProfile.lineTo(.5, .73); hedgeProfile.lineTo(.32, 1);
hedgeProfile.lineTo(-.32, 1); hedgeProfile.lineTo(-.5, .73); hedgeProfile.closePath();
export const clippedHedge = new THREE.ExtrudeGeometry(hedgeProfile, { depth: 1, steps: 1, bevelEnabled: false });
clippedHedge.translate(0, 0, -.5); clippedHedge.rotateY(Math.PI / 2);
compactGeometry(clippedHedge);

export function buildHedge(bodies, x, y, s, width, height, depth, colour, yaw) {
  // Bake into the existing body surface. A separate hedge instance batch on
  // every garden chunk costs more draws than these twenty faces are worth.
  const p = clippedHedge.attributes.position, indices = clippedHedge.index;
  const cos = Math.cos(yaw), sin = Math.sin(yaw), triangle = new Array(9);
  for (let i = 0; i < indices.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const j = indices.getX(i + k), u = p.getX(j) * width, v = p.getZ(j) * depth;
      triangle[k * 3] = x + cos * u + sin * v;
      triangle[k * 3 + 1] = y + p.getY(j) * height;
      triangle[k * 3 + 2] = -s - sin * u + cos * v;
    }
    bodies.face(...triangle, colour);
  }
}

// Shared, static templates: modest facets for recognizable silhouettes, with
// trim baked into the same instance instead of separate meshes per detail.
const dark = '#354e58';
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
  // millimeters apart flicker as depth precision falls off down the street.
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
