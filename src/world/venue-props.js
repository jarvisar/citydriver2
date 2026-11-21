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

// A cinema's ticket booth: a little kiosk under a round roof, its window to
// local +z (lit after dark by a pane of its own, see buildGrounds)
export const BOOTH_WINDOW = { y: 1.55, z: .93, w: 1.1, h: .8 };
export const ticketBooth = () => made('booth', () => {
  const p = new Parts(), red = '#b6604f', dark = '#2c2c34';
  p.box([0, .12, 0], [1.95, .24, 1.95], '#8d8478');
  p.box([0, 1.32, 0], [1.8, 2.16, 1.8], red);
  p.box([0, 1.55, .9], [1.1, .8, .02], '#d9b864');
  p.box([0, 1.12, .93], [1.3, .08, .12], '#e8dcc2');
  for (const x of [-.62, .62]) p.box([x, 1.55, .91], [.1, .95, .04], '#e8dcc2');
  p.box([0, 2.42, 0], [1.98, .12, 1.98], '#e8dcc2');
  const roof = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  roof.scale(1.25, .6, 1.25);
  p.add(roof, [0, 2.45, 0], dark);
  p.cylinder([0, 3.15, 0], .06, .06, .2, '#c9a34a', 6);
  return p.finish();
});

// A basketball hoop: a pole, an arm out to the backboard over the court
// (local +z) and an orange rim under it
export const basketballHoop = () => made('hoop', () => {
  const p = new Parts();
  p.cylinder([0, .1, 0], .2, .24, .2, IRON, 8);
  p.cylinder([0, 1.65, 0], .08, .09, 3.1, '#e8e3d2', 8);
  p.beam([0, 3, 0], [0, 3.1, .45], .05, '#e8e3d2', 5);
  p.box([0, 3.1, .5], [1.4, .9, .06], '#f4f1e8');
  p.box([0, 3, .47], [.5, .36, .02], '#c9463d');
  p.box([0, 3, .48], [.42, .28, .02], '#f4f1e8');
  p.add(new THREE.TorusGeometry(.23, .025, 4, 12), [0, 2.8, .78], '#e07b39', [Math.PI / 2, 0, 0]);
  return p.finish();
});

// A tennis net `width` across the court (local x), on a post at each end
export const tennisNet = width => made(`net-${width.toFixed(1)}`, () => {
  const p = new Parts();
  for (const side of [-1, 1]) {
    p.cylinder([side * (width / 2 + .4), .55, 0], .05, .06, 1.1, IRON, 6);
    p.box([side * (width / 2 + .4), .03, 0], [.24, .06, .24], IRON);
  }
  p.box([0, .5, 0], [width + .8, .82, .03], '#3a4044');
  p.box([0, .95, 0], [width + .8, .08, .05], '#f1eee4');
  p.box([0, .5, 0], [.06, .9, .05], '#f1eee4');
  return p.finish();
});

// A flagpole in a stone socket, its flag out along local +x in the venue's color
export const flagpole = colour => made(`flag-${colour}`, () => {
  const p = new Parts();
  p.cylinder([0, .2, 0], .3, .36, .4, '#d7ccb3', 8);
  p.cylinder([0, 4.6, 0], .06, .08, 8.8, '#d9d6cc', 6);
  p.cylinder([0, 9.05, 0], .12, .12, .14, '#c9a34a', 6);
  p.box([.78, 8.1, 0], [1.4, .9, .05], colour);
  p.box([.08, 8.1, 0], [.06, .94, .07], '#d9d6cc');
  return p.finish();
});

// A pool's sun lounger: a white frame on four legs, its back raised at local -z
export const sunLounger = () => made('lounger', () => {
  const p = new Parts();
  for (const x of [-.3, .3]) for (const z of [-.75, .75]) p.box([x, .13, z], [.06, .26, .06], '#c9c3b5');
  p.box([0, .3, .25], [.7, .08, 1.3], WHITE);
  p.box([0, .52, -.62], [.7, .08, .72], WHITE, [.55, 0, 0]);
  p.box([0, .36, .25], [.62, .05, 1.2], '#4fb6b2');
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
