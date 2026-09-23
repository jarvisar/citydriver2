import * as THREE from 'three';
import { seededRandom } from './route.js';
import { PAVEMENT_LEVEL as G } from './city-route.js';
import { CITY, cityStyleDistrict } from './city.js';
import { SHOP_NAMES, shopSignFor } from './city-signs.js';
import { grassArea } from './city-grass.js';
import { averagePoint, insidePolygon, polygonBounds, offsetPolygon, calcPolygonArea, signedArea, distanceToPolyline, dedupePolygon, isSimple } from '../mapgen/polygon-util.js';
export { SHOP_NAMES } from './city-signs.js';

// Buildings follow their lots. Each lot is the polygon MapGenerator cut from
// its block, and the building is that polygon stepped in a little: a stripe
// of pavement in front, an alley or a garden behind. So facades bend with the
// streets and no two blocks are alike, as in MapGenerator's own drawings.
const pick = (items, random) => items[Math.floor(random() * items.length)];
const integer = (random, min, max) => min + Math.floor(random() * (max - min + 1));
const ACCENTS = ['#386f73', '#a9503e', '#cc9a48', '#456282', '#687b59'];
const creamTrim = '#e4d2b0', LAWN = '#7f9a5e';
const ROOFS = ['#647c7a', '#667789', '#987463', '#758a7d', '#8b8874'];
const STYLES = {
  'Old town': { types: ['townhouse', 'brick', 'townhouse', 'shop', 'deco'], walls: ['#c88368', '#d4bb91', '#a65e52', '#ead2b0', '#7b9d95'], shops: .75 },
  'Garden quarter': { types: ['apartment', 'townhouse', 'pavilion', 'apartment', 'shop'], walls: ['#cbd6b5', '#86b1a1', '#e6d1ad', '#d5a998', '#9daec1'], shops: .12 },
  Midtown: { types: ['office', 'atrium', 'deco', 'office', 'atrium'], walls: ['#8eafb9', '#accad0', '#ded0b4', '#7897a7', '#b4aaa3'], shops: .7 },
  'Warehouse district': { types: ['warehouse', 'loft', 'loft', 'brick', 'pavilion'], walls: ['#b7795b', '#cfac84', '#87a19a', '#a67b69', '#c8b58c'], shops: .3 },
  'Market district': { types: ['townhouse', 'apartment', 'shop', 'pavilion', 'brick'], walls: ['#d08a70', '#dec29a', '#74a39a', '#d6ab7d', '#859aaf'], shops: .85 },
  'Civic quarter': { types: ['deco', 'atrium', 'brick', 'office', 'pavilion'], walls: ['#dbcfb8', '#a1b8bc', '#c99a83', '#ddc19e', '#afc8b4'], shops: .4 },
};
const HEIGHTS = { brick: [2, 6], apartment: [3, 8], shop: [1, 2], warehouse: [1, 3], office: [7, 16], deco: [5, 12], townhouse: [2, 4], loft: [3, 5], pavilion: [1, 2], atrium: [5, 11] };
export const BUILDING_TYPES = Object.keys(HEIGHTS);
// How far a building stands back from its lot lines: a step from the
// pavement in front, and an alley, a yard or a garden between neighbours.
const INSETS = {
  'Old town': { front: .9, rear: 1, jitter: .6, lawn: false },
  'Market district': { front: 1, rear: 1.1, jitter: .8, lawn: false },
  Midtown: { front: 1.2, rear: 1.2, jitter: .8, lawn: false },
  'Warehouse district': { front: 1.4, rear: 1.4, jitter: 1.2, lawn: false },
  'Garden quarter': { front: 2.6, rear: 3.4, jitter: 2.2, lawn: true },
  'Civic quarter': { front: 1.8, rear: 2.2, jitter: 1.2, lawn: true },
};
const signGeometry = new THREE.PlaneGeometry(1, 1);

