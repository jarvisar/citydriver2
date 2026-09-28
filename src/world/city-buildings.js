import * as THREE from 'three';
import { seededRandom, randomAt } from './route.js';
import { PAVEMENT_LEVEL as G } from './city-route.js';
import { CITY, cityStyleDistrict } from './city.js';
import { buildingSignage, shopSigns, upstairsSign, crownSign, lobbySign, worksSign, COMMERCIAL } from './city-building-signs.js';
import { SIGNS_BY_USE } from './city-signs.js';
import { grassArea } from './city-grass.js';
import { placeForLot, placeForBlock } from '../city-exploration.js';
import { buildLandmark } from './city-landmarks.js';
import { averagePoint, insidePolygon, polygonBounds, offsetPolygon, offsetPolygonMapped, calcPolygonArea, signedArea, distanceToPolyline, dedupePolygon, isSimple, fitRectangle } from '../mapgen/polygon-util.js';
import { union, intersection } from '../mapgen/booleans.js';
import { simplify } from '../mapgen/simplify.js';
import { itemFrame } from './city-layout-render.js';
import { lotWithoutDrive } from './city-yards.js';
import { buildHedge } from './city-detail-assets.js';
import { nightLit } from './city-glass.js';

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
const DOMESTIC_GLASS = ['#506971', '#405a65', '#617980'], OFFICE_GLASS = ['#638793', '#567783', '#71929b'];

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
    // Whether the pavement in front of the wall at `offset`, `reach` metres
    // out and a little either side, is clear of `plots`: the building's own
    // footprint (a wing standing forward) and its neighbours' lots
    open(offset, reach) {
      return !(this.plots ?? []).some(plot => [-.35, .35].some(side => [.3, reach / 2, reach].some(out => {
        const p = this.position(offset + side, 0, out);
        return insidePolygon({ x: p[0], y: -p[2] }, plot);
      })));
    },
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
        if (kind === 'inlay') {
          // Opaque inserts share the body's draw and need just two faces.
          const left = point(r.x0, outward + d / 2), right = point(r.x1, outward + d / 2);
          c.bodies.face(left.x, r.y0, -left.s, right.x, r.y0, -right.s, right.x, r.y1, -right.s, color);
          c.bodies.face(left.x, r.y0, -left.s, right.x, r.y1, -right.s, left.x, r.y1, -left.s, color);
        } else if (c.distant && (kind === 'glass' || kind === 'lit')) c.item(`distant-${kind}`, signGeometry, c.materials[kind], [p.x, py, -p.s], [pw, ph, 1], color, yaw);
        else c.box(p.x, py, p.s, pw, ph, d, color, kind, yaw);
      }
    } };
}

// Which of its block's lots a lot is, counting round the block, so the block
// can deal its buildings their signs in turn (see dealSign in city-signs.js)
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
    // (nor a plot wholly to one side of the strip, along the wall or out
    // from it, by more than the booleans' millimetres could close)
    let first = Infinity, last = -Infinity, near = Infinity, far = -Infinity;
    for (const p of polygon) {
      const along = (p.x - a.x) * tx + (p.y - a.y) * ty, out = (p.x - a.x) * ty - (p.y - a.y) * tx;
      first = Math.min(first, along); last = Math.max(last, along); near = Math.min(near, out); far = Math.max(far, out);
    }
    if (last < .6 - .002 || first > length - .6 + .002 || far < .05 - .002 || near > 3 + .002) return true;
    return !intersection([strip], [polygon]).some(piece => calcPolygonArea(piece.outer) > .01);
  });
}
// A lot as the world builds it, by its index in CITY.lots
export function cityLot(index) {
  const polygon = CITY.lots[index], centre = averagePoint(polygon);
  return { polygon, index, block: CITY.lotBlocks?.[index] ?? -1, edges: CITY.lotEdges?.[index] ?? null, depth: CITY.lotDepths?.[index] ?? 0, centre, area: calcPolygonArea(polygon),
    seed: Math.floor(randomAt(Math.round(centre.x), Math.round(centre.y) + 7102, CITY.seed) * 0xffffffff) >>> 0 };
}
let plotsByBlock = null;
// A block's lots: each one's polygon and index
function blockPlots(block) {
  if (!plotsByBlock) {
    plotsByBlock = new Map();
    CITY.lots.forEach((polygon, index) => {
      const block = CITY.lotBlocks[index];
      if (!plotsByBlock.has(block)) plotsByBlock.set(block, []);
      plotsByBlock.get(block).push({ polygon, index });
    });
  }
  return plotsByBlock.get(block) ?? [];
}
function neighboursOf(lot) {
  return blockPlots(lot.block).filter(p => p.index !== lot.index).map(p => p.polygon);
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
  // (a shop needs a front for its window: 4 m of straight wall, or 5 m round a
  // curve. Without one its tall base stood bare, with a door and no shop.)
  const shopfront = type !== 'warehouse' && type !== 'pavilion' && random() < style.shops && shopRoom(footprintOut, street);
  // A house or a terrace of houses has an ordinary ground floor in its own
  // walls, not the tall stone base of a block over shops
  const domestic = !shopfront && (house || type === 'townhouse' || (type === 'pavilion' && insets.lawn));
  // Windows on the street, on the yard when there is room behind, and on the
  // sides only where there is a gap to look out of
  const neighbours = lot.index === undefined ? null : neighboursOf(lot);
  const windows = wallKinds.map((kind, i) => street[i] || (kind === 'rear' && (rear > 2.4 || footprintOut !== footprint))
    || (kind === 'side' && (insets.side > 1.5 || Boolean(neighbours && wallHasOutlook(footprintOut, i, neighbours)))));
  const plan = { kind: 'building', lot, district, footprint: local(footprintOut, c), lotLocal: local(polygon, c), court: local(court, c), street, windows, type, floors, area: massedArea, breadth,
    wall: pick(style.walls, random), accent: pick(ACCENTS, random), roof: pick(pitched ? TILES[district] ?? ROOFS : ROOFS, random), roofType: house ? 'hip' : pitched ? 'gable' : stepped ? 'terrace' : 'flat', eaves,
    setbackFloors: stepped ? Math.max(2, Math.floor(floors * .57)) : floors, seed: (lot.seed + 9973) >>> 0, variation: integer(random, 0, 3),
    ...shopSlot(lot), shopfront, domestic, lawn: insets.lawn, side: insets.side, party: wallKinds.map(kind => kind === 'side'), lotStreet: kinds.map(kind => kind === 'street') };
  // (what it says on it: see city-building-signs.js)
  plan.signs = buildingSignage(plan);
  return plan;
}

