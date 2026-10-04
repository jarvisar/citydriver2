import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY, cityCell, cityStyleDistrict } from '../src/world/city.js';
import { cityPlaces, placeForBlock, passing, CityExploration } from '../src/city-exploration.js';
import { PLACE_TYPES } from '../src/world/city-places.js';
import { cityParks, squareLayout, SQUARE_WALK } from '../src/world/city-parks.js';
import { placeStreetFurniture, findBridges, lawnSpots } from '../src/world/city-streets.js';
import { discoverySignFor } from '../src/world/city-signs.js';
import { navGraph } from '../src/world/nav-graph.js';
import { planLot } from '../src/world/city-buildings.js';
import { CitydriverWorld, CityChunk } from '../src/world/citydriver-world.js';
import { insidePolygon, distanceToPolyline, averagePoint, calcPolygonArea, polygonCentroid } from '../src/mapgen/polygon-util.js';

const places = cityPlaces();
const venues = places.filter(place => place.footprint);
const corners = f => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: f.centre.x + f.tx * a * f.width / 2 + f.nx * b * f.depth / 2, y: f.centre.y + f.ty * a * f.width / 2 + f.ny * b * f.depth / 2 }));

test('every kind of place in the notebook is somewhere in the city, each under its own name', () => {
  const types = new Set(places.map(place => place.type));
  for (const type of PLACE_TYPES) assert.ok(types.has(type), `no ${type}`);
  assert.equal(new Set(places.map(place => place.name)).size, places.length, 'two places share a name');
  // No kind of venue crowds the others out
  const counts = new Map();
  for (const place of venues) counts.set(place.type, (counts.get(place.type) ?? 0) + 1);
  for (const [type, count] of counts) assert.ok(count <= 2, `${count} ${type}`);
  assert.equal(counts.get('cityhall'), 1);
  assert.ok(places.length >= 25 && places.length <= 50, `${places.length} places`);
});

test('venues are spread over the city, the grand ones in a block of their own', () => {
  for (let i = 0; i < venues.length; i++) for (let j = i + 1; j < venues.length; j++) {
    const a = venues[i], b = venues[j];
    assert.ok(Math.hypot(a.u - b.u, a.s - b.s) > 150, `${a.name} and ${b.name} side by side`);
  }
  const grand = venues.filter(place => place.block !== undefined);
  assert.ok(grand.length >= 8, `${grand.length} venues with a block`);
  assert.ok(grand.some(place => place.type === 'cityhall'));
  // The block's own lots stand empty for it
  for (const place of grand) {
    assert.equal(placeForBlock(place.block), place);
    CITY.lotBlocks.forEach((block, index) => {
      if (block !== place.block) return;
      const polygon = CITY.lots[index];
      assert.equal(planLot({ east: 0, start: 0 }, { polygon, index, block, edges: CITY.lotEdges[index], depth: CITY.lotDepths[index], centre: averagePoint(polygon), area: calcPolygonArea(polygon), seed: index }).kind, 'none');
    });
  }
});

test('a venue stands inside its site, and its drop-off is in the lane beside it with the venue on the right', () => {
  for (const place of venues) {
    for (const p of corners(place.footprint)) assert.ok(insidePolygon(p, place.polygon), `${place.name} leaves its site`);
  }
  for (const place of places) {
    // (a park's is at a gate, where its walk leaves the street)
    const e = place.entrance, road = CITY.roadIndex.nearest(e.u, e.s, 12, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance);
    assert.ok(road && road.road.kind !== 'path', `${place.name}: the drop-off is on a street`);
    assert.ok(Math.abs(road.distance - road.road.profile.lane) < .05, `${place.name}: in a lane`);
    const target = place.footprint?.front ?? { x: place.u, y: place.s }, du = Math.sin(e.heading), ds = Math.cos(e.heading);
    assert.ok((target.x - e.u) * ds - (target.y - e.s) * du > 0, `${place.name} is on the left of its drop-off`);
    assert.ok(Math.hypot(target.x - e.u, target.y - e.s) < (place.park === undefined ? 45 : 400), `${place.name}: the drop-off is far from it`);
  }
});

