import { distanceToPolyline, offsetPolyline, polygonBounds, segmentIntersection } from '../mapgen/polygon-util.js';
import { difference, grow, intersection, region, solids, union } from '../mapgen/booleans.js';
import { circle, SQUARE_WALK, pondShore } from './city-parks.js';

// Join the paving before drawing it: edging belongs to the outside of a
// network, never across its junctions. All clipping happens once at load.
export const PATH_EDGE = .18;

// Match Surface.ribbon's mitres, including the closing join of a loop.
// Union individual panels so folds cannot turn into holes at tight bends.
export function walkRegion(points, width) {
  if (points.length < 2) return [];
  const closed = Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < 1e-6;
  const line = closed ? [points.at(-2), ...points, points[1]] : points;
  const side = d => { const p = offsetPolyline(line, d); return closed ? p.slice(1, -1) : p; };
  const left = side(width), right = side(-width), panels = [];
  for (let i = 0; i < points.length - 1; i++) panels.push([left[i], right[i], right[i + 1], left[i + 1]]);
  return union(solids(panels));
}

// Square walks used to finish half a metre inside their lawn. Carry only
// those entrance ends through to the surrounding pavement; inner ends and
// complete loops retain their layout. The full width is clipped below.
export function connectWalk(walk, lawn, kerb) {
  const result = walk.slice();
  if (walk.length < 2 || lawn.length < 3 || kerb.length < 3 || Math.hypot(walk[0].x - walk.at(-1).x, walk[0].y - walk.at(-1).y) < 1e-6) return result;
  for (const end of [0, walk.length - 1]) {
    const p = walk[end], back = walk[end ? end - 1 : 1];
    if (distanceToPolyline(p, [...lawn, lawn[0]]) > 1) continue;
    const length = Math.hypot(p.x - back.x, p.y - back.y);
    if (length < 1e-6) continue;
    const tip = { x: p.x + (p.x - back.x) / length * 16, y: p.y + (p.y - back.y) / length * 16 };
    let nearest = null, distance = Infinity;
    for (let i = 0; i < kerb.length; i++) {
      const hit = segmentIntersection(p, tip, kerb[i], kerb[(i + 1) % kerb.length], 1e-8);
      if (!hit) continue;
      const d = Math.hypot(hit.x - p.x, hit.y - p.y);
      if (d < distance) { nearest = hit; distance = d; }
    }
    // Overshoot before clipping, so an oblique mouth meets the kerb across
    // its whole width rather than stopping in a triangular notch.
    if (nearest) result[end] = { x: nearest.x + (p.x - back.x) / length * SQUARE_WALK * 2,
      y: nearest.y + (p.y - back.y) / length * SQUARE_WALK * 2 };
  }
  return result;
}

export function parkSurfaces(entry, roads) {
  const { park } = entry, boundary = park.kerb.length >= 3 ? park.kerb : park.lawn;
  if (boundary.length < 3) return { walks: [], plaza: [], edging: [] };
  const bounds = polygonBounds(boundary), walks = [];
  for (const road of roads) {
    const b = polygonBounds(road.points), w = road.profile.halfWidth;
    if (b.maxX + w < bounds.minX || b.minX - w > bounds.maxX || b.maxY + w < bounds.minY || b.minY - w > bounds.maxY) continue;
    walks.push(...region(walkRegion(road.points, w)));
  }
  for (const walk of entry.walks) walks.push(...region(walkRegion(connectWalk(walk, park.lawn, boundary), SQUARE_WALK)));
  const holes = entry.pond ? solids([pondShore(entry.pond)]) : [];
  const clip = shapes => difference(region(intersection(shapes, solids([boundary]))), holes);
  const plaza = entry.plaza ? clip(solids([circle(entry.plaza.x, entry.plaza.y,
    entry.plaza.radius + (park.square ? SQUARE_WALK * 2 + .6 : 4.4), 48)])) : [];
  const paving = clip(walks), joined = union(region(paving), region(plaza));
  // Only edge lawn: entrances stay open across the pavement, while paved
  // squares get a quiet border round their planted panels instead.
  const lawns = entry.paved ? region(entry.panels) : solids([park.lawn]);
  const edging = entry.paved
    ? difference(region(grow(lawns, PATH_EDGE)), lawns)
    : intersection(region(difference(region(grow(region(joined), PATH_EDGE)), region(joined))), lawns);
  return { walks: difference(region(paving), region(plaza)), plaza,
    edging: difference(region(intersection(region(edging), solids([boundary]))), holes) };
}