const ccw = polygon => signedArea(polygon) < 0 ? polygon.slice().reverse() : polygon;
const local = (polygon, c) => polygon.map(p => ({ x: p.x - c.east, y: p.y - c.start }));
const edgeLength = (polygon, i) => Math.hypot(polygon[(i + 1) % polygon.length].x - polygon[i].x, polygon[(i + 1) % polygon.length].y - polygon[i].y);
// Andrew's monotone chain: the collision footprint has to be convex.
export function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 4) return sorted;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of sorted.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function insidePoint(polygon, random, tries = 24, holes = []) {
  if (polygon.length < 3) return null;
  const bounds = polygonBounds(polygon);
  for (let i = 0; i < tries; i++) {
    const p = { x: bounds.minX + random() * (bounds.maxX - bounds.minX), y: bounds.minY + random() * (bounds.maxY - bounds.minY) };
    if (insidePolygon(p, polygon) && !holes.some(hole => insidePolygon(p, hole))) return p;
  }
  return null;
}
// Which edges of the stepped-in footprint came from a street edge of the lot:
// the parallel lot edge whose line lies closest.
function edgeFlags(footprint, polygon, street) {
  const n = polygon.length;
  return footprint.map((a, i) => {
    const b = footprint[(i + 1) % footprint.length], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    let best = -1, bestDistance = Infinity;
    for (let j = 0; j < n; j++) {
      const p = polygon[j], q = polygon[(j + 1) % n], ex = q.x - p.x, ey = q.y - p.y, el = Math.hypot(ex, ey) || 1;
      if (Math.abs((dx * ey - dy * ex) / (length * el)) > .08) continue;
      const t = ((mx - p.x) * ex + (my - p.y) * ey) / (el * el);
      if (t < -.05 || t > 1.05) continue;
      const distance = Math.abs(((mx - p.x) * ey - (my - p.y) * ex) / el);
      if (distance < bestDistance) { bestDistance = distance; best = j; }
    }
    return best >= 0 && street[best];
  });
}

// Coordinates on one wall of a building: offset along the wall from its
// middle, height, and distance outwards. The wall's own yaw turns each box.
function edgeFacade(c, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, span = Math.hypot(dx, dy) || 1, tx = dx / span, ty = dy / span, nx = ty, ny = -tx;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, yaw = Math.atan2(ty, tx);
  const point = (offset, outward) => ({ x: mx + tx * offset + nx * outward, s: my + ty * offset + ny * outward });
  return { span, yaw, street: false,
    position(offset, y, outward) { const p = point(offset, outward); return [p.x, y, -p.s]; },
    add(offset, y, outward, w, h, d, color, kind = 'solid', broad = false) {
      if (c.distant && kind === 'solid' && !broad) return;
      const p = point(offset, outward);
      if (c.distant && (kind === 'glass' || kind === 'lit')) c.item(`distant-${kind}`, signGeometry, c.materials[kind], [p.x, y, -p.s], [w, h, 1], color, yaw);
      else c.box(p.x, y, p.s, w, h, d, color, kind, yaw);
    } };
}

