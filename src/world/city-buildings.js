import * as THREE from 'three';
import { seededRandom } from './route.js';
import { PAVEMENT_LEVEL as G } from './city-route.js';
import { CITY, cityStyleDistrict } from './city.js';
import { SHOP_NAMES, shopSignFor } from './city-signs.js';
import { grassArea } from './city-grass.js';
import { placeForLot, placeForBlock } from '../city-exploration.js';
import { buildLandmark } from './city-landmarks.js';
import { averagePoint, insidePolygon, polygonBounds, offsetPolygon, offsetPolygonMapped, calcPolygonArea, signedArea, distanceToPolyline, dedupePolygon, isSimple, fitRectangle } from '../mapgen/polygon-util.js';
import { union, intersection } from '../mapgen/booleans.js';
import { simplify } from '../mapgen/simplify.js';
import { itemFrame } from './city-layout-render.js';
import { lotWithoutDrive } from './city-yards.js';

// Buildings follow their lots. A lot is one plot of a block's frontage strip
// (see mapgen/lots.js) and knows which of its edges face the street, which
// its neighbours and which the yard behind. The building is the lot stepped
// in edge by edge: a small step from the pavement in front, a party wall or a
// garden gap at the sides by district, and a yard behind so the building is
// only as deep as its kind of building is. Facades bend with the streets and
// corner buildings wrap their corners.
const pick = (items, random) => items[Math.floor(random() * items.length)];
const integer = (random, min, max) => min + Math.floor(random() * (max - min + 1));
const ACCENTS = ['#386f73', '#a9503e', '#cc9a48', '#456282', '#687b59'];
const creamTrim = '#e4d2b0', LAWN = '#7f9a5e';
const ROOFS = ['#647c7a', '#667789', '#987463', '#758a7d', '#8b8874'];
// Each district's building kinds (for narrow and for wide frontages), walls,
// share of shopfronts, and the storeys its street walls rise to
const STYLES = {
  'Old town': { narrow: ['townhouse', 'townhouse', 'brick', 'shop'], wide: ['brick', 'deco', 'apartment'], walls: ['#c88368', '#d4bb91', '#a65e52', '#ead2b0', '#7b9d95'], shops: .75, floors: [3, 5] },
  'Garden quarter': { narrow: ['townhouse', 'pavilion', 'townhouse'], wide: ['apartment', 'townhouse', 'pavilion'], walls: ['#cbd6b5', '#86b1a1', '#e6d1ad', '#d5a998', '#9daec1'], shops: .12, floors: [1, 3] },
  Midtown: { narrow: ['deco', 'office', 'apartment'], wide: ['office', 'atrium', 'deco', 'office'], walls: ['#8eafb9', '#accad0', '#ded0b4', '#7897a7', '#b4aaa3'], shops: .7, floors: [6, 12] },
  'Warehouse district': { narrow: ['loft', 'brick', 'loft'], wide: ['warehouse', 'loft', 'warehouse', 'pavilion'], walls: ['#b7795b', '#cfac84', '#87a19a', '#a67b69', '#c8b58c'], shops: .3, floors: [1, 4] },
  'Market district': { narrow: ['shop', 'townhouse', 'brick'], wide: ['apartment', 'shop', 'brick', 'pavilion'], walls: ['#d08a70', '#dec29a', '#74a39a', '#d6ab7d', '#859aaf'], shops: .85, floors: [2, 4] },
  'Civic quarter': { narrow: ['brick', 'deco', 'townhouse'], wide: ['deco', 'brick', 'apartment', 'deco', 'atrium'], walls: ['#dbcfb8', '#a1b8bc', '#c99a83', '#ddc19e', '#afc8b4'], shops: .4, floors: [3, 6] },
};
const HEIGHTS = { brick: [2, 6], apartment: [3, 8], shop: [1, 2], warehouse: [1, 3], office: [6, 18], deco: [4, 12], townhouse: [2, 4], loft: [3, 5], pavilion: [1, 2], atrium: [5, 12] };
// How a building stands on its lot: its step back from the pavement, the gap
// to each neighbour (a hair for a party wall), how deep the building itself
// is, the least yard behind it, and whether its plot is a garden.
const INSETS = {
  'Old town': { front: .45, side: .08, depth: [11, 15], rear: 1.5, lawn: false },
  'Market district': { front: .6, side: .08, depth: [12, 16], rear: 1.5, lawn: false },
  Midtown: { front: 1.2, side: .1, depth: [20, 30], rear: 1.2, lawn: false },
  'Warehouse district': { front: 1.6, side: .9, depth: [18, 28], rear: 2, lawn: false },
  'Garden quarter': { front: 4.5, side: 2.4, depth: [9, 13], rear: 3, lawn: true },
  'Civic quarter': { front: 2.4, side: 1.1, depth: [13, 19], rear: 2.5, lawn: true },
};
// How far a district's buildings stand back from the pavement
export const frontSetback = district => (INSETS[district] ?? INSETS.Midtown).front;
// The biggest tree (its scale) whose crown only brushes a wall `room` metres
// from its trunk (see city-assets.js: the widest cluster on the widest tree)
export const treeRoom = room => (room + .9) / .52;
// The share of a district's plain four-sided buildings under a pitched roof:
// the old streets' terraces each have their own, and the warehouses a low one
// along their length. Downtown's and the civic quarter's are mostly flat.
const PITCHED = { 'Old town': .75, 'Market district': .45, 'Garden quarter': .5, 'Civic quarter': .12, 'Warehouse district': .55, Midtown: 0 };
const PITCHED_TYPES = new Set(['townhouse', 'brick', 'shop', 'apartment', 'loft', 'warehouse', 'pavilion']);
// Tiles for a pitched roof: terracotta in the old streets, slate or sheet
// metal where the town is newer or works for its living
const TILES = {
  'Old town': ['#a35f4a', '#ad6c51', '#8f5445', '#a35f4a', '#6d7277'],
  'Market district': ['#a35f4a', '#6d7277', '#96634e', '#5f676e'],
  'Garden quarter': ['#8a6555', '#6d7277', '#987463', '#5f676e', '#a35f4a'],
  'Civic quarter': ['#5f676e', '#6d7277', '#737a70'],
  'Warehouse district': ['#8b9396', '#7c8688', '#948f86'],
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
export function insidePoint(polygon, random, tries = 24, holes = []) {
  if (polygon.length < 3) return null;
  const bounds = polygonBounds(polygon);
  for (let i = 0; i < tries; i++) {
    const p = { x: bounds.minX + random() * (bounds.maxX - bounds.minX), y: bounds.minY + random() * (bounds.maxY - bounds.minY) };
    if (insidePolygon(p, polygon) && !holes.some(hole => insidePolygon(p, hole))) return p;
  }
  return null;
}
// Which edges of a lot face the street, when the lot does not say: those on
// its block's inner edge, or failing that its longest edge
function streetEdges(polygon, block) {
  const n = polygon.length, inner = CITY.blocks[block]?.inner ?? [], boundary = inner.length >= 3 ? [...inner, inner[0]] : null;
  const kinds = polygon.map((a, i) => {
    const b = polygon[(i + 1) % n];
    return boundary && distanceToPolyline({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, boundary) < .6 ? 'street' : 'side';
  });
  if (!kinds.includes('street')) {
    let best = 0;
    for (let i = 1; i < n; i++) if (edgeLength(polygon, i) > edgeLength(polygon, best)) best = i;
    kinds[best] = 'street';
  }
  return kinds;
}
// The interior angle at each corner of an anticlockwise polygon
const cornerAngle = (polygon, i) => {
  const n = polygon.length, a = polygon[(i - 1 + n) % n], p = polygon[i], b = polygon[(i + 1) % n];
  const ux = a.x - p.x, uy = a.y - p.y, vx = b.x - p.x, vy = b.y - p.y;
  const angle = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1))));
  return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) >= 0 ? angle : Math.PI * 2 - angle;
};
const SHARP = 70 * Math.PI / 180;

