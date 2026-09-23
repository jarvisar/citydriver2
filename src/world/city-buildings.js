import * as THREE from 'three';
import { seededRandom } from './route.js';
import { PAVEMENT_LEVEL as G, roadAt } from './city-route.js';
import { CITY, cityStyleDistrict } from './city.js';
import { cityRigidFrame } from './city-layout-render.js';
import { pitchedRoof, butterflyRoof, mansardRoof, sawtoothRoof } from './city-roofs.js';
import { SHOP_NAMES, shopSignFor } from './city-signs.js';
import { SIDEWALK } from '../mapgen/generate.js';
import { averagePoint, insidePolygon, polygonBounds } from '../mapgen/polygon-util.js';
import { grassArea } from './city-grass.js';
export { SHOP_NAMES } from './city-signs.js';

const pick = (items, random) => items[Math.floor(random() * items.length)];
const integer = (random, min, max) => min + Math.floor(random() * (max - min + 1));
const ACCENTS = ['#386f73', '#a9503e', '#cc9a48', '#456282', '#687b59'];
const creamTrim = '#e4d2b0';
const ROOFS = ['#647c7a', '#667789', '#987463', '#758a7d', '#8b8874'];
const STYLES = {
  'Old town': { types: ['townhouse', 'brick', 'townhouse', 'shop', 'deco'], walls: ['#c88368', '#d4bb91', '#a65e52', '#ead2b0', '#7b9d95'], layouts: ['street', 'court', 'mixed'] },
  'Garden quarter': { types: ['apartment', 'townhouse', 'pavilion', 'apartment', 'shop'], walls: ['#cbd6b5', '#86b1a1', '#e6d1ad', '#d5a998', '#9daec1'], layouts: ['court', 'mixed', 'street'] },
  Midtown: { types: ['office', 'atrium', 'deco', 'office', 'atrium'], walls: ['#8eafb9', '#accad0', '#ded0b4', '#7897a7', '#b4aaa3'], layouts: ['towers', 'mixed', 'street'] },
  'Warehouse district': { types: ['warehouse', 'loft', 'loft', 'brick', 'pavilion'], walls: ['#b7795b', '#cfac84', '#87a19a', '#a67b69', '#c8b58c'], layouts: ['works', 'mixed', 'street'] },
  'Market district': { types: ['townhouse', 'apartment', 'shop', 'pavilion', 'brick'], walls: ['#d08a70', '#dec29a', '#74a39a', '#d6ab7d', '#859aaf'], layouts: ['street', 'mixed', 'court'] },
  'Civic quarter': { types: ['deco', 'atrium', 'brick', 'office', 'pavilion'], walls: ['#dbcfb8', '#a1b8bc', '#c99a83', '#ddc19e', '#afc8b4'], layouts: ['mixed', 'court', 'towers'] },
};
const HEIGHTS = { brick: [2, 6], apartment: [3, 8], shop: [1, 2], warehouse: [1, 3], office: [7, 16], deco: [5, 12], townhouse: [2, 4], loft: [3, 5], pavilion: [1, 2], atrium: [5, 11] };
export const BUILDING_TYPES = Object.keys(HEIGHTS);

