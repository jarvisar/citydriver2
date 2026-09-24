import Vector from '../mapgen/vector.js';
import { SEED, randomAt } from './route.js';
import { generateCityMap, ROAD_PROFILES, SIDEWALK } from '../mapgen/generate.js';
import { RoadIndex } from '../mapgen/road-index.js';
import { shoreRuns } from '../mapgen/shore.js';
import { difference } from '../mapgen/booleans.js';
import { insidePolygon, offsetPolylineClean, bufferPolyline, averagePoint, calcPolygonArea,
  offsetPolygon, polygonBounds, distanceToPolyline, signedArea, dedupePolygon } from '../mapgen/polygon-util.js';

// One city per visit, generated from the URL seed the way citydriver's grid
// was: roads, water, blocks and lots come from the MapGenerator port, and this
// module derives the surfaces the game stands on from them, once, so the
// renderer, the tyres and the street furniture all agree: the water and the
// quays round it, the kerbs with their rounded corners, the districts and a
// spatial index that says whether a point is pavement or roadway.
export const CITY_WIDTH = 2400, CITY_HEIGHT = 1800, CITY_MARGIN = 800, CITY_CELL = 160;
// Promenade between a waterside road's kerb and the water
export const QUAY = 6;
// Kerb corners at junctions are rounded to this radius
export const KERB_RADIUS = 5.5;
export { SIDEWALK };

// Neighbourhoods follow the tensor field: each grid basis field shapes the
// streets of one part of town, and that part has one character. The radial
// field is downtown.
export const DISTRICT_STYLES = ['Old town', 'Garden quarter', 'Warehouse district', 'Market district', 'Civic quarter'];
// How each district plats its blocks: lot depth and frontages (see mapgen/lots.js)
export const LOT_STYLES = {
  'Old town': { depth: 19, frontage: [10, 15], corner: [8, 12] },
  'Market district': { depth: 21, frontage: [12, 18], corner: [9, 14] },
  'Garden quarter': { depth: 27, frontage: [16, 22], corner: [12, 16] },
  'Warehouse district': { depth: 32, frontage: [24, 36], corner: [16, 22] },
  'Civic quarter': { depth: 25, frontage: [18, 26], corner: [12, 18] },
  Midtown: { depth: 30, frontage: [22, 34], corner: [15, 22] },
};
// How each district's side streets are laid out (see mapgen/road-hierarchy.js):
// narrow lanes in the old town, parking bays where there are houses with
// gardens, vans at the warehouses or shoppers downtown
export const STREET_STYLES = {
  'Old town': 'lane', 'Garden quarter': 'parking', 'Warehouse district': 'parking',
  'Market district': 'side', 'Civic quarter': 'side', Midtown: 'parking',
};
const DOWNTOWN = .62;

function districtNames(seed) {
  const names = DISTRICT_STYLES.slice();
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(randomAt(i, 7300, seed) * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  return names;
}

// Which cells are under water, at 4 m, so the car never asks a polygon. Land
// is filled in; everything else, and everything beyond the mask, is water.
class WaterMask {
  constructor(minX, minY, maxX, maxY, cell = 4) {
    this.minX = minX; this.minY = minY; this.cell = cell;
    this.cols = Math.ceil((maxX - minX) / cell); this.rows = Math.ceil((maxY - minY) / cell);
    this.data = new Uint8Array(this.cols * this.rows);
  }
  // A polygon with holes, as rings, filled even-odd
  fillLand(rings) {
    for (let row = 0; row < this.rows; row++) {
      const y = this.minY + (row + .5) * this.cell, crossings = [];
      for (const ring of rings) for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        if ((a.y > y) !== (b.y > y)) crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
      }
      crossings.sort((p, q) => p - q);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((crossings[k] - this.minX) / this.cell - .5));
        const c1 = Math.min(this.cols - 1, Math.floor((crossings[k + 1] - this.minX) / this.cell - .5));
        for (let c = c0; c <= c1; c++) this.data[row * this.cols + c] = 1;
      }
    }
  }
  at(x, y) {
    const cx = Math.floor((x - this.minX) / this.cell), cy = Math.floor((y - this.minY) / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return true;
    return this.data[cy * this.cols + cx] === 0;
  }
}

