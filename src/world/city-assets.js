import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { vehicleGeometry, TRAFFIC_MODELS, WHEEL } from '../traffic-models.js';
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

// A street lamp: a tapered column with an arm reaching over the road.
// Local -x is toward the road.
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
// A signal head on its own, to hang from a mast arm: three lamps in hoods on
// a backplate, centred on the middle lamp, lamps at SIGNAL_LENSES above it
export const SIGNAL_LENSES = [.32, 0, -.32];
function signalHead() {
  const p = new Parts();
  p.box([0, 0, 0], [.34, 1.05, .3], darkIron);
  p.box([0, 0, -.12], [.62, 1.28, .04], '#262c2f');
  p.box([0, .62, 0], [.08, .2, .08], darkIron);
  for (const y of SIGNAL_LENSES) {
    p.cylinder([0, y, .17], .125, .125, .06, '#1e282b', 12, [Math.PI / 2, 0, 0]);
    const hood = new THREE.CylinderGeometry(.14, .14, .22, 8, 1, true, Math.PI / 2, Math.PI);
    p.add(hood, [0, y, .25], darkIron, [Math.PI / 2, 0, 0]);
  }
  return p.finish();
}
// The pole of a mast-arm signal, taller than a pedestal's; the arm itself is
// laid along local -x to whatever length the road needs
export const MAST_HEIGHT = 6.7;
function signalMast() {
  const p = new Parts();
  p.cylinder([0, .25, 0], .26, .3, .5, darkIron, 8);
  p.cylinder([0, MAST_HEIGHT / 2, 0], .1, .15, MAST_HEIGHT, iron, 8);
  p.cylinder([0, MAST_HEIGHT + .12, 0], .12, .1, .24, darkIron, 8);
  return p.finish();
}
function stopSign() {
  const p = new Parts();
  // Bare metal at the back; the white rim and red face sit ahead of the post.
  p.cylinder([0, 1.4, -.085], .055, .07, 2.8, galvanised, 6);
  p.cylinder([0, 2.8, 0], .7, .7, .06, galvanised, 8, [Math.PI / 2, Math.PI / 8, 0]);
  p.cylinder([0, 2.8, .044], .685, .685, .024, '#f1ead6', 8, [Math.PI / 2, Math.PI / 8, 0]);
  p.cylinder([0, 2.8, .066], .62, .62, .012, '#b74635', 8, [Math.PI / 2, Math.PI / 8, 0]);
  // S, T, O, P as continuous vector outlines.
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
    p.add(geometry, [-.437 + i * .228, 2.646, .084], '#fff2d9');
  });
  return p.finish();
}
// A give-way sign: a white triangle, point down, in a red border.
function yieldSign() {
  const p = new Parts();
  p.cylinder([0, 1.35, -.085], .055, .07, 2.7, galvanised, 6);
  p.cylinder([0, 2.72, 0], .82, .82, .06, galvanised, 3, [Math.PI / 2, 0, 0]);
  p.cylinder([0, 2.72, .044], .8, .8, .024, '#b74635', 3, [Math.PI / 2, 0, 0]);
  p.cylinder([0, 2.72, .066], .61, .61, .012, '#f1ead6', 3, [Math.PI / 2, 0, 0]);
  return p.finish();
}
// A promenade bench facing the water.
function bench() {
  const p = new Parts();
  for (const z of [-.8, .8]) {
    p.box([-.21, .22, z], [.07, .44, .07], darkIron);
    p.box([.24, .5, z], [.07, 1, .07], darkIron);
    p.box([0, .41, z], [.55, .06, .07], darkIron);
  }
  // Broad timber slats with daylight below and between them; the same small
  // footprint and one shared prop mesh as the former slab-sided bench.
  for (const x of [-.19, 0, .19]) p.box([x, .47, 0], [.17, .07, 1.9], timber);
  for (const y of [.73, .94]) p.box([.27 + (y - .73) * .12, y, 0], [.06, .17, 1.9], timber, [0, 0, -.12]);
  return p.finish();
}
// Boats in the harbour and along the river, each lying along local z with
// its bow toward -z and its waterline at y = 0. A hull has a narrow keel,
// a boot-top just above the water and a gunwale that rises toward the bow;
// its topsides (`paint`) take each boat's own colour, like a parked car's
// shell, and the rest is baked into `detail`.
const BOAT_PLAN = [[-.8, 1], [.8, 1], [1, .5], [1, 0], [.92, -.4], [.62, -.75], [0, -1], [-.62, -.75], [-.92, -.4], [-1, 0], [-1, .5]];
function boatHull(length, beam, freeboard, draft, colours) {
  const paint = [], detail = [];
  const level = (x, z, y) => [x, y, z];
  const rings = {
    keel: BOAT_PLAN.map(([x, z]) => level(x * beam * .17, z * length * .43, -draft)),
    boot: BOAT_PLAN.map(([x, z]) => level(x * beam * .47, z * length * .485, .12)),
    rub: BOAT_PLAN.map(([x, z]) => level(x * beam * .515, z * length * .505, freeboard - .16 + .3 * Math.max(0, -z) ** 2)),
    top: BOAT_PLAN.map(([x, z]) => level(x * beam * .5, z * length * .5, freeboard + .3 * Math.max(0, -z) ** 2)),
  };
  // (every face turned out from the hull's middle, or up for the deck)
  const face = (list, a, b, c, colour, up = false) => {
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], f = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]];
    const m = [(a[0] + b[0] + c[0]) / 3, 0, (a[2] + b[2] + c[2]) / 3];
    if ((up ? n[1] : n[0] * m[0] + n[2] * m[2]) < 0) [b, c] = [c, b];
    list.push({ points: [a, b, c], colour });
  };
  const band = (list, lower, upper, colour) => {
    for (let i = 0; i < BOAT_PLAN.length; i++) {
      const j = (i + 1) % BOAT_PLAN.length;
      face(list, lower[i], lower[j], upper[j], colour); face(list, lower[i], upper[j], upper[i], colour);
    }
  };
  band(detail, rings.keel, rings.boot, colours.bottom);
  band(paint, rings.boot, rings.top, '#ffffff');
  // (the rubbing strake a hand's width proud along the top of the topsides)
  band(detail, rings.rub.map(([x, y, z]) => [x, y - .08, z]), rings.rub, colours.strake);
  const middle = [0, freeboard + .06, 0];
  for (let i = 0; i < BOAT_PLAN.length; i++) face(detail, middle, rings.top[i], rings.top[(i + 1) % BOAT_PLAN.length], colours.deck, true);
  const geometry = list => {
    const positions = [], colors = [], c = new THREE.Color();
    for (const { points, colour } of list) { c.set(colour); for (const p of points) { positions.push(...p); colors.push(c.r, c.g, c.b); } }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  };
  return { paint: geometry(paint), detail: geometry(detail) };
}
function boat(length, beam, freeboard, draft, colours, fit) {
  const hull = boatHull(length, beam, freeboard, draft, colours), p = new Parts();
  p.parts.push(hull.detail);
  fit(p, freeboard + .06);
  const detail = p.finish({ preserveNormals: true }), paint = hull.paint;
  compactGeometry(paint); paint.computeBoundingSphere();
  return { paint, detail };
}
const ROPE = '#d6ceb6', FENDER = '#2b2f31';
export const boatModels = {
  // An open launch: a console and windscreen, a seat and an outboard
  launch: boat(6, 2.3, .7, .3, { bottom: '#5b2d2a', strake: '#e8e4d8', deck: '#cdbf9f' }, (p, deck) => {
    p.box([0, deck + .45, .3], [.8, .9, .7], '#e8e4d8');
    p.box([0, deck + 1.02, -.08], [.82, .34, .05], '#5f7f88', [-.45, 0, 0]);
    p.box([0, deck + .2, 1.7], [1.5, .4, .5], '#8b6d4f');
    p.box([0, deck + .15, 2.95], [.36, .85, .42], '#3a3f42');
    p.box([0, deck + .7, 2.95], [.42, .32, .6], '#e8e4d8');
  }),
  // A yacht with its sail furled under a cover on the boom, a stay to each end
  yacht: boat(8.6, 2.8, .85, .45, { bottom: '#2c3e50', strake: '#8b6d4f', deck: '#c8a978' }, (p, deck) => {
    p.box([0, deck + .28, .3], [1.75, .56, 3.3], '#ebe8df');
    p.box([0, deck + .34, .3], [1.77, .15, 2.5], '#3f5560');
    p.cylinder([0, deck + 5.3, -.9], .05, .07, 10.6, '#d8d6cf', 5);
    p.box([0, deck + 1.55, 1.1], [.26, .28, 4], '#2f5d86');
    p.beam([0, deck + 10.5, -.9], [0, deck + .35, -4.15], .016, '#9ea3a5', 3);
    p.beam([0, deck + 10.5, -.9], [0, deck + .1, 4.2], .016, '#9ea3a5', 3);
    for (const x of [-.95, .95]) p.box([x, deck + .38, 3.3], [.06, .5, 1.6], '#c9c7c0');
  }),
  // A workboat: a wheelhouse with a mast on its roof, a winch forward and
  // old tyres hung along its sides
  work: boat(7.6, 2.7, .95, .45, { bottom: '#3b2a26', strake: '#2b2f31', deck: '#7d786d' }, (p, deck) => {
    p.box([0, deck + .8, 1.05], [1.75, 1.6, 2], '#eeeae0');
    p.box([0, deck + 1.15, 1.05], [1.77, .45, 2.02], '#3a5058');
    p.box([0, deck + 1.66, 1.05], [2, .12, 2.25], '#34393b');
    p.cylinder([0, deck + 3.05, 1.35], .045, .06, 2.7, '#e0dccf', 5);
    p.box([0, deck + 3.6, 1.35], [1.1, .07, .07], '#e0dccf');
    p.cylinder([0, deck + .3, -2.1], .32, .32, 1.1, '#6d7a7e', 8, [0, 0, Math.PI / 2]);
    p.box([0, deck + .15, -2.1], [1.3, .3, .5], '#a3452f');
    for (const x of [-1, 1]) for (const z of [-1.4, 0, 1.4]) p.cylinder([x * 1.4, .55, z], .24, .24, .2, FENDER, 8, [0, 0, Math.PI / 2]);
  }),
};
// A mooring line from a cleat on a boat's deck up to the quay's edge, 1.45 m
// across (scaled to fit) along local +x
function mooringLine() {
  const p = new Parts();
  p.beam([0, .95, 0], [1.45, 6.25, 0], .028, ROPE, 4);
  return p.finish();
}
// A bus shelter: a flat roof on two posts with a glass back and a stop sign.
function busShelter() {
  const p = new Parts();
  for (const z of [-1.7, 1.7]) p.box([.6, 1.25, z], [.1, 2.5, .1], iron);
  p.box([0, 2.55, 0], [1.6, .12, 4], darkIron);
  // Quiet frosted panels in a frame, with air below and above the screen.
  // Opaque baked colours keep this in the single furniture batch.
  for (const z of [-.84, .84]) p.box([.62, 1.48, z], [.04, 1.7, 1.62], '#9dafad');
  for (const y of [.61, 2.35]) p.box([.62, y, 0], [.09, .07, 3.4], iron);
  p.box([.62, 1.48, 0], [.09, 1.7, .06], iron);
  p.box([0, .45, 0], [.5, .06, 3], timber);
  for (const z of [-1.15, 1.15]) p.box([0, .21, z], [.12, .42, .12], iron);
  // A blue transit flag faces the road; a bus symbol identifies the stop
  // without an invented route number or advertising on the shelter.
  const blue = '#2f5f8a', white = '#f1ead6';
  p.box([-.9, 2.93, 1.6], [.06, .66, .5], blue);
  p.cylinder([-.9, 1.3, 1.6], .05, .05, 2.6, iron, 5);
  for (const side of [-1, 1]) {
    const face = -.9 + side * .042;
    p.box([face, 2.95, 1.6], [.018, .38, .3], white);
    p.box([face + side * .017, 3.01, 1.6], [.012, .15, .23], blue);
    for (const z of [1.5, 1.7]) {
      p.box([face, 2.74, z], [.018, .075, .06], white);
      p.box([face + side * .017, 2.82, z], [.012, .045, .045], blue);
    }
  }
  return p.finish();
}
// A four-metre run of quay railing, laid along z.
function railing() {
  const p = new Parts();
  p.box([0, 1.02, 0], [.07, .09, 4], iron);
  p.box([0, .5, 0], [.04, .04, 4], iron);
  for (const z of [-2, -1, 0, 1, 2]) p.box([0, .52, z], [.05, 1.04, .05], darkIron);
  return p.finish();
}
// A bollard by the water.
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

