import { CITY, SIDEWALK } from './city.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL, waterAt, onRoadAt } from './city-route.js';
import { junctionGeometry, CROSSWALK, stopLineDistance } from './junction-geometry.js';
import { junctionControls } from '../city-junctions.js';
import { faceYaw, alongYaw } from './city-layout-render.js';
import { randomAt, seededRandom } from './route.js';
import { offsetPolyline, offsetPolylineClean, offsetPolygon, insidePolygon, polygonBounds, calcPolygonArea, signedArea } from '../mapgen/polygon-util.js';
import { cityPlaces } from '../city-exploration.js';
import { clipInside } from '../mapgen/road-network.js';

// The streets as the city draws and furnishes them. Everything here is laid
// out from the same few models: the road centre lines and their profiles, the
// kerbs (block pavements with rounded corners), the junction geometry and the
// quays. So a crosswalk starts where the kerb corner ends, the stop line and
// the sign stand behind it on the approach's own right-hand pavement, and a
// lamp or tree only ever stands on a pavement.

const LAMP_SPACING = 27, TREE_SPACING = 19;
export const COLOURS = {
  road: '#666c70', marking: '#d8bd80', line: '#d7d8c9', stripe: '#deddd0', stop: '#e1dfce',
  pavement: '#acafa8', kerb: '#9a9d98', lawn: '#79a05a', median: '#779757', medianKerb: '#c3bfab',
  quay: '#b3aea0', country: '#8e9b6a', path: '#b9ad8e', plaza: '#c2b9a3',
};

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