// A wall's window bays, .9 m in from each end of its front. The segments of
// a curved front share one run (`f.run`, see facadeRuns), laid out in groups
// of walls between bends, so each bay stays between two bends and the bays
// keep near one rhythm round the curve. The windows on this wall (their bay
// numbers and offsets from the wall's middle, a window over a bend inside a
// group of short walls nudged wholly onto one), the least spacing, and the
// piers between bays: one at each bend.
function bayLayout(f, target, width = 0) {
  const run = f.run ?? { from: 0, length: f.span, groups: [[0, f.span]] }, half = f.span / 2;
  const at = d => d - run.from - half, own = o => o >= -half - 1e-6 && (o < half - 1e-6 || run.from + f.span > run.length - 1e-6);
  const windows = [], piers = [];
  let spacing = Infinity, bay = 0;
  // (a plain wall takes as many whole bays as fit; the groups of a run the
  // nearest number at the spacing that suits the whole run)
  const whole = run.length - 1.8, even = whole / Math.max(1, Math.round((whole + .2) / target));
  run.groups.forEach(([from, to], g) => {
    const start = from + (from === 0 ? .9 : 0), length = to - (to >= run.length - 1e-6 ? .9 : 0) - start;
    const bays = Math.max(1, f.run ? Math.round(length / even) : Math.floor((length + .2) / target)), step = length / bays;
    const mine = to > run.from - 1e-6 && from < run.from + f.span + 1e-6;
    if (mine) spacing = Math.min(spacing, step);
    for (let k = 0; k < bays; k++, bay++) {
      const o = at(start + (k + .5) * step), room = Math.max(0, half - Math.min(width, step - .5) / 2 - .05);
      if (own(o)) windows.push({ bay, offset: Math.max(-room, Math.min(room, o)) });
    }
    for (let k = g ? 1 : 0; k <= bays; k++) if (own(at(start + k * step))) piers.push(at(start + k * step));
  });
  return { spacing: Number.isFinite(spacing) ? spacing : f.span - 1.8, windows, piers };
}

// A wall's upper windows: their width, where they stand and the piers
// between them (see bayLayout), by the kind of building, and how far out
// from the wall the pilasters or fins on its piers come (`pierFront`)
const PIER_PILASTERS = { deco: [.18, .38, .4], atrium: [.4, .25, .85], pavilion: [.4, .25, .85] };
const FIN_RENDER = new THREE.Color('#efe6d3'), fins = new Map();
const paleFin = wall => { let colour = fins.get(wall); if (!colour) fins.set(wall, colour = `#${new THREE.Color(wall).lerp(FIN_RENDER, .5).getHexString()}`); return colour; };
export function windowBays(b, f) {
  const modern = b.type === 'office' || b.type === 'atrium', loft = b.type === 'warehouse' || b.type === 'loft';
  const target = modern ? 4.4 : loft ? 6.5 : b.variation === 1 ? 5.6 : 4.8, { spacing } = bayLayout(f, target);
  const windowWidth = Math.min(modern ? spacing - .36 : loft ? Math.min(3.7, spacing - 1) : b.variation === 2 ? 2.25 : 1.65, spacing - .5);
  const pilaster = PIER_PILASTERS[b.type];
  return { windowWidth, pierFront: pilaster ? pilaster[0] + pilaster[2] / 2 : 0, ...bayLayout(f, target, windowWidth + .25) };
}
export function edgeWindows(c, b, f, bottom, floors, random) {
  const modern = b.type === 'office' || b.type === 'atrium', loft = b.type === 'warehouse' || b.type === 'loft', span = f.span;
  if (span < 3.2 && !f.run) return;
  const bays = windowBays(b, f), { windows, piers } = bays;
  // (a window on a curved front is no wider than its own short wall, so it
  // never reaches over a bend and stands off the next wall)
  const windowWidth = f.run ? Math.min(bays.windowWidth, span - .35) : bays.windowWidth, edge = Math.max(0, span / 2 - (windowWidth + .25) / 2 - .02);
  // On a curved front a window's frame stays on its own wall, clear of the
  // bend, and of two windows nudged onto one short wall the first is kept
  const kept = [], shown = windows.map(({ offset }) => {
    if (!f.run) return offset;
    const at = Math.max(-edge, Math.min(edge, offset));
    if (kept.some(other => Math.abs(other - at) < windowWidth + .3)) return null;
    kept.push(at); return at;
  });
  const h = loft ? 2.45 : modern ? 2.75 : 2.2, frame = b.type === 'brick' || b.type === 'townhouse' ? '#e0ccab' : '#b3c5bc';
  for (let floor = 0; floor < floors; floor++) {
    const y = bottom + 1.7 + floor * 3.6;
    if (modern) f.add(0, y - 1.42, .1, span + .1, .28, .3, '#b6c9c8', 'solid', true);
    if (b.type === 'deco' && floor === floors - 1) f.add(0, y + 1.55, .2, span + .4, .35, .5, '#ded2b8', 'solid', true);
    for (const [k, { bay }] of windows.entries()) {
      const offset = shown[k], occupancy = random(), lit = occupancy < .1;
      if (offset === null || windowWidth < .6) continue;
      // Balconies stack over one another, with a glazed door down to the
      // deck. The other bays keep their ordinary windows and sills.
      const balcony = b.type === 'apartment' && f.street && bay % 3 === b.variation % 3 && span >= windowWidth + 1.7;
      const height = balcony ? 2.58 : h, centre = balcony ? y - .19 : y;
      // (no window, sill or balcony behind a sign)
      if (f.clear.length && f.blocked(offset, y - .3, windowWidth + 1.2, h + 1.2)) continue;
      f.add(offset, centre, .075, windowWidth + .25, height + .25, .11, frame);
      // Quiet changes of glazing and partly lowered blinds break the repeated
      // black grid. Reuse this window's existing draw, never the city's stream.
      const palette = modern ? OFFICE_GLASS : DOMESTIC_GLASS;
      const glass = palette[Math.min(2, Math.floor(occupancy * 3))];
      const blind = !lit && !loft && !balcony && occupancy > .73 ? height * (occupancy > .9 ? .43 : .23) : 0;
      // The blind occupies its own part of the opening, with no overlapping
      // glazing faces or close parallel layers to flicker down the street.
      f.add(offset, centre - blind / 2, .17, windowWidth, height - blind, .09, lit ? '#e3c38d' : glass, lit ? 'lit' : 'glass');
      if (blind) f.add(offset, centre + (height - blind) / 2, .17, windowWidth, blind, c.distant ? 0 : .09, modern ? '#a5b3ad' : '#c5baa3', 'inlay');
      if (loft || b.variation === 1) f.add(offset, y, .25, .09, h, .07, frame);
      if (!modern && !balcony) f.add(offset, y - h / 2 - .14, .25, windowWidth + .44, .14, .48, frame);
      if (b.type === 'townhouse') {
        // (down to the top of the sill they flank, not hanging just above it)
        for (const sign of [-1, 1]) f.add(offset + sign * (windowWidth / 2 + .4), y - .035, .2, .5, h + .07, .15, b.accent, 'solid', true);
        f.add(offset, y, .265, windowWidth, .12, .1, creamTrim);
      }
      if (b.type === 'loft') f.add(offset, y, .265, windowWidth, .12, .1, '#c8bda8');
      if (balcony) {
        f.add(offset, y - 1.58, .68, windowWidth + 1.1, .2, 1.5, '#d1c9b5', 'solid', true);
        // Lower privacy panels with an open handrail above: a balcony reads
        // as usable space instead of a coloured box pasted onto the wall.
        f.add(offset, y - 1.18, 1.36, windowWidth + 1.1, .6, .12, b.accent, 'solid', true);
        f.add(offset, y - .57, 1.36, windowWidth + 1.16, .08, .12, '#495b5c');
        for (const edge of [-1, 1]) {
          const end = offset + edge * (windowWidth + .95) / 2;
          f.add(end, y - 1.18, .65, .1, .6, 1.3, b.accent);
          f.add(end, y - .73, 1.36, .07, .32, .08, '#495b5c');
          f.add(end, y - .57, .65, .08, .08, 1.3, '#495b5c');
        }
        if ((floor + bay + b.variation) % 3 === 0) f.add(offset, y - .84, 1.13, windowWidth * .7, .24, .38, '#6e8856');
      }
    }
  }
  // (pilasters, fins and string courses stop under the cornice or eaves that
  // cap the wall, rather than meeting its faces)
  const rise = floors * 3.6 - .12;
  const pilaster = PIER_PILASTERS[b.type];
  if (b.type === 'deco') for (const pier of piers) f.add(pier, bottom + rise / 2, pilaster[0], pilaster[1], rise, pilaster[2], '#cfbea2', 'solid', true);
  if (b.type === 'loft' || b.type === 'townhouse') for (let floor = 1; floor < floors; floor++) {
    f.add(0, bottom + floor * 3.6 - .12, .16, span + .2, b.type === 'loft' ? .4 : .22, .3, '#d6c1a0', 'solid', true);
  }
  // (a pavilion's fins are its own wall in a paler render: a fixed timber
  // brown stood out as stripes on blue and green walls)
  const fin = b.type === 'pavilion' ? paleFin(b.wall) : '#d5d9bd';
  if (b.type === 'atrium' || b.type === 'pavilion') for (const pier of piers) {
    f.add(pier, bottom + rise / 2, pilaster[0], pilaster[1], rise, pilaster[2], fin, 'solid', true);
  }
}