// How a building sits on an awkward lot. Real buildings are wings a room or
// two deep along their streets, whatever the lot's shape: so the building
// is the lot, stepped in, cut to a strip `depth` deep behind each street
// wall, and the odd shape left over behind it is yard. A fan-shaped lot keeps
// its front and loses its tail; a corner lot becomes an L of two wings. Any
// corner still sharper than SHARP gets a blunt corner facade, a flatiron's
// nose, rather than a knife edge. Returns the footprint and its wall kinds
// (street, side or rear), or null to keep the one given.
function massBuilding(footprint, wallKinds, depth) {
  const n = footprint.length, streets = wallKinds.map((kind, i) => kind === 'street' ? i : -1).filter(i => i >= 0);
  if (!streets.length) return null;
  // Already a building's shape: no sharp corner, and no deeper than a wing
  const sharp = footprint.some((p, i) => cornerAngle(footprint, i) < SHARP);
  const inward = i => {
    const a = footprint[i], b = footprint[(i + 1) % n], length = edgeLength(footprint, i) || 1;
    return { a, b, tx: (b.x - a.x) / length, ty: (b.y - a.y) / length, nx: -(b.y - a.y) / length, ny: (b.x - a.x) / length };
  };
  const reach = Math.max(...footprint.map(p => Math.min(...streets.map(i => { const w = inward(i); return (p.x - w.a.x) * w.nx + (p.y - w.a.y) * w.ny; }))));
  if (!sharp && reach <= depth * 1.15) return null;
  // Wings: a strip behind each street wall, run on past its ends to meet the next
  const wings = streets.map(i => {
    const { a, b, tx, ty, nx, ny } = inward(i), run = depth;
    return [{ x: a.x - tx * run, y: a.y - ty * run }, { x: b.x + tx * run, y: b.y + ty * run }, { x: b.x + tx * run + nx * depth, y: b.y + ty * run + ny * depth }, { x: a.x - tx * run + nx * depth, y: a.y - ty * run + ny * depth }];
  });
  let best = null;
  for (const piece of intersection([footprint], union(wings).flatMap(p => [p.outer, ...p.holes]))) {
    if (!best || calcPolygonArea(piece.outer) > calcPolygonArea(best)) best = piece.outer;
  }
  if (!best) return null;
  // Blunt the sharp corners: a facade about as wide as a wing is deep
  let shape = best;
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    shape.forEach((p, i) => {
      const angle = cornerAngle(shape, i);
      if (angle >= SHARP) { out.push(p); return; }
      const m = shape.length, a = shape[(i - 1 + m) % m], b = shape[(i + 1) % m], la = Math.hypot(a.x - p.x, a.y - p.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
      const cut = Math.min(Math.min(6, depth * .5) / 2 / Math.sin(Math.max(.05, angle / 2)), la * .45, lb * .45);
      out.push({ x: p.x + (a.x - p.x) / la * cut, y: p.y + (a.y - p.y) / la * cut }, { x: p.x + (b.x - p.x) / lb * cut, y: p.y + (b.y - p.y) / lb * cut });
    });
    shape = out;
  }
  // Tidy: no slivers of wall, no corners that are not corners. A front round
  // a curve is a chain of slight corners, so it keeps those that hold it
  // within a few centimetres of the curve, not one wall straight across it
  // (from the sharpest corner, which always stays)
  shape = dedupePolygon(shape, .6);
  if (shape.length >= 3) {
    const first = shape.reduce((best, p, i) => Math.abs(cornerAngle(shape, i) - Math.PI) > Math.abs(cornerAngle(shape, best) - Math.PI) ? i : best, 0);
    shape = simplify([...shape.slice(first), ...shape.slice(0, first + 1)], .1).slice(0, -1).map(p => ({ x: p.x, y: p.y }));
  }
  if (shape.length < 3 || !isSimple(shape) || calcPolygonArea(shape) < 45) return null;
  if (signedArea(shape) < 0) shape.reverse();
  // Each wall is what it stands on: along a street wall of the stepped-in lot
  // it is a street front, along a side a party wall; a wall across a street
  // corner is a corner facade; anything else looks onto the yard
  const kinds = shape.map((p, i) => {
    const q = shape[(i + 1) % shape.length], m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    let nearest = -1, nearestDistance = Infinity;
    for (let j = 0; j < n; j++) {
      const d = distanceToPolyline(m, [footprint[j], footprint[(j + 1) % n]]);
      if (d < nearestDistance) { nearestDistance = d; nearest = j; }
    }
    if (nearestDistance < .5) return wallKinds[nearest];
    // Between two street fronts: the corner facade
    const near = j => distanceToPolyline(p, [footprint[j], footprint[(j + 1) % n]]) < .5 || distanceToPolyline(q, [footprint[j], footprint[(j + 1) % n]]) < .5;
    const touching = footprint.map((_, j) => j).filter(near);
    return touching.length && touching.every(j => wallKinds[j] === 'street') ? 'street' : 'rear';
  });
  return { footprint: shape, wallKinds: kinds };
}

// Which wall of a four-sided building a pitched roof's eave runs along (the
// other eave is the wall across from it), or -1 where a pitched roof would
// not sit: a shape far from a rectangle, a span too deep to roof, or gables
// too narrow. A terrace's ridge runs along its street and its gables stand on
// the party walls; a shed's runs the length of the shed.
function pitchedEaves(footprint, street, shed) {
  if (footprint.length !== 4) return -1;
  if (footprint.some((p, i) => Math.abs(cornerAngle(footprint, i) - Math.PI / 2) > .6)) return -1;
  const length = i => edgeLength(footprint, i % 4);
  let eave;
  if (shed) eave = length(0) + length(2) >= length(1) + length(3) ? 0 : 1;
  else {
    eave = -1;
    for (let i = 0; i < 4; i++) if (street[i] && (eave < 0 || length(i) > length(eave))) eave = i;
    if (eave < 0) return -1;
  }
  // Opposite eaves near parallel, the gables wide enough and the span not too deep
  const direction = i => { const a = footprint[i % 4], b = footprint[(i + 1) % 4], l = length(i) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
  const d0 = direction(eave), d2 = direction(eave + 2);
  if (d0.x * -d2.x + d0.y * -d2.y < Math.cos(.35)) return -1;
  const span = Math.min(length(eave + 1), length(eave + 3));
  if (span < 4.5 || Math.max(length(eave + 1), length(eave + 3)) > (shed ? 42 : 18) || Math.min(length(eave), length(eave + 2)) < 3.5) return -1;
  return eave;
}

const convex = polygon => polygon.every((p, i) => {
  const a = polygon[(i - 1 + polygon.length) % polygon.length], b = polygon[(i + 1) % polygon.length];
  return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) >= -1e-6;
});
// Storeys a block's street walls rise to, shared by its buildings
function blockFloors(block, style) {
  const random = seededRandom((block * 7919 + CITY.seed * 31) >>> 0);
  return integer(random, style.floors[0], style.floors[1]);
}

// The pieces of a rectangle on a wall ({x0, x1, y0, y1}) outside a zone
function cutAround(pieces, z) {
  return pieces.flatMap(r => {
    if (r.x1 <= z.from || r.x0 >= z.to || r.y1 <= z.bottom || r.y0 >= z.top) return [r];
    const x0 = Math.max(r.x0, z.from), x1 = Math.min(r.x1, z.to);
    return [{ ...r, x1: z.from }, { ...r, x0: z.to }, { x0, x1, y0: r.y0, y1: z.bottom }, { x0, x1, y0: z.top, y1: r.y1 }]
      .filter(p => p.x1 - p.x0 > .05 && p.y1 - p.y0 > .05);
  });
}
// Coordinates on one wall of a building: offset along the wall from its
// middle, height, and distance outwards. The wall's own yaw turns each box.
// A sign mounted on the wall keeps its patch of wall `clear` ({from, to,
// bottom, top}): no window stands behind it, and the pilasters, fins and
// string courses that would cross it stop at its edges.
export function edgeFacade(c, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, span = Math.hypot(dx, dy) || 1, tx = dx / span, ty = dy / span, nx = ty, ny = -tx;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, yaw = Math.atan2(ty, tx);
  const point = (offset, outward) => ({ x: mx + tx * offset + nx * outward, s: my + ty * offset + ny * outward });
  return { span, yaw, street: false, clear: [], normal: { x: nx, y: ny },
    // A point's offset along the wall and distance out from it
    local(x, s) { const ex = x - mx, ey = s - my; return { offset: ex * tx + ey * ty, outward: ex * nx + ey * ny }; },
    // Whether a rectangle on the wall would stand behind a sign
    blocked(offset, y, w, h) { return this.clear.some(z => offset + w / 2 > z.from && offset - w / 2 < z.to && y + h / 2 > z.bottom && y - h / 2 < z.top); },
    position(offset, y, outward) { const p = point(offset, outward); return [p.x, y, -p.s]; },
    add(offset, y, outward, w, h, d, color, kind = 'solid', broad = false) {
      if (c.distant && kind === 'solid' && !broad) return;
      let pieces = [{ x0: offset - w / 2, x1: offset + w / 2, y0: y - h / 2, y1: y + h / 2 }];
      for (const z of this.clear) pieces = cutAround(pieces, z);
      // (a pilaster cut short by a sign stops, rather than leaving a stub
      // that looks like the sign's post)
      if (w < 1 && h > 3) pieces = pieces.filter(r => r.y1 - r.y0 >= Math.min(2.2, h - .01));
      for (const r of pieces) {
        const p = point((r.x0 + r.x1) / 2, outward), pw = r.x1 - r.x0, ph = r.y1 - r.y0, py = (r.y0 + r.y1) / 2;
        if (c.distant && (kind === 'glass' || kind === 'lit')) c.item(`distant-${kind}`, signGeometry, c.materials[kind], [p.x, py, -p.s], [pw, ph, 1], color, yaw);
        else c.box(p.x, py, p.s, pw, ph, d, color, kind, yaw);
      }
    } };
}