// The largest rectangle that fits inside a generated lot, tried along the
// lot's two longest edges. Buildings keep their rectangular shape, as they did
// on the grid; the rest of the lot is forecourt or garden.
export function fitRectangle(polygon, { maxSize = 60, minSize = 7, steps = 9 } = {}) {
  const n = polygon.length, centre = averagePoint(polygon);
  const edges = polygon.map((a, i) => { const b = polygon[(i + 1) % n]; return { length: a.distanceTo(b), angle: Math.atan2(b.y - a.y, b.x - a.x) }; })
    .sort((p, q) => q.length - p.length);
  const angles = [];
  for (const edge of edges) {
    const folded = ((edge.angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (!angles.some(other => Math.abs(other - folded) < .05 || Math.abs(Math.abs(other - folded) - Math.PI / 2) < .05)) angles.push(folded);
    if (angles.length === 2) break;
  }
  let best = null;
  const point = { x: 0, y: 0 };
  for (const angle of angles) {
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const local = polygon.map(p => ({ x: (p.x - centre.x) * cos - (p.y - centre.y) * sin, y: (p.x - centre.x) * sin + (p.y - centre.y) * cos }));
    const bounds = polygonBounds(local), xs = [], ys = [];
    for (let i = 0; i <= steps; i++) { xs.push(bounds.minX + (bounds.maxX - bounds.minX) * i / steps); ys.push(bounds.minY + (bounds.maxY - bounds.minY) * i / steps); }
    const inside = (x, y) => { point.x = x; point.y = y; return insidePolygon(point, local); };
    const fits = (x0, y0, x1, y1) => inside(x0, y0) && inside(x1, y0) && inside(x1, y1) && inside(x0, y1)
      && !local.some(p => p.x > x0 + .01 && p.x < x1 - .01 && p.y > y0 + .01 && p.y < y1 - .01);
    for (let x0 = 0; x0 < steps; x0++) for (let x1 = steps; x1 > x0; x1--) {
      const width = xs[x1] - xs[x0];
      if (width > maxSize) continue;
      if (width < minSize) break;
      for (let y0 = 0; y0 < steps; y0++) for (let y1 = steps; y1 > y0; y1--) {
        const depth = ys[y1] - ys[y0];
        if (depth > maxSize) continue;
        if (depth < minSize) break;
        const area = width * depth;
        if (best && area <= best.area) break;
        if (fits(xs[x0], ys[y0], xs[x1], ys[y1])) best = { area, x0: xs[x0], x1: xs[x1], y0: ys[y0], y1: ys[y1], angle };
      }
    }
  }
  if (!best) return null;
  const lx = (best.x0 + best.x1) / 2, ly = (best.y0 + best.y1) / 2, cos = Math.cos(best.angle), sin = Math.sin(best.angle);
  return { x: centre.x + lx * cos - ly * sin, y: centre.y + lx * sin + ly * cos, width: best.x1 - best.x0, depth: best.y1 - best.y0, angle: best.angle, area: best.area };
}

// A point just outside one side of a building, in world (s, u): side 0 is the
// building's own west face, 1 east, 2 south, 3 north, before its frame turns it.
function sidePoint(b, side, extra) {
  const du = side === 0 ? -1 : side === 1 ? 1 : 0, ds = side === 2 ? -1 : side === 3 ? 1 : 0;
  const reach = (side < 2 ? b.width / 2 : b.depth / 2) + extra, f = b.frame;
  return { u: f.u + (du * f.eu + ds * f.nu) * reach, s: f.s + (du * f.es + ds * f.ns) * reach };
}

// One building per lot, fitted to the lot's rectangle, in the style of the
// district and taller toward downtown. Lots too small or too awkward for a
// building become gardens.
export function planLotBuildings(c) {
  const buildings = [];
  for (const lot of c.lots) {
    lot.fit ??= fitRectangle(lot.polygon);
    const fit = lot.fit;
    if (!fit) { buildings.push({ kind: 'garden', lot }); continue; }
    const random = seededRandom(lot.seed);
    const district = cityStyleDistrict(fit.y, fit.x), style = STYLES[district] ?? STYLES['Market district'];
    const width = Math.min(46, fit.width - 2.4), depth = Math.min(46, fit.depth - 2.4);
    if (width < 7 || depth < 7) { buildings.push({ kind: 'garden', lot }); continue; }
    const footprint = width * depth;
    const downtown = Math.hypot(fit.x - CITY.downtown.u, fit.y - CITY.downtown.s) / Math.max(1, CITY.downtown.radius);
    let type = pick(style.types, random);
    if (footprint > 1100 && random() < .6) type = pick(['office', 'deco', 'atrium', 'warehouse', 'apartment'], random);
    if (downtown < .7 && random() < .5) type = pick(['office', 'deco', 'atrium'], random);
    if (footprint < 260 && ['office', 'atrium', 'deco', 'warehouse'].includes(type)) type = pick(['shop', 'townhouse', 'brick', 'pavilion'], random);
    const [low, high] = HEIGHTS[type];
    let floors = integer(random, low, high);
    if (downtown < 1) floors += Math.round((1 - downtown) * 5 * random());
    // No slender towers on tiny footprints
    floors = Math.max(low, Math.min(floors, Math.round(Math.min(width, depth) * .9)));
    const accent = pick(ACCENTS, random);
    const stepped = (type === 'deco' || type === 'office' || type === 'atrium') || (type === 'apartment' && random() < .38);
    const b = { kind: 'building', lot, x: fit.x - c.east, s: fit.y - c.start, width, depth, type, floors, wall: pick(style.walls, random), accent,
      roof: pick(ROOFS, random), roofType: ({ townhouse: 'mansard', loft: 'monitor', pavilion: 'butterfly', atrium: 'lantern' })[type]
        ?? (type === 'warehouse' ? 'sawtooth' : type === 'brick' && random() < .22 ? 'gable' : stepped ? 'terrace' : 'flat'),
      setbackFloors: stepped ? Math.max(2, Math.floor(floors * .57)) : floors,
      seed: (lot.seed + 9973) >>> 0, variation: integer(random, 0, 3), shop: pick(SHOP_NAMES, random),
      frame: cityRigidFrame(fit.y, fit.x, -fit.angle) };
    b.streetSides = [0, 1, 2, 3].map(side => {
      const p = sidePoint(b, side, 3.5), road = roadAt(p.s, p.u, 30);
      return Boolean(road && road.distance <= road.road.profile.halfWidth + SIDEWALK + 3);
    });
    const neighbours = c.neighbourLots ?? c.lots;
    b.openSides = [0, 1, 2, 3].map(side => {
      const p = sidePoint(b, side, 2.4), test = { x: p.u, y: p.s };
      return !neighbours.some(other => other !== lot && insidePolygon(test, other.polygon));
    });
    // Every building gets a front
    if (!b.streetSides.some(Boolean)) b.streetSides[Math.max(0, b.openSides.findIndex(Boolean))] = true;
    buildings.push(b);
  }
  return buildings;
}

// A lot with no room for a building: a lawn with a tree or two.
export function buildGarden(c, lot) {
  const random = seededRandom(lot.seed ^ 0x2545f491);
  const points = lot.polygon.map(p => [p.x - c.east, p.y - c.start]);
  c.polygon(points, G + .05, .06, '#7f9a5e');
  grassArea(c, points, '#7f9a5e', G + .08);
  const bounds = polygonBounds(lot.polygon), count = lot.area > 400 ? 2 : 1;
  for (let i = 0, placed = 0; i < 20 && placed < count; i++) {
    const x = bounds.minX + random() * (bounds.maxX - bounds.minX), y = bounds.minY + random() * (bounds.maxY - bounds.minY);
    if (!insidePolygon({ x, y }, lot.polygon) || lot.polygon.some((p, j) => { const q = lot.polygon[(j + 1) % lot.polygon.length]; const dx = q.x - p.x, dy = q.y - p.y, t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x - p.x - t * dx, y - p.y - t * dy) < 3; })) continue;
    c.tree(x - c.east, y - c.start, 6 + random() * 3); placed++;
  }
}

const signGeometry = new THREE.PlaneGeometry(1, 1);
const muralGeometry = new THREE.BufferGeometry();
muralGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, 0, .5, 0], 3));
muralGeometry.computeVertexNormals();
// Fit by changing font size, never Canvas's maxWidth (which squeezes glyphs).
export function fitSignText(ctx, text, x, y, width, size, weight = 'bold') {
  ctx.font = `${weight} ${size}px sans-serif`;
  const fitted = Math.min(size, size * width / Math.max(1, ctx.measureText(text).width));
  ctx.font = `${weight} ${fitted}px sans-serif`;
  ctx.fillText(text, x, y);
}
export function shopSignMaterial(name, aspect = name.endsWith(' TOWER') ? .25 : 4) {
  let map = null;
  if (globalThis.document) {
    const vertical = name.endsWith(' TOWER');
    // Match the physical panel's proportions with roughly the same texel
    // budget as the old 512 x 128 texture. Materials are shared across sites.
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(Math.min(1024, Math.sqrt(65536 * aspect)));
    canvas.height = Math.round(canvas.width / aspect);
    const { width, height } = canvas, edge = Math.min(width, height) * .07;
    const ctx = canvas.getContext('2d');
    const colors = { BAKERY: '#94664b', FLOWERS: '#55795a', NOODLES: '#a45142', RECORDS: '#625676', STUDIO: '#657999', RIVOLI: '#864a41', 'BLUE NOTE': '#39496d' };
    ctx.fillStyle = colors[name] ?? '#29484e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d6c79e'; ctx.lineWidth = Math.max(1.5, edge / 3); ctx.strokeRect(edge, edge, width - 2 * edge, height - 2 * edge);
    ctx.fillStyle = '#f6e8c9'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (vertical) {
      const letters = [...name.replace(' TOWER', '')], step = height * .86 / letters.length;
      letters.forEach((letter, i) => fitSignText(ctx, letter, width / 2, height * .07 + (i + .5) * step, width * .75, Math.min(width * .7, step * .85)));
    } else fitSignText(ctx, name, width / 2, height * .53, width - 4 * edge, height * .78);
    map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : '#365c60', emissive: '#ffffff', emissiveMap: map, emissiveIntensity: map ? .22 : 0, roughness: .85 });
}

