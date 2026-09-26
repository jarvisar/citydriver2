import Vector from './vector.js';
import { mulberry32, randomRange } from './random.js';
import TensorField from './tensor-field.js';
import { RK4Integrator } from './integrator.js';
import StreamlineGenerator from './streamlines.js';
import WaterGenerator from './water-generator.js';
import Graph from './graph.js';
import PolygonFinder from './polygon-finder.js';
import { FIELD_TYPE } from './basis-field.js';
import { RoadIndex } from './road-index.js';
import { averagePoint, calcPolygonArea, offsetPolygon, insidePolygon, insideIndexed, polygonCentroid, bufferPolyline, polygonBounds, polylineLength } from './polygon-util.js';
import { filletPolyline, closeLoop, ringRoad, clipInside, weldEnds, circuses, cleanNetwork, spreadJunctions, pruneNetwork, joinCorners, easeKinks, endJoints } from './road-network.js';
import { frontageLots, throughLots, chamferAcute } from './lots.js';
import { islandOutline, landAndWater, seaSideOf, roadFootprints } from './shore.js';
import { insetPolygon, difference, solids } from './booleans.js';
import { CLASS_PROFILES, PROFILES, assignProfiles } from './road-hierarchy.js';
import { parkLayout, deepestPoint } from './park-paths.js';
import { infillStreets } from './infill.js';
import GridStorage from './grid-storage.js';

// The whole MapGenerator pipeline in metres, seeded: a tensor field of four
// grids and a radial, a coastline and river, main, major and minor roads,
// parks, a ring road round the edge, then blocks and lots. x runs east and y
// runs north.
//
// Road widths are the game's street profiles (see road-hierarchy.js); the
// generator needs them for setbacks, and the world draws them.
export const ROAD_PROFILES = CLASS_PROFILES;
export const SIDEWALK = 4.2;
// How round each class of road bends, at most, in metres
const BEND_RADIUS = { main: 80, major: 60, minor: 35, path: 14 };

export const DEFAULT_OPTIONS = {
  seed: 1, width: 2880, height: 2160,
  minor: { dsep: 90, dtest: 60, dstep: 4, dlookahead: 160, dcirclejoin: 20, joinangle: .1, pathIterations: 900, seedTries: 300, simplifyTolerance: 2, collideEarly: 0 },
  major: { dsep: 400, dtest: 140, dlookahead: 700 },
  main: { dsep: 1400, dtest: 600, dlookahead: 1800 },
  water: { coastNoise: { noiseEnabled: true, noiseSize: 150, noiseAngle: 20 }, riverNoise: { noiseEnabled: true, noiseSize: 150, noiseAngle: 20 },
    riverBankSize: 14, riverSize: 58, pathIterations: 10000, simplifyTolerance: 5, coastRadius: 70, riverRadius: 90,
    // The most of the domain the sea may take, so every city has room
    seaMax: .15 },
  noise: { globalNoise: false, noiseSizePark: 80, noiseAnglePark: 90, noiseSizeGlobal: 150, noiseAngleGlobal: 20 },
  // A big park is a face of the main and major roads no bigger than maxArea,
  // chosen before the minor roads so their paths wind through it. Small
  // parks are finished blocks between smallArea[0] and [1], picked last.
  parks: { big: 1, small: 6, clusterBig: false, maxLength: 80, minArea: 2000, maxArea: 280000, bigArea: 110000, smallArea: [4500, 30000], spacing: 320 },
  // Lots in a strip round each block (see lots.js); style(centre, district,
  // downtown) may give each block its own depth and frontages. Thin blocks
  // are cut across into lots between minArea and twice that.
  lots: { maxLength: 400, minArea: 380, downtownMinArea: 640, style: null },
  // Streets within `align` metres of the ring road turn to meet it square
  ring: { inset: 45, radius: 240, wander: 16, align: 300 },
  // The city is an island whose edge is a harbour all round: the shore is a
  // quay wall `quay` beyond the kerb of the ring road and of the coast road,
  // and the sea runs on to the edge of the world.
  shore: { quay: 6, sea: 2400 },
  // Every dead end reaches the next street or is cut back to its last junction:
  // a road that stops inside a block would run under its pavement and lots
  network: { stub: 18, reach: 150, keepOver: Infinity },
  // Metres of boulevard every city has (the longest avenues through the
  // middle are promoted), and style(point, district, downtown), the profile
  // name for a side street there (see road-hierarchy.js)
  streets: { boulevards: 2700, style: null },
  // One district of each of `styles`, grown over the city's land from seeds
  // spread across it (and one of `downtown` round downtown), each a single
  // piece with wandering borders. A style's `prefer` { downtown, water } says
  // whether its seed wants to be near (-) or far from (+) downtown and the
  // water. `winding` gives a style rotational noise { angle, size } over its
  // streets.
  districts: { cell: 16, styles: [], downtown: null, prefer: {}, winding: {} },
  coast: true, river: true, closed: true,
};

// A binary heap of (priority, value) pairs in flat arrays
class Heap {
  constructor() { this.keys = []; this.values = []; }
  get size() { return this.keys.length; }
  push(key, value) {
    const keys = this.keys, values = this.values;
    let i = keys.length; keys.push(key); values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent]; values[i] = values[parent]; i = parent;
    }
    keys[i] = key; values[i] = value;
  }
  pop() {
    const keys = this.keys, values = this.values, top = values[0], lastKey = keys.pop(), lastValue = values.pop();
    if (keys.length) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= keys.length) break;
        if (child + 1 < keys.length && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        keys[i] = keys[child]; values[i] = values[child]; i = child;
      }
      keys[i] = lastKey; values[i] = lastValue;
    }
    return top;
  }
}