// Which of its block's lots a lot is, counting round the block, so the block
// can deal its shops their signs in turn (see city-signs.js)
let firstLots = null;
function shopSlot(lot) {
  if (lot.index === undefined || !(lot.block >= 0) || !CITY.lotBlocks) return {};
  if (!firstLots || firstLots.city !== CITY.lotBlocks) {
    firstLots = new Map();
    firstLots.city = CITY.lotBlocks;
    CITY.lotBlocks.forEach((block, i) => { if (!firstLots.has(block)) firstLots.set(block, i); });
  }
  return { shopBlock: (lot.block + Math.imul(CITY.seed, 7919)) | 0, shopSlot: lot.index - (firstLots.get(lot.block) ?? lot.index) };
}

// Lot subdivision also calls an exposed edge beside a yard or a missing lot
// a 'side'. Only a wall with another plot close outside it is a party wall.
// Keep three metres of outlook over the whole face, including concave corners.
export function wallHasOutlook(ring, i, neighbours) {
  const a = ring[i], b = ring[(i + 1) % ring.length], length = edgeLength(ring, i);
  if (length < 3.2) return false;
  const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
  const at = (along, out) => ({ x: a.x + tx * along + ty * out, y: a.y + ty * along - tx * out });
  const strip = [at(.6, .05), at(length - .6, .05), at(length - .6, 3), at(.6, 3)], bounds = polygonBounds(strip);
  return [ring, ...neighbours].every(polygon => {
    const other = polygonBounds(polygon);
    if (other.maxX < bounds.minX || other.minX > bounds.maxX || other.maxY < bounds.minY || other.minY > bounds.maxY) return true;
    return !intersection([strip], [polygon]).some(piece => calcPolygonArea(piece.outer) > .01);
  });
}
let plotsByBlock = null;
function neighboursOf(lot) {
  if (!plotsByBlock) {
    plotsByBlock = new Map();
    CITY.lots.forEach((polygon, index) => {
      const block = CITY.lotBlocks[index];
      if (!plotsByBlock.has(block)) plotsByBlock.set(block, []);
      plotsByBlock.get(block).push({ polygon, index });
    });
  }
  return (plotsByBlock.get(lot.block) ?? []).filter(p => p.index !== lot.index).map(p => p.polygon);
}

