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
import { averagePoint, calcPolygonArea, offsetPolygon } from './polygon-util.js';

// The whole MapGenerator pipeline in metres, seeded: a tensor field of four
// grids and a radial, a coastline and river, main, major and minor roads,
// parks, then blocks and lots. x runs east and y runs north.
//
// Road widths are the game's street profiles (see world/city-streets.js);
// the generator only needs them for setbacks.
export const ROAD_PROFILES = Object.freeze({
  main: Object.freeze({ kind: 'boulevard', halfWidth: 11, lane: 5.7, speed: 20, median: 1.4 }),
  major: Object.freeze({ kind: 'avenue', halfWidth: 9, lane: 3, speed: 16, median: 0 }),
  coast: Object.freeze({ kind: 'avenue', halfWidth: 9, lane: 3, speed: 16, median: 0 }),
  riverbank: Object.freeze({ kind: 'avenue', halfWidth: 8, lane: 3, speed: 14, median: 0 }),
  minor: Object.freeze({ kind: 'side', halfWidth: 6.5, lane: 2.7, speed: 10, median: 0 }),
  path: Object.freeze({ kind: 'path', halfWidth: 3.6, lane: 1.6, speed: 8, median: 0 }),
});
export const SIDEWALK = 4.2;

export const DEFAULT_OPTIONS = {
  seed: 1, width: 2400, height: 1800,
  minor: { dsep: 90, dtest: 60, dstep: 4, dlookahead: 160, dcirclejoin: 20, joinangle: .1, pathIterations: 900, seedTries: 300, simplifyTolerance: 2, collideEarly: 0 },
  major: { dsep: 400, dtest: 140, dlookahead: 700 },
  main: { dsep: 1400, dtest: 600, dlookahead: 1800 },
  water: { coastNoise: { noiseEnabled: true, noiseSize: 150, noiseAngle: 20 }, riverNoise: { noiseEnabled: true, noiseSize: 150, noiseAngle: 20 },
    riverBankSize: 14, riverSize: 58, pathIterations: 10000, simplifyTolerance: 5 },
  noise: { globalNoise: false, noiseSizePark: 80, noiseAnglePark: 90, noiseSizeGlobal: 150, noiseAngleGlobal: 20 },
  parks: { big: 2, small: 3, clusterBig: false, maxLength: 20, minArea: 2000 },
  // Lots between minArea and twice that; downtown lots are bigger, for towers
  lots: { maxLength: 20, minArea: 380, downtownMinArea: 640, chanceNoDivide: .05, maxLotArea: 9000 },
  coast: true, river: true,
};

function merge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' ? merge(base[key], value) : value;
  }
  return out;
}

