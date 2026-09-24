import { CITY } from './city.js';
import { placeForBlock } from '../city-exploration.js';
import { insetPolygon } from '../mapgen/booleans.js';
import { deepestPoint } from '../mapgen/park-paths.js';
import { calcPolygonArea, insidePolygon } from '../mapgen/polygon-util.js';

// A block too small or too pointed for any lot (a wedge where streets meet at
// a slant, a strip between the ring road and a street beside it) is a planted
// island rather than bare paving: a lawn inside a paved rim, with trees where
// there is room and on the bigger ones a flower bed or a sculpture. What
// stands on each is placed with the street furniture (city-streets.js).
export const ISLAND_RIM = 1.5;
let islands = null, byBlock = null;
export function cityIslands() {
  if (islands) return islands;
  const lotted = new Set(CITY.lotBlocks);
  islands = [];
  CITY.blocks.forEach((block, index) => {
    if (block.park || lotted.has(index) || !(block.kerb?.length >= 3) || placeForBlock(index)) return;
    const lawn = insetPolygon(block.kerb, -ISLAND_RIM), area = lawn.length >= 3 ? calcPolygonArea(lawn) : 0;
    if (area < 6 || area > calcPolygonArea(block.kerb) || !lawn.every(p => insidePolygon(p, block.kerb))) return;
    islands.push({ index, block, lawn, area, deepest: deepestPoint(lawn) });
  });
  byBlock = new Map(islands.map(island => [island.index, island]));
  return islands;
}
// The planted island a block is, if it is one
export const islandFor = index => { cityIslands(); return byBlock.get(index) ?? null; };