// What stands on a lot: a building shaped like the lot, or a garden where
// the lot is too small or too awkward for one.
export function planLot(c, lot) {
  // A place worth a taxi ride is a landmark of its own kind; one with a
  // whole block to itself stands in for the block's lots
  const place = lot.place ?? (lot.index === undefined ? null : placeForLot(lot.index));
  if (place) return { kind: 'landmark', lot, place };
  if (lot.block !== undefined && lot.block >= 0 && placeForBlock(lot.block)) return { kind: 'none', lot };
  // A lot that gives up a driveway to the car park behind it builds on the rest
  const rest = lot.index === undefined ? null : lotWithoutDrive(lot.index, lot.polygon);
  if (rest?.length >= 3) lot = { ...lot, polygon: rest, edges: null, area: calcPolygonArea(rest) };
  let polygon = dedupePolygon(lot.polygon);
  if (polygon.length < 3) return { kind: 'garden', lot };
  let kinds = lot.edges?.length === polygon.length ? lot.edges : null;
  if (signedArea(polygon) < 0) { polygon = polygon.slice().reverse(); kinds = null; }
  kinds ??= streetEdges(polygon, lot.block);
  const n = polygon.length, random = seededRandom(lot.seed);
  const district = cityStyleDistrict(lot.centre.y, lot.centre.x), style = STYLES[district] ?? STYLES['Market district'], insets = INSETS[district] ?? INSETS.Midtown;
  // The building's own depth decides how much yard is left behind it
  const depth = insets.depth[0] + random() * (insets.depth[1] - insets.depth[0]);
  const rear = Math.max(insets.rear, (lot.depth || depth + insets.front + insets.rear) - insets.front - depth);
  const front = insets.front + (district === 'Old town' || district === 'Market district' ? random() * .35 : 0);
  const setback = i => kinds[i] === 'street' ? front : kinds[i] === 'rear' ? rear : insets.side;
  const mapped = offsetPolygonMapped(polygon, (a, b, i) => -setback(i));
  const footprint = mapped?.points ?? [];
  const area = footprint.length >= 3 ? calcPolygonArea(footprint) : 0;
  const perimeter = footprint.reduce((sum, p, i) => sum + edgeLength(footprint, i), 0);
  if (area < 45 || area / (perimeter * perimeter) < .035) return { kind: 'garden', lot };
  // Each wall of the footprint takes the kind of the lot edge it was stepped from
  const wallKinds = footprint.map(() => 'side');
  for (let j = 0; j < n; j++) {
    const k0 = mapped.source[j], k1 = mapped.source[(j + 1) % n];
    if (k0 !== k1 && (k0 + 1) % footprint.length === k1) wallKinds[k0] = kinds[j];
  }
  // A detached house on a wedge or L-shaped lot is a plain rectangle, square
  // to its longest street; a terrace follows its streets in wings
  let footprintOut = footprint;
  if (insets.side <= 1.5) {
    const massed = massBuilding(footprint, wallKinds, depth);
    if (massed) { footprintOut = massed.footprint; wallKinds.length = 0; wallKinds.push(...massed.wallKinds); }
  }
  if (insets.side > 1.5 && (!convex(footprint) || footprint.length > 5 || footprint.some((p, i) => cornerAngle(footprint, i) < SHARP))) {
    let best = -1;
    for (let j = 0; j < n; j++) if (kinds[j] === 'street' && (best < 0 || edgeLength(polygon, j) > edgeLength(polygon, best))) best = j;
    const a = polygon[Math.max(0, best)], b = polygon[(Math.max(0, best) + 1) % n], length = edgeLength(polygon, Math.max(0, best)) || 1;
    const rect = best >= 0 ? fitRectangle(footprint, (b.x - a.x) / length, (b.y - a.y) / length) : null;
    if (rect && calcPolygonArea(rect) > 45) {
      footprintOut = signedArea(rect) < 0 ? rect.reverse() : rect;
      // A wall faces a street when a street edge of the lot lies beyond it
      const centre = averagePoint(footprintOut);
      wallKinds.length = 0;
      for (let i = 0; i < 4; i++) {
        const p = footprintOut[i], q = footprintOut[(i + 1) % 4], nx = q.y - p.y, ny = p.x - q.x, nl = Math.hypot(nx, ny) || 1;
        let facing = 'side';
        for (let j = 0; j < n; j++) {
          if (kinds[j] !== 'street') continue;
          const m = { x: (polygon[j].x + polygon[(j + 1) % n].x) / 2 - centre.x, y: (polygon[j].y + polygon[(j + 1) % n].y) / 2 - centre.y }, ml = Math.hypot(m.x, m.y) || 1;
          if ((m.x * nx + m.y * ny) / (ml * nl) > .8) facing = 'street';
        }
        wallKinds.push(facing);
      }
    }
  }
  // A house that could only be a wedge is a garden instead
  if (insets.side > 1.5 && footprintOut === footprint && footprint.some((p, i) => cornerAngle(footprint, i) < SHARP)) return { kind: 'garden', lot };
  const street = wallKinds.map(kind => kind === 'street');
  if (!street.some(Boolean)) street[0] = true;
  const massedArea = calcPolygonArea(footprintOut);
  const frontage = footprintOut.reduce((sum, p, i) => sum + (street[i] ? edgeLength(footprintOut, i) : 0), 0);
  const downtown = Math.hypot(lot.centre.x - CITY.downtown.u, lot.centre.y - CITY.downtown.s) / Math.max(1, CITY.downtown.radius);
  let type = pick(frontage < 16 ? style.narrow : style.wide, random);
  if (massedArea < 150 && ['office', 'atrium', 'deco', 'warehouse'].includes(type)) type = pick(['shop', 'townhouse', 'brick'], random);
  const [low, high] = HEIGHTS[type];
  let floors = Math.max(low, Math.min(high, blockFloors(lot.block, style) + integer(random, -1, 1)));
  // The skyline rises toward downtown, with the odd tower above it
  if (downtown < 1.1) floors += Math.round(Math.max(0, 1 - downtown) * 7 * random());
  if (downtown < .55 && random() < .22) floors += integer(random, 4, 10);
  const breadth = Math.sqrt(calcPolygonArea(footprintOut));
  // No slender towers on small footprints
  floors = Math.max(Math.min(low, 2), Math.min(floors, Math.round(breadth * .9)));
  // A small detached house has a hipped roof; a terraced one, between its
  // neighbours' party walls, takes a pitched one below
  const house = footprintOut.length === 4 && massedArea < 330 && ['townhouse', 'pavilion', 'shop', 'brick'].includes(type) && insets.side > .5 && random() < (district === 'Garden quarter' ? .9 : .5);
  // A big lot becomes a perimeter block round a courtyard; a huge one that
  // cannot is a low hall.
  let court = [];
  if (massedArea > 2600 && !house && type !== 'warehouse') {
    const inner = offsetPolygon(footprintOut, -Math.min(18, Math.max(11, breadth * .3)));
    if (inner.length >= 3 && calcPolygonArea(inner) > 160 && isSimple(inner)) court = inner;
  }
  if (court.length) {
    if (!['apartment', 'brick', 'deco', 'office'].includes(type)) type = pick(['apartment', 'brick', 'deco', 'office'], random);
    floors = Math.max(3, Math.min(floors, 8));
  } else if (massedArea > 5000) { type = pick(['warehouse', 'pavilion'], random); floors = integer(random, 1, 2); }
  const stepped = !house && !court.length && floors >= 6 && massedArea > 260 && (type === 'deco' || type === 'office' || type === 'atrium' || (type === 'apartment' && random() < .38));
  // A pitched roof where the district builds them, over a plain four-sided
  // building no taller than a pitched roof is usually put on
  const shed = type === 'warehouse' || type === 'pavilion';
  const eaves = !house && !stepped && !court.length && floors <= 6 && PITCHED_TYPES.has(type) ? pitchedEaves(footprintOut, street, shed) : -1;
  const pitched = eaves >= 0 && random() < (PITCHED[district] ?? 0) * (shed || district !== 'Warehouse district' ? 1 : .35);
  const shopfront = type !== 'warehouse' && type !== 'pavilion' && random() < style.shops;
  // A house or a terrace of houses has an ordinary ground floor in its own
  // walls, not the tall stone base of a block over shops
  const domestic = !shopfront && (house || type === 'townhouse' || (type === 'pavilion' && insets.lawn));
  // Windows on the street, on the yard when there is room behind, and on the
  // sides only where there is a gap to look out of
  const neighbours = lot.index === undefined ? null : neighboursOf(lot);
  const windows = wallKinds.map((kind, i) => street[i] || (kind === 'rear' && (rear > 2.4 || footprintOut !== footprint))
    || (kind === 'side' && (insets.side > 1.5 || Boolean(neighbours && wallHasOutlook(footprintOut, i, neighbours)))));
  return { kind: 'building', lot, district, footprint: local(footprintOut, c), lotLocal: local(polygon, c), court: local(court, c), street, windows, type, floors, area: massedArea, breadth,
    wall: pick(style.walls, random), accent: pick(ACCENTS, random), roof: pick(pitched ? TILES[district] ?? ROOFS : ROOFS, random), roofType: house ? 'hip' : pitched ? 'gable' : stepped ? 'terrace' : 'flat', eaves,
    setbackFloors: stepped ? Math.max(2, Math.floor(floors * .57)) : floors, seed: (lot.seed + 9973) >>> 0, variation: integer(random, 0, 3),
    shop: pick(SHOP_NAMES, random), ...shopSlot(lot), shopfront, domestic, lawn: insets.lawn, side: insets.side, party: wallKinds.map(kind => kind === 'side'), lotStreet: kinds.map(kind => kind === 'street'), rearWindows: rear > 2.4 || footprintOut !== footprint };
}

export function edgeWindows(c, b, f, bottom, floors, random) {
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
      // Balconies stack over one another, with a glazed door down to the
      // deck. The other bays keep their ordinary windows and sills.
      const balcony = b.type === 'apartment' && f.street && bay % 3 === b.variation % 3;
      const height = balcony ? 2.58 : h, centre = balcony ? y - .19 : y;
      // (no window, sill or balcony behind a sign)
      if (f.clear.length && f.blocked(offset, y - .3, windowWidth + 1.2, h + 1.2)) continue;
      f.add(offset, centre, .075, windowWidth + .25, height + .25, .11, frame);
      f.add(offset, centre, .17, windowWidth, height, .09, lit ? '#e3c38d' : modern ? '#5e8a9a' : '#3e5663', lit ? 'lit' : 'glass');
      if (loft || b.variation === 1) f.add(offset, y, .25, .09, h, .07, frame);
      if (!modern && !balcony) f.add(offset, y - h / 2 - .14, .25, windowWidth + .44, .14, .48, frame);
      if (b.type === 'townhouse') {
        for (const sign of [-1, 1]) f.add(offset + sign * (windowWidth / 2 + .4), y, .2, .5, h, .15, b.accent, 'solid', true);
        f.add(offset, y, .265, windowWidth, .12, .1, creamTrim);
      }
      if (b.type === 'loft') f.add(offset, y, .265, windowWidth, .12, .1, '#c8bda8');
      if (balcony) {
        f.add(offset, y - 1.58, .68, windowWidth + 1.1, .2, 1.5, '#d1c9b5', 'solid', true);
        f.add(offset, y - 1.03, 1.36, windowWidth + 1.1, .9, .12, b.accent, 'solid', true);
        for (const edge of [-1, 1]) f.add(offset + edge * (windowWidth + .95) / 2, y - 1.03, .65, .1, .9, 1.3, b.accent);
        if ((floor + bay + b.variation) % 3 === 0) f.add(offset, y - .58, 1.13, windowWidth * .7, .24, .38, '#6e8856');
      }
    }
  }
  // (pilasters, fins and string courses stop under the cornice or eaves that
  // cap the wall, rather than meeting its faces)
  const rise = floors * 3.6 - .12;
  if (b.type === 'deco') for (let bay = 0; bay <= bays; bay++) f.add((bay - bays / 2) * spacing, bottom + rise / 2, .18, .38, rise, .4, '#cfbea2', 'solid', true);
  if (b.type === 'loft' || b.type === 'townhouse') for (let floor = 1; floor < floors; floor++) {
    f.add(0, bottom + floor * 3.6 - .12, .16, span + .2, b.type === 'loft' ? .4 : .22, .3, '#d6c1a0', 'solid', true);
  }
  if (b.type === 'atrium' || b.type === 'pavilion') for (let bay = 0; bay <= bays; bay++) {
    f.add((bay - bays / 2) * spacing, bottom + rise / 2, .4, .25, rise, .85, b.type === 'pavilion' ? '#bf976c' : '#d5d9bd', 'solid', true);
  }
}

// How a street wall is entered: the whole of a shopfront, an office's lobby
// door, a warehouse's loading door, or a front door, in the middle of the
// main front and to one side of a long secondary one. Null for a wall with no
// way in. `offset` runs along the wall from its middle.
function entrance(b, span, primary) {
  if (b.shopfront && span >= 5) return { shop: true, offset: 0, width: span };
  if (b.type === 'office' || b.type === 'atrium') return primary ? { offset: 0, width: 3.2 } : null;
  if (b.type === 'warehouse') return { offset: 0, width: Math.min(8, span * .5) + 1 };
  if (primary) return { offset: 0, width: 1.6 };
  return span > 9 ? { offset: span * .3 * (b.variation % 2 ? 1 : -1), width: 1.6 } : null;
}