// The districts, on a raster over the domain. Each grows from its seed at
// once, claiming the cells it reaches first, so each is one piece. They grow
// at their own pace (so their sizes differ), slower one way than the other
// (so some are long), through noise of their own (so the borders wander),
// and hardly across water, so a river is usually a border. Midtown grows
// from downtown, slowly; the others' seeds are spread as far apart as the
// land allows, and each style takes the seed it likes best (see `prefer`).
function layDistricts(options, origin, dimensions, onLand, downtown, noise2D, random) {
  const { cell = 16, styles = [], prefer = {} } = options;
  const cols = Math.ceil(dimensions.x / cell), rows = Math.ceil(dimensions.y / cell), count = cols * rows;
  const centreOf = i => new Vector(origin.x + (i % cols + .5) * cell, origin.y + (Math.floor(i / cols) + .5) * cell);
  const land = new Uint8Array(count);
  for (let i = 0; i < count; i++) land[i] = onLand(centreOf(i)) ? 1 : 0;
  // How far each cell is from the water, in cells (a chamfer distance)
  const shore = new Float32Array(count).fill(Infinity);
  for (let i = 0; i < count; i++) if (!land[i]) shore[i] = 0;
  const steps = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]];
  for (const pass of [0, 1]) {
    for (let k = 0; k < count; k++) {
      const i = pass ? count - 1 - k : k, c = i % cols, r = Math.floor(i / cols);
      for (const [dc, dr, length] of steps) {
        if ((pass ? dr < 0 || (dr === 0 && dc < 0) : dr > 0 || (dr === 0 && dc > 0))) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        shore[i] = Math.min(shore[i], shore[nr * cols + nc] + length);
      }
    }
  }
  const landCells = [];
  for (let i = 0; i < count; i++) if (land[i]) landCells.push(i);
  if (!landCells.length) landCells.push(Math.floor(count / 2));
  // Seeds: downtown's, then the others far from every seed so far and from the water
  const seeds = [];
  // (each land cell's centre made once)
  const landCentres = landCells.map(centreOf);
  const nearestLand = p => {
    let best = 0, bestDistance = landCentres[0].distanceTo(p);
    for (let k = 1; k < landCells.length; k++) { const d = landCentres[k].distanceTo(p); if (d < bestDistance) { best = k; bestDistance = d; } }
    return landCells[best];
  };
  if (options.downtown && downtown) seeds.push(nearestLand(downtown));
  for (let k = 0; k < styles.length; k++) {
    const seedCentres = seeds.map(centreOf);
    const scored = landCells.map((i, j) => {
      const p = landCentres[j], apart = seeds.length ? Math.min(...seedCentres.map(c => c.distanceTo(p))) : 1e9;
      return [Math.min(apart, shore[i] * cell * 3), i];
    });
    // one of the best few, so the same coast doesn't always give the same
    // seeds (only they are sorted, best first, ties in cell order)
    const best = scored.reduce((most, [score]) => Math.max(most, score), -Infinity);
    const choices = scored.filter(([score]) => score >= best * .85).sort((a, b) => b[0] - a[0]);
    seeds.push(choices[Math.floor(random() * choices.length)][1]);
  }
  // Styles to seeds: the arrangement the styles like best, with a little chance
  const first = options.downtown && downtown ? 1 : 0, own = seeds.slice(first);
  const size = Math.hypot(dimensions.x, dimensions.y) / 2;
  const features = own.map(i => ({ downtown: downtown ? centreOf(i).distanceTo(downtown) / size : .5, water: Math.min(1, shore[i] * cell / 300) }));
  const liking = styles.map(style => features.map(f => (prefer[style]?.downtown ?? 0) * f.downtown + (prefer[style]?.water ?? 0) * f.water + (random() - .5) * .5));
  let order = styles.map((s, i) => i), bestScore = -Infinity;
  const permute = (list, at) => {
    if (at === list.length) {
      const score = list.reduce((sum, seed, style) => sum + liking[style][seed], 0);
      if (score > bestScore) { bestScore = score; order = list.slice(); }
      return;
    }
    for (let i = at; i < list.length; i++) { [list[at], list[i]] = [list[i], list[at]]; permute(list, at + 1); [list[at], list[i]] = [list[i], list[at]]; }
  };
  if (styles.length <= 7) permute(styles.map((s, i) => i), 0);
  const districts = seeds.map((seed, index) => {
    const midtown = index < first, angle = random() * Math.PI;
    return {
      centre: centreOf(seed), style: midtown ? options.downtown : styles[order[index - first]] ?? null,
      pace: midtown ? .62 : .8 + random() * .45, stretch: midtown ? .15 : random() * .8,
      axis: [Math.cos(angle), Math.sin(angle)], noise: [random() * 200, random() * 200],
    };
  });
  // Grow them all at once
  const owner = new Int8Array(count).fill(-1), heap = new Heap();
  districts.forEach((district, index) => heap.push(0, seeds[index] * 8 + index));
  while (heap.size) {
    const cost = heap.keys[0], value = heap.pop(), i = Math.floor(value / 8), index = value % 8;
    if (owner[i] >= 0) continue;
    owner[i] = index;
    const d = districts[index], c = i % cols, r = Math.floor(i / cols);
    for (const [dc, dr, length] of steps) {
      const nc = c + dc, nr = r + dr, n = nr * cols + nc;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || owner[n] >= 0) continue;
      const along = (dc * d.axis[0] + dr * d.axis[1]) / length, x = origin.x + (nc + .5) * cell, y = origin.y + (nr + .5) * cell;
      const rough = 1 + .55 * noise2D(x / 380 + d.noise[0], y / 380 + d.noise[1]);
      heap.push(cost + length * (land[n] ? 1 : 12) * rough * (1 + d.stretch * along * along) / d.pace, n * 8 + index);
    }
  }
  // Looked up through a small warp, so a border wanders within a cell or two too
  const cellAt = (x, y) => {
    const wx = x + noise2D(x / 150 + 3.1, y / 150) * 14, wy = y + noise2D(x / 150, y / 150 - 5.7) * 14;
    const c = Math.max(0, Math.min(cols - 1, Math.floor((wx - origin.x) / cell))), r = Math.max(0, Math.min(rows - 1, Math.floor((wy - origin.y) / cell)));
    return r * cols + c;
  };
  const neighbourhoodAt = (x, y) => Math.max(0, owner[cellAt(x, y)]);
  const districtAt = (x, y) => districts[neighbourhoodAt(x, y)]?.style ?? null;
  // How much a point is in a style's district, from 0 to 1: its cells,
  // blurred over a street or so and looked up bilinearly (the streets ask at
  // every step they trace)
  const districtShare = style => {
    let grid = new Float32Array(count);
    for (let i = 0; i < count; i++) grid[i] = districts[owner[i]]?.style === style ? 1 : 0;
    const radius = 3;
    for (const horizontal of [true, false, true, false]) {
      const out = new Float32Array(count);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let sum = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const cc = horizontal ? c + k : c, rr = horizontal ? r : r + k;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          sum += grid[rr * cols + cc]; n++;
        }
        out[r * cols + c] = sum / n;
      }
      grid = out;
    }
    return point => {
      const fx = Math.max(0, Math.min(cols - 1.001, (point.x - origin.x) / cell - .5)), fy = Math.max(0, Math.min(rows - 1.001, (point.y - origin.y) / cell - .5));
      const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r, at = (cc, rr) => grid[rr * cols + cc];
      return (at(c, r) * (1 - tx) + at(c + 1, r) * tx) * (1 - ty) + (at(c, r + 1) * (1 - tx) + at(c + 1, r + 1) * tx) * ty;
    };
  };
  return { neighbourhoods: districts, neighbourhoodAt, districtAt, districtShare };
}

