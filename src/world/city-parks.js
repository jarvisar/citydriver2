import { CITY } from './city.js';
import { randomAt } from './route.js';
import { deepestPoint } from '../mapgen/park-paths.js';
import { insidePolygon, distanceToPolyline, offsetPolygon, signedArea } from '../mapgen/polygon-util.js';

// What stands in each park and square beyond its lawn. A big park's walks
// are streets of the network (see mapgen/park-paths.js); here is its plaza,
// paved round a fountain or a bandstand, or its pond. A square is laid out
// on its own: walks in from its corners and the middles of its long sides to
// a paved circle round a fountain. Trees, lamps and benches ask `clear`
// where they may stand.
export const SQUARE_WALK = 1.8;

const circle = (x, y, r, count = 24) => Array.from({ length: count }, (_, k) => ({ x: x + Math.cos(k / count * Math.PI * 2) * r, y: y + Math.sin(k / count * Math.PI * 2) * r }));
const distanceToRing = (p, ring) => distanceToPolyline(p, [...ring, ring[0]]);

function squareLayout(park) {
  const lawn = park.lawn;
  if (lawn.length < 3) return null;
  const deep = deepestPoint(lawn);
  if (!deep || deep.distance < 9) return { walks: [], plaza: null };
  const centre = deep.point, radius = Math.min(9, deep.distance * .42);
  const ring = signedArea(lawn) > 0 ? lawn : lawn.slice().reverse();
  // Corners: where the edge turns by more than 50 degrees
  const n = ring.length, starts = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], p = ring[i], b = ring[(i + 1) % n];
    const turn = Math.atan2((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y));
    if (turn > .87) starts.push(p);
  }
  // and the middle of every long side, if the square is big enough for more walks
  if (deep.distance > 22) for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 70) starts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const walks = [];
  for (const start of starts) {
    const dx = centre.x - start.x, dy = centre.y - start.y, length = Math.hypot(dx, dy);
    if (length < radius + 4) continue;
    // From just inside the square's edge to the circle round the fountain
    const from = { x: start.x + dx / length * .5, y: start.y + dy / length * .5 }, to = { x: centre.x - dx / length * radius, y: centre.y - dy / length * radius };
    walks.push([from, to]);
  }
  walks.push([...circle(centre.x, centre.y, radius, 28), circle(centre.x, centre.y, radius, 28)[0]]);
  return { walks, plaza: { x: centre.x, y: centre.y, radius: radius - SQUARE_WALK, kind: 'fountain' } };
}

let parks = null;
export function cityParks() {
  if (parks) return parks;
  parks = CITY.parkPlans.map((park, index) => {
    if (park.square) {
      const layout = squareLayout(park) ?? { walks: [], plaza: null };
      return { park, index, ...layout, pond: null };
    }
    const layout = park.layout ?? {}, plaza = layout.plaza ?? null;
    return { park, index, walks: [], plaza: plaza && plaza.kind !== 'pond' ? plaza : null, pond: layout.pond ?? null, loop: layout.loop ?? null };
  });
  return parks;
}

// Whether a point in a park is clear of its walks, plaza and pond by `margin`
export function parkClear(entry, x, y, margin = 3) {
  const p = { x, y };
  if (entry.pond && (insidePolygon(p, entry.pond) || distanceToRing(p, entry.pond) < margin + 4)) return false;
  if (entry.plaza && Math.hypot(x - entry.plaza.x, y - entry.plaza.y) < entry.plaza.radius + SQUARE_WALK + margin) return false;
  for (const walk of entry.walks) if (distanceToPolyline(p, walk) < SQUARE_WALK + margin) return false;
  return true;
}

// The pond's edge, its water a little way down inside it
export const pondShore = pond => offsetPolygon(pond, -.6);
export const parkVariant = (entry, salt) => randomAt(entry.index, salt, CITY.seed);