function roofEdge(c, x, s, width, depth, roof, color, parapet = .85, surface = '#707778') {
  c.box(x, roof + .12, s, width + .5, .24, depth + .5, color);
  c.box(x, roof + .26, s, width - .6, .06, depth - .6, surface);
  for (const sign of [-1, 1]) {
    c.box(x + sign * (width / 2 - .17), roof + parapet / 2, s, .34, parapet, depth - .68, color);
    c.box(x, roof + parapet / 2, s + sign * (depth / 2 - .17), width, parapet, .34, color);
  }
}

// Coordinates on a facade: offset along the wall, height, distance outwards.
function facade(c, x, s, width, depth, side) {
  const eastWest = side < 2, sign = side % 2 ? 1 : -1;
  const span = eastWest ? depth : width, edge = (eastWest ? width : depth) / 2;
  const position = (offset, y, outward) => eastWest ? [x + sign * (edge + outward), y, -s - offset] : [x + offset, y, -s - sign * (edge + outward)];
  const yaw = eastWest ? sign * Math.PI / 2 : sign > 0 ? Math.PI : 0;
  return { span, yaw, position, add(offset, y, outward, w, h, d, color, kind = 'solid', broad = false) {
    if (c.distant && kind === 'solid' && !broad) return;
    if (c.distant && (kind === 'glass' || kind === 'lit')) {
      c.item(`distant-${kind}`, signGeometry, c.materials[kind], position(offset, y, outward), [w, h, 1], color, yaw);
    } else if (eastWest) c.box(x + sign * (edge + outward), y, s + offset, d, h, w, color, kind);
    else c.box(x + offset, y, s + sign * (edge + outward), w, h, d, color, kind);
  } };
}

