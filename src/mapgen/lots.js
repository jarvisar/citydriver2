import Vector from './vector.js';
import { offsetPolygonMapped, signedArea, calcPolygonArea, isSimple, dedupePolygon, subdividePolygon } from './polygon-util.js';

// Lots with a street front. MapGenerator splits a block in half across its
// longest side until the pieces are small, which leaves lots in the middle of
// big blocks with no street at all, and rejects long blocks outright. A town
// is platted the other way: a strip of lots one plot deep all round the
// block, each with its frontage on the pavement, and a shared yard behind.
//
// The strip is the band between the block's inner edge and that edge stepped
// in by the lot depth. Every point p on the inner edge has a partner q on the
// stepped edge: straight back from the street where that lands on the stepped
// copy of p's own edge, and otherwise the stepped corner (the offset maps
// vertex to vertex, collapsed corners to one point). The lines p–q never
// cross, so cutting the band along them at chosen distances round the
// perimeter tiles it exactly: lots along a street are square to it, and lots
// that span a corner wrap round it, as corner buildings do.
//
// Each lot comes with the kind of each of its edges: 'street' along the
// pavement, 'side' against a neighbour, 'rear' against the yard.

const TURN = .5;  // A corner turns more than this (radians); gentler bends are part of one frontage

function frame(polygon) {
  const n = polygon.length, cumulative = [0];
  for (let i = 0; i < n; i++) cumulative.push(cumulative[i] + polygon[i].distanceTo(polygon[(i + 1) % n]));
  return { n, cumulative, perimeter: cumulative[n] };
}
// Which edge a distance round the perimeter falls on, and how far along it
function locate({ n, cumulative }, s) {
  let k = 0;
  while (k < n - 1 && cumulative[k + 1] <= s) k++;
  const span = cumulative[k + 1] - cumulative[k];
  return { k, t: span > 1e-9 ? (s - cumulative[k]) / span : 0 };
}
const lerp = (a, b, t) => new Vector(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

// Where to cut: a cut on every sharp inside corner, a corner lot round every
// sharp outside corner, and plots of about `frontage` between.
function cutPositions(polygon, geometry, { frontage, corner, depth }, random) {
  const { n, cumulative, perimeter } = geometry;
  const turns = polygon.map((p, i) => {
    const a = polygon[(i - 1 + n) % n], b = polygon[(i + 1) % n];
    const d1x = p.x - a.x, d1y = p.y - a.y, d2x = b.x - p.x, d2y = b.y - p.y;
    return Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
  });
  // Sharp corners, merging bends that follow each other closely (a rounded corner)
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(turns[i]) < .05) continue;
    const last = corners[corners.length - 1];
    if (last && cumulative[i] - last.end < 6 && Math.sign(turns[i]) === Math.sign(last.turn)) { last.turn += turns[i]; last.end = cumulative[i]; continue; }
    corners.push({ start: cumulative[i], end: cumulative[i], turn: turns[i] });
  }
  if (corners.length > 1) {
    const first = corners[0], last = corners[corners.length - 1];
    if (first.start + perimeter - last.end < 6 && Math.sign(first.turn) === Math.sign(last.turn)) { first.turn += last.turn; first.start = last.start - perimeter; corners.pop(); }
  }
  const sharp = corners.filter(c => Math.abs(c.turn) > TURN).map(c => ({ ...c, at: (c.start + c.end) / 2 }));
  // Fixed cuts: either side of a corner lot, or at an inside corner
  const fixed = [];
  for (const c of sharp) {
    if (c.turn > 0) {
      // A corner lot reaches at least to where the stepped-in corner meets the
      // street square-on, so the walls either side of it are square too
      const fan = Math.min(3 * depth, depth / Math.tan(Math.max(.2, Math.PI - c.turn) / 2)) + .3;
      const before = Math.max(fan, corner[0] + random() * (corner[1] - corner[0])), after = Math.max(fan, corner[0] + random() * (corner[1] - corner[0]));
      fixed.push({ at: c.start - before, span: [c.start - before, c.end + after] }, { at: c.end + after });
    } else fixed.push({ at: c.at });
  }
  const wrap = s => ((s % perimeter) + perimeter) % perimeter;
  let cuts = fixed.map(f => wrap(f.at)).sort((a, b) => a - b);
  // Drop fixed cuts that crowd each other (small blocks, tight corners)
  cuts = cuts.filter((s, i) => i === 0 || s - cuts[i - 1] > frontage[0] * .6);
  if (cuts.length > 1 && cuts[0] + perimeter - cuts[cuts.length - 1] < frontage[0] * .6) cuts.pop();
  if (!cuts.length) cuts = [random() * perimeter];
  // Plots between the fixed cuts, as even as the frontages allow
  const out = [];
  for (let i = 0; i < cuts.length; i++) {
    const from = cuts[i], to = i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + perimeter, span = to - from;
    out.push(from);
    const inCorner = fixed.some(f => f.span && wrap(f.span[0]) === from);
    if (inCorner) continue;
    const target = frontage[0] + random() * (frontage[1] - frontage[0]), count = Math.max(1, Math.round(span / target));
    for (let k = 1; k < count; k++) out.push(from + span * (k + (random() - .5) * .3) / count);
  }
  return out.map(wrap).sort((a, b) => a - b);
}

