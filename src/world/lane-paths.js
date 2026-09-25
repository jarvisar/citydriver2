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

// Cubic Bézier helpers
function point(p, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
}
function tangent(p, t) {
  const u = 1 - t, a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
  const x = a * (p[1].x - p[0].x) + b * (p[2].x - p[1].x) + c * (p[3].x - p[2].x), y = a * (p[1].y - p[0].y) + b * (p[2].y - p[1].y) + c * (p[3].y - p[2].y);
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}
// A path along a cubic Bézier, with an arc-length table and its tightest radius
function curve(controls, start, end) {
  const samples = 24, table = [0];
  let previous = controls[0];
  for (let i = 1; i <= samples; i++) {
    const p = point(controls, i / samples);
    table.push(table[i - 1] + Math.hypot(p.x - previous.x, p.y - previous.y));
    previous = p;
  }
  const length = table[samples], first = tangent(controls, 0), last = tangent(controls, 1);
  const angle = Math.acos(Math.max(-1, Math.min(1, first.x * last.x + first.y * last.y)));
  let radius = Infinity;
  for (let i = 1; i <= 32; i++) {
    const t0 = tangent(controls, (i - 1) / 32), t1 = tangent(controls, i / 32), p0 = point(controls, (i - 1) / 32), p1 = point(controls, i / 32);
    const step = Math.abs(Math.atan2(t0.x * t1.y - t0.y * t1.x, t0.x * t1.x + t0.y * t1.y));
    if (step > 1e-6) radius = Math.min(radius, Math.hypot(p1.x - p0.x, p1.y - p0.y) / step);
  }
  return {
    start, end, length, angle, radius, speed: Math.max(1.8, Math.sqrt(LATERAL * radius)),
    pose(d) {
      const target = Math.max(0, Math.min(length, d));
      let i = 1;
      while (i < samples && table[i] < target) i++;
      const span = table[i] - table[i - 1] || 1, t = (i - 1 + (target - table[i - 1]) / span) / samples;
      const p = point(controls, t), tan = tangent(controls, t);
      return { s: p.y, u: p.x, heading: Math.atan2(tan.x, tan.y), tx: tan.x, ty: tan.y };
    },
  };
}
const bezier = (a, b, handleA, handleB) => [{ x: a.u, y: a.s }, { x: a.u + a.tx * handleA, y: a.s + a.ty * handleA }, { x: b.u - b.tx * handleB, y: b.s - b.ty * handleB }, { x: b.u, y: b.s }];

// The curve from the end of `edge` (travelled in `direction`) onto `next`
// ({ edge, direction, via? }). start: how far along edge the curve begins; end:
// how far along next.edge it finishes; length; radius; speed: the most a car
// should carry through it; pose(d) at distance d along the curve, like
// NavGraph.pose. A `via` link is crossed in the same curve.
export function turnPath(nav, edge, direction, next) {
  const cache = nav.turnPaths ??= new Map();
  const key = `${edge.id}:${direction}>${next.edge.id}:${next.direction}`;
  if (cache.has(key)) return cache.get(key);
  const path = next.via ? crossing(nav, edge, direction, next) : turning(nav, edge, direction, next);
  cache.set(key, path);
  return path;
}