// A shop takes a street wall of 4 m or more, or every wall of a curved front
// (see facadeRuns) 5 m round, however short: a street's curve is drawn in
// 2 m chords, so a shop on a bend is all short walls.
const shopWall = (b, span, run) => b.shopfront && (span >= 4 || run?.length >= 5);
function shopRoom(ring, street) {
  const runs = facadeRuns(ring, k => street[k], k => street[k]);
  return ring.some((p, i) => street[i] && (edgeLength(ring, i) >= 4 || runs[i]?.length >= 5));
}
// How a street wall is entered: the whole of a shopfront, an office's lobby
// door, a warehouse's loading door, or a front door, in the middle of the
// main front and to one side of a long secondary one. Null for a wall with no
// way in. `offset` runs along the wall from its middle.
function entrance(b, span, primary, run = null) {
  if (shopWall(b, span, run)) return { shop: true, offset: 0, width: span };
  if (b.type === 'office' || b.type === 'atrium') return primary ? { offset: 0, width: 3.2 } : null;
  if (b.type === 'warehouse') return { offset: 0, width: Math.min(8, span * .5) + 1 };
  if (primary) return { offset: 0, width: 1.6 };
  return span > 9 ? { offset: span * .3 * (b.variation % 2 ? 1 : -1), width: 1.6 } : null;
}

// Thin fabric, falling away from the fascia to a short valance. Both sides
// are faces in the building's existing mesh, a third of the triangles of a
// pair of boxes per stripe.
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

// Most shops are lit after dark (see city-glass.js), never one to let: by
// the building's seed, warm, cool white or dimmer, or -1 for a dark one
const shopLight = b => b.signs?.vacant || (b.seed >>> 3) % 8 === 0 ? -1 : [0, 0, 0, 1, 1, 2][(b.seed >>> 6) % 6];

// One business per frontage, with display bays and a single shop door. A
// broad mixed-use front also has a separate way up to the flats or offices.
export function shopFront(c, b, facade, base, primary) {
  const side = b.variation % 2 ? -1 : 1, light = shopLight(b), glazed = light < 0 ? colour => colour : colour => nightLit(colour, light);
  const lobby = primary && facade.span >= 12 && !['shop', 'warehouse', 'pavilion'].includes(b.type) ? 2.8 : 0;
  if (lobby) {
    const at = side * (facade.span / 2 - lobby / 2);
    // (its frame, as every doorway's, stands on the ground: the glass stops at a kick plate)
    facade.add(at, G + 1.6, .075, 1.7, 3.2, .11, creamTrim, 'solid', true);
    facade.add(at, G + 1.43, .17, 1.35, 2.66, .1, glazed('#344e58'), 'glass');
    facade.add(at, G + 2.97, .17, 1.35, .36, .1, glazed('#63818a'), 'glass');
    facade.add(at + side * .43, G + 1.35, .29, .06, .4, .08, '#d7c3a0');
    facade.add(at, G + 3.3, .22, 1.95, .16, .5, creamTrim, 'solid', true);
  }
  // Work in the shop's own span so its fascia, sign and awnings all end at
  // the lobby pier. The obstruction lookup uses these coordinates too.
  const shift = -side * lobby / 2, span = facade.span - lobby;
  // (and its light on the pavement after dark, see NightLighting)
  if (light >= 0 && !c.distant && c.features?.shopLights) {
    const p = facade.position(shift, G, 1.9);
    c.features.shopLights.push({ x: p[0] + c.east, z: p[2] - c.start, yaw: facade.yaw, width: span, light });
  }
  const f = { ...facade, span,
    add: (offset, ...args) => facade.add(offset + shift, ...args),
    position: (offset, ...args) => facade.position(offset + shift, ...args),
    local(x, s) { const p = facade.local(x, s); return { ...p, offset: p.offset - shift }; } };
  // A shop round a curve (see facadeRuns) carries on over each bend: its
  // fascia meets the next wall's and its bays run up to the bend. A free end
  // keeps a pier, narrower on a short front, and so does the lobby's side.
  const joins = facade.joins ?? [null, null];
  const open = [joins[0] !== null && !(lobby && side < 0), joins[1] !== null && !(lobby && side > 0)];
  const pier = span < 5 ? .35 : .8, inset = open.map(o => o ? .12 : pier);
  // (over a bend the fascia runs on as far as its depth takes to close the outside of the turn)
  const reach = k => open[k] ? -(.3 * Math.tan(joins[k] / 2) + .02) : .25, from = -span / 2 + reach(0), to = span / 2 - reach(1);
  const signBottom = 3.65, signTop = base - .18, signY = (signBottom + signTop) / 2;
  f.add((from + to) / 2, G + signY, .13, to - from, signTop - signBottom, .28, b.accent, 'solid', true);
  const usable = span - inset[0] - inset[1], units = usable < .8 ? 0 : Math.max(1, Math.round(usable / 5.5)), spacing = usable / Math.max(1, units);
  const doorBay = side > 0 ? units - 1 : 0, panes = [], centres = [];
  let doorAt = side * span / 2;
  for (let i = 0; i < units; i++) {
    const offset = -span / 2 + inset[0] + (i + .5) * spacing, width = spacing - .45;
    // (a unit too narrow for a window beside its door is all door)
    let door = i === doorBay && (primary || facade.shopSign) ? Math.min(1.25, Math.max(width * .32, Math.min(.95, width - .6))) : 0;
    if (door && width - door - .16 < .5) door = width;
    const gap = door && door < width ? .16 : 0, doorOffset = offset + side * (width - door) / 2;
    const display = width - door - gap, displayOffset = offset - side * (door + gap) / 2;
    centres.push(offset, offset + spacing * .25);
    if (display > 0) panes.push({ offset: displayOffset, width: display, mullion: display > 3.1 });
    if (door) doorAt = doorOffset;
    // (the bay's frame reaches the ground, below the lot's own, as the wall does)
    f.add(offset, G + 1.705, .075, width + .24, 3.41, .11, b.accent);
    if (display > 0) {
      f.add(displayOffset, G + 1.69, .17, display, 2.03, .1, glazed('#456971'), 'glass');
      f.add(displayOffset, G + 3.04, .17, display, .57, .1, glazed('#729299'), 'glass');
      // A sill and the occasional mullion give large panes a readable scale.
      f.add(displayOffset, G + .6, .22, display + .14, .12, .32, b.accent);
      if (display > 3.1) f.add(displayOffset, G + 1.69, .24, .08, 2.03, .08, b.accent);
    }
    if (door) {
      f.add(doorOffset, G + 1.73, .17, door, 3.1, .1, glazed('#345660'), 'glass');
      f.add(doorOffset - side * Math.min(door * .32, .4), G + 1.35, .3, .06, .4, .08, '#e5d0a0');
    }
    f.add(offset, G + 2.75, .24, width + .1, .1, .1, '#bbd2c8');
    // (round a curve's short walls two bays in three have their awning, by where they stand on the run)
    const bay = facade.run && span < 5.5 ? Math.round((facade.run.from + inset[0] + (i + .5) * spacing) / 5.5) : i;
    if ((b.variation + bay) % 3 !== 0 && b.type !== 'office') {
      shopAwning(c, f, offset, spacing - .3, b.accent, b.variation);
    }
  }
  // The shop's name on its fascia board, over one of its windows or its door
  // if a tree stands in front of the middle, and its other signs
  if ((primary || facade.shopSign) && units) {
    shopSigns(c, b, f, { bottom: signBottom, top: signTop, centres, panes, door: doorAt, primary });
  }
}