// Cuts off the tip of every corner sharper than maxTurn (radians of turn), so
// the cut is about `width` across: an acute corner is a small plaza, not a
// lot, and stepping the block in no longer throws its corner far away.
export function chamferAcute(input, maxTurn = 2.25, width = 9) {
  let polygon = dedupePolygon(input, .05);
  if (polygon.length < 3) return polygon;
  if (signedArea(polygon) < 0) polygon = polygon.slice().reverse();
  for (let guard = 0; guard < 8; guard++) {
    const n = polygon.length, { cumulative, perimeter } = frame(polygon);
    // Turn over a short stretch, so a sharp corner rounded into tiny edges still counts
    let sharp = -1, sharpTurn = maxTurn;
    for (let i = 0; i < n; i++) {
      let turn = 0;
      for (let k = -2; k <= 2; k++) {
        const j = (i + k + n) % n, a = polygon[(j - 1 + n) % n], p = polygon[j], b = polygon[(j + 1) % n];
        if (Math.abs(cumulative[j] - cumulative[i]) > 4 && Math.abs(Math.abs(cumulative[j] - cumulative[i]) - perimeter) > 4) continue;
        const d1x = p.x - a.x, d1y = p.y - a.y, d2x = b.x - p.x, d2y = b.y - p.y;
        turn += Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
      }
      if (turn > sharpTurn) { sharpTurn = turn; sharp = i; }
    }
    if (sharp < 0) break;
    // Walk back and on from the tip far enough that the cut is `width` across
    const reach = Math.min(width / 2 / Math.max(.05, Math.sin((Math.PI - sharpTurn) / 2)), perimeter * .2);
    const at = s => { const { k, t } = locate({ n, cumulative }, ((s % perimeter) + perimeter) % perimeter); return { k, point: lerp(polygon[k], polygon[(k + 1) % n], t) }; };
    const from = at(cumulative[sharp] - reach), to = at(cumulative[sharp] + reach);
    const out = [to.point];
    for (let k = (to.k + 1) % n, step = 0; step < n; k = (k + 1) % n, step++) {
      out.push(polygon[k]);
      if (k === from.k) break;
    }
    out.push(from.point);
    const next = dedupePolygon(out, .05);
    if (next.length < 3 || !isSimple(next) || signedArea(next) <= 0) break;
    polygon = next;
  }
  return polygon;
}