function windows(c, b, x, s, width, depth, bottom, floors, metadata, upper = false) {
  const random = seededRandom(b.seed + (upper ? 1723 : 0)), modern = b.type === 'office' || b.type === 'atrium', loft = b.type === 'warehouse' || b.type === 'loft';
  for (let side = 0; side < 4; side++) {
    const f = facade(c, x, s, width, depth, side), span = f.span;
    const bays = Math.max(2, Math.floor((span - 2) / (modern ? 4.4 : loft ? 6.5 : b.variation === 1 ? 5.6 : 4.8)));
    const spacing = (span - 2.4) / bays, windowWidth = modern ? spacing - .36 : loft ? Math.min(3.7, spacing - 1) : b.variation === 2 ? 2.25 : 1.65;
    for (let floor = 0; floor < floors; floor++) {
      const y = bottom + 1.7 + floor * 3.6;
      if (modern) f.add(0, y - 1.42, .1, span + .2, .28, .3, '#b6c9c8', 'solid', true);
      if (b.type === 'deco' && floor === floors - 1) f.add(0, y + 1.55, .2, span + .6, .35, .5, '#ded2b8', 'solid', true);
      for (let bay = 0; bay < bays; bay++) {
        const offset = (bay - (bays - 1) / 2) * spacing, lit = random() < .1;
        const h = loft ? 2.45 : modern ? 2.75 : 2.2, frame = b.type === 'brick' || b.type === 'townhouse' ? '#e0ccab' : '#b3c5bc';
        f.add(offset, y, .075, windowWidth + .25, h + .25, .11, frame);
        f.add(offset, y, .17, windowWidth, h, .09, lit ? '#e3c38d' : modern ? '#5e8a9a' : '#3e5663', lit ? 'lit' : 'glass');
        if (loft || b.variation === 1) f.add(offset, y, .25, .09, h, .07, frame);
        if (!modern) f.add(offset, y - h / 2 - .14, .25, windowWidth + .44, .14, .48, frame);
        if (b.type === 'townhouse') {
          for (const sign of [-1, 1]) f.add(offset + sign * (windowWidth / 2 + .4), y, .2, .5, h, .15, b.accent, 'solid', true);
          f.add(offset, y, .265, windowWidth, .12, .1, creamTrim);
        }
        if (b.type === 'loft') f.add(offset, y, .265, windowWidth, .12, .1, '#c8bda8');
        if (b.type === 'apartment' && b.openSides[side] && floor % 2 === b.variation % 2 && bay % 2 === 0 && side % 2 === 0) {
          f.add(offset, y - 1.35, .68, windowWidth + 1.1, .2, 1.5, '#d1c9b5', 'solid', true);
          f.add(offset, y - .825, 1.36, windowWidth + 1.1, .85, .12, b.accent, 'solid', true);
          for (const edge of [-1, 1]) f.add(offset + edge * (windowWidth + .95) / 2, y - .825, .65, .1, .85, 1.3, b.accent);
          if (bay % 3 === 0) f.add(offset, y - .52, 1.13, windowWidth * .7, .28, .38, '#6e8856');
        }
        metadata.windows++;
      }
    }
    if (b.type === 'deco') for (let bay = 0; bay <= bays; bay++) {
      const offset = (bay - bays / 2) * spacing;
      f.add(offset, bottom + floors * 1.8, .18, .38, floors * 3.6, .4, '#cfbea2', 'solid', true);
    }
    if (b.type === 'loft' || b.type === 'townhouse') for (let floor = 1; floor <= floors; floor++) {
      f.add(0, bottom + floor * 3.6 - .12, .16, span + .3, b.type === 'loft' ? .4 : .22, .3, '#d6c1a0', 'solid', true);
    }
    if (b.type === 'atrium' || b.type === 'pavilion') for (let bay = 0; bay <= bays; bay++) {
      f.add((bay - bays / 2) * spacing, bottom + floors * 1.8, .4, .25, floors * 3.6, .85, b.type === 'pavilion' ? '#bf976c' : '#d5d9bd', 'solid', true);
    }
  }
}

