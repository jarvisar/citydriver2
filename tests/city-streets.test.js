import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY, SIDEWALK } from '../src/world/city.js';
import { yardDrive } from '../src/world/city-yards.js';
import { surfaceAt, onRoadAt, citydriverRoute, journeyStart, PAVEMENT_LEVEL } from '../src/world/city-route.js';
import { navGraph } from '../src/world/nav-graph.js';
import { junctionGeometry, stopLineDistance, CROSSWALK } from '../src/world/junction-geometry.js';
import { difference, solids } from '../src/mapgen/booleans.js';
import { junctionControls } from '../src/city-junctions.js';
import { placeStreetFurniture, findBridges, cityCrosswalks, convexOverlap } from '../src/world/city-streets.js';
import { cityIslands } from '../src/world/city-islands.js';
import { turnPath, wayOn, isLink } from '../src/world/lane-paths.js';
import { planLot } from '../src/world/city-buildings.js';
import { shopSignFor } from '../src/world/city-signs.js';
import { cityPlaces } from '../src/city-exploration.js';
import { CityTraffic } from '../src/city-traffic.js';
import { DrivingController } from '../src/vehicle.js';
import { averagePoint, calcPolygonArea, insidePolygon, polygonBounds, bufferPolyline } from '../src/mapgen/polygon-util.js';

const furniture = (() => { const pieces = []; placeStreetFurniture(navGraph(), findBridges(), piece => pieces.push(piece)); return pieces; })();
// Where an item's modelled front (+z) and its +x point on the map (see city-layout-render.js)
const front = yaw => ({ x: Math.sin(yaw), y: -Math.cos(yaw) });
const side = yaw => ({ x: Math.cos(yaw), y: Math.sin(yaw) });

test('lamps, trees, signs and signals stand on the pavement, never on a carriageway or in a junction', () => {
  const nav = navGraph(), geometry = junctionGeometry(nav);
  const kinds = new Set(furniture.map(piece => piece.kind));
  for (const kind of ['lamp', 'median-lamp', 'lantern', 'tree', 'stop', 'signal', 'shelter', 'bin', 'railing', 'bench', 'parked']) assert.ok(kinds.has(kind), `${kind} placed`);
  for (const piece of furniture) {
    if (piece.kind === 'railing' || piece.kind === 'rim') continue;
    // A car in a yard's car park stands in its block's yard, off every road
    if (piece.kind === 'parked' && piece.yard !== undefined) {
      assert.ok(insidePolygon({ x: piece.u, y: piece.s }, CITY.blocks[piece.yard].yard) && !onRoadAt(piece.s, piece.u), `yard car off its yard at ${piece.u.toFixed(1)},${piece.s.toFixed(1)}`);
      continue;
    }
    // A parked car stands in a parking bay, between the traffic lane and the kerb
    if (piece.kind === 'parked') {
      const road = onRoadAt(piece.s, piece.u);
      assert.ok(road?.road.profile.parking && road.distance > road.road.profile.parking - .2 && road.distance < road.road.profile.halfWidth, `parked car off its bay at ${piece.u.toFixed(1)},${piece.s.toFixed(1)}`);
      continue;
    }
    // A boulevard's trees and lamps stand on its median
    if (piece.kind === 'median-lamp' || piece.median) { assert.equal(surfaceAt(piece.s, piece.u), 'median', `${piece.kind} off the median at ${piece.u.toFixed(1)},${piece.s.toFixed(1)}`); continue; }
    if (piece.kind === 'tree' && !CITY.pavement.find(piece.u, piece.s)) continue;  // park trees stand on lawns
    assert.equal(surfaceAt(piece.s, piece.u), 'pavement', `${piece.kind} at ${piece.u.toFixed(1)},${piece.s.toFixed(1)}`);
    // (a bridge's footway lies within its road's width, raised above its lanes)
    if (piece.bridge) { assert.equal(CITY.pavement.find(piece.u, piece.s)?.kind, 'bridge'); continue; }
    assert.ok(!onRoadAt(piece.s, piece.u), `${piece.kind} on a road`);
  }
  // Nothing but the junction's own signs stands inside a junction's corners
  for (const shape of geometry.values()) {
    const radius = Math.min(...shape.arms.map(arm => arm.clear));
    for (const piece of furniture) {
      if (['stop', 'yield', 'signal', 'railing', 'rim'].includes(piece.kind)) continue;
      assert.ok(Math.hypot(piece.u - shape.node.x, piece.s - shape.node.y) > radius - .5, `${piece.kind} in the junction at ${shape.node.x.toFixed(0)},${shape.node.y.toFixed(0)}`);
    }
  }
});