// A park lantern: a slim post with a glass box on top, lit at LANTERN_HEIGHT
export const LANTERN_HEIGHT = 4.05;
function parkLantern() {
  const p = new Parts();
  p.cylinder([0, .15, 0], .15, .19, .3, darkIron, 6);
  p.cylinder([0, 1.95, 0], .055, .08, 3.6, iron, 6);
  p.cylinder([0, 3.8, 0], .13, .07, .14, darkIron, 6);
  p.box([0, 4.07, 0], [.34, .44, .34], '#efe3b8');
  for (const [x, z] of [[-.17, -.17], [.17, -.17], [.17, .17], [-.17, .17]]) p.box([x, 4.07, z], [.04, .46, .04], darkIron);
  p.cone([0, 4.44, 0], .3, .3, darkIron, 4);
  return p.finish();
}
// A park bandstand: an octagonal stone platform, white columns and railings,
// and a copper-green roof. About 5.4 m round; the gap in the rail faces +z.
function bandstand() {
  const p = new Parts(), white = '#eee8da', stone = '#cdc4ae';
  // Shallow octagonal steps stay inside the original platform. Turn the
  // columns half a bay so a pair frames the entrance instead of blocking it.
  for (let i = 0; i < 4; i++) {
    const radius = 5.5 - i * .25;
    p.cylinder([0, .17 * (i + .5), 0], radius, radius, .17, i === 3 ? '#b8ad96' : stone, 8, [0, Math.PI / 8, 0]);
  }
  const post = k => { const a = (k + .5) / 8 * Math.PI * 2; return [Math.sin(a) * 4.4, Math.cos(a) * 4.4]; };
  for (let k = 0; k < 8; k++) {
    const [x, z] = post(k), [nx, nz] = post(k + 1);
    p.cylinder([x, 2.315, z], .14, .16, 3.27, white, 6);
    // A rail between the columns, open to the front
    if (k !== 7) for (const y of [1.05, 1.6]) p.beam([x, y, z], [nx, y, nz], .045, white, 4);
  }
  p.cylinder([0, 4.05, 0], 5.5, 5.5, .3, white, 8, [0, Math.PI / 8, 0]);
  p.add(new THREE.ConeGeometry(5.9, 2.2, 8), [0, 5.3, 0], '#557f6b', [0, Math.PI / 8, 0]);
  p.cylinder([0, 6.6, 0], .07, .07, .6, darkIron, 5);
  p.cone([0, 7, 0], .22, .35, '#b89a55', 6);
  return p.finish();
}

