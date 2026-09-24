import { offsetPolygon, dedupePolygon, signedArea, calcPolygonArea, fitRectangle } from '../mapgen/polygon-util.js';

// Where a landmark stands on its lot: square to the lot's longest street edge,
// behind a forecourt. Shared by the builder and by the places, whose drop-off
// is on the street the landmark faces.
// The site: the lot's main street edge and a rectangle square to it
export function landmarkSite(lot) {
  let polygon = dedupePolygon(lot.polygon), kinds = lot.edges?.length === polygon.length ? lot.edges : null;
  if (signedArea(polygon) < 0) { polygon = polygon.slice().reverse(); kinds = null; }
  const n = polygon.length;
  kinds ??= polygon.map(() => 'street');
  let best = -1;
  for (let j = 0; j < n; j++) {
    const length = polygon[j].distanceTo(polygon[(j + 1) % n]);
    if (kinds[j] === 'street' && (best < 0 || length > polygon[best].distanceTo(polygon[(best + 1) % n]))) best = j;
  }
  if (best < 0) best = 0;
  const a = polygon[best], b = polygon[(best + 1) % n], length = a.distanceTo(b) || 1;
  const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
  const inset = offsetPolygon(polygon, (p, q, i) => -(kinds[i] === 'street' ? (i === best ? 4.5 : 2) : 1.2));
  const rect = inset.length >= 3 ? fitRectangle(inset, tx, ty) : null;
  if (!rect || calcPolygonArea(rect) < 150) return null;
  const centre = { x: rect.reduce((s, p) => s + p.x, 0) / 4, y: rect.reduce((s, p) => s + p.y, 0) / 4 };
  const width = Math.hypot(rect[1].x - rect[0].x, rect[1].y - rect[0].y), depth = Math.hypot(rect[3].x - rect[0].x, rect[3].y - rect[0].y);
  // (tx, ty) along the street; (nx, ny) into the lot; the front faces -n
  return { polygon, rect, centre, width, depth, tx, ty, nx: -ty, ny: tx };
}

