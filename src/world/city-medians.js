import { PolygonIndex } from './city.js';
import { navGraph } from './nav-graph.js';
import { junctionGeometry, CROSSWALK } from './junction-geometry.js';
import { offsetPolyline } from '../mapgen/polygon-util.js';

// The raised medians down the middle of the boulevards and the ring's
// parkway: one strip along each street between its junctions, its rounded
// noses stopping short of the crosswalks so turning traffic has the junction
// to itself. The renderer draws them, the furniture plants them and the tyres
// ride up onto them from the same shapes.
export const MEDIAN_KERB = .15;
const NOSE = 1.6;  // Beyond the crosswalk
const MIN_LENGTH = 8;

// The part of a polyline between two distances along it
function slice(points, from, to) {
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

// A strip `halfWidth` either side of a polyline with a half-round nose at
// each end, anticlockwise
export function roundedStrip(points, halfWidth, steps = 5) {
  const left = offsetPolyline(points, halfWidth), right = offsetPolyline(points, -halfWidth);
  const cap = (centre, from, turn) => {
    const out = [], a0 = Math.atan2(from.y - centre.y, from.x - centre.x);
    for (let k = 1; k < steps; k++) {
      const a = a0 + turn * k / steps;
      out.push({ x: centre.x + Math.cos(a) * halfWidth, y: centre.y + Math.sin(a) * halfWidth });
    }
    return out;
  };
  const n = points.length;
  return [...right, ...cap(points[n - 1], right[n - 1], Math.PI), ...left.reverse(), ...cap(points[0], left[n - 1], Math.PI)];
}

let medians = null;
export function cityMedians(nav = navGraph()) {
  if (medians?.nav === nav) return medians;
  const geometry = junctionGeometry(nav), list = [], index = new PolygonIndex(24);
  for (const edge of nav.edges) {
    const profile = edge.profile;
    if (!profile.median || edge.kind === 'path') continue;
    const end = id => { const clear = geometry.get(id)?.approaches.get(edge)?.clear; return (clear ?? 0) + CROSSWALK + NOSE + profile.median; };
    const from = end(edge.a), to = edge.length - end(edge.b);
    if (to - from < MIN_LENGTH) continue;
    const points = slice(edge.points, from, to);
    if (points.length < 2) continue;
    const polygon = roundedStrip(points, profile.median);
    const median = { edge, points, polygon, halfWidth: profile.median, planted: Boolean(profile.trees) };
    list.push(median);
    index.add(polygon, median);
  }
  medians = { nav, list, index };
  return medians;
}
// The median at a point on the map, if any
export const medianAt = (x, y) => cityMedians().index.find(x, y);
