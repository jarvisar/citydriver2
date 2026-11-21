import * as THREE from 'three';
import { Parts } from './city-assets.js';

// The pieces on a venue's grounds that a car can knock over (see LooseProps),
// as street furniture is: each one model in the props batch, standing on its
// own origin, made once (per paint, or per width) and shared.
const cache = new Map();
const made = (key, build) => { if (!cache.has(key)) cache.set(key, build()); return cache.get(key); };
const IRON = '#3d4246', WHITE = '#eee9dc';

// A poster column: a green drum under a domed cap, pasted round with the week's bills
const BILLS = ['#d9534f', '#f0c05a', '#3f7cac', '#ece4cf', '#7a5a9a', '#e07b39', '#2f8f83', '#1f2528'];
export const posterColumn = () => made('posters', () => {
  const p = new Parts(), green = '#2f4a3c';
  p.cylinder([0, .15, 0], .64, .68, .3, green, 12);
  p.cylinder([0, 1.6, 0], .55, .55, 2.6, green, 12);
  for (let k = 0; k < 8; k++) {
    const a = (k + .5) / 8 * Math.PI * 2;
    p.box([Math.sin(a) * .56, 1.05, Math.cos(a) * .56], [.38, .9, .03], BILLS[(k * 3) % BILLS.length], [0, a, 0]);
    p.box([Math.sin(a) * .56, 2.12, Math.cos(a) * .56], [.38, 1.02, .03], BILLS[(k * 5 + 2) % BILLS.length], [0, a, 0]);
  }
  p.cylinder([0, 3, 0], .7, .6, .2, green, 12);
  p.cone([0, 3.35, 0], .62, .5, green, 12);
  p.cylinder([0, 3.7, 0], .05, .05, .3, '#c9a34a', 6);
  return p.finish();
});

// A cinema's ticket booth: a little kiosk under a round roof, paneled below
// a counter and glazed above it on three sides between corner posts, its
// front window to local +z (lit after dark by a pane of its own set into it,
// see buildGrounds)
export const BOOTH_WINDOW = { y: 1.8, z: .82, w: 1.36, h: 1.16 };
export const ticketBooth = () => made('booth', () => {
  const p = new Parts(), red = '#b6604f', dark = '#2c2c34', cream = '#e8dcc2', glass = '#34505a';
  p.box([0, .12, 0], [1.95, .24, 1.95], '#8d8478');
  p.box([0, .68, 0], [1.8, .88, 1.8], red);
  p.box([0, 1.16, 0], [1.9, .08, 1.9], cream);
  // (the posts stand proud of the glass, the back is solid)
  for (const x of [-.8, .8]) for (const z of [-.8, .8]) p.box([x, 1.8, z], [.2, 1.2, .2], red);
  p.box([0, 1.8, -.8], [1.4, 1.2, .2], red);
  p.box([0, 1.8, .78], [1.4, 1.2, .04], glass);
  for (const x of [-.78, .78]) p.box([x, 1.8, 0], [.04, 1.2, 1.4], glass);
  p.box([0, 1.225, .99], [1.2, .05, .2], cream);
  p.box([0, 2.52, 0], [1.98, .24, 1.98], cream);
  p.box([0, 2.385, 0], [1.84, .03, 1.84], '#c9a34a');
  const roof = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  roof.scale(1.25, .6, 1.25);
  p.add(roof, [0, 2.64, 0], dark);
  // (closed underneath: the open dome showed the sky through its eaves from below)
  p.add(new THREE.CircleGeometry(1.25, 10), [0, 2.64, 0], dark, [Math.PI / 2, 0, 0]);
  p.cylinder([0, 3.34, 0], .06, .06, .2, '#c9a34a', 6);
  return p.finish();
});

// A basketball hoop: a pole, an arm out to the backboard over the court
// (local +z), the target square on the board's court side, and an orange
// rim on a bracket under it
export const basketballHoop = () => made('hoop', () => {
  const p = new Parts(), red = '#c9463d';
  p.cylinder([0, .1, 0], .2, .24, .2, IRON, 8);
  p.cylinder([0, 1.65, 0], .08, .09, 3.1, '#e8e3d2', 8);
  p.beam([0, 3, 0], [0, 3.1, .45], .05, '#e8e3d2', 5);
  p.box([0, 3.1, .5], [1.4, .9, .06], '#f4f1e8');
  // (an outline of bars standing just off the board, not a square laid over it)
  for (const y of [2.8425, 3.1575]) p.box([0, y, .54], [.5, .045, .018], red);
  for (const x of [-.2275, .2275]) p.box([x, 3, .54], [.045, .27, .018], red);
  p.box([0, 2.8, .6], [.16, .04, .14], IRON);
  p.add(new THREE.TorusGeometry(.23, .025, 4, 12), [0, 2.8, .9], '#e07b39', [Math.PI / 2, 0, 0]);
  return p.finish();
});

// Each vertex of a geometry moved by `move(x, y, z)`, returning [x, y, z]
function bend(geometry, move) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) position.setXYZ(i, ...move(position.getX(i), position.getY(i), position.getZ(i)));
  return geometry;
}