// Polygons by cell, answering "which of these contains the point?"
export class PolygonIndex {
  constructor(cell = 32) { this.cell = cell; this.cells = new Map(); }
  add(polygon, value) {
    if (polygon.length < 3) return;
    const b = polygonBounds(polygon), entry = { polygon, value, b };
    for (let cx = Math.floor(b.minX / this.cell); cx <= Math.floor(b.maxX / this.cell); cx++) {
      for (let cy = Math.floor(b.minY / this.cell); cy <= Math.floor(b.maxY / this.cell); cy++) {
        const key = cx * 65536 + cy;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(entry);
      }
    }
  }
  find(x, y) {
    const list = this.cells.get(Math.floor(x / this.cell) * 65536 + Math.floor(y / this.cell));
    if (!list) return null;
    for (const { polygon, value, b } of list) {
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (insidePolygon({ x, y }, polygon)) return value;
    }
    return null;
  }
}

// Rounds the sharp convex corners of a kerb line. Returns the rounded polygon
// and, for each corner, the sliver of roadway the rounding hands back.
export function roundCorners(input, radius, minTurn = .35) {
  let polygon = dedupePolygon(input, .01);
  if (polygon.length < 3) return { polygon, patches: [] };
  if (signedArea(polygon) < 0) polygon = polygon.slice().reverse();
  const n = polygon.length, out = [], patches = [];
  for (let i = 0; i < n; i++) {
    const a = polygon[(i - 1 + n) % n], p = polygon[i], b = polygon[(i + 1) % n];
    const d1x = p.x - a.x, d1y = p.y - a.y, d2x = b.x - p.x, d2y = b.y - p.y, l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    const turn = Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
    if (turn < minTurn || turn > Math.PI - .15 || l1 < .5 || l2 < .5) { out.push(p); continue; }
    const tanHalf = Math.tan(turn / 2), tangent = Math.min(radius * tanHalf, l1 * .45, l2 * .45), r = tangent / tanHalf;
    const ux = d1x / l1, uy = d1y / l1, vx = d2x / l2, vy = d2y / l2;
    const start = new Vector(p.x - ux * tangent, p.y - uy * tangent);
    const cx = start.x - uy * r, cy = start.y + ux * r, a0 = Math.atan2(start.y - cy, start.x - cx), steps = Math.max(2, Math.ceil(turn / .2));
    const arc = [];
    for (let k = 0; k <= steps; k++) arc.push(new Vector(cx + Math.cos(a0 + turn * k / steps) * r, cy + Math.sin(a0 + turn * k / steps) * r));
    arc[arc.length - 1] = new Vector(p.x + vx * tangent, p.y + vy * tangent);
    out.push(...arc);
    patches.push([p, ...arc.slice().reverse()]);
  }
  return { polygon: out, patches };
}

