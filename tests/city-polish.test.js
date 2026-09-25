import test from 'node:test';
import assert from 'node:assert/strict';
import { wallHasOutlook } from '../src/world/city-buildings.js';
import { CityChunk } from '../src/world/citydriver-world.js';
import { seededRandom } from '../src/world/route.js';

const rectangle = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
test('windows can overlook open ground but not neighbouring plots or the return of a concave building', () => {
  const building = rectangle(0, 0, 20, 15);
  assert.ok(wallHasOutlook(building, 1, []), 'an exposed side has an outlook');
  assert.ok(wallHasOutlook(building, 1, [rectangle(24, 0, 20, 15)]), 'a wide gap admits windows');
  assert.equal(wallHasOutlook(building, 1, [rectangle(20.2, 0, 20, 15)]), false, 'a party wall stays blank');
  assert.equal(wallHasOutlook(building, 1, [rectangle(22, 11, 20, 4)]), false, 'the whole face needs clearance, not just its centre');
  assert.equal(wallHasOutlook(building, 1, [rectangle(22, 7, .2, .2)]), false, 'a narrow intrusion between samples is still found');
  const courtyard = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 15 }, { x: 12, y: 15 }, { x: 12, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 15 }, { x: 0, y: 15 }];
  assert.equal(wallHasOutlook(courtyard, 3, []), false, 'a tight return of the same building blocks the outlook');
});

// Exercise the rendering entry point with different chunk origins and random
// histories: the same physical tree must keep its silhouette at a LOD handover.
const tree = (east, start, x, s, distant, seed) => {
  const items = [], c = { east, start, distant, random: seededRandom(seed), materials: {}, features: {},
    item(key, geometry, material, position, scale, colour, yaw) { items.push({ key, scale, colour, yaw }); }, box() {}, post() {} };
  CityChunk.prototype.tree.call(c, x, s, 8);
  return items.find(item => item.key.startsWith('tree-crowns-'));
};
test('tree shape, colour and orientation belong to its world position at every detail level', () => {
  const detail = tree(160, -320, 30, 40, false, 1);
  assert.deepEqual(tree(160, -320, 30, 40, true, 937), detail);
  assert.deepEqual(tree(0, 0, 190, -280, false, 832), detail);
  const neighbours = Array.from({ length: 12 }, (_, i) => tree(160, -320, 30 + i * 18, 40, false, 1));
  assert.ok(new Set(neighbours.map(t => t.yaw)).size > 8, 'a row does not repeat the same orientation');
  assert.ok(neighbours.every(t => t.scale[0] <= 8 * 1.06 && t.scale[2] === t.scale[0]), 'rotation keeps the existing crown clearance');
});
