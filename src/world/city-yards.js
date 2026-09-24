import { CITY } from './city.js';
import { seededRandom } from './route.js';
import { placeForBlock, placeForLot } from '../city-exploration.js';
import { difference, intersection, solids } from '../mapgen/booleans.js';
import { offsetPolygon, insidePolygon, calcPolygonArea, signedArea } from '../mapgen/polygon-util.js';

// The paved yards behind the offices and warehouses are car parks: rows of
// bays square to the yard's longest side, back to back across aisles, a few
// more than half of them taken, and a driveway in from the street between two
// of the buildings round it. Laid out once per block, for the ground, the
// buildings, the street furniture and the cars alike.
const PARKED_YARDS = new Set(['Midtown', 'Warehouse district']);
// What stands in the parking bays, commonest first
export const PARKED_MODELS = ['sedan', 'hatchback', 'wagon', 'sedan', 'hatchback', 'pickup', 'van'];
export const YARD_BAY = { width: 2.7, depth: 5.2, aisle: 6.4, margin: 1.4 };
// A driveway's width, and how far it cuts into its lot at most
export const DRIVE_WIDTH = 7;
const DRIVE_REACH = 80;

const carParkYard = block => PARKED_YARDS.has(block.style) && block.yard?.length >= 3 && calcPolygonArea(block.yard) >= 450 && !placeForBlock(block.index);

let lotsByBlock = null;
const drives = new Map();
// The driveway into a block's car park: a strip across one of its street
// lots, at the end of the frontage beside its neighbour, from the pavement
// to the yard. The narrowest lot that fronts one street only and backs onto
// the yard gives up the strip; its building stands on what is left.
// { lot, polygon (the strip in the lot), mouth (on the pavement's inner
// edge), tx, ty (along the street), nx, ny (into the block), width } or null.
export function yardDrive(index) {
  if (drives.has(index)) return drives.get(index);
  drives.set(index, null);
  const block = CITY.blocks[index];
  if (!block || !carParkYard(block)) return null;
  if (!lotsByBlock) {
    lotsByBlock = new Map();
    (CITY.lotBlocks ?? []).forEach((b, i) => { if (!lotsByBlock.has(b)) lotsByBlock.set(b, []); lotsByBlock.get(b).push(i); });
  }
  let best = null;
  for (const i of lotsByBlock.get(index) ?? []) {
    let lot = CITY.lots[i], kinds = CITY.lotEdges?.[i];
    if (!kinds || kinds.length !== lot.length || placeForLot(i)) continue;
    if (signedArea(lot) < 0) { lot = lot.slice().reverse(); kinds = kinds.slice(0, -1).reverse().concat(kinds.slice(-1)); }
    const n = lot.length, streets = kinds.flatMap((kind, j) => kind === 'street' ? [j] : []);
    if (streets.length !== 1 || !kinds.includes('rear')) continue;
    const j = streets[0], a = lot[j], b = lot[(j + 1) % n], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < DRIVE_WIDTH + 8 || (best && length >= best.length)) continue;
    // The end of the frontage beside a neighbour
    const atStart = kinds[(j - 1 + n) % n] === 'side', atEnd = kinds[(j + 1) % n] === 'side';
    if (!atStart && !atEnd) continue;
    const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length, nx = -ty, ny = tx;
    const e = atStart ? a : b, sx = atStart ? tx : -tx, sy = atStart ? ty : -ty;
    best = { lot: i, length, e, sx, sy, tx, ty, nx, ny, ring: lot };
  }
  if (!best) return null;
  const { e, sx, sy, nx, ny } = best;
  const rect = [e, { x: e.x + sx * DRIVE_WIDTH, y: e.y + sy * DRIVE_WIDTH }, { x: e.x + sx * DRIVE_WIDTH + nx * DRIVE_REACH, y: e.y + sy * DRIVE_WIDTH + ny * DRIVE_REACH }, { x: e.x + nx * DRIVE_REACH, y: e.y + ny * DRIVE_REACH }];
  const strip = intersection(solids([best.ring]), solids([rect])).sort((p, q) => calcPolygonArea(q.outer) - calcPolygonArea(p.outer))[0]?.outer;
  if (!strip || calcPolygonArea(strip) < DRIVE_WIDTH * 8) return null;
  const drive = { lot: best.lot, polygon: strip, rect, mouth: { x: e.x + sx * DRIVE_WIDTH / 2, y: e.y + sy * DRIVE_WIDTH / 2 }, tx: best.tx, ty: best.ty, nx, ny, width: DRIVE_WIDTH };
  drives.set(index, drive);
  return drive;
}
// What is left of a lot for its building once its driveway is cut from it
export function lotWithoutDrive(index, polygon) {
  const block = CITY.lotBlocks?.[index], drive = block === undefined ? null : yardDrive(block);
  if (drive?.lot !== index) return null;
  return difference(solids([polygon]), solids([drive.rect])).sort((p, q) => calcPolygonArea(q.outer) - calcPolygonArea(p.outer))[0]?.outer ?? null;
}

