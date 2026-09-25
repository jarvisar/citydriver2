import { CITY, SIDEWALK, cityStyleDistrict } from './city.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL, waterAt, onRoadAt, surfaceAt } from './city-route.js';
import { junctionGeometry, CROSSWALK, stopLineDistance } from './junction-geometry.js';
import { junctionControls } from '../city-junctions.js';
import { cityMedians, MEDIAN_KERB } from './city-medians.js';
import { cityParks, parkClear, pondShore, SQUARE_WALK, BED_COLOURS } from './city-parks.js';
import { faceYaw, alongYaw } from './city-layout-render.js';
import { randomAt, seededRandom } from './route.js';
import { offsetPolyline, offsetPolylineClean, offsetPolygon, insidePolygon, polygonBounds, calcPolygonArea, signedArea, distanceToPolyline, averagePoint, bufferPolyline } from '../mapgen/polygon-util.js';
import { navGraph } from './nav-graph.js';
import { cityPlaces, placeForBlock } from '../city-exploration.js';
import { cityIslands, islandFor } from './city-islands.js';
import { clipInside } from '../mapgen/road-network.js';
import { frontSetback, treeRoom } from './city-buildings.js';
import { yardParking, yardDrive, YARD_BAY, PARKED_MODELS } from './city-yards.js';
export { yardParking, YARD_BAY } from './city-yards.js';

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
};
// A park pond's water, a little below its lawn and clear of the ground under
// it however its waves move
const POND_LEVEL = ROAD_LEVEL + .08;
const circle = (x, y, r, count = 24) => Array.from({ length: count }, (_, k) => ({ x: x + Math.cos(k / count * Math.PI * 2) * r, y: y + Math.sin(k / count * Math.PI * 2) * r }));

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
// A polyline with points added along it at most `step` apart
const densify = (points, step) => points.flatMap((p, i) => {
  if (!i) return [p];
  const a = points[i - 1], count = Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / step);
  return Array.from({ length: count }, (_, k) => ({ x: a.x + (p.x - a.x) * (k + 1) / count, y: a.y + (p.y - a.y) * (k + 1) / count }));
});
const polylineLength = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