function merge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' ? merge(base[key], value) : value;
  }
  return out;
}

// A city run straight through its stages
export function generateCityMap(options = {}) { return finish(generateCityStages(options)); }
// A staged build run to its end, its stages passed over
export function finish(stages) {
  for (;;) { const { done, value } = stages.next(); if (done) return value; }
}

// The city in stages: yields the name of each as it begins, so a page can
// show what it is building (see loading-status.js), and returns the city
export function* generateCityStages(options = {}) {
  const o = merge(DEFAULT_OPTIONS, options), seed = o.seed >>> 0, random = mulberry32(seed);
  const timings = {}, started = performance.now();
  let mark = started;
  const lap = name => { const now = performance.now(); timings[name] = Math.round(now - mark); mark = now; };
  yield 'coast';
  const { width, height } = o;
  const origin = new Vector(-width / 2, -height / 2), dimensions = new Vector(width, height);
  const field = new TensorField({ ...o.noise }, random);
  // MapGenerator's recommended field: a grid at each corner of the middle 70%, and one radial
  const spawnScale = .7, size = dimensions.clone().multiplyScalar(spawnScale);
  const spawnOrigin = dimensions.clone().multiplyScalar((1 - spawnScale) / 2).add(origin);
  const addGrid = location => field.addGrid(location, randomRange(random, width / 4, width), randomRange(random, 50), randomRange(random, Math.PI / 2));
  addGrid(spawnOrigin); addGrid(spawnOrigin.clone().add(size));
  addGrid(spawnOrigin.clone().add(new Vector(size.x, 0))); addGrid(spawnOrigin.clone().add(new Vector(0, size.y)));
  const randomLocation = () => new Vector(random(), random()).multiply(size).add(spawnOrigin);
  field.addRadial(randomLocation(), randomRange(random, width / 10, width / 5), randomRange(random, 50));

  const minorParams = { ...o.minor }, majorParams = { ...minorParams, ...o.major }, mainParams = { ...minorParams, ...o.main };
  // (two reaches of a river no nearer than both their bank roads need)
  const waterParams = { riverApart: 2 * (o.water.riverSize + PROFILES.riverbank.halfWidth), ...minorParams, ...o.water };
  const integrator = new RK4Integrator(field, minorParams);
  const water = new WaterGenerator(integrator, origin, dimensions, waterParams, field, random);
  if (o.coast) water.createCoast();
  if (o.river) water.createRiver();
  // The ring road closes every block at the edge of the city. It depends only
  // on the domain and the sea, so the parks can already be closed by it.
  const ring = o.closed ? ringRoad(origin, dimensions, { ...o.ring, noise: field.noise2D }) : null;
  const ringArea = ring ? offsetPolygon(ring.slice(0, -1), 3) : null;
  const insideRing = ring ? p => insideIndexed(p, ringArea) : () => true;
  let ringRuns = [];
  if (ring) {
    // Start the loop on land so a run never wraps round its first point; it
    // stops just across the coast road
    const ringPolygon = ring.slice(0, -1), onShore = p => !insidePolygon(p, water.seaPolygon), start = Math.max(0, ringPolygon.findIndex(onShore));
    const loop = [...ringPolygon.slice(start), ...ringPolygon.slice(0, start + 1)];
    ringRuns = water.seaPolygon.length >= 3 ? clipInside(loop, water.seaPolygon, .6, false) : [loop];
    // The runs either side of where the loop began are one road
    const first = ringRuns[0], last = ringRuns[ringRuns.length - 1];
    if (ringRuns.length > 1 && first[0].distanceTo(loop[0]) < 1e-6 && last[last.length - 1].distanceTo(loop[loop.length - 1]) < 1e-6) {
      ringRuns = [[...last, ...first.slice(1)], ...ringRuns.slice(1, -1)];
    }
  }
  lap('water');
  yield 'streets';
  const radial = field.basisFields.find(basis => basis.FIELD_TYPE === FIELD_TYPE.Radial);
  const downtownDistance = p => radial ? Math.hypot(p.x - radial.centre.x, p.y - radial.centre.y) / Math.max(1, radial._size) : 2;
  // The neighbourhoods (not the tensor field's grids: with their random sizes
  // and decays one grid outweighs the rest nearly everywhere, and there are
  // only four). They have their own random numbers, so the streets are the
  // same whatever they are.
  const { neighbourhoods, neighbourhoodAt, districtAt, districtShare } = layDistricts(o.districts, origin, dimensions, p => field.onLand(p) && insideRing(p), radial?.centre, field.noise2D, mulberry32(seed ^ 0x2c1b3c6d));
  // The streets of a neighbourhood with noise wind (not the coast or river,
  // which have their own)
  field.districtNoise = Object.entries(o.districts.winding ?? {}).filter(([style]) => neighbourhoods.some(n => n.style === style))
    .map(([style, noise]) => ({ ...noise, share: districtShare(style) }));
  // Near the ring the streets turn to meet it square or run along it, and
  // for the side streets the ring is an existing streamline of the family
  // that runs along it there, as MapGenerator keeps its coast: a street
  // beside the ring stays a street's spacing from it, and the streets across
  // it run on to it. (The avenues are left their own spacing, which the ring
  // would crowd out.)
  let edge = null;
  if (ring && o.ring.align) {
    field.alignWith(ring, o.ring.align);
    edge = { majorGrid: new GridStorage(dimensions, origin, minorParams.dsep), minorGrid: new GridStorage(dimensions, origin, minorParams.dsep) };
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1], length = a.distanceTo(b), steps = Math.ceil(length / minorParams.dstep);
      if (!length) continue;
      const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
      for (let k = 0; k < steps; k++) {
        const p = new Vector(a.x + tx * length * k / steps, a.y + ty * length * k / steps);
        if (!field.onLand(p)) continue;
        const major = field.samplePoint(p).getMajor();
        (Math.abs(major.x * tx + major.y * ty) >= Math.SQRT1_2 ? edge.majorGrid : edge.minorGrid).addSample(p);
      }
    }
  }
  // Each class of road is integrated, joined, simplified and then rounded,
  // so everything built on it later sees the final centre lines.
  const roads = (params, existing, ignoreRiver, radius) => {
    const generator = new StreamlineGenerator(integrator, origin, dimensions, { ...params }, random);
    for (const s of existing) generator.addExistingStreamlines(s);
    field.ignoreRiver = ignoreRiver;
    generator.createAllStreamlines();
    field.ignoreRiver = false;
    generator.allStreamlinesSimple = generator.allStreamlinesSimple.map(s => filletPolyline(closeLoop(s), radius));
    return generator;
  };
  const main = roads(mainParams, [water], true, BEND_RADIUS.main); lap('main');
  const major = roads(majorParams, [water, main], true, BEND_RADIUS.major); lap('major');
  const pickParks = (streamlines, count, cluster = false, target = 0) => {
    const graph = new Graph(streamlines, minorParams.dstep, false);
    const finder = new PolygonFinder(graph.nodes, { maxLength: o.parks.maxLength }, field);
    finder.findPolygons();
    // A park is a face of the finished network, so it must be closed inside the ring
    const polygons = finder.polygons.filter(p => { const area = calcPolygonArea(p); return area >= o.parks.minArea && area <= o.parks.maxArea && p.every(insideRing); }), parks = [];
    // Prefer faces near the size a park should be, then choose among the closest
    if (target) polygons.sort((a, b) => Math.abs(Math.log(calcPolygonArea(a) / target)) - Math.abs(Math.log(calcPolygonArea(b) / target))).splice(Math.max(count * 3, 3));
    if (polygons.length > count) {
      if (cluster) {
        const start = Math.floor(random() * (polygons.length - count));
        for (let i = start; i < start + count; i++) parks.push(polygons[i]);
      } else for (let i = 0; i < count; i++) {
        const park = polygons[Math.floor(random() * polygons.length)];
        if (!parks.includes(park)) parks.push(park);
      }
    } else parks.push(...polygons);
    return parks;
  };
  const bigParks = pickParks(major.allStreamlinesSimple.concat(main.allStreamlinesSimple, water.streamlinesWithSecondaryRoad, ringRuns), o.parks.big, o.parks.clusterBig, o.parks.bigArea);
  field.parks = bigParks.slice();
  const minor = roads(minorParams, [water, main, major, ...(edge ? [edge] : [])], false, BEND_RADIUS.minor); lap('minor');
  yield 'junctions';

  let roadList = [];
  for (const points of main.allStreamlinesSimple) roadList.push({ kind: 'main', points });
  for (const points of major.allStreamlinesSimple) roadList.push({ kind: 'major', points });
  for (const points of minor.allStreamlinesSimple) roadList.push({ kind: 'minor', points });
  const waterRoads = water.allStreamlinesSimple.slice();
  const coastLine = water.hasCoast ? waterRoads.shift() : null;
  if (coastLine) roadList.push({ kind: 'coast', points: coastLine });
  for (const points of waterRoads) roadList.push({ kind: 'riverbank', points });
  if (water.riverSecondaryRoad.length > 1) roadList.push({ kind: 'riverbank', points: water.riverSecondaryRoad });
  // Minor streets stop at a park's edge, carried just across the street
  // round it; the park's own walks are laid out once the streets are final
  for (const park of field.parks) roadList = roadList.flatMap(road => road.kind !== 'minor' ? [road] : clipInside(road.points, park, .6, false).map(points => ({ ...road, points })));
  // Streets end on the ring
  if (ring) {
    const ringPolygon = ring.slice(0, -1);
    roadList = roadList.flatMap(road => clipInside(road.points, ringPolygon).map(points => ({ ...road, points })));
    for (const points of ringRuns) if (points.length > 1) roadList.push({ kind: 'ring', points });
  }
  // The ring and the waterside roads meet where each was clipped by the other
  roadList = weldEnds(roadList);
  // Loops too small for a block become circuses round a garden
  let circusList;
  ({ roads: roadList, circuses: circusList } = circuses(roadList, { canPlace: p => field.onLand(p) && insideRing(p) && !field.inParks(p) }));
  // Trim overshoots, carry dead ends on to the next street, drop orphans
  roadList = cleanNetwork(roadList, { ...o.network, halfWidthOf: kind => (ROAD_PROFILES[kind] ?? ROAD_PROFILES.minor).halfWidth,
    canCross: (p, road) => field.onLand(p) && insideRing(p) && (road.kind === 'path') === field.inParks(p) });
  // Streets stopping on a road a few metres apart meet it in one place, or one gives way
  roadList = spreadJunctions(roadList);
  roadList = pruneNetwork(roadList, { stub: o.network.stub, Graph });
  // Roads meeting end to end at an angle: a dog-leg by a junction goes, any other corner is rounded
  roadList = joinCorners(roadList, { radiusOf: kind => BEND_RADIUS[kind] ?? BEND_RADIUS.minor });
  // and kinks between junctions are eased into curves
  roadList = easeKinks(roadList);
  // A block much wider than the streamlines' spacing gets the street they missed
  roadList = infillStreets(roadList, {
    faces: roads => {
      const graph = new Graph(roads.map(road => road.points), minorParams.dstep, true), faces = new PolygonFinder(graph.nodes, { maxLength: o.lots.maxLength }, field);
      faces.findPolygons();
      return faces.polygons;
    },
    directions: p => { const tensor = field.samplePoint(p); return [tensor.getMajor(), tensor.getMinor()]; },
    canPlace: p => field.onLand(p) && insideRing(p) && !field.inParks(p),
  });
  // Boulevards, the ring's parkway, avenues, and each district's side streets
  // (the metres of boulevard are for a city the default size: a smaller one has fewer)
  assignProfiles(roadList, { downtownDistance, boulevards: o.streets.boulevards * width * height / (DEFAULT_OPTIONS.width * DEFAULT_OPTIONS.height),
    streetStyle: p => o.streets.style?.(p, districtAt(p.x, p.y), downtownDistance(p)) ?? 'side' });
  // The streets round a big park can have moved since it was chosen (one cut
  // back where it met the ring at a slant, say, leaving the park open to the
  // block beside it): each park is the face of the finished streets its
  // middle is in, so long as that is still a park's size
  if (bigParks.length) {
    const graph = new Graph(roadList.filter(road => road.kind !== 'path').map(road => road.points), minorParams.dstep, true);
    const faces = new PolygonFinder(graph.nodes, { maxLength: 2000 }, { onLand: p => field.onLand(p), inParks: () => false });
    faces.findPolygons();
    bigParks.forEach((park, i) => {
      const middle = deepestPoint(park)?.point, face = middle && faces.polygons.find(polygon => insidePolygon(middle, polygon));
      if (face && calcPolygonArea(face) <= o.parks.maxArea) bigParks[i] = face;
    });
    field.parks = bigParks.slice();
  }
  // Each big park's walks: gates on its streets, a loop round it and walks
  // across the lawn to a plaza or a pond (see park-paths.js)
  const streetIndex = new RoadIndex(roadList);
  const parkLayouts = bigParks.map(polygon => parkLayout(polygon, {
    sidewalk: SIDEWALK, random, pathHalfWidth: PROFILES.path.halfWidth,
    halfWidthAt: (a, b) => streetIndex.nearest((a.x + b.x) / 2, (a.y + b.y) / 2, 30)?.road.profile.halfWidth ?? PROFILES.avenue.halfWidth,
    streetAt: p => { const hit = streetIndex.nearest(p.x, p.y, 40); return hit && { x: hit.x, y: hit.y, road: hit.road }; },
    junctionNear: (p, road, reach) => Boolean(streetIndex.nearest(p.x, p.y, reach + 14, (segment, distance) => segment.road !== road && distance - segment.road.profile.halfWidth < reach ? 0 : Infinity)),
  }));
  for (const layout of parkLayouts) for (const points of layout.paths) roadList.push({ kind: 'path', points, profile: PROFILES.path });
  lap('network');
  const roadIndex = new RoadIndex(roadList);
  const streamlines = roadList.map(road => road.points);
  // The navigation graph keeps dead ends; the lot graph drops them
  const navGraph = new Graph(streamlines, minorParams.dstep, false);
  lap('graph');
  const lotGraph = new Graph(streamlines, minorParams.dstep, true);
  // Each block edge is set back by the width of the road it actually runs
  // along, which the graph knows; the nearest road is only a fallback.
  const edgeWidths = new Map();
  const nearestHalfWidth = (a, b) => {
    const nearest = roadIndex.nearest((a.x + b.x) / 2, (a.y + b.y) / 2, 30);
    return nearest ? nearest.road.profile.halfWidth : ROAD_PROFILES.minor.halfWidth;
  };
  const halfWidthAt = (a, b) => edgeWidths.get(a)?.get(b) ?? nearestHalfWidth(a, b);
  const finder = new PolygonFinder(lotGraph.nodes, { maxLength: o.lots.maxLength, shrinkSpacing: (a, b) => halfWidthAt(a, b) + SIDEWALK }, field);
  finder.findPolygons();
  const blockRoads = finder.polygons.map((polygon, f) => {
    const nodes = finder.faceNodes[f], n = polygon.length, roads = [];
    for (let i = 0; i < n; i++) {
      const road = lotGraph.edgeRoads.get(Graph.edgeKey(nodes[i], nodes[(i + 1) % n])) ?? -1;
      roads.push(road);
      if (road < 0) continue;
      const a = polygon[i], b = polygon[(i + 1) % n], w = roadList[road].profile.halfWidth;
      if (!edgeWidths.has(a)) edgeWidths.set(a, new Map());
      if (!edgeWidths.has(b)) edgeWidths.set(b, new Map());
      edgeWidths.get(a).set(b, w); edgeWidths.get(b).set(a, w);
    }
    return roads;
  });
  // A block: its face between the road centrelines, the kerb line, and the
  // inner edge of its pavement, which is where its lots begin.
  const blocks = finder.polygons.map((polygon, i) => ({ polygon, roads: blockRoads[i], sidewalk: insetPolygon(polygon, (a, b) => -halfWidthAt(a, b)), inner: [], yard: [] }));
  // How far a point stands outside the nearest carriageway (negative: on it)
  const clearOfRoads = p => { const hit = roadIndex.nearest(p.x, p.y, 25, carriagewayScore); return hit ? hit.score : Infinity; };
  // Where two roads meet at a shallow angle, or a road runs on a few metres
  // past a junction, a block's kerb line can reach onto a carriageway, and
  // where a wide road carries on round a bend as a narrower one the corner of
  // its square end can poke into the block on the outside of the bend. The
  // carriageways are cut out of the block, which keeps the rest of it; only a
  // sliver with little left, or a road through its middle, is left as verge.
  // (the corners of each road end where another road carries on from it)
  const joints = endJoints(roadList), ends = [];
  for (const road of roadList) {
    const points = road.points, n = points.length;
    if (road.kind === 'path' || n < 2 || points[0].distanceTo(points[n - 1]) < 1e-6) continue;
    for (const [end, before] of [[points[0], points[1]], [points[n - 1], points[n - 2]]]) {
      const length = end.distanceTo(before);
      if (length >= 1) ends.push({ road, end, tx: (end.x - before.x) / length, ty: (end.y - before.y) / length });
    }
  }
  const endCorners = ends.filter(a => ends.some(b => b.road !== a.road && b.end.distanceTo(a.end) < .5)).flatMap(({ road, end, tx, ty }) => {
    const w = road.profile.halfWidth - 1;
    return [-1, 1].map(side => new Vector(end.x - tx * .5 - ty * side * w, end.y - ty * .5 + tx * side * w));
  });
  const poked = polygon => {
    const b = polygonBounds(polygon);
    return endCorners.some(p => p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY && insidePolygon(p, polygon) && clearOfRoads(p) < -.75);
  };
  const clear = polygon => polygon.every(p => clearOfRoads(p) >= -.75);
  for (const block of blocks) {
    if (!block.sidewalk.length) continue;
    const reaches = !clear(block.sidewalk);
    if (!reaches && !poked(block.sidewalk)) continue;
    // Cut round the joints if that leaves a clean kerb; failing that a block
    // that reaches onto a road is cut without them, and one only poked keeps its line
    let kept = clearOfCarriageways(block.sidewalk, roadIndex, joints);
    if (!(kept && clear(kept) && !poked(kept))) kept = reaches ? clearOfCarriageways(block.sidewalk, roadIndex) : block.sidewalk;
    if (kept === block.sidewalk) continue;
    if (kept && clear(kept)) { block.sidewalk = kept; block.repaired = true; }
    else { block.sidewalk = []; block.broken = true; }
  }
  // Land and water for the whole world, from the ring road's promenade, the
  // coast road's and the river's channel. The city stands on its blocks and
  // its roads with their promenades: bare land on the shore past them (where
  // the ring and the coast road round a corner) is sea.
  yield 'waterfront';
  let shore = null;
  if (ring) {
    let coast = null;
    if (coastLine && water.seaPolygon.length >= 3) {
      coast = { line: coastLine, reach: ROAD_PROFILES.coast.halfWidth + o.shore.quay, seaSide: seaSideOf(coastLine, new Vector(origin.x, origin.y), new Vector(width, height)) };
    }
    const island = islandOutline(ring, CLASS_PROFILES.ring.halfWidth + o.shore.quay);
    const river = water.hasRiver && water.riverCentre?.length > 1 ? { centre: water.riverCentre, halfWidth: waterParams.riverSize - waterParams.riverBankSize } : null;
    const bounds = { minX: origin.x - o.shore.sea, minY: origin.y - o.shore.sea, maxX: origin.x + width + o.shore.sea, maxY: origin.y + height + o.shore.sea };
    shore = { island, coast, ...landAndWater({ island, coast, river, bounds,
      keep: [...finder.polygons, ...bigParks, ...roadFootprints(roadList, road => road.profile.halfWidth + o.shore.quay + .5)] }), bounds };
  }
  lap('shore');
  yield 'pavements';
  // Small parks and squares: whole blocks, well apart, away from the water
  const parks = bigParks.map((polygon, i) => ({ polygon, kind: 'park', block: -1, layout: parkLayouts[i] }));
  // The garden in the middle of each circus
  for (const circus of circusList) {
    const index = blocks.findIndex(block => !block.park && calcPolygonArea(block.polygon) < Math.PI * circus.radius ** 2 && insidePolygon(circus.centre, block.polygon));
    if (index < 0) continue;
    blocks[index].park = true;
    parks.push({ polygon: blocks[index].polygon, kind: 'square', block: index, circus: true });
  }
  const squares = o.parks.small + parks.length - bigParks.length;
  const candidates = blocks.map((block, index) => ({ block, index, area: calcPolygonArea(block.polygon), centre: polygonCentroid(block.polygon) }))
    .filter(({ block, area }) => !block.park && area >= o.parks.smallArea[0] && area <= o.parks.smallArea[1] && block.polygon.every(p => insideRing(p) && field.onLand(p)));
  for (let tries = 0; tries < 60 && parks.length < bigParks.length + squares && candidates.length; tries++) {
    const pick = candidates[Math.floor(random() * candidates.length)];
    if (parks.some(park => polygonCentroid(park.polygon).distanceTo(pick.centre) < o.parks.spacing)) continue;
    pick.block.park = true;
    parks.push({ polygon: pick.block.polygon, kind: 'square', block: pick.index });
  }
  lap('parks');
  finder.shrink();
  const lots = [], lotBlocks = [], lotEdges = [], lotDepths = [];
  const defaultStyle = (centre, district, downtown) => downtown < .7 ? { depth: 28, frontage: [24, 36], corner: [15, 22], minArea: o.lots.downtownMinArea }
    : downtown < 1.2 ? { depth: 25, frontage: [17, 26], corner: [12, 18], minArea: (o.lots.downtownMinArea + o.lots.minArea) / 2 }
      : { depth: 22, frontage: [14, 21], corner: [10, 15], minArea: o.lots.minArea };
  finder.shrunkPolygons.forEach((shrunk, index) => {
    const block = blocks[index];
    // A repaired block steps in from the kerb it was left with
    if (block.repaired) shrunk = insetPolygon(block.sidewalk, -SIDEWALK);
    const inner = shrunk.length >= 3 ? chamferAcute(shrunk) : shrunk;
    block.inner = block.broken ? [] : inner;
    if (block.inner.length < 3 || block.park) return;
    const centre = polygonCentroid(inner), district = districtAt(centre.x, centre.y), downtown = downtownDistance(centre);
    const style = { ...defaultStyle(centre, district, downtown), ...(o.lots.style?.(centre, district, downtown) ?? {}) };
    block.district = district;
    // (A draw that once meant to keep a few blocks whole, though none ever
    // were; it stays so every city keeps the same lots.)
    random();
    const result = frontageLots(inner, style, random) ?? frontageLots(inner, { ...style, depth: style.depth * .65 }, random);
    if (result?.yard) block.yard = result.yard;
    // Every lot keeps its pavement between it and the street
    // (A block cut across keeps only the lots on its streets: any in its
    // middle, which a big winding block can leave, are its yard)
    const pieces = (result?.lots ?? throughLots(inner, style.minArea, random).filter(lot => lot.edges.includes('street')))
      .filter(lot => lot.polygon.every(p => clearOfRoads(p) > SIDEWALK * .7));
    for (const lot of pieces) { lots.push(lot.polygon); lotBlocks.push(index); lotEdges.push(lot.edges); lotDepths.push(lot.depth ?? 0); }
  });
  lap('lots');

  const nodeIndex = new Map(navGraph.nodes.map((node, index) => [node, index]));
  const nav = navGraph.nodes.map(node => {
    const adj = [], roads = [];
    for (const neighbor of node.neighbors) {
      adj.push(nodeIndex.get(neighbor));
      roads.push(navGraph.edgeRoads.get(Graph.edgeKey(node, neighbor)) ?? -1);
    }
    return { x: node.value.x, y: node.value.y, adj, roads };
  });
  timings.total = Math.round(performance.now() - started);
  return {
    seed, width, height, origin: { x: origin.x, y: origin.y },
    roads: roadList, roadIndex, streamlines, ring,
    coastline: water.coastline, coastLine, sea: water.seaPolygon, river: water.riverPolygon, riverStreamline: water.riverStreamline, riverCentre: water.riverCentre ?? null,
    riverWidth: waterParams.riverSize - waterParams.riverBankSize, shore,
    hasCoast: water.hasCoast, hasRiver: water.hasRiver,
    parks: parks.map(park => park.polygon), parkInfo: parks, parkLayouts, blocks, lots, lotBlocks, lotEdges, lotDepths, nav, field, joints,
    districts: neighbourhoods, neighbourhoodAt, districtAt, downtownDistance,
    sampleDirection: (x, y) => field.samplePoint(new Vector(x, y)).getMajor(),
    timings,
  };
}