// The strip of lots round a block. inner: the block inside its pavement.
// options: depth, frontage [min, max], corner [min, max] (frontage of a
// corner lot either side of the corner), minLot (smallest lot kept). Returns null when the block
// is too thin for a strip, so the caller can split it across instead.
export function frontageLots(inner, { depth = 22, frontage = [12, 18], corner = [8, 14], minLot = 70 } = {}, random = Math.random) {
  let polygon = dedupePolygon(inner, .05);
  if (polygon.length < 3) return null;
  if (signedArea(polygon) < 0) polygon = polygon.slice().reverse();
  let inset = offsetPolygonMapped(polygon, -depth), used = depth;
  if (!inset || calcPolygonArea(inset.points) < 30) return null;
  // A yard only a few metres across is a sliver nobody can use: deepen the
  // lots until they nearly meet back to back.
  const yardArea = calcPolygonArea(inset.points), yardWidth = 2 * yardArea / frame(inset.points).perimeter;
  if (yardWidth < 9) {
    const deeper = depth + Math.max(0, yardWidth / 2 - 1.5), mapped = offsetPolygonMapped(polygon, -deeper);
    if (mapped) { inset = mapped; used = deeper; }
  }
  const geometry = frame(polygon), { n } = geometry;
  const cuts = cutPositions(polygon, geometry, { frontage, corner, depth: used }, random);
  if (cuts.length < 2) return null;
  const p = s => { const { k, t } = locate(geometry, s); return { point: lerp(polygon[k], polygon[(k + 1) % n], t), k, t }; };
  const q = ({ k, t }) => {
    const a = inset.points[inset.source[k]], b = inset.points[inset.source[(k + 1) % n]];
    const from = polygon[k], to = polygon[(k + 1) % n], ex = to.x - from.x, ey = to.y - from.y, el = Math.hypot(ex, ey) || 1;
    // Straight back from the street, onto this edge's stepped copy
    const px = from.x + ex * t - ey / el * used, py = from.y + ey * t + ex / el * used;
    const bx = b.x - a.x, by = b.y - a.y, bl2 = bx * bx + by * by;
    if (bl2 < 1e-9) return a.clone();
    const tau = ((px - a.x) * bx + (py - a.y) * by) / bl2;
    return tau <= 0 ? a.clone() : tau >= 1 ? b.clone() : new Vector(px, py);
  };
  const lots = [];
  for (let i = 0; i < cuts.length; i++) {
    const s0 = cuts[i], s1 = i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + geometry.perimeter;
    const a = p(s0), b = p(s1 % geometry.perimeter);
    // Along the pavement from a to b
    const ring = [{ point: a.point, kind: 'street' }];
    let k = a.k;
    const steps = (b.k - a.k + n) % n + (s1 - s0 > geometry.perimeter - 1e-6 || (b.k === a.k && b.t < a.t) ? n : 0);
    for (let step = 0; step < steps; step++) { k = (k + 1) % n; ring.push({ point: polygon[k], kind: 'street' }); }
    ring.push({ point: b.point, kind: 'side' });
    // Back along the yard from q(b) to q(a)
    ring.push({ point: q(b), kind: 'rear' });
    const back = [];
    let j = b.k;
    for (let step = 0; step < steps; step++) { back.push(inset.points[inset.source[j]]); j = (j - 1 + n) % n; }
    for (const point of back) ring.push({ point, kind: 'rear' });
    ring.push({ point: q(a), kind: 'side' });
    // Drop repeated points; an edge takes the kind of the later duplicate
    const clean = [];
    for (const vertex of ring) {
      const last = clean[clean.length - 1];
      if (last && last.point.distanceTo(vertex.point) < .05) { last.kind = vertex.kind; continue; }
      clean.push({ ...vertex });
    }
    while (clean.length > 1 && clean[0].point.distanceTo(clean[clean.length - 1].point) < .05) clean[0].kind = clean.pop().kind === 'street' ? 'street' : clean[0].kind;
    const points = clean.map(v => v.point);
    if (points.length < 3 || !isSimple(points)) continue;
    const area = calcPolygonArea(points);
    if (area < minLot) continue;
    lots.push({ polygon: points, edges: clean.map(v => v.kind), frontage: s1 - s0, depth: used, area });
  }
  if (lots.length < 2) return null;
  // The lots and the yard must tile the block exactly; if the stepped outline
  // folded somewhere they overlap, and the block is better cut across
  const tiled = lots.reduce((sum, lot) => sum + lot.area, 0) + calcPolygonArea(inset.points), whole = calcPolygonArea(polygon);
  if (tiled > whole * 1.005 + 1) return null;
  return { lots, yard: inset.points };
}

// Lots for a block too thin for a strip: cut across it, so every lot runs
// from street to street. Edges on the block's boundary are 'street'.
export function throughLots(inner, minArea, random = Math.random) {
  const pieces = subdividePolygon(inner, minArea, random);
  const onBoundary = (a, b) => {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i], d = inner[(i + 1) % inner.length], dx = d.x - c.x, dy = d.y - c.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((mx - c.x) * dx + (my - c.y) * dy) / l2));
      if (Math.hypot(mx - c.x - dx * t, my - c.y - dy * t) < .05) return true;
    }
    return false;
  };
  return pieces.map(polygon => {
    const ccw = signedArea(polygon) < 0 ? polygon.slice().reverse() : polygon;
    return { polygon: ccw, edges: ccw.map((a, i) => onBoundary(a, ccw[(i + 1) % ccw.length]) ? 'street' : 'side'), area: calcPolygonArea(ccw) };
  });
}
