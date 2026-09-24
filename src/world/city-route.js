import { CITY, cityCell, cityDistrict } from './city.js';
export { cityCell, cityDistrict } from './city.js';

// The route the car drives: a flat plane with s pointing north and u east,
// as citydriver's grid was, answered from the generated city. The surfaces
// are the ones the city draws: inside a kerb (a block's pavement, a park, a
// quay) is pavement, the water is water, and everything else inside the city
// is roadway, junction corners included.
export const ROAD_LEVEL = 24;
export const PAVEMENT_LEVEL = 24.12;
export const WATER_LEVEL = 17.8;
export const ROAD_HALF_WIDTH = 9;

// Nearest road by how far inside its surface the point is
export function roadAt(s, u, radius = 26) {
  return CITY.roadIndex.nearest(u, s, radius, (segment, distance) => distance - segment.road.profile.halfWidth);
}
export function onRoadAt(s, u) {
  const road = roadAt(s, u);
  return road && road.distance <= road.road.profile.halfWidth ? road : null;
}
export const cityRoadDistance = (s, u) => { const road = roadAt(s, u, 60); return road ? road.distance - road.road.profile.halfWidth : Infinity; };
export const waterAt = (s, u) => CITY.mask.at(u, s);
// What the ground is at a point: 'pavement', 'road' or 'water'. Roads carried
// over the water are bridges, so the carriageway wins there.
export function surfaceAt(s, u) {
  if (CITY.pavement.find(u, s)) return 'pavement';
  if (waterAt(s, u)) return onRoadAt(s, u) ? 'road' : 'water';
  return 'road';
}
export function cityHeight(s, u) {
  const surface = surfaceAt(s, u);
  return surface === 'pavement' ? PAVEMENT_LEVEL : surface === 'water' ? WATER_LEVEL : ROAD_LEVEL;
}
// A pose in the lane of the nearest road, facing the way the heading points.
export function nearestLanePose(s, u, heading = 0, radius = 200) {
  const road = roadAt(s, u, radius);
  if (!road) return { s, u, heading };
  return lanePose(road, heading);
}
export function lanePose(road, heading) {
  const roadHeading = Math.atan2(road.tx, road.ty);
  const direction = Math.cos(heading - roadHeading) >= 0 ? 1 : -1;
  const du = road.tx * direction, ds = road.ty * direction, lane = road.road.profile.lane;
  // Drive on the right: the lane centre sits to the right of the direction of travel.
  return { s: road.y - du * lane, u: road.x + ds * lane, heading: Math.atan2(du, ds), road: road.road, direction };
}
// Where a drive begins: a wide road near the middle of the city, facing a
// long straight stretch of it, so the first seconds at the wheel are clear.
const STRAIGHT_AHEAD = 90;
export function journeyStart() {
  let best = null, bestScore = Infinity;
  for (const road of CITY.roads) {
    if (!['main', 'major', 'ring', 'coast'].includes(road.kind)) continue;
    const points = road.points, cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + points[i].distanceTo(points[i - 1]));
    const at = d => {
      let i = 0;
      while (i < points.length - 2 && cumulative[i + 1] < d) i++;
      const a = points[i], b = points[i + 1], span = cumulative[i + 1] - cumulative[i] || 1, t = Math.max(0, Math.min(1, (d - cumulative[i]) / span));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: (b.x - a.x) / span, ty: (b.y - a.y) / span };
    };
    for (let d = 20; d + STRAIGHT_AHEAD < cumulative[cumulative.length - 1]; d += 10) {
      const p = at(d);
      // The road runs dead straight from just behind to well ahead: every
      // stretch of it points the way the car sets off, within two degrees
      let straight = true;
      for (let k = -10; k <= STRAIGHT_AHEAD && straight; k += 5) {
        const q = at(d + k);
        straight = q.tx * p.tx + q.ty * p.ty > .9994 && Math.abs((q.x - p.x) * p.ty - (q.y - p.y) * p.tx) < .5;
      }
      if (!straight) continue;
      // and well clear of any junction
      const crossing = CITY.roadIndex.nearest(p.x, p.y, 30, segment => segment.road === road ? Infinity : 0);
      if (crossing) continue;
      const score = Math.hypot(p.x, p.y) + (road.kind === 'coast' || road.kind === 'ring' ? 300 : 0);
      if (score < bestScore) { bestScore = score; best = { ...p, road }; }
    }
  }
  if (!best) return { s: 0, u: 0, heading: 0, distance: 0 };
  const pose = lanePose(best, Math.atan2(best.tx, best.ty));
  return { s: pose.s, u: pose.u, heading: pose.heading, distance: 0 };
}
export const citydriverRoute = {
  grid: true, laneAssist: false,
  frame: s => ({ x: 0, y: ROAD_LEVEL, z: -s, angle: 0, scale: 1 }),
  position: (s, u, y = cityHeight(s, u)) => ({ x: u, y, z: -s }),
  height: cityHeight,
  bounds: () => [-Infinity, Infinity],
  looseness: (s, u) => (surfaceAt(s, u) === 'pavement' ? .3 : 0),
  water: (s, u) => surfaceAt(s, u) === 'water',
  nearestLane: nearestLanePose,
  start: journeyStart,
};