test('signs and signals face the drivers they are for, lamps lean over the road', () => {
  const nav = navGraph(), controls = junctionControls(nav);
  const signs = furniture.filter(piece => piece.kind === 'stop' || piece.kind === 'yield' || piece.kind === 'signal');
  assert.ok(signs.length > 20);
  for (const sign of signs) {
    // Every sign stands just behind the stop line of an approach of its own
    // kind, facing up it toward the arriving driver, on the driver's right.
    // (Nearly parallel approaches can pass close by: any one will do.)
    const f = front(sign.yaw);
    let owner = null;
    for (const [node, control] of controls) for (const [edge, approach] of control.approaches) {
      if (approach.kind !== sign.kind) continue;
      // The approach where the sign stands, a few metres behind the stop line
      const away = edge.a === node.id ? 1 : -1;
      for (let back = 0; back <= 6; back += .5) {
        const p = nav.pose(edge, stopLineDistance(approach.clear) + .9 + back, away), dx = sign.u - p.u, dy = sign.s - p.s;
        if (Math.abs(dx * p.tx + dy * p.ty) > .5 || Math.hypot(dx, dy) > 14) continue;
        if (f.x * p.tx + f.y * p.ty > .95 && dx * -p.ty + dy * p.tx > 0) owner = approach;
      }
    }
    assert.ok(owner, `${sign.kind} at ${sign.u.toFixed(0)},${sign.s.toFixed(0)} faces no approach from its right-hand kerb`);
  }
  for (const lamp of furniture.filter(piece => piece.kind === 'lamp')) {
    // The arm reaches along local -x: its head hangs over the carriageway
    const arm = side(lamp.yaw), head = { x: lamp.u - arm.x * 2.5, y: lamp.s - arm.y * 2.5 };
    assert.equal(surfaceAt(head.y, head.x), 'road', `lamp at ${lamp.u.toFixed(0)},${lamp.s.toFixed(0)} leans over the pavement`);
  }
});

test('a street tree keeps its crown clear of the lamps, signs, signals and shelters, and bins wait at the corners and stops', () => {
  const trees = furniture.filter(piece => piece.kind === 'tree'), crown = tree => tree.scale * .5;
  // (as far as each needs: a lamp's head, a sign's face, a shelter's roof)
  for (const [kind, clear] of [['lamp', .5], ['median-lamp', .5], ['stop', 1.2], ['yield', 1.2], ['signal', 1.2], ['sign', 1], ['shelter', 2.4]]) {
    for (const piece of furniture.filter(piece => piece.kind === kind)) {
      const hit = trees.find(tree => Math.hypot(tree.u - piece.u, tree.s - piece.s) < crown(tree) + clear - .01);
      assert.ok(!hit, `a tree at ${hit?.u.toFixed(1)},${hit?.s.toFixed(1)} grows over the ${kind} at ${piece.u.toFixed(1)},${piece.s.toFixed(1)}`);
    }
  }
  // A street's planting survives the rule: the trees step aside rather than go
  assert.ok(trees.filter(tree => CITY.pavement.find(tree.u, tree.s)).length > 1000, 'street trees planted');
  // Every bus stop has a bin beside it, and most bins stand near a junction or a stop
  const bins = furniture.filter(piece => piece.kind === 'bin'), shelters = furniture.filter(piece => piece.kind === 'shelter');
  for (const shelter of shelters) assert.ok(bins.some(bin => Math.hypot(bin.u - shelter.u, bin.s - shelter.s) < 4), `bus stop at ${shelter.u.toFixed(0)},${shelter.s.toFixed(0)} has no bin`);
  const nodes = [...junctionGeometry(navGraph()).values()].map(shape => shape.node);
  const placed = bins.filter(bin => shelters.some(s => Math.hypot(bin.u - s.u, bin.s - s.s) < 4) || nodes.some(node => Math.hypot(bin.u - node.x, bin.s - node.y) < 32));
  assert.ok(placed.length > bins.length * .6, `${placed.length} of ${bins.length} bins at a corner or a stop`);
  // The old town and the garden quarter light their own streets with lanterns
  assert.ok(furniture.some(piece => piece.kind === 'lantern' && CITY.pavement.find(piece.u, piece.s) && !CITY.parkPlans.some(park => park.lawn?.length >= 3 && insidePolygon({ x: piece.u, y: piece.s }, park.lawn))), 'street lanterns');
});

