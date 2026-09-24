import { CITY, cityDistrict, cityCell } from './world/city.js';
import { nearestLanePose, roadAt, onRoadAt } from './world/city-route.js';
import { CITY_PLACES, PLACE_TYPES, LANDMARK_TYPES, REPEATING_LANDMARK_TYPES, SPACE_NAMES } from './world/city-places.js';
import { venueBrand } from './world/city-businesses.js';
import { navGraph, routeDistance } from './world/nav-graph.js';
import { randomAt } from './world/route.js';
import { averagePoint, calcPolygonArea, polygonBounds } from './mapgen/polygon-util.js';
import { landmarkSite } from './world/landmark-site.js';
export { routeDistance } from './world/nav-graph.js';

// Places worth a taxi ride: one venue in every 300 m of the city, on its
// biggest lot, plus every park. Each has an entrance on the street beside it.
const PLACE_CELL = 300;
let places = null;
function buildPlaces() {
  const cells = new Map();
  CITY.lots.forEach((lot, index) => {
    const centre = averagePoint(lot), area = calcPolygonArea(lot);
    if (area < 500) return;
    const key = `${Math.floor(centre.x / PLACE_CELL)},${Math.floor(centre.y / PLACE_CELL)}`;
    const best = cells.get(key);
    if (!best || area > best.area) cells.set(key, { lot, index, centre, area });
  });
  const out = [];
  let count = 0;
  for (const [key, { lot, index, centre }] of [...cells.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [cx, cz] = key.split(',').map(Number);
    const type = count === 0 ? 'cityhall' : REPEATING_LANDMARK_TYPES[Math.floor(randomAt(cx, cz + 7202, CITY.seed) * REPEATING_LANDMARK_TYPES.length)];
    const variant = Math.floor(randomAt(cx, cz + 7203, CITY.seed) * (SPACE_NAMES[type]?.length ?? 1));
    // The drop-off is in the kerbside lane of the street the landmark faces,
    // running so the building is on the driver's right
    const site = landmarkSite({ polygon: lot, edges: CITY.lotEdges?.[index] });
    const entrance = site ? nearestLanePose(site.centre.y - site.ny * (site.depth / 2 + 10), site.centre.x - site.nx * (site.depth / 2 + 10), Math.atan2(-site.tx, -site.ty), 60)
      : nearestLanePose(centre.y, centre.x, 0, 120);
    out.push({ id: `lot:${index}`, type, variant, ...CITY_PLACES[type], design: SPACE_NAMES[type]?.[variant] ?? CITY_PLACES[type].name,
      name: venueBrand(type, variant)?.name ?? CITY_PLACES[type].name, district: cityDistrict(centre.y, centre.x),
      s: centre.y, u: centre.x, entrance: { s: entrance.s, u: entrance.u, heading: entrance.heading }, lot: index });
    count++;
  }
  CITY.parks.forEach((park, index) => {
    const centre = averagePoint(park), bounds = polygonBounds(park);
    const type = bounds.maxX - bounds.minX > 250 || bounds.maxY - bounds.minY > 250 ? 'park' : 'plaza';
    const variant = index % SPACE_NAMES[type].length;
    const entrance = nearestLanePose(centre.y, centre.x, 0, 400);
    out.push({ id: `park:${index}`, type, variant, ...CITY_PLACES[type], design: SPACE_NAMES[type][variant], name: SPACE_NAMES[type][variant],
      district: cityDistrict(centre.y, centre.x), s: centre.y, u: centre.x, entrance: { s: entrance.s, u: entrance.u, heading: entrance.heading }, park: index });
  });
  return out;
}
export function cityPlaces() { return places ??= buildPlaces(); }
let byLot = null;
export function placeForLot(index) {
  byLot ??= new Map(cityPlaces().filter(place => place.lot !== undefined).map(place => [place.lot, place]));
  return byLot.get(index) ?? null;
}
export function nearbyPlaces(s, u, radius = 8) {
  const reach = radius * 112;
  return cityPlaces().filter(place => Math.hypot(place.s - s, place.u - u) <= reach)
    .sort((a, b) => Math.hypot(a.s - s, a.u - u) - Math.hypot(b.s - s, b.u - u) || a.id.localeCompare(b.id));
}
// The drive to a place ends on the street beside its entrance.
export function placeRoute(s, u, place) {
  if (!place) return [];
  return navGraph().route({ s, u }, place.entrance);
}

export class CityExploration {
  constructor(storage = null) {
    this.storage = storage; this.key = 'citydriver-city-notebook-v1';
    this.found = new Set(); this.target = null; this.places = []; this.cell = null;
    this.justArrived = null;
    try {
      const saved = JSON.parse(storage?.getItem(this.key) ?? '[]');
      if (Array.isArray(saved)) for (const type of saved) if (PLACE_TYPES.includes(type)) this.found.add(type);
    } catch { /* Exploration also works with storage disabled. */ }
  }
  refresh(s, u) {
    const cell = cityCell(s, u).key;
    if (this.cell !== cell) {
      this.cell = cell; this.places = nearbyPlaces(s, u);
      if (this.target && this.target.type !== 'cityhall' && Math.hypot(this.target.s - s, this.target.u - u) > 4000) this.target = null;
    }
    if (!this.target) this.target = this.places.find(p => !this.found.has(p.type)) ?? this.places[0] ?? null;
  }
  next(s, u, type = null) {
    this.refresh(s, u);
    const choices = [...this.places].sort((a, b) => Math.hypot(a.s - s, a.u - u) - Math.hypot(b.s - s, b.u - u));
    const selected = type ? choices.find(p => p.type === type) ?? cityPlaces().find(p => p.type === type) ?? null
      : choices[(choices.findIndex(p => p.id === this.target?.id) + 1) % choices.length];
    if (!selected) return null;
    this.target = selected;
    this.justArrived = null;
    return this.target;
  }
  update(s, u, active = true) {
    this.refresh(s, u);
    if (!active) return [];
    const discoveries = [];
    if (onRoadAt(s, u)) for (const place of this.places) {
      if (Math.hypot(place.s - s, place.u - u) > 69 && Math.hypot(place.entrance.s - s, place.entrance.u - u) > 24) continue;
      if (place.id === this.target?.id) this.justArrived = place;
      if (this.found.has(place.type)) continue;
      this.found.add(place.type); discoveries.push(place);
    }
    if (discoveries.length) {
      try { this.storage?.setItem(this.key, JSON.stringify([...this.found])); } catch { /* Keep stamps for this visit. */ }
    }
    if (this.justArrived && Math.hypot(this.justArrived.s - s, this.justArrived.u - u) > 125) {
      const previous = this.justArrived.id;
      this.target = this.places.find(p => !this.found.has(p.type)) ?? this.places.find(p => p.id !== previous) ?? null;
      this.justArrived = null;
    }
    return discoveries;
  }
}
