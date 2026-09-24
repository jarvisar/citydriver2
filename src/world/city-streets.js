import { CITY, SIDEWALK } from './city.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL, waterAt, onRoadAt } from './city-route.js';
import { junctionGeometry, CROSSWALK, stopLineDistance } from './junction-geometry.js';
import { junctionControls } from '../city-junctions.js';
import { cityMedians, MEDIAN_KERB } from './city-medians.js';
import { cityParks, parkClear, pondShore, SQUARE_WALK, BED_COLOURS } from './city-parks.js';
import { faceYaw, alongYaw } from './city-layout-render.js';
import { randomAt, seededRandom } from './route.js';
import { offsetPolyline, offsetPolylineClean, offsetPolygon, insidePolygon, polygonBounds, calcPolygonArea, signedArea, distanceToPolyline } from '../mapgen/polygon-util.js';
import { cityPlaces, placeForBlock } from '../city-exploration.js';
import { cityIslands, islandFor } from './city-islands.js';
import { clipInside } from '../mapgen/road-network.js';

// The streets as the city draws and furnishes them. Everything here is laid
// out from the same few models: the road centre lines and their profiles, the
// kerbs (block pavements with rounded corners), the junction geometry and the
// quays. So a crosswalk starts where the kerb corner ends, the stop line and
// the sign stand behind it on the approach's own right-hand pavement, and a
// lamp or tree only ever stands on a pavement.

const LAMP_SPACING = 27, TREE_SPACING = 19;
// What stands in the parking bays, commonest first
const PARKED_MODELS = ['sedan', 'hatchback', 'wagon', 'sedan', 'hatchback', 'pickup', 'van'];
// A parking bay's length along the kerb
export const PARKING_BAY = 6.5;
export const COLOURS = {
  road: '#666c70', marking: '#d8bd80', line: '#d7d8c9', stripe: '#deddd0', stop: '#e1dfce',
  pavement: '#acafa8', kerb: '#9a9d98', lawn: '#79a05a', median: '#779757', medianKerb: '#c3bfab',
  quay: '#b3aea0', land: '#8e9b6a', path: '#b9ad8e', plaza: '#c2b9a3', flags: '#b1a78f', coping: '#c9c1ad',
};
// A park pond's water, a little below its lawn and clear of the ground under
// it however its waves move
const POND_LEVEL = ROAD_LEVEL + .08;
const circle = (x, y, r, count = 24) => Array.from({ length: count }, (_, k) => ({ x: x + Math.cos(k / count * Math.PI * 2) * r, y: y + Math.sin(k / count * Math.PI * 2) * r }));

