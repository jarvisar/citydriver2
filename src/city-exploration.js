import { CITY, cityDistrict, cityCell, cityStyleDistrict } from './world/city.js';
import { lanePose, nearestLanePose, onRoadAt } from './world/city-route.js';
import { CITY_PLACES, PLACE_TYPES, LANDMARK_TYPES, SPACE_NAMES, VENUE_DISTRICTS } from './world/city-places.js';
import { placeName } from './world/city-businesses.js';
import { navGraph } from './world/nav-graph.js';
import { randomAt } from './world/route.js';
import { landmarkSite, venueFits, venueFootprint, VENUE_SIZE } from './world/landmark-site.js';
import { cityParks } from './world/city-parks.js';
import { averagePoint, calcPolygonArea } from './mapgen/polygon-util.js';
export { routeDistance } from './world/nav-graph.js';

// Places worth a taxi ride. The open-air ones are the city's parks and
// squares, each laid out as what it is (see world/city-parks.js). The rest
// are venues, spread evenly over the city, every kind about as often as the
// next (twice, under two names) and where its district wants it. The grand
// ones (City Hall downtown, the museum, the station, the hospital...) stand in
// a block of their own, in their grounds; a cinema, a club, a hotel, a fire
// station, a post office or a diner takes a lot in a street of other
// buildings. Each place has an entrance on the street beside it.
export const BLOCK_VENUES = new Set(['cityhall', 'museum', 'station', 'hospital', 'library', 'bathhouse', 'market', 'depot', 'sports', 'observatory', 'clock', 'art', 'garden', 'farmersmarket']);
const BLOCK_SPACING = 380, LOT_SPACING = 300, EACH = 2;
let places = null;
const apart = (a, b) => Math.hypot(a.centre.x - b.centre.x, a.centre.y - b.centre.y);

// The kerbside lane of the street nearest `p` (not a park walk), running so
// that `toward` is on the driver's right, a little way along the street if
// that is where it is clear of the junctions
function entranceFacing(p, toward, radius = 60) {
  const road = CITY.roadIndex.nearest(p.x, p.y, radius, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance - segment.road.profile.halfWidth);
  if (!road) return nearestLanePose(toward.y, toward.x, 0, 400);
  const facing = here => lanePose(here, Math.atan2(here.tx, here.ty) + ((toward.x - here.x) * here.ty - (toward.y - here.y) * here.tx >= 0 ? 0 : Math.PI));
  // (well clear of a crossing street's kerb, or if nowhere is, clear of it)
  for (const clear of [14, 6]) for (const along of [0, 6, -6, 12, -12, 18, -18, 24, -24, 30, -30]) {
    const here = CITY.roadIndex.nearest(road.x + road.tx * along, road.y + road.ty * along, 10, (segment, distance) => segment.road === road.road ? distance : Infinity);
    if (!here) continue;
    const pose = facing(here);
    const other = CITY.roadIndex.nearest(pose.u, pose.s, 40, (segment, distance) => segment.road === road.road || segment.road.kind === 'path' ? Infinity : distance - segment.road.profile.halfWidth);
    if (!other || other.score > clear) return pose;
  }
  return facing(road);
}
// Whether a site's front faces a street a car can stop on
const onStreet = site => {
  const x = site.centre.x - site.nx * (site.depth / 2 + 8), y = site.centre.y - site.ny * (site.depth / 2 + 8);
  return Boolean(CITY.roadIndex.nearest(x, y, 16, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance));
};

