import test from 'node:test';
import assert from 'node:assert/strict';
import Vector from '../src/mapgen/vector.js';
import { generateCityMap } from '../src/mapgen/generate.js';
import { PROFILES } from '../src/mapgen/road-hierarchy.js';
import { parkLayout } from '../src/mapgen/park-paths.js';
import { RoadIndex } from '../src/mapgen/road-index.js';
import { insidePolygon, offsetPolygon, segmentIntersection } from '../src/mapgen/polygon-util.js';
import { mulberry32 } from '../src/mapgen/random.js';

const lengthOf = points => points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(points[i]), 0);
const cities = [4817, 1, 2024, 555, 9001].map(seed => generateCityMap({ seed }));

test('every city has its boulevards, a parkway round it, and side streets as wide as their district wants', () => {
  for (const city of cities) {
    const boulevards = city.roads.filter(road => road.kind === 'main');
    assert.ok(boulevards.reduce((sum, road) => sum + lengthOf(road.points), 0) > 1500, `seed ${city.seed}: too little boulevard`);
    for (const road of boulevards) assert.equal(road.profile, PROFILES.boulevard);
    for (const road of city.roads.filter(road => road.kind === 'ring')) assert.ok(road.profile.median > 0, 'the ring is a divided parkway');
    for (const road of city.roads.filter(road => road.kind === 'minor')) assert.ok([PROFILES.side, PROFILES.lane, PROFILES.parking].includes(road.profile));
  }
});

test('no block is left as bare ground: a kerb that reaches a carriageway is cut back instead', () => {
  for (const city of cities) {
    assert.equal(city.blocks.filter(block => block.broken).length, 0, `seed ${city.seed}`);
    for (const block of city.blocks.filter(block => block.repaired)) assert.ok(block.sidewalk.length >= 3 && block.inner.length >= 3);
  }
});

test('a big park is laid out with gates on its streets, a loop walk and a plaza or pond, every walk on its lawn', () => {
  let ponds = 0, loops = 0;
  for (const city of cities) for (const layout of city.parkLayouts) {
    assert.ok(layout.paths.length >= 3, `seed ${city.seed}: ${layout.paths.length} walks`);
    assert.ok(layout.gates.length >= 2, `seed ${city.seed}: ${layout.gates.length} gates`);
    assert.ok(layout.plaza, 'a plaza or a pond in the middle');
    if (layout.pond) ponds++;
    if (layout.loop) loops++;
    const reach = offsetPolygon(layout.lawn, 22);
    for (const path of layout.paths) for (const p of path) assert.ok(insidePolygon(p, reach), `seed ${city.seed}: a walk leaves its park`);
    // Walks never cross the pond
    if (layout.pond) for (const path of layout.paths) for (const p of path) assert.ok(!insidePolygon(p, layout.pond), 'a walk through the pond');
  }
  assert.ok(ponds > 0 && loops > 0, `${ponds} ponds, ${loops} loops`);
});

test('a square park gets a gate on each side, a loop and walks to a plaza that meet only where they should', () => {
  const v = (x, y) => new Vector(x, y);
  const park = [v(0, 0), v(360, 0), v(360, 300), v(0, 300)];
  // Streets along its four sides, carried past the corners
  const streets = [[v(-40, 0), v(400, 0)], [v(360, -40), v(360, 340)], [v(400, 300), v(-40, 300)], [v(0, 340), v(0, -40)]].map(points => ({ points, profile: PROFILES.avenue }));
  const index = new RoadIndex(streets);
  const layout = parkLayout(park, {
    random: mulberry32(7), halfWidthAt: () => PROFILES.avenue.halfWidth,
    streetAt: p => { const hit = index.nearest(p.x, p.y, 40); return hit && { x: hit.x, y: hit.y, road: hit.road }; },
    junctionNear: (p, road, reach) => Boolean(index.nearest(p.x, p.y, reach + 14, (segment, distance) => segment.road !== road && distance - segment.road.profile.halfWidth < reach ? 0 : Infinity)),
  });
  assert.ok(layout.loop && layout.plaza && layout.gates.length >= 4, JSON.stringify({ loop: Boolean(layout.loop), plaza: layout.plaza, gates: layout.gates.length }));
  // Each gate's walk starts across its street's centre line
  const walks = layout.paths.filter(path => path !== layout.loop && path.length > 3 && path[0].distanceTo(path.at(-1)) > 1);
  for (const walk of walks) assert.ok(streets.some(street => segmentIntersection(walk[0], walk[1], street.points[0], street.points[1])), 'a walk reaches its street');
  // Two walks from different gates meet only on the plaza's ring
  for (let i = 0; i < walks.length; i++) for (let j = i + 1; j < walks.length; j++) {
    for (let a = 0; a < walks[i].length - 1; a++) for (let b = 0; b < walks[j].length - 1; b++) {
      const hit = segmentIntersection(walks[i][a], walks[i][a + 1], walks[j][b], walks[j][b + 1]);
      assert.ok(!hit || Math.hypot(hit.x - layout.plaza.x, hit.y - layout.plaza.y) < 20, 'walks cross on the lawn');
    }
  }
});