// How far a road's carriageway reaches from its centre line on one side at
// a point: to its kerb, or where a bridge's footway takes the edge of the road
function kerbReach(p, nx, ny, halfWidth) {
  for (let d = Math.max(0, halfWidth - 3.2); d < halfWidth; d += .1) if (CITY.pavement.find(p.x + nx * d, p.y + ny * d)?.kind === 'bridge') return d;
  return halfWidth;
}
// Where a street's own markings may run: from beyond the crosswalk at one end
// to beyond the crosswalk at the other.
function markedSpan(nav, edge, geometry) {
  const end = id => { const clear = geometry.get(id)?.approaches.get(edge)?.clear; return clear === undefined ? 2 : clear + CROSSWALK + 1.2; };
  return [end(edge.a), edge.length - end(edge.b)];
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
  const kept = [], cells = new Map(), cellOf = p => `${Math.floor(p.x / 40)},${Math.floor(p.y / 40)}`;
  for (const walk of all) {
    const c = walk.outline[0], cx = Math.floor(c.x / 40), cy = Math.floor(c.y / 40);
    let clear = true;
    for (let dx = -1; dx <= 1 && clear; dx++) for (let dy = -1; dy <= 1 && clear; dy++) {
      for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) if (convexOverlap(other.outline, walk.outline, .3)) { clear = false; break; }
    }
    if (!clear) continue;
    kept.push(walk);
    const key = cellOf(c);
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
  const parkKerbs = CITY.parkPlans.filter(park => park.kerb.length >= 3).map(park => park.kerb);
  for (const road of CITY.roads) {
    if (road.kind !== 'path') { roads.ribbon(road.points, road.profile.halfWidth, ROAD_LEVEL, COLOURS.road); continue; }
    // A path is drawn on the lawn and the park's pavement, never out over the street
    for (const kerb of parkKerbs) for (const run of clipInside(road.points, kerb, 0)) paths.ribbon(run, road.profile.halfWidth, PAVEMENT_LEVEL + .035, COLOURS.path);
  }
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
    const profile = edge.profile, [from, to] = markedSpan(nav, edge, geometry);
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
      for (const side of [-1, 1]) {
        markings.ribbon(offsetPolyline(span, side * profile.parking), .07, ROAD_LEVEL + .012, COLOURS.line);
        for (const p of alongPolyline(span, PARKING_BAY, PARKING_BAY / 2)) {
          const nx = -p.ty * side, ny = p.tx * side, a = profile.parking, b = profile.halfWidth - .3;
          markings.polygon([{ x: p.x + nx * a - p.tx * .05, y: p.y + ny * a - p.ty * .05 }, { x: p.x + nx * b - p.tx * .05, y: p.y + ny * b - p.ty * .05 },
            { x: p.x + nx * b + p.tx * .05, y: p.y + ny * b + p.ty * .05 }, { x: p.x + nx * a + p.tx * .05, y: p.y + ny * a + p.ty * .05 }], ROAD_LEVEL + .012, COLOURS.line);
        }
      }
    }
  }
  // Raised medians down the boulevards and the ring's parkway, kerbed, with
  // grass in them (see city-medians.js)
  for (const median of cityMedians(nav).list) {
    const top = ROAD_LEVEL + MEDIAN_KERB;
    ground.polygon(median.polygon, top, COLOURS.medianKerb);
    const lawn = offsetPolygon(median.polygon, -.3);
    if (lawn.length >= 3) ground.polygon(lawn, top + .015, COLOURS.median);
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
  const crosswalks = cityCrosswalks(nav), onCrosswalk = mark => crosswalks.some(walk => convexOverlap(walk.outline, mark, .02));
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
    // The plaza in the middle, paved out to the walk round it
    if (entry.plaza) {
      const reach = park.square ? entry.plaza.radius + SQUARE_WALK * 2 + .6 : entry.plaza.radius + 4.4;
      // (over the ends of the paths that lead to it)
      const disc = circle(entry.plaza.x, entry.plaza.y, reach, 28);
      ground.polygon(disc, PAVEMENT_LEVEL + .05, paved ? COLOURS.flags : COLOURS.plaza);
      ground.wall(clockwise(disc), PAVEMENT_LEVEL + .05, PAVEMENT_LEVEL, paved ? COLOURS.flags : COLOURS.plaza, true);
    }
    // A paved square's lawns
    for (const panel of entry.panels) ground.polygon(panel.outer, PAVEMENT_LEVEL + .03, COLOURS.lawn, null, true, panel.holes);
    // A square's own walks
    for (const walk of entry.walks) paths.ribbon(walk, SQUARE_WALK, PAVEMENT_LEVEL + .035, paved ? COLOURS.flags : COLOURS.path);
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
  // Bridge decks: the road surface is already there; add the sides and piers
  for (const bridge of bridges) {
    const halfWidth = bridge.road.profile.halfWidth, points = bridge.points;
    // Its sides, up to the footway where one runs along them and otherwise to
    // the road, in stretches as the footway comes and goes
    // (every quarter metre, so each stretch starts and stops with the footway)
    const dense = densify(points, .25);
    for (const side of [-1, 1]) {
      // (only where the footway reaches the very edge: where another road
      // crosses the end of the deck, the side stays under its carriageway)
      const edge = offsetPolyline(dense, side * halfWidth), inner = offsetPolyline(dense, side * (halfWidth - 1)), rim = offsetPolyline(dense, side * (halfWidth - .03));
      const onFootway = inner.map((p, i) => CITY.pavement.find(p.x, p.y)?.kind === 'bridge' && CITY.pavement.find(rim[i].x, rim[i].y)?.kind === 'bridge');
      // (a piece of side is raised only with the footway at both its ends)
      const raised = edge.slice(1).map((p, i) => onFootway[i] && onFootway[i + 1]);
      for (let i = 0; i < edge.length - 1;) {
        let j = i + 1;
        while (j < edge.length - 1 && raised[j] === raised[i]) j++;
        walls.wall(edge.slice(i, j + 1), raised[i] ? PAVEMENT_LEVEL : ROAD_LEVEL - .01, ROAD_LEVEL - 1.4, '#8f8b80');
        i = j;
      }
    }
    // Its footways, raised and paved as the promenades they carry on from,
    // kerbed all round as a promenade is
    for (const footway of bridge.footways) {
      ground.polygon(footway.polygon, PAVEMENT_LEVEL, COLOURS.quay);
      ground.wall(clockwise(footway.polygon), PAVEMENT_LEVEL, ROAD_LEVEL - .02, COLOURS.kerb, true);
    }
    walls.ribbon(points, halfWidth, ROAD_LEVEL - 1.4, '#6f6b63');
    for (const p of alongPolyline(points, 30, 15)) {
      const nx = -p.ty, ny = p.tx, along = 1.2, across = halfWidth - 1;
      const corners = [
        { x: p.x + p.tx * along + nx * across, y: p.y + p.ty * along + ny * across }, { x: p.x - p.tx * along + nx * across, y: p.y - p.ty * along + ny * across },
        { x: p.x - p.tx * along - nx * across, y: p.y - p.ty * along - ny * across }, { x: p.x + p.tx * along - nx * across, y: p.y + p.ty * along - ny * across },
      ];
      walls.wall(corners, ROAD_LEVEL - 1.3, WATER_LEVEL - 3, '#7d7a72', true);
    }
  }
}
// Whether the shore at p (running along t, the water on its right) is built
// over: a carriageway on it, or a pavement carried on over the water
// (or a kerb corner rounded off a walk, which is road on the land side)
const shoreCovered = (p, tx, ty) => Boolean(onRoadAt(p.y, p.x)) || Boolean(CITY.pavement.find(p.x + ty, p.y - tx)) || surfaceAt(p.y + tx * .6, p.x - ty * .6) === 'road';
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
  const stops = [], onPlaced = (x, y, kind, radius) => kind === 'shelter' && stops.some(stop => Math.hypot(stop.x - x, stop.y - y) < radius);
  // Street furniture stands on a pavement, whatever placed it
  const PAVED = new Set(['lamp', 'bin', 'shelter', 'stop', 'yield', 'signal', 'sign', 'parking-sign']);
  // A car park's driveway: nothing stands across its mouth, and nobody parks
  // in front of it ('reach' is how far out from the buildings' line to keep clear)
  const mouths = CITY.blocks.map(block => yardDrive(block.index)).filter(Boolean);
  const acrossDrive = (x, y, reach, margin) => mouths.some(d => {
    const dx = x - d.mouth.x, dy = y - d.mouth.y, out = -(dx * d.nx + dy * d.ny);
    return out > -1 && out < reach && Math.abs(dx * d.tx + dy * d.ty) < d.width / 2 + margin;
  });
  const put = (piece, radius = 1.5) => {
    // on a pavement, and not where a road or park path runs across it
    if ((PAVED.has(piece.kind) || piece.street) && (!CITY.pavement.find(piece.u, piece.s) || onRoadAt(piece.s, piece.u))) return false;
    if (piece.kind !== 'parking-sign' && acrossDrive(piece.u, piece.s, SIDEWALK + .5, .6)) return false;
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
  for (const place of cityPlaces()) {
    const entry = place.park === undefined ? null : parkEntries.get(place.park), lawn = entry?.park.lawn;
    if (!(lawn?.length >= 3)) continue;
    const e = place.entrance;
    // The lawn's edge nearest the gate, and which way is out of the lawn there
    let best = null;
    for (let i = 0; i < lawn.length; i++) {
      const a = lawn[i], b = lawn[(i + 1) % lawn.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((e.u - a.x) * dx + (e.s - a.y) * dy) / l2)), x = a.x + dx * t, y = a.y + dy * t, d = Math.hypot(x - e.u, y - e.s);
      if (!best || d < best.d) best = { x, y, d, tx: dx / Math.sqrt(l2), ty: dy / Math.sqrt(l2) };
    }
    let ox = best.ty, oy = -best.tx;
    if (insidePolygon({ x: best.x + ox * .5, y: best.y + oy * .5 }, lawn)) { ox = -ox; oy = -oy; }
    // Along that edge either way from the gate, a spot on the lawn clear of
    // the walks and whatever stands on it, with the board all on the lawn
    const walkClear = (x, y) => { const road = CITY.roadIndex.nearest(x, y, 20, (segment, distance) => segment.road.kind === 'path' ? distance - segment.road.profile.halfWidth : Infinity); return !road || road.score > 1.4; };
    const width = 3.6;
    for (const along of [4, -4, 6.5, -6.5, 9, -9, 12, -12, 16, -16]) {
      const u = best.x + best.tx * along - ox * 2.4, y = best.y + best.ty * along - oy * 2.4;
      const ends = [-1, 1].map(k => ({ x: u + best.tx * k * (width / 2 + .3), y: y + best.ty * k * (width / 2 + .3) }));
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
  for (const { ring, block } of kerbs) {
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
        if (put({ kind: 'tree', u: x, s: y, scale }, 3)) break;
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
  for (const run of CITY.walls) {
    // (and none where the walk carries on over the water)
    const samples = alongPolyline(offsetPolylineClean(run, 1.1), .5), clear = samples.map(p => kerbClear(p) && !CITY.pavement.find(p.x + p.ty * 2.1, p.y - p.tx * 2.1));
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
  // Bridges: railings on both edges of the deck
  const crossings = cityCrosswalks(nav);
  for (const bridge of bridges) {
    const halfWidth = bridge.road.profile.halfWidth;
    for (const side of [-1, 1]) {
      const edge = offsetPolyline(bridge.points, side * (halfWidth - .35));
      for (const p of alongPolyline(edge, 4, 2)) {
        // (over the water, reaching to meet the quay's railing, and not across
        // another road that joins the bridge)
        if (!waterAt(p.y + p.ty * 2, p.x + p.tx * 2) && !waterAt(p.y - p.ty * 2, p.x - p.tx * 2)) continue;
        const other = CITY.roadIndex.nearest(p.x, p.y, 30, (segment, distance) => segment.road === bridge.road || segment.road.kind === 'path' ? Infinity : distance - segment.road.profile.halfWidth);
        if (other && other.score < 2.2) continue;
        // (nor across a crosswalk where a junction is at the bridge's end)
        const span = [{ x: p.x - p.tx * 2 - p.ty * .05, y: p.y - p.ty * 2 + p.tx * .05 }, { x: p.x + p.tx * 2 - p.ty * .05, y: p.y + p.ty * 2 + p.tx * .05 },
          { x: p.x + p.tx * 2 + p.ty * .05, y: p.y + p.ty * 2 - p.tx * .05 }, { x: p.x - p.tx * 2 + p.ty * .05, y: p.y - p.ty * 2 - p.tx * .05 }];
        if (crossings.some(walk => convexOverlap(walk.outline, span))) continue;
        add({ kind: 'railing', u: p.x, s: p.y, yaw: faceYaw(p.tx, p.ty), y: CITY.pavement.find(p.x, p.y)?.kind === 'bridge' ? PAVEMENT_LEVEL : ROAD_LEVEL });
      }
    }
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
        if (onLawn(x, y) && pathClear(x, y) > 3 && parkClear(entry, x, y, 1.5)) put({ kind: 'tree', u: x, s: y, scale: 7.5 + random() * 2 }, 5);
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
  for (const edge of nav.edges) {
    const profile = edge.profile;
    if (!profile.parking || edge.kind === 'path') continue;
    const [from, to] = markedSpan(nav, edge, geometry);
    for (let d = from + PARKING_BAY; d + PARKING_BAY / 2 < to; d += PARKING_BAY) for (const side of [-1, 1]) {
      const salt = edge.id * 131 + Math.round(d) * 2 + (side > 0 ? 1 : 0);
      if (randomAt(salt, 7406, CITY.seed) > .42) continue;
      const p = nav.pose(edge, d, 1), across = (profile.parking + profile.halfWidth) / 2, own = CITY.roadIndex.nearest(p.u, p.s, 2)?.road;
      const x = p.u + p.ty * side * across, y = p.s - p.tx * side * across;
      if (waterAt(y, x) || entrances.some(e => Math.hypot(e.u - x, e.s - y) < 16)) continue;
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
      if (onPlaced(x, y, 'shelter', 9) || acrossDrive(x, y, SIDEWALK + 5, 2)) continue;
      // Cars face the way their side's traffic goes
      const heading = side > 0 ? Math.atan2(p.tx, p.ty) : Math.atan2(-p.tx, -p.ty);
      const model = PARKED_MODELS[Math.floor(randomAt(salt, 7407, CITY.seed) * PARKED_MODELS.length)];
      add({ kind: 'parked', u: x, s: y, yaw: -heading, model, colour: Math.floor(randomAt(salt, 7408, CITY.seed) * 1e6) });
    }
  }
}
