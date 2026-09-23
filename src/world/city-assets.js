import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { vehicleGeometry, TRAFFIC_MODELS } from '../traffic-models.js';
import { compactGeometry } from './compact-geometry.js';

// Small merged, flat-shaded street furniture with its colours baked into
// vertex colours, so one instanced mesh per kind draws a whole chunk's worth.
export class Parts {
  constructor() { this.parts = []; }
  add(source, position, color, rotation = [0, 0, 0]) {
    let g = source;
    if (g.index) { g = source.toNonIndexed(); source.dispose(); }
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    g.translate(...position);
    const c = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); this.parts.push(g);
  }
  box(p, size, color, rotation) { this.add(new THREE.BoxGeometry(...size), p, color, rotation); }
  cylinder(p, top, bottom, height, color, sides = 8, rotation) { this.add(new THREE.CylinderGeometry(top, bottom, height, sides), p, color, rotation); }
  cone(p, radius, height, color, sides = 8) { this.add(new THREE.ConeGeometry(radius, height, sides), p, color); }
  beam(a, b, width, color, sides = 5) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(width, width, direction.length(), sides);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    this.add(g, from.add(to).multiplyScalar(.5).toArray(), color);
  }
  // A pitched roof over a footprint: two slabs and the two gable triangles.
  gable(p, width, length, wallHeight, ridgeHeight, wall, roof, overhang = .35) {
    const [x, y, z] = p, rise = ridgeHeight - wallHeight, half = width / 2;
    const slope = Math.atan2(rise, half), run = Math.hypot(half, rise) + overhang;
    for (const side of [-1, 1]) {
      this.box([x + side * (half + overhang) / 2, y + wallHeight + rise / 2 + .1, z], [run, .22, length + overhang * 2], roof, [0, 0, -side * slope]);
    }
    const ends = [];
    for (const zEnd of [z - length / 2, z + length / 2]) {
      ends.push(x - half, y + wallHeight, zEnd, x + half, y + wallHeight, zEnd, x, y + ridgeHeight, zEnd);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3));
    g.computeVertexNormals(); this.add(g, [0, 0, 0], wall);
  }
  finish({ preserveNormals = false } = {}) {
    const g = mergeGeometries(this.parts); this.parts.forEach(part => part.dispose());
    if (!preserveNormals) g.computeVertexNormals();
    compactGeometry(g); g.computeBoundingSphere(); return g;
  }
}

const iron = '#3d4246', darkIron = '#2f3336', galvanised = '#9da3a6', timber = '#6b5a48';

