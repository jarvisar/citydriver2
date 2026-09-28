import { junctionGeometry, LINK } from './junction-geometry.js';
import { KERB_RADIUS } from './city.js';
import { surfaceAt } from './city-route.js';

// How a car gets from one street to the next. A lane runs along its edge,
// offset to the right of travel; a turn leaves it on a circular arc tangent to
// both lanes' lines and joins the next lane where the arc ends. The arc is as
// wide as the junction allows: its apex stays a car's half-width clear of the
// rounded kerb on the inside of the turn, and it starts no further back than
// the second half of the street it leaves and ends in the first half of the
// street it joins, so a car never turns tighter or wider than the corner it
// is going round. Traffic and the autodrive share these curves.

const LATERAL = 2.8;  // Comfortable sideways acceleration through a turn, m/s²
const CLEARANCE = 1.4;  // Half a car and a little room from the kerb
const SNUG = 3;  // Tightest a car can turn

// Where a lane leaves a junction; where two streets simply meet (or a street
// meets a park path) there is no box, but the turn still needs room
function clearAt(nav, edge, nodeId, other) {
  return junctionGeometry(nav).get(nodeId)?.approaches.get(edge)?.clear ?? Math.max(3, (edge.profile.halfWidth + other.profile.halfWidth) * .5);
}

