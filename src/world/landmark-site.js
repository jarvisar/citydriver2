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


// How much of its site each venue's building takes: the least it needs along
// its street and into its lot, and the most it takes, the rest of the lot its
// grounds; and how far back from the street it stands behind its forecourt
export const VENUE_SIZE = {
  cityhall: [28, 22, 48, 34], museum: [22, 18, 42, 30], library: [20, 16, 36, 26], postoffice: [20, 16, 34, 26],
  bathhouse: [22, 18, 38, 30], hospital: [24, 18, 46, 30], hotel: [18, 18, 28, 28], station: [24, 26, 40, 60],
  depot: [20, 24, 36, 52], market: [20, 22, 34, 44], farmersmarket: [20, 20, 34, 40], cinema: [16, 16, 28, 28],
  music: [16, 15, 26, 26], observatory: [16, 16, 26, 26], sports: [24, 28, 40, 48], firehouse: [16, 14, 26, 22],
  donut: [14, 12, 22, 20], clock: [16, 16, 30, 30], art: [16, 16, 32, 32], garden: [18, 16, 34, 26],
};
const FORECOURT = { cityhall: 9, museum: 8, library: 7, postoffice: 6, hospital: 7, bathhouse: 6, station: 8, hotel: 5, observatory: 5, firehouse: 7 };
export const venueFits = (site, type) => Boolean(site) && site.width >= (VENUE_SIZE[type]?.[0] ?? 14) && site.depth >= (VENUE_SIZE[type]?.[1] ?? 12);
// The building's rectangle on its site: centred on it along the street, set
// back behind the forecourt, in the site's axes. `setback` is how far its
// front stands behind the site's front, which is itself a few metres in from
// the lot's street edge. A venue with a whole block to itself stands in its
// grounds, a wider forecourt before it.
export function venueFootprint(site, type, whole = false) {
  if (!venueFits(site, type)) return null;
  const [, minD, maxW, maxD] = VENUE_SIZE[type] ?? [14, 12, 30, 30];
  const court = whole ? Math.max(FORECOURT[type] ?? 6, Math.min(16, (site.depth - maxD) * .45)) : FORECOURT[type] ?? 3;
  const width = Math.min(site.width, maxW), setback = Math.max(0, Math.min(court, site.depth - minD));
  const depth = Math.min(site.depth - setback, maxD), into = -site.depth / 2 + setback + depth / 2;
  const centre = { x: site.centre.x + site.nx * into, y: site.centre.y + site.ny * into };
  return { centre, width, depth, setback, tx: site.tx, ty: site.ty, nx: site.nx, ny: site.ny,
    front: { x: centre.x - site.nx * depth / 2, y: centre.y - site.ny * depth / 2 } };
}
