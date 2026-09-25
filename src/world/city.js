import Vector from '../mapgen/vector.js';
import { SEED, randomAt } from './route.js';
import { generateCityMap, carriagewayScore, ROAD_PROFILES, SIDEWALK } from '../mapgen/generate.js';
import { RoadIndex } from '../mapgen/road-index.js';
import { shoreRuns } from '../mapgen/shore.js';
import { difference, intersection, region, solids, growRound, union, clean } from '../mapgen/booleans.js';
import { endJoints, slicePolyline } from '../mapgen/road-network.js';
import { insidePolygon, offsetPolylineClean, bufferPolyline, averagePoint, calcPolygonArea,
  offsetPolygon, polygonBounds, distanceToPolyline, signedArea, dedupePolygon } from '../mapgen/polygon-util.js';

// One city per visit, generated from the URL seed the way citydriver's grid
// was: roads, water, blocks and lots come from the MapGenerator port, and this
// module derives the surfaces the game stands on from them, once, so the
// renderer, the tyres and the street furniture all agree: the water and the
// quays round it, the kerbs with their rounded corners, the districts and a
// spatial index that says whether a point is pavement or roadway.
export const CITY_WIDTH = 2880, CITY_HEIGHT = 2160, CITY_MARGIN = 800, CITY_CELL = 160;
// Promenade between a waterside road's kerb and the water
export const QUAY = 6;
// Kerb corners at junctions are rounded to this radius
export const KERB_RADIUS = 5.5;
// A bridge's footway, at most; and the most a kerb corner rounded to the
// full radius may take (a right angle takes about 6.5 m²), beyond which it is
// a sharp wedge and rounded tightly
// (the narrowest a promenade may be anywhere along it)
const BRIDGE_FOOTWAY = 2.6, SHARP_FILLET = 24, THIN = .4;
// Points every `step` metres along a polyline, with the unit tangent
function samplePolyline(points, step) {
  const out = [];
  let next = 0, travelled = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) continue;
    const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
    for (; next <= travelled + length; next += step) out.push({ x: a.x + tx * (next - travelled), y: a.y + ty * (next - travelled), tx, ty, distance: next });
    travelled += length;
  }
  return out;
}
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
// The old town's streets wind: rotational noise over its part of the field
const OLD_TOWN_NOISE = { angle: 30, size: 300 };

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

// A promenade piece's length: four lamps' spacing, so they stay evenly spaced
const WALK_PIECE = 108;
// A polyline cut every `length` metres. Each cut falls inside a segment, so
// the pieces' square ends meet exactly.
function inPieces(points, length) {
  const total = points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(points[i]), 0), out = [];
  for (let from = 0; from < total; from += length) {
    const to = total - (from + length) < 1 ? total : from + length, piece = slicePolyline(points, from, to);
    if (piece.length > 1) out.push(piece);
    if (to === total) break;
  }
  return out;
}

