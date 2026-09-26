import { CITY, SIDEWALK, QUAY, PolygonIndex, cityStyleDistrict } from './city.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL, waterAt, onRoadAt, surfaceAt } from './city-route.js';
import { junctionGeometry, CROSSWALK, stopLineDistance } from './junction-geometry.js';
import { junctionControls } from '../city-junctions.js';
import { cityMedians, MEDIAN_KERB } from './city-medians.js';
import { cityParks, parkClear, pondShore, circle, SQUARE_WALK, BED_COLOURS } from './city-parks.js';
import { parkSurfaces } from './city-park-surfaces.js';
import { faceYaw, alongYaw } from './city-layout-render.js';
import { randomAt, seededRandom } from './route.js';
import { offsetPolyline, offsetPolylineClean, offsetPolygon, insidePolygon, polygonBounds, calcPolygonArea, signedArea, distanceToPolyline, averagePoint } from '../mapgen/polygon-util.js';
import { cityPlaces, placeForBlock } from '../city-exploration.js';
import { cityIslands, islandFor } from './city-islands.js';
import { rectanglePolygon } from './city-surfaces.js';
import { frontSetback, treeRoom } from './city-buildings.js';
import { yardParking, yardDrive, YARD_BAY, PARKED_MODELS } from './city-yards.js';
import { difference, solids } from '../mapgen/booleans.js';
import { simplify } from '../mapgen/simplify.js';

// The streets as the city draws and furnishes them. Everything here is laid
// out from the same few models: the road centre lines and their profiles, the
// kerbs (block pavements with rounded corners), the junction geometry and the
// quays. So a crosswalk starts where the kerb corner ends, the stop line and
// the sign stand behind it on the approach's own right-hand pavement, and a
// lamp or tree only ever stands on a pavement.

const LAMP_SPACING = 27;
// The old town's and the garden quarter's own streets are lit by lanterns on
// short posts, closer together, where a tall street lamp would stand over the
// houses; their avenues and every busier road keep the tall lamps
const LANTERN_DISTRICTS = new Set(['Old town', 'Garden quarter']);
const LANTERN_SPACING = 21;
// Street trees by district: the garden and civic quarters' streets are
// avenues of big trees, the old town's lanes are too narrow for any and its
// other streets have small ones, and the warehouses have them only here and
// there. Each district's trees are sized to its pavements, so their crowns
// clear the house fronts. `share` is the share of blocks planted.
const STREET_TREES = {
  'Garden quarter': { share: 1, spacing: 16, scale: [7.6, 10] },
  'Civic quarter': { share: 1, spacing: 17, scale: [7.2, 9.4] },
  'Market district': { share: .85, spacing: 19, scale: [6, 7.8] },
  'Old town': { share: .8, spacing: 21, scale: [5.4, 6.8] },
  'Warehouse district': { share: .4, spacing: 22, scale: [6.4, 8.4] },
  Midtown: { share: .5, spacing: 19, scale: [7, 9] },
};
const PARK_TREES = { share: 1, spacing: 19, scale: [7.2, 9.6] };
// A tree's crown reaches about half its scale from the trunk (see
// city-assets.js), and keeps that far and a little more from whatever a crown
// would swallow or hide: a lamp's column and the head on its arm, a sign or
// signal a driver has to see, and a bus shelter's roof
const TREE_CROWN = .5;
const CROWN_CLEAR = { lamp: .5, 'median-lamp': .5, 'street-lantern': .3, stop: 1.2, yield: 1.2, signal: 1.2, sign: 2, 'parking-sign': .4, shelter: 2.4 };
// The share of street corners with a litter bin by the crossing, as busy as
// each district's pavements are
const CORNER_BINS = { 'Market district': .55, Midtown: .55, 'Old town': .45, 'Civic quarter': .4, 'Warehouse district': .12, 'Garden quarter': .1 };
// A parking bay's length along the kerb
export const PARKING_BAY = 6.5;
export const COLOURS = {
  road: '#666c70', marking: '#d8bd80', line: '#d7d8c9', stripe: '#deddd0', stop: '#e1dfce',
  pavement: '#acafa8', kerb: '#9a9d98', lawn: '#79a05a', median: '#779757', medianKerb: '#c3bfab',
  quay: '#b3aea0', land: '#8e9b6a', path: '#b9ad8e', plaza: '#c2b9a3', flags: '#b1a78f', coping: '#c9c1ad', crossing: '#9c9e97',
  deck: '#8f8b80', deckUnder: '#6f6b63', pier: '#7d7a72', cap: '#d6cfbd', timber: '#a37758', iron: '#3d4246',
};
// A park pond's water, a little below its lawn and clear of the ground under
// it however its waves move
const POND_LEVEL = ROAD_LEVEL + .08;

// Points every `step` metres along a polyline, with the unit tangent
export function alongPolyline(points, step, offset = 0) {
  const out = [];
  let travelled = 0, next = offset;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    const tx = dx / length, ty = dy / length;
    while (next <= travelled + length) {
      const d = next - travelled;
      out.push({ x: a.x + tx * d, y: a.y + ty * d, tx, ty, distance: next, segment: i });
      next += step;
    }
    travelled += length;
  }
  return out;
}
// The point `distance` along a polyline, with the unit tangent (null off either end)
function pointAlong(points, distance) {
  let travelled = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    if (distance < travelled) return null;
    if (distance <= travelled + length) {
      const t = (distance - travelled) / length;
      return { x: a.x + dx * t, y: a.y + dy * t, tx: dx / length, ty: dy / length, distance, segment: i };
    }
    travelled += length;
  }
  return null;
}
// The part of a polyline between two distances along it
export function slicePolyline(points, from, to) {
  const out = [];
  let travelled = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 1e-9 && travelled + length >= from && travelled <= to) {
      const t0 = Math.max(0, (from - travelled) / length), t1 = Math.min(1, (to - travelled) / length);
      const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 }, p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      if (!out.length || Math.hypot(out[out.length - 1].x - p0.x, out[out.length - 1].y - p0.y) > 1e-6) out.push(p0);
      if (Math.hypot(out[out.length - 1].x - p1.x, out[out.length - 1].y - p1.y) > 1e-6) out.push(p1);
    }
    travelled += length;
  }
  return out;
}
const polylineLength = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

// How far a road's carriageway reaches from its centre line on one side at
// a point: to its kerb, or where a bridge's footway takes the edge of the road
function kerbReach(p, nx, ny, halfWidth) {
  for (let d = Math.max(0, halfWidth - 3.2); d < halfWidth; d += .1) if (CITY.pavement.find(p.x + nx * d, p.y + ny * d)?.kind === 'bridge') return d;
  return halfWidth;
}
// Where a street's own markings may run: from beyond the crosswalk at one end
// to beyond the crosswalk at the other.
function markedSpan(edge, geometry) {
  const end = id => { const clear = geometry.get(id)?.approaches.get(edge)?.clear; return clear === undefined ? 2 : clear + CROSSWALK + 1.2; };
  return [end(edge.a), edge.length - end(edge.b)];
}

// Parking paint and parked cars share the openings in the kerb. These
// rectangles are built once; they do not change the road or navigation.
let parkingOpenings = null;
export function parkingGaps() {
  if (parkingOpenings) return parkingOpenings;
  const index = new PolygonIndex(), gaps = [];
  const add = (x, y, tx, ty, width, into, out) => {
    const at = (along, depth) => ({ x: x + tx * along - ty * depth, y: y + ty * along + tx * depth });
    const polygon = [at(-width / 2, -out), at(width / 2, -out), at(width / 2, into), at(-width / 2, into)];
    gaps.push({ polygon, bounds: polygonBounds(polygon) }); index.add(polygon, true);
  };
  for (const block of CITY.blocks) {
    const d = yardDrive(block.index);
    if (d) add(d.mouth.x, d.mouth.y, d.tx, d.ty, d.width + 1.2, 1, SIDEWALK + 5);
  }
  // Crossings at every park gate span both sides of the road, including
  // gates other than the park's named passenger destination.
  for (const layout of CITY.parkLayouts ?? []) for (const gate of layout.gates) {
    const dx = gate.x - gate.street.x, dy = gate.y - gate.street.y, length = Math.hypot(dx, dy);
    if (length < 1) continue;
    add(gate.street.x, gate.street.y, dy / length, -dx / length, CROSSWALK + 2, gate.profile.halfWidth + 1, gate.profile.halfWidth + 1);
  }
  // A square's smaller walks also reach its surrounding streets. Reserve
  // just their own kerb, rather than an empty circle across the whole road.
  for (const { park, walks } of cityParks()) if (park.square) for (const walk of walks) {
    if (walk.length < 2 || Math.hypot(walk[0].x - walk.at(-1).x, walk[0].y - walk.at(-1).y) < .1) continue;
    for (const end of [0, walk.length - 1]) {
      const p = walk[end];
      if (distanceToPolyline(p, [...park.lawn, park.lawn[0]]) > 1) continue;
      const road = CITY.roadIndex.nearest(p.x, p.y, 24, (s, d) => s.road.kind === 'path' ? Infinity : d);
      if (!road?.road.profile.parking) continue;
      const dx = p.x - road.x, dy = p.y - road.y, length = Math.hypot(dx, dy);
      if (length < 1) continue;
      add(p.x, p.y, dy / length, -dx / length, SQUARE_WALK * 2 + 2, 1, Math.max(0, length - road.road.profile.parking + .3));
    }
  }
  for (const p of cityPlaces()) if (p.footprint) {
    const f = p.footprint, service = p.type === 'depot' || p.type === 'firehouse';
    const reach = -((p.entrance.u - f.front.x) * f.nx + (p.entrance.s - f.front.y) * f.ny);
    add(f.front.x, f.front.y, f.tx, f.ty, service ? f.width + 2 : 7, 1, Math.max(0, reach));
  }
  parkingOpenings = { gaps, index };
  return parkingOpenings;
}

// Clip the full painted width, including ticks, so no thin line remains
// through a crossing. Bounds reject almost every opening before clipping.
export function clearParkingMark(polygon, gaps = parkingGaps().gaps) {
  const b = polygonBounds(polygon);
  const nearby = gaps.filter(({ bounds: q }) => q.minX <= b.maxX && q.maxX >= b.minX && q.minY <= b.maxY && q.maxY >= b.minY);
  return nearby.length ? difference(solids([polygon]), solids(nearby.map(g => g.polygon))) : [{ outer: polygon, holes: [] }];
}
// A point on an approach `distance` from its junction node, with the unit
// direction away from the node and the arriving driver's right-hand normal.
function approachPoint(nav, edge, node, distance) {
  const away = edge.a === node.id ? 1 : -1, p = nav.pose(edge, distance, away);
  return { x: p.u, y: p.s, tx: p.tx, ty: p.ty, rx: -p.ty, ry: p.tx };
}