test('every park and square has its sign by its gate, on its lawn and off its walks', () => {
  const pieces = [];
  placeStreetFurniture(navGraph(), findBridges(), piece => pieces.push(piece));
  const signs = pieces.filter(piece => piece.kind === 'sign');
  for (const place of places.filter(place => place.park !== undefined)) {
    const sign = signs.find(sign => sign.type === place.type && sign.variant === place.variant && Math.hypot(sign.u - place.entrance.u, sign.s - place.entrance.s) < 30);
    assert.ok(sign, `${place.name} has no sign`);
    assert.ok(insidePolygon({ x: sign.u, y: sign.s }, CITY.parkPlans[place.park].lawn), `${place.name}'s sign is off its lawn`);
    const path = CITY.roadIndex.nearest(sign.u, sign.s, 20, (segment, distance) => distance - segment.road.profile.halfWidth);
    assert.ok(!path || path.score > 1, `${place.name}'s sign stands in a street or a walk`);
  }
  // (a venue's name is on its building: see below)
  assert.ok(signs.every(sign => places.some(place => place.park !== undefined && place.type === sign.type && place.variant === sign.variant)), 'a venue has a sign on the pavement');
  // and the pieces of every square stand on its lawn, clear of its walks
  for (const entry of cityParks().filter(entry => entry.park.square)) {
    const lawn = entry.park.lawn;
    for (const feature of entry.features) {
      assert.ok(insidePolygon(feature, lawn), `a ${feature.kind} off its square`);
      if (entry.plaza && Math.hypot(feature.x - entry.plaza.x, feature.y - entry.plaza.y) < entry.plaza.radius) continue;
      for (const walk of entry.walks.filter(walk => walk.length === 2)) assert.ok(distanceToPolyline(feature, walk) > SQUARE_WALK, `a ${feature.kind} on a walk`);
    }
    for (const piece of pieces) {
      if (piece.kind !== 'tree' || !insidePolygon({ x: piece.u, y: piece.s }, lawn)) continue;
      for (const feature of entry.features) assert.ok(Math.hypot(piece.u - feature.x, piece.s - feature.y) > feature.r, `a tree in the ${feature.kind}`);
    }
  }
});

test('a park is where the middle of its ground is, not where its outline\'s points crowd', () => {
  // (seed 165: Meadow Park's point was the average of its outline's points,
  // 170 m off its middle toward a finely curved side, and its drop-off
  // 466 m from where the map showed it)
  for (const place of places.filter(place => place.park !== undefined && !CITY.parkPlans[place.park].square)) {
    const park = CITY.parkPlans[place.park].polygon, middle = polygonCentroid(park), at = { x: place.u, y: place.s };
    assert.ok(insidePolygon(at, park), `${place.name} is off its park`);
    if (insidePolygon(middle, park)) assert.ok(Math.hypot(at.x - middle.x, at.y - middle.y) < .01, `${place.name} is off its middle`);
  }
  // (and for a park with a long curved side the average would not do)
  const curved = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, ...Array.from({ length: 60 }, (_, k) => ({ x: Math.cos(Math.PI * k / 59) * 200 + 200, y: 300 + Math.sin(Math.PI * k / 59) * 40 })).slice(1, -1), { x: 0, y: 300 }];
  assert.ok(Math.hypot(averagePoint(curved).y - polygonCentroid(curved).y) > 100, 'the average drifts toward the points');
});