// The runs of a walk beside `own` that no other road crosses. A street ending
// at `own` ends square across it, so the walk runs on past a T-junction.
function crossingFree(roadIndex, points, halfWidth, own, step = 2) {
  const runs = [];
  let run = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], length = a.distanceTo(b), count = Math.max(1, Math.ceil(length / step));
    for (let k = i ? 1 : 0; k <= count; k++) {
      const p = a.clone().add(b.clone().sub(a).multiplyScalar(k / count));
      const hit = roadIndex.nearest(p.x, p.y, 20, (segment, distance, t, x, y) => segment.road === own ? Infinity : carriagewayScore(segment, distance, t, x, y));
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
  // (the four grid fields take the first four styles, so a city may have no old town)
  const oldTown = names.indexOf('Old town');
  const map = generateCityMap({ seed, width: CITY_WIDTH, height: CITY_HEIGHT,
    noise: { districts: oldTown < 4 ? [{ index: oldTown, ...OLD_TOWN_NOISE }] : [] },
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
  const carriageways = new Map();
  const carriageway = road => { if (!carriageways.has(road)) carriageways.set(road, bufferPolyline(road.points, road.profile.halfWidth)); return carriageways.get(road); };
  // The roads (not park walks) near a polygon
  const roadsNear = polygon => {
    const bounds = polygonBounds(polygon), roads = new Set();
    map.roadIndex.each((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2 + 12, segment => {
      if (segment.road.kind !== 'path') roads.add(segment.road);
    });
    return [...roads];
  };
  const parks = map.parkInfo.map((info, index) => {
    if (info.kind === 'square') {
      const block = map.blocks[info.block];
      return { ...info, index, kerb: block.kerb, lawn: block.inner, square: true };
    }
    // The park less the carriageways round it, as they are drawn (square
    // ended, with their joints), so its kerb follows them however their
    // widths change round it
    const kerbLine = difference([info.polygon], solids([...roadsNear(info.polygon).map(carriageway), ...map.joints]))
      .reduce((best, piece) => !best || calcPolygonArea(piece.outer) > calcPolygonArea(best) ? piece.outer : best, null) ?? [];
    const { polygon: kerb, patches } = kerbLine.length >= 3 ? roundCorners(kerbLine, KERB_RADIUS) : { polygon: [], patches: [] };
    cornerPatches.push(...patches);
    if (kerb.length >= 3) pavement.add(kerb, { kind: 'park', park: index });
    return { ...info, index, kerb, lawn: kerb.length >= 3 ? offsetPolygon(kerb, -SIDEWALK * .6) : [] };
  });
  // and the joints where one road carries on as another (see endJoints)
  cornerPatches.push(...map.joints);
  // The promenade outside the ring road, where the city stops at the sea
  for (const road of map.roads) {
    if (road.kind === 'ring') quays.push({ points: offsetPolylineClean(road.points, -(road.profile.halfWidth + QUAY / 2)), halfWidth: QUAY / 2, road });
  }
  // Walks along one side of a road stop wherever another road crosses them
  // and never onto a carriageway, however the offset bends: every road they
  // overlap is cut out of them
  // (in pieces of a few lamps' spacing, so asking what is underfoot never
  // walks a promenade the length of the city)
  const walks = quays.flatMap(quay => crossingFree(map.roadIndex, quay.points, quay.halfWidth, quay.road).flatMap(run => inPieces(run, WALK_PIECE)).flatMap(points => {
    const polygon = bufferPolyline(points, quay.halfWidth);
    return difference([polygon], solids(roadsNear(polygon).map(carriageway))).filter(piece => calcPolygonArea(piece.outer) > 4).map(piece => ({ ...quay, points, polygon: piece.outer }));
  }));
  // Where the ring and the coast road meet end to end the two promenades end
  // square: the wedge between them is promenade too
  const quayRoads = new Set(quays.map(quay => quay.road));
  for (const joint of endJoints(map.roads.filter(road => quayRoads.has(road)), road => road.profile.halfWidth + QUAY)) {
    // Not the carriageways, the walks already there or the blocks inland, and only on land
    const bounds = polygonBounds(joint), near = polygon => { const b = polygonBounds(polygon); return b.maxX > bounds.minX && b.minX < bounds.maxX && b.maxY > bounds.minY && b.minY < bounds.maxY; };
    const covered = [...roadsNear(joint).map(carriageway), ...map.joints, ...walks.map(walk => walk.polygon).filter(near), ...map.blocks.map(block => block.polygon).filter(near)];
    const wedge = intersection(region(difference([joint], solids(covered))), region(land));
    for (const piece of wedge) if (calcPolygonArea(piece.outer) > 1 && !piece.holes.length) walks.push({ points: [], halfWidth: QUAY / 2, polygon: piece.outer, road: null });
  }
  // Whatever land is left bare once the blocks, parks, carriageways and
  // promenades are laid is finished: on the waterfront (where a promenade
  // stops short of a road that crosses it, at a bridge's end, or cuts a
  // corner round a bend) it is paved as promenade, so the pavement always
  // meets the kerb of the road; inland (a sliver in the middle of a junction
  // where two roads meet end to end at an angle) it is carriageway
  const perimeter = ring => ring.reduce((sum, p, i) => sum + Math.hypot(ring[(i + 1) % ring.length].x - p.x, ring[(i + 1) % ring.length].y - p.y), 0);
  // (a shape no wider on average than a few centimetres)
  const hairline = ring => calcPolygonArea(ring) < .05 || 2 * calcPolygonArea(ring) / perimeter(ring) < .08;
  // Whether a scrap of ground lies against a carriageway, so that handed to
  // the road it joins one (and never paves a strip along the water's edge)
  const touchesRoad = ring => {
    const b = polygonBounds(ring), near = polygon => { const q = polygonBounds(polygon); return q.maxX > b.minX - 1 && q.minX < b.maxX + 1 && q.maxY > b.minY - 1 && q.minY < b.maxY + 1; };
    return intersection(region(growRound([ring], .05)), solids([...roadsNear(ring).map(carriageway), ...cornerPatches.filter(near)])).some(touch => calcPolygonArea(touch.outer) > .001);
  };
  const covered = solids([...map.blocks.map(block => block.kerb), ...parks.filter(park => !park.square).map(park => park.kerb),
    ...map.roads.filter(road => road.kind !== 'path').map(carriageway), ...cornerPatches, ...walks.map(walk => walk.polygon)]);
  for (const piece of difference(land.map(piece => piece.outer), land.flatMap(piece => piece.holes), covered)) {
    // (a piece round something else would be paved over it; a scrap a few
    // square metres across against a road, the notch where two roads meet
    // end to end at an angle, is carriageway)
    // (and a hairline, where two outlines differ by a rounding, just closes
    // the seam)
    if (piece.holes.length) continue;
    if (hairline(piece.outer)) { cornerPatches.push(piece.outer); continue; }
    const waterside = piece.outer.some(p => mask.at(p.x + 2, p.y) || mask.at(p.x - 2, p.y) || mask.at(p.x, p.y + 2) || mask.at(p.x, p.y - 2));
    if (!waterside || (calcPolygonArea(piece.outer) < 4 && touchesRoad(piece.outer))) { cornerPatches.push(piece.outer); continue; }
    walks.push({ points: [], halfWidth: QUAY / 2, polygon: piece.outer, road: null, filler: true });
  }
  for (const walk of walks) pavement.add(walk.polygon, { kind: 'quay', road: walk.road });
  // Bridges: each run of a road over the water, carried a few metres onto the
  // banks, with a raised footway along both edges of its deck (where the road
  // has room outside its lanes) that meets the promenades and pavements at
  // either end, so a walk along the quay carries on over the water
  const bridges = [];
  for (const road of map.roads) {
    if (road.kind === 'path') continue;
    let run = null;
    // (with how far along its road the run over the water starts and ends)
    const flush = () => { if (run?.length > 2) bridges.push({ road, points: run, from: run[0].distance, to: run.at(-1).distance }); run = null; };
    for (const p of samplePolyline(road.points, 3)) { if (mask.at(p.x, p.y)) (run ??= []).push(p); else flush(); }
    flush();
  }
  for (const bridge of bridges) {
    // (along the road itself, bending as it does, not straight on past its ends)
    const profile = bridge.road.profile;
    bridge.points = slicePolyline(bridge.road.points, Math.max(0, bridge.from - 5), bridge.to + 5);
    bridge.width = Math.min(BRIDGE_FOOTWAY, profile.halfWidth - profile.lane - 1.9);
    bridge.others = roadsNear(bufferPolyline(bridge.points, profile.halfWidth + 20)).filter(road => road !== bridge.road).map(carriageway);
  }
  // Each footway runs over the water and on across the bank, beside the end
  // of any promenade the road cuts through, to the carriageway of the road
  // along the bank, where it joins the promenade in one pavement. It is laid
  // twice: the second time it runs on over the other roads' footways (where
  // two bridges meet over the water) and stops only at their lanes, so the
  // footways of the two meet in one corner.
  const layFootways = (bridge, lanesOf) => {
    const profile = bridge.road.profile, width = bridge.width, others = lanesOf(bridge);
    const onOther = p => others.some(piece => insidePolygon(p, piece.outer) && !piece.holes.some(hole => insidePolygon(p, hole)));
    return width < 1.5 ? [] : [-1, 1].flatMap(side => {
      // (along the road from a little before the bridge to a little after it,
      // so it can run on over the bank as far as the next road)
      const reach = slicePolyline(bridge.road.points, Math.max(0, bridge.from - 30), bridge.to + 30);
      const samples = samplePolyline(offsetPolylineClean(reach, side * (profile.halfWidth - width / 2)), 1), middle = Math.round((Math.min(30, bridge.from) + (bridge.to - bridge.from) / 2));
      // What lies just outside the road: nothing needs a footway where the
      // road's own promenade already runs beside it; over the water it has one,
      // and on the banks it carries on beside a promenade or the water
      const outside = p => { const out = { x: p.x - p.ty * side * (width / 2 + 1.5), y: p.y + p.tx * side * (width / 2 + 1.5) }; return { walk: pavement.find(out.x, out.y), water: mask.at(out.x, out.y) }; };
      const keep = samples.map(p => {
        if (onOther(p)) return false;
        const { walk, water } = outside(p);
        if (walk?.kind === 'quay' && walk.road === bridge.road) return false;
        return mask.at(p.x, p.y) || water || walk?.kind === 'quay';
      });
      // the run kept over the middle of the bridge, carried a metre on at each
      // end and cut back to the other roads' kerbs exactly
      let lo = Math.min(middle, samples.length - 1), hi = lo;
      if (!keep[lo]) return [];
      while (lo > 0 && keep[lo - 1]) lo--;
      while (hi < keep.length - 1 && keep[hi + 1]) hi++;
      const best = [lo, hi];
      if (best[1] - best[0] < 4) return [];
      const line = samples.slice(Math.max(0, best[0] - 1), Math.min(samples.length, best[1] + 2));
      const polygon = difference([bufferPolyline(line, width / 2)], region(others)).sort((p, q) => calcPolygonArea(q.outer) - calcPolygonArea(p.outer))[0]?.outer;
      return polygon ? [{ side, line, width, polygon }] : [];
    });
  };
  for (const bridge of bridges) bridge.footways = layFootways(bridge, bridge => union(solids(bridge.others)));
  const first = new Map(bridges.map(bridge => [bridge, bridge.footways]));
  // (the whole of the band each footway of the other bridges runs in, so the
  // corner between two footways is paved from both sides)
  const bands = bridge => first.get(bridge).map(footway => bufferPolyline(offsetPolylineClean(bridge.points, footway.side * (bridge.road.profile.halfWidth - footway.width / 2)), footway.width / 2 + .05));
  for (const bridge of bridges) bridge.footways = layFootways(bridge, bridge => difference(solids(bridge.others), solids(bridges.filter(other => other !== bridge).flatMap(bands))));
  for (const bridge of bridges) { delete bridge.others; delete bridge.width; }
  // Where a footway meets the promenade along the bank, the corner the two
  // make at the junction is rounded as every kerb corner is: the carriageways
  // round each bridge's ends are closed by the kerb radius, and whatever of
  // the footway or the promenade that fills is handed back to the road
  for (const bridge of bridges) for (const end of [bridge.points[0], bridge.points.at(-1)]) {
    const r = 32, box = [{ x: end.x - r, y: end.y - r }, { x: end.x + r, y: end.y - r }, { x: end.x + r, y: end.y + r }, { x: end.x - r, y: end.y + r }];
    const within = polygon => polygon.some(p => Math.abs(p.x - end.x) < r + 40 && Math.abs(p.y - end.y) < r + 40);
    const footways = bridges.flatMap(other => other.footways).filter(footway => within(footway.polygon));
    if (!footways.length) continue;
    // (not the hairlines that close a seam between a kerb and the road: grown
    // by the radius, one along the water's side of a promenade would make the
    // whole promenade a notch to fill)
    const roads = intersection(solids([box]), solids([...roadsNear(box).map(carriageway), ...cornerPatches.filter(patch => within(patch) && !hairline(patch))]));
    // (the footways a little grown: the carriageway and a footway are offsets
    // of the road's line sampled differently, and would leave a hair of road
    // outside the footway for the closing to fill the footway from)
    // (and only the roadway itself: not a scrap of road the footways leave
    // cut off by the water, which would make the corner beside it a notch)
    const carriage = difference(region(roads), region(growRound(solids(footways.map(footway => footway.polygon)), .15))).filter(piece => calcPolygonArea(piece.outer) > 30);
    // (not the slivers the arcs leave along a gently bending kerb; and a
    // sharp wedge of pavement, which the full radius would shave for tens of
    // metres back to the quay, is rounded tightly at its tip)
    const fillets = radius => difference(region(intersection(region(growRound(region(growRound(region(carriage), radius)), -radius)), solids([box]))), region(carriage)).filter(piece => calcPolygonArea(piece.outer) > 1);
    const wide = fillets(KERB_RADIUS), sharp = wide.filter(piece => calcPolygonArea(piece.outer) > SHARP_FILLET);
    const corners = [...wide.filter(piece => calcPolygonArea(piece.outer) <= SHARP_FILLET), ...(sharp.length ? intersection(region(fillets(1.5)), region(sharp)) : [])];
    if (!corners.length) continue;
    const cut = region(corners), nearby = [...footways, ...walks.filter(walk => within(walk.polygon))];
    for (const piece of nearby) {
      const pieces = difference(solids([piece.polygon]), cut).filter(part => !part.holes.length).sort((p, q) => calcPolygonArea(q.outer) - calcPolygonArea(p.outer)), rest = pieces[0]?.outer;
      if (!rest || Math.abs(pieces.reduce((sum, part) => sum + calcPolygonArea(part.outer), 0) - calcPolygonArea(piece.polygon)) < .01) continue;
      // (a promenade the corner cuts in two is two promenades; a footway keeps its length)
      if (!piece.line) for (const part of pieces.slice(1)) if (calcPolygonArea(part.outer) > .05) { const walk = { ...piece, points: [], polygon: part.outer }; walks.push(walk); pavement.add(walk.polygon, { kind: 'quay', road: walk.road }); }
      for (const patch of intersection(solids([piece.polygon]), cut)) if (calcPolygonArea(patch.outer) > .05) cornerPatches.push(patch.outer);
      piece.polygon.splice(0, piece.polygon.length, ...rest);
    }
  }
  // Where two boundaries all but meet, the booleans leave a promenade a
  // needle (an edge out and straight back) or a wedge too thin to walk, which
  // would stand its kerb out in the road: the needles go, and a wedge
  // against the road that meets no other pavement is handed to it
  for (const walk of walks.slice()) {
    // (cleaned to the millimetre, so no edge that meets a road moves off it)
    const pieces = clean(union(solids([walk.polygon])), .001);
    const bounds = polygonBounds(walk.polygon), near = polygon => { const b = polygonBounds(polygon); return b.maxX > bounds.minX - 1 && b.minX < bounds.maxX + 1 && b.maxY > bounds.minY - 1 && b.minY < bounds.maxY + 1; };
    const neighbours = solids([...walks.filter(other => other !== walk).map(other => other.polygon), ...map.blocks.map(block => block.kerb), ...bridges.flatMap(bridge => bridge.footways.map(footway => footway.polygon))].filter(near));
    const opened = region(growRound(region(growRound(region(pieces), -THIN / 2)), THIN / 2));
    // (a needle, however little ground it covers, whatever it meets; not the
    // crumbs the opening leaves in every corner)
    const needle = scrap => hairline(scrap.outer) && perimeter(scrap.outer) > 1.2;
    const scraps = difference(region(pieces), opened).filter(scrap => needle(scrap) || (calcPolygonArea(scrap.outer) > .05 && touchesRoad(scrap.outer) &&
      !intersection(region(growRound([scrap.outer], .05)), neighbours).some(touch => calcPolygonArea(touch.outer) > .001)));
    if (!scraps.length && pieces.length === 1 && pieces[0].outer.length === walk.polygon.length) continue;
    const kept = (scraps.length ? clean(difference(region(pieces), region(scraps)), .001) : pieces)
      // (a pinhole where a needle met the edge at a point is no hole)
      .filter(piece => piece.holes.every(hole => calcPolygonArea(hole) < .1)).sort((p, q) => calcPolygonArea(q.outer) - calcPolygonArea(p.outer));
    // (a walk that was all needle is gone)
    if (!kept.length) { if (calcPolygonArea(walk.polygon) < 1) { walk.polygon.length = 0; walks.splice(walks.indexOf(walk), 1); } continue; }
    for (const scrap of scraps) cornerPatches.push(scrap.outer);
    for (const part of kept.slice(1)) if (calcPolygonArea(part.outer) > 1) { const extra = { ...walk, points: [], polygon: part.outer }; walks.push(extra); pavement.add(extra.polygon, { kind: 'quay', road: extra.road }); }
    walk.polygon.splice(0, walk.polygon.length, ...kept[0].outer);
  }
  // (a scrap of footway left by the rounding is no walk)
  for (const bridge of bridges) bridge.footways = bridge.footways.filter(footway => calcPolygonArea(footway.polygon) > 20);
  for (const bridge of bridges) for (const footway of bridge.footways) pavement.add(footway.polygon, { kind: 'bridge' });
  return {
    ...map, minX, minY, maxX, maxY, margin,
    land, seaWater, riverWater, riverCentre, shores, walls, quays: walks, mask, downtown, inRiver, parks: map.parks, parkPlans: parks,
    pavement, cornerPatches, bridges, districtNames: names, styleName,
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