// How far a point is outside a road segment's carriageway, which ends square
// across the road's own ends, as the carriageway is drawn: beyond the end of
// a road is not on it, however its last few metres bend, nor is the few
// centimetres a road is carried past the one it meets. (x, y) is the point.
const carriagewaySpans = new WeakMap();
export function carriagewayScore(segment, distance, t, x, y) {
  const road = segment.road;
  let span = carriagewaySpans.get(road);
  if (!span) {
    // The segments within a couple of metres of either end are its overshoot
    const points = road.points, n = points.length;
    let first = 0, last = n - 2, run = 0;
    while (first < last && (run += points[first].distanceTo(points[first + 1])) < 2) first++;
    run = 0;
    while (last > first && (run += points[last].distanceTo(points[last + 1])) < 2) last--;
    // Each end, square across the road, and which segments are near enough to it to reach past it
    const along = [0];
    for (let i = 1; i < n; i++) along.push(along[i - 1] + points[i].distanceTo(points[i - 1]));
    const closed = points[0].distanceTo(points[n - 1]) < 1e-6, reach = road.profile.halfWidth * 2;
    const end = (at, towards) => { const d = points[at].clone().sub(points[towards]), l = d.length() || 1; return { x: points[at].x, y: points[at].y, dx: d.x / l, dy: d.y / l }; };
    span = { first, last, along, closed, reach, start: end(first, first + 1), end: end(last + 1, last) };
    carriagewaySpans.set(road, span);
  }
  if (segment.index < span.first || segment.index > span.last) return Infinity;
  if ((t <= 0 && segment.index === span.first) || (t >= 1 && segment.index === span.last)) return Infinity;
  if (x !== undefined && !span.closed) {
    const { along, start, end, reach } = span;
    if (along[segment.index] - along[span.first] < reach && (x - start.x) * start.dx + (y - start.y) * start.dy > 0) return Infinity;
    if (along[span.last + 1] - along[segment.index + 1] < reach && (x - end.x) * end.dx + (y - end.y) * end.dy > 0) return Infinity;
  }
  return distance - road.profile.halfWidth;
}