// The lots a venue could stand on, with the site its building would take
function lotCandidates() {
  const out = [];
  CITY.lots.forEach((lot, index) => {
    if (calcPolygonArea(lot) < 400) return;
    const site = landmarkSite({ polygon: lot, edges: CITY.lotEdges?.[index] });
    if (!site || site.width < 14 || site.depth < 12 || !onStreet(site)) return;
    const score = Math.min(site.width, 42) * Math.min(site.depth, 36) / 60 + calcPolygonArea(site.rect) / calcPolygonArea(lot) * 4 + randomAt(index, 7210, CITY.seed) * 4;
    out.push({ lot: index, polygon: lot, site, score, centre: site.centre, district: cityStyleDistrict(site.centre.y, site.centre.x), salt: index });
  });
  return out;
}
// The blocks a venue could have to itself: a compact block of a middling
// size, not beside a square (City Hall may be bigger, and face one)
function blockCandidates({ most = 11000, fill: least = .6, squares: beside = false } = {}) {
  const out = [], squares = CITY.parkPlans.filter(park => park.square).map(park => ({ centre: averagePoint(park.polygon) }));
  CITY.blocks.forEach((block, index) => {
    if (block.park || !(block.inner?.length >= 3) || !(block.kerb?.length >= 3)) return;
    const area = calcPolygonArea(block.inner);
    if (area < 2800 || area > most) return;
    const site = landmarkSite({ polygon: block.inner });
    if (!site || site.width < 30 || site.depth < 24 || !onStreet(site)) return;
    const fill = calcPolygonArea(site.rect) / area;
    if (fill < least || (!beside && squares.some(square => apart(square, site) < 140))) return;
    const score = 6 - Math.abs(area - 6000) / 1500 + fill * 3 + randomAt(index, 7213, CITY.seed) * 3;
    out.push({ block: index, polygon: block.inner, site, score, centre: site.centre, district: cityStyleDistrict(site.centre.y, site.centre.x), salt: 100000 + index });
  });
  return out;
}
// The best sites, well apart: about `target` of them, as far apart as that
// allows, and `least` from the sites already `taken`
function spread(candidates, target, taken, least) {
  let spacing = least, chosen = [];
  for (let pass = 0; pass < 16; pass++) {
    chosen = [];
    for (const site of candidates) {
      if (taken.some(other => apart(other, site) < least) || chosen.some(other => apart(other, site) < spacing)) continue;
      chosen.push(site);
    }
    if (chosen.length <= target * 1.15) break;
    spacing *= 1.08;
  }
  return chosen;
}

// Deal the kinds of venue out over the sites: a round at a time, each kind
// once a round (the ones needing most room first) on the free site that suits
// it best, so every kind comes up as often as the next. A site left over
// stays an ordinary lot or block.
function assignTypes(sites, types) {
  const assigned = new Map(), free = new Set(sites), count = new Map();
  const demanding = types.slice().sort((a, b) => VENUE_SIZE[b][0] * VENUE_SIZE[b][1] - VENUE_SIZE[a][0] * VENUE_SIZE[a][1]);
  const suits = (site, type) => {
    if (!venueFits(site.site, type)) return -Infinity;
    const home = VENUE_DISTRICTS[site.district]?.includes(type) ? 2 : 0;
    let near = 0;
    for (const [other, t] of assigned) if (t === type && apart(other, site) < 900) near = 3;
    // A demanding kind prefers a big site; a small one leaves it for another
    const [w, d] = VENUE_SIZE[type], room = Math.min(1, site.site.width * site.site.depth / (w * d * 2.5));
    return home - near + room + randomAt(site.salt, 7211 + types.indexOf(type), CITY.seed) * 1.5;
  };
  for (let round = 0; round < EACH && free.size; round++) {
    for (const type of demanding) {
      if ((count.get(type) ?? 0) > round) continue;
      let best = null, bestScore = -Infinity;
      for (const site of free) { const score = suits(site, type); if (score > bestScore) { best = site; bestScore = score; } }
      if (!best) continue;
      assigned.set(best, type); free.delete(best); count.set(type, (count.get(type) ?? 0) + 1);
      if (!free.size) break;
    }
  }
  return assigned;
}

