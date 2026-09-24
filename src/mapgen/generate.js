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
import { averagePoint, calcPolygonArea, offsetPolygon, insidePolygon, polygonCentroid, segmentIntersection, distanceToPolyline } from './polygon-util.js';
import { filletPolyline, ringRoad, clipInside, cleanNetwork, pruneNetwork, joinCorners, easeKinks, easePathEnds } from './road-network.js';
import { frontageLots, throughLots, chamferAcute } from './lots.js';
import { islandOutline, landAndWater, harbourWater } from './shore.js';
import { insetPolygon } from './booleans.js';

// The whole MapGenerator pipeline in metres, seeded: a tensor field of four
// grids and a radial, a coastline and river, main, major and minor roads,
// parks, a ring road round the edge, then blocks and lots. x runs east and y
// runs north.
//
// Road widths are the game's street profiles; the generator needs them for
// setbacks, and the world draws them.
export const ROAD_PROFILES = Object.freeze({
  main: Object.freeze({ kind: 'boulevard', halfWidth: 11, lane: 5.7, speed: 20, median: 1.4 }),
  major: Object.freeze({ kind: 'avenue', halfWidth: 9, lane: 3, speed: 16, median: 0 }),
  ring: Object.freeze({ kind: 'avenue', halfWidth: 9, lane: 3, speed: 17, median: 0 }),
  coast: Object.freeze({ kind: 'avenue', halfWidth: 9, lane: 3, speed: 16, median: 0 }),
  riverbank: Object.freeze({ kind: 'avenue', halfWidth: 8, lane: 3, speed: 14, median: 0 }),
  minor: Object.freeze({ kind: 'side', halfWidth: 6.5, lane: 2.7, speed: 10, median: 0 }),
  path: Object.freeze({ kind: 'path', halfWidth: 3.6, lane: 1.6, speed: 8, median: 0 }),
});
export const SIDEWALK = 4.2;
// How round each class of road bends, at most, in metres
const BEND_RADIUS = { main: 80, major: 60, minor: 35, path: 14 };