const yardBays = new Map();
export function yardParking(block) {
  if (yardBays.has(block)) return yardBays.get(block);
  const bays = [];
  yardBays.set(block, bays);
  // (not in a venue's grounds)
  if (!carParkYard(block)) return bays;
  const lot = offsetPolygon(block.yard, -YARD_BAY.margin);
  if (lot.length < 3) return bays;
  let longest = 0;
  for (let i = 1; i < lot.length; i++) if (Math.hypot(lot[(i + 1) % lot.length].x - lot[i].x, lot[(i + 1) % lot.length].y - lot[i].y) > Math.hypot(lot[(longest + 1) % lot.length].x - lot[longest].x, lot[(longest + 1) % lot.length].y - lot[longest].y)) longest = i;
  const a = lot[longest], b = lot[(longest + 1) % lot.length], length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length, vx = -uy, vy = ux;
  const us = lot.map(p => p.x * ux + p.y * uy), vs = lot.map(p => p.x * vx + p.y * vy);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const { width, depth, aisle } = YARD_BAY, random = seededRandom(CITY.seed * 131 + block.index * 7919);
  const at = (u, v) => ({ x: u * ux + v * vx, y: u * uy + v * vy });
  const inside = (u, v) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([su, sv]) => insidePolygon(at(u + su * width / 2, v + sv * depth / 2), lot));
  // The way in from the driveway stays clear, into the yard a car's length and more
  const drive = yardDrive(block.index);
  const inTheWay = p => {
    if (!drive) return false;
    const dx = p.x - drive.mouth.x, dy = p.y - drive.mouth.y, across = Math.abs(dx * drive.tx + dy * drive.ty), into = dx * drive.nx + dy * drive.ny;
    return across < drive.width / 2 + YARD_BAY.width && into > 0 && into < DRIVE_REACH;
  };
  // An aisle, two rows of bays back to back, an aisle, and so on across the yard
  for (let row = 0, v = v0 + aisle + depth / 2; v + depth / 2 <= v1; row++, v += row % 2 ? depth : depth + aisle) {
    for (let u = u0 + width / 2; u + width / 2 <= u1; u += width) {
      if (!inside(u, v)) continue;
      // Each car noses into its bay, away from the aisle it came in by
      const sign = row % 2 ? 1 : -1, p = at(u, v);
      const taken = random() < .58, model = PARKED_MODELS[Math.floor(random() * PARKED_MODELS.length)], colour = Math.floor(random() * 1e6);
      if (inTheWay(p)) continue;
      bays.push({ x: p.x, y: p.y, ux, uy, vx, vy, heading: Math.atan2(vx * sign, vy * sign), taken, model, colour });
    }
  }
  // A handful of bays is not a car park
  if (bays.length < 6) bays.length = 0;
  return bays;
}