// Where along a shopfront its sign goes, and how big: over the middle, unless
// a street tree's crown or a lamp's column stands in front of it there, and
// over one of the shop's windows or its door (`centres`) or at one end of its
// fascia, a little smaller if need be, far less of it would be hidden
const IN_FRONT = { lamp: .3, 'median-lamp': .3, lantern: .3, 'street-lantern': .3, signal: .3 };
function signPlace(c, f, w, centres) {
  const obstacles = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const piece of c.world?.furnitureByChunk?.get(`${c.ix + dx},${c.iz + dz}`) ?? []) {
    const reach = piece.kind === 'tree' ? piece.scale * .5 : IN_FRONT[piece.kind] ?? 0;
    if (!reach) continue;
    const q = f.local(piece.u - c.east, piece.s - c.start);
    if (q.outward > .5 && q.outward < 9 && Math.abs(q.offset) < f.span / 2 + reach) obstacles.push({ offset: q.offset, reach });
  }
  const centre = { offset: 0, scale: 1 };
  if (!obstacles.length) return centre;
  // (the share of the sign hidden, from straight across the street)
  const hidden = (o, width) => obstacles.reduce((sum, p) => sum + Math.max(0, Math.min(o + width / 2, p.offset + p.reach) - Math.max(o - width / 2, p.offset - p.reach)), 0) / width;
  let best = centre, least = hidden(0, w);
  for (const scale of [1, .8]) {
    const end = f.span / 2 - 1.3 - w * scale / 2;
    for (const offset of [...centres, end, -end]) {
      if (Math.abs(offset) > end + 1e-6) continue;
      const share = hidden(offset, w * scale) + (1 - scale) * .5;
      if (share < least - .1) { best = { offset, scale }; least = share; }
    }
  }
  return best;
}