// A framed residential entrance: the leaf's rails and panels share a single
// opaque face, so small inset details cannot flicker against a backing box.
function frontDoor(c, b, f, offset, head) {
  const bottom = .12, height = head - bottom, paint = b.variation % 2 ? '#655044' : b.accent;
  const panel = new THREE.Color(paint).multiplyScalar(.72), trim = b.type === 'townhouse' || b.type === 'brick' ? creamTrim : '#b3c5bc';
  const frameKind = c.distant ? 'inlay' : 'solid';
  for (const side of [-1, 1]) f.add(offset + side * .635, G + bottom + height / 2, .15, .12, height, .18, trim, frameKind, true);
  f.add(offset, G + head + .065, .15, 1.39, .13, .18, trim, frameKind, true);
  // Two wide panels read from the opposite kerb. Some doors have upper
  // glazing; the building's existing variation chooses it without new draws.
  const rows = [[.16, paint], [.67, panel], [.16, paint], [height - 1.17, b.variation % 2 ? panel : '#42616a'], [.18, paint]];
  for (const side of [-1, 1]) f.add(offset + side * .495, G + bottom + height / 2, .21, .16, height, 0, paint, 'inlay');
  let y = bottom;
  for (const [h, colour] of rows) {
    f.add(offset, G + y + h / 2, .21, .83, h, 0, colour, 'inlay');
    y += h;
  }
  f.add(offset + (b.variation % 2 ? -.45 : .45), G + 1.15, .28, .07, .18, .08, '#ccb88c');
}

