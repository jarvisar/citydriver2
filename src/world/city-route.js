import { CITY, cityCell, cityDistrict } from './city.js';
export { cityCell, cityDistrict } from './city.js';

// The route the car drives: a flat plane with s pointing north and u east,
// as citydriver's grid was, answered from the generated city. Roads are the
// generated polylines with their profile widths; everything else is pavement,
// except the water.
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
export function cityHeight(s, u) {
  if (onRoadAt(s, u)) return ROAD_LEVEL;
  if (waterAt(s, u)) return WATER_LEVEL;
  return PAVEMENT_LEVEL;
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
// Where a drive begins: a wide road near the middle of the city.
export function journeyStart() {
  let best = null, bestDistance = Infinity;
  for (const road of CITY.roads) {
    if (road.kind !== 'main' && road.kind !== 'major' && road.kind !== 'coast') continue;
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i], b = road.points[i + 1], length = a.distanceTo(b);
      if (length < 30) continue;
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, distance = Math.hypot(x, y);
      if (distance < bestDistance) { bestDistance = distance; best = { x, y, tx: (b.x - a.x) / length, ty: (b.y - a.y) / length, road }; }
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
  looseness: (s, u) => (onRoadAt(s, u) ? 0 : .3),
  water: (s, u) => waterAt(s, u) && !onRoadAt(s, u),
  nearestLane: nearestLanePose,
  start: journeyStart,
};