// What stands on a lot: a building shaped like the lot, or a garden where
// the lot is too small or too awkward for one.
export function planLot(c, lot) {
  const polygon = ccw(dedupePolygon(lot.polygon)), n = polygon.length;
  if (n < 3) return { kind: 'garden', lot };
  const random = seededRandom(lot.seed);
  const district = cityStyleDistrict(lot.centre.y, lot.centre.x), style = STYLES[district] ?? STYLES['Market district'], insets = INSETS[district] ?? INSETS.Midtown;
  const inner = CITY.blocks[lot.block]?.inner ?? [], boundary = inner.length >= 3 ? [...inner, inner[0]] : null;
  const isStreet = (a, b) => Boolean(boundary) && distanceToPolyline({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, boundary) < .6;
  const street = polygon.map((a, i) => isStreet(a, polygon[(i + 1) % n]));
  if (!street.some(Boolean)) {
    let best = 0;
    for (let i = 1; i < n; i++) if (edgeLength(polygon, i) > edgeLength(polygon, best)) best = i;
    street[best] = true;
  }
  const rear = insets.rear + random() * insets.jitter;
  const footprint = offsetPolygon(polygon, (a, b) => -(isStreet(a, b) ? insets.front : rear));
  const area = footprint.length >= 3 ? calcPolygonArea(footprint) : 0;
  const perimeter = footprint.reduce((sum, p, i) => sum + edgeLength(footprint, i), 0);
  if (area < 60 || area / (perimeter * perimeter) < .035) return { kind: 'garden', lot };
  const flags = edgeFlags(footprint, polygon, street);
  if (!flags.some(Boolean)) flags[0] = true;
  const downtown = Math.hypot(lot.centre.x - CITY.downtown.u, lot.centre.y - CITY.downtown.s) / Math.max(1, CITY.downtown.radius);
  let type = pick(style.types, random);
  if (area > 900 && random() < .6) type = pick(['office', 'deco', 'atrium', 'warehouse', 'apartment'], random);
  if (downtown < .7 && random() < .55) type = pick(['office', 'deco', 'atrium'], random);
  if (area < 200 && ['office', 'atrium', 'deco', 'warehouse'].includes(type)) type = pick(['shop', 'townhouse', 'brick', 'pavilion'], random);
  const [low, high] = HEIGHTS[type];
  let floors = integer(random, low, high);
  if (downtown < 1) floors += Math.round((1 - downtown) * 5 * random());
  const breadth = Math.sqrt(area);
  // No slender towers on small footprints
  floors = Math.max(low, Math.min(floors, Math.round(breadth * .9)));
  const house = footprint.length === 4 && area < 330 && ['townhouse', 'pavilion', 'shop', 'brick'].includes(type) && random() < (district === 'Garden quarter' ? .9 : .5);
  // A big lot becomes a perimeter block round a courtyard; a huge one that
  // cannot is a low hall.
  let court = [];
  if (area > 2600 && !house && type !== 'warehouse') {
    const inner = offsetPolygon(footprint, -Math.min(18, Math.max(11, breadth * .3)));
    if (inner.length >= 3 && calcPolygonArea(inner) > 160 && isSimple(inner)) court = inner;
  }
  if (court.length) {
    if (!['apartment', 'brick', 'deco', 'office'].includes(type)) type = pick(['apartment', 'brick', 'deco', 'office'], random);
    floors = Math.max(3, Math.min(floors, 8));
  } else if (area > 5000) { type = pick(['warehouse', 'pavilion'], random); floors = integer(random, 1, 2); }
  const stepped = !house && !court.length && floors >= 5 && area > 260 && (type === 'deco' || type === 'office' || type === 'atrium' || (type === 'apartment' && random() < .38));
  const shopfront = flags.some(Boolean) && type !== 'warehouse' && type !== 'pavilion' && random() < style.shops;
  return { kind: 'building', lot, district, footprint: local(footprint, c), lotLocal: local(polygon, c), court: local(court, c), street: flags, type, floors, area, breadth,
    wall: pick(style.walls, random), accent: pick(ACCENTS, random), roof: pick(ROOFS, random), roofType: house ? 'hip' : stepped ? 'terrace' : 'flat',
    setbackFloors: stepped ? Math.max(2, Math.floor(floors * .57)) : floors, seed: (lot.seed + 9973) >>> 0, variation: integer(random, 0, 3),
    shop: pick(SHOP_NAMES, random), shopfront, lawn: insets.lawn, rearWindows: rear > 2.4 };
}

function edgeWindows(c, b, f, bottom, floors, random) {
  const modern = b.type === 'office' || b.type === 'atrium', loft = b.type === 'warehouse' || b.type === 'loft', span = f.span;
  if (span < 3.2) return;
  const bays = Math.max(1, Math.floor((span - 1.6) / (modern ? 4.4 : loft ? 6.5 : b.variation === 1 ? 5.6 : 4.8)));
  const spacing = (span - 1.8) / bays;
  const windowWidth = Math.min(modern ? spacing - .36 : loft ? Math.min(3.7, spacing - 1) : b.variation === 2 ? 2.25 : 1.65, spacing - .5);
  const h = loft ? 2.45 : modern ? 2.75 : 2.2, frame = b.type === 'brick' || b.type === 'townhouse' ? '#e0ccab' : '#b3c5bc';
  for (let floor = 0; floor < floors; floor++) {
    const y = bottom + 1.7 + floor * 3.6;
    if (modern) f.add(0, y - 1.42, .1, span + .1, .28, .3, '#b6c9c8', 'solid', true);
    if (b.type === 'deco' && floor === floors - 1) f.add(0, y + 1.55, .2, span + .4, .35, .5, '#ded2b8', 'solid', true);
    for (let bay = 0; bay < bays; bay++) {
      const offset = (bay - (bays - 1) / 2) * spacing, lit = random() < .1;
      f.add(offset, y, .075, windowWidth + .25, h + .25, .11, frame);
      f.add(offset, y, .17, windowWidth, h, .09, lit ? '#e3c38d' : modern ? '#5e8a9a' : '#3e5663', lit ? 'lit' : 'glass');
      if (loft || b.variation === 1) f.add(offset, y, .25, .09, h, .07, frame);
      if (!modern) f.add(offset, y - h / 2 - .14, .25, windowWidth + .44, .14, .48, frame);
      if (b.type === 'townhouse') {
        for (const sign of [-1, 1]) f.add(offset + sign * (windowWidth / 2 + .4), y, .2, .5, h, .15, b.accent, 'solid', true);
        f.add(offset, y, .265, windowWidth, .12, .1, creamTrim);
      }
      if (b.type === 'loft') f.add(offset, y, .265, windowWidth, .12, .1, '#c8bda8');
      if (b.type === 'apartment' && f.street && floor % 2 === b.variation % 2 && bay % 2 === 0) {
        f.add(offset, y - 1.35, .68, windowWidth + 1.1, .2, 1.5, '#d1c9b5', 'solid', true);
        f.add(offset, y - .825, 1.36, windowWidth + 1.1, .85, .12, b.accent, 'solid', true);
        for (const edge of [-1, 1]) f.add(offset + edge * (windowWidth + .95) / 2, y - .825, .65, .1, .85, 1.3, b.accent);
        if (bay % 3 === 0) f.add(offset, y - .52, 1.13, windowWidth * .7, .28, .38, '#6e8856');
      }
    }
  }
  if (b.type === 'deco') for (let bay = 0; bay <= bays; bay++) f.add((bay - bays / 2) * spacing, bottom + floors * 1.8, .18, .38, floors * 3.6, .4, '#cfbea2', 'solid', true);
  if (b.type === 'loft' || b.type === 'townhouse') for (let floor = 1; floor <= floors; floor++) {
    f.add(0, bottom + floor * 3.6 - .12, .16, span + .2, b.type === 'loft' ? .4 : .22, .3, '#d6c1a0', 'solid', true);
  }
  if (b.type === 'atrium' || b.type === 'pavilion') for (let bay = 0; bay <= bays; bay++) {
    f.add((bay - bays / 2) * spacing, bottom + floors * 1.8, .4, .25, floors * 3.6, .85, b.type === 'pavilion' ? '#bf976c' : '#d5d9bd', 'solid', true);
  }
}

// The ground floor along a street: a shopfront with its sign and awnings, a
// loading bay, or a front door with windows either side.
function groundFloor(c, b, f, base, primary, random) {
  const { span } = f;
  f.add(0, G + .08, .3, span + .4, .16, .8, '#d5c19e', 'solid', true);
  f.add(0, G + .24, .06, span + .12, .48, .16, '#939b98', 'solid', true);
  if (b.shopfront && span >= 5) {
    const signBottom = 3.65, signTop = base - .18, signY = (signBottom + signTop) / 2;
    f.add(0, G + signY, .13, span - .5, signTop - signBottom, .28, b.accent, 'solid', true);
    const units = Math.max(1, Math.floor(span / 8)), spacing = (span - 1.6) / units;
    for (let i = 0; i < units; i++) {
      const offset = (i - (units - 1) / 2) * spacing;
      f.add(offset, G + 1.95, .17, spacing - 1.1, 2.8, .1, '#345963', 'glass');
      f.add(offset + spacing * .25, G + 1.95, .24, .13, 2.9, .1, '#bbd2c8');
      f.add(offset + spacing * .25 + .45, G + 1.8, .3, .06, .45, .08, '#e5d0a0');
      if ((b.variation + i) % 3 !== 0 && b.type !== 'office') {
        const canopyWidth = spacing - .7, stripes = !c.distant && b.variation % 2 === 0 ? 8 : 1;
        for (let stripe = 0; stripe < stripes; stripe++) {
          const along = offset + ((stripe + .5) / stripes - .5) * canopyWidth;
          const color = stripes > 1 && stripe % 2 === 0 ? '#e6d8b8' : b.accent;
          f.add(along, G + 3.4, 1.02, canopyWidth / stripes, .22, 2, color, 'solid', true);
          f.add(along, G + 3.1, 1.96, canopyWidth / stripes, .38, .12, color, 'solid', true);
        }
      }
    }
    if (!c.distant && primary && b.variation !== 3) {
      const sign = shopSignFor(b), w = Math.min(6.2, span * .65, (signTop - signBottom - .2) * sign.aspect), h = w / sign.aspect;
      c.item('shop-signs', signGeometry, c.materials.signs, f.position(0, G + signY, .32), [w, h, 1], '#ffffff', f.yaw).signTile = sign.tile;
    }
  } else if (b.type === 'office' || b.type === 'atrium') {
    // A glazed lobby with its mullions, a double door and a canopy
    const bays = Math.max(1, Math.floor((span - 1.2) / 3.2)), spacing = (span - 1.2) / bays;
    f.add(0, G + base / 2 + .1, .08, span - .3, base - .6, .12, '#5e8a9a', 'glass');
    for (let i = 0; i <= bays; i++) f.add(-(span - 1.2) / 2 + i * spacing, G + base / 2 + .1, .2, .14, base - .6, .12, '#b6c9c8');
    if (primary) {
      f.add(0, G + 1.25, .22, 2.4, 2.5, .1, '#2f4b55', 'glass'); f.add(0, G + 2.62, .26, 2.6, .14, .12, '#d8dbd2');
      f.add(0, G + 3.05, 1.1, 4.2, .18, 2.2, '#b6c9c8', 'solid', true);
    }
  } else if (b.type === 'warehouse') {
    f.add(0, G + 1.6, .17, Math.min(8, span * .5), 2.9, .1, '#455b61', 'glass');
    f.add(0, G + 3.3, .3, Math.min(9, span * .55), .35, .7, b.accent, 'solid', true);
    for (let y = .6; y < 3; y += .4) f.add(0, G + y, .24, Math.min(7.8, span * .49), .06, .05, '#85968f');
  } else {
    const doorOffset = primary ? 0 : span * .3 * (b.variation % 2 ? 1 : -1);
    if (primary || span > 9) {
      f.add(doorOffset, G + 1.15, .12, 1.15, 2.3, .12, b.variation % 2 ? '#4d3f36' : b.accent);
      f.add(doorOffset, G + 2.4, .2, 1.7, .22, .4, creamTrim, 'solid', true);
      f.add(doorOffset, G + .04, .5, 1.9, .1, 1.1, '#c7bba3', 'solid', true);
    }
    if (span > 5.5) for (const offset of [-span * .3, span * .3]) if (Math.abs(offset - doorOffset) > 1.9) {
      f.add(offset, G + 2, .075, 1.65, 2.05, .11, '#e0ccab');
      f.add(offset, G + 2, .17, 1.4, 1.8, .08, '#435b65', 'glass');
    }
  }
  void random;
}

// The flat top between two rings of the same size
function cap(bodies, a, b, y, colour) {
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    bodies.flat(a[i], a[j], b[j], y, colour); bodies.flat(a[i], b[j], b[i], y, colour);
  }
}
// A cornice, a parapet and the roof deck inside it, with the same again round
// any courtyard. Returns the deck polygon and the holes in it.
function cornice(bodies, ring, top, trim, roofColour, wall, parapet, courts = []) {
  const band = offsetPolygon(ring, .32), courtBands = courts.map(court => offsetPolygon(court, -.32)).filter(p => p.length >= 3);
  if (band.length >= 3) { bodies.prism(band, top - .3, top + .12, trim); bodies.polygon(band, top + .12, trim, null, true, courtBands); }
  else bodies.polygon(ring, top + .12, trim, null, true, courtBands);
  for (const courtBand of courtBands) bodies.wall(ccw(courtBand), top + .12, top - .3, trim, true);
  const inner = offsetPolygon(ring, -.32);
  bodies.prism(ring, top + .12, top + .12 + parapet, wall);
  if (inner.length >= 3) {
    bodies.wall(ccw(inner), top + .12 + parapet, top + .12, wall, true);
    if (inner.length === ring.length) cap(bodies, ring, inner, top + .12 + parapet, wall);
  }
  const holes = [];
  for (const court of courts) {
    const outer = offsetPolygon(court, .32);
    bodies.wall(ccw(court), top + .12 + parapet, top + .12, wall, true);
    if (outer.length >= 3) {
      bodies.prism(outer, top + .12, top + .12 + parapet, wall);
      if (outer.length === court.length) cap(bodies, court, outer, top + .12 + parapet, wall);
    }
    holes.push(outer.length >= 3 ? outer : court);
  }
  const deck = inner.length >= 3 ? inner : ring;
  bodies.polygon(deck, top + .18, roofColour, null, true, holes);
  return { deck, holes };
}