function turning(nav, edge, direction, next) {
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
  // there is one, a plain sweep otherwise
  const between = (start, end) => {
    const [a, b] = at(start, end), meet = meeting(a, b), chord = Math.hypot(b.u - a.u, b.s - a.s);
    if (meet && meet.da < chord * 2 && meet.db < chord * 2) {
      const k = (4 / 3) * Math.tan(meet.angle / 4) / Math.tan(meet.angle / 2);
      return curve(bezier(a, b, meet.da * k, meet.db * k), start, end);
    }
    return curve(bezier(a, b, chord / 3, chord / 3), start, end);
  };
  const candidates = [];
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
    const out = radius * half;
    candidates.push(between(Math.max(edge.length * .55, Math.min(edge.length, start0 + da - out)), Math.max(0, Math.min(next.edge.length * .45, end0 - db + out))));
  }
  // Wider alternatives, for streets that bend as they arrive, and tighter
  // ones that start later and finish sooner, inside a far-reaching corner
  // (where a street meets at a sharp angle, the lanes may no longer point at
  // each other where the corner ends)
  const shifts = [-9, -6, -3, 0, 3, 7, 12];
  for (const i of shifts) for (const j of shifts) {
    const start = Math.max(edge.length * .55, Math.min(edge.length - 3, start0 + i)), end = Math.max(Math.min(3, next.edge.length * .45), Math.min(next.edge.length * .45, end0 - j));
    const path = between(start, end), [a, b] = at(start, end), first = path.pose(0), last = path.pose(path.length);
    // Only curves that leave and join their lanes heading along them
    if (first.tx * a.tx + first.ty * a.ty > .999 && last.tx * b.tx + last.ty * b.ty > .999) candidates.push(path);
  }
  if (!candidates.length) candidates.push(between(start0, end0));
  // How many metres of the car leave the carriageway: its centre, or its
  // inside flank, half a car toward the corner, which is what meets the kerb.
  // Counting stops once the curve is well past losing (more than `enough`).
  const offRoad = (path, enough = Infinity) => {
    const first = path.pose(0), last = path.pose(path.length), side = Math.sign(first.tx * last.ty - first.ty * last.tx) || 1;
    let off = 0;
    for (let d = 0; d <= path.length && off <= enough; d += .5) {
      const p = path.pose(d), u = p.u - p.ty * side * CLEARANCE * .7, v = p.s + p.tx * side * CLEARANCE * .7;
      if (surfaceAt(p.s, p.u) !== 'road' || surfaceAt(v, u) !== 'road') off += .5;
    }
    return off;
  };
  // At a car's turning circle or wider, on the carriageway all the way round,
  // the widest; failing that, the one that leaves it least. A turning circle
  // that brushes a kerb still beats a pirouette that does not. Leaving the
  // road only lowers a score, so a curve that could not beat the best so far
  // even on the road all the way round is never walked, and one is walked only
  // until it has lost by a clear metre: the same curve wins either way.
  let best = null, bestScore = -Infinity;
  for (const path of candidates) {
    const onRoad = (path.radius >= SNUG ? 1000 : 0) + Math.min(path.radius, 40) - path.length * .01;
    if (!(onRoad > bestScore)) continue;
    const off = offRoad(path, (onRoad - bestScore) / 20 + 1);
    const score = (path.radius >= SNUG ? 1000 : 0) - off * 20 + Math.min(path.radius, 40) - path.length * .01;
    if (score > bestScore) { bestScore = score; best = path; }
  }
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
    const p = path.pose(d);
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
// the speed its bends allow every BEND_STEP metres, for a car in a lane `lane`
// beside the centre line (on the inside of a bend the car's path is tighter
// than the street's).
const BEND_STEP = 1, BEND_WINDOW = 1;
const bendProfiles = new WeakMap();
function bendProfile(nav, edge, lane) {
  let byLane = bendProfiles.get(edge);
  if (!byLane) bendProfiles.set(edge, byLane = new Map());
  if (byLane.has(lane)) return byLane.get(lane);
  const count = Math.floor(edge.length / BEND_STEP) + 1, speeds = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const d = k * BEND_STEP, a = nav.pose(edge, Math.max(0, d - BEND_WINDOW), 1), b = nav.pose(edge, Math.min(edge.length, d + BEND_WINDOW), 1);
    const span = Math.min(edge.length, d + BEND_WINDOW) - Math.max(0, d - BEND_WINDOW);
    const turn = Math.abs(Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading)));
    const curvature = span > .5 ? turn / span : 0, inside = curvature / Math.max(.35, 1 - curvature * lane);
    speeds[k] = inside > 1e-4 ? Math.max(1.8, Math.sqrt(LATERAL / inside)) : Infinity;
  }
  byLane.set(lane, speeds);
  return speeds;
}
// How fast a car `along` an edge (measured from where its travel started) may
// go now, to take every bend in the next `look` metres at its own speed
export function bendSpeed(nav, edge, direction, along, lane = 0, decel = 3.2, look = 60) {
  const speeds = bendProfile(nav, edge, Math.abs(lane));
  let limit = Infinity;
  for (let x = 0; x <= look; x += BEND_STEP) {
    const d = direction > 0 ? along + x : edge.length - along - x;
    if (d < 0 || d > edge.length) break;
    const v = speeds[Math.min(speeds.length - 1, Math.round(d / BEND_STEP))];
    if (v < Infinity) limit = Math.min(limit, Math.sqrt(v * v + 2 * decel * x));
  }
  return limit;
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
