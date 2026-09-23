import Vector from '../mapgen/vector.js';
import { SEED, randomAt } from './route.js';
import { generateCityMap, ROAD_PROFILES } from '../mapgen/generate.js';
import { RoadIndex } from '../mapgen/road-index.js';
import { insidePolygon, offsetPolyline, extendPolyline, splitPolygonByPolyline, bufferPolyline, averagePoint, calcPolygonArea } from '../mapgen/polygon-util.js';
import { simplify } from '../mapgen/simplify.js';

// One city per visit, generated from the URL seed the way citydriver's grid
// was: roads, water, blocks and lots come from the MapGenerator port, and this
// module derives what the game needs on top: the land pieces around the
// water, a water mask for the tyres, quay walls, districts and the start.
export const CITY_WIDTH = 2400, CITY_HEIGHT = 1800, CITY_MARGIN = 800, CITY_CELL = 160;
// Promenade between the coast road's edge and the water.
export const QUAY = 6;
const DISTRICTS = ['Old town', 'Garden quarter', 'Midtown', 'Warehouse district', 'Market district', 'Civic quarter'];

// Which cells are under water, at 4 m, so the car never asks a polygon.
class WaterMask {
  constructor(minX, minY, maxX, maxY, cell = 4) {
    this.minX = minX; this.minY = minY; this.cell = cell;
    this.cols = Math.ceil((maxX - minX) / cell); this.rows = Math.ceil((maxY - minY) / cell);
    this.data = new Uint8Array(this.cols * this.rows);
  }
  fill(polygon) {
    const n = polygon.length;
    for (let row = 0; row < this.rows; row++) {
      const y = this.minY + (row + .5) * this.cell, crossings = [];
      for (let i = 0; i < n; i++) {
        const a = polygon[i], b = polygon[(i + 1) % n];
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
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    return this.data[cy * this.cols + cx] === 1;
  }
}

// Runs of a polyline that border land, for quay walls: a bank carried on into
// the sea would stand as a fin in open water.
function landRuns(line, land, side) {
  const offset = offsetPolyline(line, side * 1.5), runs = [];
  let run = [];
  for (let i = 0; i < line.length; i++) {
    const onLand = land.some(piece => insidePolygon(offset[i], piece));
    if (onLand) run.push(line[i]);
    else if (run.length) { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

export function buildCity(seed = SEED) {
  const map = generateCityMap({ seed, width: CITY_WIDTH, height: CITY_HEIGHT });
  const margin = CITY_MARGIN;
  const minX = -CITY_WIDTH / 2 - margin, minY = -CITY_HEIGHT / 2 - margin, maxX = CITY_WIDTH / 2 + margin, maxY = CITY_HEIGHT / 2 + margin;
  const outer = [new Vector(minX, minY), new Vector(maxX, minY), new Vector(maxX, maxY), new Vector(minX, maxY)];
  let land = [outer];
  const water = [], walls = [];
  let sea = null, seaTest = null, coastEdge = null;
  const coast = map.roads.find(road => road.kind === 'coast');
  if (coast && map.sea.length >= 3) {
    const points = coast.points, middle = Math.floor(points.length / 2), reach = coast.profile.halfWidth + QUAY;
    const side = insidePolygon(offsetPolyline(points, 30)[middle], map.sea) ? 1 : -1;
    const waterLine = extendPolyline(offsetPolyline(points, side * reach), margin * 3);
    seaTest = offsetPolyline(points, side * (reach + 40))[middle];
    const pieces = splitPolygonByPolyline(outer, waterLine);
    const seaPiece = pieces.find(piece => insidePolygon(seaTest, piece));
    if (seaPiece && pieces.length === 2) {
      sea = seaPiece; water.push(sea); land = pieces.filter(piece => piece !== sea); coastEdge = waterLine;
    }
  }
  let river = null, riverCentre = null;
  const banks = [];
  if (map.hasRiver && map.riverStreamline.length > 3) {
    riverCentre = extendPolyline(simplify(map.riverStreamline, 3), margin * 2);
    river = bufferPolyline(riverCentre, map.riverWidth);
    water.push(river);
    const riverTest = riverCentre[Math.floor(riverCentre.length / 2)];
    for (const side of [1, -1]) {
      const bank = offsetPolyline(riverCentre, side * map.riverWidth);
      banks.push({ points: bank, side });
      land = land.flatMap(piece => splitPolygonByPolyline(piece, bank));
    }
    land = land.filter(piece => !insidePolygon(riverTest, piece));
  }
  if (coastEdge) for (const run of landRuns(coastEdge, land, -1)) walls.push(run), walls.push(run.slice().reverse());
  for (const bank of banks) for (const run of landRuns(bank.points, land, -bank.side)) walls.push(run);
  const mask = new WaterMask(minX, minY, maxX, maxY);
  for (const polygon of water) mask.fill(polygon);
  const radial = map.field.getBasisFields().find(field => field.FIELD_TYPE === 0);
  const downtown = radial ? { u: radial.centre.x, s: radial.centre.y, radius: radial._size } : { u: 0, s: 0, radius: 300 };
  return {
    ...map, minX, minY, maxX, maxY, margin,
    land, water, sea, river, riverCentre, banks, walls, mask, downtown,
    cell: CITY_CELL,
    ix0: Math.floor(-CITY_WIDTH / 2 / CITY_CELL), ix1: Math.floor((CITY_WIDTH / 2 - 1e-6) / CITY_CELL),
    iz0: Math.floor(-CITY_HEIGHT / 2 / CITY_CELL), iz1: Math.floor((CITY_HEIGHT / 2 - 1e-6) / CITY_CELL),
  };
}

export const CITY = buildCity(SEED);

export function cityDistrict(s, u) {
  if (Math.hypot(u - CITY.downtown.u, s - CITY.downtown.s) < CITY.downtown.radius * .55) return 'Downtown';
  if (CITY.mask.at(u + 60, s) || CITY.mask.at(u - 60, s) || CITY.mask.at(u, s + 60) || CITY.mask.at(u, s - 60)) return CITY.sea && insidePolygon(new Vector(u, s), CITY.sea) ? 'Harbour' : 'Riverfront';
  const cx = Math.floor(u / 400), cz = Math.floor(s / 400);
  return DISTRICTS[Math.floor(randomAt(cx, cz + 7101, CITY.seed) * DISTRICTS.length)];
}
// The district that decides a lot's architecture; the water names are only for the HUD.
export function cityStyleDistrict(s, u) {
  const district = cityDistrict(s, u);
  if (district === 'Downtown') return 'Midtown';
  if (district === 'Harbour') return 'Warehouse district';
  if (district === 'Riverfront') return 'Old town';
  return district;
}
export function cityCell(s, u) {
  const ix = Math.floor(u / CITY_CELL), iz = Math.floor(s / CITY_CELL);
  return { ix, iz, key: `${ix},${iz}` };
}
export const profileOf = kind => ROAD_PROFILES[kind] ?? ROAD_PROFILES.minor;
export { averagePoint, calcPolygonArea, RoadIndex };