// A kerb line less every carriageway that reaches onto it, and the joints
// where one road carries on as another: the biggest piece left, if it keeps
// most of the block and no road runs through its middle. The carriageways are
// cut a little narrow, so a kerb that only grazes one keeps its line.
function clearOfCarriageways(polygon, roadIndex, joints = [], graze = .3) {
  const b = polygonBounds(polygon), margin = 30, near = new Map();
  roadIndex.each((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + margin, segment => {
    if (segment.road.kind === 'path') return;
    if (!near.has(segment.road)) near.set(segment.road, new Set());
    near.get(segment.road).add(segment.index);
  });
  const cuts = [];
  for (const [road, indices] of near) {
    // Each run of the road's segments near the block, as one carriageway
    const sorted = [...indices].sort((p, q) => p - q);
    let run = [];
    const flush = () => { if (run.length) cuts.push(bufferPolyline(road.points.slice(run[0], run[run.length - 1] + 2), road.profile.halfWidth - graze)); run = []; };
    for (const i of sorted) { if (run.length && i !== run[run.length - 1] + 1) flush(); run.push(i); }
    flush();
  }
  for (const joint of joints) {
    const j = polygonBounds(joint);
    if (j.maxX > b.minX - margin && j.minX < b.maxX + margin && j.maxY > b.minY - margin && j.minY < b.maxY + margin) cuts.push(joint);
  }
  const area = calcPolygonArea(polygon);
  let best = null;
  for (const piece of difference([polygon], solids(cuts))) {
    const pieceArea = calcPolygonArea(piece.outer);
    if (!best || pieceArea > best.area) best = { ...piece, area: pieceArea };
  }
  return best && !best.holes.length && best.area > area * .45 ? best.outer : null;
}

export function cityStats(city) {
  const length = kind => city.roads.filter(r => r.kind === kind).reduce((sum, r) => sum + polylineLength(r.points), 0);
  const areas = city.lots.map(calcPolygonArea).sort((a, b) => a - b);
  return {
    seed: city.seed, timings: city.timings,
    roads: Object.fromEntries(['main', 'major', 'minor', 'ring', 'coast', 'riverbank', 'path'].map(kind => [kind, { count: city.roads.filter(r => r.kind === kind).length, km: Math.round(length(kind) / 100) / 10 }])),
    hasCoast: city.hasCoast, hasRiver: city.hasRiver, seaVertices: city.sea.length, riverVertices: city.river.length,
    parks: city.parks.length, blocks: city.blocks.length, sidewalks: city.blocks.filter(b => b.sidewalk.length).length, lots: city.lots.length,
    lotArea: { min: Math.round(areas[0]), median: Math.round(areas[Math.floor(areas.length / 2)]), max: Math.round(areas[areas.length - 1]) },
    navNodes: city.nav.length, navEdges: city.nav.reduce((sum, n) => sum + n.adj.length, 0) / 2,
    deadEnds: city.nav.filter(n => n.adj.length === 1).length,
    lotCentre: city.lots.length ? averagePoint(city.lots[0]) : null,
  };
}