// A hipped roof over a four-sided house: an overhanging eave, two hips at the
// short ends, a ridge along the long axis and a chimney.
function hipRoof(c, b, bodies, ring, top) {
  const trim = '#e6dcc4', colour = b.variation % 2 ? '#8a6555' : b.roof;
  const eave = offsetPolygon(ring, .5), quad = eave.length === 4 ? eave : ring;
  bodies.prism(quad, top - .3, top + .06, trim);
  if (eave.length === 4) for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    bodies.flat(ring[i], ring[j], eave[j], top - .3, trim, null, false); bodies.flat(ring[i], eave[j], eave[i], top - .3, trim, null, false);
  }
  const length = i => edgeLength(quad, i);
  const longFirst = length(0) + length(2) >= length(1) + length(3), s0 = longFirst ? 1 : 0, s1 = longFirst ? 3 : 2;
  const short = (length(s0) + length(s1)) / 2, long = (length((s0 + 1) % 4) + length((s1 + 1) % 4)) / 2;
  const rise = Math.min(4.2, Math.max(1.6, short * .42)), centre = averagePoint(quad), k = Math.min(.92, short / Math.max(short, long));
  const mid = i => ({ x: (quad[i].x + quad[(i + 1) % 4].x) / 2, y: (quad[i].y + quad[(i + 1) % 4].y) / 2 });
  const ridge = [s0, s1].map(i => { const m = mid(i); return { x: m.x + (centre.x - m.x) * k, y: m.y + (centre.y - m.y) * k }; });
  const y0 = top + .06, y1 = top + .06 + rise, l0 = (s0 + 1) % 4, l1 = (s1 + 1) % 4;
  bodies.slope(quad[s0], y0, quad[(s0 + 1) % 4], y0, ridge[0], y1, colour);
  bodies.slope(quad[s1], y0, quad[(s1 + 1) % 4], y0, ridge[1], y1, colour);
  bodies.slope(quad[l0], y0, quad[(l0 + 1) % 4], y0, ridge[1], y1, colour); bodies.slope(quad[l0], y0, ridge[1], y1, ridge[0], y1, colour);
  bodies.slope(quad[l1], y0, quad[(l1 + 1) % 4], y0, ridge[0], y1, colour); bodies.slope(quad[l1], y0, ridge[0], y1, ridge[1], y1, colour);
  c.box(ridge[0].x + (ridge[1].x - ridge[0].x) * .3, y1 - .3, ridge[0].y + (ridge[1].y - ridge[0].y) * .3, .9, 1.7, .9, '#8c6a5a');
}