export const DEFAULT_OPTIONS = {
  seed: 1, width: 2400, height: 1800,
  minor: { dsep: 90, dtest: 60, dstep: 4, dlookahead: 160, dcirclejoin: 20, joinangle: .1, pathIterations: 900, seedTries: 300, simplifyTolerance: 2, collideEarly: 0 },
  major: { dsep: 400, dtest: 140, dlookahead: 700 },
  main: { dsep: 1400, dtest: 600, dlookahead: 1800 },
  water: { coastNoise: { noiseEnabled: true, noiseSize: 150, noiseAngle: 20 }, riverNoise: { noiseEnabled: true, noiseSize: 150, noiseAngle: 20 },
    riverBankSize: 14, riverSize: 58, pathIterations: 10000, simplifyTolerance: 5, coastRadius: 70, riverRadius: 90 },
  noise: { globalNoise: false, noiseSizePark: 80, noiseAnglePark: 90, noiseSizeGlobal: 150, noiseAngleGlobal: 20 },
  // A big park is a face of the main and major roads no bigger than maxArea,
  // chosen before the minor roads so their paths wind through it. Small
  // parks are finished blocks between smallArea[0] and [1], picked last.
  parks: { big: 1, small: 4, clusterBig: false, maxLength: 80, minArea: 2000, maxArea: 280000, bigArea: 110000, smallArea: [4500, 30000], spacing: 320 },
  // Lots in a strip round each block (see lots.js); style(centre, district,
  // downtown) may give each block its own depth and frontages. Thin blocks
  // are cut across into lots between minArea and twice that. A few blocks
  // stay whole, for a hall or a works.
  lots: { maxLength: 400, minArea: 380, downtownMinArea: 640, chanceNoDivide: .04, maxLotArea: 9000, style: null },
  ring: { inset: 45, radius: 240, wander: 16 },
  // The city is an island: the shore stands this far beyond the ring road,
  // in bays and headlands, and the sea runs on to the edge of the world. The
  // coast road's water's edge is `quay` beyond its kerb.
  shore: { reach: [60, 300], quay: 6, sea: 2400 },
  // Every dead end reaches the next street or is cut back to its last junction:
  // a road that stops inside a block would run under its pavement and lots
  network: { stub: 18, reach: 150, keepOver: Infinity },
  coast: true, river: true, closed: true,
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
  // The ring road closes every block at the edge of the city. It depends only
  // on the domain and the sea, so the parks can already be closed by it.
  const ring = o.closed ? ringRoad(origin, dimensions, { ...o.ring, noise: field.noise2D }) : null;
  const ringArea = ring ? offsetPolygon(ring.slice(0, -1), 3) : null;
  const insideRing = ring ? p => insidePolygon(p, ringArea) : () => true;
  let ringRuns = [];
  if (ring) {
    // Start the loop on land so a run never wraps round its first point; it
    // stops just across the coast road
    const ringPolygon = ring.slice(0, -1), onShore = p => !insidePolygon(p, water.seaPolygon), start = Math.max(0, ringPolygon.findIndex(onShore));
    const loop = [...ringPolygon.slice(start), ...ringPolygon.slice(0, start + 1)];
    ringRuns = water.seaPolygon.length >= 3 ? clipInside(loop, water.seaPolygon, .6, false) : [loop];
  }
  lap('water');
  // Each class of road is integrated, joined, simplified and then rounded,
  // so everything built on it later sees the final centre lines.
  const roads = (params, existing, ignoreRiver, radius) => {
    const generator = new StreamlineGenerator(integrator, origin, dimensions, { ...params }, random);
    for (const s of existing) generator.addExistingStreamlines(s);
    field.ignoreRiver = ignoreRiver;
    generator.createAllStreamlines();
    field.ignoreRiver = false;
    generator.allStreamlinesSimple = generator.allStreamlinesSimple.map(s => filletPolyline(s, radius));
    return generator;
  };
  const main = roads(mainParams, [water], true, BEND_RADIUS.main); lap('main');
  const major = roads(majorParams, [water, main], true, BEND_RADIUS.major); lap('major');
  const pickParks = (streamlines, count, cluster = false, target = 0) => {
    const graph = new Graph(streamlines, minorParams.dstep, false);
    const finder = new PolygonFinder(graph.nodes, { maxLength: o.parks.maxLength, minArea: o.parks.minArea, shrinkSpacing: 4, chanceNoDivide: 1 }, field, random);
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
  const minor = roads(minorParams, [water, main, major], false, BEND_RADIUS.minor); lap('minor');

  let roadList = [];
  for (const points of main.allStreamlinesSimple) roadList.push({ kind: 'main', points });
  for (const points of major.allStreamlinesSimple) roadList.push({ kind: 'major', points });
  for (const points of minor.allStreamlinesSimple) roadList.push({ kind: 'minor', points });
  const waterRoads = water.allStreamlinesSimple.slice();
  const coastLine = water.hasCoast ? waterRoads.shift() : null;
  if (coastLine) roadList.push({ kind: 'coast', points: coastLine });
  for (const points of waterRoads) roadList.push({ kind: 'riverbank', points });
  if (water.riverSecondaryRoad.length > 1) roadList.push({ kind: 'riverbank', points: water.riverSecondaryRoad });
  // Minor roads that wind through a park are its paths. A road that leaves a
  // park is split exactly where it crosses the park's edge, so the street
  // outside stays a street however long the segment that crosses.
  if (field.parks.length) {
    const split = [];
    const crossing = (a, b) => {
      for (const park of field.parks) for (let k = 0; k < park.length; k++) {
        const hit = segmentIntersection(a, b, park[k], park[(k + 1) % park.length]);
        if (hit) return hit;
      }
      return a.clone().add(b).multiplyScalar(.5);
    };
    for (const road of roadList) {
      if (road.kind !== 'minor') { split.push(road); continue; }
      const inside = road.points.map(p => field.inParks(p));
      let run = [road.points[0]], runInside = inside[0];
      for (let i = 1; i < road.points.length; i++) {
        if (inside[i] === runInside) { run.push(road.points[i]); continue; }
        // The crossing point belongs to both runs
        const edge = crossing(road.points[i - 1], road.points[i]);
        run.push(edge);
        if (run.length > 1) split.push({ kind: runInside ? 'path' : 'minor', points: run });
        run = [edge, road.points[i]]; runInside = inside[i];
      }
      if (run.length > 1) split.push({ kind: runInside ? 'path' : 'minor', points: run });
    }
    roadList = split.map(road => road.kind === 'path' ? { ...road, points: filletPolyline(road.points, BEND_RADIUS.path) } : road);
  }
  // Streets end on the ring
  if (ring) {
    const ringPolygon = ring.slice(0, -1);
    roadList = roadList.flatMap(road => clipInside(road.points, ringPolygon).map(points => ({ ...road, points })));
    for (const points of ringRuns) if (points.length > 1) roadList.push({ kind: 'ring', points });
  }
  // Trim overshoots, carry dead ends on to the next street, drop orphans
  roadList = cleanNetwork(roadList, { ...o.network, halfWidthOf: kind => (ROAD_PROFILES[kind] ?? ROAD_PROFILES.minor).halfWidth,
    canCross: (p, road) => field.onLand(p) && insideRing(p) && (road.kind === 'path') === field.inParks(p) });
  roadList = pruneNetwork(roadList, { stub: o.network.stub, Graph });
  // Roads meeting end to end at an angle: a dog-leg by a junction goes, any other corner is rounded
  roadList = joinCorners(roadList, { radiusOf: kind => BEND_RADIUS[kind] ?? BEND_RADIUS.minor });
  // kinks between junctions are eased into curves, and a park path's entrance
  // stands clear of the junctions along its street
  roadList = easeKinks(roadList);
  roadList = easePathEnds(roadList);
  for (const road of roadList) road.profile = ROAD_PROFILES[road.kind];
  lap('network');
  // Land and water for the whole world, from the island's outline, the coast
  // road's promenade and the river's channel
  let shore = null;
  if (ring) {
    let coast = null;
    if (coastLine && water.seaPolygon.length >= 3) {
      const probe = coastLine[Math.floor(coastLine.length / 2)], next = coastLine[Math.floor(coastLine.length / 2) + 1] ?? coastLine[coastLine.length - 2];
      const dx = next.x - probe.x, dy = next.y - probe.y, length = Math.hypot(dx, dy) || 1;
      const left = new Vector(probe.x - dy / length * 30, probe.y + dx / length * 30);
      coast = { line: coastLine, reach: ROAD_PROFILES.coast.halfWidth + o.shore.quay, seaSide: insidePolygon(left, water.seaPolygon) ? 1 : -1 };
    }
    const harbour = harbourWater(coast), waterLine = harbour?.slice(1, -3);
    const seaDistance = harbour ? p => insidePolygon(p, harbour) ? 0 : distanceToPolyline(p, waterLine) : null;
    const island = islandOutline(ring, { reach: o.shore.reach, seaDistance, noise: field.noise2D });
    const river = water.hasRiver && water.riverCentre?.length > 1 ? { centre: water.riverCentre, halfWidth: waterParams.riverSize - waterParams.riverBankSize } : null;
    const bounds = { minX: origin.x - o.shore.sea, minY: origin.y - o.shore.sea, maxX: origin.x + width + o.shore.sea, maxY: origin.y + height + o.shore.sea };
    shore = { island, coast, ...landAndWater({ island, coast, river, bounds }), bounds };
  }
  lap('shore');
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
  const radial = field.basisFields.find(basis => basis.FIELD_TYPE === FIELD_TYPE.Radial);
  const downtownDistance = p => radial ? Math.hypot(p.x - radial.centre.x, p.y - radial.centre.y) / Math.max(1, radial._size) : 2;
  // Which grid basis field shapes the streets at a point: each grid is a
  // neighbourhood with its own street orientation. (Downtown is the radial
  // field, given separately as downtownDistance.)
  const districtAt = (x, y) => {
    const point = new Vector(x, y);
    let best = -1, bestWeight = 0, nearest = 0, nearestDistance = Infinity;
    field.basisFields.forEach((basis, i) => {
      if (basis.FIELD_TYPE !== FIELD_TYPE.Grid) return;
      const weight = basis.getTensorWeight(point, false), distance = point.distanceTo(basis.centre) / Math.max(1, basis._size);
      if (weight > bestWeight) { bestWeight = weight; best = i; }
      if (distance < nearestDistance) { nearestDistance = distance; nearest = i; }
    });
    return best >= 0 ? best : nearest;
  };
  const finder = new PolygonFinder(lotGraph.nodes, { maxLength: o.lots.maxLength, shrinkSpacing: (a, b) => halfWidthAt(a, b) + SIDEWALK }, field, random);
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
  const clearOfRoads = p => { const hit = roadIndex.nearest(p.x, p.y, 25, (segment, distance) => distance - segment.road.profile.halfWidth); return hit ? hit.score : Infinity; };
  // A sliver where two roads meet at a shallow angle cannot hold a kerb; if its
  // pavement would reach onto a carriageway it is left as verge
  for (const block of blocks) if (block.sidewalk.some(p => clearOfRoads(p) < -.75)) { block.sidewalk = []; block.broken = true; }
  // Small parks and squares: whole blocks, well apart, away from the water
  const parks = bigParks.map(polygon => ({ polygon, kind: 'park', block: -1 }));
  const candidates = blocks.map((block, index) => ({ block, index, area: calcPolygonArea(block.polygon), centre: polygonCentroid(block.polygon) }))
    .filter(({ block, area }) => area >= o.parks.smallArea[0] && area <= o.parks.smallArea[1] && block.polygon.every(p => insideRing(p) && field.onLand(p)));
  for (let tries = 0; tries < 60 && parks.length < bigParks.length + o.parks.small && candidates.length; tries++) {
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
    const block = blocks[index], inner = shrunk.length >= 3 ? chamferAcute(shrunk) : shrunk;
    block.inner = block.broken ? [] : inner;
    if (block.inner.length < 3 || block.park) return;
    const centre = polygonCentroid(inner), district = districtAt(centre.x, centre.y), downtown = downtownDistance(centre);
    const style = { ...defaultStyle(centre, district, downtown), ...(o.lots.style?.(centre, district, downtown) ?? {}) };
    block.district = district;
    let result = null;
    if (random() < o.lots.chanceNoDivide && calcPolygonArea(inner) <= o.lots.maxLotArea) {
      const whole = throughLots(inner, Infinity, random);
      result = { lots: whole.length ? whole : [] };
      if (result.lots.length) { result.lots[0].whole = true; }
    }
    if (!result?.lots.length) result = frontageLots(inner, style, random) ?? frontageLots(inner, { ...style, depth: style.depth * .65 }, random);
    if (result?.yard) block.yard = result.yard;
    // Every lot keeps its pavement between it and the street
    const pieces = (result?.lots ?? throughLots(inner, style.minArea, random)).filter(lot => lot.polygon.every(p => clearOfRoads(p) > SIDEWALK * .7));
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
    parks: parks.map(park => park.polygon), parkInfo: parks, blocks, lots, lotBlocks, lotEdges, lotDepths, nav, field,
    districts: field.basisFields.map((basis, index) => ({ index, radial: basis.FIELD_TYPE === FIELD_TYPE.Radial, centre: basis.centre, size: basis._size })),
    districtAt, downtownDistance,
    sampleDirection: (x, y) => field.samplePoint(new Vector(x, y)).getMajor(),
    timings,
  };
}

export function cityStats(city) {
  const length = kind => city.roads.filter(r => r.kind === kind).reduce((sum, r) => sum + r.points.slice(1).reduce((acc, p, i) => acc + p.distanceTo(r.points[i]), 0), 0);
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
export { polygonCentroid };