// A street lamp: a tapered column with an arm reaching over the road, unlit
// in the daytime storm. Local -x is toward the road.
function lampPost() {
  const p = new Parts();
  p.cylinder([0, 3.6, 0], .09, .15, 7.2, iron, 6);
  p.cylinder([0, .18, 0], .22, .26, .36, darkIron, 6);
  p.beam([0, 7.15, 0], [-1.6, 7.55, 0], .07, iron);
  p.box([-1.75, 7.5, 0], [.9, .24, .36], darkIron);
  p.box([-1.75, 7.36, 0], [.7, .06, .28], '#d9d5c4');
  return p.finish();
}
// A pedestal traffic signal on a street corner: three lamps in a hood.
function trafficSignal() {
  const p = new Parts();
  p.cylinder([0, 2.2, 0], .07, .1, 4.4, iron, 6);
  p.box([0, 4.6, 0], [.34, 1.05, .3], darkIron);
  for (const y of [4.92, 4.6, 4.28]) {
    p.cylinder([0, y, .17], .125, .125, .06, '#1e282b', 12, [Math.PI / 2, 0, 0]);
    const hood = new THREE.CylinderGeometry(.14, .14, .22, 8, 1, true, Math.PI / 2, Math.PI);
    p.add(hood, [0, y, .25], darkIron, [Math.PI / 2, 0, 0]);
  }
  p.box([0, 5.16, .08], [.44, .06, .5], darkIron);
  return p.finish();
}
function stopSign() {
  const p = new Parts();
  p.cylinder([0, 1.4, 0], .055, .07, 2.8, galvanised, 6);
  p.cylinder([0, 2.8, 0], .7, .7, .08, '#e9e2cd', 8, [Math.PI / 2, Math.PI / 8, 0]);
  p.cylinder([0, 2.8, .05], .62, .62, .03, '#b74635', 8, [Math.PI / 2, Math.PI / 8, 0]);
  // Continuous vector strokes avoid the old disconnected pixel-box lettering.
  const glyphs = [
    { outline: [[0,0],[5,0],[5,4],[1.3,4],[1.3,5.7],[5,5.7],[5,7],[0,7],[0,2.7],[3.7,2.7],[3.7,1.3],[0,1.3]] },
    { outline: [[1.85,0],[3.15,0],[3.15,5.7],[5,5.7],[5,7],[0,7],[0,5.7],[1.85,5.7]] },
    { outline: [[0,0],[5,0],[5,7],[0,7]], hole: [[1.3,1.3],[1.3,5.7],[3.7,5.7],[3.7,1.3]] },
    { outline: [[0,0],[1.3,0],[1.3,2.7],[5,2.7],[5,7],[0,7]], hole: [[1.3,4],[1.3,5.7],[3.7,5.7],[3.7,4]] },
  ];
  glyphs.forEach(({ outline, hole }, i) => {
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    if (hole) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
    const geometry = new THREE.ShapeGeometry(shape); geometry.scale(.038, .044, 1);
    p.add(geometry, [-.437 + i * .228, 2.646, .073], '#fff2d9');
  });
  return p.finish();
}
// A promenade bench facing the water.
function bench() {
  const p = new Parts();
  for (const z of [-.8, .8]) {
    p.box([0, .24, z], [.5, .48, .08], darkIron);
    p.box([.28, .62, z], [.08, .45, .08], darkIron);
  }
  p.box([0, .47, 0], [.55, .07, 1.9], timber);
  p.box([.3, .84, 0], [.07, .42, 1.9], timber);
  return p.finish();
}
// A bus shelter: a flat roof on two posts with a glass back and a stop sign.
function busShelter() {
  const p = new Parts();
  for (const z of [-1.7, 1.7]) p.box([.6, 1.25, z], [.1, 2.5, .1], iron);
  p.box([0, 2.55, 0], [1.6, .12, 4], darkIron);
  p.box([.62, 1.35, 0], [.04, 2, 3.5], '#5c6b74');
  p.box([0, .45, 0], [.5, .06, 3], timber);
  p.box([-.9, 2.9, 1.6], [.06, .5, .5], '#2f5f8a');
  p.cylinder([-.9, 1.4, 1.6], .05, .05, 2.8, iron, 5);
  return p.finish();
}
// A four-metre run of quay railing, laid along z.
function railing() {
  const p = new Parts();
  p.box([0, 1.02, 0], [.07, .09, 4], iron);
  p.box([0, .5, 0], [.05, .05, 4], iron);
  for (const z of [-2, -1, 0, 1, 2]) p.box([0, .52, z], [.05, 1.04, .05], darkIron);
  return p.finish();
}
// A bollard by the water and a bin by the bench.
function bollard() {
  const p = new Parts();
  p.cylinder([0, .42, 0], .12, .14, .84, darkIron, 6);
  p.cylinder([0, .88, 0], .1, .13, .1, galvanised, 6);
  return p.finish();
}
// A round manhole cover in the road.
function manhole() {
  const p = new Parts();
  p.cylinder([0, .015, 0], .52, .52, .03, '#35383b', 10);
  return p.finish();
}

function waterTank() {
  const p = new Parts();
  for (const x of [-1.05, 1.05]) for (const z of [-1.05, 1.05]) {
    p.beam([x * 1.2, 0, z * 1.2], [x, 2.6, z], .11, iron);
  }
  for (const z of [-1.05, 1.05]) {
    p.beam([-1.2, .2, z], [1.05, 2.5, z], .065, iron);
    p.beam([1.2, .2, z], [-1.05, 2.5, z], .065, iron);
  }
  p.cylinder([0, 2.55, 0], 1.65, 1.65, .16, iron, 8);
  p.cylinder([0, 3.9, 0], 1.4, 1.4, 2.6, '#655d50', 10);
  for (const y of [2.75, 3.85, 5.1]) p.cylinder([0, y, 0], 1.43, 1.43, .09, '#41494b', 10);
  p.cone([0, 5.65, 0], 1.55, 1, '#515b61', 10);
  return p.finish();
}

