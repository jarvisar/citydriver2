import Vector from './vector.js';
import { offsetPolygonMapped, signedArea, calcPolygonArea, isSimple, dedupePolygon, subdividePolygon, insidePolygon, segmentIntersection } from './polygon-util.js';

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
// that span a corner wrap round it, as corner buildings do. Round an outside
// corner, and at the thin end of a block, many of those lines meet at one
// stepped corner; no two cuts may meet there (see fans and squareCuts).
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

// Sharp corners, merging bends that follow each other closely (a rounded
// corner): {start, end, turn, at} round the perimeter, anticlockwise turns outside
function sharpCorners(polygon, { n, cumulative, perimeter }) {
  const turns = polygon.map((p, i) => {
    const a = polygon[(i - 1 + n) % n], b = polygon[(i + 1) % n];
    const d1x = p.x - a.x, d1y = p.y - a.y, d2x = b.x - p.x, d2y = b.y - p.y;
    return Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
  });
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
  return corners.filter(c => Math.abs(c.turn) > TURN).map(c => ({ ...c, at: (c.start + c.end) / 2 }));
}

// Where to cut: a cut on every sharp inside corner, a corner lot round every
// sharp outside corner, and plots of about `frontage` between.
function cutPositions(sharp, geometry, { frontage, corner, depth }, random) {
  const { perimeter } = geometry;
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

// Round an outside corner the stepped outline is shorter than the street, so
// a cut straight back from the street there misses its edge's stepped copy
// and runs to the stepped corner instead. The stretches of street whose cuts
// would all meet at one stepped corner: {from, to} round the perimeter (to may
// pass it), `lean`, the most a cut in it would lean from square, `reach`, how
// far its street runs out from that corner, whether it is `long`, a thin end
// of the block (see frontageLots), and `tip`, the middle of its far end: its
// outside corners, or failing those its farthest point.
function fans(polygon, geometry, inset, depth, sharp) {
  const { n, cumulative, perimeter } = geometry, pieces = [];
  for (let k = 0; k < n; k++) {
    const from = polygon[k], to = polygon[(k + 1) % n], a = inset.source[k], b = inset.source[(k + 1) % n];
    const start = cumulative[k], length = cumulative[k + 1] - start;
    if (a === b) { pieces.push({ from: start, to: start + length, point: a }); continue; }
    // (where q below finds the stepped edge's ends: it is straight in t)
    const A = inset.points[a], B = inset.points[b], ex = to.x - from.x, ey = to.y - from.y, el = Math.hypot(ex, ey) || 1;
    const bx = B.x - A.x, by = B.y - A.y, bl2 = bx * bx + by * by || 1;
    const tau = t => ((from.x + ex * t - ey / el * depth - A.x) * bx + (from.y + ey * t + ex / el * depth - A.y) * by) / bl2;
    const t0 = tau(0), slope = tau(1) - t0;
    if (Math.abs(slope) < 1e-12) continue;
    const ta = -t0 / slope, tb = (1 - t0) / slope;
    if (ta > 0) pieces.push({ from: start, to: start + Math.min(1, ta) * length, point: a });
    if (tb < 1) pieces.push({ from: start + Math.max(0, tb) * length, to: start + length, point: b });
  }
  // Pieces running on into each other, to the same stepped corner, are one fan
  const zones = [];
  for (const piece of pieces) {
    const last = zones[zones.length - 1];
    if (last && last.point === piece.point && piece.from - last.to < 1e-6) last.to = piece.to;
    else zones.push({ ...piece });
  }
  if (zones.length > 1) {
    const first = zones[0], last = zones[zones.length - 1];
    if (first.point === last.point && first.from + perimeter - last.to < 1e-6) { first.from = last.from - perimeter; zones.pop(); }
  }
  for (const zone of zones) {
    zone.lean = 0;
    const V = inset.points[zone.point], corners = [];
    for (let k = 0; k < n; k++) {
      // (each corner inside the fan, against the walls either side of it)
      const s = zone.from + (((cumulative[k] - zone.from) % perimeter) + perimeter) % perimeter;
      if (s <= zone.from || s >= zone.to) continue;
      const p = polygon[k], dx = V.x - p.x, dy = V.y - p.y, dl = Math.hypot(dx, dy) || 1;
      corners.push({ s, reach: dl });
      for (const e of [(k - 1 + n) % n, k]) {
        const a = polygon[e], b = polygon[(e + 1) % n], el = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        zone.lean = Math.max(zone.lean, Math.acos(Math.max(-1, Math.min(1, (dx * -(b.y - a.y) + dy * (b.x - a.x)) / (dl * el)))));
      }
    }
    zone.reach = Math.max(0, ...corners.map(c => c.reach));
    zone.long = zone.reach > LONG * depth;
    const ends = sharp.filter(c => c.turn > 0).map(c => zone.from + (((c.at - zone.from) % perimeter) + perimeter) % perimeter).filter(s => s < zone.to).sort((a, b) => a - b);
    const far = ends.length ? ends : corners.filter(c => c.reach === zone.reach).map(c => c.s);
    zone.tip = far.length ? (far[0] + far[far.length - 1]) / 2 : (zone.from + zone.to) / 2;
  }
  return zones.filter(zone => zone.to - zone.from > 1e-6);
}

// Every cut in a fan meets the others at one point, leaving slivers that end
// in a point (cake slices, from above). So a fan goes to one lot: a cut in it
// moves out to its nearer end, where it runs square to the street, and the
// slivers that leaves join their smaller neighbour. A gentle bend's fan is
// narrow and a cut there leans only a little, so it keeps one. A fan round
// more than one corner (the end of a narrow block) has a lot for each corner,
// cut halfway between them.
const GENTLE = 20 * Math.PI / 180;
// A fan reaching further than this many lot depths from its stepped corner is cut across (see frontageLots)
const LONG = 1.8;
function squareCuts(cuts, zones, sharp, perimeter, least) {
  const wrap = s => ((s % perimeter) + perimeter) % perimeter;
  const into = (s, zone) => wrap(s - zone.from);
  const inside = (s, zone) => into(s, zone) > 1e-6 && into(s, zone) < zone.to - zone.from - 1e-6;
  let out = cuts.slice();
  const moved = new Set();
  for (const zone of zones) {
    const within = out.filter(s => inside(s, zone));
    if (!within.length) continue;
    const span = zone.to - zone.from, middle = span / 2;
    const keep = zone.lean <= GENTLE ? within.reduce((best, s) => Math.abs(into(s, zone) - middle) < Math.abs(into(best, zone) - middle) ? s : best) : null;
    out = out.map(s => {
      if (s === keep || !inside(s, zone)) return s;
      const end = wrap(into(s, zone) < middle ? zone.from : zone.to);
      moved.add(end);
      return end;
    });
  }
  for (const zone of zones) {
    if (zone.long) continue;
    const within = sharp.filter(c => c.turn > 0 && inside(c.at, zone)).map(c => into(c.at, zone)).sort((a, b) => a - b);
    for (let i = 1; i < within.length; i++) out.push(wrap(zone.from + (within[i - 1] + within[i]) / 2));
  }
  if (out.length === cuts.length && out.every((s, i) => s === cuts[i])) return cuts;
  out = [...new Set(out)].sort((a, b) => a - b);
  // Join each sliver beside a moved cut to its smaller neighbour
  for (let guard = 0; guard < cuts.length && out.length > 2; guard++) {
    const m = out.length, width = i => wrap(out[(i + 1) % m] - out[i]) || perimeter;
    let sliver = -1;
    for (let i = 0; i < m; i++) if (width(i) < least && (moved.has(out[i]) || moved.has(out[(i + 1) % m])) && (sliver < 0 || width(i) < width(sliver))) sliver = i;
    if (sliver < 0) break;
    const before = width((sliver - 1 + m) % m), after = width((sliver + 1) % m);
    out.splice(before <= after ? sliver : (sliver + 1) % m, 1);
  }
  return out;
}

// Cuts off the tip of every corner sharper than maxTurn (radians of turn), so
// the cut is about `width` across: an acute corner is a small plaza, not a
// lot, and stepping the block in does not throw its corner far away.
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
  // A stepped outline that shoots out past a sharp corner is no yard: every
  // lot's back would reach out of the block to it
  if (inset.points.some(point => !insidePolygon(point, polygon))) return null;
  const geometry = frame(polygon), { n, cumulative, perimeter } = geometry, sharp = sharpCorners(polygon, geometry), zones = fans(polygon, geometry, inset, used, sharp);
  const cuts = squareCuts(cutPositions(sharp, geometry, { frontage, corner, depth: used }, random), zones, sharp, perimeter, frontage[0] * .6);
  if (cuts.length < 2) return null;
  const p = s => { const { k, t } = locate(geometry, s); return { point: lerp(polygon[k], polygon[(k + 1) % n], t), k, t }; };
  // The street from s to t (t may pass the start): its ends and the corners between
  const corners = [...cumulative.slice(0, n), ...cumulative.slice(0, n).map(s => s + perimeter)].map((s, k) => ({ s, k: k % n }));
  const street = (s, t) => [p(s % perimeter).point, ...corners.filter(c => c.s > s + 1e-6 && c.s < t - 1e-6).map(c => polygon[c.k]), p(t % perimeter).point];
  const crosses = (a, b) => !insidePolygon(lerp(a, b, .5), polygon) || polygon.some((c, i) => segmentIntersection(a, b, c, polygon[(i + 1) % n], -1e-3));
  // A fan reaching far out from its stepped corner is the thin end of a
  // block, too long for one lot: it is cut across, from street to street,
  // into lots through the block, the one at the tip twice as long. The lot's
  // ring is its street from s0 to s1 and then `rear` (from its side at s1).
  const target = (frontage[0] + frontage[1]) / 2;
  const across = (s0, s1, rear) => {
    const zone = zones.find(z => z.long && [0, perimeter, -perimeter].some(shift => z.from + shift >= s0 - 1e-6 && z.to + shift <= s1 + 1e-6));
    if (!zone) return null;
    const tip = [zone.tip, zone.tip + perimeter, zone.tip - perimeter].find(s => s > s0 && s < s1);
    if (tip === undefined) return null;
    // (square to the fan's axis, from its stepped corner to its tip, over the
    // stretch where there is street on both sides)
    const V = inset.points[zone.point], T = p(tip % perimeter).point, length = V.distanceTo(T) || 1;
    const along = point => ((point.x - V.x) * (T.x - V.x) + (point.y - V.y) * (T.y - V.y)) / length;
    const start = Math.max(0, along(p(s0).point), along(p(s1 % perimeter).point)), count = Math.round((length - start) / target);
    if (count < 2) return null;
    // Where the street, walked from `from` by `sign`, first comes `d` along the axis
    const reach = (points, from, sign, d) => {
      for (let i = 0, walked = 0; i + 1 < points.length; i++) {
        const a = points[i], b = points[i + 1], da = along(a), db = along(b), step = a.distanceTo(b);
        if ((da - d) * (db - d) <= 0 && da !== db) return from + sign * (walked + step * (d - da) / (db - da));
        walked += step;
      }
      return NaN;
    };
    const sideA = street(s0, tip), sideB = street(tip, s1).reverse(), A = [s0], B = [s1];
    for (let k = 1; k < count; k++) {
      const d = start + k / (count + 1) * (length - start);
      A.push(reach(sideA, s0, 1, d)); B.push(reach(sideB, s1, -1, d));
      if (!(A[k] > A[k - 1] && A[k] < tip && B[k] < B[k - 1] && B[k] > tip)) return null;
    }
    const rings = [];
    for (let k = 0; k < count; k++) {
      // (each lot's street on both sides, then the cut across; the tip's runs round the tip)
      const last = k + 1 === count, near = street(A[k], last ? B[k] : A[k + 1]), far = last ? [] : street(B[k + 1], B[k]);
      if (!last && crosses(near[near.length - 1], far[0])) return null;
      const ring = [...near, ...far].map(point => ({ point, kind: 'street' }));
      if (!last) ring[near.length - 1].kind = 'side';
      if (k) ring[ring.length - 1].kind = 'side';
      else ring.pop();
      rings.push(k ? ring : [...ring, ...rear]);
    }
    return rings;
  };
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
  // Drop repeated points; an edge takes the kind of the later duplicate
  const tidy = ring => {
    const clean = [];
    for (const vertex of ring) {
      const last = clean[clean.length - 1];
      if (last && last.point.distanceTo(vertex.point) < .05) { last.kind = vertex.kind; continue; }
      clean.push({ ...vertex });
    }
    while (clean.length > 1 && clean[0].point.distanceTo(clean[clean.length - 1].point) < .05) clean[0].kind = clean.pop().kind === 'street' ? 'street' : clean[0].kind;
    return clean.length >= 3 && isSimple(clean.map(v => v.point)) ? clean : null;
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
    // Back along the yard from q(b) to q(a)
    const rear = [{ point: b.point, kind: 'side' }, { point: q(b), kind: 'rear' }];
    let j = b.k;
    for (let step = 0; step < steps; step++) { rear.push({ point: inset.points[inset.source[j]], kind: 'rear' }); j = (j - 1 + n) % n; }
    rear.push({ point: q(a), kind: 'side' });
    let pieces = across(s0, s1, rear)?.map(tidy);
    if (!pieces || pieces.includes(null)) pieces = [tidy([...ring, ...rear])];
    for (const clean of pieces) {
      if (!clean) continue;
      const points = clean.map(v => v.point), area = calcPolygonArea(points);
      if (area < minLot) continue;
      lots.push({ polygon: points, edges: clean.map(v => v.kind), frontage: s1 - s0, depth: used, area });
    }
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
