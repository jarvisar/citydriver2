import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY } from '../src/world/city.js';
import { surfaceAt, onRoadAt, citydriverRoute, journeyStart } from '../src/world/city-route.js';
import { navGraph } from '../src/world/nav-graph.js';
import { junctionGeometry, stopLineDistance } from '../src/world/junction-geometry.js';
import { junctionControls } from '../src/city-junctions.js';
import { placeStreetFurniture, findBridges } from '../src/world/city-streets.js';
import { turnPath, wayOn, isLink } from '../src/world/lane-paths.js';
import { planLot } from '../src/world/city-buildings.js';
import { cityPlaces } from '../src/city-exploration.js';
import { CityTraffic } from '../src/city-traffic.js';
import { DrivingController } from '../src/vehicle.js';
import { averagePoint, calcPolygonArea, insidePolygon, polygonBounds } from '../src/mapgen/polygon-util.js';

const furniture = (() => { const pieces = []; placeStreetFurniture(navGraph(), findBridges(), piece => pieces.push(piece)); return pieces; })();
// Where an item's modelled front (+z) and its +x point on the map (see city-layout-render.js)
const front = yaw => ({ x: Math.sin(yaw), y: -Math.cos(yaw) });
const side = yaw => ({ x: Math.cos(yaw), y: Math.sin(yaw) });

test('lamps, trees, signs and signals stand on the pavement, never on a carriageway or in a junction', () => {
  const nav = navGraph(), geometry = junctionGeometry(nav);
  const kinds = new Set(furniture.map(piece => piece.kind));
  for (const kind of ['lamp', 'tree', 'stop', 'signal', 'shelter', 'bin', 'hedge', 'railing']) assert.ok(kinds.has(kind), `${kind} placed`);
  for (const piece of furniture) {
    if (piece.kind === 'railing' || piece.kind === 'hedge') continue;
    if (piece.kind === 'tree' && !CITY.pavement.find(piece.u, piece.s)) continue;  // park trees stand on lawns
    assert.equal(surfaceAt(piece.s, piece.u), 'pavement', `${piece.kind} at ${piece.u.toFixed(1)},${piece.s.toFixed(1)}`);
    assert.ok(!onRoadAt(piece.s, piece.u), `${piece.kind} on a road`);
  }
  // Nothing but the junction's own signs stands inside a junction's corners
  for (const shape of geometry.values()) {
    const radius = Math.min(...shape.arms.map(arm => arm.clear));
    for (const piece of furniture) {
      if (['stop', 'signal', 'railing', 'hedge'].includes(piece.kind)) continue;
      assert.ok(Math.hypot(piece.u - shape.node.x, piece.s - shape.node.y) > radius - .5, `${piece.kind} in the junction at ${shape.node.x.toFixed(0)},${shape.node.y.toFixed(0)}`);
    }
  }
});

test('signs and signals face the drivers they are for, lamps lean over the road', () => {
  const nav = navGraph(), controls = junctionControls(nav);
  const signs = furniture.filter(piece => piece.kind === 'stop' || piece.kind === 'signal');
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
  const c = { east: 0, start: 0 }, footprints = [];
  CITY.lots.forEach((polygon, index) => {
    const lot = { polygon, index, block: CITY.lotBlocks[index], edges: CITY.lotEdges[index], depth: CITY.lotDepths[index], centre: averagePoint(polygon), area: calcPolygonArea(polygon), seed: index * 7919 };
    const plan = planLot(c, lot);
    if (plan.kind === 'landmark') { assert.equal(plan.place.lot, index); return; }
    if (plan.kind !== 'building') return;
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
  assert.ok(cityPlaces().filter(place => place.lot !== undefined).length > 10);
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