// A small riverside coffee stand, with a pitched metal roof and a serving hatch.
function kiosk() {
  const p = new Parts();
  p.box([0, .14, 0], [4, .28, 4.8], '#b0aaa0');
  p.box([0, 1.5, 0], [3.2, 2.8, 4], '#778a80');
  p.gable([0, 0, 0], 3.2, 4, 2.9, 3.7, '#819186', '#455d5e', .35);
  p.box([-1.62, 1.75, 0], [.07, 1.35, 2.8], '#283f46');
  p.box([-1.85, 1.03, 0], [.8, .14, 3.1], '#b19b7c');
  for (const z of [-1.45, 0, 1.45]) p.box([-1.68, 1.75, z], [.08, 1.45, .1], '#d1c5ac');
  p.box([-1.78, 2.66, 0], [.14, .36, 3.1], '#d1c5ac');
  for (const z of [-.7, -.2, .3]) p.cylinder([-1.88, 1.19, z], .085, .065, .18, '#dad4bf', 6);
  p.box([0, 1.3, -2.025], [1, 2.3, .05], '#394f50');
  return p.finish();
}

function litterBin() {
  const p = new Parts();
  p.cylinder([0, .45, 0], .34, .29, .9, '#465450', 8);
  p.cylinder([0, .95, 0], .36, .36, .12, '#353f40', 8);
  p.box([-.34, .76, 0], [.03, .16, .28], '#252e30');
  return p.finish();
}

// Pruned street trees: the same faceted geometry as the other routes, with a
// narrower, upright crown that fits between the shopfronts and the kerb.
function streetTree(variant) {
  const trunk = new Parts(), crown = new Parts();
  trunk.beam([0, -.04, 0], [.025, .66, 0], .048, '#ffffff', 5);
  for (const side of [-1, 1]) trunk.beam([.02, .32, 0], [side * .22, .61, .06], .028, '#ffffff', 5);
  const clusters = variant ? [[0, .79, 0, .3, 1.55], [-.12, .54, .025, .23, 1.1]]
    : [[0, .77, 0, .37, 1.05], [-.22, .62, .025, .27, 1], [.22, .62, -.07, .27, .95]];
  for (const [x, y, z, radius, stretch] of clusters) {
    const g = new THREE.IcosahedronGeometry(radius, 0);
    g.scale(1, stretch, .92); g.rotateY(variant * .8 + y);
    crown.add(g, [x, y, z], x === 0 ? '#ffffff' : '#e2e8da');
  }
  const bark = trunk.finish(), leaves = crown.finish(), positions = leaves.attributes.position;
  let radius = 0;
  for (let i = 0; i < positions.count; i++) radius = Math.max(radius, Math.hypot(positions.getX(i), positions.getZ(i)));
  return { bark, leaves, radius };
}

export const cityTrees = [streetTree(0), streetTree(1)];
export const cityAssets = { lamp: lampPost(), signal: trafficSignal(), stop: stopSign(), bench: bench(), shelter: busShelter(), railing: railing(), bollard: bollard(), manhole: manhole(), tank: waterTank(), kiosk: kiosk(), bin: litterBin() };

// Parked cars reuse the traffic fleet's bodies: the paint shell carries a
// per-instance colour and everything else keeps its own baked colours.
function parkedCar(spec) {
  const { paint, details, headlights, taillights } = vehicleGeometry(spec);
  const tint = (g, color) => {
    const c = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return g;
  };
  const trim = mergeGeometries([details, tint(headlights, '#d8d4c2'), tint(taillights, '#8a3a30')]);
  for (const g of [details, headlights, taillights]) g.dispose();
  paint.computeBoundingSphere(); trim.computeBoundingSphere();
  return { paint, trim };
}
export const parkedCars = Object.fromEntries(TRAFFIC_MODELS.map(spec => [spec.name, parkedCar(spec)]));
export const PARKED_PAINTS = ['#c9bda3', '#dedbd1', '#4f7086', '#7a8b84', '#9c4a41', '#b8944a', '#4f585e', '#a9b4b9', '#6a6078', '#3b6f6d', '#2e3236'];
