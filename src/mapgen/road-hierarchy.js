// Every road takes the profile of its class, and some roads are more than
// their class. The longest avenues through the middle of town are made
// boulevards, so every city has a few however its field fell; the ring road
// is a parkway with a grass median; and each district's side streets are as
// wide as its buildings want: narrow lanes in the old town, streets with
// parking where the houses have gardens or the warehouses have vans.
//
// A profile: kind (how it is marked: boulevard, avenue, side, path),
// halfWidth, lane (the centre of the lane traffic keeps to, right of the
// centre line), speed, median (half its width; 0 for none) and, for a street
// with parking, the half width of the carriageway outside the parking bays.
export const PROFILES = Object.freeze({
  boulevard: Object.freeze({ kind: 'boulevard', halfWidth: 12, lane: 7.2, speed: 20, median: 2.2, divider: 5.6, trees: true }),
  parkway: Object.freeze({ kind: 'boulevard', halfWidth: 11, lane: 6.3, speed: 18, median: 1.5, divider: 4.7, trees: false }),
  avenue: Object.freeze({ kind: 'avenue', halfWidth: 9, lane: 3, speed: 16, median: 0 }),
  riverbank: Object.freeze({ kind: 'avenue', halfWidth: 8, lane: 3, speed: 14, median: 0 }),
  side: Object.freeze({ kind: 'side', halfWidth: 6.5, lane: 2.7, speed: 10, median: 0 }),
  lane: Object.freeze({ kind: 'side', halfWidth: 5.2, lane: 2.2, speed: 8, median: 0, narrow: true }),
  parking: Object.freeze({ kind: 'side', halfWidth: 7.8, lane: 2.8, speed: 10, median: 0, parking: 5.4 }),
  path: Object.freeze({ kind: 'path', halfWidth: 3.6, lane: 1.6, speed: 8, median: 0 }),
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

// roads: [{ kind, points }]. downtownDistance(p): 0 at the middle of town, 1
// at the edge of downtown. streetStyle(p): the profile name for a side street
// whose middle is at p. Promotes majors to boulevards (kind 'main') until the
// city has `boulevards` metres of them, and sets road.profile on every road.
export function assignProfiles(roads, { downtownDistance = () => 1, streetStyle = () => 'side', boulevards = 2200, minLength = 320, most = 3 } = {}) {
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
  for (const road of roads) {
    if (road.kind === 'minor') {
      const [middle] = pointsAlong(road.points, 1);
      road.profile = PROFILES[streetStyle(middle)] ?? PROFILES.side;
    } else road.profile = CLASS_PROFILES[road.kind] ?? PROFILES.side;
  }
  return roads;
}