// Cubic Bézier weights for a point (four) and a tangent (three) at each
// t = i / count, worked out once. A curve's own samples always fall on these,
// and dozens of curves are tried for every turn.
function weights(count) {
  const w = new Float64Array((count + 1) * 7);
  for (let i = 0; i <= count; i++) {
    const t = i / count, u = 1 - t;
    w[i * 7] = u * u * u; w[i * 7 + 1] = 3 * u * u * t; w[i * 7 + 2] = 3 * u * t * t; w[i * 7 + 3] = t * t * t;
    w[i * 7 + 4] = 3 * u * u; w[i * 7 + 5] = 6 * u * t; w[i * 7 + 6] = 3 * t * t;
  }
  return w;
}
const SAMPLES = 24, BENDS = 32, ALONG = weights(SAMPLES), ROUND = weights(BENDS);
// A path along a cubic Bézier, with an arc-length table and its tightest
// radius. Points and tangents are written out over the controls' numbers
// without allocating, with the same sums in the same order, so the answers
// match to the last bit. A sketch leaves the radius (and the angle and speed
// that go with it) for finish, since most curves tried for a turn are ruled
// out without it (see turning).
function sketch(controls, start, end) {
  const x0 = controls[0].x, y0 = controls[0].y, x1 = controls[1].x, y1 = controls[1].y, x2 = controls[2].x, y2 = controls[2].y, x3 = controls[3].x, y3 = controls[3].y;
  const ex0 = x1 - x0, ey0 = y1 - y0, ex1 = x2 - x1, ey1 = y2 - y1, ex2 = x3 - x2, ey2 = y3 - y2;
  const table = new Float64Array(SAMPLES + 1);
  let px = x0, py = y0;
  for (let i = 1; i <= SAMPLES; i++) {
    const k = i * 7, a = ALONG[k], b = ALONG[k + 1], c = ALONG[k + 2], d = ALONG[k + 3];
    const x = a * x0 + b * x1 + c * x2 + d * x3, y = a * y0 + b * y1 + c * y2 + d * y3;
    table[i] = table[i - 1] + Math.hypot(x - px, y - py);
    px = x; py = y;
  }
  const length = table[SAMPLES];
  // The point `d` along it into `out` (u, s), with its tangent (tx, ty) and
  // heading only when asked for. Same numbers as pose.
  const place = (d, out, withTangent = false, withHeading = false) => {
    const target = Math.max(0, Math.min(length, d));
    let i = 1;
    while (i < SAMPLES && table[i] < target) i++;
    const span = table[i] - table[i - 1] || 1, t = (i - 1 + (target - table[i - 1]) / span) / SAMPLES;
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    out.u = a * x0 + b * x1 + c * x2 + e * x3; out.s = a * y0 + b * y1 + c * y2 + e * y3;
    if (!withTangent && !withHeading) return out;
    const ta = 3 * u * u, tb = 6 * u * t, tc = 3 * t * t, x = ta * ex0 + tb * ex1 + tc * ex2, y = ta * ey0 + tb * ey1 + tc * ey2, norm = Math.hypot(x, y) || 1;
    out.tx = x / norm; out.ty = y / norm;
    if (withHeading) out.heading = Math.atan2(out.tx, out.ty);
    return out;
  };
  // (the tangent and point at bend sample i, into BEND)
  const sample = i => {
    const k = i * 7, a = ROUND[k + 4], b = ROUND[k + 5], c = ROUND[k + 6];
    const x = a * ex0 + b * ex1 + c * ex2, y = a * ey0 + b * ey1 + c * ey2, norm = Math.hypot(x, y) || 1;
    BEND[0] = x / norm; BEND[1] = y / norm;
    BEND[2] = ROUND[k] * x0 + ROUND[k + 1] * x1 + ROUND[k + 2] * x2 + ROUND[k + 3] * x3; BEND[3] = ROUND[k] * y0 + ROUND[k + 1] * y1 + ROUND[k + 2] * y2 + ROUND[k + 3] * y3;
  };
  // The radius between bend samples i - 1 and i, as finish finds it
  // (Infinity where it barely turns, which finish passes over)
  const radiusAt = i => {
    sample(i - 1);
    const tx0 = BEND[0], ty0 = BEND[1], qx0 = BEND[2], qy0 = BEND[3];
    sample(i);
    const step = Math.abs(Math.atan2(tx0 * BEND[1] - ty0 * BEND[0], tx0 * BEND[0] + ty0 * BEND[1]));
    return step > 1e-6 ? Math.hypot(BEND[2] - qx0, BEND[3] - qy0) / step : Infinity;
  };
  const path = {
    start, end, length, angle: undefined, radius: undefined, speed: undefined,
    pose: d => place(d, { s: 0, u: 0, heading: 0, tx: 0, ty: 0 }, true, true),
    place,
  };
  // (each sample's tangent and point serve the steps either side of it)
  const finish = () => {
    if (path.radius !== undefined) return path;
    let radius = Infinity, firstX = 0, firstY = 0, tx0 = 0, ty0 = 0, qx0 = 0, qy0 = 0;
    for (let i = 0; i <= BENDS; i++) {
      sample(i);
      const tx1 = BEND[0], ty1 = BEND[1], qx1 = BEND[2], qy1 = BEND[3];
      if (i) {
        const step = Math.abs(Math.atan2(tx0 * ty1 - ty0 * tx1, tx0 * tx1 + ty0 * ty1));
        if (step > 1e-6) radius = Math.min(radius, Math.hypot(qx1 - qx0, qy1 - qy0) / step);
      } else { firstX = tx1; firstY = ty1; }
      tx0 = tx1; ty0 = ty1; qx0 = qx1; qy0 = qy1;
    }
    path.angle = Math.acos(Math.max(-1, Math.min(1, firstX * tx0 + firstY * ty0)));
    path.radius = radius; path.speed = Math.max(1.8, Math.sqrt(LATERAL * radius));
    return path;
  };
  return { path, finish, radiusAt };
}
const BEND = new Float64Array(4);
const curve = (controls, start, end) => sketch(controls, start, end).finish();
const bezier = (a, b, handleA, handleB) => [{ x: a.u, y: a.s }, { x: a.u + a.tx * handleA, y: a.s + a.ty * handleA }, { x: b.u - b.tx * handleB, y: b.s - b.ty * handleB }, { x: b.u, y: b.s }];
// (a point along a curve being checked, reused)
const HERE = { s: 0, u: 0, heading: 0, tx: 0, ty: 0 };