function storefront(c, b, baseHeight) {
  for (let side = 0; side < 4; side++) {
    const f = facade(c, b.x, b.s, b.width, b.depth, side), { span } = f;
    const street = b.streetSides[side];
    if (street || b.openSides[side]) {
      f.add(0, G + .08, street ? .35 : .1, street ? f.span : Math.min(3, f.span), .16, street ? .9 : .4, '#d5c19e', 'solid', true);
    }
    f.add(0, G + .24, .08, span + .16, .48, .2, '#939b98', 'solid', true);
    if (street && b.type !== 'warehouse') {
      // Reserve a fascia above the 3.51m awning top and below every upper-floor
      // sill, balcony and pilaster. All sign shapes fit inside this same band.
      const signBottom = 3.65, signTop = baseHeight - .18, signY = (signBottom + signTop) / 2;
      f.add(0, G + signY, .13, span - .6, signTop - signBottom, .28, b.accent, 'solid', true);
      const units = Math.max(1, Math.floor(span / 8)), spacing = (span - 2) / units;
      for (let i = 0; i < units; i++) {
        const offset = (i - (units - 1) / 2) * spacing;
        f.add(offset, G + 1.95, .17, spacing - 1.1, 2.8, .1, '#345963', 'glass');
        f.add(offset + spacing * .25, G + 1.95, .24, .13, 2.9, .1, '#bbd2c8');
        f.add(offset + spacing * .25 + .45, G + 1.8, .3, .06, .45, .08, '#e5d0a0');
        if ((b.variation + i) % 3 !== 0 && b.type !== 'office') {
          const canopyWidth = spacing - .7;
          // Adjacent fabric panels form the canopy, including its hanging edge;
          // no thin stripe boxes intersect the slab along its sides.
          const stripes = !c.distant && b.variation % 2 === 0 ? 8 : 1;
          for (let stripe = 0; stripe < stripes; stripe++) {
            const along = offset + ((stripe + .5) / stripes - .5) * canopyWidth;
            const color = stripes > 1 && stripe % 2 === 0 ? '#e6d8b8' : b.accent;
            f.add(along, G + 3.4, 1.02, canopyWidth / stripes, .22, 2, color, 'solid', true);
            f.add(along, G + 3.1, 1.96, canopyWidth / stripes, .38, .12, color, 'solid', true);
          }
        }
      }
      if (!c.distant && b.variation !== 3) {
        const sign = shopSignFor(b), w = Math.min(6.2, span * .65, (signTop - signBottom - .2) * sign.aspect), h = w / sign.aspect;
        c.item('shop-signs', signGeometry, c.materials.signs, f.position(0, G + signY, .32),
          [w, h, 1], '#ffffff', f.yaw).signTile = sign.tile;
      }
    } else {
      f.add(0, G + 1.6, .17, b.type === 'warehouse' ? Math.min(8, span * .5) : 1.5, 2.9, .1, '#455b61', 'glass');
      if (b.type === 'warehouse') {
        f.add(0, G + 3.3, .3, Math.min(9, span * .55), .35, .7, b.accent, 'solid', true);
        for (let y = .6; y < 3; y += .4) f.add(0, G + y, .24, Math.min(7.8, span * .49), .06, .05, '#85968f');
      } else for (const offset of [-span * .28, span * .28]) f.add(offset, G + 2, .17, 1.4, 1.8, .08, '#435b65', 'glass');
    }
  }
}