// The paved yards behind the offices and warehouses are car parks: rows of
// bays square to the yard's longest side, back to back across aisles, a few
// more than half of them taken. Laid out once per block, for the markings and
// the cars alike.
const PARKED_YARDS = new Set(['Midtown', 'Warehouse district']);
export const YARD_BAY = { width: 2.7, depth: 5.2, aisle: 6.4, margin: 1.4 };
const yardBays = new Map();
export function yardParking(block) {
  if (yardBays.has(block)) return yardBays.get(block);
  const bays = [];
  yardBays.set(block, bays);
  // (not in a venue's grounds)
  if (!PARKED_YARDS.has(block.style) || !(block.yard?.length >= 3) || calcPolygonArea(block.yard) < 450 || placeForBlock(block.index)) return bays;
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
  // An aisle, two rows of bays back to back, an aisle, and so on across the yard
  for (let row = 0, v = v0 + aisle + depth / 2; v + depth / 2 <= v1; row++, v += row % 2 ? depth : depth + aisle) {
    for (let u = u0 + width / 2; u + width / 2 <= u1; u += width) {
      if (!inside(u, v)) continue;
      // Each car noses into its bay, away from the aisle it came in by
      const sign = row % 2 ? 1 : -1, p = at(u, v);
      bays.push({ x: p.x, y: p.y, ux, uy, vx, vy, heading: Math.atan2(vx * sign, vy * sign), taken: random() < .58,
        model: PARKED_MODELS[Math.floor(random() * PARKED_MODELS.length)], colour: Math.floor(random() * 1e6) });
    }
  }
  // A handful of bays is not a car park
  if (bays.length < 6) bays.length = 0;
  return bays;
}

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
const crosswalkCache = new WeakMap();
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
      all.push({ node, edge, near, far, halfWidth, outline: [at(near, -halfWidth + .8), at(near, halfWidth - .5), at(far, halfWidth - .5), at(far, -halfWidth + .8)] });
    }
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
  for (const { near, far, halfWidth } of cityCrosswalks(nav)) {
    const at = (p, across) => ({ x: p.x + p.rx * across, y: p.y + p.ry * across });
    for (let across = -halfWidth + .8; across < halfWidth - .5; across += 1.6) {
      markings.polygon([at(near, across), at(near, across + .85), at(far, across + .85), at(far, across)], ROAD_LEVEL + .014, COLOURS.stripe);
    }
  }
  for (const [node, control] of controls) {
    const shape = geometry.get(node.id);
    for (const [edge, approach] of control.approaches) {
      const arm = shape.approaches.get(edge), halfWidth = edge.profile.halfWidth;
      if (arm.link || approach.kind === 'priority') continue;
      const at = (p, across) => ({ x: p.x + p.rx * across, y: p.y + p.ry * across });
      const inner = edge.profile.median ? edge.profile.median + .2 : .25, outer = halfWidth - (edge.profile.parking ? halfWidth - edge.profile.parking + .2 : .4);
      if (approach.kind === 'yield') {
        // A row of teeth across the lane, pointing at the driver who gives way
        const base = approachPoint(nav, edge, node, stopLineDistance(arm.clear) - .3), tip = approachPoint(nav, edge, node, stopLineDistance(arm.clear) + .6);
        for (let across = inner + .15; across + .55 <= outer; across += .85) markings.polygon([at(base, across), at(base, across + .55), at(tip, across + .275)], ROAD_LEVEL + .014, COLOURS.stop);
        continue;
      }
      const line = approachPoint(nav, edge, node, stopLineDistance(arm.clear) - .2), back = approachPoint(nav, edge, node, stopLineDistance(arm.clear) + .25);
      markings.polygon([at(line, inner), at(line, halfWidth - .4), at(back, halfWidth - .4), at(back, inner)], ROAD_LEVEL + .014, COLOURS.stop);
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
      ground.polygon(circle(entry.plaza.x, entry.plaza.y, reach, 28), PAVEMENT_LEVEL + .03, paved ? COLOURS.flags : COLOURS.plaza);
    }
    // A paved square's lawns
    for (const panel of entry.panels) ground.polygon(panel.outer, PAVEMENT_LEVEL + .03, COLOURS.lawn, null, true, panel.holes);
    // A square's own walks
    for (const walk of entry.walks) paths.ribbon(walk, SQUARE_WALK, PAVEMENT_LEVEL + .035, paved ? COLOURS.flags : COLOURS.path);
    // A pond: water a little below the lawn, inside a low stone coping
    if (entry.pond) {
      const shore = pondShore(entry.pond), ring = [...shore, shore[0]];
      water.polygon(shore, POND_LEVEL, '#3f7f86', () => [1, 0]);
      walls.wall(signedArea(shore) > 0 ? ring.slice().reverse() : ring, PAVEMENT_LEVEL + .3, POND_LEVEL - .4, COLOURS.coping);
      walls.ribbon(offsetPolyline(signedArea(shore) > 0 ? ring : ring.slice().reverse(), -.35), .38, PAVEMENT_LEVEL + .3, COLOURS.coping);
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
  for (const run of CITY.walls) { walls.wall(run, PAVEMENT_LEVEL + .02, WATER_LEVEL - 1.6, '#9b9789'); walls.ribbon(offsetPolyline(run, .25), .3, PAVEMENT_LEVEL + .2, '#b3aea0'); }
  // Bridge decks: the road surface is already there; add the sides and piers
  for (const bridge of bridges) {
    const halfWidth = bridge.road.profile.halfWidth, points = bridge.points;
    for (const side of [-1, 1]) walls.wall(offsetPolyline(points, side * halfWidth), ROAD_LEVEL - .01, ROAD_LEVEL - 1.4, '#8f8b80');
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
// Surface.wall faces the right of travel; a clockwise ring faces outward
const clockwise = polygon => signedArea(polygon) > 0 ? polygon.slice().reverse() : polygon;
// What the ground inside a block is: gardens where the district has them, paving elsewhere
const GARDEN_STYLES = new Set(['Garden quarter', 'Civic quarter']);
// Where the back yards have trees in them
const YARD_TREES = new Set(['Garden quarter', 'Civic quarter', 'Old town', 'Market district']);
export const blockGround = block => GARDEN_STYLES.has(block.style) ? '#86a263' : block.style === 'Warehouse district' ? '#a8a598' : '#b3b2a5';
export const yardGround = block => block.style === 'Warehouse district' ? '#9e9b8e' : block.style === 'Midtown' ? '#a9a99d' : '#83a05e';

// Bridges: the runs of a road over water
export function findBridges() {
  const bridges = [];
  for (const road of CITY.roads) {
    if (road.kind === 'path') continue;
    let run = null;
    const flush = () => { if (run && run.length > 2) bridges.push({ road, points: run }); run = null; };
    for (const p of alongPolyline(road.points, 3)) {
      if (waterAt(p.y, p.x)) { run ??= []; run.push(p); } else flush();
    }
    flush();
  }
  // Carry each deck a few metres onto the banks
  for (const bridge of bridges) {
    const a = bridge.points[0], b = bridge.points[bridge.points.length - 1];
    bridge.points = [{ x: a.x - a.tx * 5, y: a.y - a.ty * 5 }, ...bridge.points, { x: b.x + b.tx * 5, y: b.y + b.ty * 5 }];
  }
  return bridges;
}

// Street furniture for the whole city, as pieces the chunks stand up:
// { kind, u, s, yaw, ... } with yaw an item yaw (see city-layout-render.js).
export function placeStreetFurniture(nav, bridges, add) {
  const geometry = junctionGeometry(nav), controls = junctionControls(nav);
  // Junction zones: nothing stands on a corner or in a crosswalk's path
  const zones = [...geometry.values()].map(shape => ({ x: shape.node.x, y: shape.node.y, r: shape.arms.reduce((sum, arm) => sum + arm.clear, 0) / shape.arms.length + CROSSWALK + 2.5 }));
  const zoneIndex = new Map();
  for (const zone of zones) {
    const key = `${Math.floor(zone.x / 60)},${Math.floor(zone.y / 60)}`;
    if (!zoneIndex.has(key)) zoneIndex.set(key, []);
    zoneIndex.get(key).push(zone);
  }
  // Junction corners and crosswalks, and wherever a road or park path crosses
  // a pavement (a median stands in its own road, so asks only of junctions)
  const inZone = (x, y, junctionsOnly = false) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const zone of zoneIndex.get(`${Math.floor(x / 60) + dx},${Math.floor(y / 60) + dy}`) ?? []) if (Math.hypot(zone.x - x, zone.y - y) < zone.r) return true;
    }
    if (junctionsOnly) return false;
    const road = CITY.roadIndex.nearest(x, y, 12, (segment, distance) => distance - segment.road.profile.halfWidth);
    return Boolean(road && (road.score < 0 || road.road.kind === 'path' && road.score < 1.5));
  };
  // What already stands, by 10 m cell, so nothing is placed on top of anything else
  const placed = new Map(), cellOf = (x, y) => Math.floor(x / 10) * 65536 + Math.floor(y / 10);
  const free = (x, y, radius) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const p of placed.get(cellOf(x + dx * 10, y + dy * 10)) ?? []) if (Math.hypot(p.x - x, p.y - y) < radius) return false;
    }
    return true;
  };
  // Bus stops, which the parked cars leave clear
  const stops = [], onPlaced = (x, y, kind, radius) => kind === 'shelter' && stops.some(stop => Math.hypot(stop.x - x, stop.y - y) < radius);
  // Street furniture stands on a pavement, whatever placed it
  const PAVED = new Set(['lamp', 'bin', 'shelter', 'stop', 'yield', 'signal', 'sign']);
  const put = (piece, radius = 1.5) => {
    // on a pavement, and not where a road or park path runs across it
    if (PAVED.has(piece.kind) && (!CITY.pavement.find(piece.u, piece.s) || onRoadAt(piece.s, piece.u))) return false;
    if (!free(piece.u, piece.s, Math.min(radius, 10))) return false;
    const key = cellOf(piece.u, piece.s);
    if (!placed.has(key)) placed.set(key, []);
    placed.get(key).push({ x: piece.u, y: piece.s });
    add(piece);
    return true;
  };
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
        const reach = edge.profile.halfWidth + 1.1, u = p.x + p.rx * reach, y = p.y + p.ry * reach;
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
  // A sign board on the pavement at every place's entrance, square to the
  // street, before the lamps and trees take the kerb: beside a venue's
  // forecourt rather than across it, or as near a park's gate as it can stand
  for (const place of cityPlaces()) {
    const e = place.entrance, du = Math.sin(e.heading), ds = Math.cos(e.heading);
    const road = CITY.roadIndex.nearest(e.u, e.s, 40, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance);
    if (!road) continue;
    const reach = road.road.profile.halfWidth + SIDEWALK - 1.2, aside = place.footprint ? Math.min(place.footprint.width, 14) / 2 + 3 : 0;
    let signed = false;
    for (const along of [0, 4, 8, 12, 16, 20, 24].flatMap(step => [aside + step, -aside - step])) {
      const u = road.x + du * along + ds * reach, y = road.y + ds * along - du * reach;
      if (waterAt(y, u) || inZone(u, y)) continue;
      if (put({ kind: 'sign', type: place.type, variant: place.variant, u, s: y, yaw: faceYaw(du, ds) }, 3)) { signed = true; break; }
    }
    if (signed) continue;
    // A venue whose frontage is all junction corners has its sign just inside
    // its grounds, beside the forecourt, and a square (a circus) just inside
    // its lawn, facing the same way
    const f = place.footprint;
    if (f) {
      for (const side of [1, -1]) {
        const along = side * (Math.min(f.width, 14) / 2 + 3), u = f.front.x - f.nx * (f.setback + 3) + f.tx * along, y = f.front.y - f.ny * (f.setback + 3) + f.ty * along;
        if (!insidePolygon({ x: u, y }, place.polygon) || !free(u, y, 2)) continue;
        add({ kind: 'sign', type: place.type, variant: place.variant, u, s: y, yaw: faceYaw(du, ds) });
        break;
      }
      continue;
    }
    const lawn = place.park === undefined ? null : CITY.parkPlans[place.park].lawn;
    if (!(lawn?.length >= 3)) continue;
    let best = null;
    for (let i = 0; i < lawn.length; i++) {
      const a = lawn[i], b = lawn[(i + 1) % lawn.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((e.u - a.x) * dx + (e.s - a.y) * dy) / l2)), x = a.x + dx * t, y = a.y + dy * t;
      if (!best || Math.hypot(x - e.u, y - e.s) < Math.hypot(best.x - e.u, best.y - e.s)) best = { x, y };
    }
    const inward = Math.hypot(place.u - best.x, place.s - best.y) || 1, u = best.x + (place.u - best.x) / inward * 2.2, y = best.y + (place.s - best.y) / inward * 2.2;
    if (insidePolygon({ x: u, y }, lawn) && free(u, y, 2)) add({ kind: 'sign', type: place.type, variant: place.variant, u, s: y, yaw: faceYaw(du, ds) });
  }
  // Lamps near the kerb and trees in the pavement, round every block and park,
  // clear of the junctions. The ring of a kerb runs anticlockwise, so the road
  // is on the right and the pavement on the left.
  const kerbs = [...CITY.blocks.map(block => ({ ring: block.kerb, block })), ...CITY.parkPlans.filter(park => !park.square).map(park => ({ ring: park.kerb, park }))];
  for (const { ring, block } of kerbs) {
    if (ring.length < 3) continue;
    const loop = [...ring, ring[0]], perimeter = polylineLength(loop);
    if (perimeter < 40) continue;
    const trees = !block || block.style !== 'Midtown' || randomAt(block.index, 7402, CITY.seed) < .5;
    const lampStart = randomAt(block?.index ?? 0, 7403, CITY.seed) * LAMP_SPACING;
    // A bus shelter now and then where the pavement runs along a main road,
    // its open side to the kerb
    let sinceShelter = 120 + randomAt(block?.index ?? 0, 7404, CITY.seed) * 120;
    for (const p of alongPolyline(loop, 30, 15)) {
      sinceShelter += 30;
      const nx = -p.ty, ny = p.tx, x = p.x + nx * 1.7, y = p.y + ny * 1.7;
      const road = CITY.roadIndex.nearest(p.x, p.y, 16);
      if (sinceShelter < 240 || !road || !['main', 'major', 'ring'].includes(road.road.kind) || inZone(x, y)) continue;
      if (put({ kind: 'shelter', u: x, s: y, yaw: alongYaw(nx, ny) }, 6)) { sinceShelter = 0; stops.push({ x, y }); }
    }
    let lamps = 0;
    for (const p of alongPolyline(loop, LAMP_SPACING, lampStart)) {
      const nx = -p.ty, ny = p.tx, x = p.x + nx * .7, y = p.y + ny * .7;
      if (inZone(x, y)) continue;
      if (!put({ kind: 'lamp', u: x, s: y, yaw: alongYaw(nx, ny) }, 4)) continue;
      // A litter bin beside every third lamp
      if (++lamps % 3 === 0) put({ kind: 'bin', u: x + p.tx * 1.4, s: y + p.ty * 1.4 }, 1);
    }
    if (!trees) continue;
    for (const p of alongPolyline(loop, TREE_SPACING, lampStart + TREE_SPACING / 2)) {
      const nx = -p.ty, ny = p.tx, x = p.x + nx * 1.9, y = p.y + ny * 1.9;
      if (inZone(x, y)) continue;
      put({ kind: 'tree', u: x, s: y, scale: 7.2 + randomAt(Math.round(x), Math.round(y) + 31, CITY.seed) * 2.4 }, 3);
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
  // Railings along the quay walls, with a gap wherever a road meets the water
  for (const run of CITY.walls) {
    const inland = offsetPolylineClean(run, 1.1);
    for (const p of alongPolyline(inland, 4, 2)) {
      const road = CITY.roadIndex.nearest(p.x, p.y, 30, (segment, distance) => distance - segment.road.profile.halfWidth);
      if (road && road.score < 1.5) continue;
      add({ kind: 'railing', u: p.x, s: p.y, yaw: faceYaw(p.tx, p.ty), y: PAVEMENT_LEVEL });
    }
  }
  // Bridges: railings on both edges of the deck
  for (const bridge of bridges) {
    const halfWidth = bridge.road.profile.halfWidth;
    for (const side of [-1, 1]) {
      const edge = offsetPolyline(bridge.points, side * (halfWidth - .35));
      for (const p of alongPolyline(edge, 4, 2)) add({ kind: 'railing', u: p.x, s: p.y, yaw: faceYaw(p.tx, p.ty), y: ROAD_LEVEL });
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
    for (const { x, y, ...feature } of entry.features) add({ ...feature, u: x, s: y });
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
  // A few trees in the back yards where the houses have gardens
  for (const block of CITY.blocks) {
    if (!YARD_TREES.has(block.style) || !(block.yard?.length >= 3) || placeForBlock(block.index)) continue;
    const yard = block.yard, area = calcPolygonArea(yard), bounds = polygonBounds(yard), random = seededRandom(CITY.seed * 31 + block.index * 7717);
    const ring = [...yard, yard[0]], wanted = Math.floor(area / 650);
    for (let attempt = 0, count = 0; attempt < wanted * 6 && count < wanted; attempt++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX), y = bounds.minY + random() * (bounds.maxY - bounds.minY);
      if (!insidePolygon({ x, y }, yard) || distanceToPolyline({ x, y }, ring) < 4) continue;
      if (put({ kind: 'tree', u: x, s: y, scale: 6 + random() * 3.5 }, 7)) count++;
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
      const path = CITY.roadIndex.nearest(x, y, 12, segment => segment.road.kind === 'path' ? 0 : Infinity);
      if (path && Math.hypot(path.x - x, path.y - y) < 8) continue;
      // and well clear of any other road's carriageway, where a street meets another at a slant
      const other = CITY.roadIndex.nearest(x, y, 24, (segment, distance) => segment.road === own || segment.road.kind === 'path' ? Infinity : distance - segment.road.profile.halfWidth);
      if (other && other.score < 3.5) continue;
      if (onPlaced(x, y, 'shelter', 9)) continue;
      // Cars face the way their side's traffic goes
      const heading = side > 0 ? Math.atan2(p.tx, p.ty) : Math.atan2(-p.tx, -p.ty);
      const model = PARKED_MODELS[Math.floor(randomAt(salt, 7407, CITY.seed) * PARKED_MODELS.length)];
      add({ kind: 'parked', u: x, s: y, yaw: -heading, model, colour: Math.floor(randomAt(salt, 7408, CITY.seed) * 1e6) });
    }
  }
}