test('a round garden has a spot for its sign by the gate, round its edge, and further in where the junctions round it take its edge', () => {
  // (seed 248: Chime Terrace, a circus's garden, had none. The spots ran on
  // straight from the gate and soon left the round lawn, and every one near
  // the edge was in the corners of the junctions round the circus)
  const lawn = Array.from({ length: 96 }, (_, k) => ({ x: Math.cos(k / 96 * Math.PI * 2) * 27, y: Math.sin(k / 96 * Math.PI * 2) * 27 }));
  const on = p => insidePolygon(p, lawn), spots = [...lawnSpots(lawn, { x: 2, y: 37 })];
  const first = spots[0];
  assert.ok(Math.abs(Math.hypot(first.u, first.y) - (27 - 2.4)) < .1 && first.y > 20, 'first by the gate, just inside the edge');
  assert.ok(first.oy > .9, 'facing out of the lawn, toward the gate');
  // Every spot on the lawn, board and all, however far round from the gate
  for (const spot of spots) assert.ok([{ x: spot.u, y: spot.y }, ...spot.ends].every(on), `a board off the lawn at ${spot.u.toFixed(1)},${spot.y.toFixed(1)}`);
  // and with eight junctions round the circus reaching 18 m, over the whole
  // edge, one clear of them all further in
  const junctions = Array.from({ length: 8 }, (_, k) => ({ x: Math.cos((k + .5) * Math.PI / 4) * 36, y: Math.sin((k + .5) * Math.PI / 4) * 36 }));
  const clear = p => junctions.every(j => Math.hypot(p.x - j.x, p.y - j.y) > 18), fits = spot => [{ x: spot.u, y: spot.y }, ...spot.ends].every(clear);
  assert.ok(!spots.some(spot => Math.abs(Math.hypot(spot.u, spot.y) - (27 - 2.4)) < .1 && fits(spot)), 'the whole edge taken');
  const spot = spots.find(fits);
  assert.ok(spot && Math.hypot(spot.u, spot.y) < 27 - 2.4 && spot.y > 0, 'a spot further in, on the gate\'s side');
});

test('every venue is built as its landmark, with its name on it', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  try {
    const cells = new Map();
    for (const place of venues) {
      // (a lot is built by the chunk its middle is in; a block venue's by the one its building is in)
      const middle = place.block === undefined ? averagePoint(place.polygon) : { x: place.u, y: place.s }, { ix, iz, key } = cityCell(middle.y, middle.x);
      if (!cells.has(key)) cells.set(key, new CityChunk(world, ix, iz));
      const chunk = cells.get(key);
      assert.ok(chunk.features.buildings.some(b => b.type === `landmark-${place.type}` && Math.hypot(b.x - place.u, b.s - place.s) < 1), `${place.name} is not built`);
      // (a sign board's instance color is its face's rectangle in the sign atlas)
      const tint = discoverySignFor(place.type, place.variant).tint.join(), colour = new THREE.Color(), tints = [];
      chunk.group.traverse(mesh => {
        if (!mesh.name.endsWith('sign-board')) return;
        for (let i = 0; i < mesh.count; i++) { mesh.getColorAt(i, colour); tints.push(colour.toArray().join()); }
      });
      assert.ok(tints.includes(tint), `${place.name} has no name on it`);
      for (const c of chunk.features.colliders) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z) && c.reach > 0);
    }
    for (const chunk of cells.values()) chunk.dispose();
  } finally { world.dispose(); }
});

test('a square too narrow for a circle is a linear garden with a walk down its length', () => {
  // A strip 150 m long and 16 m across, at an angle, between two streets
  const angle = .4, ux = Math.cos(angle), uy = Math.sin(angle), at = (along, across) => ({ x: 300 + ux * along - uy * across, y: -200 + uy * along + ux * across });
  const lawn = [at(-75, -8), at(75, -8), at(75, 8), at(-75, 8)];
  const layout = squareLayout({ lawn, circus: false }, 'plaza', 3);
  for (const key of ['walks', 'features', 'panels']) assert.ok(Array.isArray(layout[key]), key);
  assert.equal(layout.plaza, null);
  assert.equal(layout.walks.length, 1);
  const walk = layout.walks[0], ends = [walk[0], walk.at(-1)];
  assert.ok(Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y) > 140, 'the walk runs the strip end to end');
  for (const p of walk) {
    assert.ok(insidePolygon(p, lawn), `walk point ${p.x.toFixed(1)},${p.y.toFixed(1)} off the lawn`);
    assert.ok(Math.abs(-(p.x - 300) * uy + (p.y + 200) * ux) < 1, 'the walk keeps to the middle');
  }
  // A square with no room for a walk at all still has its (empty) layout
  const tiny = squareLayout({ lawn: [at(-6, -3), at(6, -3), at(6, 3), at(-6, 3)], circus: false }, 'art', 4);
  assert.deepEqual([tiny.walks.length, tiny.panels.length, tiny.features.length], [0, 0, 0]);
});