export function generateCityMap(options = {}) {
  const o = merge(DEFAULT_OPTIONS, options), seed = o.seed >>> 0, random = mulberry32(seed);
  const timings = {}, started = performance.now();
  let mark = started;
  const lap = name => { const now = performance.now(); timings[name] = Math.round(now - mark); mark = now; };
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
  const waterParams = { ...minorParams, ...o.water };
  const integrator = new RK4Integrator(field, minorParams);
  const water = new WaterGenerator(integrator, origin, dimensions, waterParams, field, random);
  if (o.coast) water.createCoast();
  if (o.river) water.createRiver();
  lap('water');
  const roads = (params, existing, ignoreRiver) => {
    const generator = new StreamlineGenerator(integrator, origin, dimensions, { ...params }, random);
    for (const s of existing) generator.addExistingStreamlines(s);
    field.ignoreRiver = ignoreRiver;
    generator.createAllStreamlines();
    field.ignoreRiver = false;
    return generator;
  };
  const main = roads(mainParams, [water], true); lap('main');
  const major = roads(majorParams, [water, main], true); lap('major');
  const pickParks = (streamlines, count, cluster = false) => {
    const graph = new Graph(streamlines, minorParams.dstep, false);
    const finder = new PolygonFinder(graph.nodes, { maxLength: o.parks.maxLength, minArea: o.parks.minArea, shrinkSpacing: 4, chanceNoDivide: 1 }, field, random);
    finder.findPolygons();
    const polygons = finder.polygons.filter(p => calcPolygonArea(p) >= o.parks.minArea), parks = [];
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
  const bigParks = pickParks(major.allStreamlinesSimple.concat(main.allStreamlinesSimple), o.parks.big, o.parks.clusterBig);
  field.parks = bigParks.slice();
  const minor = roads(minorParams, [water, main, major], false); lap('minor');
  const smallParks = pickParks(minor.allStreamlinesSimple.concat(major.allStreamlinesSimple, main.allStreamlinesSimple), o.parks.small);
  field.parks = bigParks.concat(smallParks);
  lap('parks');

  const roadList = [];
  for (const points of main.allStreamlinesSimple) roadList.push({ kind: 'main', points });
  for (const points of major.allStreamlinesSimple) roadList.push({ kind: 'major', points });
  for (const points of minor.allStreamlinesSimple) roadList.push({ kind: 'minor', points });
  const waterRoads = water.allStreamlinesSimple.slice();
  if (water.hasCoast) roadList.push({ kind: 'coast', points: waterRoads.shift() });
  for (const points of waterRoads) roadList.push({ kind: 'riverbank', points });
  if (water.riverSecondaryRoad.length > 1) roadList.push({ kind: 'riverbank', points: water.riverSecondaryRoad });
  // Minor roads that wind through a park are its paths. A road that leaves a
  // park is split where it does, so the street outside stays a street.
  if (field.parks.length) {
    const split = [];
    for (const road of roadList) {
      if (road.kind !== 'minor') { split.push(road); continue; }
      const inside = road.points.map(p => field.inParks(p));
      let run = [road.points[0]], runInside = inside[0];
      for (let i = 1; i < road.points.length; i++) {
        if (inside[i] === runInside) { run.push(road.points[i]); continue; }
        // The boundary vertex belongs to both runs
        run.push(road.points[i]);
        if (run.length > 1) split.push({ kind: runInside ? 'path' : 'minor', points: run });
        run = [road.points[i]]; runInside = inside[i];
      }
      if (run.length > 1) split.push({ kind: runInside ? 'path' : 'minor', points: run });
    }
    roadList.length = 0; roadList.push(...split);
  }
  for (const road of roadList) road.profile = ROAD_PROFILES[road.kind];
  const roadIndex = new RoadIndex(roadList);
  const streamlines = roadList.map(road => road.points);
  // The navigation graph keeps dead ends; the lot graph drops them
  const navGraph = new Graph(streamlines, minorParams.dstep, false);
  lap('graph');
  const lotGraph = new Graph(streamlines, minorParams.dstep, true);
  const halfWidthAt = (a, b) => {
    const nearest = roadIndex.nearest((a.x + b.x) / 2, (a.y + b.y) / 2, 30);
    return nearest ? nearest.road.profile.halfWidth : ROAD_PROFILES.minor.halfWidth;
  };
  const radial = field.basisFields.find(basis => basis.FIELD_TYPE === FIELD_TYPE.Radial);
  const minArea = polygon => {
    if (!radial) return o.lots.minArea;
    const centre = averagePoint(polygon), distance = Math.hypot(centre.x - radial.centre.x, centre.y - radial.centre.y) / Math.max(1, radial._size);
    return distance < .7 ? o.lots.downtownMinArea : distance < 1.1 ? (o.lots.downtownMinArea + o.lots.minArea) / 2 : o.lots.minArea;
  };
  const finder = new PolygonFinder(lotGraph.nodes, { maxLength: o.lots.maxLength, minArea, chanceNoDivide: o.lots.chanceNoDivide, maxLotArea: o.lots.maxLotArea,
    shrinkSpacing: (a, b) => halfWidthAt(a, b) + SIDEWALK }, field, random);
  finder.findPolygons();
  // A block: its face between the road centrelines, the kerb line, and the
  // inner edge of its pavement, which is where its lots begin.
  const blocks = finder.polygons.map(polygon => ({ polygon, sidewalk: offsetPolygon(polygon, (a, b) => -halfWidthAt(a, b)), inner: [] }));
  finder.shrink(); finder.divide();
  finder.shrunkPolygons.forEach((inner, i) => { blocks[i].inner = inner; });
  const lots = finder.polygons, lotBlocks = finder.lotBlocks;
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
    roads: roadList, roadIndex, streamlines,
    coastline: water.coastline, sea: water.seaPolygon, river: water.riverPolygon, riverStreamline: water.riverStreamline,
    riverWidth: waterParams.riverSize - waterParams.riverBankSize,
    hasCoast: water.hasCoast, hasRiver: water.hasRiver,
    parks: field.parks, blocks, lots, lotBlocks, nav, field,
    sampleDirection: (x, y) => field.samplePoint(new Vector(x, y)).getMajor(),
    timings,
  };
}

export function cityStats(city) {
  const length = kind => city.roads.filter(r => r.kind === kind).reduce((sum, r) => sum + r.points.slice(1).reduce((acc, p, i) => acc + p.distanceTo(r.points[i]), 0), 0);
  const areas = city.lots.map(calcPolygonArea).sort((a, b) => a - b);
  return {
    seed: city.seed, timings: city.timings,
    roads: Object.fromEntries(['main', 'major', 'minor', 'coast', 'riverbank'].map(kind => [kind, { count: city.roads.filter(r => r.kind === kind).length, km: Math.round(length(kind) / 100) / 10 }])),
    hasCoast: city.hasCoast, hasRiver: city.hasRiver, seaVertices: city.sea.length, riverVertices: city.river.length,
    parks: city.parks.length, blocks: city.blocks.length, sidewalks: city.blocks.filter(b => b.sidewalk.length).length, lots: city.lots.length,
    lotArea: { min: Math.round(areas[0]), median: Math.round(areas[Math.floor(areas.length / 2)]), max: Math.round(areas[areas.length - 1]) },
    navNodes: city.nav.length, navEdges: city.nav.reduce((sum, n) => sum + n.adj.length, 0) / 2,
    lotCentre: city.lots.length ? averagePoint(city.lots[0]) : null,
  };
}