// A crosswalk where a road leaves a junction, as its stripes span it,
// wherever the junction's control marks one (see city-junctions.js: at a
// signal, wherever traffic stops, and downtown across the quieter streets; a
// link inside a junction complex has none). Two junctions a few metres apart
// can lay two crosswalks over each other: the one across the narrower road
// gives way.
const crosswalkCache = new WeakMap(), CONTROL_RANK = { signal: 3, stop: 2, yield: 1, priority: 0 };
export function cityCrosswalks(nav) {
  if (crosswalkCache.has(nav)) return crosswalkCache.get(nav);
  const geometry = junctionGeometry(nav), controls = junctionControls(nav), all = [];
  for (const [node, control] of controls) {
    const shape = geometry.get(node.id);
    for (const [edge, approach] of control.approaches) {
      const arm = shape.approaches.get(edge), halfWidth = edge.profile.halfWidth;
      if (arm.link || !approach.crosswalk) continue;
      const near = approachPoint(nav, edge, node, arm.clear + .2), far = approachPoint(nav, edge, node, arm.clear + CROSSWALK);
      const at = (p, across) => ({ x: p.x + p.rx * across, y: p.y + p.ry * across });
      // (across the carriageway, kerb to kerb: on a bridge, footway to footway)
      const middle = { x: (near.x + far.x) / 2, y: (near.y + far.y) / 2 };
      const left = -kerbReach(middle, -near.rx, -near.ry, halfWidth) + .8, right = kerbReach(middle, near.rx, near.ry, halfWidth) - .5;
      all.push({ node, edge, near, far, halfWidth, left, right, rank: CONTROL_RANK[approach.kind] ?? 0, outline: [at(near, left), at(near, right), at(far, right), at(far, left)] });
    }
  }
  // A street short enough that the crosswalks at its two ends all but meet
  // keeps one: the one where its traffic has to stop
  const byEdge = new Map();
  for (const walk of all) { if (!byEdge.has(walk.edge)) byEdge.set(walk.edge, []); byEdge.get(walk.edge).push(walk); }
  const middle = walk => ({ x: (walk.near.x + walk.far.x) / 2, y: (walk.near.y + walk.far.y) / 2 });
  for (const pair of byEdge.values()) {
    if (pair.length !== 2) continue;
    const [a, b] = pair, ma = middle(a), mb = middle(b);
    if (Math.hypot(ma.x - mb.x, ma.y - mb.y) >= CROSSWALK + 5) continue;
    const lesser = a.rank !== b.rank ? (a.rank < b.rank ? a : b) : a.node.id > b.node.id ? a : b;
    all.splice(all.indexOf(lesser), 1);
  }
  all.sort((a, b) => b.halfWidth - a.halfWidth || a.edge.id - b.edge.id || a.node.id - b.node.id);
  const kept = [], cells = new Map();
  for (const walk of all) {
    const c = walk.outline[0], cx = Math.floor(c.x / 40), cy = Math.floor(c.y / 40);
    let clear = true;
    for (let dx = -1; dx <= 1 && clear; dx++) for (let dy = -1; dy <= 1 && clear; dy++) {
      for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) if (convexOverlap(other.outline, walk.outline, .3)) { clear = false; break; }
    }
    if (!clear) continue;
    kept.push(walk);
    const key = `${cx},${cy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(walk);
  }
  crosswalkCache.set(nav, kept);
  return kept;
}
// Whether two convex polygons overlap by more than `margin` (separating axes)
export function convexOverlap(a, b, margin = 0) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length < 1e-9) continue;
    const ax = -(q.y - p.y) / length, ay = (q.x - p.x) / length;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of a) { const d = v.x * ax + v.y * ay; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const v of b) { const d = v.x * ax + v.y * ay; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 + margin || b1 < a0 + margin) return false;
  }
  return true;
}

// Roads, markings, junctions, pavements, parks and water, into the static
// surfaces: ground (vertex coloured), roads (the road material, which rain
// darkens), paths, water and walls.
export function buildStreetSurfaces({ ground, roads, paths, water, walls }, nav, bridges) {
  const geometry = junctionGeometry(nav), controls = junctionControls(nav);
  // The island under everything
  for (const piece of CITY.land) ground.polygon(piece.outer, ROAD_LEVEL - .06, COLOURS.land, null, true, piece.holes);
  // Carriageways, and the corners the rounded kerbs hand back to them
  const parkPaths = CITY.roads.filter(road => road.kind === 'path');
  for (const road of CITY.roads) if (road.kind !== 'path') roads.ribbon(road.points, road.profile.halfWidth, ROAD_LEVEL, COLOURS.road);
  for (const patch of CITY.cornerPatches) roads.polygon(patch, ROAD_LEVEL, COLOURS.road);
  // Markings along each street between its junctions: lanes down a
  // boulevard, a double centre line down an avenue, a dashed one down a
  // collector, and none on a local street
  const markings = ground;
  const dashed = (line, every, length, width, colour, offset = 0) => {
    for (const p of alongPolyline(line, every, offset)) {
      const dash = slicePolyline(line, p.distance, p.distance + length);
      if (dash.length > 1) markings.ribbon(dash, width, ROAD_LEVEL + .012, colour);
    }
  };
  for (const edge of nav.edges) {
    if (edge.kind === 'path') continue;
    const profile = edge.profile, [from, to] = markedSpan(edge, geometry);
    if (to - from < 4) continue;
    const span = slicePolyline(edge.points, from, to);
    if (profile.kind === 'boulevard') {
      // Two lanes each way either side of the median, and a line along each edge
      for (const side of [-1, 1]) {
        dashed(offsetPolyline(span, side * profile.divider), 9, 4.5, .11, COLOURS.line, 2);
        markings.ribbon(offsetPolyline(span, side * (profile.halfWidth - .6)), .12, ROAD_LEVEL + .012, COLOURS.line);
      }
    } else if (profile.centre === 'double') for (const side of [-1, 1]) markings.ribbon(offsetPolyline(span, side * .16), .11, ROAD_LEVEL + .012, COLOURS.marking);
    else if (profile.centre === 'dashed') dashed(span, 9, 3.5, .12, COLOURS.marking, 2.5);
    if (profile.parking) {
      // Parking bays along both kerbs: a line along their outside, and a tick between bays
      const paint = polygon => {
        for (const p of clearParkingMark(polygon)) markings.polygon(p.outer, ROAD_LEVEL + .012, COLOURS.line, null, true, p.holes);
      };
      for (const side of [-1, 1]) {
        const line = offsetPolyline(span, side * profile.parking), left = offsetPolyline(line, .07), right = offsetPolyline(line, -.07);
        for (let i = 0; i < line.length - 1; i++) paint([left[i], right[i], right[i + 1], left[i + 1]]);
        for (const p of alongPolyline(span, PARKING_BAY, PARKING_BAY / 2)) {
          const nx = -p.ty * side, ny = p.tx * side, a = profile.parking, b = profile.halfWidth - .3;
          paint([{ x: p.x + nx * a - p.tx * .05, y: p.y + ny * a - p.ty * .05 }, { x: p.x + nx * b - p.tx * .05, y: p.y + ny * b - p.ty * .05 },
            { x: p.x + nx * b + p.tx * .05, y: p.y + ny * b + p.ty * .05 }, { x: p.x + nx * a + p.tx * .05, y: p.y + ny * a + p.ty * .05 }]);
        }
      }
    }
  }
  // Raised medians down the boulevards and the ring's parkway, kerbed, with
  // grass on land and stone across the bridges (see city-medians.js)
  for (const median of cityMedians(nav).list) {
    const top = ROAD_LEVEL + MEDIAN_KERB;
    ground.polygon(median.polygon, top, COLOURS.medianKerb);
    for (const lawn of median.lawns) ground.polygon(lawn.outer, top + .015, COLOURS.median, null, true, lawn.holes);
    ground.wall(clockwise(median.polygon), top, ROAD_LEVEL - .02, COLOURS.medianKerb, true);
  }
  // Crosswalks where each road leaves a junction, stop lines behind them
  for (const { near, far, left, right } of cityCrosswalks(nav)) {
    const at = (p, across) => ({ x: p.x + p.rx * across, y: p.y + p.ry * across });
    for (let across = left; across < right; across += 1.6) {
      markings.polygon([at(near, across), at(near, across + .85), at(far, across + .85), at(far, across)], ROAD_LEVEL + .014, COLOURS.stripe);
    }
  }
  // (a stop line or a row of teeth that would fall on a crosswalk, where two
  // junctions are close, is left out: the crosswalk marks where to stop)
  // (only a crosswalk whose bounds reach the mark's can: two convex outlines
  // apart are apart along some edge's normal)
  const crosswalks = cityCrosswalks(nav), bounds = crosswalks.map(walk => polygonBounds(walk.outline));
  const onCrosswalk = mark => {
    const b = polygonBounds(mark);
    return crosswalks.some((walk, i) => bounds[i].minX <= b.maxX && bounds[i].maxX >= b.minX && bounds[i].minY <= b.maxY && bounds[i].maxY >= b.minY
      && convexOverlap(walk.outline, mark, .02));
  };
  for (const [node, control] of controls) {
    const shape = geometry.get(node.id);
    for (const [edge, approach] of control.approaches) {
      const arm = shape.approaches.get(edge), halfWidth = edge.profile.halfWidth;
      if (arm.link || approach.kind === 'priority') continue;
      const at = (p, across) => ({ x: p.x + p.rx * across, y: p.y + p.ry * across });
      // (to the kerb, or on a bridge to its footway)
      const at0 = approachPoint(nav, edge, node, stopLineDistance(arm.clear)), kerb = kerbReach(at0, at0.rx, at0.ry, halfWidth);
      const inner = edge.profile.median ? edge.profile.median + .2 : .25, outer = Math.min(kerb, halfWidth - (edge.profile.parking ? halfWidth - edge.profile.parking : 0)) - (edge.profile.parking ? .2 : .4);
      if (approach.kind === 'yield') {
        // A row of teeth across the lane, pointing at the driver who gives way
        const base = approachPoint(nav, edge, node, stopLineDistance(arm.clear) - .3), tip = approachPoint(nav, edge, node, stopLineDistance(arm.clear) + .6);
        const teeth = [];
        for (let across = inner + .15; across + .55 <= outer; across += .85) teeth.push([at(base, across), at(base, across + .55), at(tip, across + .275)]);
        if (!teeth.some(onCrosswalk)) for (const tooth of teeth) markings.polygon(tooth, ROAD_LEVEL + .014, COLOURS.stop);
        continue;
      }
      const line = approachPoint(nav, edge, node, stopLineDistance(arm.clear) - .2), back = approachPoint(nav, edge, node, stopLineDistance(arm.clear) + .25);
      const stop = [at(line, inner), at(line, kerb - .4), at(back, kerb - .4), at(back, inner)];
      if (!onCrosswalk(stop)) markings.polygon(stop, ROAD_LEVEL + .014, COLOURS.stop);
    }
  }
  // A zebra crossing over the street at each park gate (a median stops either side of it)
  for (const layout of CITY.parkLayouts ?? []) for (const gate of layout.gates) {
    const { street, profile } = gate, nx = gate.x - street.x, ny = gate.y - street.y, length = Math.hypot(nx, ny);
    if (length < 1) continue;
    const n = { x: nx / length, y: ny / length }, t = { x: -n.y, y: n.x }, half = CROSSWALK / 2;
    const at = (across, along) => ({ x: street.x + n.x * across + t.x * along, y: street.y + n.y * across + t.y * along });
    for (let across = -profile.halfWidth + .8; across < profile.halfWidth - .5; across += 1.6) {
      markings.polygon([at(across, -half), at(across + .85, -half), at(across + .85, half), at(across, half)], ROAD_LEVEL + .014, COLOURS.stripe);
    }
  }
  // Pavements with kerbs, the parks and squares, and the ground inside each block
  for (const block of CITY.blocks) {
    if (block.kerb.length < 3) continue;
    ground.polygon(block.kerb, PAVEMENT_LEVEL, COLOURS.pavement);
    ground.wall(clockwise(block.kerb), PAVEMENT_LEVEL, ROAD_LEVEL - .02, COLOURS.kerb, true);
    // A block with no lot is a planted island
    const island = islandFor(block.index);
    if (island) { ground.polygon(island.lawn, PAVEMENT_LEVEL + .02, COLOURS.lawn); continue; }
    if (block.park || block.inner.length < 3) continue;
    ground.polygon(block.inner, PAVEMENT_LEVEL + .02, blockGround(block));
    if (block.yard?.length >= 3 && !placeForBlock(block.index)) ground.polygon(block.yard, PAVEMENT_LEVEL + .035, yardGround(block));
    // The driveway into a car park, paved as its yard is, and a dropped kerb
    // across the pavement at its mouth
    const drive = yardDrive(block.index);
    if (drive) {
      ground.polygon(drive.polygon, PAVEMENT_LEVEL + .035, yardGround(block));
      const { mouth: m, tx, ty, nx, ny, width } = drive, at = (along, into) => ({ x: m.x + tx * along + nx * into, y: m.y + ty * along + ny * into });
      if (drive.crossing) ground.polygon(drive.crossing, PAVEMENT_LEVEL + .01, COLOURS.crossing);
      // (and the driveway's edge where it meets it)
      ground.wall([at(-width / 2, 0), at(width / 2, 0)], PAVEMENT_LEVEL + .035, PAVEMENT_LEVEL, yardGround(block));
    }
    // A car park's bays, lined out down each side
    for (const bay of yardParking(block)) for (const side of [-1, 1]) {
      const cx = bay.x + bay.ux * side * YARD_BAY.width / 2, cy = bay.y + bay.uy * side * YARD_BAY.width / 2, along = YARD_BAY.depth / 2 - .3;
      markings.polygon([
        { x: cx - bay.ux * .05 - bay.vx * along, y: cy - bay.uy * .05 - bay.vy * along }, { x: cx + bay.ux * .05 - bay.vx * along, y: cy + bay.uy * .05 - bay.vy * along },
        { x: cx + bay.ux * .05 + bay.vx * along, y: cy + bay.uy * .05 + bay.vy * along }, { x: cx - bay.ux * .05 + bay.vx * along, y: cy - bay.uy * .05 + bay.vy * along },
      ], PAVEMENT_LEVEL + .045, COLOURS.line);
    }
  }
  for (const entry of cityParks()) {
    const park = entry.park, holes = entry.pond ? [pondShore(entry.pond)] : [];
    if (park.kerb.length >= 3 && !park.square) {
      ground.polygon(park.kerb, PAVEMENT_LEVEL, COLOURS.pavement, null, true, holes);
      ground.wall(clockwise(park.kerb), PAVEMENT_LEVEL, ROAD_LEVEL - .02, COLOURS.kerb, true);
    }
    const paved = entry.paved;
    if (park.lawn.length >= 3) ground.polygon(park.lawn, PAVEMENT_LEVEL + .02, paved ? COLOURS.plaza : COLOURS.lawn, null, true, holes);
    // A paved square's lawns
    for (const panel of entry.panels) ground.polygon(panel.outer, PAVEMENT_LEVEL + .03, COLOURS.lawn, null, true, panel.holes);
    // One joined network, flush at its junctions and clipped across its full
    // width at the street. Quiet stone edging only where paving meets lawn.
    const paving = parkSurfaces(entry, parkPaths);
    for (const [pieces, colour] of [[paving.walks, paved ? COLOURS.flags : COLOURS.path],
      [paving.plaza, paved ? COLOURS.flags : COLOURS.plaza], [paving.edging, COLOURS.coping]]) {
      for (const piece of pieces) paths.polygon(piece.outer, PAVEMENT_LEVEL + .035, colour, null, true, piece.holes);
    }
    // A pond: water a little below the lawn, inside a low stone coping
    if (entry.pond) {
      const shore = pondShore(entry.pond), ccw = signedArea(shore) > 0 ? shore : shore.slice().reverse(), top = PAVEMENT_LEVEL + .3;
      // (each line round it closed, and mitred where it closes as everywhere else)
      const around = d => offsetPolyline([ccw.at(-1), ...ccw, ccw[0], ccw[1]], d).slice(1, -1), inner = around(.03), outer = around(-.73);
      water.polygon(shore, POND_LEVEL, '#3f7f86', () => [1, 0]);
      walls.wall(around(0).reverse(), top, POND_LEVEL - .4, COLOURS.coping);
      for (let i = 0; i < ccw.length; i++) { walls.flat(inner[i], outer[i], outer[i + 1], top, COLOURS.coping); walls.flat(inner[i], outer[i + 1], inner[i + 1], top, COLOURS.coping); }
      // (and its outer face, down to the lawn)
      walls.wall(outer, top, PAVEMENT_LEVEL, COLOURS.coping);
    }
  }
  // Quays and promenades: raised, with a kerb on the road side
  for (const walk of CITY.quays) {
    ground.polygon(walk.polygon, PAVEMENT_LEVEL, COLOURS.quay);
    ground.wall(clockwise(walk.polygon), PAVEMENT_LEVEL, ROAD_LEVEL - .02, COLOURS.kerb, true);
  }
  // Water and the quay walls that hold the city above it
  const riverCentre = CITY.riverCentre;
  const flowAt = (x, y) => {
    if (!riverCentre) return [1, 0];
    let best = 0, bestDistance = Infinity;
    for (let i = 0; i < riverCentre.length - 1; i += 2) { const d = Math.hypot(riverCentre[i].x - x, riverCentre[i].y - y); if (d < bestDistance) { bestDistance = d; best = i; } }
    const a = riverCentre[best], b = riverCentre[Math.min(riverCentre.length - 1, best + 1)], length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return [(b.x - a.x) / length, -(b.y - a.y) / length];
  };
  for (const piece of CITY.seaWater) water.polygon(piece.outer, WATER_LEVEL, '#397780', () => [1, 0], true, piece.holes);
  for (const piece of CITY.riverWater) water.polygon(piece.outer, WATER_LEVEL, '#397780', flowAt, true, piece.holes);
  // A quay run has the water on its right, which is the way a wall faces
  // (where the shore runs under a carriageway or a pavement carried on over
  // the water, at a bridge's abutment or a road along the water's edge, the
  // wall stops just under it and has no coping, rather than standing across it).
  // Elsewhere a stone coping runs along its top: a low kerb on the promenade,
  // overhanging the wall a little, solid on every side
  for (const run of CITY.walls) for (const { points, road } of shoreStretches(run)) {
    walls.wall(points, road ? ROAD_LEVEL - .03 : PAVEMENT_LEVEL, WATER_LEVEL - 1.6, '#9b9789');
    // (not a scrap of coping on a metre or two of shore left between roads)
    if (road || polylineLength(points) < 2) continue;
    const top = PAVEMENT_LEVEL + .2, outer = offsetPolyline(points, -.05), inner = offsetPolyline(points, .55);
    for (let i = 0; i < points.length - 1; i++) {
      walls.flat(outer[i], inner[i], inner[i + 1], top, COLOURS.coping); walls.flat(outer[i], inner[i + 1], outer[i + 1], top, COLOURS.coping);
    }
    walls.wall(outer, top, PAVEMENT_LEVEL, COLOURS.coping);
    // (down to the road, where one comes right up to it)
    walls.wall(inner.slice().reverse(), top, ROAD_LEVEL - .02, COLOURS.coping);
    walls.wall([outer[0], inner[0]], top, ROAD_LEVEL - .02, COLOURS.coping);
    walls.wall([inner.at(-1), outer.at(-1)], top, ROAD_LEVEL - .02, COLOURS.coping);
  }
  // Bridges: their footways, raised and paved as the promenades they carry
  // on from, kerbed all round as a promenade is
  for (const bridge of bridges) for (const footway of bridge.footways) {
    ground.polygon(footway.polygon, PAVEMENT_LEVEL, COLOURS.quay);
    ground.wall(clockwise(footway.polygon), PAVEMENT_LEVEL, ROAD_LEVEL - .02, COLOURS.kerb, true);
  }
  // Under all that is paved over the water, the deck (see layDecks in
  // city.js): its underside, its face along each edge over the water, and
  // along the top of that the quays' own stone coping, lipped a little over
  // the face (see deckEdges)
  for (const deck of CITY.decks) walls.polygon(deck.outer, DECK_BOTTOM, COLOURS.deckUnder, null, false, deck.holes);
  for (const { run, line, closed, rail } of deckEdges()) {
    walls.wall(closed ? [...run, run[0]] : run, COPING_BOTTOM, DECK_BOTTOM, COLOURS.deck);
    const outer = offsetRun(line, closed, -COPING_LIP), inner = offsetRun(line, closed, COPING_WIDTH), edge = closed ? [...line, line[0]] : line;
    for (let i = 0; i < outer.length - 1; i++) {
      walls.flat(outer[i], inner[i], inner[i + 1], COPING_TOP, COLOURS.coping); walls.flat(outer[i], inner[i + 1], outer[i + 1], COPING_TOP, COLOURS.coping);
      walls.flat(edge[i], outer[i], outer[i + 1], COPING_BOTTOM, COLOURS.coping, null, false); walls.flat(edge[i], outer[i + 1], edge[i + 1], COPING_BOTTOM, COLOURS.coping, null, false);
    }
    walls.wall(outer, COPING_TOP, COPING_BOTTOM, COLOURS.coping);
    // (its back down to the road, where there is no footway beside it)
    walls.wall(inner.slice().reverse(), COPING_TOP, ROAD_LEVEL - .02, COLOURS.coping);
    if (!closed) {
      walls.wall([inner[0], outer[0]], COPING_TOP, ROAD_LEVEL - .02, COLOURS.coping);
      walls.wall([outer.at(-1), inner.at(-1)], COPING_TOP, ROAD_LEVEL - .02, COLOURS.coping);
    }
  }
  // and on the coping a bridge's rail (see deckEdges): the parapet, a stone
  // block at each post and the truss standing on them
  for (const { rail, truss, closed } of deckEdges()) {
    for (const span of rail.spans ?? []) {
      const left = offsetPolyline(span, PARAPET / 2), right = offsetPolyline(span, -PARAPET / 2);
      const capLeft = offsetPolyline(span, PARAPET / 2 + .05), capRight = offsetPolyline(span, -PARAPET / 2 - .05), capTop = PARAPET_TOP + .08;
      walls.wall(left.slice().reverse(), PARAPET_TOP, COPING_TOP, COLOURS.coping); walls.wall(right, PARAPET_TOP, COPING_TOP, COLOURS.coping);
      walls.wall(capLeft.slice().reverse(), capTop, PARAPET_TOP - .02, COLOURS.cap); walls.wall(capRight, capTop, PARAPET_TOP - .02, COLOURS.cap);
      for (let i = 0; i < span.length - 1; i++) {
        walls.flat(capLeft[i], capRight[i], capRight[i + 1], capTop, COLOURS.cap); walls.flat(capLeft[i], capRight[i + 1], capLeft[i + 1], capTop, COLOURS.cap);
        walls.flat(capLeft[i], capRight[i], capRight[i + 1], PARAPET_TOP - .02, COLOURS.cap, null, false); walls.flat(capLeft[i], capRight[i + 1], capLeft[i + 1], PARAPET_TOP - .02, COLOURS.cap, null, false);
      }
    }
    for (const { x, y, tx, ty } of rail.posts) {
      const square = h => [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => ({ x: x + tx * a - ty * b, y: y + ty * a + tx * b }));
      walls.prism(square(.3), COPING_TOP, BLOCK_TOP - .1, COLOURS.coping);
      walls.prism(square(.36), BLOCK_TOP - .1, BLOCK_TOP, COLOURS.cap);
      walls.polygon(square(.36), BLOCK_TOP, COLOURS.cap); walls.polygon(square(.36), BLOCK_TOP - .1, COLOURS.cap, null, false);
    }
    if (truss.length) trussAlong(walls, truss, closed);
  }
  // Piers, each with a cap under the deck (see bridgePiers)
  for (const { outline } of bridgePiers()) {
    walls.prism(outline, WATER_LEVEL - 3, DECK_BOTTOM + .05, COLOURS.pier);
    const cap = offsetPolygon(outline, .15);
    if (cap.length < 3) continue;
    walls.prism(cap, DECK_BOTTOM - .35, DECK_BOTTOM, COLOURS.pier);
    walls.polygon(cap, DECK_BOTTOM - .35, COLOURS.pier, null, false);
  }
}
// Piers under each bridge, evenly between its banks: as long as the deck is
// wide there (a promenade carried over the water too), cut to a point up and
// down the stream, and never on the bank
let piers = null;
export function bridgePiers() {
  if (piers?.decks === CITY.decks) return piers.list;
  const list = [];
  for (const bridge of CITY.bridges) {
    const points = bridge.points, length = polylineLength(points), span = length - 10, count = Math.round(span / 30);
    const middle = pointAlong(points, length / 2), deck = middle && CITY.decks.find(d => insidePolygon(middle, d.outer));
    if (!deck) continue;
    const most = bridge.road.profile.halfWidth + QUAY + 1;
    for (let k = 1; k < count; k++) {
      const p = pointAlong(points, 5 + span * k / count);
      if (!p) continue;
      const nx = -p.ty, ny = p.tx, left = Math.min(most, deckReach(deck, p, nx, ny)) - .8, right = Math.min(most, deckReach(deck, p, -nx, -ny)) - .8, a = 1.1;
      if (left + right < 4) continue;
      const at = (across, along) => ({ x: p.x + nx * across + p.tx * along, y: p.y + ny * across + p.ty * along });
      const outline = [at(left, 0), at(left - a, -a), at(-right + a, -a), at(-right, 0), at(-right + a, a), at(left - a, a)];
      if (outline.some(q => [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dy]) => !waterAt(q.y + dy, q.x + dx)))) continue;
      list.push({ outline, bridge });
    }
  }
  piers = { decks: CITY.decks, list };
  return list;
}
// How far from p, going (dx, dy), to the edge of a deck
function deckReach(deck, p, dx, dy) {
  let best = Infinity;
  for (const ring of [deck.outer, ...deck.holes]) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b.x - a.x, ey = b.y - a.y, d = dx * ey - dy * ex;
    if (Math.abs(d) < 1e-12) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / d, s = ((a.x - p.x) * dy - (a.y - p.y) * dx) / d;
    if (t > 0 && s >= 0 && s <= 1) best = Math.min(best, t);
  }
  return best;
}
// A polyline offset to the left (a closed one round and back to its start)
const offsetRun = (line, closed, distance) => closed ? offsetPolyline([line.at(-1), ...line, line[0], line[1]], distance).slice(1, -1) : offsetPolyline(line, distance);

// A deck's edge over the water (see layDecks in city.js): a stone coping as
// the quays have, level with theirs, lipped over the deck's face and carried
// on at each end past the bank, where it stands on paving, to close the
// corner with the quay's coping; and a railing. Along a promenade carried
// over the water the railing is the quay's own, as far in from the edge and
// carried on to meet it on the bank; elsewhere it stands on the coping,
// whatever it passes (a footway, or the road where a junction reaches out
// over the water): a stone parapet between a block at each end and at each
// sharp turn, and a timber truss on them, as Citydriver 1's bridges had.
export const COPING_TOP = PAVEMENT_LEVEL + .2;
const COPING_BOTTOM = PAVEMENT_LEVEL - .2, COPING_WIDTH = .55, COPING_LIP = .06, RAIL_IN = .25, QUAY_RAIL_IN = 1.1, RAIL_POST = .42, RAIL_LENGTH = 4;
// (a bridge's rail: a stone parapet with a timber truss standing on it,
// posts every TRUSS_PANEL or so and braced corner to corner between them)
export const PARAPET = .45, PARAPET_TOP = PAVEMENT_LEVEL + 1.05, TRUSS_TOP = PAVEMENT_LEVEL + 6.6;
const TRUSS_PANEL = 11, BLOCK_TOP = PARAPET_TOP + .32, TRUSS_POST = .5, TRUSS_WIDE = .55, CHORD = .46, CHORD_WIDE = .48, BRACE_WIDE = .38, BRACE_DEEP = .3;
const DECK_BOTTOM = ROAD_LEVEL - 1.4;
let edges = null;
export function deckEdges() {
  if (edges?.decks === CITY.decks) return edges.list;
  // A line carried on straight at an open end, while it is still over
  // paving, by up to `reach` (inward is to its left), the way its last two
  // metres run (not the way a last short hook turns)
  const carryOn = (points, reach, inward) => {
    const line = points.map(p => ({ x: p.x, y: p.y })), length = polylineLength(line);
    // (the far end first, so carrying on the start moves neither)
    for (const end of [line.length - 1, 0]) {
      const a = line[end], b = pointAlong(line, end ? Math.max(0, length - 2) : Math.min(length, 2)) ?? line[end ? 0 : line.length - 1];
      const l = Math.hypot(a.x - b.x, a.y - b.y) || 1, tx = (a.x - b.x) / l, ty = (a.y - b.y) / l;
      // (from the start, the left going along is the right going back)
      const side = end ? 1 : -1, ix = -ty * side, iy = tx * side;
      let d = 0;
      while (d < reach && CITY.pavement.find(a.x + tx * (d + .25) + ix * inward, a.y + ty * (d + .25) + iy * inward)) d = Math.min(reach, d + .25);
      if (d < .05) continue;
      const p = { x: a.x + tx * d, y: a.y + ty * d };
      if (end) line.push(p); else line.unshift(p);
    }
    return line;
  };
  const list = [];
  for (const deck of CITY.decks) for (const { points: run, closed } of deck.runs) {
    // (a promenade: most of the way along, a quay's walk just inside the edge)
    const inside = alongPolyline(closed ? [...run, run[0]] : run, 2, 1).map(p => CITY.pavement.find(p.x - p.ty * 1.5, p.y + p.tx * 1.5)?.kind);
    const quay = inside.filter(kind => kind === 'quay').length > inside.length / 2;
    const line = closed ? run.map(p => ({ x: p.x, y: p.y })) : carryOn(run, COPING_WIDTH, COPING_WIDTH / 2);
    // (straight on across the short jog where two pavings meet)
    const straight = points => closed ? simplify([...points, points[0]], .2).slice(0, -1) : simplify(points, .2);
    const rail = quay ? railAlong(straight(closed ? offsetRun(run, true, QUAY_RAIL_IN) : carryOn(offsetPolyline(run, QUAY_RAIL_IN), 2, 0)), closed, false)
      : railAlong(straight(offsetRun(line, closed, RAIL_IN)), closed, true);
    list.push({ run, line, closed, rail, y: quay ? PAVEMENT_LEVEL : COPING_TOP, truss: quay ? [] : (rail.spans ?? []).map(trussNodes) });
  }
  edges = { decks: CITY.decks, list };
  return list;
}
// A bridge's truss over its spans' panel points, in timber: a post at each
// (those at the ends and corners on the stone blocks), a chord along the top,
// mitred round the bends and corners and carried a little past the posts at
// an open end, and a brace across each panel from post to post, zigzagging
// up and down from each end of a span so its two halves mirror each other,
// and crossed in the middle panel of an odd number
function trussAlong(surface, spans, closed) {
  const top = TRUSS_TOP + CHORD / 2, under = TRUSS_TOP - CHORD / 2, same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
  const dir = (a, b) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
  // (spans meeting at a corner post are one chord, and a ring of them closes)
  const chains = [];
  for (const nodes of spans) {
    const chain = chains.at(-1);
    if (chain && same(chain.nodes.at(-1), nodes[0])) { chain.posts.add(chain.nodes.length - 1); chain.nodes.push(...nodes.slice(1)); }
    else chains.push({ nodes: nodes.slice(), posts: new Set([0]) });
    chains.at(-1).posts.add(chains.at(-1).nodes.length - 1);
  }
  const ring = closed && chains.length === 1 && same(chains[0].nodes[0], chains[0].nodes.at(-1));
  for (const { nodes, posts } of chains) {
    const count = nodes.length - 1;
    const first = dir(nodes[0], nodes[1]), last = dir(nodes[count - 1], nodes[count]), past = TRUSS_POST / 2 + .12;
    const line = ring ? nodes.slice(0, -1) : [{ x: nodes[0].x - first.x * past, y: nodes[0].y - first.y * past }, ...nodes.slice(1, -1), { x: nodes[count].x + last.x * past, y: nodes[count].y + last.y * past }];
    const left = ring ? offsetRun(line, true, CHORD_WIDE / 2) : offsetPolyline(line, CHORD_WIDE / 2), right = ring ? offsetRun(line, true, -CHORD_WIDE / 2) : offsetPolyline(line, -CHORD_WIDE / 2);
    if (ring) { left.push(left[0]); right.push(right[0]); }
    else { surface.wall([left[0], right[0]], top, under, COLOURS.timber); surface.wall([right.at(-1), left.at(-1)], top, under, COLOURS.timber); }
    surface.wall(left.slice().reverse(), top, under, COLOURS.timber); surface.wall(right, top, under, COLOURS.timber);
    for (let i = 0; i < left.length - 1; i++) {
      surface.flat(left[i], right[i], right[i + 1], top, COLOURS.timber); surface.flat(left[i], right[i + 1], left[i + 1], top, COLOURS.timber);
      surface.flat(left[i], right[i], right[i + 1], under, COLOURS.timber, null, false); surface.flat(left[i], right[i + 1], left[i + 1], under, COLOURS.timber, null, false);
    }
    // (the posts, square to the chord either side; once where a ring closes)
    nodes.forEach((p, i) => {
      if (ring && i === count) return;
      const back = i > 0 ? i - 1 : ring ? count - 1 : null, on = i < count ? i + 1 : null;
      const a = back === null ? dir(p, nodes[on]) : dir(nodes[back], p), b = on === null ? dir(nodes[back], p) : dir(p, nodes[on]);
      const l = Math.hypot(a.x + b.x, a.y + b.y) || 1, tx = (a.x + b.x) / l, ty = (a.y + b.y) / l, h = TRUSS_POST / 2, w = TRUSS_WIDE / 2;
      const box = grow => [[-h, -w], [h, -w], [h, w], [-h, w]].map(([s, n]) => ({ x: p.x + tx * (s + Math.sign(s) * grow) - ty * (n + Math.sign(n) * grow), y: p.y + ty * (s + Math.sign(s) * grow) + tx * (n + Math.sign(n) * grow) }));
      // (standing in an iron shoe)
      const foot = posts.has(i) ? BLOCK_TOP : PARAPET_TOP + .08, shoe = foot + .24;
      // (its top closed where a corner's post reaches out from under the chord)
      surface.prism(box(0), shoe, under + .02, COLOURS.timber);
      surface.polygon(box(0), under + .02, COLOURS.timber);
      surface.prism(box(.035), foot, shoe, COLOURS.iron);
      surface.polygon(box(.035), shoe, COLOURS.iron);
    });
  }
  // (the braces, span by span)
  const low = PARAPET_TOP + .3;
  for (const nodes of spans) {
    const count = nodes.length - 1;
    for (let k = 0; k < count; k++) {
      const a = nodes[k], b = nodes[k + 1], crossed = count % 2 && k === (count - 1) / 2, rises = (count % 2 && k > count / 2 ? k - 1 : k) % 2 === 0;
      if (crossed || rises) brace(surface, a, low, b, under);
      if (crossed || !rises) brace(surface, a, under, b, low);
    }
  }
}
// A straight timber from a (at height ha) to b, BRACE_WIDE across and
// BRACE_DEEP within the upright plane it leans in; its ends are in posts
function brace(surface, a, ha, b, hb) {
  const A = [a.x, ha, -a.y], B = [b.x, hb, -b.y], length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const across = [-(b.y - a.y) / length, 0, -(b.x - a.x) / length], axis = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const deep = cross(axis, across), l = Math.hypot(...deep); deep.forEach((v, i) => { deep[i] = v / l; });
  const at = (P, s, d) => P.map((v, i) => v + across[i] * s * BRACE_WIDE / 2 + deep[i] * d * BRACE_DEEP / 2);
  // (each long face as two triangles wound to face `out`)
  for (const [s, d, out] of [[1, 0, across], [-1, 0, across.map(v => -v)], [0, 1, deep], [0, -1, deep.map(v => -v)]]) {
    const u = s ? [s, s] : [1, -1], v = d ? [d, d] : [-1, 1];
    const p = at(A, u[0], v[0]), q = at(A, u[1], v[1]), r = at(B, u[1], v[1]), t = at(B, u[0], v[0]);
    const n = cross(q.map((c, i) => c - p[i]), r.map((c, i) => c - p[i])), [m, o] = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [t, q] : [q, t];
    surface.face(...p, ...m, ...r, COLOURS.timber); surface.face(...p, ...r, ...o, COLOURS.timber);
  }
}
// A truss's panel points along a span, from post to post: at every bend of
// more than ten degrees, and between them as near TRUSS_PANEL apart as
// they fit while each chord keeps to the coping round a curve
function trussNodes(span) {
  const turn = i => {
    const a = span[i - 1], b = span[i], c = span[i + 1];
    return Math.abs(Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)));
  };
  const keys = [0];
  for (let i = 1; i < span.length - 1; i++) if (turn(i) > Math.PI / 18) keys.push(i);
  keys.push(span.length - 1);
  const nodes = [{ x: span[0].x, y: span[0].y }];
  for (let k = 0; k < keys.length - 1; k++) {
    const part = span.slice(keys[k], keys[k + 1] + 1), length = polylineLength(part), at = d => pointAlong(part, d) ?? part.at(-1);
    const strays = count => Array.from({ length: count }, (_, n) => {
      const a = at(length * n / count), b = at(length * (n + 1) / count);
      return Math.max(0, ...slicePolyline(part, length * n / count, length * (n + 1) / count).map(p => distanceToPolyline(p, [a, b])));
    });
    let count = Math.max(1, Math.round(length / TRUSS_PANEL));
    while (length / count > TRUSS_PANEL / 2 && Math.max(...strays(count)) > .3) count++;
    for (let n = 1; n <= count; n++) { const p = at(length * n / count); nodes.push({ x: p.x, y: p.y }); }
  }
  return nodes;
}
// A railing along a line: in lengths fitted end to end, each a chord of the
// line, so they meet round a curve, and split where it bends; with posts, a
// post at each end and at each turn sharper than 30 degrees
function railAlong(line, closed, withPosts) {
  const bend = points => i => {
    const a = points[i - 1], b = points[i], c = points[i + 1], u = Math.hypot(b.x - a.x, b.y - a.y) || 1, v = Math.hypot(c.x - b.x, c.y - b.y) || 1;
    return Math.acos(Math.max(-1, Math.min(1, ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / u / v)));
  };
  const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // (a corner the deck's outline rounds over a few short edges, closing
  // round a notch, is one corner at the middle of its bend: bends each within
  // a metre of the last, in two and a half metres at most; and a short jog,
  // a corner and one back the other way, one slant across it)
  const rounded = closed ? [...line, line[0]] : line, turnOf = bend(rounded), sharp = Math.PI / 6, kink = Math.PI / 15, points = [rounded[0]];
  const hand = i => Math.sign((rounded[i].x - rounded[i - 1].x) * (rounded[i + 1].y - rounded[i].y) - (rounded[i].y - rounded[i - 1].y) * (rounded[i + 1].x - rounded[i].x));
  for (let i = 1; i < rounded.length - 1; i++) {
    let j = i;
    // (the last bend near enough, over any straight bits between)
    if (turnOf(i) > kink) for (let k = i + 1; k < rounded.length - 1 && apart(rounded[k], rounded[i]) < 2.4; k++) {
      const jog = turnOf(i) > sharp && turnOf(k) > sharp && hand(i) !== hand(k);
      if (turnOf(k) > kink && (apart(rounded[k], rounded[j]) < 1.2 || jog)) j = k;
    }
    points.push(j > i ? pointAlong(rounded.slice(i, j + 1), polylineLength(rounded.slice(i, j + 1)) / 2) ?? rounded[i] : rounded[i]);
    i = j;
  }
  points.push(rounded.at(-1));
  // (and no length too short to hold its balusters: a gentle bend just
  // short of an open end is straightened out, and where the edge turns a
  // corner into the bank a couple of metres from its end, the railing ends
  // at the corner and the coping goes on alone)
  if (!closed) for (let trimmed = true; trimmed && points.length > 2;) {
    trimmed = false;
    const last = bend(points)(points.length - 2), first = bend(points)(1);
    if (last > sharp && apart(points.at(-2), points.at(-1)) < 2.4) { points.pop(); trimmed = true; }
    else if (last > kink && apart(points.at(-2), points.at(-1)) < 2) { points.splice(-2, 1); trimmed = true; }
    if (points.length < 3) break;
    if (first > sharp && apart(points[0], points[1]) < 2.4) { points.shift(); trimmed = true; }
    else if (first > kink && apart(points[0], points[1]) < 2) { points.splice(1, 1); trimmed = true; }
  }
  // (where a deck touches the water for a metre or two, at a corner of the
  // bank, one post between the copings stands for it)
  if (withPosts && !closed && polylineLength(points) < 2.4) {
    const middle = pointAlong(points, polylineLength(points) / 2) ?? points[0];
    return { line: points, posts: [{ x: middle.x, y: middle.y, tx: middle.tx ?? 1, ty: middle.ty ?? 0 }], pieces: [] };
  }
  // Split at each corner, then at each gentler bend clear of them all, so
  // no length is too short
  const turn = bend(points), cuts = [0, points.length - 1];
  const clear = (i, d) => cuts.every(k => apart(points[i], points[k]) >= d);
  for (let i = 1; i < points.length - 1; i++) if (turn(i) > sharp && clear(i, 1.2)) cuts.push(i);
  for (let i = 1; i < points.length - 1; i++) if (turn(i) > kink && turn(i) <= sharp && clear(i, 2)) cuts.push(i);
  const splits = [...new Set(cuts)].sort((a, b) => a - b);
  const posted = i => withPosts && (((i === 0 || i === points.length - 1) && !closed) || (i > 0 && i < points.length - 1 && turn(i) > sharp) || (closed && i === 0));
  const posts = splits.filter(posted).map(i => {
    const j = Math.min(i, points.length - 2), a = points[j], b = points[j + 1], l = apart(a, b) || 1;
    return { x: points[i].x, y: points[i].y, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l };
  });
  const pieces = [];
  for (let k = 0; k < splits.length - 1; k++) {
    const stretch = points.slice(splits[k], splits[k + 1] + 1), length = polylineLength(stretch);
    const from = posted(splits[k]) ? RAIL_POST / 2 : 0, to = length - (posted(splits[k + 1]) || (closed && k === splits.length - 2 && withPosts) ? RAIL_POST / 2 : 0);
    if (to - from < .05) continue;
    // (as near four metres as they fit, and none much longer)
    let count = Math.max(1, Math.round((to - from) / RAIL_LENGTH));
    if ((to - from) / count > RAIL_LENGTH * 1.2) count++;
    for (let n = 0; n < count; n++) {
      const a = pointAlong(stretch, from + (to - from) * n / count) ?? stretch[0], b = pointAlong(stretch, from + (to - from) * (n + 1) / count) ?? stretch.at(-1);
      const l = apart(a, b);
      if (l > .05) pieces.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l, length: l });
    }
  }
  // (and from post to post, over any gentler bends, the line a truss spans)
  const ends = splits.filter(posted);
  if (closed && withPosts) ends.push(points.length - 1);
  const spans = ends.slice(1).map((end, k) => points.slice(ends[k], end + 1));
  return { line: points, posts, pieces, spans };
}
// Whether a point is on a deck, or within a few centimetres of one: where
// a deck meets the bank, the shore under it
const deckBounds = new WeakMap();
export function onDeck(x, y, margin = .05) {
  return CITY.decks.some(deck => {
    if (!deckBounds.has(deck)) deckBounds.set(deck, polygonBounds(deck.outer));
    const b = deckBounds.get(deck);
    if (x < b.minX - margin || x > b.maxX + margin || y < b.minY - margin || y > b.maxY + margin) return false;
    const p = { x, y };
    if (insidePolygon(p, deck.outer) && !deck.holes.some(hole => insidePolygon(p, hole))) return true;
    return [deck.outer, ...deck.holes].some(ring => distanceToPolyline(p, [...ring, ring[0]]) < margin);
  });
}
// Whether the shore at p (running along t, the water on its right) is built
// over: a carriageway on it, or a deck carried on from it over the water
// (or a kerb corner rounded off a walk, which is road on the land side). So
// where a bank meets a deck's edge at a slant, its coping runs on to the deck.
const shoreCovered = (p, tx, ty) => Boolean(onRoadAt(p.y, p.x)) || onDeck(p.x, p.y) || surfaceAt(p.y + tx * .6, p.x - ty * .6) === 'road';
// A shore run in stretches, each either built over or not, split where it
// passes the edge of what covers it (found to a couple of centimetres, so a
// coping stops at the kerb rather than running on into the road)
function shoreStretches(run) {
  const stretches = [];
  let current = null, last = null;
  for (let i = 0; i < run.length - 1; i++) {
    const a = run[i], b = run[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.max(1, Math.ceil(length / 1.5));
    const tx = (b.x - a.x) / (length || 1), ty = (b.y - a.y) / (length || 1);
    for (let k = i ? 1 : 0; k <= count; k++) {
      const p = { x: a.x + (b.x - a.x) * k / count, y: a.y + (b.y - a.y) * k / count }, road = shoreCovered(p, tx, ty);
      if (current && current.road !== road) {
        let lo = last, hi = p;
        for (let step = 0; step < 7; step++) {
          const m = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
          if (shoreCovered(m, tx, ty) === current.road) lo = m; else hi = m;
        }
        const edge = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
        current.points.push(edge); stretches.push(current); current = { road, points: [edge] };
      }
      (current ??= { road, points: [] }).points.push(p);
      last = p;
    }
  }
  if (current?.points.length > 1) stretches.push(current);
  return stretches;
}
// Surface.wall faces the right of travel; a clockwise ring faces outward
const clockwise = polygon => signedArea(polygon) > 0 ? polygon.slice().reverse() : polygon;
// What the ground inside a block is: gardens where the district has them, paving elsewhere
const GARDEN_STYLES = new Set(['Garden quarter', 'Civic quarter']);
// Where the back yards have trees in them, and how thickly (square metres of
// yard to a tree): the gardens are full of them, the old streets' yards have
// a few
const YARD_TREES = { 'Garden quarter': 240, 'Civic quarter': 290, 'Old town': 560, 'Market district': 480 };
export const blockGround = block => GARDEN_STYLES.has(block.style) ? '#86a263' : block.style === 'Warehouse district' ? '#a8a598' : '#b3b2a5';
export const yardGround = block => block.style === 'Warehouse district' ? '#9e9b8e' : block.style === 'Midtown' ? '#a9a99d' : '#83a05e';

// Bridges: the runs of a road over water, with their footways (see city.js)
export const findBridges = () => CITY.bridges;

// Street furniture for the whole city, as pieces the chunks stand up:
// { kind, u, s, yaw, ... } with yaw an item yaw (see city-layout-render.js).
// The boats that move (see city-boats.js) run slow loops off the longest
// open stretches of sea wall: out along a lane 30 m off the wall, round and
// back along one 46 m off, the two a boat's length apart everywhere. Every
// point on a loop has open water all round it and no bridge near it.
export const HARBOUR_LANES = [30, 46];
// Whether a point is within `margin` of a deck's bounding box: enough to keep
// boats out from under and beside the bridges, and cheap
const nearDeck = (x, y, margin) => CITY.decks.some(deck => {
  if (!deckBounds.has(deck)) deckBounds.set(deck, polygonBounds(deck.outer));
  const b = deckBounds.get(deck);
  return x > b.minX - margin && x < b.maxX + margin && y > b.minY - margin && y < b.maxY + margin;
});
let harbourCache = null;
export function harbourRoutes() {
  if (harbourCache) return harbourCache;
  const open = (x, y) => surfaceAt(y, x) === 'water';
  const clear = (x, y) => open(x, y) && !nearDeck(x, y, 30) && circle(x, y, 10, 8).every(q => open(q.x, q.y));
  const routes = [];
  for (const run of CITY.walls) {
    const samples = alongPolyline(run, 8);
    if (samples.length < 30) continue;
    // (the water's side of the wall, the same all along it)
    const mid = samples[samples.length >> 1], side = open(mid.x + mid.ty * HARBOUR_LANES[0], mid.y - mid.tx * HARBOUR_LANES[0]) ? 1 : -1;
    const lane = (p, d, along = 0) => ({ x: p.x + p.ty * side * d + p.tx * along, y: p.y - p.tx * side * d + p.ty * along });
    const ok = samples.map(p => HARBOUR_LANES.every(d => { const q = lane(p, d); return clear(q.x, q.y); }));
    // (each clear stretch, cut into loops of at most 700 m with room between them)
    const stretches = [];
    for (let i = 0, from = 0; i <= samples.length; i++) {
      if (i < samples.length && ok[i]) continue;
      for (let start = from + 1; i - 2 - start >= 30; start += 96) stretches.push([start, Math.min(i - 2, start + 88)]);
      from = i + 1;
    }
    for (const [a, b] of stretches) {
      if (b - a < 30) continue;
      const middle = (HARBOUR_LANES[0] + HARBOUR_LANES[1]) / 2, turn = (HARBOUR_LANES[1] - HARBOUR_LANES[0]) / 2;
      const ends = [lane(samples[b], middle, turn), lane(samples[a], middle, -turn)];
      if (!ends.every(q => clear(q.x, q.y))) continue;
      const points = [...samples.slice(a, b + 1).map(p => lane(p, HARBOUR_LANES[0])), ends[0], ...samples.slice(a, b + 1).reverse().map(p => lane(p, HARBOUR_LANES[1])), ends[1]];
      points.push(points[0]);
      routes.push({ points, length: polylineLength(points) });
    }
  }
  harbourCache = routes.sort((p, q) => q.length - p.length).slice(0, 10);
  return harbourCache;
}

// Where a park's name board may stand, best first: just inside its lawn by
// the gate, round the lawn's edge either way from the point nearest the gate
// (following the edge where it bends: straight on, a spot soon left a round
// lawn, and those near the gate of a circus's garden are all in the junctions
// round it), and failing those, further in (where a circus's junctions reach
// round its garden's whole edge). Each is the board's middle (u, y), which way
// is out of the lawn (ox, oy) and the board's two ends.
export function* lawnSpots(lawn, gate, width = 3.6) {
  const edge = [...lawn, lawn[0]];
  let best = null;
  for (let i = 0, round = 0; i < lawn.length; i++) {
    const a = edge[i], b = edge[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), l2 = length * length || 1;
    const t = Math.max(0, Math.min(1, ((gate.x - a.x) * dx + (gate.y - a.y) * dy) / l2)), d = Math.hypot(a.x + dx * t - gate.x, a.y + dy * t - gate.y);
    if (!best || d < best.d) best = { d, at: round + length * t };
    round += length;
  }
  const around = polylineLength(edge);
  for (const inset of [2.4, 5, 8]) for (const along of [4, -4, 6.5, -6.5, 9, -9, 12, -12, 16, -16, 20, -20, 25, -25]) {
    const p = pointAlong(edge, ((best.at + along) % around + around) % around) ?? pointAlong(edge, 0);
    let ox = p.ty, oy = -p.tx;
    if (insidePolygon({ x: p.x + ox * .5, y: p.y + oy * .5 }, lawn)) { ox = -ox; oy = -oy; }
    const u = p.x - ox * inset, y = p.y - oy * inset;
    yield { u, y, ox, oy, width, ends: [-1, 1].map(k => ({ x: u + p.tx * k * (width / 2 + .3), y: y + p.ty * k * (width / 2 + .3) })) };
  }
}

export function placeStreetFurniture(nav, bridges, add) {
  const geometry = junctionGeometry(nav), controls = junctionControls(nav);
  // Junction zones: nothing stands on a corner or in a crosswalk's path
  const zones = [...geometry.values()].map(shape => ({ x: shape.node.x, y: shape.node.y, r: shape.arms.reduce((sum, arm) => sum + arm.clear, 0) / shape.arms.length + CROSSWALK + 2.5, corner: Math.min(...shape.arms.map(arm => arm.clear)) }));
  const zoneIndex = new Map(), zoneCell = (x, y) => Math.floor(x / 60) * 65536 + Math.floor(y / 60);
  for (const zone of zones) {
    const key = zoneCell(zone.x, zone.y);
    if (!zoneIndex.has(key)) zoneIndex.set(key, []);
    zoneIndex.get(key).push(zone);
  }
  // The zones that could reach a ring, so a walk round it asks only those
  const zonesNear = ring => {
    const b = polygonBounds(ring), near = [];
    for (let cx = Math.floor(b.minX / 60) - 1; cx <= Math.floor(b.maxX / 60) + 1; cx++) for (let cy = Math.floor(b.minY / 60) - 1; cy <= Math.floor(b.maxY / 60) + 1; cy++) near.push(...zoneIndex.get(cx * 65536 + cy) ?? []);
    return near;
  };
  // Within a junction's corners, where only its own signs stand
  const inCorner = (x, y) => zonesNear([{ x, y }]).some(zone => Math.hypot(zone.x - x, zone.y - y) < zone.corner);
  // Junction corners and crosswalks, and wherever a road or park path crosses
  // a pavement (a median stands in its own road, so asks only of junctions)
  const inZone = (x, y, junctionsOnly = false) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const zone of zoneIndex.get(zoneCell(x + dx * 60, y + dy * 60)) ?? []) if (Math.hypot(zone.x - x, zone.y - y) < zone.r) return true;
    }
    if (junctionsOnly) return false;
    const road = CITY.roadIndex.nearest(x, y, 12, (segment, distance) => distance - segment.road.profile.halfWidth);
    return Boolean(road && (road.score < 0 || road.road.kind === 'path' && road.score < 1.5));
  };
  // What already stands, by 10 m cell, so nothing is placed on top of anything
  // else, and no tree's crown takes in a lamp, a sign or a shelter, whichever
  // of them stood first
  const placed = new Map(), cellOf = (x, y) => Math.floor(x / 10) * 65536 + Math.floor(y / 10);
  const remember = (x, y, kind, crown = 0) => {
    const key = cellOf(x, y);
    if (!placed.has(key)) placed.set(key, []);
    placed.get(key).push({ x, y, kind, crown });
  };
  const free = (x, y, radius, kind = null, crown = 0) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const p of placed.get(cellOf(x + dx * 10, y + dy * 10)) ?? []) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < radius || (crown && d < crown + (CROWN_CLEAR[p.kind] ?? -Infinity)) || (p.crown && d < p.crown + (CROWN_CLEAR[kind] ?? -Infinity))) return false;
      }
    }
    return true;
  };
  // Bus stops, which the parked cars leave clear
  const stops = [], nearStop = (x, y, radius) => stops.some(stop => Math.hypot(stop.x - x, stop.y - y) < radius);
  // Street furniture stands on a pavement, whatever placed it
  const PAVED = new Set(['lamp', 'bin', 'shelter', 'stop', 'yield', 'signal', 'sign', 'parking-sign']);
  // A car park's driveway: nothing stands across its mouth, and nobody parks
  // in front of it ('reach' is how far out from the buildings' line to keep clear)
  const mouths = CITY.blocks.map(block => yardDrive(block.index)).filter(Boolean);
  const acrossDrive = (x, y, reach, margin) => mouths.some(d => {
    const dx = x - d.mouth.x, dy = y - d.mouth.y, out = -(dx * d.nx + dy * d.ny);
    return out > -1 && out < reach && Math.abs(dx * d.tx + dy * d.ty) < d.width / 2 + margin;
  });
  // A venue's forecourt continues across the pavement to its drop-off. Keep
  // the central approach open (the full apron for vehicle bays), including
  // tree crowns that would hide the doorway from the road. Traffic controls
  // still take their required positions at junctions.
  const places = cityPlaces(), gates = places.filter(p => p.footprint).map(p => {
    const f = p.footprint, service = p.type === 'depot' || p.type === 'firehouse';
    const reach = -((p.entrance.u - f.front.x) * f.nx + (p.entrance.s - f.front.y) * f.ny);
    return { ...f, reach, half: service ? (f.width + 1) / 2 : Math.min(3.5, f.width * .12) };
  });
  const approachKinds = new Set(['tree', 'lamp', 'lantern', 'shelter', 'bench', 'bin', 'bollard', 'parking-sign']);
  const acrossEntrance = piece => {
    if (piece.median || !approachKinds.has(piece.kind)) return false;
    const margin = piece.kind === 'tree' ? TREE_CROWN * piece.scale : piece.kind === 'shelter' ? 2.4 : .6;
    return gates.some(f => {
      const dx = piece.u - f.front.x, dy = piece.s - f.front.y, out = -(dx * f.nx + dy * f.ny);
      return out > -margin && out < f.reach && Math.abs(dx * f.tx + dy * f.ty) < f.half + margin;
    });
  };
  const put = (piece, radius = 1.5) => {
    // on a pavement, and not where a road or park path runs across it
    if ((PAVED.has(piece.kind) || piece.street) && (!CITY.pavement.find(piece.u, piece.s) || onRoadAt(piece.s, piece.u))) return false;
    if (piece.kind !== 'parking-sign' && acrossDrive(piece.u, piece.s, SIDEWALK + .5, .6)) return false;
    if (acrossEntrance(piece)) return false;
    const crown = piece.kind === 'tree' ? TREE_CROWN * piece.scale : 0, kind = piece.street ? 'street-lantern' : piece.kind;
    if (!free(piece.u, piece.s, Math.min(radius, 10), kind, crown)) return false;
    remember(piece.u, piece.s, kind, crown);
    const { street, ...item } = piece;
    add(item);
    return true;
  };
  // A parking sign on the pavement beside each driveway, to one side of it
  for (const d of mouths) for (const end of [1, -1]) {
    const along = end * (d.width / 2 + .9), u = d.mouth.x + d.tx * along - d.nx * .7, y = d.mouth.y + d.ty * along - d.ny * .7;
    if (put({ kind: 'parking-sign', u, s: y, yaw: alongYaw(d.nx, d.ny), tx: d.tx, ty: d.ty }, 1)) break;
  }
  // Signals, stop signs and give-way signs stand on the approach's right-hand
  // pavement just behind the line, facing the drivers who have to obey them
  for (const [node, control] of controls) {
    const shape = geometry.get(node.id);
    for (const [edge, approach] of control.approaches) {
      if (approach.kind === 'priority') continue;
      // A few metres further back if a path crosses the pavement there
      const arm = shape.approaches.get(edge);
      for (const back of [0, 2.5, 5]) {
        const p = approachPoint(nav, edge, node, stopLineDistance(arm.clear) + .9 + back);
        // (on a bridge, the middle of its footway)
        const kerb = kerbReach(p, p.rx, p.ry, edge.profile.halfWidth), reach = kerb < edge.profile.halfWidth ? (kerb + edge.profile.halfWidth) / 2 : edge.profile.halfWidth + 1.1, u = p.x + p.rx * reach, y = p.y + p.ry * reach;
        if (waterAt(y, u)) continue;
        const yaw = faceYaw(p.tx, p.ty);
        // On a wide road the signal hangs over the lanes from a mast arm, a
        // head above each lane the approach's traffic can take
        const lanes = edge.profile.divider ? [(edge.profile.median + edge.profile.divider) / 2, (edge.profile.divider + edge.profile.halfWidth - .6) / 2]
          : [edge.profile.halfWidth / 2 - .5];
        const mast = edge.profile.halfWidth >= 8 ? lanes.map(lane => reach - lane) : null;
        if (put(approach.kind === 'signal' ? { kind: 'signal', u, s: y, yaw, axis: approach.axis, mast } : { kind: approach.kind === 'yield' ? 'yield' : 'stop', u, s: y, yaw }, 1)) break;
      }
    }
  }
  // A park or a square has its name on a board by its gate, before the lamps
  // and trees take the kerb: just inside its lawn, beside the walk in (not
  // across the pavement or the walk), facing the street at a height a
  // passer-by reads it at. A venue's name is on its own building or on a
  // plinth in its grounds (see city-landmarks.js).
  const parkEntries = new Map(cityParks().map(entry => [entry.index, entry]));
  for (const place of places) {
    const entry = place.park === undefined ? null : parkEntries.get(place.park), lawn = entry?.park.lawn;
    if (!(lawn?.length >= 3)) continue;
    // A spot on the lawn by its gate (see lawnSpots) clear of the walks and
    // whatever stands on it, with the board all on the lawn
    const walkClear = (x, y) => { const road = CITY.roadIndex.nearest(x, y, 20, (segment, distance) => segment.road.kind === 'path' ? distance - segment.road.profile.halfWidth : Infinity); return !road || road.score > 1.4; };
    for (const { u, y, ox, oy, ends, width } of lawnSpots(lawn, { x: place.entrance.u, y: place.entrance.s })) {
      if (![{ x: u, y }, ...ends].every(p => insidePolygon(p, lawn) && walkClear(p.x, p.y) && parkClear(entry, p.x, p.y, .6) && !inZone(p.x, p.y))) continue;
      if (!free(u, y, 3, 'sign')) continue;
      // (and the lamps and trees along the kerb keep out of the way between
      // it and the street)
      for (const out of [0, 4.5, 8]) remember(u + ox * out, y + oy * out, 'sign');
      add({ kind: 'sign', type: place.type, variant: place.variant, u, s: y, yaw: faceYaw(ox, oy), width, bottom: .75 });
      break;
    }
  }
  // How far back a block's buildings stand from its pavement near a point:
  // each lot builds as the district its middle is in, so where two districts
  // meet it is the nearer building line of the lots beside the point
  const lotSetbacks = new Map();
  CITY.lots.forEach((lot, i) => {
    const block = CITY.lotBlocks?.[i], c = averagePoint(lot);
    if (block === undefined) return;
    if (!lotSetbacks.has(block)) lotSetbacks.set(block, []);
    lotSetbacks.get(block).push({ ring: [...lot, lot[0]], setback: frontSetback(cityStyleDistrict(c.y, c.x)) });
  });
  const setbackNear = (block, p) => (lotSetbacks.get(block.index) ?? []).reduce((least, lot) => distanceToPolyline(p, lot.ring) < 8 ? Math.min(least, lot.setback) : least, frontSetback(block.style));
  // Lamps near the kerb and trees in the pavement, round every block and park,
  // clear of the junctions. The ring of a kerb runs anticlockwise, so the road
  // is on the right and the pavement on the left.
  const kerbs = [...CITY.blocks.map(block => ({ ring: block.kerb, block })), ...CITY.parkPlans.filter(park => !park.square).map(park => ({ ring: park.kerb, park }))];
  for (const { ring, block, park } of kerbs) {
    if (ring.length < 3) continue;
    const loop = [...ring, ring[0]], perimeter = polylineLength(loop);
    if (perimeter < 40) continue;
    const planting = block ? STREET_TREES[block.style] ?? STREET_TREES.Midtown : PARK_TREES;
    const trees = randomAt(block?.index ?? 0, 7402, CITY.seed) < planting.share;
    const lampStart = randomAt(block?.index ?? 0, 7403, CITY.seed) * LAMP_SPACING;
    // A bus shelter now and then where the pavement runs along a main road,
    // its open side to the kerb
    let sinceShelter = 120 + randomAt(block?.index ?? 0, 7404, CITY.seed) * 120;
    for (const p of alongPolyline(loop, 30, 15)) {
      sinceShelter += 30;
      const nx = -p.ty, ny = p.tx, x = p.x + nx * 1.7, y = p.y + ny * 1.7;
      const road = CITY.roadIndex.nearest(p.x, p.y, 16);
      if (sinceShelter < 240 || !road || !['main', 'major', 'ring'].includes(road.road.kind) || inZone(x, y)) continue;
      if (!put({ kind: 'shelter', u: x, s: y, yaw: alongYaw(nx, ny) }, 6)) continue;
      sinceShelter = 0; stops.push({ x, y });
      // (with a bin beside it, just past one end)
      [2.9, -2.9, 3.6, -3.6].some(along => put({ kind: 'bin', u: x + p.tx * along - nx * .5, s: y + p.ty * along - ny * .5 }, 1));
    }
    const lanterns = block && LANTERN_DISTRICTS.has(block.style), local = p => (CITY.roadIndex.nearest(p.x, p.y, 16)?.road.profile.rank ?? 9) <= 1;
    for (const p of alongPolyline(loop, LAMP_SPACING, lampStart)) {
      const nx = -p.ty, ny = p.tx, x = p.x + nx * .7, y = p.y + ny * .7;
      if (inZone(x, y) || (lanterns && local(p))) continue;
      put({ kind: 'lamp', u: x, s: y, yaw: alongYaw(nx, ny) }, 4);
    }
    if (lanterns) for (const p of alongPolyline(loop, LANTERN_SPACING, lampStart)) {
      const nx = -p.ty, ny = p.tx, x = p.x + nx * .8, y = p.y + ny * .8;
      if (!inZone(x, y) && local(p)) put({ kind: 'lantern', street: true, u: x, s: y }, 4);
    }
    // A litter bin where people wait to cross: at the end of a street's
    // pavement, just short of the corner, at some corners in every district
    // and at most in the busy ones
    const bins = block ? CORNER_BINS[block.style] ?? .3 : 0;
    if (bins) {
      // (the junction corners alone decide where a corner ends; the bin's own spot is asked the rest)
      const corners = zonesNear(ring), samples = alongPolyline(loop, 1.5), n = samples.length;
      const open = samples.map(p => { const x = p.x - p.ty, y = p.y + p.tx; return !corners.some(zone => Math.hypot(zone.x - x, zone.y - y) < zone.r); });
      for (let i = 0; i < n; i++) {
        if (!open[i]) continue;
        // (two samples, 3 m, in from where the corner ends, on a run of pavement long enough to be a street's)
        const inward = !open[(i - 1 + n) % n] ? 1 : !open[(i + 1) % n] ? -1 : 0;
        if (!inward || !open[(i + inward * 2 + n) % n] || !open[(i + inward * 8 + n) % n]) continue;
        const p = samples[(i + inward * 2 + n) % n];
        if (randomAt(Math.round(p.x * 3), Math.round(p.y * 3) + 7409, CITY.seed) >= bins || inZone(p.x - p.ty, p.y + p.tx)) continue;
        put({ kind: 'bin', u: p.x - p.ty, s: p.y + p.tx }, 1.5);
      }
    }
    if (!trees) continue;
    // Each tree no bigger than its room to the building line behind the
    // pavement, so its crown only brushes the house fronts, and slid a
    // little along the kerb where its crown would take in a lamp or a sign
    const [low, high] = planting.scale, line = block?.inner?.length >= 3 ? [...block.inner, block.inner[0]] : null;
    const roomAt = (x, y) => line ? distanceToPolyline({ x, y }, line) + setbackNear(block, { x, y }) : Infinity;
    for (const slot of alongPolyline(loop, planting.spacing, lampStart + planting.spacing / 2)) {
      if (inZone(slot.x - slot.ty * 1.9, slot.y + slot.tx * 1.9) || CITY.roadIndex.nearest(slot.x, slot.y, 12)?.road.profile.narrow) continue;
      // (the room at the slot says how big a tree could be; a spot a step
      // along is measured again only once nothing else stands in its way)
      const room = roomAt(slot.x - slot.ty * 1.9, slot.y + slot.tx * 1.9);
      for (const shift of [0, 1.5, -1.5, 3, -3, 4.5, -4.5]) {
        const p = shift ? pointAlong(loop, ((slot.distance + shift) % perimeter + perimeter) % perimeter) : slot;
        if (!p) continue;
        const nx = -p.ty, ny = p.tx, x = p.x + nx * 1.9, y = p.y + ny * 1.9, grown = low + randomAt(Math.round(x), Math.round(y) + 31, CITY.seed) * (high - low);
        let scale = Math.min(grown, treeRoom(room));
        if (scale < 4.8 || !free(x, y, 3, 'tree', TREE_CROWN * scale)) continue;
        if (shift && (inZone(x, y) || (scale = Math.min(grown, treeRoom(roomAt(x, y)))) < 4.8)) continue;
        // A small soil opening, square to the kerb, wholly within the paved
        // strip. Park lawns come closer to the kerb than building lots do.
        const pit = rectanglePolygon(x, y, 1.8, 1.6, Math.atan2(p.ty, p.tx)).map(([x, y]) => ({ x, y }));
        const inner = block?.inner ?? park?.lawn ?? [];
        if (!pit.every(p => insidePolygon(p, ring) && !insidePolygon(p, inner) && !onRoadAt(p.y, p.x))) continue;
        if (put({ kind: 'tree', u: x, s: y, scale, pit }, 3)) break;
      }
    }
  }
  // Down each median: trees on a boulevard's, and now and then a lamp with an
  // arm over each carriageway; the parkway's grass has only the lamps
  for (const median of cityMedians(nav).list) {
    alongPolyline(median.points, 13, 6.5).forEach((p, i) => {
      if (waterAt(p.y, p.x) || inZone(p.x, p.y, true)) return;
      if (i % 3 === 1) put({ kind: 'median-lamp', u: p.x, s: p.y, yaw: alongYaw(-p.ty, p.tx) }, 3);
      else if (median.planted) put({ kind: 'tree', u: p.x, s: p.y, scale: 6.2 + randomAt(Math.round(p.x), Math.round(p.y) + 7405, CITY.seed) * 1.8, median: true }, 3);
    });
  }
  // Lamps along a bridge's footways, facing each other across the deck,
  // their arms over the road (the footway lies within the road's width, so it
  // asks only that nothing else stands there)
  for (const bridge of bridges) for (const footway of bridge.footways) {
    for (const p of alongPolyline(footway.line, LAMP_SPACING, footway.side > 0 ? 6 : 6 + LAMP_SPACING / 2)) {
      const nx = -p.ty * footway.side, ny = p.tx * footway.side, x = p.x + nx * (footway.width / 2 - .9), y = p.y + ny * (footway.width / 2 - .9);
      if (!free(x, y, 4, 'lamp') || inZone(x, y, true)) continue;
      remember(x, y, 'lamp');
      add({ kind: 'lamp', u: x, s: y, yaw: alongYaw(nx, ny), bridge: true });
    }
  }
  // Lamps along the quays and promenades
  for (const walk of CITY.quays) {
    for (const p of alongPolyline(walk.points, LAMP_SPACING, 8)) {
      if (inZone(p.x, p.y)) continue;
      // The lamp stands on the road side of the walk, its arm over the road
      const road = CITY.roadIndex.nearest(p.x, p.y, 20);
      if (!road) continue;
      const ax = p.x - road.x, ay = p.y - road.y, l = Math.hypot(ax, ay) || 1, x = road.x + ax / l * (road.road.profile.halfWidth + .7), y = road.y + ay / l * (road.road.profile.halfWidth + .7);
      put({ kind: 'lamp', u: x, s: y, yaw: alongYaw(ax / l, ay / l) }, 4);
    }
  }
  // Benches along a wide promenade, on the water side facing the view, and a
  // bin beside every other one
  for (const walk of CITY.quays) {
    if (walk.halfWidth < 2.5 || walk.points.length < 2) continue;
    alongPolyline(walk.points, 46, 23).forEach((p, i) => {
      const road = CITY.roadIndex.nearest(p.x, p.y, 20);
      if (!road) return;
      const ax = p.x - road.x, ay = p.y - road.y, l = Math.hypot(ax, ay) || 1, reach = walk.halfWidth - 1.9;
      const x = p.x + ax / l * reach, y = p.y + ay / l * reach;
      if (waterAt(y, x) || inZone(x, y) || !insidePolygon({ x, y }, walk.polygon)) return;
      if (put({ kind: 'bench', u: x, s: y, yaw: alongYaw(-ax / l, -ay / l) }, 2.5) && i % 2) put({ kind: 'bin', u: x + p.tx * 1.6, s: y + p.ty * 1.6 }, 1);
    });
  }
  // Railings along the quay walls in four-metre lengths, with a gap wherever
  // a road meets the water: each stretch between roads is railed right up to
  // the kerb, its last length set back to end there
  const kerbClear = p => { const road = CITY.roadIndex.nearest(p.x, p.y, 30, (segment, distance) => distance - segment.road.profile.halfWidth); return !road || road.score > .3; };
  // (and none where the walk carries on over the water on a deck, which has
  // its own, nor within reach of a deck's coping, where the two meet)
  const decks = deckEdges().map(edge => ({ line: edge.line, bounds: polygonBounds(edge.line) }));
  const deckClear = p => !decks.some(({ line, bounds: b }) => p.x > b.minX - 1 && p.x < b.maxX + 1 && p.y > b.minY - 1 && p.y < b.maxY + 1 && distanceToPolyline(p, line) < .9);
  for (const run of CITY.walls) {
    const samples = alongPolyline(offsetPolylineClean(run, 1.1), .5), clear = samples.map(p => kerbClear(p) && !onDeck(p.x + p.ty * 1.1, p.y - p.tx * 1.1) && deckClear(p));
    // (a length centred on sample i spans samples i - 4 to i + 4)
    const fits = i => i >= 4 && i + 4 < samples.length && clear[i - 4] && clear[i] && clear[i + 4];
    let next = 0, last = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      if (!fits(i)) continue;
      const end = !fits(i + 1);
      if (i < next && !(end && i - last >= 2)) continue;
      const p = samples[i];
      add({ kind: 'railing', u: p.x, s: p.y, yaw: faceYaw(p.tx, p.ty), y: PAVEMENT_LEVEL });
      last = i; next = i + 8;
    }
  }
  // Bridges: the railing along each edge of a deck over the water, on its
  // coping or along its promenade, all the way round a corner where two
  // bridges meet (see deckEdges); on a coping only to stop a car, since the
  // parapet and its truss are drawn with the coping
  for (const { rail, y, truss } of deckEdges()) for (const piece of rail.pieces) {
    add({ kind: 'railing', u: piece.x, s: piece.y, yaw: faceYaw(piece.tx, piece.ty), y, length: piece.length, ...(truss.length ? { parapet: true } : {}) });
  }
  // Boats: moored a few metres off the quay walls along the stretches of
  // harbour and river where they gather, and now and then one on a buoy out
  // in open water, headed into the breeze. Each wholly over the water and
  // clear of the others, and none under or beside a bridge.
  const BOATS = [['launch', 6, 2.3], ['yacht', 8.6, 2.8], ['work', 7.6, 2.7]], boats = [];
  const PAINTS = { launch: ['#2f4b68', '#ecebe4', '#6f9fbf', '#2f5d4f', '#b8413a'], yacht: ['#ecebe4', '#ecebe4', '#2f4b68', '#d8cbb0', '#1f2a33'], work: ['#a1433a', '#2f5d4f', '#35536e', '#2b2f31', '#c0892f'] };
  const clearOfBoats = (x, y, room) => boats.every(b => Math.hypot(b.x - x, b.y - y) > room);
  const open = (x, y) => surfaceAt(y, x) === 'water';
  const grid = (count, half = .5) => Array.from({ length: count }, (_, k) => -half + k * 2 * half / (count - 1));
  const afloat = (x, y, tx, ty, length, beam) => grid(9).every(a => grid(5).every(b => open(x + tx * a * length - ty * b * beam, y + ty * a * length + tx * b * beam)));
  const moor = (model, x, y, yaw, salt) => {
    boats.push({ x, y });
    const paints = PAINTS[model];
    add({ kind: 'boat', model, u: x, s: y, yaw, paint: paints[Math.floor(randomAt(salt, 7420, CITY.seed) * paints.length)] });
  };
  const seaward = p => waterAt(p.y + p.tx * 4, p.x - p.ty * 4) ? [-p.ty, p.tx] : [p.ty, -p.tx];
  for (const run of CITY.walls) {
    const samples = alongPolyline(run, 2);
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i], salt = Math.round(p.x * 2) * 7919 + Math.round(p.y * 2);
      if (CITY.field.noise2D(p.x / 160 + 31.7, p.y / 160 - 12.3) < .15 || randomAt(salt, 7411, CITY.seed) > .3) continue;
      const [model, length, beam] = BOATS[Math.floor(randomAt(salt, 7412, CITY.seed) * BOATS.length)], [nx, ny] = seaward(p);
      const x = p.x + nx * (beam / 2 + 1.3) + p.tx * length / 2, y = p.y + ny * (beam / 2 + 1.3) + p.ty * length / 2;
      if (nearDeck(x, y, 18) || !clearOfBoats(x, y, length / 2 + 4.5) || !afloat(x, y, p.tx, p.ty, length + 1.5, beam + 1)) continue;
      const bow = randomAt(salt, 7413, CITY.seed) < .5 ? 1 : -1;
      moor(model, x, y, faceYaw(p.tx * bow, p.ty * bow), salt);
      // (made fast fore and aft, a line from each end of its deck straight up to the quay's edge)
      for (const end of [-.36, .36]) {
        const cx = x + p.tx * end * length - nx * beam * .4, cy = y + p.ty * end * length - ny * beam * .4;
        add({ kind: 'mooring', u: cx, s: cy, yaw: alongYaw(-nx, -ny), span: beam * .1 + 1.3 });
      }
      i += Math.ceil((length + 1 + randomAt(salt, 7414, CITY.seed) * 4) / 2);
    }
  }
  const breeze = randomAt(3, 7415, CITY.seed) * Math.PI * 2;
  for (const run of CITY.walls) for (const p of alongPolyline(run, 55, 20)) {
    const salt = Math.round(p.x) * 7919 + Math.round(p.y);
    if (randomAt(salt, 7416, CITY.seed) > .45) continue;
    const [nx, ny] = seaward(p), out = 16 + randomAt(salt, 7417, CITY.seed) * 50, x = p.x + nx * out, y = p.y + ny * out;
    const yaw = breeze + (randomAt(salt, 7419, CITY.seed) - .5) * .5, fx = Math.sin(yaw), fy = -Math.cos(yaw);
    if (nearDeck(x, y, 30) || !clearOfBoats(x, y, 24) || ![7, 14].every(r => circle(x, y, r, 12).every(q => open(q.x, q.y))) || !afloat(x, y, fx, fy, 14, 8)) continue;
    // (and out of the way of the boats going by)
    if (harbourRoutes().some(route => distanceToPolyline({ x, y }, route.points) < 16)) continue;
    moor(randomAt(salt, 7418, CITY.seed) < .7 ? 'yacht' : 'launch', x, y, yaw, salt);
  }
  // Parks and squares: what a square is for (its fountain, tower, sculptures,
  // glasshouse or stalls) or a park's fountain or bandstand in the middle,
  // lanterns and benches along the walks, a ring of benches round the plaza,
  // and trees: a row just inside a square's edge, and within it rows over
  // paving or groves over a lawn, down both sides of a park's loop walk and
  // clear of every walk, plaza, pond and whatever stands in the square
  const pathClear = (x, y) => { const road = CITY.roadIndex.nearest(x, y, 30, (segment, distance) => distance - segment.road.profile.halfWidth); return road ? road.score : Infinity; };
  for (const entry of cityParks()) {
    const park = entry.park, lawn = park.lawn;
    if (lawn.length < 3) continue;
    const random = seededRandom(CITY.seed + entry.index * 7919), bounds = polygonBounds(lawn), area = calcPolygonArea(lawn);
    const paved = entry.paved, onLawn = (x, y) => insidePolygon({ x, y }, lawn) && !inZone(x, y);
    const plaza = entry.plaza;
    for (const { x, y, ...feature } of entry.features) if (!inCorner(x, y)) add({ ...feature, u: x, s: y });
    if (plaza && !park.square) {
      if (plaza.kind === 'bandstand') put({ kind: 'bandstand', u: plaza.x, s: plaza.y, yaw: random() * Math.PI * 2 }, 7);
      else put({ kind: 'fountain', u: plaza.x, s: plaza.y, size: Math.max(.8, Math.min(1.5, (plaza.radius - 1) / 3.4)) }, 7);
    }
    if (plaza && !entry.circus) {
      // Benches facing in round the outside of the plaza's walk, where no walk leaves it
      const reach = park.square ? plaza.radius + SQUARE_WALK * 2 + .2 : plaza.radius + 4.9;
      for (const p of circle(plaza.x, plaza.y, reach, Math.max(6, Math.round(reach * Math.PI * 2 / 7)))) {
        const nx = (plaza.x - p.x) / reach, ny = (plaza.y - p.y) / reach;
        if (!onLawn(p.x, p.y) || pathClear(p.x, p.y) < 1 || entry.walks.some(walk => walk.length === 2 && distanceToPolyline(p, walk) < SQUARE_WALK + 1.2)) continue;
        put({ kind: 'bench', u: p.x, s: p.y, yaw: alongYaw(-nx, -ny) }, 2);
      }
    }
    if (entry.pond) {
      // The pond's coping is solid all round
      const shore = pondShore(entry.pond);
      for (const p of alongPolyline([...shore, shore[0]], 1.6)) add({ kind: 'rim', u: p.x, s: p.y, radius: .8 });
    }
    // Lanterns and benches beside the walks, on alternate sides
    const walks = park.square ? entry.walks.map(points => ({ points, halfWidth: SQUARE_WALK })) : CITY.roads.filter(road => road.kind === 'path').map(road => ({ points: road.points, halfWidth: road.profile.halfWidth }));
    for (const { points, halfWidth } of walks) {
      alongPolyline(points, 26, 9).forEach((p, i) => {
        const side = i % 2 ? 1 : -1, nx = -p.ty * side, ny = p.tx * side, x = p.x + nx * (halfWidth + 1.8), y = p.y + ny * (halfWidth + 1.8);
        if (onLawn(x, y) && pathClear(x, y) > 1.6 && parkClear(entry, x, y, .5)) put({ kind: 'lantern', u: x, s: y }, 3);
      });
      alongPolyline(points, 40, 22).forEach((p, i) => {
        const side = i % 2 ? -1 : 1, nx = -p.ty * side, ny = p.tx * side, x = p.x + nx * (halfWidth + 2), y = p.y + ny * (halfWidth + 2);
        if (!onLawn(x, y) || pathClear(x, y) < 1.6 || !parkClear(entry, x, y, .5)) return;
        // The seat faces its local -x: turn +x away from the walk
        if (put({ kind: 'bench', u: x, s: y, yaw: alongYaw(nx, ny) }, 2) && i % 3 === 0) put({ kind: 'bin', u: x + p.tx * 1.5, s: y + p.ty * 1.5 }, 1);
      });
    }
    // An avenue of trees down both sides of the loop walk
    if (entry.loop) for (const p of alongPolyline(entry.loop, 15, 7)) for (const side of [-1, 1]) {
      const x = p.x - p.ty * side * 7.5, y = p.y + p.tx * side * 7.5;
      if (onLawn(x, y) && pathClear(x, y) > 3 && parkClear(entry, x, y)) put({ kind: 'tree', u: x, s: y, scale: 8 + random() * 2 }, 6);
    }
    if (park.square) {
      // A row of trees just inside the square's edge, and on paving a second
      // row making an avenue of the promenade round it
      const ring = signedArea(lawn) > 0 ? lawn : lawn.slice().reverse();
      for (const inset of paved && entry.panels.length ? [4.5, 11.5] : [4.5]) for (const p of alongPolyline([...ring, ring[0]], paved ? 10 : 12, 5)) {
        const x = p.x - p.ty * inset, y = p.y + p.tx * inset;
        if (onLawn(x, y) && pathClear(x, y) > 3 && parkClear(entry, x, y, 1.5)) {
          const opening = rectanglePolygon(x, y, 1.8, 1.8, Math.atan2(p.ty, p.tx)).map(([x, y]) => ({ x, y }));
          const pit = paved && opening.every(p => insidePolygon(p, lawn) && !entry.panels.some(panel => insidePolygon(p, panel.outer))) ? opening : null;
          put({ kind: 'tree', u: x, s: y, scale: 7.5 + random() * 2, ...(pit ? { pit, pitLevel: PAVEMENT_LEVEL + .034 } : {}) }, 5);
        }
      }
      // and a few in its lawns
      for (const panel of entry.panels) {
        const b = polygonBounds(panel.outer), edge = [...panel.outer, panel.outer[0]], wanted = Math.floor(calcPolygonArea(panel.outer) / 700);
        for (let attempt = 0, count = 0; attempt < wanted * 8 && count < wanted; attempt++) {
          const x = b.minX + random() * (b.maxX - b.minX), y = b.minY + random() * (b.maxY - b.minY);
          if (!insidePolygon({ x, y }, panel.outer) || distanceToPolyline({ x, y }, edge) < 3.5 || !parkClear(entry, x, y, 2)) continue;
          if (put({ kind: 'tree', u: x, s: y, scale: 7 + random() * 2.5 }, 8)) count++;
        }
      }
    }
    // Groves: trees gather where the noise is high and leave open lawns elsewhere
    const wanted = paved ? 0 : Math.min(420, Math.floor(area / (park.square ? 420 : 170)));
    const grove = (x, y) => CITY.field.noise2D(x / 75 + entry.index * 13, y / 75 - entry.index * 7);
    for (let attempt = 0, count = 0; attempt < wanted * 8 && count < wanted; attempt++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX), y = bounds.minY + random() * (bounds.maxY - bounds.minY);
      const g = grove(x, y);
      if (!park.square && random() > (g > .15 ? .95 : g > -.15 ? .3 : .04)) continue;
      if (!onLawn(x, y) || pathClear(x, y) < 3.5 || !parkClear(entry, x, y)) continue;
      if (put({ kind: 'tree', u: x, s: y, scale: 7 + random() * 4.5 }, park.square ? 8 : 6.5)) count++;
    }
  }
  // Trees in the back yards where the houses have gardens, gathered in
  // groves as garden trees are rather than spaced evenly over the lawn
  for (const block of CITY.blocks) {
    if (!YARD_TREES[block.style] || !(block.yard?.length >= 3) || placeForBlock(block.index)) continue;
    const yard = block.yard, area = calcPolygonArea(yard), bounds = polygonBounds(yard), random = seededRandom(CITY.seed * 31 + block.index * 7717);
    const ring = [...yard, yard[0]], wanted = Math.floor(area / YARD_TREES[block.style]);
    const grove = (x, y) => CITY.field.noise2D(x / 55 + block.index * 3.1, y / 55 - block.index * 1.7);
    for (let attempt = 0, count = 0; attempt < wanted * 10 && count < wanted; attempt++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX), y = bounds.minY + random() * (bounds.maxY - bounds.minY), g = grove(x, y);
      if (random() > (g > .1 ? 1 : g > -.3 ? .4 : .08)) continue;
      const edge = distanceToPolyline({ x, y }, ring);
      if (!insidePolygon({ x, y }, yard) || edge < 3.6) continue;
      // (the houses stand back from the yard's edge, so a tree beside it has that room at least)
      if (put({ kind: 'tree', u: x, s: y, scale: Math.min(5.8 + random() * 3.8, treeRoom(edge)) }, 5.5)) count++;
    }
  }
  // Planted islands: in the middle of a big enough one a flower bed, or on a
  // bigger one a sculpture, square to its longest side, and trees over the
  // lawn, all clear of the junctions' corners and crosswalks
  for (const island of cityIslands()) {
    const { lawn, area, deepest } = island, ring = [...lawn, lawn[0]], random = seededRandom(CITY.seed * 57 + island.index * 4099);
    if (deepest && deepest.distance >= 2 && !inZone(deepest.point.x, deepest.point.y)) {
      const { x, y } = deepest.point;
      let yaw = 0, longest = 0;
      for (let i = 0; i < lawn.length; i++) {
        const a = lawn[i], b = lawn[(i + 1) % lawn.length], length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length > longest) { longest = length; yaw = Math.atan2(b.y - a.y, b.x - a.x); }
      }
      const tx = Math.cos(yaw), ty = Math.sin(yaw);
      const fits = (w, d) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => {
        const p = { x: x + tx * a * w / 2 - ty * b * d / 2, y: y + ty * a * w / 2 + tx * b * d / 2 };
        return insidePolygon(p, lawn) && distanceToPolyline(p, ring) > .3;
      });
      if (deepest.distance >= 4.5 && area >= 260 && random() < .5) put({ kind: 'sculpture', u: x, s: y, yaw, form: Math.floor(random() * 4), size: .62 }, 3);
      else {
        const w = [6.5, 4.6, 3.2].find(w => fits(w, 2.2));
        if (w) put({ kind: 'bed', u: x, s: y, yaw, w, d: 2.2, colour: BED_COLOURS[Math.floor(random() * BED_COLOURS.length)] }, w / 2 + .5);
      }
    }
    const bounds = polygonBounds(lawn), wanted = Math.floor(area / 170);
    for (let attempt = 0, count = 0; attempt < wanted * 8 && count < wanted; attempt++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX), y = bounds.minY + random() * (bounds.maxY - bounds.minY);
      if (!insidePolygon({ x, y }, lawn) || distanceToPolyline({ x, y }, ring) < 2 || inZone(x, y)) continue;
      if (put({ kind: 'tree', u: x, s: y, scale: 6.5 + random() * 2.5 }, 6)) count++;
    }
  }
  // Cars in the car parks behind the offices and warehouses
  for (const block of CITY.blocks) for (const bay of yardParking(block)) {
    if (bay.taken) add({ kind: 'parked', u: bay.x, s: bay.y, yaw: -bay.heading, model: bay.model, colour: bay.colour, yard: block.index });
  }
  // Cars parked in two bays in five along a street with parking, clear of
  // the crosswalks, the park gates, bus stops and the venues' doors
  const entrances = cityPlaces().map(place => place.entrance);
  const openings = parkingGaps().index;
  for (const edge of nav.edges) {
    const profile = edge.profile;
    if (!profile.parking || edge.kind === 'path') continue;
    const [from, to] = markedSpan(edge, geometry);
    for (let d = from + PARKING_BAY; d + PARKING_BAY / 2 < to; d += PARKING_BAY) for (const side of [-1, 1]) {
      const salt = edge.id * 131 + Math.round(d) * 2 + (side > 0 ? 1 : 0);
      if (randomAt(salt, 7406, CITY.seed) > .42) continue;
      const p = nav.pose(edge, d, 1), across = (profile.parking + profile.halfWidth) / 2, own = CITY.roadIndex.nearest(p.u, p.s, 2)?.road;
      const x = p.u + p.ty * side * across, y = p.s - p.tx * side * across;
      if (waterAt(y, x) || entrances.some(e => Math.hypot(e.u - x, e.s - y) < 16)) continue;
      if ([-2.6, 0, 2.6].some(along => openings.find(x + p.tx * along, y + p.ty * along))) continue;
      // (where the lane's curve and the drawn road part a little, the car
      // must still be in the drawn road's bay, not over its kerb)
      const kerbside = own && CITY.roadIndex.nearest(x, y, 12, segment => segment.road === own ? 0 : Infinity);
      const out = kerbside ? Math.hypot(kerbside.x - x, kerbside.y - y) : -1;
      if (out < profile.parking || out > profile.halfWidth - .3) continue;
      const path = CITY.roadIndex.nearest(x, y, 12, segment => segment.road.kind === 'path' ? 0 : Infinity);
      if (path && Math.hypot(path.x - x, path.y - y) < 8) continue;
      // and well clear of any other road's carriageway, where a street meets another at a slant
      const other = CITY.roadIndex.nearest(x, y, 24, (segment, distance) => segment.road === own || segment.road.kind === 'path' ? Infinity : distance - segment.road.profile.halfWidth);
      if (other && other.score < 3.5) continue;
      if (nearStop(x, y, 9) || acrossDrive(x, y, SIDEWALK + 5, 2)) continue;
      // Cars face the way their side's traffic goes
      const heading = side > 0 ? Math.atan2(p.tx, p.ty) : Math.atan2(-p.tx, -p.ty);
      const model = PARKED_MODELS[Math.floor(randomAt(salt, 7407, CITY.seed) * PARKED_MODELS.length)];
      add({ kind: 'parked', u: x, s: y, yaw: -heading, model, colour: Math.floor(randomAt(salt, 7408, CITY.seed) * 1e6) });
    }
  }
}