// The runs of a walk beside `own` that no other road crosses
function crossingFree(roadIndex, points, halfWidth, own, step = 2) {
  const runs = [];
  let run = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], length = a.distanceTo(b), count = Math.max(1, Math.ceil(length / step));
    for (let k = i ? 1 : 0; k <= count; k++) {
      const p = a.clone().add(b.clone().sub(a).multiplyScalar(k / count));
      const hit = roadIndex.nearest(p.x, p.y, 20, (segment, distance) => segment.road === own ? Infinity : distance - segment.road.profile.halfWidth);
      if (hit && hit.score < halfWidth + 1.2) { if (run.length > 1) runs.push(run); run = []; }
      else run.push(p);
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

export function buildCity(seed = SEED) {
  const names = districtNames(seed);
  const styleName = (grid, downtown) => downtown < DOWNTOWN ? 'Midtown' : names[grid] ?? 'Market district';
  const map = generateCityMap({ seed, width: CITY_WIDTH, height: CITY_HEIGHT,
    lots: { style: (centre, grid, downtown) => ({ ...LOT_STYLES[styleName(grid, downtown)] }) },
    streets: { style: (point, grid, downtown) => STREET_STYLES[styleName(grid, downtown)] } });
  const margin = CITY_MARGIN;
  const minX = -CITY_WIDTH / 2 - margin, minY = -CITY_HEIGHT / 2 - margin, maxX = CITY_WIDTH / 2 + margin, maxY = CITY_HEIGHT / 2 + margin;
  // Land and water come from the generator's shore model, which tiles the
  // world between them exactly: the island, the river through it and the sea
  // all round (see mapgen/shore.js)
  const shore = map.shore;
  const land = shore.land, seaWater = shore.sea, riverWater = shore.river, quays = [];
  const riverCentre = shore.riverCentre;
  const inRiver = p => riverWater.some(piece => insidePolygon(p, piece.outer));
  // A promenade along the coast road, between its kerb and the water
  const coastProfile = ROAD_PROFILES.coast;
  if (shore.coast) {
    for (const road of map.roads) if (road.kind === 'coast') quays.push({ points: offsetPolylineClean(road.points, shore.coast.seaSide * (coastProfile.halfWidth + QUAY / 2)), halfWidth: QUAY / 2, road });
  }
  // and along each river bank road, as wide as the bank leaves it
  if (riverCentre) {
    const bankProfile = ROAD_PROFILES.riverbank;
    for (const road of map.roads) {
      if (road.kind !== 'riverbank') continue;
      const probe = offsetPolylineClean(road.points, bankProfile.halfWidth + QUAY / 2);
      const middle = road.points[Math.floor(road.points.length / 2)];
      const side = distanceToPolyline(probe[Math.floor(probe.length / 2)], riverCentre) < distanceToPolyline(middle, riverCentre) ? 1 : -1;
      const width = Math.max(1, (distanceToPolyline(middle, riverCentre) - bankProfile.halfWidth - map.riverWidth) / 2);
      quays.push({ points: offsetPolylineClean(road.points, side * (bankProfile.halfWidth + width)), halfWidth: width, road });
    }
  }
  // Where land meets water, water on the right: a quay wall all round
  const shores = shoreRuns(land);
  const walls = shores.map(run => run.points);
  const mask = new WaterMask(minX, minY, maxX, maxY);
  for (const piece of land) mask.fillLand([piece.outer, ...piece.holes]);
  const radial = map.field.getBasisFields().find(field => field.FIELD_TYPE === 0);
  const downtown = radial ? { u: radial.centre.x, s: radial.centre.y, radius: radial._size } : { u: 0, s: 0, radius: 300 };

  // Kerbs: every block's pavement edge with its junction corners rounded, and
  // the slivers of roadway the rounding gives back to the junction
  const pavement = new PolygonIndex(), cornerPatches = [];
  const halfWidthNear = (a, b) => {
    const hit = map.roadIndex.nearest((a.x + b.x) / 2, (a.y + b.y) / 2, 30, (segment, distance) => distance);
    return hit ? hit.road.profile.halfWidth : ROAD_PROFILES.minor.halfWidth;
  };
  map.blocks.forEach((block, index) => {
    block.index = index;
    const centre = averagePoint(block.inner.length >= 3 ? block.inner : block.polygon);
    block.style = styleName(block.district ?? 0, Math.hypot(centre.x - downtown.u, centre.y - downtown.s) / Math.max(1, downtown.radius));
    if (block.sidewalk.length < 3) { block.kerb = []; return; }
    const { polygon, patches } = roundCorners(block.sidewalk, KERB_RADIUS);
    block.kerb = polygon;
    cornerPatches.push(...patches);
    pavement.add(polygon, { kind: 'block', block: index });
  });
  // Parks: a big park is ringed by pavement like a block, with its lawn inside;
  // a square is a block left open
  const parks = map.parkInfo.map((info, index) => {
    if (info.kind === 'square') {
      const block = map.blocks[info.block];
      return { ...info, index, kerb: block.kerb, lawn: block.inner, square: true };
    }
    const kerbLine = offsetPolygon(info.polygon, (a, b) => -halfWidthNear(a, b));
    const { polygon: kerb, patches } = kerbLine.length >= 3 ? roundCorners(kerbLine, KERB_RADIUS) : { polygon: [], patches: [] };
    cornerPatches.push(...patches);
    if (kerb.length >= 3) pavement.add(kerb, { kind: 'park', park: index });
    return { ...info, index, kerb, lawn: kerb.length >= 3 ? offsetPolygon(kerb, -SIDEWALK * .6) : [] };
  });
  // The promenade outside the ring road, where the city stops at the sea
  for (const road of map.roads) {
    if (road.kind === 'ring') quays.push({ points: offsetPolylineClean(road.points, -(road.profile.halfWidth + QUAY / 2)), halfWidth: QUAY / 2, road });
  }
  // Walks along one side of a road stop wherever another road crosses them
  // and never onto a carriageway, however the offset bends: every road they
  // overlap is cut out of them
  const carriageways = new Map();
  const carriageway = road => { if (!carriageways.has(road)) carriageways.set(road, bufferPolyline(road.points, road.profile.halfWidth)); return carriageways.get(road); };
  const walks = quays.flatMap(quay => crossingFree(map.roadIndex, quay.points, quay.halfWidth, quay.road).flatMap(points => {
    const polygon = bufferPolyline(points, quay.halfWidth), bounds = polygonBounds(polygon), roads = new Set();
    map.roadIndex.each((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2 + 12, segment => {
      if (segment.road.kind !== 'path') roads.add(segment.road);
    });
    return difference([polygon], [...roads].map(carriageway)).filter(piece => calcPolygonArea(piece.outer) > 4).map(piece => ({ ...quay, points, polygon: piece.outer }));
  }));
  for (const walk of walks) pavement.add(walk.polygon, { kind: 'quay' });
  return {
    ...map, minX, minY, maxX, maxY, margin,
    land, seaWater, riverWater, riverCentre, shores, walls, quays: walks, mask, downtown, inRiver, parks: map.parks, parkPlans: parks,
    pavement, cornerPatches, districtNames: names, styleName,
    cell: CITY_CELL,
    ix0: Math.floor(-CITY_WIDTH / 2 / CITY_CELL), ix1: Math.floor((CITY_WIDTH / 2 - 1e-6) / CITY_CELL),
    iz0: Math.floor(-CITY_HEIGHT / 2 / CITY_CELL), iz1: Math.floor((CITY_HEIGHT / 2 - 1e-6) / CITY_CELL),
  };
}

export const CITY = buildCity(SEED);

const downtownDistance = (s, u) => Math.hypot(u - CITY.downtown.u, s - CITY.downtown.s) / Math.max(1, CITY.downtown.radius);
// The district whose style a point's architecture follows
export function cityStyleDistrict(s, u) {
  return CITY.styleName(CITY.districtAt(u, s), downtownDistance(s, u));
}
// The district name for the HUD: the waterfront is named for its water
export function cityDistrict(s, u) {
  if (downtownDistance(s, u) < DOWNTOWN * .9) return 'Downtown';
  if (CITY.mask.at(u + 60, s) || CITY.mask.at(u - 60, s) || CITY.mask.at(u, s + 60) || CITY.mask.at(u, s - 60)) return nearSea(s, u) ? 'Harbour' : 'Riverfront';
  return cityStyleDistrict(s, u);
}
function nearSea(s, u) {
  for (const [du, ds] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) if (CITY.mask.at(u + du, s + ds) && !CITY.inRiver({ x: u + du, y: s + ds })) return true;
  return false;
}
export function cityCell(s, u) {
  const ix = Math.floor(u / CITY_CELL), iz = Math.floor(s / CITY_CELL);
  return { ix, iz, key: `${ix},${iz}` };
}
export const profileOf = kind => ROAD_PROFILES[kind] ?? ROAD_PROFILES.minor;
export { averagePoint, calcPolygonArea, RoadIndex };