function roofDetails(c, b, x, s, w, d, roof) {
  const random = seededRandom(b.seed ^ 0x5bd1e995), equipment = integer(random, 1, 3);
  const garden = (b.type === 'apartment' || b.type === 'shop') && b.variation >= 2;
  for (let i = 0; i < equipment; i++) {
    const px = x + (random() - .5) * (w - 7), ps = garden ? s - d * .28 : s + (random() - .5) * (d - 7), size = 1.4 + random() * 2;
    c.box(px, roof + .3 + size * .33, ps, size, size * .66, size * 1.15, '#919b9b');
    c.box(px, roof + .365 + size * .66, ps, size + .1, .13, size * 1.15 + .1, '#58656d');
  }
  if (b.type === 'brick' && b.variation < 2) {
    c.prop('tank', x - w * .22, s + d * .2, 0, roof + .28);
    // The tank's large silhouette also belongs in the distant city.
    if (c.distant) c.box(x - w * .22, roof + 4, s + d * .2, 2.8, 3.6, 2.8, '#646763');
  } else if (b.variation === 2) {
    for (let i = 0; i < 3; i++) c.box(x - w * .25 + i * 2.3, roof + .5, s + d * .2, 2, .18, Math.min(5, d * .3), '#496776', 'glass');
  } else if (b.type === 'deco') {
    c.box(x, roof + 1.8, s, w * .4, 3, d * .4, b.wall);
    c.box(x, roof + 3.4, s, w * .43, .3, d * .43, '#d1c5ac');
    if (b.variation === 0) c.box(x, roof + 7, s, .2, 8, .2, '#b0b7ae');
  }
  if (garden) {
    const px = x - w * .15, ps = s + d * .17, gw = Math.min(8, w * .5), gd = Math.min(7, d * .45);
    c.box(px, roof + .34, ps, gw + .6, .28, gd + .6, '#b2a993');
    c.box(px, roof + .51, ps, gw, .08, gd, '#829768');
    for (const dx of [-1, 1]) for (const ds of [-1, 1]) c.box(px + dx * gw / 2, roof + 1.8, ps + ds * gd / 2, .17, 3, .17, '#baa27f');
    for (let i = 0; i < 5; i++) c.box(px - gw / 2 + i * gw / 4, roof + 3.32, ps, .25, .2, gd + .8, '#d7c3a0');
  }
  if ((b.type === 'brick' || b.type === 'shop') && b.variation === 0 && w > 15 && d > 15) {
    const f = facade(c, x, s, w - 3, d - 3, b.variation % 2), width = Math.min(9, f.span * .65);
    for (const offset of [-width * .38, width * .38]) f.add(offset, roof + 1.55, 0, .18, 3, .22, '#526067', 'solid', true);
    f.add(0, roof + 4.1, 0, width, 4.3, .24, b.accent, 'solid', true);
    if (!c.distant) for (const [offset, size, color] of [[-width * .16, 2.6, '#efdfb9'], [width * .14, 1.8, '#9cbdba']]) {
      c.item('roof-murals', muralGeometry, c.materials.solid, f.position(offset, roof + 4, .14), [size, size, 1], color, f.yaw);
    }
  }
}