test('a park or a square is found from every lane of the streets round it, and a fare dropped there finds it too', () => {
  for (const place of places.filter(place => place.park !== undefined)) {
    const plan = CITY.parkPlans[place.park], ring = plan.kerb?.length >= 3 ? plan.kerb : plan.polygon, edge = [...ring, ring[0]];
    const xs = ring.map(p => p.x), ys = ring.map(p => p.y), box = [Math.min(...xs) - 20, Math.max(...xs) + 20, Math.min(...ys) - 20, Math.max(...ys) + 20];
    let beside = 0, found = 0;
    for (const road of CITY.roads) {
      if (road.kind === 'path') continue;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i], length = Math.hypot(b.x - a.x, b.y - a.y), tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
        for (let t = 0; t < length; t += 4) for (const side of [-1, 1]) {
          const x = a.x + tx * t + ty * road.profile.lane * side, y = a.y + ty * t - tx * road.profile.lane * side;
          if (x < box[0] || x > box[1] || y < box[2] || y > box[3] || distanceToPolyline({ x, y }, edge) > road.profile.halfWidth + 1) continue;
          beside++;
          if (passing(place, y, x)) found++;
        }
      }
    }
    assert.equal(found, beside, `${place.name}: found from ${found} of ${beside} lane points beside it`);
  }
  const exploration = new CityExploration(), venue = venues[0];
  assert.deepEqual(exploration.arrive(venue.id).map(each => each.place), [venue]);
  assert.deepEqual(exploration.arrive(venue.id), [], 'a place is found once');
  assert.ok(exploration.found.has(venue.type) && exploration.seen.has(venue.id));
});

test('a fountain square is named for what is round it', () => {
  const near = (place, types) => Math.min(Infinity, ...places.filter(other => types.includes(other.type)).map(other => Math.hypot(other.s - place.s, other.u - place.u)));
  for (const place of places.filter(place => place.type === 'plaza')) {
    const style = cityStyleDistrict(place.s, place.u);
    if (place.name === 'Station Square') assert.ok(near(place, ['station']) < 320, 'Station Square with no station near');
    if (place.name === 'Market Square') assert.ok(near(place, ['market', 'farmersmarket']) < 320 || style === 'Market district', 'Market Square with no market near');
    if (place.name === 'Old Town Square') assert.equal(style, 'Old town');
    if (place.name === 'Harbor Square') assert.equal(place.district, 'Harbor');
  }
});

test('a square\'s riders get out at a way in, and a venue faces the busiest street it fits along', () => {
  const parks = cityParks();
  for (const place of places.filter(place => place.park !== undefined && parks[place.park].park.square && !parks[place.park].circus)) {
    const ends = parks[place.park].walks.filter(walk => walk.length === 2).map(walk => walk[0]);
    if (!ends.length) continue;
    const mouth = Math.min(...ends.map(p => Math.hypot(p.x - place.entrance.u, p.y - place.entrance.s)));
    assert.ok(mouth < 45, `${place.name}: its drop-off is ${mouth.toFixed(0)} m from any of its walks`);
  }
  // (a side street's rank is 1, a major road's 2, a main or ring road's 3)
  const RANK = { main: 3, ring: 3, major: 2, coast: 2, riverbank: 2 };
  const rankAt = (x, y, reach) => { const hit = CITY.roadIndex.nearest(x, y, reach, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance); return hit ? RANK[hit.road.kind] ?? 1 : 0; };
  const grand = venues.filter(place => place.block !== undefined);
  const facing = grand.filter(place => {
    const f = place.footprint, ring = place.polygon;
    let best = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if (a.distanceTo(b) >= 30) best = Math.max(best, rankAt((a.x + b.x) / 2, (a.y + b.y) / 2, 24)); }
    return rankAt(f.front.x - f.nx * (f.setback + 9), f.front.y - f.ny * (f.setback + 9), 30) >= best;
  });
  assert.ok(facing.length >= grand.length * .6, `${facing.length} of ${grand.length} venues with a block face the busiest street along it`);
});
