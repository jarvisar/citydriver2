import * as THREE from 'three';
import { Parts, cityAssets } from './city-assets.js';
import { PAVEMENT_LEVEL as G } from './city-route.js';
import { clock } from './city-detail-assets.js';
import { vaultGeometry, vaultRibs } from './city-roofs.js';
import { basinRim, basinWater } from './city-public-space-geometry.js';
import { balancingBeam, standingBeam, STANDING_BEAM } from './city-sculptures.js';
import { itemFrame } from './city-layout-render.js';

// What stands in the city's squares (see city-parks.js): a clocktower on its
// steps, a glasshouse, sculptures on plinths, a market's stalls, a cafe's
// tables, planters and flower beds. Each piece is laid out square to its
// square: its yaw turns local +x along the square's axis (see
// city-layout-render.js). The tower and the glasshouse are landmarks seen
// across the city, so they stand at both detail levels; the rest are near
// detail only.
const STONE = '#e3d7bd', TRIM = '#efe4c9', COPPER = '#62958b';
const spire = new THREE.ConeGeometry(1, 1, 4);
const gable = new THREE.CircleGeometry(1, 14, 0, Math.PI);

// Templates baked with their colours, made once per colour
const cache = new Map();
const template = (key, build) => { if (!cache.has(key)) cache.set(key, build()); return cache.get(key); };

// Thin fabric, visible from underneath in the ordinary opaque prop batch.
// Reversed faces cost less than closed boxes and need no extra material.
function fabric(triangles) {
  const vertices = triangles.flatMap(([a, b, c]) => [...a, ...b, ...c, ...c, ...b, ...a]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  return g;
}

// A market stall: a counter and a table of produce under a striped awning,
// its front to local +z
function stall(colour) {
  const p = new Parts(), cream = '#f1e6cc';
  p.box([0, .5, .55], [3.2, 1, 1.1], '#9c7c58');
  p.box([0, 1.03, .55], [3.3, .06, 1.2], '#b8986c');
  const roofAt = z => 2.63 - (z - .05) * .22;
  for (const x of [-1.55, 1.55]) for (const z of [-1, 1.15]) {
    const h = roofAt(z);
    p.box([x, h / 2, z], [.1, h, .1], '#5d4a38');
  }
  // The awning, sloping down to the front in stripes
  for (let i = 0; i < 6; i++) {
    const x = -1.8 + i * .6, a = [x, roofAt(-1.45), -1.45], b = [x + .6, roofAt(-1.45), -1.45];
    const d = [x, roofAt(1.55), 1.55], e = [x + .6, roofAt(1.55), 1.55];
    const f = [x, roofAt(1.55) - .22, 1.55], h = [x + .6, roofAt(1.55) - .22, 1.55];
    p.add(fabric([[a, d, e], [a, e, b], [d, f, h], [d, h, e]]), [0, 0, 0], i % 2 ? cream : colour);
  }
  const fruit = ['#d9503f', '#e9b23b', '#8fb34a', '#e98a3c'];
  for (let i = 0; i < 4; i++) p.add(new THREE.IcosahedronGeometry(.28, 0), [-1.15 + i * .77, 1.2, .5], fruit[(i + colour.length) % 4]);
  p.box([0, .45, -.75], [3, .9, .8], '#7d6650');
  return p.finish();
}
// A cafe table for four under a parasol
function cafe(colour) {
  const p = new Parts(), iron = '#3d4246';
  p.cylinder([0, .035, 0], .27, .3, .07, iron, 8);
  p.cylinder([0, .37, 0], .05, .05, .74, iron, 5);
  p.cylinder([0, .75, 0], .55, .55, .05, '#e9e4d6', 12);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, x = Math.cos(a) * 1.05, z = Math.sin(a) * 1.05;
    const ca = Math.cos(a), sa = Math.sin(a), turn = Math.PI / 2 - a;
    const at = (side, back, y) => [x - sa * side + ca * back, y, z + ca * side + sa * back];
    p.box([x, .44, z], [.46, .06, .44], '#85745d', [0, turn, 0]);
    for (const side of [-.18, .18]) for (const back of [-.17, .17]) {
      const h = back > 0 ? .85 : .42;
      p.box(at(side, back, h / 2), [.045, h, .045], iron, [0, turn, 0]);
    }
    p.box(at(0, .17, .73), [.46, .24, .05], '#85745d', [0, turn, 0]);
  }
  p.cylinder([0, 1.69, 0], .03, .03, 1.88, '#d8d2c0', 5);
  const canopy = [], point = (k, r, y) => [Math.cos(k * Math.PI / 6) * r, y, Math.sin(k * Math.PI / 6) * r];
  for (let k = 0; k < 12; k++) {
    const a = point(k, .75, 2.48), b = point(k + 1, .75, 2.48), d = point(k, 1.7, 2.075), e = point(k + 1, 1.7, 2.075);
    canopy.push([[0, 2.625, 0], b, a], [a, b, e], [a, e, d]);
  }
  p.add(fabric(canopy), [0, 0, 0], colour);
  return p.finish();
}

