// Every road takes the profile of its class, and some roads are more than
// their class. The longest avenues through the middle of town are made
// boulevards, so every city has a few however its field fell; the ring road
// is a parkway with a grass median; a few long side streets well away from
// the avenues are collectors, carrying a neighbourhood's traffic through it;
// and each district's other side streets are as wide as its buildings want:
// narrow lanes in the old town, streets with parking where the houses have
// gardens or the warehouses have vans.
//
// A profile: kind (how it is marked: boulevard, avenue, collector, side,
// path), rank (its place in the hierarchy, which decides who gives way at a
// junction: 4 the boulevards and the parkway, 3 the avenues, 2 the
// collectors, 1 the local streets, 0 the old town's lanes), centre (its
// centre line: 'double', 'dashed' or none), halfWidth, lane (the centre of
// the lane traffic keeps to, right of the centre line), speed, median (half
// its width; 0 for none) and, for a street with parking, the half width of
// the carriageway outside the parking bays.
export const PROFILES = Object.freeze({
  boulevard: Object.freeze({ kind: 'boulevard', rank: 4, halfWidth: 12, lane: 7.2, speed: 20, median: 2.2, divider: 5.6, trees: true }),
  parkway: Object.freeze({ kind: 'boulevard', rank: 4, halfWidth: 11, lane: 6.3, speed: 18, median: 1.5, divider: 4.7, trees: false }),
  avenue: Object.freeze({ kind: 'avenue', rank: 3, centre: 'double', halfWidth: 9, lane: 3, speed: 16, median: 0 }),
  riverbank: Object.freeze({ kind: 'avenue', rank: 3, centre: 'double', halfWidth: 8, lane: 3, speed: 14, median: 0 }),
  collector: Object.freeze({ kind: 'collector', rank: 2, centre: 'dashed', halfWidth: 7.2, lane: 2.8, speed: 13, median: 0 }),
  // (a collector through a district that parks on its streets)
  bayCollector: Object.freeze({ kind: 'collector', rank: 2, centre: 'dashed', halfWidth: 8.6, lane: 3, speed: 12, median: 0, parking: 6.2 }),
  side: Object.freeze({ kind: 'side', rank: 1, halfWidth: 6.5, lane: 2.7, speed: 10, median: 0 }),
  lane: Object.freeze({ kind: 'side', rank: 0, halfWidth: 5.2, lane: 2.2, speed: 8, median: 0, narrow: true }),
  parking: Object.freeze({ kind: 'side', rank: 1, halfWidth: 7.8, lane: 2.8, speed: 10, median: 0, parking: 5.4 }),
  path: Object.freeze({ kind: 'path', rank: -1, halfWidth: 3.6, lane: 1.6, speed: 8, median: 0 }),
});
// The profile each class of road takes unless something says otherwise
export const CLASS_PROFILES = Object.freeze({
  main: PROFILES.boulevard, major: PROFILES.avenue, ring: PROFILES.parkway, coast: PROFILES.avenue,
  riverbank: PROFILES.riverbank, minor: PROFILES.side, path: PROFILES.path,
});

const lengthOf = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
function pointsAlong(points, count) {
  const total = lengthOf(points), out = [];
  let travelled = 0, i = 0;
  for (let k = 0; k < count; k++) {
    const target = total * (k + .5) / count;
    while (i < points.length - 2 && travelled + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y) < target) {
      travelled += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y); i++;
    }
    const a = points[i], b = points[i + 1], span = Math.hypot(b.x - a.x, b.y - a.y) || 1, t = Math.max(0, Math.min(1, (target - travelled) / span));
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

// Points every `step` metres along a polyline, with the unit tangent there
function samplesAlong(points, step) {
  const out = [];
  for (let i = 0, next = step / 2, travelled = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) continue;
    const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
    for (; next <= travelled + length; next += step) out.push({ x: a.x + tx * (next - travelled), y: a.y + ty * (next - travelled), tx, ty });
    travelled += length;
  }
  return out;
}
const ARTERIAL = new Set(['main', 'major', 'ring', 'coast', 'riverbank']);

// The collectors: long side streets that run well away from every avenue and
// every other collector alongside them, the longest first, so they fall
// between the avenues wherever those leave a neighbourhood without a through
// road. Marks road.collector.
export function chooseCollectors(roads, { gap = 210, minLength = 380, share = .6, step = 20 } = {}) {
  const cell = 70, reach = Math.ceil(gap / cell), grid = new Map(), key = (x, y) => `${x},${y}`;
  const add = samples => {
    for (const p of samples) {
      const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    }
  };
  // How far a point is from the nearest road running alongside it
  const clearance = p => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    let best = Infinity;
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (const q of grid.get(key(cx + dx, cy + dy)) ?? []) {
      if (Math.abs(q.tx * p.tx + q.ty * p.ty) < .8) continue;
      best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
    }
    return best;
  };
  for (const road of roads) if (ARTERIAL.has(road.kind)) add(samplesAlong(road.points, step));
  const candidates = roads.filter(road => road.kind === 'minor' && !road.circus).map(road => ({ road, length: lengthOf(road.points) }))
    .filter(c => c.length >= minLength).sort((a, b) => b.length - a.length);
  for (const { road } of candidates) {
    const samples = samplesAlong(road.points, step);
    if (samples.filter(p => clearance(p) >= gap).length < samples.length * share) continue;
    road.collector = true;
    add(samples);
  }
  return roads;
}

// roads: [{ kind, points }]. downtownDistance(p): 0 at the middle of town, 1
// at the edge of downtown. streetStyle(p): the profile name for a side street
// whose middle is at p. Promotes majors to boulevards (kind 'main') until the
// city has `boulevards` metres of them, chooses the collectors (collectors:
// options for chooseCollectors, or null for none), and sets road.profile on
// every road.
export function assignProfiles(roads, { downtownDistance = () => 1, streetStyle = () => 'side', boulevards = 2200, minLength = 320, most = 3, collectors = {} } = {}) {
  let total = roads.filter(road => road.kind === 'main').reduce((sum, road) => sum + lengthOf(road.points), 0);
  const candidates = roads.filter(road => road.kind === 'major').map(road => {
    const length = lengthOf(road.points), samples = pointsAlong(road.points, 6);
    const central = samples.reduce((sum, p) => sum + Math.min(2, downtownDistance(p)), 0) / samples.length;
    return { road, length, score: length / (1 + central * .8) };
  }).filter(c => c.length >= minLength).sort((a, b) => b.score - a.score);
  let promoted = 0;
  for (const { road, length } of candidates) {
    if (total >= boulevards || promoted >= most) break;
    road.kind = 'main'; road.promoted = true; total += length; promoted++;
  }
  if (collectors) chooseCollectors(roads, collectors);
  for (const road of roads) {
    if (road.kind === 'minor') {
      const [middle] = pointsAlong(road.points, 1), style = streetStyle(middle);
      road.profile = road.collector ? (style === 'parking' ? PROFILES.bayCollector : PROFILES.collector) : PROFILES[style] ?? PROFILES.side;
    } else road.profile = CLASS_PROFILES[road.kind] ?? PROFILES.side;
  }
  return roads;
}