// The ground floor along a street: a shopfront with its sign and awnings, a
// loading bay, or a front door with windows either side.
export function groundFloor(c, b, f, base, primary, random) {
  const { span } = f;
  const entry = entrance(b, span, primary, f.run), canopy = Math.min(9, span * .55);
  const staffSide = b.variation % 2 ? 1 : -1;
  const staff = b.type === 'warehouse' && primary && span / 2 - canopy / 2 > 3 ? staffSide * (canopy / 2 + 1.5) : null;
  // The projecting base course must stop at the threshold. Shopfronts have
  // their own continuous frames and sills, including the upstairs entrance.
  if (!entry?.shop) {
    const openings = [entry && { offset: entry.offset, width: entry.width }, staff !== null && { offset: staff, width: 1.45 }].filter(Boolean);
    const footing = { ...f, clear: [...f.clear, ...openings.map(p => ({ from: p.offset - p.width / 2, to: p.offset + p.width / 2, bottom: G - 1, top: G + .6 }))] };
    footing.add(0, G + .08, .3, span + .4, .16, .8, '#d5c19e', 'solid', true);
    // (the plinth stands on the ledge: running down through it, their cut ends
    // at a doorway shared a plane and flickered. It runs on past each end of
    // the front as far as the gap to a neighbour's, so a terrace's plinths meet)
    footing.add(0, G + .32, .06, span + .2, .32, .16, '#939b98', 'solid', true);
  }
  if (entry?.shop) shopFront(c, b, f, base, primary);
  else if (b.type === 'office' || b.type === 'atrium') {
    // (a sliver of a curved front is only the pier between its neighbours' glazing)
    if (span < .9) return;
    // The lobby's double door interrupts the glazing and its mullions.
    // Keeping glass beside/above the opening avoids two overlapping panes
    // and a full-height mullion running through the middle of the doorway.
    const bays = Math.max(1, Math.floor((span - 1.2) / 3.2)), spacing = (span - 1.2) / bays;
    const lobby = primary ? { ...f, clear: [...f.clear, { from: -1.34, to: 1.34, bottom: G - 1, top: G + 2.75 }] } : f;
    // (three lobbies in five are lit after dark)
    const glazed = (b.seed >>> 5) % 5 < 3 ? colour => nightLit(colour, 1) : colour => colour;
    lobby.add(0, G + base / 2 + .1, .1, span - .3, base - .6, .12, glazed('#5e8a9a'), 'glass');
    for (let i = 0; i <= bays; i++) lobby.add(-(span - 1.2) / 2 + i * spacing, G + base / 2 + .1, .2, .14, base - .6, .12, '#b6c9c8');
    if (primary) {
      for (const side of [-1, 1]) {
        f.add(side * .605, G + 1.3, .17, 1.11, 2.6, .1, glazed('#2f4b55'), 'glass');
        f.add(side * 1.25, G + 1.3, .24, .18, 2.6, .14, '#b6c9c8', c.distant ? 'inlay' : 'solid');
        f.add(side * .22, G + 1.28, .29, .065, .48, .08, '#d8dbd2');
        f.add(side * .605, G + .12, .24, 1.11, .24, 0, '#7c9698', 'inlay');
      }
      f.add(0, G + 1.3, .24, .1, 2.6, .14, '#b6c9c8', c.distant ? 'inlay' : 'solid');
      f.add(0, G + 2.675, .24, 2.68, .15, .14, '#d8dbd2', c.distant ? 'inlay' : 'solid');
      f.add(0, G + 3.05, 1.1, 4.2, .18, 2.2, '#b6c9c8', 'solid', true);
      lobbySign(c, f, b.signs?.lobby, G + 3.14, 2.2, 4.2);
    }
  } else if (b.type === 'warehouse') {
    const door = Math.min(8, span * .5);
    // Painted metal, not the window material: broad panels and quiet seams
    // read as a shutter from the driving lane. Tile a single opaque face
    // at both detail levels, without seven projecting bars per opening.
    const paint = ['#82918b', '#77868c', '#9a9381'][b.variation % 3], seam = '#566764';
    const rows = b.variation === 2 ? 4 : 6, height = 3.05 / rows;
    for (let i = 0; i < rows; i++) {
      f.add(0, G + i * height + (height - .035) / 2, .22, door, height - .035, 0, paint, 'inlay');
      f.add(0, G + (i + 1) * height - .0175, .22, door, .035, 0, seam, 'inlay');
    }
    for (const side of [-1, 1]) f.add(side * (door / 2 + .07), G + 1.525, .2, .14, 3.05, .2, '#85968f', 'solid', true);
    f.add(0, G + 3.3, .3, canopy, .35, .7, b.accent, 'solid', true);
    if (primary) worksSign(c, f, b.signs?.works, G + 3.475, canopy);
    // Beside the loading door on the main front, a door for the people who
    // work there, and along the rest of a long front a row of high windows
    if (staff !== null) {
      f.add(staff, G + 1.15, .12, 1.05, 2.3, .12, b.accent);
      f.add(staff, G + 2.45, .2, 1.45, .14, .5, '#85968f', 'solid', true);
    }
    for (const way of [-1, 1]) {
      const from = canopy / 2 + (staff !== null && way === staffSide ? 3.4 : 1.4), to = span / 2 - 1, count = Math.floor((to - from) / 3.4);
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
      frontDoor(c, b, f, doorOffset, head);
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
    const target = tall && loft ? 6.5 : b.variation === 1 ? 5.6 : 4.8, { spacing } = bayLayout(f, target);
    const width = tall ? Math.min(loft ? Math.min(3.7, spacing - 1) : b.variation === 2 ? 2.25 : 1.65, spacing - .5) : 1.4;
    let offsets = bayLayout(f, target, (tall ? width : 1.4) + .25).windows.map(w => w.offset).filter(offset => !door || Math.abs(offset - doorOffset) >= width / 2 + 1.3);
    if (!offsets.length && !f.run) offsets = [-span * .3, span * .3].filter(offset => !door || Math.abs(offset - doorOffset) > 1.9);
    // (as on the floors above: a short wall and each wall of a curved front
    // too, where the ground floor used to stand blank under windowed floors)
    if (span >= 3.2 || f.run) for (const offset of offsets) {
      if (!tall) {
        if (f.run && span < 1.9) continue;
        f.add(offset, G + 2, .075, 1.65, 2.05, .11, '#e0ccab');
        f.add(offset, G + 2, .17, 1.4, 1.8, .08, '#435b65', 'glass');
        continue;
      }
      const w = Math.min(width, f.run ? span - .35 : span * .3), y = G + 2.5, h = 3.2;
      if (w < .6) continue;
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
// line (`reach` gives each wall's), where the neighbour's meets it; and no
// cornice reaches past its lot (`within`) at all. (The reach alone let two
// neighbours' cornices overlap where a wall stood nearer its lot line than
// the district's setback, their tops flickering through each other.)
export function cornice(bodies, ring, top, trim, roofColour, wall, parapet, courts = [], reach = null, within = null) {
  let band = (reach && signedArea(ring) > 0 && offsetPolygonMapped(ring, (p, q, k) => reach(k))?.points) || offsetPolygon(ring, .32);
  if (within?.length >= 3 && band.length >= 3) band = intersection([ccw(band)], [ccw(within)]).sort((p, q) => calcPolygonArea(q.outer) - calcPolygonArea(p.outer))[0]?.outer ?? band;
  const courtBands = courts.map(court => offsetPolygon(court, -.32)).filter(p => p.length >= 3);
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
function hipRoof(c, b, bodies, ring, top, solid) {
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
  if (solid) solid.ridge = y1;
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
function frontGarden(c, b, ring, primary, random, runs = []) {
  const lot = b.lotLocal, n = ring.length, gaps = [], strips = [];
  let open = false;
  for (let i = 0; i < n; i++) {
    const a = ring[i], q = ring[(i + 1) % n], span = edgeLength(ring, i);
    if (!b.street[i] || (span < 2.5 && !runs[i])) continue;
    const door = entrance(b, span, i === primary, runs[i]);
    if (!door) continue;
    open ||= door.shop;
    const tx = (q.x - a.x) / span, ty = (q.y - a.y) / span, nx = ty, ny = -tx;
    const at = (u, v) => ({ x: (a.x + q.x) / 2 + tx * u + nx * v, y: (a.y + q.y) / 2 + ty * u + ny * v });
    // (to the pavement: the lot's edge straight out from the door, or from
    // wherever along a shop's front it is furthest)
    const reach = Math.max(...[-.45, 0, .45].map(k => exitDistance(at(door.offset + k * door.width, .05), nx, ny, lot)));
    if (!(reach < 14)) continue;
    // (a shop's forecourt runs on past its front to the lot's own edges, where
    // the next shop's meets it: as wide as the front only, a sliver of lawn
    // showed between the two)
    const half = door.width / 2 + (door.shop ? 3 : 0);
    strips.push([at(door.offset - half, 0), at(door.offset + half, 0), at(door.offset + half, reach + 1), at(door.offset - half, reach + 1)]);
    if (!door.shop) gaps.push({ ...at(door.offset, reach), half: door.width / 2 + .45 });
  }
  // (one paving: the strips of a shop round a curve overlap at its bends)
  if (strips.length) for (const piece of intersection(union(strips).map(p => p.outer), [lot])) c.polygon(piece.outer.map(p => [p.x, p.y]), G + .06, .06, PATH);
  if (open || !b.lotStreet) return;
  // The hedge, just inside the lot along each of its street edges
  const civic = b.district === 'Civic quarter', height = civic ? .55 : .8 + random() * .25, depth = civic ? .4 : .7;
  const colour = civic ? '#cdc3ab' : HEDGES[Math.floor(random() * HEDGES.length)];
  for (let j = 0; j < lot.length; j++) {
    if (!b.lotStreet[j]) continue;
    const a = lot[j], q = lot[(j + 1) % lot.length], length = edgeLength(lot, j);
    if (length < 2) continue;
    const tx = (q.x - a.x) / length, ty = (q.y - a.y) / length, inset = depth / 2 + .2;
    // Where the line down the middle of this run meets a line through p along
    // (dx, dy), as a distance along the edge (null if they run nearly parallel)
    const cx = a.x - ty * inset, cy = a.y + tx * inset;
    const meet = (p, dx, dy) => { const den = tx * dy - ty * dx; return Math.abs(den) < .2 ? null : ((p.x - cx) * dy - (p.y - cy) * dx) / den; };
    // How far the run reaches at the corner before (side -1) or after (+1) this edge:
    // round a street corner to where the next run's middle line crosses its
    // own and half a wall on, so the two close the corner between them
    // instead of one standing out past the other; a stone wall a little over
    // a lot line, meeting the next lot's however the street bends there
    // (stopped short, a row of them showed a notch at every lot line); a
    // hedge, each its own height and green, a little short of it
    const reach = side => {
      const k = (j + side + lot.length) % lot.length, p = lot[k], r = lot[(k + 1) % lot.length], l = Math.hypot(r.x - p.x, r.y - p.y) || 1;
      const dx = (r.x - p.x) / l, dy = (r.y - p.y) / l, vertex = side < 0 ? 0 : length;
      if (b.lotStreet[k] && l >= 2) {
        const t = meet({ x: p.x - dy * inset, y: p.y + dx * inset }, dx, dy);
        return t === null ? vertex : Math.max(-depth - .5, Math.min(length + depth + .5, t + side * depth / 2));
      }
      if (!civic) return vertex - side * .1;
      const t = meet(p, dx, dy);
      return t === null ? vertex : Math.max(-.5, Math.min(length + .5, t + side * .1));
    };
    // The runs between the gates, including a gate on the next edge that a
    // run carried round the corner would reach
    const start = reach(-1), end = reach(1);
    const cuts = gaps.map(g => ({ along: (g.x - a.x) * tx + (g.y - a.y) * ty, off: Math.abs((g.x - a.x) * -ty + (g.y - a.y) * tx), half: g.half }))
      .filter(g => g.off < 1.5 && g.along > Math.min(0, start) - g.half && g.along < Math.max(length, end) + g.half).sort((p, r) => p.along - r.along);
    let from = start;
    for (const cut of [...cuts, { along: length + 1e9, half: 0 }]) {
      const to = Math.min(end, cut.along - cut.half);
      if (to - from > .6) {
        const mid = (from + to) / 2, x = a.x + tx * mid - ty * inset, y = a.y + ty * mid + tx * inset, yaw = Math.atan2(ty, tx);
        if (civic) c.box(x, G + height / 2, y, to - from, height, depth, colour, 'solid', yaw);
        else buildHedge(c.bodies, x, G, y, to - from, height, depth, colour, yaw);
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
function gableRoof(c, b, bodies, ring, top, random, solid) {
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
  if (solid) solid.ridge = y1;
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
const BASE_STONE = new THREE.Color('#6f6c64');
const TANK_DISTRICTS = new Set(['Old town', 'Warehouse district', 'Market district']);
function roofDetails(c, b, deck, top, random, holes = [], keep = []) {
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
      if (clear.some(hole => insidePolygon(p, hole)) || keep.some(strip => insidePolygon(p, strip)) || placed.some(o => Math.hypot(o.x - p.x, o.y - p.y) < o.r + 1)) continue;
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

// How high whatever stands on a lot reaches beside its party walls, above
// the pavement: a building's walls and its roof (a pitched roof's gable
// stands on the party wall), nothing for a garden, and no limit for a
// landmark, whose walls nothing is painted over. Worked out once a lot.
let lotTops = null;
function lotTop(index) {
  if (!lotTops || lotTops.city !== CITY.lots) { lotTops = new Map(); lotTops.city = CITY.lots; }
  let top = lotTops.get(index);
  if (top === undefined) {
    const b = planLot({ east: 0, start: 0 }, cityLot(index));
    top = b.kind === 'landmark' ? Infinity : b.kind !== 'building' ? 0
      : baseHeight(b) + (b.roofType === 'terrace' ? b.floors : b.setbackFloors) * 3.6 + ({ gable: 5.8, hip: 4.4 }[b.roofType] ?? 1.4);
    lotTops.set(index, top);
  }
  return top;
}
// A party wall that stands well clear of the building next door is painted
// as city firewalls are, with an advert for one of the city's businesses on
// a panel of flat paint, or a mural of low-poly triangles in one palette's
// shades. Which walls, and what, by a hash of the building, never a stream.
// Only on the band of wall between the top of the neighbour's roof and the
// cornice, and only close to: the signs are not drawn far off either.
const MURALS = [['#f3c47a', '#e0735b', '#6d4d86'], ['#a6dcd6', '#5fa0bf', '#355d8c'], ['#c3d98a', '#6fa25c', '#33614c'], ['#f6cbd8', '#c98ec7', '#6f69ad'], ['#f1e2a6', '#e39c4b', '#a8483f']];
const AD_PAINT = ['#e9e0c9', '#d8e0dc', '#e8d3c2', '#2f3f4a'];
const AD_SIGNS = [...new Set([...SIGNS_BY_USE.shop, ...SIGNS_BY_USE.works])].filter(sign => sign.aspect > 1.3 && sign.aspect < 6 && !sign.letters);
// Whether a party wall is painted, and the band it may have: { ad, bottom,
// ceiling } in metres above the pavement, or null
export function wallPainting(c, b, ring, i, top) {
  const a = ring[i], q = ring[(i + 1) % ring.length], span = edgeLength(ring, i);
  if (span < 7) return null;
  const pick = randomAt(b.seed >>> 8, 7460 + i, CITY.seed);
  if (pick > .5) return null;
  // (the lot the wall looks onto, a pace out from its middle)
  const nx = (q.y - a.y) / span, ny = -(q.x - a.x) / span, probe = { x: c.east + (a.x + q.x) / 2 + nx * 1.2, y: c.start + (a.y + q.y) / 2 + ny * 1.2 };
  const across = blockPlots(b.lot.block).find(plot => plot.index !== b.lot.index && insidePolygon(probe, plot.polygon));
  // (and above the ground floor, whose stone base stands out from the wall)
  const bottom = Math.max((across ? lotTop(across.index) : 0) + .8, baseHeight(b) + .5), ceiling = top - .9;
  return ceiling - bottom < 3.2 ? null : { ad: pick < .3, bottom, ceiling, pick };
}
function paintWall(c, b, ring, i, top) {
  const paint = wallPainting(c, b, ring, i, top);
  if (!paint) return;
  const a = ring[i], q = ring[(i + 1) % ring.length], span = edgeLength(ring, i), { bottom, ceiling, pick } = paint;
  const f = edgeFacade(c, a, q), mid = (bottom + ceiling) / 2, room = ceiling - bottom, wide = span - 1.8;
  if (paint.ad) {
    const sign = AD_SIGNS[Math.floor(randomAt(b.seed >>> 4, 7461 + i, CITY.seed) * AD_SIGNS.length)];
    const h = Math.min(room - 1, 5.5, (wide - .9) / sign.aspect), w = h * sign.aspect;
    if (h < 1.5 || w < 4) return;
    f.add(0, G + mid, .03, w + .9, h + .9, .06, AD_PAINT[Math.floor(pick * 40) % AD_PAINT.length]);
    const p = f.position(0, G + mid, .075);
    c.signFace('shop-signs', sign, p[0], p[1], -p[2], f.yaw, w, h, null);
    return;
  }
  // A mural: a grid of triangles over a panel, its inner corners jittered,
  // coloured along a slant from one end of the palette to the other, in a frame
  const w = Math.min(wide, room * 2.4), h = Math.min(room - .4, w * .9), columns = Math.max(3, Math.round(w / 1.6)), rows = Math.max(2, Math.round(h / 1.6));
  const palette = MURALS[Math.floor(randomAt(b.seed >>> 4, 7462 + i, CITY.seed) * MURALS.length)].map(colour => new THREE.Color(colour));
  const slant = randomAt(b.seed >>> 4, 7463 + i, CITY.seed) * Math.PI, sx = Math.cos(slant), sy = Math.sin(slant), jitter = (k, salt) => randomAt(b.seed >>> 4, 7470 + k * 7 + salt + i * 1013, CITY.seed) - .5;
  const corner = (col, row) => {
    const inner = col > 0 && col < columns && row > 0 && row < rows, k = col * (rows + 1) + row;
    return { o: -w / 2 + (col + (inner ? jitter(k, 1) * .6 : 0)) * w / columns, y: mid - h / 2 + (row + (inner ? jitter(k, 2) * .6 : 0)) * h / rows };
  };
  const shade = new THREE.Color(), at = p => f.position(p.o, G + p.y, .06);
  const tri = (p, r, s, k) => {
    const cx = (p.o + r.o + s.o) / 3 / w, cy = (p.y + r.y + s.y - 3 * mid) / 3 / h, t = Math.max(0, Math.min(1, .5 + (cx * sx + cy * sy) * .95 + jitter(k, 3) * .18));
    if (t < .5) shade.copy(palette[0]).lerp(palette[1], t * 2); else shade.copy(palette[1]).lerp(palette[2], t * 2 - 1);
    shade.multiplyScalar(.94 + jitter(k, 4) * .12);
    const [pa, pb, pc] = [p, r, s].map(at);
    c.bodies.face(...pa, ...pb, ...pc, `#${shade.getHexString()}`);
  };
  for (let col = 0; col < columns; col++) for (let row = 0; row < rows; row++) {
    const p00 = corner(col, row), p10 = corner(col + 1, row), p11 = corner(col + 1, row + 1), p01 = corner(col, row + 1), k = col * rows + row;
    if ((col + row) % 2) { tri(p00, p10, p11, k * 2); tri(p00, p11, p01, k * 2 + 1); }
    else { tri(p00, p10, p01, k * 2); tri(p10, p11, p01, k * 2 + 1); }
  }
  const frame = '#e4dccb';
  for (const side of [-1, 1]) {
    f.add(side * (w / 2 + .06), G + mid, .04, .12, h + .24, .08, frame);
    f.add(0, G + mid + side * (h / 2 + .06), .04, w + .24, .12, .08, frame);
  }
}

// An iron fire escape down the front of some older brick blocks and lofts:
// a railed landing under each floor's window at the end of the front away
// from the door, a flight of steps between each landing and the next, and
// a ladder drawn up under the lowest. Close to only, as the other trim is
// far off, and chosen by a hash of the building, never a stream.
const ESCAPE_DISTRICTS = new Set(['Old town', 'Warehouse district', 'Market district']), IRON = '#33383a';
function fireEscape(c, b, f, bottom, floors) {
  if (c.distant || floors < 3 || f.span < 8 || !['brick', 'loft'].includes(b.type) || !ESCAPE_DISTRICTS.has(b.district)) return;
  if (randomAt(b.seed >>> 6, 7490, CITY.seed) > .35) return;
  const { windows, spacing } = windowBays(b, f);
  if (windows.length < 2) return;
  // (the end of the front away from the door, the lobby or the upstairs sign)
  const end = b.variation % 2 ? 1 : -1, bay = windows.reduce((best, w) => end * w.offset > end * best.offset ? w : best);
  const width = Math.min(spacing - .3, 3.8), h = b.type === 'loft' ? 2.45 : 2.2, at = bay.offset;
  const levels = Array.from({ length: floors }, (_, k) => bottom + 1.7 + k * 3.6 - h / 2 - .3);
  if (levels.some(y => f.blocked(at, y + .6, width + .2, 1.4))) return;
  const stair = (o0, y0, o1, y1) => {
    const p = f.position((o0 + o1) / 2, (y0 + y1) / 2, .5), run = o1 - o0, rise = y1 - y0;
    c.box(p[0], p[1], -p[2], Math.hypot(run, rise), .07, .7, IRON, 'solid', f.yaw, Math.atan2(rise, run));
  };
  levels.forEach((y, k) => {
    f.add(at, y, .6, width, .1, 1.1, IRON);
    for (const rail of [.55, 1]) f.add(at, y + rail, 1.12, width, .045, .045, IRON);
    for (const side of [-1, 1]) {
      f.add(at + side * (width / 2 - .025), y + .5, 1.12, .05, 1, .05, IRON);
      f.add(at + side * (width / 2 - .025), y + 1, .6, .05, .045, 1.1, IRON);
    }
    // (up to the next landing, from one end to the other and back)
    const up = k % 2 ? -1 : 1;
    if (k < floors - 1) stair(at - up * (width / 2 - .25), y + .05, at + up * (width / 2 - .25), levels[k + 1] + .05);
  });
  // the ladder, drawn up under the lowest landing
  f.add(at + end * (width / 2 - .45), levels[0] - 1.05, .95, .45, 2, .05, IRON);
}

// The runs of walls round a ring that turn less than 30 degrees where they
// meet: for each wall in a run of two or more, where along the run it
// starts, how long the run is, and its walls in groups for bayLayout (each
// at least 3.6 m of front, so a short wall joins its neighbours)
export function facadeRuns(ring, facade, kind) {
  const n = ring.length, runs = new Array(n);
  const gentle = k => {
    const j = (k - 1 + n) % n, p = ring[j], q = ring[k], r = ring[(k + 1) % n];
    const turn = Math.abs(Math.atan2((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x), (q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y)));
    return turn < .52 && facade(j) && facade(k) && kind(j) === kind(k);
  };
  let first = 0;
  while (first < n && gentle(first)) first++;
  if (first === n) return runs;
  for (let m = 0, k = first; m < n;) {
    const walls = [k];
    for (m++, k = (k + 1) % n; m < n && gentle(k); m++, k = (k + 1) % n) walls.push(k);
    if (walls.length < 2) continue;
    const length = walls.reduce((sum, w) => sum + edgeLength(ring, w), 0), groups = [];
    let from = 0, start = 0;
    for (const [i, w] of walls.entries()) {
      runs[w] = { from, length, groups };
      from += edgeLength(ring, w);
      const front = from - start - (start === 0 ? .9 : 0) - (i === walls.length - 1 ? .9 : 0);
      if (front >= 3.6 || i === walls.length - 1) { groups.push([start, from]); start = from; }
    }
    // (a short last group joins the one before it)
    const last = groups.at(-1);
    if (groups.length > 1 && last[1] - last[0] - .9 < 3.6) { groups.pop(); groups.at(-1)[1] = last[1]; }
  }
  return runs;
}

// For each wall of a run, how far the ring turns where it meets the wall
// before it and the one after it in the run: [start, end], null at an end of
// the run (and null for a wall in none)
export function runJoins(ring, runs) {
  const n = ring.length, turn = k => {
    const p = ring[(k - 1 + n) % n], q = ring[k % n], r = ring[(k + 1) % n];
    return Math.abs(Math.atan2((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x), (q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y)));
  };
  return ring.map((p, i) => {
    const run = runs[i];
    return run ? [run.from > 1e-6 ? turn(i) : null, run.from + edgeLength(ring, i) < run.length - 1e-6 ? turn(i + 1) : null] : null;
  });
}

// How tall a building's ground floor is: a shed's loading bay, a house's
// storey, or a block's tall shop or lobby floor
const baseHeight = b => b.type === 'warehouse' ? 4.8 : b.domestic ? 3.6 : 5.4;

function buildBuilding(c, b) {
  const random = seededRandom(b.seed ^ 0x3c6ef372), bodies = c.bodies, ring = b.footprint, n = ring.length;
  const base = baseHeight(b), height = base + b.floors * 3.6, lower = b.setbackFloors, lowerTop = G + base + lower * 3.6;
  const centre = averagePoint(ring);
  c.features.buildings.push({ x: c.east + centre.x, s: c.start + centre.y, area: b.area, height, type: b.type, floors: b.floors, roofType: b.roofType, wall: b.wall });
  const solid = c.polygonSolid(convexHull(ring).map(p => [p.x, p.y]), G + height);
  if (b.lawn) {
    const lot = b.lotLocal.map(p => [p.x, p.y]);
    grassArea(c, lot, LAWN, G + .05);
    // A tree or two in the garden, each no bigger than its room from the house.
    // The skyline plants none but makes the same draws, so the windows match.
    const walls = [...ring, ring[0]], edge = [...b.lotLocal, b.lotLocal[0]], trees = [];
    const wanted = Math.min(2, 1 + Math.floor((calcPolygonArea(b.lotLocal) - b.area) / 320));
    for (let i = 0; i < 24 && trees.length < wanted; i++) {
      const p = insidePoint(b.lotLocal, random);
      if (!p || insidePolygon(p, ring) || distanceToPolyline(p, edge) < 1.6 || trees.some(t => Math.hypot(t.x - p.x, t.y - p.y) < 5.5)) continue;
      // (a neighbour's wall may stand on the lot line)
      const room = Math.min(distanceToPolyline(p, walls), distanceToPolyline(p, edge) + .2);
      if (room < 2.2) continue;
      const size = Math.min(5 + random() * 3, treeRoom(room));
      if (!c.distant) c.tree(p.x, p.y, size);
      trees.push(p);
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
    // (the same draws in the skyline, as for the garden's trees)
    const garden = offsetPolygon(court, -3);
    for (let i = 0, placed = 0; i < 12 && placed < 2; i++) { const p = insidePoint(garden, random); if (p) { const size = 5 + random() * 3; if (!c.distant) c.tree(p.x, p.y, size); placed++; } }
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
  // A corner business also names its other street, once. Small bevels and
  // the almost parallel segments of a curved frontage are not extra shops.
  let secondary = -1;
  if (b.shopfront && primary >= 0) {
    const front = edgeFacade(c, ring[primary], ring[(primary + 1) % n]);
    for (let i = 0; i < n; i++) {
      if (!b.street[i] || i === primary || edgeLength(ring, i) < Math.max(6, front.span * .35)) continue;
      const f = edgeFacade(c, ring[i], ring[(i + 1) % n]);
      if (f.normal.x * front.normal.x + f.normal.y * front.normal.y > .8) continue;
      if (secondary < 0 || f.span > edgeLength(ring, secondary)) secondary = i;
    }
  }
  // Windowed walls of the same kind that meet at gentle bends, the segments
  // of a curved front, share one run of bays (see bayLayout)
  // (however short: a street's curve is drawn in 2 m chords, and a curved
  // corner of a tower left out as short walls stood blank all the way up)
  const runs = facadeRuns(ring, k => b.windows[k], k => b.street[k]), joins = runJoins(ring, runs);
  // (what a sign standing out from a wall has to keep clear of)
  const plots = c.distant ? [] : [ring, ...(b.lot?.index === undefined ? [] : neighboursOf(b.lot).map(plot => local(plot, c)))];
  for (let i = 0; i < n; i++) {
    const f = edgeFacade(c, ring[i], ring[(i + 1) % n]), run = runs[i];
    f.plots = plots;
    f.street = b.street[i];
    f.run = run;
    f.joins = joins[i];
    f.shopSign = i === secondary;
    if (f.span < 2.5 && !run) continue;
    if (f.street) groundFloor(c, b, f, base, i === primary, random);
    else if (b.windows[i] && (b.type === 'office' || b.type === 'atrium')) groundFloor(c, { ...b, shopfront: false }, f, base, false, random);
    if (i === primary && b.signs?.upstairs && b.windows[i]) upstairsSign(c, f, b.signs.upstairs, windowBays(b, f), b.variation % 2 ? -1 : 1, G + base, lowerTop);
    // (a detached house's ground floor is a storey like the others, windowed
    // round its garden)
    const garden = b.domestic && b.lawn && !f.street;
    if (b.windows[i]) edgeWindows(c, b, f, garden ? G : G + base, garden ? lower + 1 : lower, random);
    if (i === primary && b.windows[i]) fireEscape(c, b, f, G + base, lower);
  }
  if (b.lawn && !c.distant) frontGarden(c, b, ring, primary, random, runs);
  // (a party wall standing clear of the house next door: see paintWall)
  if (!c.distant && b.lot?.index !== undefined) for (let i = 0; i < n; i++) if (!b.street[i] && !b.windows[i]) paintWall(c, b, ring, i, lowerTop - G);
  if (b.roofType === 'hip') { hipRoof(c, b, bodies, ring, lowerTop, solid); return; }
  if (b.roofType === 'gable') { gableRoof(c, b, bodies, ring, lowerTop, random, solid); return; }
  const trim = b.type === 'office' ? '#b8cccd' : '#d6c9b1';
  const reach = k => b.party?.[k] && b.side < .32 ? b.side : .32;
  const parapet = b.type === 'deco' ? 1.2 : .65;
  let { deck, holes } = cornice(bodies, ring, lowerTop, trim, b.roof, b.wall, parapet, courts, reach, b.lotLocal), top = lowerTop;
  // (a name on the roof over the main front, see crownSign)
  const crown = primary >= 0 && b.signs?.crown ? crownSign(c, edgeFacade(c, ring[primary], ring[(primary + 1) % n]), b.signs.crown, lowerTop + .18, lowerTop + .12 + parapet) : null;
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
  roofDetails(c, b, deck, top, random, holes, crown ? [crown] : []);
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

// One lot per step, all planned before any is built. Planning a busy cell's
// lots in one step took 2-3 ms here, so 10-15 ms on a phone.
export function* buildCityBuildingSteps(c) {
  const plan = [];
  for (const lot of c.lots) { plan.push(planLot(c, lot)); yield; }
  for (const b of plan) {
    if (b.kind === 'landmark') { if (!c.structure(0, 0, () => buildLandmark(c, b.lot, b.place))) buildGarden(c, b.lot); }
    else if (b.kind === 'building') c.structure(0, 0, () => buildBuilding(c, b));
    else if (b.kind === 'garden') buildGarden(c, b.lot);
    yield;
  }
}