// The curve from the end of `edge` (travelled in `direction`) onto `next`
// ({ edge, direction, via? }). start: how far along edge the curve begins; end:
// how far along next.edge it finishes; length; radius; speed: the most a car
// should carry through it; pose(d) at distance d along the curve, like
// NavGraph.pose. A `via` link is crossed in the same curve.
const turnKey = (edge, direction, next) => `${edge.id}:${direction}>${next.edge.id}:${next.direction}`;
export function turnPath(nav, edge, direction, next) {
  const cache = nav.turnPaths ??= new Map();
  const key = turnKey(edge, direction, next);
  if (cache.has(key)) return cache.get(key);
  const path = next.via ? crossing(nav, edge, direction, next) : allAtOnce(turning(nav, edge, direction, next));
  cache.set(key, path);
  return path;
}
// Whether turnPath has worked this curve out already (see CityTraffic.warm)
export const hasTurnPath = (nav, edge, direction, next) => Boolean(nav.turnPaths?.has(turnKey(edge, direction, next)));
// turnPath a little at a time, for working it out ahead: each next() does one
// candidate curve or a few metres of checking one, and the last keeps the
// curve as turnPath would (unless turnPath got there first)
export function* turnPathSteps(nav, edge, direction, next) {
  const cache = nav.turnPaths ??= new Map(), key = turnKey(edge, direction, next);
  if (cache.has(key)) return cache.get(key);
  const path = next.via ? crossing(nav, edge, direction, next) : yield* turning(nav, edge, direction, next);
  if (!cache.has(key)) cache.set(key, path);
  return cache.get(key);
}
const allAtOnce = steps => {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

// (a generator, paused between pieces when worked out ahead, so it keeps its
// own scratch points)
function* turning(nav, edge, direction, next) {
  const leaves = { s: 0, u: 0, heading: 0, tx: 0, ty: 0 }, joins = { ...leaves }, here = { ...leaves };
  const node = nav.endNode(edge, direction), uTurn = next.edge === edge;
  const laneA = edge.profile.lane, laneB = next.edge.profile.lane;
  const at = (start, end) => [nav.pose(edge, start, direction, laneA), nav.pose(next.edge, end, next.direction, laneB)];
  // The lanes where they leave and join the junction box
  const start0 = Math.max(0, edge.length - (uTurn ? 2 : Math.min(edge.length * .45, clearAt(nav, edge, node.id, next.edge) + .5)));
  const end0 = Math.min(next.edge.length, uTurn ? 2 : Math.min(next.edge.length * .45, clearAt(nav, next.edge, node.id, edge) + .5));
  if (uTurn) {
    const [a, b] = at(start0, end0), chord = Math.hypot(b.u - a.u, b.s - a.s), handle = Math.max(chord * .7, laneA * 1.4);
    return curve(bezier(a, b, handle, handle), start0, end0);
  }
  // Where the lanes' lines meet (a + ta * da = b - tb * db), if they do ahead of both
  const meeting = (a, b) => {
    const cross = a.tx * b.ty - a.ty * b.tx, angle = Math.acos(Math.max(-1, Math.min(1, a.tx * b.tx + a.ty * b.ty)));
    if (Math.abs(cross) < .05 || angle > Math.PI - .2) return null;
    const wx = b.u - a.u, wy = b.s - a.s, da = (wx * b.ty - wy * b.tx) / cross, db = (a.tx * wy - a.ty * wx) / cross;
    return da > 0 && db > 0 ? { da, db, cross, angle } : null;
  };
  // The curve between two lane points: the arc through the meeting point when
  // there is one, a plain sweep otherwise. Sketched once for each pair,
  // however many of the shifts below are clamped onto it.
  const made = new Map();
  const between = (start, end) => {
    let row = made.get(start);
    if (!row) made.set(start, row = new Map());
    let entry = row.get(end);
    if (entry) return entry;
    const [a, b] = at(start, end), meet = meeting(a, b), chord = Math.hypot(b.u - a.u, b.s - a.s);
    let drawn;
    if (meet && meet.da < chord * 2 && meet.db < chord * 2) {
      const k = (4 / 3) * Math.tan(meet.angle / 4) / Math.tan(meet.angle / 2);
      drawn = sketch(bezier(a, b, meet.da * k, meet.db * k), start, end);
    } else drawn = sketch(bezier(a, b, chord / 3, chord / 3), start, end);
    row.set(end, entry = { drawn, a, b, tried: false });
    return entry;
  };
  // How many metres of the car leave the carriageway: its centre, or its
  // inside flank, half a car toward the corner, which is what meets the kerb.
  // Counting stops once the curve is well past losing (more than `enough`).
  const offRoad = function* (path, enough = Infinity) {
    const first = path.place(0, leaves, true), last = path.place(path.length, joins, true), side = Math.sign(first.tx * last.ty - first.ty * last.tx) || 1;
    let off = 0, count = 0;
    for (let d = 0; d <= path.length && off <= enough; d += .5) {
      const p = path.place(d, here, true), u = p.u - p.ty * side * CLEARANCE * .7, v = p.s + p.tx * side * CLEARANCE * .7;
      if (surfaceAt(p.s, p.u) !== 'road' || surfaceAt(v, u) !== 'road') off += .5;
      if (++count % 8 === 0) yield;
    }
    return off;
  };
  // At a car's turning circle or wider, on the carriageway all the way round,
  // the widest; failing that, the one that leaves it least. A turning circle
  // that brushes a kerb still beats a pirouette that does not. Leaving the
  // road only lowers a score, so a curve that could not beat the best so far
  // even on the road all the way round is never walked, and one is walked only
  // until it has lost by a clear metre: the same curve wins either way. Each
  // candidate is scored as it comes, in the same order as ever. Its radius is
  // at most the radius round its middle, so one that could not win even at
  // that is dropped before its radius is found.
  let best = null, bestScore = -Infinity, count = 0;
  const score = function* ({ path, finish, radiusAt }) {
    count++;
    const most = radiusAt(BENDS / 2);
    if (!((most >= SNUG ? 1000 : 0) + Math.min(most, 40) - path.length * .01 > bestScore)) return;
    finish();
    const onRoad = (path.radius >= SNUG ? 1000 : 0) + Math.min(path.radius, 40) - path.length * .01;
    if (!(onRoad > bestScore)) return;
    const off = yield* offRoad(path, (onRoad - bestScore) / 20 + 1);
    const total = (path.radius >= SNUG ? 1000 : 0) - off * 20 + Math.min(path.radius, 40) - path.length * .01;
    if (total > bestScore) { bestScore = total; best = path; }
  };
  const [a0, b0] = at(start0, end0), meet = meeting(a0, b0);
  if (meet) {
    const { da, db, cross, angle } = meet, half = Math.tan(angle / 2), bulge = 1 / Math.cos(angle / 2) - 1;
    const kx = a0.u + a0.tx * da, ky = a0.s + a0.ty * da;
    // The inside kerb: each road's edge on the side the car turns toward,
    // meeting at a corner the kerb rounds off. The arc's apex keeps clear of it.
    const left = cross > 0, gA = edge.profile.halfWidth + (left ? laneA : -laneA), gB = next.edge.profile.halfWidth + (left ? laneB : -laneB);
    const na = left ? { x: -a0.ty, y: a0.tx } : { x: a0.ty, y: -a0.tx }, nb = left ? { x: -b0.ty, y: b0.tx } : { x: b0.ty, y: -b0.tx };
    const pa = { x: a0.u + na.x * gA, y: a0.s + na.y * gA }, pb = { x: b0.u + nb.x * gB, y: b0.s + nb.y * gB };
    const ta = ((pb.x - pa.x) * b0.ty - (pb.y - pa.y) * b0.tx) / cross, reach = Math.hypot(pa.x + a0.tx * ta - kx, pa.y + a0.ty * ta - ky);
    const kerbRadius = Math.max(0, (reach - KERB_RADIUS * bulge - CLEARANCE) / bulge);
    const radius = Math.max(SNUG, Math.min(kerbRadius, Math.max(Math.min(da, db) / half, Math.min(6, kerbRadius))));
    const out = radius * half, entry = between(Math.max(edge.length * .55, Math.min(edge.length, start0 + da - out)), Math.max(0, Math.min(next.edge.length * .45, end0 - db + out)));
    entry.tried = true;
    yield* score(entry.drawn);
  }
  // Wider alternatives, for streets that bend as they arrive, and tighter
  // ones that start later and finish sooner, inside a far-reaching corner
  // (where a street meets at a sharp angle, the lanes may no longer point at
  // each other where the corner ends)
  const shifts = [-9, -6, -3, 0, 3, 7, 12];
  for (const i of shifts) for (const j of shifts) {
    const start = Math.max(edge.length * .55, Math.min(edge.length - 3, start0 + i)), end = Math.max(Math.min(3, next.edge.length * .45), Math.min(next.edge.length * .45, end0 - j));
    // (a pair already tried, where shifts are clamped at a street's end, is
    // not tried again: as a second candidate it could only tie with itself,
    // and a tie never wins)
    const entry = between(start, end);
    if (entry.tried) continue;
    entry.tried = true;
    const { drawn, a, b } = entry, first = drawn.path.place(0, leaves, true), last = drawn.path.place(drawn.path.length, joins, true);
    // Only curves that leave and join their lanes heading along them
    if (first.tx * a.tx + first.ty * a.ty > .999 && last.tx * b.tx + last.ty * b.ty > .999) yield* score(drawn);
    yield;
  }
  if (!count) yield* score(between(start0, end0).drawn);
  return best;
}

// Across a junction complex, from the street arriving at it to the one leaving
// beyond its link: an S-bend or a turn, laid over the link. If the sweep would
// run over a kerb the car takes the link after all, one turn at a time.
function crossing(nav, edge, direction, next) {
  const first = nav.endNode(edge, direction), far = nav.nodes[next.direction > 0 ? next.edge.a : next.edge.b];
  const start = Math.max(edge.length * .55, edge.length - clearAt(nav, edge, first.id, next.via) - .5);
  const end = Math.min(next.edge.length * .45, clearAt(nav, next.edge, far.id, next.via) + .5);
  const a = nav.pose(edge, start, direction, edge.profile.lane), b = nav.pose(next.edge, end, next.direction, next.edge.profile.lane);
  const chord = Math.hypot(b.u - a.u, b.s - a.s), path = curve(bezier(a, b, chord * .38, chord * .38), start, end);
  for (let d = 0; d <= path.length; d += 1.5) {
    const p = path.place(d, HERE);
    if (surfaceAt(p.s, p.u) !== 'road' || path.radius < SNUG) { path.overKerb = true; break; }
  }
  return path;
}

// The speed a driver `distance` metres short of a turn may carry, braking at
// `decel`, so it enters the turn at the turn's own speed
export function approachSpeed(path, distance, decel = 3.2) {
  return Math.sqrt(path.speed * path.speed + 2 * decel * Math.max(0, distance));
}

// The street's own bends ask the same of a car as a turn does. For each edge,
// how sharply it bends every BEND_STEP metres (across BEND_WINDOW either
// side), and from that the speed its bends allow for a car in a lane `lane`
// beside the centre line (on the inside of a bend the car's path is tighter
// than the street's).
const BEND_STEP = 1, BEND_WINDOW = 1;
const bends = new WeakMap(), bendHeading = { s: 0, u: 0, heading: 0, tx: 0, ty: 0, segment: 0 };
// (a generator, so the traffic can work it out ahead a little at a time)
function* bendSteps(nav, edge) {
  const count = Math.floor(edge.length / BEND_STEP) + 1, curvature = new Float64Array(count), headings = new Float64Array(count + 1);
  // (headings at each whole metre, found once for the windows either side.
  // This relies on BEND_STEP and BEND_WINDOW both being 1 m, so heading j is
  // the one at min(length, j).)
  for (let j = 0; j <= count; j++) {
    headings[j] = nav.poseInto(bendHeading, edge, Math.min(edge.length, j * BEND_STEP), 1).heading;
    if (j % 128 === 127) yield;
  }
  let most = 0;
  for (let k = 0; k < count; k++) {
    const d = k * BEND_STEP, a = headings[Math.max(0, k - 1)], b = headings[k + 1];
    const span = Math.min(edge.length, d + BEND_WINDOW) - Math.max(0, d - BEND_WINDOW);
    const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    curvature[k] = span > .5 ? turn / span : 0;
    most = Math.max(most, curvature[k]);
    if (k % 64 === 63) yield;
  }
  if (!bends.has(edge)) {
    // A street that never bends enough to slow a car in any lane (the inside
    // one's bend is at most 1/.35 the street's) needs no looking along
    bends.set(edge, { curvature, straight: most / .35 <= 1e-4, lanes: new Map() });
  }
  return bends.get(edge);
}
const bendsOf = (nav, edge) => bends.get(edge) ?? allAtOnce(bendSteps(nav, edge));
// The speed a bend of `curvature` allows in lane `lane`, as a profile keeps it (a float)
function bendAt(curvature, lane) {
  const inside = curvature / Math.max(.35, 1 - curvature * lane);
  return Math.fround(inside > 1e-4 ? Math.max(1.8, Math.sqrt(LATERAL / inside)) : Infinity);
}
// The speeds along an edge for a lane the traffic keeps to, worked out once:
// the kerb lane, and the one by a boulevard's median
function bendProfile(nav, edge, lane) {
  const bent = bendsOf(nav, edge);
  let speeds = bent.lanes.get(lane);
  if (!speeds) {
    speeds = new Float32Array(bent.curvature.length);
    for (let k = 0; k < speeds.length; k++) speeds[k] = bendAt(bent.curvature[k], lane);
    bent.lanes.set(lane, speeds);
  }
  return speeds;
}
const keptLane = (profile, lane) => lane === profile.lane || (profile.divider && lane === (profile.median + profile.divider) / 2);
// How fast a car `along` an edge (measured from where its travel started) may
// go now, to take every bend in the next `look` metres at its own speed. In
// any other lane (a car part way across, or pulling out round something) each
// speed is worked out as it is needed. Keeping a profile for every lane a car
// passed through left edges holding hundreds.
export function bendSpeed(nav, edge, direction, along, lane = 0, decel = 3.2, look = 60) {
  const bent = bendsOf(nav, edge);
  if (bent.straight) return Infinity;
  const across = Math.abs(lane), speeds = keptLane(edge.profile, across) ? bendProfile(nav, edge, across) : null, curvature = bent.curvature;
  let limit = Infinity;
  for (let x = 0; x <= look; x += BEND_STEP) {
    // (no bend further on can ask for less than braking from rest there)
    if (decel >= 0 && Math.sqrt(2 * decel * x) >= limit) break;
    const d = direction > 0 ? along + x : edge.length - along - x;
    if (d < 0 || d > edge.length) break;
    const k = Math.min(curvature.length - 1, Math.round(d / BEND_STEP)), v = speeds ? speeds[k] : bendAt(curvature[k], across);
    if (v < Infinity) limit = Math.min(limit, Math.sqrt(v * v + 2 * decel * x));
  }
  return limit;
}
// Everything bendSpeed needs of an edge in the lanes it keeps, a little at a
// time, worked out ahead of a car arriving on it (see CityTraffic.warm)
export function* bendSpeedSteps(nav, edge, lanes) {
  const bent = bends.get(edge) ?? (yield* bendSteps(nav, edge));
  for (const lane of lanes) if (!bent.straight && keptLane(edge.profile, Math.abs(lane))) bendProfile(nav, edge, Math.abs(lane));
}

// A street shorter than LINK between two junctions is the middle of one
// junction complex: a car crossing the complex plans one turn from the street
// it arrives on to the street beyond, rather than two it has no room for.
// Sharper than this (about 115 degrees) is a hairpin, taken only when there is no other way on
export const HAIRPIN = 2;
export function isLink(nav, edge) {
  const geometry = junctionGeometry(nav);
  return edge.length < LINK && geometry.has(edge.a) && geometry.has(edge.b);
}
// The way on from the end of an edge. usable(choice) filters the choices;
// pick(options) chooses among them (ranked straightest first). A dead end
// turns the car round; a link is crossed to the street beyond it when the
// sweep across fits between the kerbs.
export function wayOn(nav, edge, direction, pick, usable = () => true) {
  const all = nav.choices(edge, direction), usableChoices = all.filter(choice => Math.abs(choice.turn) < HAIRPIN && usable(choice));
  const options = usableChoices.length ? usableChoices : all;
  if (!options.length) return { edge, direction: -direction, turn: Math.PI };
  const choice = pick(options);
  if (choice.edge !== edge && isLink(nav, choice.edge)) {
    const beyond = nav.choices(choice.edge, choice.direction).filter(next => next.edge !== edge && next.edge !== choice.edge && Math.abs(next.turn) < HAIRPIN && usable(next));
    if (beyond.length) {
      const through = { ...pick(beyond), via: choice.edge };
      if (!turnPath(nav, edge, direction, through).overKerb) return through;
    }
  }
  return choice;
}