test('crosswalks are marked where traffic stops, and never lie over one another', () => {
  const nav = navGraph(), walks = cityCrosswalks(nav), controls = junctionControls(nav);
  for (let i = 0; i < walks.length; i++) for (let j = i + 1; j < walks.length; j++) {
    const a = walks[i].outline[0], b = walks[j].outline[0];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 60) assert.ok(!convexOverlap(walks[i].outline, walks[j].outline, .3), `crosswalks overlap at ${a.x.toFixed(1)},${a.y.toFixed(1)}`);
  }
  // Every signal and stop line has its crosswalk (unless two junctions
  // crowd each other and one gives way), and a road nobody stops on has
  // one only downtown or in the market
  let wanted = 0;
  for (const [node, control] of controls) for (const [edge, approach] of control.approaches) {
    if (approach.link || edge.kind === 'path') { assert.ok(!approach.crosswalk); continue; }
    if (approach.kind === 'signal' || approach.kind === 'stop') assert.ok(approach.crosswalk);
    if (approach.kind === 'priority' && approach.crosswalk) assert.ok(['Midtown', 'Market district'].includes(control.district), `crosswalk across a through road at ${node.x.toFixed(0)},${node.y.toFixed(0)}`);
    if (approach.crosswalk) wanted++;
  }
  assert.ok(walks.length > wanted * .95 && walks.length <= wanted, `${walks.length} crosswalks drawn of ${wanted}`);
});

test('the street hierarchy: collectors between the avenues, marked by rank, and junctions controlled by it', () => {
  const nav = navGraph(), controls = junctionControls(nav);
  const length = road => road.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(road.points[i]), 0);
  const km = test => CITY.roads.filter(test).reduce((sum, road) => sum + length(road), 0) / 1000;
  const side = km(road => road.kind === 'minor'), collectors = km(road => road.profile.kind === 'collector');
  // Some side streets are collectors, most are local
  assert.ok(collectors > 1.5 && collectors < side * .3, `${collectors.toFixed(1)} km of collectors of ${side.toFixed(1)} km of side streets`);
  for (const road of CITY.roads) {
    assert.ok(Number.isFinite(road.profile.rank), `${road.kind} has no rank`);
    if (road.profile.rank >= 2 && road.profile.kind !== 'boulevard') assert.ok(road.profile.centre, `${road.profile.kind} has no centre line`);
    if (road.profile.rank <= 1) assert.ok(!road.profile.centre);
  }
  // A mix of controls: not every junction of two side streets is a stop
  const counts = {};
  for (const control of controls.values()) {
    const kinds = [...control.approaches.values()].filter(a => !a.link).map(a => a.kind);
    if (!kinds.length) continue;
    const type = control.signal ? 'signal' : kinds.every(k => k === 'stop') ? 'all' : kinds.includes('stop') ? 'stop' : kinds.includes('yield') ? 'yield' : 'open';
    counts[type] = (counts[type] ?? 0) + 1;
    // Nobody on a better-ranked road stops for a lesser one
    const ranks = [...control.approaches].filter(([, a]) => !a.link).map(([edge, a]) => ({ rank: edge.profile.rank, kind: a.kind }));
    const giving = ranks.filter(r => r.kind === 'stop' || r.kind === 'yield'), through = ranks.filter(r => r.kind === 'priority');
    if (type !== 'all') for (const g of giving) assert.ok(through.every(t => t.rank >= g.rank), `a ${g.kind} for a lesser road at a junction`);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.ok(counts.signal > 10 && counts.stop > total * .25 && (counts.all ?? 0) < total * .3, JSON.stringify(counts));
});