// A tennis net `width` across the court (local x), on a post at each end:
// its cable sagging from the posts to the strap at the middle under a white
// headband, the mesh hanging in shallow folds, and a winder on one post
export const tennisNet = width => made(`net-${width.toFixed(1)}`, () => {
  const p = new Parts(), half = width / 2 + .4, cable = x => 1.05 - .15 * (1 - Math.abs(x) / half);
  for (const side of [-1, 1]) {
    p.cylinder([side * half, .55, 0], .05, .06, 1.1, IRON, 6);
    p.cylinder([side * half, 1.12, 0], .07, .07, .04, IRON, 6);
    p.box([side * half, .03, 0], [.24, .06, .24], IRON);
  }
  p.box([half + .08, .8, 0], [.1, .1, .06], IRON);
  const folds = 2 * Math.round(half / .55);
  p.add(bend(new THREE.BoxGeometry(half * 2, 1, .02, folds, 1, 1), (x, y, z) => [x, y > 0 ? cable(x) - .03 : .07, z + (Math.round((x + half) / (half * 2) * folds) % 2 ? .025 : -.025)]), [0, 0, 0], '#363d41');
  p.add(bend(new THREE.BoxGeometry(half * 2, .07, .08, 2, 1, 1), (x, y, z) => [x, cable(x) + y, z]), [0, 0, 0], '#f1eee4');
  p.box([0, .48, 0], [.06, .84, .09], '#f1eee4');
  p.box([0, .015, 0], [.14, .03, .14], IRON);
  return p.finish();
});

// A flagpole in a stone socket, its flag out along local +x in the venue's
// color, rippling and drooping a little toward its fly
export const flagpole = colour => made(`flag-${colour}`, () => {
  const p = new Parts();
  p.cylinder([0, .2, 0], .3, .36, .4, '#d7ccb3', 8);
  p.cylinder([0, 4.6, 0], .06, .08, 8.8, '#d9d6cc', 6);
  p.cylinder([0, 9.05, 0], .12, .12, .14, '#c9a34a', 6);
  p.add(bend(new THREE.BoxGeometry(1.4, .9, .04, 4, 1, 1), (x, y, z) => {
    const t = (x + .7) / 1.4;
    return [x, y - .1 * t * t, z + .13 * t * Math.sin(t * Math.PI * 1.6)];
  }), [.78, 8.1, 0], colour);
  p.box([.08, 8.1, 0], [.06, .94, .07], '#d9d6cc');
  return p.finish();
});

// A pool's sun lounger: a white frame on four legs, its back raised at local
// -z off the frame, propped on two struts, and cushions on the seat and back
export const sunLounger = () => made('lounger', () => {
  const p = new Parts(), tilt = [.55, 0, 0];
  for (const x of [-.3, .3]) for (const z of [-.75, .75]) p.box([x, .13, z], [.06, .26, .06], '#c9c3b5');
  p.box([0, .3, 0], [.7, .08, 1.9], WHITE);
  p.box([0, .568, -.577], [.7, .08, .72], WHITE, tilt);
  for (const x of [-.28, .28]) p.box([x, .485, -.75], [.04, .29, .04], '#c9c3b5');
  p.box([0, .365, .3], [.62, .05, 1.1], '#4fb6b2');
  p.box([0, .623, -.543], [.62, .05, .62], '#4fb6b2', tilt);
  return p.finish();
});

// Balls to knock about (see LooseProps' `kick`), standing on their own
// origin: a beach ball in six colored gores, and a basketball's orange with
// its dark seams. Faceted spheres, each face one color.
export const BEACH_BALL = .38, BASKETBALL = .26;
function ball(radius, colourOf) {
  const g = new THREE.IcosahedronGeometry(radius, 2), position = g.attributes.position, colours = new Float32Array(position.count * 3);
  const c = new THREE.Color(), middle = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    middle.set(0, 0, 0);
    for (let k = 0; k < 3; k++) middle.x += position.getX(i + k) / 3, middle.y += position.getY(i + k) / 3, middle.z += position.getZ(i + k) / 3;
    c.set(colourOf(middle.normalize()));
    for (let k = 0; k < 3; k++) c.toArray(colours, (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.deleteAttribute('uv');
  g.translate(0, radius, 0);
  g.computeVertexNormals();
  return g;
}
const GORES = ['#e04a3f', '#f4f1e6', '#f0c34a', '#f4f1e6', '#3f7cc4', '#f4f1e6'];
export const beachBall = () => made('beach-ball', () => ball(BEACH_BALL, n => Math.abs(n.y) > .88 ? '#f4f1e6' : GORES[Math.floor((Math.atan2(n.z, n.x) / (Math.PI * 2) + 1) * 6) % 6]));
export const basketball = () => made('basketball', () => ball(BASKETBALL, n => Math.abs(n.y) < .12 || Math.abs(n.x) < .1 || Math.abs(Math.hypot(n.x, n.y) - .72) < .07 ? '#2a1f1a' : '#d9702e'));