function roofDetails(c, b, deck, top, random, holes = []) {
  if (b.type === 'deco' && !holes.length) {
    const crown = offsetPolygon(deck, -b.breadth * .28);
    if (crown.length >= 3) {
      c.bodies.prism(crown, top, top + 3, b.wall); c.bodies.polygon(crown, top + 3, '#d1c5ac');
      if (b.variation === 0) { const p = averagePoint(crown); c.box(p.x, top + 7, p.y, .2, 8, .2, '#b0b7ae'); }
    }
  }
  if (c.distant) return;
  const inside = offsetPolygon(deck, -1.8), clear = holes.map(hole => offsetPolygon(hole, 1.8));
  if (inside.length < 3) return;
  const equipment = integer(random, 1, b.area > 400 ? 3 : 2);
  for (let i = 0; i < equipment; i++) {
    const p = insidePoint(inside, random, 24, clear);
    if (!p) break;
    const size = 1.2 + random() * 1.6, yaw = random() * Math.PI;
    c.box(p.x, top + .3 + size * .33, p.y, size, size * .66, size * 1.15, '#919b9b', 'solid', yaw);
    c.box(p.x, top + .365 + size * .66, p.y, size + .1, .13, size * 1.15 + .1, '#58656d', 'solid', yaw);
  }
  if (b.type === 'brick' && b.variation < 2) {
    const p = insidePoint(offsetPolygon(deck, -2.4), random, 24, clear);
    if (p) c.prop('tank', p.x, p.y, 0, top + .28);
  } else if ((b.type === 'apartment' || b.type === 'shop') && b.variation >= 2) {
    const p = insidePoint(offsetPolygon(deck, -3.6), random, 24, clear);
    if (p) {
      c.box(p.x, top + .34, p.y, 5.6, .28, 4.6, '#b2a993'); c.box(p.x, top + .51, p.y, 5, .08, 4, '#829768');
      for (const dx of [-1, 1]) for (const ds of [-1, 1]) c.box(p.x + dx * 2.5, top + 1.8, p.y + ds * 2, .17, 3, .17, '#baa27f');
      for (let i = 0; i < 5; i++) c.box(p.x - 2.5 + i * 1.25, top + 3.32, p.y, .25, .2, 4.8, '#d7c3a0');
    }
  }
}

