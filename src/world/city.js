import Vector from '../mapgen/vector.js';
import { SEED } from './route.js';
import { generateCityMap, carriagewayScore, ROAD_PROFILES, SIDEWALK } from '../mapgen/generate.js';
import { FIELD_TYPE } from '../mapgen/basis-field.js';
import { shoreRuns } from '../mapgen/shore.js';
import { difference, intersection, region, solids, growRound, union, clean, strictly } from '../mapgen/booleans.js';
import { endJoints, slicePolyline } from '../mapgen/road-network.js';
import { simplify } from '../mapgen/simplify.js';
import { insidePolygon, offsetPolylineClean, bufferPolyline, averagePoint, calcPolygonArea,
  offsetPolygon, polygonBounds, distanceToPolyline, signedArea, dedupePolygon, polylineLength } from '../mapgen/polygon-util.js';

// One city per visit, generated from the URL seed: roads, water, blocks and
// lots come from the MapGenerator port, and this module derives the surfaces
// the game stands on from them, once, so the renderer, the tyres and the
// street furniture all agree: the water and the quays round it, the kerbs with
// their rounded corners, the districts and a spatial index that says whether
// a point is pavement or roadway.
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

// The city has one district of each character, each a single piece of it
// (see layDistricts in mapgen/generate.js); Midtown is round downtown, as is
// downtown itself (the radial field).
export const DISTRICT_STYLES = ['Old town', 'Garden quarter', 'Warehouse district', 'Market district', 'Civic quarter'];
// Where each would rather be: near (-) or far from (+) downtown and the water.
// The old town and the civic quarter grew up by the centre, the warehouses by
// the water, the garden quarter out where it's quiet.
const DISTRICT_PREFER = {
  'Old town': { downtown: -1, water: -.4 }, 'Civic quarter': { downtown: -.8, water: 0 },
  'Market district': { downtown: -.3, water: -.2 }, 'Warehouse district': { downtown: .4, water: -1 },
  'Garden quarter': { downtown: 1, water: .5 },
};
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
// A kerb can have hundreds of corners, but only the few edges near a cell can
// change the answer for a point in it (insidePolygon's ray runs off in +x).
// Once the polygons are final (the city trims some promenades in place after
// indexing them), seal() keeps just those edges in each cell, the same way
// round, so the answer is the same and much quicker to reach.
export class PolygonIndex {
  constructor(cell = 32) { this.cell = cell; this.cells = new Map(); this.sealed = false; }
  add(polygon, value) {
    if (polygon.length < 3) return;
    const b = polygonBounds(polygon);
    for (let cx = Math.floor(b.minX / this.cell); cx <= Math.floor(b.maxX / this.cell); cx++) {
      for (let cy = Math.floor(b.minY / this.cell); cy <= Math.floor(b.maxY / this.cell); cy++) {
        const key = cx * 65536 + cy, entry = { polygon, value, b, cx, cy, edges: null };
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(entry);
        if (this.sealed) this.cellEdges(entry);
      }
    }
  }
  seal() {
    for (const list of this.cells.values()) for (const entry of list) this.cellEdges(entry);
    this.sealed = true;
  }
  // (with a metre's margin round the cell for rounding at its edges)
  cellEdges(entry) {
    const { polygon, cx, cy } = entry, n = polygon.length, edges = [];
    const x0 = cx * this.cell - 1, y0 = cy * this.cell - 1, y1 = (cy + 1) * this.cell + 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = polygon[i], c = polygon[j];
      if (Math.max(a.x, c.x) < x0 || Math.max(a.y, c.y) < y0 || Math.min(a.y, c.y) > y1) continue;
      edges.push(a.x, a.y, c.x, c.y);
    }
    entry.edges = new Float64Array(edges);
  }
  find(x, y) {
    const list = this.cells.get(Math.floor(x / this.cell) * 65536 + Math.floor(y / this.cell));
    if (!list) return null;
    for (const { polygon, value, b, edges } of list) {
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (!edges) { if (insidePolygon({ x, y }, polygon)) return value; continue; }
      // insidePolygon, over this cell's edges
      let inside = false;
      for (let k = 0; k < edges.length; k += 4) {
        const xi = edges[k], yi = edges[k + 1], xj = edges[k + 2], yj = edges[k + 3];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return value;
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
  const total = polylineLength(points), out = [];
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

// A box `margin` metres clear of a polyline all round, and whether a polygon's bounds reach into one
const boxAround = (points, margin) => {
  const b = polygonBounds(points);
  return [{ x: b.minX - margin, y: b.minY - margin }, { x: b.maxX + margin, y: b.minY - margin }, { x: b.maxX + margin, y: b.maxY + margin }, { x: b.minX - margin, y: b.maxY + margin }];
};
const overlapsBox = (polygon, box) => { const b = polygonBounds(polygon); return b.maxX > box[0].x && b.minX < box[1].x && b.maxY > box[0].y && b.minY < box[2].y; };

// Bridge decks: all that is paved over the water round the bridges (their
// carriageways and footways, the corners of a junction out over the water, a
// promenade carried on across a river's mouth), one outline to a crossing,
// so its edges, underside, piers and railings follow what is really there.
// Each stretch of its edge over the water is a run, the water on its right;
// the rest of its edge is the shore, where the paving carries on over land.
// `around` gives a box round a bridge and the paving that reaches into it.
function layDecks(bridges, land, around) {
  const landRings = land.flatMap(piece => [piece.outer, ...piece.holes]);
  // (whether a shape comes within a few centimetres of the shore)
  const nearLand = shape => {
    const b = polygonBounds(shape), m = .1;
    return landRings.some(ring => ring.some((a, i) => {
      const c = ring[(i + 1) % ring.length];
      if (Math.max(a.x, c.x) < b.minX - m || Math.min(a.x, c.x) > b.maxX + m || Math.max(a.y, c.y) < b.minY - m || Math.min(a.y, c.y) > b.maxY + m) return false;
      return shape.some(p => distanceToPolyline(p, [a, c]) < m);
    }));
  };
  // (the water as whatever is not land: where the sea and the river meet,
  // the millimetres can leave a seam between them. Each piece of paving over
  // it is found on its own, and they are joined strictly: all the paving at
  // once is slow, and its hairline gaps can ring round the water between two
  // bridges, which the plain result fills in. Not the hairlines a paving's
  // edge leaves along the shore, a few centimetres wide on average, which
  // would only slow the joining.)
  const perimeter = ring => ring.reduce((sum, p, i) => sum + Math.hypot(ring[(i + 1) % ring.length].x - p.x, ring[(i + 1) % ring.length].y - p.y), 0);
  const overWater = (paved, area) => {
    const water = region(difference(area, landRings));
    const pieces = paved.flatMap(polygon => intersection(solids([polygon]), water)).filter(piece => 2 * calcPolygonArea(piece.outer) / perimeter(piece.outer) > .25);
    return strictly.union(region(pieces));
  };
  const boxes = [], near = new Set();
  for (const bridge of bridges) {
    // (in a box round the bridge, grown while what it finds runs on out of
    // it, as a road crossing the water at a slant carries its edge on past
    // where its middle reaches the bank)
    for (let grown = 0; ; grown++) {
      const { box, paved } = around(bridge, grown * 40), b = polygonBounds(box);
      const wide = growRound(region(growRound(region(overWater(paved, [box])), -.25)), .25);
      if (grown < 3 && wide.some(piece => { const q = polygonBounds(piece.outer); return q.minX < b.minX + .5 || q.maxX > b.maxX - .5 || q.minY < b.minY + .5 || q.maxY > b.maxY - .5; })) continue;
      boxes.push(box);
      for (const polygon of paved) near.add(polygon);
      break;
    }
  }
  // (then all the boxes at once: where two overlap, a stretch of water the
  // paving rings round would be counted twice over and filled in)
  const wet = overWater([...near], region(strictly.union(solids(boxes))));
  const paving = [...near].map(polygon => ({ polygon, bounds: polygonBounds(polygon) }));
  const inPaved = p => paving.some(({ polygon, bounds: b }) => p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY && insidePolygon(p, polygon));
  const decks = [];
  for (const piece of wet) {
    // Not the hairline a promenade's edge leaves along the shore, a few
    // centimetres out over the water: what is too narrow to stand on and
    // runs on for metres is left to the quay; nor a spike of paving out over
    // the water. (But not the sharp corner where an edge meets the shore at a
    // slant, nor the centimetres an outline sampled a little differently
    // bulges out along an edge: neither stands out far from the rest.)
    const rings = [piece.outer, ...piece.holes], opened = region(growRound(region(growRound(rings, -.2)), .2));
    const edges = opened.flatMap(ring => ring.map((a, i) => [a, ring[(i + 1) % ring.length]]));
    const standsOut = scrap => {
      const b = polygonBounds(scrap.outer), near = edges.filter(([a, c]) => Math.max(a.x, c.x) > b.minX - 1 && Math.min(a.x, c.x) < b.maxX + 1 && Math.max(a.y, c.y) > b.minY - 1 && Math.min(a.y, c.y) < b.maxY + 1);
      return scrap.outer.some(p => near.every(edge => distanceToPolyline(p, edge) > .4));
    };
    const needles = strictly.difference(rings, opened).filter(scrap => {
      const b = polygonBounds(scrap.outer);
      return standsOut(scrap) && (Math.hypot(b.maxX - b.minX, b.maxY - b.minY) > 3 || !nearLand(scrap.outer));
    });
    // (and the notches where two pieces of paving meet a little out of line
    // closed over, the coping covering them; nor the spikes and pinholes
    // where two pavings' outlines all but meet)
    const trimmed = needles.length ? region(strictly.difference(rings, region(needles))) : rings;
    // (true to the millimetre, and never inside the paving it closes over)
    const closed = growRound(region(growRound(trimmed, .6, .005)), -.6, .005);
    for (const deck of clean(strictly.union(region(closed), trimmed), .02)) {
      if (calcPolygonArea(deck.outer) < 4) continue;
      const holes = deck.holes.filter(hole => calcPolygonArea(hole) > 2), runs = [];
      for (const ring of [deck.outer, ...holes]) {
        // (an edge is over the water where, just beyond it, nothing is paved;
        // and so is a nick less than a metre across between two such edges)
        const n = ring.length, open = ring.map((a, i) => {
          const b = ring[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          return !inPaved({ x: (a.x + b.x) / 2 + (b.y - a.y) / l * .1, y: (a.y + b.y) / 2 - (b.x - a.x) / l * .1 });
        });
        for (let i = 0; i < n; i++) {
          if (open[i] || !open[(i - 1 + n) % n]) continue;
          let j = i;
          while (!open[j % n] && j < i + n) j++;
          if (Math.hypot(ring[j % n].x - ring[i].x, ring[j % n].y - ring[i].y) < 1) for (let k = i; k < j; k++) open[k % n] = true;
        }
        if (open.every(Boolean)) { runs.push({ points: simplify([...ring, ring[0]], .05).slice(0, -1), closed: true }); continue; }
        // (each from the end of a stretch of shore to the start of the next;
        // cleared of the centimetre steps where two outlines all but meet)
        const start = open.findIndex((isOpen, i) => isOpen && !open[(i - 1 + n) % n]);
        let run = null;
        for (let k = 0; k <= n; k++) {
          const i = (start + k) % n;
          if (k < n && open[i]) (run ??= [ring[i]]).push(ring[(i + 1) % n]);
          else if (run) { runs.push({ points: simplify(run, .05), closed: false }); run = null; }
        }
      }
      decks.push({ outer: deck.outer, holes, runs: runs.filter(run => polylineLength(run.points) > .5) });
    }
  }
  return decks;
}

export function buildCity(seed = SEED) {
  const styleName = (district, downtown) => downtown < DOWNTOWN ? 'Midtown' : district ?? 'Market district';
  const map = generateCityMap({ seed, width: CITY_WIDTH, height: CITY_HEIGHT,
    districts: { styles: DISTRICT_STYLES, downtown: 'Midtown', prefer: DISTRICT_PREFER, winding: { 'Old town': OLD_TOWN_NOISE } },
    lots: { style: (centre, district, downtown) => ({ ...LOT_STYLES[styleName(district, downtown)] }) },
    streets: { style: (point, district, downtown) => STREET_STYLES[styleName(district, downtown)] } });
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
  const radial = map.field.getBasisFields().find(field => field.FIELD_TYPE === FIELD_TYPE.Radial);
  const downtown = radial ? { u: radial.centre.x, s: radial.centre.y, radius: radial._size } : { u: 0, s: 0, radius: 300 };

  // Kerbs: every block's pavement edge with its junction corners rounded, and
  // the slivers of roadway the rounding gives back to the junction
  const pavement = new PolygonIndex(), cornerPatches = [];
  map.blocks.forEach((block, index) => {
    block.index = index;
    const centre = averagePoint(block.inner.length >= 3 ? block.inner : block.polygon);
    block.style = styleName(block.district, Math.hypot(centre.x - downtown.u, centre.y - downtown.s) / Math.max(1, downtown.radius));
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
    // Not the carriageways, the walks already there or the blocks inland, and
    // only on land (or, where the two roads meet out on a bridge, over the
    // water too, between the two promenades: the deck carries it, see layDecks)
    const bounds = polygonBounds(joint), near = polygon => { const b = polygonBounds(polygon); return b.maxX > bounds.minX && b.minX < bounds.maxX && b.maxY > bounds.minY && b.minY < bounds.maxY; };
    const nearWalks = walks.map(walk => walk.polygon).filter(near);
    const covered = [...roadsNear(joint).map(carriageway), ...map.joints, ...nearWalks, ...map.blocks.map(block => block.polygon).filter(near)];
    const free = difference([joint], solids(covered)), centre = averagePoint(joint);
    const joins = piece => intersection(region(growRound([piece.outer], .05)), solids(nearWalks)).some(touch => calcPolygonArea(touch.outer) > .01);
    const wedge = mask.at(centre.x, centre.y) ? free.filter(joins) : intersection(region(free), region(land));
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
  // (worked out a tile at a time, each against only what reaches it, and the
  // pieces joined up again: the whole island at once is slow, every kerb
  // sharing its edges with a carriageway)
  const bare = [], boxes = covered.map(polygonBounds), landBounds = polygonBounds(land.flatMap(piece => piece.outer)), TILE = 300;
  for (let x0 = landBounds.minX; x0 < landBounds.maxX; x0 += TILE) for (let y0 = landBounds.minY; y0 < landBounds.maxY; y0 += TILE) {
    const x1 = x0 + TILE, y1 = y0 + TILE, tile = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const inTile = intersection(land.map(piece => piece.outer), [tile]);
    if (inTile.length) bare.push(...difference(region(inTile), land.flatMap(piece => piece.holes), covered.filter((ring, i) => boxes[i].maxX > x0 && boxes[i].minX < x1 && boxes[i].maxY > y0 && boxes[i].minY < y1)));
  }
  for (const piece of union(region(bare))) {
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
      if (hi - lo < 4) return [];
      const line = samples.slice(Math.max(0, lo - 1), Math.min(samples.length, hi + 2));
      // (and never out past the roads' edges, where one meets another end to
      // end at an angle and the footway carried on would stand over the water)
      const strip = bufferPolyline(line, width / 2), box = boxAround(strip, 1), near = polygon => overlapsBox(polygon, box);
      const within = intersection([strip], solids([carriageway(bridge.road), ...bridge.others, ...cornerPatches.filter(near)]));
      const polygon = difference(region(within), region(others)).sort((p, q) => calcPolygonArea(q.outer) - calcPolygonArea(p.outer))[0]?.outer;
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
  const decks = layDecks(bridges, land, (bridge, more) => {
    const box = boxAround(bridge.points, bridge.road.profile.halfWidth + QUAY + 8 + more), near = polygon => overlapsBox(polygon, box);
    return { box, paved: [...roadsNear(box).map(carriageway), ...cornerPatches.filter(near), ...walks.map(walk => walk.polygon).filter(near),
      ...bridges.flatMap(other => other.footways.map(footway => footway.polygon)).filter(near)] };
  });
  pavement.seal();
  return {
    ...map, minX, minY, maxX, maxY, margin,
    land, seaWater, riverWater, riverCentre, shores, walls, quays: walks, mask, downtown, inRiver, parks: map.parks, parkPlans: parks,
    pavement, cornerPatches, bridges, decks, styleName,
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