// Thin fabric, falling away from the fascia to a short valance. Both sides
// are faces in the building's existing mesh: even a striped awning uses a
// third of the triangles of the old pair of boxes per stripe.
export function shopAwning(c, f, offset, width, accent, variation) {
  const stripes = !c.distant && variation % 2 === 0 ? 8 : 1;
  const reach = 1.4 + variation * .16, back = G + 3.52, front = G + 3.04;
  const quad = (a, b, d, e, colour) => {
    c.bodies.face(...a, ...b, ...d, colour); c.bodies.face(...a, ...d, ...e, colour);
    c.bodies.face(...d, ...b, ...a, colour); c.bodies.face(...e, ...d, ...a, colour);
  };
  // At a distance a cream-striped canopy keeps its average colour.
  const plain = c.distant && variation % 2 === 0 ? new THREE.Color(accent).lerp(new THREE.Color('#e6d8b8'), .5) : accent;
  for (let stripe = 0; stripe < stripes; stripe++) {
    const left = offset + (stripe / stripes - .5) * width, right = left + width / stripes;
    const colour = stripes > 1 && stripe % 2 === 0 ? '#e6d8b8' : plain;
    const a = f.position(left, back, .2), b = f.position(right, back, .2);
    const d = f.position(right, front, reach), e = f.position(left, front, reach);
    quad(a, b, d, e, colour);
    quad(e, d, f.position(right, front - .2, reach), f.position(left, front - .2, reach), colour);
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
      // A display window above a low stall riser, and a narrower door that
      // reaches the threshold. Mirroring the door gives shops a quieter rhythm.
      const width = spacing - 1.1, side = b.variation % 2 ? -1 : 1, door = Math.min(1.25, width * .3);
      const doorOffset = offset + side * (width - door) / 2, display = width - door - .16, displayOffset = offset - side * (door + .16) / 2;
      f.add(offset, G + 1.73, .075, width + .24, 3.36, .11, b.accent);
      f.add(displayOffset, G + 2, .17, display, 2.65, .1, '#456971', 'glass');
      f.add(doorOffset, G + 1.73, .17, door, 3.1, .1, '#345660', 'glass');
      f.add(offset, G + 2.75, .24, width + .1, .1, .1, '#bbd2c8');
      f.add(doorOffset - side * door * .32, G + 1.35, .3, .06, .4, .08, '#e5d0a0');
      if ((b.variation + i) % 3 !== 0 && b.type !== 'office') {
        shopAwning(c, f, offset, spacing - .7, b.accent, b.variation);
      }
    }
    if (!c.distant && primary) {
      // The shop's name on its fascia board, high enough that the awnings
      // below it hide none of it from across the street
      const sign = shopSignFor(b), full = Math.min(1.15, signTop - signBottom - .3, span * .65 / sign.aspect, 6.2 / sign.aspect);
      const centres = Array.from({ length: units }, (_, i) => (i - (units - 1) / 2) * spacing).flatMap(offset => [offset, offset + spacing * .25]);
      const { offset, scale } = signPlace(c, f, full * sign.aspect, centres), h = full * scale, w = h * sign.aspect;
      const y = Math.min(signTop - .1 - h / 2, Math.max(signY, 3.92 + h / 2)), p = f.position(offset, G + y, .34);
      c.signFace('shop-signs', sign, p[0], p[1], -p[2], f.yaw, w, h, .05, .05);
    }
  } else if (b.type === 'office' || b.type === 'atrium') {
    // A glazed lobby with its mullions, a double door and a canopy
    const bays = Math.max(1, Math.floor((span - 1.2) / 3.2)), spacing = (span - 1.2) / bays;
    f.add(0, G + base / 2 + .1, .1, span - .3, base - .6, .12, '#5e8a9a', 'glass');
    for (let i = 0; i <= bays; i++) f.add(-(span - 1.2) / 2 + i * spacing, G + base / 2 + .1, .2, .14, base - .6, .12, '#b6c9c8');
    if (primary) {
      f.add(0, G + 1.25, .25, 2.4, 2.5, .1, '#2f4b55', 'glass'); f.add(0, G + 2.62, .26, 2.6, .14, .12, '#d8dbd2');
      f.add(0, G + 3.05, 1.1, 4.2, .18, 2.2, '#b6c9c8', 'solid', true);
    }
  } else if (b.type === 'warehouse') {
    const door = Math.min(8, span * .5), canopy = Math.min(9, span * .55);
    f.add(0, G + 1.6, .17, door, 2.9, .1, '#455b61', 'glass');
    f.add(0, G + 3.3, .3, canopy, .35, .7, b.accent, 'solid', true);
    for (let y = .6; y < 3; y += .4) f.add(0, G + y, .24, Math.min(7.8, span * .49), .06, .05, '#85968f');
    // Beside the loading door on the main front, a door for the people who
    // work there, and along the rest of a long front a row of high windows
    const side = b.variation % 2 ? 1 : -1, staff = primary && span / 2 - canopy / 2 > 3 ? side * (canopy / 2 + 1.5) : null;
    if (staff !== null) {
      f.add(staff, G + 1.15, .12, 1.05, 2.3, .12, b.accent);
      f.add(staff, G + 2.45, .2, 1.45, .14, .5, '#85968f', 'solid', true);
    }
    for (const way of [-1, 1]) {
      const from = canopy / 2 + (staff !== null && way === side ? 3.4 : 1.4), to = span / 2 - 1, count = Math.floor((to - from) / 3.4);
      for (let k = 0; k < count; k++) {
        const offset = way * (from + (to - from) * (k + .5) / count);
        f.add(offset, G + 3.05, .075, 2, 1.3, .11, '#b3c5bc');
        f.add(offset, G + 3.05, .17, 1.75, 1.05, .08, '#455b61', 'glass');
      }
    }
  } else {
    // A house's ground floor is a storey like the ones above it; the tall
    // ground floor of a block has windows as tall as it is, their transoms
    // level with the head of a door that has a fanlight over it
    const tall = base > 4, loft = b.type === 'loft', frame = b.type === 'brick' || b.type === 'townhouse' ? '#e0ccab' : '#b3c5bc';
    const head = tall ? 2.6 : 2.3;
    const door = entrance(b, span, primary), doorOffset = door ? door.offset : span * .3 * (b.variation % 2 ? 1 : -1);
    if (door) {
      f.add(doorOffset, G + head / 2, .12, 1.15, head, .12, b.variation % 2 ? '#4d3f36' : b.accent);
      if (tall) {
        f.add(doorOffset, G + 3.3, .075, 1.45, 1.35, .11, frame);
        f.add(doorOffset, G + 3.3, .17, 1.15, 1.1, .08, '#435b65', 'glass');
      }
      f.add(doorOffset, G + (tall ? 4.1 : 2.4), .2, 1.7, .22, .4, creamTrim, 'solid', true);
      // (a step up from the garden path, whose top is at G + .09)
      f.add(doorOffset, G + .06, .5, 1.9, .12, 1.1, '#c7bba3', 'solid', true);
    }
    // Windows in bays along the whole front, as on the floors above, clear of the door
    // (or, where the door takes the only bay, one either side of it)
    const bays = Math.max(1, Math.floor((span - 1.6) / (tall && loft ? 6.5 : b.variation === 1 ? 5.6 : 4.8))), spacing = (span - 1.8) / bays;
    const width = tall ? Math.min(loft ? Math.min(3.7, spacing - 1) : b.variation === 2 ? 2.25 : 1.65, spacing - .5) : 1.4;
    let offsets = Array.from({ length: bays }, (_, bay) => (bay - (bays - 1) / 2) * spacing).filter(offset => !door || Math.abs(offset - doorOffset) >= width / 2 + 1.3);
    if (!offsets.length) offsets = [-span * .3, span * .3].filter(offset => !door || Math.abs(offset - doorOffset) > 1.9);
    if (span > 5.5) for (const offset of offsets) {
      if (!tall) {
        f.add(offset, G + 2, .075, 1.65, 2.05, .11, '#e0ccab');
        f.add(offset, G + 2, .17, 1.4, 1.8, .08, '#435b65', 'glass');
        continue;
      }
      const w = Math.min(width, span * .3), y = G + 2.5, h = 3.2;
      f.add(offset, y, .075, w + .25, h + .25, .11, frame);
      f.add(offset, y, .17, w, h, .08, '#435b65', 'glass');
      f.add(offset, G + head + .06, .23, w, .1, .08, frame);
      if (loft || b.variation === 1) f.add(offset, y, .25, .09, h, .07, frame);
      f.add(offset, y - h / 2 - .14, .25, w + .44, .14, .48, frame);
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
// A wall shared with the house next door carries its cornice only to the lot
// line (`reach` gives each wall's), where the neighbour's meets it.
export function cornice(bodies, ring, top, trim, roofColour, wall, parapet, courts = [], reach = null) {
  const band = (reach && signedArea(ring) > 0 && offsetPolygonMapped(ring, (p, q, k) => reach(k))?.points) || offsetPolygon(ring, .32), courtBands = courts.map(court => offsetPolygon(court, -.32)).filter(p => p.length >= 3);
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

// How far a ray from p along (dx, dy) runs before it leaves a polygon
export function exitDistance(p, dx, dy, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], q = polygon[(i + 1) % polygon.length], ex = q.x - a.x, ey = q.y - a.y, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den, u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}
// The front of a building that stands back behind a garden: a paved path
// from the pavement to each door, the whole strip before a shop paved as its
// forecourt, and along the pavement a clipped hedge (in the civic quarter a
// low stone wall) with a gap where each path comes through, so no door opens
// onto the lawn and the gardens have an edge to the street.
const PATH = '#c4baa3', HEDGES = ['#4e7545', '#57804a', '#476c40'];
function frontGarden(c, b, ring, primary, random) {
  const lot = b.lotLocal, n = ring.length, gaps = [];
  let open = false;
  for (let i = 0; i < n; i++) {
    const a = ring[i], q = ring[(i + 1) % n], span = edgeLength(ring, i);
    if (!b.street[i] || span < 2.5) continue;
    const door = entrance(b, span, i === primary);
    if (!door) continue;
    open ||= door.shop;
    const tx = (q.x - a.x) / span, ty = (q.y - a.y) / span, nx = ty, ny = -tx;
    const at = (u, v) => ({ x: (a.x + q.x) / 2 + tx * u + nx * v, y: (a.y + q.y) / 2 + ty * u + ny * v });
    // (to the pavement: the lot's edge straight out from the door, or from
    // wherever along a shop's front it is furthest)
    const reach = Math.max(...[-.45, 0, .45].map(k => exitDistance(at(door.offset + k * door.width, .05), nx, ny, lot)));
    if (!(reach < 14)) continue;
    const strip = [at(door.offset - door.width / 2, 0), at(door.offset + door.width / 2, 0), at(door.offset + door.width / 2, reach + 1), at(door.offset - door.width / 2, reach + 1)];
    for (const piece of intersection([strip], [lot])) c.polygon(piece.outer.map(p => [p.x, p.y]), G + .06, .06, PATH);
    if (!door.shop) gaps.push({ ...at(door.offset, reach), half: door.width / 2 + .45 });
  }
  if (open || !b.lotStreet) return;
  // The hedge, just inside the lot along each of its street edges
  const civic = b.district === 'Civic quarter', height = civic ? .55 : .8 + random() * .25, depth = civic ? .4 : .7;
  const colour = civic ? '#cdc3ab' : HEDGES[Math.floor(random() * HEDGES.length)];
  for (let j = 0; j < lot.length; j++) {
    if (!b.lotStreet[j]) continue;
    const a = lot[j], q = lot[(j + 1) % lot.length], length = edgeLength(lot, j);
    if (length < 2) continue;
    const tx = (q.x - a.x) / length, ty = (q.y - a.y) / length, inset = depth / 2 + .2;
    // The runs between the gates
    const cuts = gaps.map(g => ({ along: (g.x - a.x) * tx + (g.y - a.y) * ty, off: Math.abs((g.x - a.x) * -ty + (g.y - a.y) * tx), half: g.half }))
      .filter(g => g.off < 1.5 && g.along > -g.half && g.along < length + g.half).sort((p, r) => p.along - r.along);
    let from = .1;
    for (const cut of [...cuts, { along: length + 1e9, half: 0 }]) {
      const to = Math.min(length - .1, cut.along - cut.half);
      if (to - from > .6) {
        const mid = (from + to) / 2, x = a.x + tx * mid - ty * inset, y = a.y + ty * mid + tx * inset, yaw = Math.atan2(ty, tx);
        c.box(x, G + height / 2, y, to - from, height, depth, colour, 'solid', yaw);
        if (civic) c.box(x, G + height + .04, y, to - from + .06, .08, depth + .1, '#e0d6bf', 'solid', yaw);
        c.rigid(x, y, () => c.solid(x, y, to - from, depth), itemFrame(c.start + y, c.east + x, yaw));
      }
      from = Math.max(from, cut.along + cut.half);
    }
  }
}

// A vertical face in the plane of a wall, turned to look away from `inside`:
// points are map points with their heights
function wallFace(bodies, points, inside, colour) {
  const [a, b, d] = points.map(([p, y]) => [p.x, y, -p.y]);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx, m = points[0][0], ox = m.x - inside.x, oz = -(m.y - inside.y);
  if (nx * ox + nz * oz >= 0) bodies.face(...a, ...b, ...d, colour);
  else bodies.face(...a, ...d, ...b, colour);
}
// A pitched roof over a four-sided building: an eave along the wall `eaves`
// and the one across from it, a ridge between them and a gable over each of
// the other two walls. A terrace's chimneys stand on its gables, where its
// party walls are; a shed's roof is low, with a vent along its ridge.
function gableRoof(c, b, bodies, ring, top, random) {
  const shed = b.type === 'warehouse' || b.type === 'pavilion', trim = '#e2d6bd';
  const w = [0, 1, 2, 3].map(k => ring[(b.eaves + k) % 4]);
  // The eaves overhang their walls, and the verges the gables no further than
  // halfway to the house next door, so two roofs of a terrace never overlap
  const verge = Math.max(0, Math.min(.25, b.side - .02)), overhang = [.55, verge, .55, verge], mapped = offsetPolygonMapped(w, (p, q, k) => overhang[k]);
  const e = mapped?.points.length === 4 ? mapped.points : w;
  bodies.prism(e, top - .3, top + .06, trim);
  if (e !== w) for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    bodies.flat(w[i], w[j], e[j], top - .3, trim, null, false); bodies.flat(w[i], e[j], e[i], top - .3, trim, null, false);
  }
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const span = (Math.hypot(e[2].x - e[1].x, e[2].y - e[1].y) + Math.hypot(e[0].x - e[3].x, e[0].y - e[3].y)) / 4;
  const pitch = shed ? .22 : .56 + (b.variation % 3) * .06, y0 = top + .06, y1 = y0 + Math.min(shed ? 3.4 : 5.4, span * Math.tan(pitch));
  const r0 = mid(e[3], e[0]), r1 = mid(e[1], e[2]);
  bodies.slope(e[0], y0, e[1], y0, r1, y1, b.roof); bodies.slope(e[0], y0, r1, y1, r0, y1, b.roof);
  bodies.slope(e[2], y0, e[3], y0, r0, y1, b.roof); bodies.slope(e[2], y0, r0, y1, r1, y1, b.roof);
  // Each gable in the plane of its wall, from the top of the wall to the roof
  // above it (the roof over the wall is higher than at the eave by its overhang)
  // (a deep roof's ridge is kept down, so its slope is its rise over its span)
  const centre = averagePoint(w), atWall = y0 + overhang[0] * (y1 - y0) / span;
  for (const [p, q] of [[w[1], w[2]], [w[3], w[0]]]) {
    const apex = mid(p, q), wallHigh = Math.min(atWall, y1);
    wallFace(bodies, [[p, top], [q, top], [q, wallHigh]], centre, b.wall); wallFace(bodies, [[p, top], [q, wallHigh], [p, wallHigh]], centre, b.wall);
    wallFace(bodies, [[p, wallHigh], [q, wallHigh], [apex, y1]], centre, b.wall);
  }
  if (c.distant) return;
  const along = { x: r1.x - r0.x, y: r1.y - r0.y }, length = Math.hypot(along.x, along.y) || 1, ux = along.x / length, uy = along.y / length, yaw = Math.atan2(uy, ux);
  if (shed) {
    // A vent along the ridge of most sheds
    if (random() < .6 && length > 12) {
      const m = mid(r0, r1);
      c.box(m.x, y1 + .25, m.y, length * .6, .7, 1.3, '#9da4a4', 'solid', yaw);
      c.box(m.x, y1 + .64, m.y, length * .6 + .2, .1, 1.9, b.roof, 'solid', yaw);
    }
    return;
  }
  // Chimney stacks on the gables, straddling the ridge just inside each party wall
  const g0 = mid(w[3], w[0]), g1 = mid(w[1], w[2]);
  for (const [g, sign] of [[g0, 1], [g1, -1]]) {
    if (random() > .55) continue;
    const x = g.x + ux * sign * .55, y = g.y + uy * sign * .55, height = 1.1 + random() * .7;
    c.box(x, y1 + height / 2 - .5, y, .8, height + 1, 1.5, '#8a6353', 'solid', yaw);
    c.box(x, y1 + height + .02, y, 1, .14, 1.7, '#6f5a4e', 'solid', yaw);
  }
}

// What stands on a flat roof follows what the building is: a lift overrun and
// plant on the offices, skylights down a shed, a stair head and chimney stacks
// on the flats and houses, the odd water tank on old brick and a roof garden
// on a few blocks of flats.
const COMMERCIAL = new Set(['office', 'atrium', 'deco']);
const BASE_STONE = new THREE.Color('#6f6c64');
const TANK_DISTRICTS = new Set(['Old town', 'Warehouse district', 'Market district']);
function roofDetails(c, b, deck, top, random, holes = []) {
  const blocked = holes.map(hole => offsetPolygon(hole, 1.8));
  // A deco tower steps up to a crown; a low deco block keeps its tall parapet
  if (b.type === 'deco' && !holes.length && b.floors >= 7) {
    const crown = offsetPolygon(deck, -b.breadth * .28);
    if (crown.length >= 3) {
      blocked.push(offsetPolygon(crown, 3));
      c.bodies.prism(crown, top, top + 3, b.wall); c.bodies.polygon(crown, top + 3, '#d1c5ac');
      if (b.variation === 0) { const p = averagePoint(crown); c.box(p.x, top + 7, p.y, .2, 8, .2, '#b0b7ae'); }
    }
  }
  if (c.distant) return;
  // Everything on the roof lines up with the building's longest wall
  let longest = 0;
  for (let i = 1; i < deck.length; i++) if (edgeLength(deck, i) > edgeLength(deck, longest)) longest = i;
  const a = deck[longest], q = deck[(longest + 1) % deck.length], yaw = Math.atan2(q.y - a.y, q.x - a.x), ux = Math.cos(yaw), uy = Math.sin(yaw);
  const clear = blocked.filter(hole => hole.length >= 3), placed = [];
  // A spot for something `w` along the wall by `d` across, clear of the
  // parapet, any courtyard and whatever already stands on the roof
  const spot = (w, d, margin = 1.2) => {
    const r = Math.hypot(w, d) / 2, room = offsetPolygon(deck, -(margin + r));
    if (room.length < 3) return null;
    for (let i = 0; i < 12; i++) {
      const p = insidePoint(room, random, 6, clear);
      if (p && placed.every(o => Math.hypot(o.x - p.x, o.y - p.y) > o.r + r + .6)) { placed.push({ ...p, r }); return p; }
    }
    return null;
  };
  const box = (p, y, w, h, d, colour, kind = 'solid', along = 0, across = 0) => c.box(p.x + ux * along - uy * across, top + y, p.y + uy * along + ux * across, w, h, d, colour, kind, yaw);
  // A plant unit with its fan deck on top
  const plant = size => {
    const p = spot(size * 1.15, size);
    if (!p) return;
    box(p, .3 + size * .33, size * 1.15, size * .66, size, '#919b9b'); box(p, .365 + size * .66, size * 1.15 + .1, .13, size + .1, '#58656d');
  };
  const trim = b.type === 'office' ? '#b8cccd' : '#d6c9b1';
  if (COMMERCIAL.has(b.type) || b.floors >= 8) {
    // A lift overrun, and the offices' plant
    if (b.area > 260 && random() < .8) {
      const p = spot(4.4, 3.4);
      if (p) { box(p, 1.5, 4.4, 3, 3.4, b.type === 'office' ? '#9fb1b3' : b.wall); box(p, 3.06, 4.7, .12, 3.7, trim); }
    }
    for (let i = integer(random, 1, b.area > 600 ? 4 : b.area > 300 ? 3 : 2); i > 0; i--) plant(1.4 + random() * 1.2);
    return;
  }
  if (b.type === 'warehouse' || b.type === 'pavilion') {
    // A row of skylights down the middle of a shed, and a vent or two
    const centre = averagePoint(deck), room = offsetPolygon(deck, -2.6), count = Math.max(1, Math.min(5, Math.floor(edgeLength(deck, longest) / 9)));
    for (let k = 0; k < count; k++) {
      const along = (k - (count - 1) / 2) * 8, p = { x: centre.x + ux * along, y: centre.y + uy * along };
      const corners = [[-1.9, -1], [1.9, -1], [1.9, 1], [-1.9, 1]].map(([s, t]) => ({ x: p.x + ux * s - uy * t, y: p.y + uy * s + ux * t }));
      if (room.length < 3 || !corners.every(corner => insidePolygon(corner, room))) continue;
      placed.push({ ...p, r: 2.2 });
      box(p, .2, 3.8, .4, 2, '#d0cbbd'); box(p, .42, 3.4, .06, 1.6, '#6f8f98', 'glass');
    }
    for (let i = integer(random, 0, 2); i > 0; i--) plant(1.1 + random() * .6);
    return;
  }
  // Flats, houses and shops: a stair head, chimney stacks along the walls in
  // the older districts, and now and then a water tank or a roof garden
  if (b.area > 110 && random() < .6) {
    const p = spot(3.2, 2.4);
    if (p) { box(p, 1.25, 3.2, 2.5, 2.4, b.wall); box(p, 2.56, 3.5, .12, 2.7, trim); }
  }
  if (b.district !== 'Midtown' && b.type !== 'loft') {
    for (let i = integer(random, 0, 2); i > 0; i--) {
      const k = Math.floor(random() * deck.length), p0 = deck[k], p1 = deck[(k + 1) % deck.length], length = edgeLength(deck, k);
      if (length < 4) continue;
      const t = .2 + random() * .6, nx = -(p1.y - p0.y) / length, ny = (p1.x - p0.x) / length;
      const p = { x: p0.x + (p1.x - p0.x) * t + nx * .75, y: p0.y + (p1.y - p0.y) * t + ny * .75 };
      if (clear.some(hole => insidePolygon(p, hole)) || placed.some(o => Math.hypot(o.x - p.x, o.y - p.y) < o.r + 1)) continue;
      const along = Math.atan2(p1.y - p0.y, p1.x - p0.x), height = 1.2 + random() * .8;
      c.box(p.x, top + height / 2, p.y, 1.5, height, .75, '#8a6353', 'solid', along); c.box(p.x, top + height + .07, p.y, 1.7, .14, .95, '#6f5a4e', 'solid', along);
    }
  }
  if ((b.type === 'brick' || b.type === 'loft') && TANK_DISTRICTS.has(b.district) && random() < .3) {
    const p = spot(3.4, 3.4, .8);
    if (p) c.prop('tank', p.x, p.y, yaw, top + .28);
  } else if (b.type === 'apartment' && b.variation === 3 && b.district !== 'Warehouse district' && random() < .6) {
    // A roof garden: a planted deck under a pergola
    const p = spot(5.6, 4.6);
    if (p) {
      box(p, .34, 5.6, .28, 4.6, '#b2a993'); box(p, .51, 5, .08, 4, '#829768');
      for (const along of [-2.5, 2.5]) for (const across of [-2, 2]) box(p, 1.8, .17, 3, .17, '#baa27f', 'solid', along, across);
      for (let i = 0; i < 5; i++) box(p, 3.32, .25, .2, 4.8, '#d7c3a0', 'solid', -2.5 + i * 1.25);
    }
  } else if (b.type === 'shop' && random() < .5) plant(1.1 + random() * .5);
}

function buildBuilding(c, b) {
  const random = seededRandom(b.seed ^ 0x3c6ef372), bodies = c.bodies, ring = b.footprint, n = ring.length;
  const base = b.type === 'warehouse' ? 4.8 : b.domestic ? 3.6 : 5.4, height = base + b.floors * 3.6, lower = b.setbackFloors, lowerTop = G + base + lower * 3.6;
  const centre = averagePoint(ring);
  c.features.buildings.push({ x: c.east + centre.x, s: c.start + centre.y, area: b.area, height, type: b.type, floors: b.floors, roofType: b.roofType, wall: b.wall });
  c.polygonSolid(convexHull(ring).map(p => [p.x, p.y]));
  if (b.lawn) {
    const lot = b.lotLocal.map(p => [p.x, p.y]);
    grassArea(c, lot, LAWN, G + .05);
    if (!c.distant) {
      // A tree or two in the garden, each no bigger than its room from the house
      const walls = [...ring, ring[0]], edge = [...b.lotLocal, b.lotLocal[0]], trees = [];
      const wanted = Math.min(2, 1 + Math.floor((calcPolygonArea(b.lotLocal) - b.area) / 320));
      for (let i = 0; i < 24 && trees.length < wanted; i++) {
        const p = insidePoint(b.lotLocal, random);
        if (!p || insidePolygon(p, ring) || distanceToPolyline(p, edge) < 1.6 || trees.some(t => Math.hypot(t.x - p.x, t.y - p.y) < 5.5)) continue;
        // (a neighbour's wall may stand on the lot line)
        const room = Math.min(distanceToPolyline(p, walls), distanceToPolyline(p, edge) + .2);
        if (room < 2.2) continue;
        c.tree(p.x, p.y, Math.min(5 + random() * 3, treeRoom(room))); trees.push(p);
      }
    }
  }
  // The body and its ground-floor band, and the courtyard inside a big block
  // (stone under shops, and under flats a darker course of the building's own walls)
  const baseColour = b.type === 'office' ? '#839b9e' : b.type === 'warehouse' ? '#8e8a7d' : b.shopfront || COMMERCIAL.has(b.type) ? '#a4a69b' : `#${new THREE.Color(b.wall).lerp(BASE_STONE, .45).getHexString()}`;
  const court = b.court, courts = court.length ? [court] : [];
  bodies.prism(ring, G, lowerTop, b.wall);
  // (a house stands on a low stone plinth, a string course over its ground floor)
  const plinth = offsetPolygon(ring, .08), courtPlinth = court.length ? offsetPolygon(court, -.08) : [], plinthTop = b.domestic ? .7 : base;
  if (plinth.length >= 3) { bodies.prism(plinth, G, G + plinthTop, baseColour); bodies.polygon(plinth, G + plinthTop, baseColour, null, true, courtPlinth.length >= 3 ? [courtPlinth] : courts); }
  if (b.domestic && plinth.length >= 3) { bodies.prism(plinth, G + base - .22, G + base, creamTrim); bodies.polygon(plinth, G + base, creamTrim); }
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
    else if (b.windows[i] && (b.type === 'office' || b.type === 'atrium')) groundFloor(c, { ...b, shopfront: false }, f, base, false, random);
    // (a detached house's ground floor is a storey like the others, windowed
    // round its garden)
    const garden = b.domestic && b.lawn && !f.street;
    if (b.windows[i]) edgeWindows(c, b, f, garden ? G : G + base, garden ? lower + 1 : lower, random);
  }
  if (b.lawn && !c.distant) frontGarden(c, b, ring, primary, random);
  if (b.roofType === 'hip') { hipRoof(c, b, bodies, ring, lowerTop); return; }
  if (b.roofType === 'gable') { gableRoof(c, b, bodies, ring, lowerTop, random); return; }
  const trim = b.type === 'office' ? '#b8cccd' : '#d6c9b1';
  const reach = k => b.party?.[k] && b.side < .32 ? b.side : .32;
  let { deck, holes } = cornice(bodies, ring, lowerTop, trim, b.roof, b.wall, b.type === 'deco' ? 1.2 : .65, courts, reach), top = lowerTop;
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

// A lot with no room for a building. Where the houses have gardens it is one
// more lawn; in the built-up districts (most often the sharp wedge where two
// streets meet at a slant) it is laid out as a little public garden, as the
// planted islands are: a lawn inside a paved rim, with trees sized to it.
const GARDEN_RIM = 1.4;
export function buildGarden(c, lot) {
  const random = seededRandom(lot.seed ^ 0x2545f491), district = cityStyleDistrict(lot.centre.y, lot.centre.x);
  const polygon = local(ccw(dedupePolygon(lot.polygon)), c), points = polygon.map(p => [p.x, p.y]);
  const planted = (INSETS[district] ?? INSETS.Midtown).lawn ? [] : offsetPolygon(polygon, -GARDEN_RIM);
  const lawn = planted.length >= 3 && calcPolygonArea(planted) > 12 && isSimple(planted) ? planted : null;
  if (lawn) c.polygon(points, G + .03, .04, '#bdb5a2');
  const turf = (lawn ?? polygon).map(p => [p.x, p.y]);
  c.polygon(turf, G + .05, .06, LAWN);
  grassArea(c, turf, LAWN, G + .08);
  if (c.distant) return;
  const bed = lawn ?? polygon, edge = [...bed, bed[0]], count = Math.max(1, Math.min(5, Math.floor(calcPolygonArea(bed) / 150))), trees = [];
  for (let i = 0; i < 30 && trees.length < count; i++) {
    const p = insidePoint(bed, random);
    if (!p || trees.some(t => Math.hypot(t.x - p.x, t.y - p.y) < 6)) continue;
    const room = distanceToPolyline(p, edge);
    if (room < (lawn ? 1.4 : 2.2)) continue;
    // (as big as the garden, or where a neighbour's wall may stand on the lot line, as that allows)
    c.tree(p.x, p.y, Math.min(6 + random() * 3, 3.5 + room * 1.6, treeRoom(room + (lawn ? GARDEN_RIM : 0)))); trees.push(p);
  }
}

export function* buildCityBuildingSteps(c) {
  const plan = c.lots.map(lot => planLot(c, lot));
  yield;
  for (const b of plan) {
    if (b.kind === 'landmark') { if (!c.structure(0, 0, () => buildLandmark(c, b.lot, b.place))) buildGarden(c, b.lot); }
    else if (b.kind === 'building') c.structure(0, 0, () => buildBuilding(c, b));
    else if (b.kind === 'garden') buildGarden(c, b.lot);
    yield;
  }
}

