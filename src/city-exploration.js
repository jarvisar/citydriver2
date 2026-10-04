import { CITY, cityDistrict, cityCell, cityStyleDistrict } from './world/city.js';
import { lanePose, nearestLanePose, waterAt } from './world/city-route.js';
import { navGraph } from './world/nav-graph.js';
import { CITY_PLACES, PLACE_TYPES, LANDMARK_TYPES, SPACE_NAMES, VENUE_DISTRICTS, NOT_IN_GARDENS } from './world/city-places.js';
import { placeName } from './world/city-businesses.js';
import { randomAt } from './world/route.js';
import { landmarkSite, venueFits, venueFootprint, VENUE_SIZE, PAVED_DISTRICTS } from './world/landmark-site.js';
import { cityParks } from './world/city-parks.js';
import { averagePoint, calcPolygonArea, polygonCentroid, interiorPoint, insidePolygon, distanceToPolyline } from './mapgen/polygon-util.js';

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

// The curbside lane of the street nearest `p` (not a park walk), running so
// that `toward` is on the driver's right, a little way along the street if
// that is where it is clear of the junctions. Given the way a building faces
// (`normal`, into its site), only a street running along its front will do,
// not one crossing it at the corner.
function entranceFacing(p, toward, radius = 60, normal = null) {
  const across = segment => normal && Math.abs(segment.dx * normal.x + segment.dy * normal.y) > segment.length * .7;
  const road = CITY.roadIndex.nearest(p.x, p.y, radius, (segment, distance) => segment.road.kind === 'path' || across(segment) ? Infinity : distance - segment.road.profile.halfWidth);
  if (!road) return nearestLanePose(toward.y, toward.x, 0, 400);
  const facing = here => lanePose(here, Math.atan2(here.tx, here.ty) + ((toward.x - here.x) * here.ty - (toward.y - here.y) * here.tx >= 0 ? 0 : Math.PI));
  // (well clear of a crossing street's curb, or if nowhere is, clear of it)
  for (const clear of [14, 6]) for (const along of [0, 6, -6, 12, -12, 18, -18, 24, -24, 30, -30]) {
    const here = CITY.roadIndex.nearest(road.x + road.tx * along, road.y + road.ty * along, 10, (segment, distance) => segment.road === road.road ? distance : Infinity);
    if (!here) continue;
    const pose = facing(here);
    const other = CITY.roadIndex.nearest(pose.u, pose.s, 40, (segment, distance) => segment.road === road.road || segment.road.kind === 'path' ? Infinity : distance - segment.road.profile.halfWidth);
    if (!other || other.score > clear) return pose;
  }
  return facing(road);
}
// A venue faces the busiest street along its lot or block, on its longest
// stretch of that. The longest side alone is most often a side street: three
// in four venues with a block to themselves had their fronts round the corner
// from an avenue running down their flank.
const STREET_RANK = { main: 3, ring: 3, major: 2, coast: 2, riverbank: 2 };
function busiest(polygon) {
  let longest = 0;
  for (let i = 0; i < polygon.length; i++) longest = Math.max(longest, polygon[i].distanceTo(polygon[(i + 1) % polygon.length]));
  return (a, b) => {
    const length = a.distanceTo(b);
    // (a short edge, a corner's chamfer say, only on its length)
    if (length < Math.min(30, longest * .5)) return length;
    const road = CITY.roadIndex.nearest((a.x + b.x) / 2, (a.y + b.y) / 2, 24, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance);
    return (road ? STREET_RANK[road.road.kind] ?? 1 : 0) * 1000 + length;
  };
}
function facingBusiest(site, type) {
  const turned = landmarkSite({ polygon: site.polygon, edges: site.lot !== undefined ? CITY.lotEdges?.[site.lot] : undefined }, busiest(site.polygon));
  const fits = turned && venueFits(turned, type) && onStreet(turned) && (site.block === undefined || (turned.width >= 30 && turned.depth >= 24));
  return fits ? turned : site.site;
}
// Where a square's riders get out: at the end of one of its walks, the one
// nearest the middle of its side on the busiest street round it (they got out
// halfway along its longest side, up to 86 m from any way in). On a circus's
// island, midway between the streets meeting the circus, since a stop
// between two of them is all a circus has room for.
function squareDoor(entry, centre) {
  const ring = entry.park.polygon, score = busiest(ring);
  let side = 0, best = -Infinity;
  for (let i = 0; i < ring.length; i++) { const value = score(ring[i], ring[(i + 1) % ring.length]); if (value > best) { side = i; best = value; } }
  const a = ring[side], b = ring[(side + 1) % ring.length], middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const ends = entry.walks.filter(walk => walk.length === 2).map(walk => walk[0]);
  if (entry.circus) {
    if (ends.length < 2) return middle;
    const angles = ends.map(p => Math.atan2(p.y - centre.y, p.x - centre.x)).sort((p, q) => p - q);
    let gap = -1, at = 0;
    angles.forEach((angle, i) => { const next = angles[i + 1] ?? angles[0] + Math.PI * 2; if (next - angle > gap) { gap = next - angle; at = angle + gap / 2; } });
    const reach = Math.max(...entry.park.lawn.map(p => Math.hypot(p.x - centre.x, p.y - centre.y)));
    return { x: centre.x + Math.cos(at) * reach, y: centre.y + Math.sin(at) * reach };
  }
  // (on the street's own line beside the walk, so that the stop is on that street, not round the corner)
  const onSide = p => { const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return { x: a.x + dx * t, y: a.y + dy * t }; };
  const near = ends.filter(p => { const q = onSide(p); return Math.hypot(q.x - p.x, q.y - p.y) < 30; });
  if (!near.length) return middle;
  return onSide(near.reduce((best, p) => Math.hypot(p.x - middle.x, p.y - middle.y) < Math.hypot(best.x - middle.x, best.y - middle.y) ? p : best));
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
// allows, and `least` from the sites already `taken`. A city short of sites
// (an old town of narrow plots) has them closer, down to `floor`.
function spread(candidates, target, taken, least, floor = least) {
  const pick = spacing => {
    const chosen = [];
    for (const site of candidates) {
      if (taken.some(other => apart(other, site) < Math.min(least, spacing)) || chosen.some(other => apart(other, site) < spacing)) continue;
      chosen.push(site);
    }
    return chosen;
  };
  let spacing = least, chosen = pick(spacing);
  for (let pass = 0; pass < 16 && chosen.length > target * 1.15; pass++) chosen = pick(spacing *= 1.08);
  while (chosen.length < target * .8 && spacing > floor) chosen = pick(spacing = Math.max(floor, spacing * .92));
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
    const home = VENUE_DISTRICTS[site.district]?.includes(type) ? 2 : site.district === 'Garden quarter' && NOT_IN_GARDENS.has(type) ? -2 : 0;
    let near = 0;
    for (const [other, t] of assigned) if (t === type && apart(other, site) < 900) near = 3;
    // A demanding kind prefers a big site; a small one leaves it for another
    const [w, d] = VENUE_SIZE[type], room = Math.min(1, site.site.width * site.site.depth / (w * d * 2.5));
    return home - near + room + randomAt(site.salt, 7211 + types.indexOf(type), CITY.seed) * 1.5;
  };
  // (the second round starts from a different kind in each city: dealt
  // biggest first every time, the observatory and the library were the
  // ones left with a single site in most cities)
  const start = Math.floor(randomAt(types.length, 7215, CITY.seed) * types.length);
  for (let round = 0; round < EACH && free.size; round++) {
    for (const type of round ? [...demanding.slice(start), ...demanding.slice(0, start)] : demanding) {
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
    const park = entry.park, type = entry.design ?? 'plaza', variant = type === 'plaza' ? 0 : nextVariant(type);
    // (a park's middle is the middle of its ground, not the average of its
    // outline's points, which crowd round a bend: on a big park the drop-off
    // was hundreds of meters from where the map showed it)
    const middle = polygonCentroid(park.polygon);
    const centre = entry.plaza && park.square ? { x: entry.plaza.x, y: entry.plaza.y } : insidePolygon(middle, park.polygon) ? middle : interiorPoint(park.polygon);
    // The drop-off is at a park's gate on its busiest street, or at a
    // square's way in (see squareDoor)
    let door;
    const gates = park.layout?.gates ?? [];
    if (gates.length) door = gates.reduce((best, gate) => !best || gate.profile.halfWidth > best.profile.halfWidth ? gate : best, null).street;
    else door = squareDoor(entry, centre);
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
  const lots = spread(lotSites, EACH * lotTypes.length, taken, LOT_SPACING, 200);
  for (const [site, type] of assignTypes(lots, lotTypes)) kinds.set(site, type);
  // Any kind the dealing left out has the best site that fits it, closer to
  // its neighbors the fewer sites there are
  const dealt = new Set(kinds.values());
  for (const [types, sites] of [[blockTypes, blocks], [lotTypes, lotSites]]) for (const type of types) {
    for (const least of [200, 175, 155]) {
      if (dealt.has(type)) break;
      const site = sites.find(site => venueFits(site.site, type) && ![...kinds.keys()].some(other => apart(other, site) < least || (other.block !== undefined && other.block === site.block)));
      if (site) { kinds.set(site, type); dealt.add(type); }
    }
  }
  // and a kind of shop or hall dealt only once, where the lots were too small
  // for it (an old town's narrow plots), has a second site if one fits
  for (const type of lotTypes) {
    if ([...kinds.values()].filter(t => t === type).length >= EACH) continue;
    for (const least of [LOT_SPACING, 250, 200]) {
      const site = lotSites.find(site => !kinds.has(site) && venueFits(site.site, type) && ![...kinds.keys()].some(other => apart(other, site) < least));
      if (site) { kinds.set(site, type); break; }
    }
  }
  for (const [site, type] of kinds) {
    const variant = type === 'cityhall' ? 0 : nextVariant(type), whole = site.block !== undefined, footprint = venueFootprint(facingBusiest(site, type), type, whole, !whole && PAVED_DISTRICTS.has(site.district));
    // The drop-off is in the curbside lane of the street the landmark faces,
    // running so the building is on the driver's right
    const reach = footprint.setback + 10, door = { x: footprint.front.x - footprint.nx * reach, y: footprint.front.y - footprint.ny * reach };
    const entrance = entranceFacing(door, footprint.front, 30, { x: footprint.nx, y: footprint.ny });
    out.push({ id: whole ? `block:${site.block}` : `lot:${site.lot}`, type, variant, ...describe(type, variant), district: cityDistrict(site.centre.y, site.centre.x),
      s: footprint.centre.y, u: footprint.centre.x, entrance: { s: entrance.s, u: entrance.u, heading: entrance.heading },
      ...(whole ? { block: site.block } : { lot: site.lot }), polygon: site.polygon, footprint });
  }
  namePlazas(out);
  return out;
}
// A fountain square takes its name from what is round it: Station Square by
// a station, Market Square by a market or in the Market district, Old Town
// Square in the old town, Harbor Square on the harbor front, and otherwise
// Fountain or Jubilee Square. (The names were dealt in turn, and a Station
// Square stood by a station in 1 city of 19.) The nearest claim wins a name.
const PLAZA = { fountain: 0, market: 1, oldTown: 2, station: 3, harbour: 4, jubilee: 5 };
function namePlazas(places) {
  const wants = [], nearest = (place, types) => Math.min(Infinity, ...places.filter(other => types.includes(other.type)).map(other => Math.hypot(other.s - place.s, other.u - place.u)));
  for (const place of places.filter(place => place.type === 'plaza')) {
    const style = cityStyleDistrict(place.s, place.u), station = nearest(place, ['station']), market = nearest(place, ['market', 'farmersmarket']);
    if (station < 320) wants.push([place, PLAZA.station, station]);
    if (market < 320) wants.push([place, PLAZA.market, market]);
    if (style === 'Market district') wants.push([place, PLAZA.market, 400]);
    if (style === 'Old town') wants.push([place, PLAZA.oldTown, 400]);
    if (place.district === 'Harbor') wants.push([place, PLAZA.harbour, 450]);
    wants.push([place, PLAZA.fountain, 1000], [place, PLAZA.jubilee, 1100]);
  }
  const named = new Set(), taken = new Set();
  for (const [place, variant] of wants.sort((a, b) => a[2] - b[2])) {
    if (named.has(place) || taken.has(variant)) continue;
    named.add(place); taken.add(variant);
    Object.assign(place, { variant, design: SPACE_NAMES.plaza[variant], name: placeName('plaza', variant) });
  }
}
export function cityPlaces() { return places ??= buildPlaces(); }

// Where a place's riders can get out: a stretch of the curbside lane through
// its entrance. The cab can stop anywhere near it. A building's stretch covers
// the middle half of its front. A park's or square's runs along its side of
// the street as far as its curb goes, up to OPEN_REACH each way from the gate.
// Stretches stay on one street and stop short of junctions and water.
export const OPEN_REACH = 40;
const STRETCH_STEP = 2, JUNCTION_CLEAR = 14;
const stretches = new WeakMap(), measured = new WeakMap();
export function dropOffStretch(place) {
  if (stretches.has(place)) return stretches.get(place);
  const e = place.entrance, stretch = [{ s: e.s, u: e.u }];
  stretches.set(place, stretch);
  const hit = CITY.roadIndex.nearest(e.u, e.s, 30, (segment, distance) => segment.road.kind === 'path' ? Infinity : distance);
  if (!hit) return stretch;
  // Walk the whole road, not a nav edge: a park's gates split its street into
  // short edges
  const road = hit.road, points = road.points;
  if (!measured.has(road)) {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    measured.set(road, { points, cumulative, length: cumulative.at(-1), closed: Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < .01 });
  }
  const line = measured.get(road), start = line.cumulative[hit.segment.index] + hit.t * hit.segment.length;
  // The entrance's lane offset, positive to the right of the road's direction
  const lane = (e.u - hit.x) * hit.ty - (e.s - hit.y) * hit.tx, side = Math.sign(lane) || 1;
  const kerb = place.park !== undefined ? CITY.parkPlans[place.park]?.kerb : null;
  const reach = kerb ? OPEN_REACH : (place.footprint?.width ?? 0) / 4;
  const open = along => {
    if (line.closed) along = (along % line.length + line.length) % line.length;
    else if (along < 0 || along > line.length) return null;
    const p = navGraph().pose(line, along, 1, lane);
    if (waterAt(p.s, p.u)) return null;
    const crossing = CITY.roadIndex.nearest(p.u, p.s, 40, (segment, distance) => segment.road === road || segment.road.kind === 'path' ? Infinity : distance - segment.road.profile.halfWidth);
    // (a circus's streets meet it every forty meters or so: half as far clear of them)
    if (crossing && crossing.score <= (road.circus ? JUNCTION_CLEAR / 2 : JUNCTION_CLEAR)) return null;
    // A park's or square's curb must be beside the lane
    const out = side * (road.profile.halfWidth + 3) - lane;
    if (kerb && !insidePolygon({ x: p.u + p.ty * out, y: p.s - p.tx * out }, kerb)) return null;
    return { s: p.s, u: p.u };
  };
  for (const way of [-1, 1]) for (let step = STRETCH_STEP; step <= reach; step += STRETCH_STEP) {
    const p = open(start + way * step);
    if (!p) break;
    if (way < 0) stretch.unshift(p); else stretch.push(p);
  }
  return stretch;
}
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
// A place is found by passing it: near its outline or on it, or near its
// drop-off. A park, a square or a venue with a block to itself has streets
// all round, so from the far lane of a boulevard beside it (WIDE_REACH) is
// fine. A venue on a lot is found only from its own street (FIND_REACH): its
// block's back street is a lot or two further. It used to be within 69 m of a
// place's middle, which a big park's streets never came near, and which a
// small venue's reached from the next street over.
export const FIND_REACH = 16, WIDE_REACH = 26;
const outlines = new WeakMap();
function outline(place) {
  if (outlines.has(place)) return outlines.get(place);
  const plan = place.park !== undefined ? CITY.parkPlans[place.park] : null;
  const ring = plan ? plan.kerb?.length >= 3 ? plan.kerb : plan.polygon : place.polygon;
  let shape = null;
  if (ring?.length >= 3) {
    const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
    shape = { ring, loop: [...ring, ring[0]], left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
  }
  outlines.set(place, shape);
  return shape;
}
export function passing(place, s, u, reach = place.lot !== undefined ? FIND_REACH : WIDE_REACH) {
  if (Math.hypot(place.entrance.s - s, place.entrance.u - u) <= 24) return true;
  const shape = outline(place);
  if (!shape) return Math.hypot(place.s - s, place.u - u) <= 69;
  if (u < shape.left - reach || u > shape.right + reach || s < shape.bottom - reach || s > shape.top + reach) return false;
  const p = { x: u, y: s };
  return insidePolygon(p, shape.ring) || distanceToPolyline(p, shape.loop) <= reach;
}
export class CityExploration {
  // The discoveries last for the visit: through every taxi run and free
  // drive, but not a reload. `found` holds the kinds of place (the notebook's
  // stamps), `seen` every place by id.
  constructor() {
    this.found = new Set(); this.seen = new Set(); this.places = []; this.cell = null;
  }
  // The places near the car, looked up again only when it changes cell.
  // Someone on foot or up in the air (`anywhere`) also finds them from
  // anywhere near their middle, as before.
  update(s, u, active = true, anywhere = false) {
    const cell = cityCell(s, u).key;
    if (this.cell !== cell) { this.cell = cell; this.places = nearbyPlaces(s, u); }
    if (!active) return [];
    const discoveries = [];
    for (const place of this.places) {
      if (this.seen.has(place.id)) continue;
      if (!passing(place, s, u) && !(anywhere && Math.hypot(place.s - s, place.u - u) <= 69)) continue;
      discoveries.push(this.mark(place));
    }
    return discoveries;
  }
  // A taxi's drop-off finds its place too, wherever the cab stopped
  arrive(id) {
    const place = cityPlaces().find(each => each.id === id);
    return place && !this.seen.has(place.id) ? [this.mark(place)] : [];
  }
  mark(place) {
    this.seen.add(place.id);
    const first = !this.found.has(place.type);
    this.found.add(place.type);
    return { place, first };
  }
}