function buildBuilding(c, b) {
  const random = seededRandom(b.seed ^ 0x3c6ef372), bodies = c.bodies, ring = b.footprint, n = ring.length;
  const base = b.type === 'warehouse' ? 4.8 : 5.4, height = base + b.floors * 3.6, lower = b.setbackFloors, lowerTop = G + base + lower * 3.6;
  const centre = averagePoint(ring);
  c.features.buildings.push({ x: c.east + centre.x, s: c.start + centre.y, area: b.area, height, type: b.type, floors: b.floors, roofType: b.roofType, wall: b.wall });
  c.polygonSolid(convexHull(ring).map(p => [p.x, p.y]));
  if (b.lawn) {
    const lot = b.lotLocal.map(p => [p.x, p.y]);
    c.polygon(lot, G + .05, .06, LAWN); grassArea(c, lot, LAWN, G + .08);
    if (!c.distant) {
      const zone = offsetPolygon(ring, 2.4), edge = [...b.lotLocal, b.lotLocal[0]];
      for (let i = 0; i < 16; i++) {
        const p = insidePoint(b.lotLocal, random);
        if (p && !insidePolygon(p, zone) && distanceToPolyline(p, edge) > 1.6) { c.tree(p.x, p.y, 5 + random() * 3); break; }
      }
    }
  }
  // The body and its ground-floor band, and the courtyard inside a big block
  const baseColour = b.type === 'office' ? '#839b9e' : b.type === 'warehouse' ? '#8e8a7d' : '#a4a69b';
  const court = b.court, courts = court.length ? [court] : [];
  bodies.prism(ring, G, lowerTop, b.wall);
  const plinth = offsetPolygon(ring, .08), courtPlinth = court.length ? offsetPolygon(court, -.08) : [];
  if (plinth.length >= 3) { bodies.prism(plinth, G, G + base, baseColour); bodies.polygon(plinth, G + base, baseColour, null, true, courtPlinth.length >= 3 ? [courtPlinth] : courts); }
  if (court.length) {
    bodies.wall(ccw(court), lowerTop, G, b.wall, true);
    if (courtPlinth.length >= 3) bodies.wall(ccw(courtPlinth), G + base, G, baseColour, true);
    const floor = court.map(p => [p.x, p.y]);
    c.polygon(floor, G + .05, .06, LAWN); grassArea(c, floor, LAWN, G + .08);
    if (!c.distant) {
      const garden = offsetPolygon(court, -3);
      for (let i = 0, placed = 0; i < 12 && placed < 2; i++) { const p = insidePoint(garden, random); if (p) { c.tree(p.x, p.y, 5 + random() * 3); placed++; } }
    }
    let longest = 0;
    for (let i = 1; i < court.length; i++) if (edgeLength(court, i) > edgeLength(court, longest)) longest = i;
    for (let i = 0; i < court.length; i++) {
      const f = edgeFacade(c, court[(i + 1) % court.length], court[i]);
      f.street = true;
      if (f.span < 2.5) continue;
      groundFloor(c, { ...b, shopfront: false }, f, base, i === longest, random);
      edgeWindows(c, b, f, G + base, lower, random);
    }
  }
  // Facades, wall by wall: the longest street wall carries the door or the sign
  let primary = -1;
  for (let i = 0; i < n; i++) if (b.street[i] && (primary < 0 || edgeLength(ring, i) > edgeLength(ring, primary))) primary = i;
  for (let i = 0; i < n; i++) {
    const f = edgeFacade(c, ring[i], ring[(i + 1) % n]);
    f.street = b.street[i];
    if (f.span < 2.5) continue;
    if (f.street) groundFloor(c, b, f, base, i === primary, random);
    if (f.street || b.rearWindows) edgeWindows(c, b, f, G + base, lower, random);
  }
  if (b.roofType === 'hip') { hipRoof(c, b, bodies, ring, lowerTop); return; }
  const trim = b.type === 'office' ? '#b8cccd' : '#d6c9b1';
  let { deck, holes } = cornice(bodies, ring, lowerTop, trim, b.roof, b.wall, b.type === 'deco' ? 1.2 : .65, courts), top = lowerTop;
  if (lower < b.floors) {
    const inset = Math.min(4, b.breadth * .15), upper = offsetPolygon(ring, -inset);
    if (upper.length >= 3 && calcPolygonArea(upper) > 50) {
      const upperTop = G + height, wall = b.type === 'office' ? '#7898a6' : b.wall;
      bodies.prism(upper, lowerTop + .12, upperTop, wall);
      for (let i = 0; i < upper.length; i++) {
        const f = edgeFacade(c, upper[i], upper[(i + 1) % upper.length]);
        f.street = true;
        if (f.span >= 2.5) edgeWindows(c, b, f, lowerTop + .12, b.floors - lower, random);
      }
      ({ deck, holes } = cornice(bodies, upper, upperTop, trim, b.roof, wall, .85)); top = upperTop;
    }
  }
  roofDetails(c, b, deck, top, random, holes);
}

// A lot with no room for a building: a lawn with a tree or two.
export function buildGarden(c, lot) {
  const random = seededRandom(lot.seed ^ 0x2545f491);
  const points = lot.polygon.map(p => [p.x - c.east, p.y - c.start]);
  c.polygon(points, G + .05, .06, LAWN);
  grassArea(c, points, LAWN, G + .08);
  if (c.distant) return;
  const polygon = local(lot.polygon, c), edge = [...polygon, polygon[0]], count = lot.area > 400 ? 2 : 1;
  for (let i = 0, placed = 0; i < 20 && placed < count; i++) {
    const p = insidePoint(polygon, random);
    if (!p || distanceToPolyline(p, edge) < 2.2) continue;
    c.tree(p.x, p.y, 6 + random() * 3); placed++;
  }
}

export function buildCityBuildings(c) {
  for (const _ of buildCityBuildingSteps(c)) { /* synchronous startup */ }
}

export function* buildCityBuildingSteps(c) {
  const plan = c.lots.map(lot => planLot(c, lot));
  yield;
  for (const b of plan) {
    if (b.kind === 'building') c.structure(0, 0, () => buildBuilding(c, b));
    else buildGarden(c, b.lot);
    yield;
  }
}

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