// A rounded, asymmetric main lobe with broad facets: 48 triangles, against
// the small offshoots' 20.
function foliageLobe(radius, phase) {
  const g = new THREE.SphereGeometry(radius, 8, 4), vertices = g.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i), angle = Math.atan2(z, x);
    const fullness = .94 + .06 * Math.sin(angle * 3 + phase + y / radius);
    const turn = .23 * Math.sin(y / radius * 3 + phase), cs = Math.cos(turn), sn = Math.sin(turn);
    // Keep every lobe within its planting clearance, including its tips.
    vertices.setXYZ(i, (x * cs - z * sn) * fullness, y * .92 + radius * .045 * Math.sin(angle * 2 + phase) * (1 - Math.abs(y / radius)), (z * cs + x * sn) * fullness);
  }
  g.computeVertexNormals();
  return g;
}

// Pruned street trees: a broad crown and a narrower upright one, both fitted
// between the shopfronts and the kerb. The silhouette is shared at every LOD.
function streetTree(variant) {
  const trunk = new Parts(), crown = new Parts();
  trunk.beam([0, -.04, 0], [.025, .66, 0], .048, '#ffffff', 5);
  for (const side of [-1, 1]) trunk.beam([.02, .32, 0], [side * .22, .61, .06], .028, '#ffffff', 5);
  const clusters = variant ? [[0, .79, 0, .3, 1.55], [-.12, .54, .025, .23, 1.1]]
    : [[0, .77, 0, .37, 1.05], [-.22, .62, .025, .27, 1], [.22, .62, -.07, .27, .95]];
  for (const [x, y, z, radius, stretch] of clusters) {
    const g = x === 0 ? foliageLobe(radius, variant * 1.7) : new THREE.IcosahedronGeometry(radius, 0);
    g.scale(1, stretch, .92); g.rotateY(variant * .8 + y);
    crown.add(g, [x, y, z], x === 0 ? '#ffffff' : '#e2e8da');
  }
  const bark = trunk.finish(), leaves = crown.finish(), positions = leaves.attributes.position;
  let radius = 0;
  for (let i = 0; i < positions.count; i++) radius = Math.max(radius, Math.hypot(positions.getX(i), positions.getZ(i)));
  return { bark, leaves, radius };
}