// A low flowering clump: green flanks and a softly domed patch of colour.
// Eighteen faces, with no individual petals or stems.
function flowers(colour) {
  const positions = [], colours = [], normal = new THREE.Color(colour), pale = normal.clone().lerp(new THREE.Color('#f1e6cc'), .18);
  const green = new THREE.Color('#59724b');
  const face = (a, b, c, tint) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colours.push(tint.r, tint.g, tint.b);
  };
  for (let i = 0; i < 6; i++) {
    const point = (k, r, y) => [Math.cos(k * Math.PI / 3) * r, y, Math.sin(k * Math.PI / 3) * r];
    const a = point(i, .38, .025), b = point(i + 1, .38, .025), c = point(i, .31, .21), d = point(i + 1, .31, .21);
    face(a, c, d, green); face(a, d, b, green);
    face(c, [.035, .3, -.02], d, i % 3 ? normal : pale);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.computeVertexNormals();
  return g;
}
// Four sculptures, each on its plinth, about 5 m tall at full size: stacked
// tilted blocks, an upright ring, a sphere on a column, and a pair of arches
function sculpture(form) {
  const p = new Parts(), plinth = '#d9d1bf';
  p.box([0, .45, 0], [2.2, .9, 2.2], plinth);
  if (form === 1) {
    p.box([0, 1.6, 0], [1.5, 1.4, 1.5], '#b5503f', [0, .3, .12]);
    p.box([.1, 2.9, 0], [1.1, 1.1, 1.1], '#d19a3c', [0, .9, -.2]);
    p.box([0, 3.95, .05], [.75, .75, .75], '#5f9a8c', [0, 1.6, .25]);
  } else if (form === 2) {
    p.add(new THREE.TorusGeometry(1.55, .32, 8, 20), [0, 2.75, 0], '#5f9a8c');
    p.box([0, 1.15, 0], [.8, .5, .6], '#7a7f7c');
  } else if (form === 3) {
    p.cylinder([0, 2, 0], .22, .32, 2.2, '#8a6a45', 6);
    p.add(new THREE.IcosahedronGeometry(1.05, 1), [0, 4, 0], '#c9a15a');
  } else {
    for (const x of [-.55, .55]) p.box([x, 2.1, 0], [.34, 2.4, .5], '#8b78c4');
    p.box([0, 3.45, 0], [1.8, .34, .5], '#8b78c4');
    p.box([0, 1.2, .6], [2.1, .5, .3], '#d19a3c', [0, 0, .5]);
  }
  return p.finish();
}