function signatureRoof(c, b, x, s, w, d, roof) {
  if (b.roofType === 'mansard') {
    // A steep copper/slate skirt and inset cap distinguish the old-town houses.
    const rise = 4.2;
    mansardRoof(c, x, s, w, d, roof, rise, b.roof);
    c.box(x, roof + rise + .12, s, w * .7 + .2, .24, d * .7 + .2, b.roof);
    for (let side = 0; side < 4; side++) {
      const f = facade(c, x, s, w * .83, d * .83, side), count = Math.max(1, Math.floor(f.span / 8));
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * 6.5;
        f.add(offset, roof + 2.4, .1, 2.9, 2.8, 1.6, creamTrim, 'solid', true);
        f.add(offset, roof + 2.35, 1, 1.65, 1.9, .1, '#496b73', 'glass');
        f.add(offset, roof + 3.9, .3, 3.3, .3, 2, b.roof, 'solid', true);
      }
    }
    for (const dx of [-w * .3, w * .3]) c.box(x + dx, roof + 4.1, s + d * .2, 1.3, 4, 1.8, b.wall);
  } else if (b.roofType === 'monitor') {
    const mw = w * .56, md = d * .68;
    c.box(x, roof + 1.55, s, mw, 2.5, md, '#769c9a', 'glass');
    pitchedRoof(c, x, s, mw + .5, md + .7, roof + 2.8 - .25 * Math.tan(.36), b.roof, '#769c9a', .36, { wallWidth: mw, wallDepth: md });
    for (const side of [-1, 1]) for (let i = -2; i <= 2; i++) c.box(x + side * mw / 2, roof + 1.55, s + i * md / 5, .22, 2.7, .22, creamTrim);
    c.box(x - w * .32, roof + 4.5, s + d * .32, 2, 9, 2, b.wall);
    c.box(x - w * .32, roof + 8.7, s + d * .32, 2.5, .7, 2.5, creamTrim);
  } else if (b.roofType === 'butterfly') {
    butterflyRoof(c, b, roof);
  } else if (b.roofType === 'lantern') {
    const lw = w * .67, ld = d * .67;
    c.box(x, roof + 2, s, lw, 3.6, ld, '#86b5b3', 'glass');
    pitchedRoof(c, x, s, lw + .6, ld + .6, roof + 3.8 - .3 * Math.tan(.36), '#8cbdb6', '#86b5b3', .36, { wallWidth: lw, wallDepth: ld });
    for (const side of [-1, 1]) for (let i = -2; i <= 2; i++) {
      c.box(x + side * lw / 2, roof + 2, s + i * ld / 5, .25, 3.9, .25, creamTrim);
      c.box(x + i * lw / 5, roof + 2, s + side * ld / 2, .25, 3.9, .25, creamTrim);
    }
  }
}