function buildPlaces() {
  const out = [], variants = new Map();
  // Each time a kind comes up again it has the next of its names
  const nextVariant = type => {
    const count = SPACE_NAMES[type]?.length ?? 1, k = variants.get(type) ?? Math.floor(randomAt(PLACE_TYPES.indexOf(type), 7212, CITY.seed) * count);
    variants.set(type, k + 1);
    return k % count;
  };
  const describe = (type, variant) => ({ ...CITY_PLACES[type], design: SPACE_NAMES[type]?.[variant] ?? CITY_PLACES[type].name, name: placeName(type, variant) });
  // The parks and squares, as their layouts make them
  const open = new Set();
  for (const entry of cityParks()) {
    const park = entry.park, type = entry.design ?? 'plaza', variant = nextVariant(type);
    const centre = entry.plaza && park.square ? { x: entry.plaza.x, y: entry.plaza.y } : averagePoint(park.polygon);
    // The drop-off is at a park's gate on its busiest street, or halfway
    // along a square's longest side
    let door;
    const gates = park.layout?.gates ?? [];
    if (gates.length) door = gates.reduce((best, gate) => !best || gate.profile.halfWidth > best.profile.halfWidth ? gate : best, null).street;
    else {
      const ring = park.polygon, length = i => ring[i].distanceTo(ring[(i + 1) % ring.length]);
      let longest = 0;
      for (let i = 1; i < ring.length; i++) if (length(i) > length(longest)) longest = i;
      const a = ring[longest], b = ring[(longest + 1) % ring.length];
      door = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    const entrance = entranceFacing(door, centre);
    if (type !== 'park') open.add(type);
    out.push({ id: `park:${entry.index}`, type, variant, ...describe(type, variant), district: cityDistrict(centre.y, centre.x),
      s: centre.y, u: centre.x, entrance: { s: entrance.s, u: entrance.u, heading: entrance.heading }, park: entry.index });
  }
  // The venues. City Hall has the best block near downtown; the other grand
  // venues blocks well apart across the city, and the rest lots between them.
  const blockTypes = LANDMARK_TYPES.filter(type => type !== 'cityhall' && BLOCK_VENUES.has(type) && !open.has(type));
  const lotTypes = LANDMARK_TYPES.filter(type => !BLOCK_VENUES.has(type));
  const blocks = blockCandidates().sort((a, b) => b.score - a.score || a.salt - b.salt);
  const downtown = site => Math.hypot(site.centre.x - CITY.downtown.u, site.centre.y - CITY.downtown.s);
  let hall = null, hallScore = -Infinity;
  for (const site of blockCandidates({ most: 16000, fill: .5, squares: true })) {
    const score = site.score - downtown(site) / 30;
    if (venueFits(site.site, 'cityhall') && score > hallScore) { hall = site; hallScore = score; }
  }
  const taken = hall ? [hall] : [];
  const grand = spread(blocks.filter(site => site.block !== hall?.block), EACH * blockTypes.length, taken, BLOCK_SPACING);
  const kinds = assignTypes(grand, blockTypes);
  if (hall) kinds.set(hall, 'cityhall');
  taken.push(...grand.filter(site => kinds.has(site)));
  const lotSites = lotCandidates().sort((a, b) => b.score - a.score || a.salt - b.salt);
  const lots = spread(lotSites, EACH * lotTypes.length, taken, LOT_SPACING);
  for (const [site, type] of assignTypes(lots, lotTypes)) kinds.set(site, type);
  // Any kind the dealing left out has the best site that fits it, a little
  // closer to its neighbours if it must be
  const dealt = new Set(kinds.values());
  for (const [types, sites] of [[blockTypes, blocks], [lotTypes, lotSites]]) for (const type of types) {
    if (dealt.has(type)) continue;
    const site = sites.find(site => venueFits(site.site, type) && ![...kinds.keys()].some(other => apart(other, site) < 200 || (other.block !== undefined && other.block === site.block)));
    if (site) { kinds.set(site, type); dealt.add(type); }
  }
  for (const [site, type] of kinds) {
    const variant = type === 'cityhall' ? 0 : nextVariant(type), whole = site.block !== undefined, footprint = venueFootprint(site.site, type, whole);
    // The drop-off is in the kerbside lane of the street the landmark faces,
    // running so the building is on the driver's right
    const reach = footprint.setback + 10, door = { x: footprint.front.x - footprint.nx * reach, y: footprint.front.y - footprint.ny * reach };
    const entrance = entranceFacing(door, footprint.front, 30);
    out.push({ id: whole ? `block:${site.block}` : `lot:${site.lot}`, type, variant, ...describe(type, variant), district: cityDistrict(site.centre.y, site.centre.x),
      s: footprint.centre.y, u: footprint.centre.x, entrance: { s: entrance.s, u: entrance.u, heading: entrance.heading },
      ...(whole ? { block: site.block } : { lot: site.lot }), polygon: site.polygon, footprint });
  }
  return out;
}
export function cityPlaces() { return places ??= buildPlaces(); }
let byLot = null, byBlock = null;
export function placeForLot(index) {
  byLot ??= new Map(cityPlaces().filter(place => place.lot !== undefined).map(place => [place.lot, place]));
  return byLot.get(index) ?? null;
}
// The venue that has a whole block to itself, if one has
export function placeForBlock(index) {
  byBlock ??= new Map(cityPlaces().filter(place => place.block !== undefined).map(place => [place.block, place]));
  return byBlock.get(index) ?? null;
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