test('a block with no lot is a planted island: a lawn inside its kerb, with only planting on it', () => {
  const lotted = new Set(CITY.lotBlocks);
  for (const island of cityIslands()) {
    assert.ok(!lotted.has(island.index) && !island.block.park);
    for (const p of island.lawn) assert.ok(insidePolygon(p, island.block.kerb), `island lawn outside its kerb at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  for (const piece of furniture) {
    if (!['bed', 'sculpture'].includes(piece.kind) || piece.yard !== undefined) continue;
    const island = cityIslands().find(island => insidePolygon({ x: piece.u, y: piece.s }, island.block.kerb));
    if (island) assert.ok(insidePolygon({ x: piece.u, y: piece.s }, island.lawn) && !onRoadAt(piece.s, piece.u));
  }
});

test('crosswalks and stop lines begin beyond the kerb corners, and turns join the lanes smoothly', () => {
  const nav = navGraph(), geometry = junctionGeometry(nav);
  for (const shape of geometry.values()) for (const arm of shape.arms) {
    // At the crosswalk the whole carriageway is clear of the other roads
    const away = arm.edge.a === shape.node.id ? 1 : -1, p = nav.pose(arm.edge, arm.clear + 1, away);
    for (const other of shape.arms) {
      if (other === arm || arm.link || arm.clear >= arm.edge.length * .45 - 1e-6) continue;
      const q = nav.pose(other.edge, 0, other.edge.a === shape.node.id ? 1 : -1);
      assert.ok(q && Number.isFinite(p.u));
    }
    assert.ok(stopLineDistance(arm.clear) > arm.clear);
  }
  // A turn curve starts on the arriving lane and ends on the leaving one, heading the same way
  let checked = 0;
  // (A link inside a junction complex is crossed on the turn onto it, never turned off)
  for (const edge of nav.edges.filter(e => e.kind !== 'path' && !isLink(nav, e)).slice(0, 160)) {
    // Every way on a car could choose, crossing a junction complex in one turn
    const ways = nav.choices(edge, 1).filter(choice => Math.abs(choice.turn) < 2.5 && choice.edge.kind !== 'path' && choice.edge !== edge)
      .map(choice => wayOn(nav, edge, 1, options => options.find(option => option.edge === choice.edge) ?? options[0], next => next.edge.kind !== 'path'));
    for (const choice of ways) {
      if (choice.edge === edge || isLink(nav, choice.edge)) continue;
      const path = turnPath(nav, edge, 1, choice);
      const start = nav.pose(edge, path.start, 1, edge.profile.lane), end = nav.pose(choice.edge, path.end, choice.direction, choice.edge.profile.lane);
      const a = path.pose(0), b = path.pose(path.length);
      assert.ok(Math.hypot(a.u - start.u, a.s - start.s) < 1e-6 && Math.hypot(b.u - end.u, b.s - end.s) < 1e-6);
      assert.ok(Math.cos(a.heading - start.heading) > .999 && Math.cos(b.heading - end.heading) > .999);
      // No kink anywhere along it: a car's radius at least, except inside a
      // junction complex, whose short link leaves less room
      const tight = Math.min(edge.length, choice.edge.length) < 30;
      assert.ok(path.radius > (tight ? 1.5 : 2), `turn radius ${path.radius.toFixed(1)} from a ${Math.round(edge.length)} m street onto a ${Math.round(choice.edge.length)} m one`);
      checked++;
    }
  }
  assert.ok(checked > 100);
});

test('buildings stand inside their lots without touching each other, and every venue is a landmark', () => {
  const c = { east: 0, start: 0 }, footprints = [], shops = new Map();
  CITY.lots.forEach((polygon, index) => {
    const lot = { polygon, index, block: CITY.lotBlocks[index], edges: CITY.lotEdges[index], depth: CITY.lotDepths[index], centre: averagePoint(polygon), area: calcPolygonArea(polygon), seed: index * 7919 };
    const plan = planLot(c, lot);
    if (plan.kind === 'landmark') { assert.equal(plan.place.lot, index); return; }
    if (plan.kind !== 'building') return;
    // No two shops round a block have the same name over the door
    if (plan.shopfront) {
      const name = shopSignFor(plan).name, names = shops.get(lot.block) ?? new Set();
      assert.ok(!names.has(name), `two ${name} shops in block ${lot.block}`);
      shops.set(lot.block, names.add(name));
    }
    for (const p of plan.footprint) assert.ok(insidePolygon(p, polygon) || polygon.some((q, i) => { const r = polygon[(i + 1) % polygon.length]; return Math.abs((r.x - q.x) * (p.y - q.y) - (r.y - q.y) * (p.x - q.x)) / Math.hypot(r.x - q.x, r.y - q.y) < 1e-6; }), 'footprint inside its lot');
    footprints.push(plan.footprint);
  });
  assert.ok(footprints.length > 1000);
  // Neighbours share a party wall at most: sample for overlap
  const cells = new Map();
  footprints.forEach((footprint, i) => {
    const b = polygonBounds(footprint), key = `${Math.floor((b.minX + b.maxX) / 80)},${Math.floor((b.minY + b.maxY) / 80)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  });
  let overlaps = 0;
  for (const list of cells.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = footprints[list[i]], b = footprints[list[j]], ba = polygonBounds(a), bb = polygonBounds(b);
    if (ba.maxX <= bb.minX || bb.maxX <= ba.minX || ba.maxY <= bb.minY || bb.maxY <= ba.minY) continue;
    const x0 = Math.max(ba.minX, bb.minX), x1 = Math.min(ba.maxX, bb.maxX), y0 = Math.max(ba.minY, bb.minY), y1 = Math.min(ba.maxY, bb.maxY);
    for (let x = x0 + .5; x < x1; x += 1) for (let y = y0 + .5; y < y1; y += 1) if (insidePolygon({ x, y }, a) && insidePolygon({ x, y }, b)) overlaps++;
  }
  assert.equal(overlaps, 0);
  // (a lot or, for the grand ones, a block of their own)
  assert.ok(cityPlaces().filter(place => place.footprint).length > 15);
});

test('traffic turns through junctions without snapping and never leaves the road', () => {
  const player = new DrivingController(citydriverRoute, journeyStart(), 'taxi');
  const traffic = new CityTraffic(new THREE.Scene(), player.route, player.s, 'city', player.u);
  try {
    const last = new Map();
    let turns = 0, fastest = 0;
    for (let i = 0; i < 60 * 40; i++) {
      traffic.update(1 / 60, player);
      for (const car of traffic.vehicles) {
        const before = last.get(car);
        if (before && before.generation === car.generation) {
          fastest = Math.max(fastest, Math.abs(Math.atan2(Math.sin(car.heading - before.heading), Math.cos(car.heading - before.heading))) * 60);
          if (before.edge !== car.edge) turns++;
        }
        // On the carriageway: a road, or the corner of one the kerb rounds off
        if (car.edge) assert.equal(surfaceAt(car.s, car.u), 'road', 'a car left the road');
        last.set(car, { heading: car.heading, generation: car.generation, edge: car.edge });
      }
    }
    assert.ok(turns > 20, `${turns} junctions crossed`);
    assert.ok(fastest < 1.6, `heading changed at ${fastest.toFixed(2)} rad/s`);
  } finally { traffic.dispose(); player.disposeModel(); }
});

test('a car park behind the buildings has a driveway in from the street, kept clear', () => {
  const drives = CITY.blocks.map(block => yardDrive(block.index)).filter(Boolean);
  assert.ok(drives.length > 3, `${drives.length} driveways`);
  const c = { east: 0, start: 0 };
  for (const drive of drives) {
    // Its lot builds only beside it
    const index = drive.lot, polygon = CITY.lots[index];
    const plan = planLot(c, { polygon, index, block: CITY.lotBlocks[index], edges: CITY.lotEdges[index], depth: CITY.lotDepths[index], centre: averagePoint(polygon), area: calcPolygonArea(polygon), seed: index * 7919 });
    const inDrive = p => insidePolygon(p, drive.polygon);
    if (plan.kind === 'building') for (let t = .1; t < 1; t += .2) for (let k = .2; k < 3; k += .6) {
      const p = { x: drive.mouth.x + drive.nx * k + drive.tx * (t - .5) * drive.width * .8, y: drive.mouth.y + drive.ny * k + drive.ty * (t - .5) * drive.width * .8 };
      if (inDrive(p)) assert.ok(!insidePolygon(p, plan.footprint), `a building across the driveway at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    }
    // Nothing stands or parks across its mouth
    for (const piece of furniture) {
      if (piece.kind === 'railing' || piece.kind === 'parking-sign' || piece.yard !== undefined) continue;
      const dx = piece.u - drive.mouth.x, dy = piece.s - drive.mouth.y, out = -(dx * drive.nx + dy * drive.ny), along = Math.abs(dx * drive.tx + dy * drive.ty);
      assert.ok(!(out > 0 && out < SIDEWALK + 3 && along < drive.width / 2), `${piece.kind} across a driveway at ${piece.u.toFixed(0)},${piece.s.toFixed(0)}`);
    }
  }
});

test('a bridge has a footway along its deck that joins the promenade, and the crosswalks stop at its kerb', () => {
  const walks = cityCrosswalks(navGraph());
  let footways = 0;
  for (const bridge of findBridges()) for (const footway of bridge.footways) {
    footways++;
    const middle = footway.line[Math.floor(footway.line.length / 2)];
    assert.equal(surfaceAt(middle.y, middle.x), 'pavement', 'a footway is walked, not driven');
    // Somewhere along its edge it runs on into other paving: the promenade, a
    // pavement on the bank, or the footway of the bridge beside it
    const edge = [];
    footway.polygon.forEach((a, i) => { const b = footway.polygon[(i + 1) % footway.polygon.length], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / .5); for (let k = 0; k < n; k++) edge.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n }); });
    const joins = edge.some(v => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const p = { x: v.x + dx * .4, y: v.y + dy * .4 }; return CITY.pavement.find(p.x, p.y) && !insidePolygon(p, footway.polygon); }));
    // (or, where the bridge is a causeway with no promenade at either end,
    // it runs from one road's kerb to another's)
    const line = footway.line, beyond = (p, q) => { const l = Math.hypot(p.x - q.x, p.y - q.y) || 1; return surfaceAt(p.y + (p.y - q.y) / l * .6, p.x + (p.x - q.x) / l * .6) === 'road'; };
    const kerbToKerb = beyond(line[0], line[1]) && beyond(line.at(-1), line.at(-2));
    assert.ok(joins || kerbToKerb, `a footway that meets no other pavement near ${middle.x.toFixed(0)},${middle.y.toFixed(0)}`);
  }
  // No crosswalk is painted over a footway
  for (const walk of walks) for (let u = .1; u < 1; u += .2) for (let v = .1; v < 1; v += .4) {
    const [a, b, c, d] = walk.outline, p = { x: a.x + (b.x - a.x) * u + (d.x - a.x) * v, y: a.y + (b.y - a.y) * u + (d.y - a.y) * v };
    assert.notEqual(CITY.pavement.find(p.x, p.y)?.kind, 'bridge', `a crosswalk over a footway at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
  }
  if (findBridges().some(bridge => bridge.road.profile.halfWidth >= 9)) assert.ok(footways > 0, 'the wider bridges have footways');
});

test('the waterfront is finished: no land left bare, railings off the roads, one crosswalk to a short street', () => {
  // Every piece of land is under a block, a park, a carriageway or a pavement
  const covered = solids([...CITY.blocks.map(block => block.kerb), ...CITY.parkPlans.filter(park => !park.square).map(park => park.kerb),
    ...CITY.roads.filter(road => road.kind !== 'path').map(road => bufferPolyline(road.points, road.profile.halfWidth)), ...CITY.cornerPatches, ...CITY.quays.map(quay => quay.polygon)]);
  const bare = difference(CITY.land.map(piece => piece.outer), CITY.land.flatMap(piece => piece.holes), covered)
    .map(piece => calcPolygonArea(piece.outer) - piece.holes.reduce((sum, hole) => sum + calcPolygonArea(hole), 0)).filter(area => area >= .5).reduce((sum, area) => sum + area, 0);
  // (slivers of the booleans' rounding aside, even one that runs right round a block)
  assert.ok(bare < 1, `${bare.toFixed(1)} m² of bare land`);
  // A quay's railing stands on its walk, never on a road or out over a walk carried on over the water
  for (const piece of furniture) {
    if (piece.kind !== 'railing' || piece.y !== PAVEMENT_LEVEL || CITY.pavement.find(piece.u, piece.s)?.kind === 'bridge') continue;
    assert.ok(!onRoadAt(piece.s, piece.u), `a railing on a road at ${piece.u.toFixed(0)},${piece.s.toFixed(0)}`);
  }
  // The crosswalks at the two ends of a street never all but meet
  const walks = cityCrosswalks(navGraph()), middle = walk => ({ x: (walk.near.x + walk.far.x) / 2, y: (walk.near.y + walk.far.y) / 2 });
  for (let i = 0; i < walks.length; i++) for (let j = i + 1; j < walks.length; j++) {
    if (walks[i].edge !== walks[j].edge) continue;
    const a = middle(walks[i]), b = middle(walks[j]);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= CROSSWALK + 5, `two crosswalks back to back at ${a.x.toFixed(0)},${a.y.toFixed(0)}`);
  }
});
