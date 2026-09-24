import ClipperLib from 'clipper-lib';
import Vector from './vector.js';
import { offsetPolygon, dedupePolygon, signedArea } from './polygon-util.js';

// Polygon booleans for the shore and the blocks, with Clipper
// (https://www.angusj.com/delphi/clipper.php) in whole millimetres: integer
// arithmetic, so coincident and nearly coincident edges, folds and
// self-crossings never trip it up.
//
// A region is a list of rings of {x, y} filled non-zero, so a hole winds the
// other way from the ring round it. Results are pieces { outer, holes }, the
// outer anticlockwise and its holes clockwise: the region is always on the
// left of a ring.
const SCALE = 1000;
const toPath = ring => ring.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromPath = path => dedupePolygon(path.map(p => new Vector(p.X / SCALE, p.Y / SCALE)), 1e-6);

function run(type, subject, clip = []) {
  const clipper = new ClipperLib.Clipper(), tree = new ClipperLib.PolyTree();
  const add = (rings, kind) => { const paths = rings.filter(ring => ring.length >= 3).map(toPath); if (paths.length) clipper.AddPaths(paths, kind, true); };
  add(subject, ClipperLib.PolyType.ptSubject);
  add(clip, ClipperLib.PolyType.ptClip);
  clipper.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const pieces = [];
  const visit = node => {
    for (const outer of node.Childs()) {
      const ring = fromPath(outer.Contour());
      const holes = outer.Childs().map(hole => fromPath(hole.Contour())).filter(hole => hole.length >= 3);
      if (ring.length >= 3) pieces.push({ outer: signedArea(ring) < 0 ? ring.reverse() : ring, holes: holes.map(hole => signedArea(hole) > 0 ? hole.reverse() : hole) });
      // Islands inside the holes
      for (const hole of outer.Childs()) visit(hole);
    }
  };
  visit(tree);
  return pieces;
}

// The rings of a list of pieces, as a region
export const region = pieces => pieces.flatMap(piece => [piece.outer, ...piece.holes]);
export const union = (...regions) => run(ClipperLib.ClipType.ctUnion, regions.flat());
export const difference = (subject, ...clips) => run(ClipperLib.ClipType.ctDifference, subject, clips.flat());
export const intersection = (a, b) => run(ClipperLib.ClipType.ctIntersection, a, b);

// A polygon stepped in by a distance per edge, always: where the offset
// breaks (a waist too narrow for the step, a bend that folds it over) the
// polygon less a strip of that width along every edge, keeping the biggest
// piece. distance is negative inward, as for offsetPolygon.
export function insetPolygon(input, distance) {
  const direct = offsetPolygon(input, distance);
  if (direct.length >= 3) return direct;
  let polygon = dedupePolygon(input);
  if (polygon.length < 3) return [];
  if (signedArea(polygon) < 0) polygon = polygon.slice().reverse();
  const distanceOf = typeof distance === 'function' ? distance : () => distance;
  const n = polygon.length, strips = [];
  for (let i = 0; i < n; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n], d = Math.abs(distanceOf(a, b, i));
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1e-9 || d < 1e-9) continue;
    const nx = -dy / length * d, ny = dx / length * d;
    strips.push([{ x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny }, { x: a.x + nx, y: a.y + ny }]);
    // Round each corner, as an offset rounds an inside one
    const before = polygon[(i - 1 + n) % n], r = Math.max(d, Math.abs(distanceOf(before, a, (i - 1 + n) % n))), corner = [];
    for (let k = 0; k < 12; k++) corner.push({ x: a.x + Math.cos(k * Math.PI / 6) * r, y: a.y + Math.sin(k * Math.PI / 6) * r });
    strips.push(corner);
  }
  let best = null, bestArea = 0;
  for (const piece of difference([polygon], strips)) {
    const area = signedArea(piece.outer);
    if (area > bestArea) { best = piece.outer; bestArea = area; }
  }
  return best ?? [];
}