// Roads, markings, junctions, pavements, parks and water, into the static
// surfaces: ground (vertex coloured), roads (the road material, which rain
// darkens), paths, water and walls.
export function buildStreetSurfaces({ ground, roads, paths, water, walls }, nav, bridges) {
  const geometry = junctionGeometry(nav), controls = junctionControls(nav);
  // The island under everything (its coast is city-coast.js)
  for (const piece of CITY.land) ground.polygon(piece.outer, ROAD_LEVEL - .06, COLOURS.country, null, true, piece.holes);
  // Carriageways, and the corners the rounded kerbs hand back to them
  const parkKerbs = CITY.parkPlans.filter(park => park.kerb.length >= 3).map(park => park.kerb);
  for (const road of CITY.roads) {
    if (road.kind !== 'path') { roads.ribbon(road.points, road.profile.halfWidth, ROAD_LEVEL, COLOURS.road); continue; }
    // A path is drawn on the lawn and the park's pavement, never out over the street
    for (const kerb of parkKerbs) for (const run of clipInside(road.points, kerb, 0)) paths.ribbon(run, road.profile.halfWidth, PAVEMENT_LEVEL + .035, COLOURS.path);
  }
  for (const patch of CITY.cornerPatches) roads.polygon(patch, ROAD_LEVEL, COLOURS.road);
  // Markings along each street between its junctions
  const markings = ground;
  for (const edge of nav.edges) {
    if (edge.kind === 'path') continue;
    const profile = edge.profile, [from, to] = markedSpan(nav, edge, geometry);
    if (to - from < 4) continue;
    const span = slicePolyline(edge.points, from, to);
    if (profile.kind === 'boulevard') {
      // A planted median with kerbs, and a white line along each edge
      const median = profile.median;
      ground.ribbon(span, median, ROAD_LEVEL + .22, COLOURS.medianKerb);
      ground.ribbon(span, median - .2, ROAD_LEVEL + .28, COLOURS.median);
      // Walls face the right of travel: run the left kerb backwards so both face out
      ground.wall(offsetPolyline(span, median).reverse(), ROAD_LEVEL + .22, ROAD_LEVEL, COLOURS.medianKerb);
      ground.wall(offsetPolyline(span, -median), ROAD_LEVEL + .22, ROAD_LEVEL, COLOURS.medianKerb);
      for (const side of [-1, 1]) {
        for (const p of alongPolyline(span, 9, 2)) {
          const dash = slicePolyline(span, p.distance, p.distance + 4.5);
          if (dash.length > 1) markings.ribbon(offsetPolyline(dash, side * (median + 2.9)), .11, ROAD_LEVEL + .012, COLOURS.line);
        }
        markings.ribbon(offsetPolyline(span, side * (profile.halfWidth - .6)), .12, ROAD_LEVEL + .012, COLOURS.line);
      }
    } else if (profile.kind === 'avenue') {
      for (const p of alongPolyline(span, 10, 3)) {
        const dash = slicePolyline(span, p.distance, p.distance + 4);
        if (dash.length > 1) markings.ribbon(dash, .12, ROAD_LEVEL + .012, COLOURS.marking);
      }
    }
  }
  // Crosswalks where each road leaves a junction, stop lines behind them
  for (const [node, control] of controls) {
    const shape = geometry.get(node.id);
    for (const [edge, approach] of control.approaches) {
      const arm = shape.approaches.get(edge), halfWidth = edge.profile.halfWidth;
      if (arm.link) continue;
      const near = approachPoint(nav, edge, node, arm.clear + .2), far = approachPoint(nav, edge, node, arm.clear + CROSSWALK);
      const at = (p, across) => ({ x: p.x + p.rx * across, y: p.y + p.ry * across });
      for (let across = -halfWidth + .8; across < halfWidth - .5; across += 1.6) {
        markings.polygon([at(near, across), at(near, across + .85), at(far, across + .85), at(far, across)], ROAD_LEVEL + .014, COLOURS.stripe);
      }
      if (approach.kind === 'priority') continue;
      const line = approachPoint(nav, edge, node, stopLineDistance(arm.clear) - .2), back = approachPoint(nav, edge, node, stopLineDistance(arm.clear) + .25);
      const inner = edge.profile.median ? edge.profile.median + .2 : .25;
      markings.polygon([at(line, inner), at(line, halfWidth - .4), at(back, halfWidth - .4), at(back, inner)], ROAD_LEVEL + .014, COLOURS.stop);
    }
  }
  // Pavements with kerbs, the parks and squares, and the ground inside each block
  for (const block of CITY.blocks) {
    if (block.kerb.length < 3) continue;
    ground.polygon(block.kerb, PAVEMENT_LEVEL, COLOURS.pavement);
    ground.wall(clockwise(block.kerb), PAVEMENT_LEVEL, ROAD_LEVEL - .02, COLOURS.kerb, true);
    if (block.park || block.inner.length < 3) continue;
    ground.polygon(block.inner, PAVEMENT_LEVEL + .02, blockGround(block));
    if (block.yard?.length >= 3) ground.polygon(block.yard, PAVEMENT_LEVEL + .035, yardGround(block));
  }
  for (const park of CITY.parkPlans) {
    if (park.kerb.length >= 3 && !park.square) {
      ground.polygon(park.kerb, PAVEMENT_LEVEL, COLOURS.pavement);
      ground.wall(clockwise(park.kerb), PAVEMENT_LEVEL, ROAD_LEVEL - .02, COLOURS.kerb, true);
    }
    if (park.lawn.length >= 3) ground.polygon(park.lawn, PAVEMENT_LEVEL + .02, park.square && squarePaved(park) ? COLOURS.plaza : COLOURS.lawn);
  }
  // Quays and the city's outer pavement: raised, with a kerb on the road side
  for (const walk of CITY.quays) {
    ground.polygon(walk.polygon, PAVEMENT_LEVEL, walk.edge ? COLOURS.pavement : COLOURS.quay);
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
export const blockGround = block => GARDEN_STYLES.has(block.style) ? '#86a263' : block.style === 'Warehouse district' ? '#a8a598' : '#b3b2a5';
export const yardGround = block => block.style === 'Warehouse district' ? '#9e9b8e' : block.style === 'Midtown' ? '#a9a99d' : '#83a05e';
export const squarePaved = park => park.square && randomAt(park.index, 7401, CITY.seed) < .5;

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
  // Junction corners and crosswalks, and wherever a road or park path crosses a pavement
  const inZone = (x, y) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const zone of zoneIndex.get(`${Math.floor(x / 60) + dx},${Math.floor(y / 60) + dy}`) ?? []) if (Math.hypot(zone.x - x, zone.y - y) < zone.r) return true;
    }
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
  // Street furniture stands on a pavement, whatever placed it
  const PAVED = new Set(['lamp', 'bin', 'shelter', 'stop', 'signal', 'sign']);
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
  // Signals and stop signs stand on the approach's right-hand pavement just
  // behind the stop line, facing the drivers who have to obey them
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
        if (put(approach.kind === 'signal' ? { kind: 'signal', u, s: y, yaw, axis: approach.axis } : { kind: 'stop', u, s: y, yaw }, 1)) break;
      }
    }
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
      if (put({ kind: 'shelter', u: x, s: y, yaw: alongYaw(nx, ny) }, 6)) sinceShelter = 0;
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
  // Lamps and a few trees along the quays and the city's outer pavement
  for (const walk of CITY.quays) {
    const side = walk.edge ? 1 : 1;
    for (const p of alongPolyline(walk.points, LAMP_SPACING, 8)) {
      if (inZone(p.x, p.y)) continue;
      // The lamp stands on the road side of the walk, its arm over the road
      const road = CITY.roadIndex.nearest(p.x, p.y, 20);
      if (!road) continue;
      const ax = p.x - road.x, ay = p.y - road.y, l = Math.hypot(ax, ay) || 1, x = road.x + ax / l * (road.road.profile.halfWidth + .7), y = road.y + ay / l * (road.road.profile.halfWidth + .7);
      put({ kind: 'lamp', u: x, s: y, yaw: alongYaw(ax / l * side, ay / l * side) }, 4);
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
  // A hedge beyond the city's outer pavement, carried on to the water's edge
  for (const edge of CITY.edges) {
    const line = offsetPolylineClean(edge, -.9);
    for (const p of alongPolyline(line, 6, 3)) {
      if (waterAt(p.y, p.x)) continue;
      add({ kind: 'hedge', u: p.x, s: p.y, yaw: faceYaw(p.tx, p.ty), length: 6.2 });
    }
  }
  // Parks: trees scattered over the lawns, clear of the paths, and benches beside the paths
  CITY.parkPlans.forEach((park, index) => {
    const lawn = park.lawn;
    if (lawn.length < 3) return;
    const random = seededRandom(CITY.seed + index * 7919), bounds = polygonBounds(lawn), area = calcPolygonArea(lawn);
    const paved = squarePaved(park), wanted = Math.min(400, Math.floor(area / (paved ? 420 : 230)));
    for (let attempt = 0, count = 0; attempt < wanted * 6 && count < wanted; attempt++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX), y = bounds.minY + random() * (bounds.maxY - bounds.minY);
      if (!insidePolygon({ x, y }, lawn)) continue;
      const road = CITY.roadIndex.nearest(x, y, 30, (segment, distance) => distance - segment.road.profile.halfWidth);
      if (road && road.score < 3.5 || inZone(x, y)) continue;
      if (put({ kind: 'tree', u: x, s: y, scale: 7 + random() * 4.5 }, 8)) count++;
    }
    for (const road of CITY.roads) {
      if (road.kind !== 'path') continue;
      alongPolyline(road.points, 44, 22).forEach((p, i) => {
        const side = i % 2 ? 1 : -1, nx = -p.ty * side, ny = p.tx * side, x = p.x + nx * 5.3, y = p.y + ny * 5.3;
        if (!insidePolygon({ x, y }, lawn) || inZone(x, y)) return;
        // The seat faces its local -x: turn +x away from the path
        put({ kind: 'bench', u: x, s: y, yaw: alongYaw(nx, ny) }, 2);
      });
    }
    // A square gets a fountain in the middle and benches round its edge, facing in
    if (park.square) {
      const centre = lawn.reduce((sum, p) => ({ x: sum.x + p.x / lawn.length, y: sum.y + p.y / lawn.length }), { x: 0, y: 0 });
      if (insidePolygon(centre, offsetPolygon(lawn, -5)) && !inZone(centre.x, centre.y)) put({ kind: 'fountain', u: centre.x, s: centre.y }, 7);
      const inner = offsetPolygon(lawn, -2.2);
      if (inner.length >= 3) {
        const loop = [...inner, inner[0]];
        for (const p of alongPolyline(loop, 16, 6)) {
          const nx = -p.ty, ny = p.tx;
          if (inZone(p.x, p.y)) continue;
          put({ kind: 'bench', u: p.x, s: p.y, yaw: alongYaw(-nx, -ny) }, 2);
        }
      }
    }
  });
  // A sign board on the pavement at every venue's entrance, square to the street
  for (const place of cityPlaces()) {
    const road = CITY.roadIndex.nearest(place.entrance.u, place.entrance.s, 40);
    if (!road) continue;
    const du = Math.sin(place.entrance.heading), ds = Math.cos(place.entrance.heading);
    const reach = road.road.profile.halfWidth + SIDEWALK - 1.2, u = road.x + ds * reach, y = road.y - du * reach;
    if (waterAt(y, u) || !CITY.pavement.find(u, y) || inZone(u, y)) continue;
    put({ kind: 'sign', type: place.type, variant: place.variant, u, s: y, yaw: faceYaw(du, ds) }, 3);
  }
}