function buildBuilding(c, b) {
  const baseHeight = b.type === 'warehouse' ? 4.8 : 5.4, height = baseHeight + b.floors * 3.6;
  const lowerFloors = b.setbackFloors, lowerHeight = baseHeight + lowerFloors * 3.6, lowerRoof = G + lowerHeight;
  const metadata = { x: c.east + b.x, s: c.start + b.s, width: b.width, depth: b.depth, height,
    facadeSides: 4, windows: 0, type: b.type, roofType: b.roofType, floors: b.floors, setbackFloors: lowerFloors, wall: b.wall, placement: b.frame };
  c.features.buildings.push(metadata); c.solid(b.x, b.s, b.width, b.depth);
  c.box(b.x, G + lowerHeight / 2, b.s, b.width, lowerHeight, b.depth, b.wall);
  c.box(b.x, G + baseHeight / 2, b.s, b.width + .06, baseHeight, b.depth + .06, b.type === 'office' ? '#839b9e' : '#a4a69b');
  storefront(c, b, baseHeight);
  windows(c, b, b.x, b.s, b.width, b.depth, G + baseHeight, lowerFloors, metadata);
  let roof = lowerRoof, x = b.x, s = b.s, width = b.width, depth = b.depth;
  const trim = b.type === 'office' ? '#b8cccd' : '#d6c9b1';
  if (b.roofType === 'gable') {
    const rise = width / 2 * Math.tan(.36);
    pitchedRoof(c, x, s, width + .7, depth + .9, roof - .35 * Math.tan(.36), b.variation % 2 ? '#8a6555' : '#586e79', b.wall, .36, { wallWidth: width, wallDepth: depth });
    c.box(x + width * .23, roof + rise * .65 + 1, s + depth * .22, 1.2, 3.5, 1.4, b.wall);
    return;
  }
  if (b.roofType !== 'butterfly') roofEdge(c, x, s, width, depth, roof, trim, b.type === 'deco' ? 1.2 : .65, b.roof);
  if (lowerFloors < b.floors) {
    const inset = Math.min(4, width * .15, depth * .15), upperHeight = (b.floors - lowerFloors) * 3.6;
    width -= inset * 2; depth -= inset * 2;
    x += b.variation % 2 ? inset * .35 : -inset * .35;
    s += b.variation < 2 ? inset * .35 : -inset * .35;
    c.box(x, roof + upperHeight / 2, s, width, upperHeight, depth, b.type === 'office' ? '#7898a6' : b.wall);
    windows(c, b, x, s, width, depth, roof, b.floors - lowerFloors, metadata, true);
    for (const sign of [-1, 1]) {
      c.box(b.x + sign * (b.width / 2 - 1.15), lowerRoof + .6, b.s, 1.3, .6, b.depth * .65, '#a8a38b');
      c.box(b.x + sign * (b.width / 2 - 1.15), lowerRoof + 1.15, b.s, 1.2, .5, b.depth * .65 - .1, '#758c62');
    }
    roof += upperHeight; roofEdge(c, x, s, width, depth, roof, trim, .85, b.roof);
  }
  if (['mansard', 'monitor', 'butterfly', 'lantern'].includes(b.roofType)) signatureRoof(c, b, x, s, width, depth, roof);
  else if (b.roofType === 'sawtooth') {
    sawtoothRoof(c, b, roof);
  } else roofDetails(c, b, x, s, width, depth, roof);
  // One rear fire escape adds depth without covering every facade in trim.
  const escapeSide = [b.variation % 2, 2, 3].find(side => b.openSides[side]);
  if (!c.distant && b.type === 'brick' && b.variation === 1 && escapeSide !== undefined) {
    const f = facade(c, b.x, b.s, b.width, b.depth, escapeSide);
    for (let floor = 1; floor < lowerFloors; floor++) {
      const y = G + baseHeight + floor * 3.6;
      f.add(0, y, .8, 4.4, .15, 1.7, '#485858');
      f.add(0, y + .6, 1.6, 4.4, .09, .1, '#485858');
      for (const offset of [-2, 0, 2]) f.add(offset, y + .315, 1.6, .1, .48, .1, '#485858');
      for (const offset of [-1.7, -.7]) f.add(offset, y + 1.7, 1.35, .09, 3.6, .1, '#485858');
      for (let step = 0; step < 8; step++) f.add(-1.2, y + step * .45, 1.35, .91, .08, .1, '#485858');
    }
  }
}

export function buildCityBuildings(c) {
  for (const _ of buildCityBuildingSteps(c)) { /* synchronous startup */ }
}

export function* buildCityBuildingSteps(c) {
  const plan = planLotBuildings(c);
  yield;
  for (const b of plan) {
    if (b.kind === 'building') c.structure(b.x, b.s, () => buildBuilding(c, b), b.frame);
    else buildGarden(c, b.lot);
    yield;
  }
}