export const cityTrees = [streetTree(0), streetTree(1)];
export const cityAssets = { lamp: lampPost(), signal: trafficSignal(), stop: stopSign(), yield: yieldSign(), bench: bench(), shelter: busShelter(), railing: railing(), bollard: bollard(), manhole: manhole(), tank: waterTank(), kiosk: kiosk(), bin: litterBin(), 'mooring-line': mooringLine(), lantern: parkLantern(), bandstand: bandstand(), 'signal-head': signalHead(), 'signal-mast': signalMast() };

// Parked cars reuse the traffic fleet's bodies: the paint shell carries a
// per-instance colour and everything else keeps its own baked colours.
function tint(g, color) {
  const c = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return g;
}
// Ten-sided tyres match moving traffic; flat hub faces read at kerb distance
// without adding cylinders or a new batch for hundreds of parked cars.
function parkedCar(spec) {
  const { paint, details, headlights, taillights, wheels } = vehicleGeometry(spec, { separateWheels: true });
  const tyres = wheels.flatMap(({ x, y, z }) => {
    const tyre = new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.width, 10);
    // Put a vertex at road level so a tyre's flat does not leave a visible gap.
    tyre.rotateY(Math.PI / 2); tyre.rotateZ(Math.PI / 2); tyre.translate(x, y, z); tyre.deleteAttribute('uv');
    const hub = new THREE.CircleGeometry(WHEEL.hubRadius, 8);
    hub.rotateY(Math.sign(x) * Math.PI / 2); hub.translate(x + Math.sign(x) * (WHEEL.width / 2 + .006), y, z); hub.deleteAttribute('uv');
    return [tint(tyre, '#2b3434'), tint(hub, '#a6aea5')];
  });
  const trim = mergeGeometries([details, tint(headlights, '#d8d4c2'), tint(taillights, '#8a3a30'), ...tyres]);
  for (const g of [details, headlights, taillights, ...tyres]) g.dispose();
  paint.computeBoundingSphere(); trim.computeBoundingSphere();
  return { paint, trim };
}
export const parkedCars = Object.fromEntries(TRAFFIC_MODELS.map(spec => [spec.name, parkedCar(spec)]));
export const PARKED_PAINTS = ['#c9bda3', '#dedbd1', '#4f7086', '#7a8b84', '#9c4a41', '#b8944a', '#4f585e', '#a9b4b9', '#6a6078', '#3b6f6d', '#2e3236'];