// The country beyond the ring road: fields in a loose patchwork, hedgerow
// trees along their edges and a belt of woodland just outside the city hedge,
// so the edge of town reads as the edge of town rather than of the world.
const FIELDS = ['#8e9b6a', '#9aa56c', '#a9a672', '#7f9462', '#b4a978', '#8aa06a'];
export function countryside() {
  const fields = [], trees = [];
  if (!CITY.ring) return { fields, trees };
  const ring = CITY.ring, reach = SIDEWALK + 12;
  const outside = (x, y, margin) => {
    if (insidePolygon({ x, y }, ring)) return false;
    const road = CITY.roadIndex.nearest(x, y, margin + 12, (segment, distance) => distance - segment.road.profile.halfWidth);
    return !road || road.score > margin;
  };
  // Dry and clear of the beach
  const dry = (x, y) => !waterAt(y, x) && [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([dx, dy]) => !waterAt(y + dy * 9, x + dx * 9));
  // Only as far out as the fog lets anyone see
  const cell = 80, rows = 60, bounds = polygonBounds(ring), far = 420;
  for (let x = Math.max(CITY.minX, bounds.minX - far); x < Math.min(CITY.maxX, bounds.maxX + far); x += cell) for (let y = Math.max(CITY.minY, bounds.minY - far); y < Math.min(CITY.maxY, bounds.maxY + far); y += rows) {
    const corners = [[x, y], [x + cell, y], [x + cell, y + rows], [x, y + rows]];
    if (!corners.every(([cx, cy]) => outside(cx, cy, reach) && dry(cx, cy))) continue;
    const colour = FIELDS[Math.floor(randomAt(Math.round(x), Math.round(y) + 7501, CITY.seed) * FIELDS.length)];
    fields.push({ polygon: [{ x: x + 1, y: y + 1 }, { x: x + cell - 1, y: y + 1 }, { x: x + cell - 1, y: y + rows - 1 }, { x: x + 1, y: y + rows - 1 }], colour });
    // Hedgerow trees along one long side of about half the fields
    if (randomAt(Math.round(x), Math.round(y) + 7502, CITY.seed) < .35) {
      for (let k = 0; k < 5; k++) {
        const tx = x + (k + .3 + randomAt(k, Math.round(x + y), CITY.seed) * .4) * cell / 5, ty = y + (randomAt(Math.round(x), k + 7503, CITY.seed) - .5) * 3;
        if (randomAt(k, Math.round(x * 3 + y), CITY.seed) < .6) trees.push({ x: tx, y: ty, scale: 7 + randomAt(k, Math.round(x - y), CITY.seed) * 5 });
      }
    }
  }
  // Copses just beyond the hedge, thinning with distance, with meadows
  // between them where the road looks out over the sea
  const copse = (x, y) => CITY.field.noise2D(x / 260, y / 260) + CITY.field.noise2D(x / 90 + 31, y / 90 - 17) * .3;
  for (const edge of CITY.edges) {
    for (const p of alongPolyline(edge, 6.5, 2)) {
      if (copse(p.x, p.y) < -.05) continue;
      for (let row = 0; row < 5; row++) {
        const chance = .8 - row * .14;
        if (randomAt(Math.round(p.x * 7 + row), Math.round(p.y * 5), CITY.seed) > chance) continue;
        const depth = 5 + row * 7 + randomAt(Math.round(p.x), Math.round(p.y) + row, CITY.seed) * 5;
        const x = p.x + p.ty * depth, y = p.y - p.tx * depth;
        if (!outside(x, y, reach - 6) || !dry(x, y)) continue;
        trees.push({ x, y, scale: 8 + randomAt(Math.round(y), Math.round(x) + row, CITY.seed) * 6 });
      }
    }
  }
  return { fields, trees };
}