// A square's piece, at (x, s) in the chunk; false if it is no square's
export function buildMonument(c, piece, x, s) {
  const yaw = piece.yaw ?? 0, ux = Math.cos(yaw), us = Math.sin(yaw);
  const at = (along, across) => [x + ux * along - us * across, s + us * along + ux * across];
  const solid = (w, d) => c.rigid(x, s, () => c.solid(x, s, w, d), itemFrame(piece.s, piece.u, yaw));
  if (piece.kind === 'clocktower') {
    const H = piece.height ?? 17, shaft = 3.4, stage = 3.8;
    // Three steps up to a stone shaft, the clock stage, a cornice and a copper spire
    [7.4, 6.2, 5].forEach((w, k) => c.box(x, G + .15 + k * .3, s, w, .3, w, k % 2 ? TRIM : STONE, 'solid', yaw));
    c.box(x, G + .9 + (H - 5.2) / 2, s, shaft, H - 5.2, shaft, STONE, 'solid', yaw);
    c.box(x, G + H - 4.3, s, shaft + .5, .4, shaft + .5, TRIM, 'solid', yaw);
    c.box(x, G + H - 2.2, s, stage, 3.8, stage, STONE, 'solid', yaw);
    c.box(x, G + H - .15, s, stage + .7, .5, stage + .7, TRIM, 'solid', yaw);
    c.item('landmark-spire', spire, c.materials.solid, [x, G + H + 2.1, -s], [stage * .78, 4.4, stage * .78], COPPER, yaw + Math.PI / 4);
    for (let k = 0; k < 4; k++) {
      const face = yaw + k * Math.PI / 2, q = [x + Math.sin(face) * (stage / 2 + .06), s - Math.cos(face) * (stage / 2 + .06)];
      clock(c, q[0], G + H - 2.2, q[1], stage * .72, face);
    }
    c.post(x, s, 3.2);
    return true;
  }
  if (piece.kind === 'glasshouse') {
    const w = piece.w, d = piece.d, H = 4.2, rise = Math.min(d * .42, 5.5);
    // A stone base, glazed walls and a glazed barrel vault along the square
    c.box(x, G + .5, s, w, 1, d, STONE, 'solid', yaw);
    c.box(x, G + 1 + H / 2, s, w - .5, H, d - .5, '#8fb9b5', 'glass', yaw);
    c.box(x, G + 1 + H + .12, s, w - .1, .24, d - .1, TRIM, 'solid', yaw);
    c.item('roof-vault', vaultGeometry, c.materials.glass, [x, G + 1 + H + .2, -s], [d / 2 - .25, rise, w - .5], '#8fb9b5', yaw + Math.PI / 2);
    vaultRibs(c, x, s, d / 2 - .25, rise, w - .5, G + 1 + H + .2, yaw + Math.PI / 2, G + 1);
    for (const end of [-1, 1]) {
      const [ex, es] = at(end * (w / 2 - .3), 0);
      c.item('landmark-gable', gable, c.materials.glass, [ex, G + 1 + H + .2, -es], [d / 2 - .35, rise - .1, 1], '#8fb9b5', yaw + Math.PI / 2 + (end < 0 ? Math.PI : 0));
    }
    // The square's glasshouse is separate from the landmark venue. Give its
    // long faces an entrance too, down through the stone base to the paving.
    for (const side of [-1, 1]) {
      const [dx, ds] = at(0, side * (d / 2 + .06));
      c.box(dx, G + 1.72, ds, 2.65, 3.24, .12, TRIM, 'solid', yaw);
      const [gx, gs] = at(0, side * (d / 2 + .14));
      c.box(gx, G + 1.65, gs, 2.3, 3.1, .08, '#375563', 'glass', yaw);
      c.box(gx, G + 1.65, gs, .08, 3.1, .12, TRIM, 'solid', yaw);
      c.box(dx, G + .07, ds, 2.8, .14, .65, STONE, 'solid', yaw);
    }
    if (!c.distant) {
      // A lantern along the ridge; the wall bars align with the roof ribs.
      c.box(x, G + 1 + H + rise + .2, s, w - 2, .5, 1.6, '#eef0e8', 'solid', yaw);
      // and palms and ferns inside
      for (let along = -w / 2 + 3; along < w / 2 - 2; along += 5) {
        const [px, ps] = at(along, 0);
        c.tree(px, ps, 4.5 + (Math.abs(along) % 3));
      }
    }
    solid(w, d);
    return true;
  }
  if (piece.kind === 'planter') {
    c.box(x, G + .35, s, 2.4, .7, 2.4, STONE, 'solid', yaw);
    c.box(x, G + .72, s, 2.1, .06, 2.1, '#5b4a3a', 'solid', yaw);
    c.tree(x, s, 6);
    return true;
  }
  if (c.distant) return ['sculpture', 'stall', 'cafe', 'bed', 'kiosk'].includes(piece.kind);
  if (piece.kind === 'sculpture') {
    const k = piece.size ?? 1;
    if (piece.pool) {
      c.item('basin-rim', basinRim, c.materials.solid, [x, G + .4, -s], [piece.pool, .8, piece.pool], '#d7ccb3');
      c.item('basin-water', basinWater, c.materials.glass, [x, G + .62, -s], [piece.pool * .94, 1, piece.pool * .94], '#4f93a0');
    }
    const lift = piece.pool ? .45 : 0;
    if (piece.form === 0) {
      c.box(x, G + lift + .45, s, 2.2 * k, .9, 2.2 * k, '#d9d1bf', 'solid', yaw);
      c.item('landmark-sculpture', balancingBeam, c.materials.solid, [x, G + lift + .9, -s], [.22 * k, .22 * k, .22 * k], '#8b78c4', yaw);
      c.item('landmark-sculpture-base', standingBeam, c.materials.solid, [x, G + lift + .9, -s], [.22 * k, .22 * k, .22 * k], STANDING_BEAM, yaw);
    } else c.item(`square-sculpture-${piece.form}`, template(`sculpture-${piece.form}`, () => sculpture(piece.form)), c.materials.props, [x, G + lift, -s], [k, k, k], '#ffffff', yaw);
    c.post(x, s, piece.pool ?? 1.4 * k);
    return true;
  }
  if (piece.kind === 'stall') {
    c.item(`square-stall-${piece.colour}`, template(`stall-${piece.colour}`, () => stall(piece.colour)), c.materials.props, [x, G, -s], [1, 1, 1], '#ffffff', yaw);
    solid(3.4, 2.6);
    return true;
  }
  if (piece.kind === 'cafe') {
    c.item(`square-cafe-${piece.colour}`, template(`cafe-${piece.colour}`, () => cafe(piece.colour)), c.materials.props, [x, G, -s], [1, 1, 1], '#ffffff', yaw);
    c.post(x, s, 1.2);
    return true;
  }
  if (piece.kind === 'bed') {
    // A raised bed with staggered clumps, green at the sides and colour above.
    c.box(x, G + .2, s, piece.w, .4, piece.d, '#cfc5ad', 'solid', yaw);
    c.box(x, G + .43, s, piece.w - .35, .1, piece.d - .35, '#5b4a3a', 'solid', yaw);
    for (let along = -piece.w / 2 + .7; along < piece.w / 2 - .5; along += .9) for (const side of [-1, 1]) {
      const shifted = Math.min(piece.w / 2 - .55, along + (side > 0 ? .22 : 0));
      const [fx, fs] = at(shifted, side * Math.min(.45, piece.d / 2 - .5));
      const size = .88 + .12 * Math.sin(along * 7 + side);
      c.item(`square-flowers-${piece.colour}`, template(`flowers-${piece.colour}`, () => flowers(piece.colour)), c.materials.props,
        [fx, G + .48, -fs], [size, .8 + size * .3, size], '#ffffff', yaw + along * 2 + side);
    }
    solid(piece.w, piece.d);
    return true;
  }
  if (piece.kind === 'kiosk') {
    c.item('kiosk', cityAssets.kiosk, c.materials.props, [x, G, -s], [1, 1, 1], '#ffffff', yaw, 0, true);
    solid(4, 4.8);
    return true;
  }
  return false;
}
