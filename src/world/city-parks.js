import { CITY } from './city.js';
import { randomAt } from './route.js';
import { deepestPoint } from '../mapgen/park-paths.js';
import { insidePolygon, distanceToPolyline, offsetPolygon, signedArea, calcPolygonArea, bufferPolyline } from '../mapgen/polygon-util.js';
import { difference, solids } from '../mapgen/booleans.js';

// What stands in each park and square beyond its lawn. A big park's walks
// are streets of the network (see mapgen/park-paths.js); here is its plaza,
// paved round a fountain or a bandstand, or its pond. A square is laid out
// on its own, as one of the city's open-air places (see city-places.js): walks
// in from its corners and the middles of its long sides to a paved circle,
// and in the circle and round it what the square is for. A fountain square
// has its fountain and a cafe's tables, a clocktower square its tower, a
// sculpture garden its sculptures, a botanical garden a glasshouse among
// flower beds, and a market square rows of stalls. Trees line every square's
// edge. A paved square has a promenade under two rows of them all round,
// and lawns between its walks; a lawn has its trees in groves. Trees, lamps
// and benches ask `parkClear` where they may stand.
export const SQUARE_WALK = 1.8;
// The discoveries a square can be, and which of them are paved
export const SQUARE_DESIGNS = ['plaza', 'clock', 'art', 'garden', 'farmersmarket'];
const PAVED = new Set(['plaza', 'clock', 'farmersmarket']);
// Stall awnings and flower beds
export const STALL_COLOURS = ['#c9574a', '#d99a3e', '#4f8a78', '#5b76a8', '#b5577e'];
export const BED_COLOURS = ['#d8586b', '#e7b33f', '#b46fc4', '#f08a4b', '#e9e2d0'];

const circle = (x, y, r, count = 24) => Array.from({ length: count }, (_, k) => ({ x: x + Math.cos(k / count * Math.PI * 2) * r, y: y + Math.sin(k / count * Math.PI * 2) * r }));
const distanceToRing = (p, ring) => distanceToPolyline(p, [...ring, ring[0]]);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// The direction of a polygon's longest edge, which a square's rows follow
function longestAxis(ring) {
  let best = 0, angle = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best) { best = length; angle = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  return angle;
}

// Walks in from the corners (where the edge turns by more than 50 degrees)
// and, in a big square, the middle of every long side, to a circle `radius`
// round the centre; and the circle itself.
function squareWalks(ring, centre, radius, long) {
  const n = ring.length, starts = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], p = ring[i], b = ring[(i + 1) % n];
    const turn = Math.atan2((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y));
    if (turn > .87) starts.push(p);
  }
  if (long) for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 70) starts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const walks = [];
  for (const start of starts) {
    const dx = centre.x - start.x, dy = centre.y - start.y, length = Math.hypot(dx, dy);
    if (length < radius + 6) continue;
    // From just inside the square's edge to the circle
    walks.push([{ x: start.x + dx / length * .5, y: start.y + dy / length * .5 }, { x: centre.x - dx / length * radius, y: centre.y - dy / length * radius }]);
  }
  walks.push([...circle(centre.x, centre.y, radius, 32), circle(centre.x, centre.y, radius, 32)[0]]);
  return walks;
}

// A square too narrow for a circle (a strip between two streets) is a
// linear garden: one walk down the middle of its length, following the strip
// wherever it has room for a walk with lawn either side, from end to end.
function stripWalk(ring, centre, axis) {
  const ux = Math.cos(axis), uy = Math.sin(axis), vx = -uy, vy = ux;
  // The inside of the strip across the axis at `t` along it: the widest span
  const across = t => {
    const bx = centre.x + ux * t, by = centre.y + uy * t, cuts = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const da = (a.x - bx) * ux + (a.y - by) * uy, db = (b.x - bx) * ux + (b.y - by) * uy;
      if ((da < 0) === (db < 0)) continue;
      const k = da / (da - db);
      cuts.push((a.x + (b.x - a.x) * k - bx) * vx + (a.y + (b.y - a.y) * k - by) * vy);
    }
    cuts.sort((a, b) => a - b);
    let best = null;
    for (let i = 0; i + 1 < cuts.length; i += 2) if (!best || cuts[i + 1] - cuts[i] > best.width) best = { width: cuts[i + 1] - cuts[i], x: bx + vx * (cuts[i] + cuts[i + 1]) / 2, y: by + vy * (cuts[i] + cuts[i + 1]) / 2 };
    return best;
  };
  let reach = 0;
  for (const p of ring) reach = Math.max(reach, Math.abs((p.x - centre.x) * ux + (p.y - centre.y) * uy));
  let run = [], best = [];
  for (let t = -reach + .5; t <= reach - .5; t += 2) {
    const span = across(t);
    if (span && span.width >= 2 * SQUARE_WALK + 3) run.push(span);
    else run = [];
    if (run.length > best.length) best = run.slice();
  }
  if (best.length < 8) return [];
  // (straightened between every third sample, where a strip's edges wobble)
  const walk = best.filter((p, i) => i % 3 === 0 || i === best.length - 1).map(({ x, y }) => ({ x, y }));
  if (!insidePolygon(walk[0], ring) || !insidePolygon(walk.at(-1), ring)) return [];
  // and carried on to just inside the edge at each end, to meet the pavement
  for (const end of [0, 1]) {
    const tip = end ? walk.at(-1) : walk[0], back = end ? walk.at(-2) : walk[1];
    const length = Math.hypot(tip.x - back.x, tip.y - back.y) || 1, dx = (tip.x - back.x) / length, dy = (tip.y - back.y) / length;
    let reach = 0;
    while (reach < 12 && insidePolygon({ x: tip.x + dx * (reach + .5), y: tip.y + dy * (reach + .5) }, ring)) reach += .25;
    if (reach >= 12 || reach < .5) continue;
    const out = { x: tip.x + dx * (reach - .25), y: tip.y + dy * (reach - .25) };
    if (end) walk.push(out); else walk.unshift(out);
  }
  return [walk];
}

// Which square is which: a botanical garden and a market in the two roomiest,
// a clocktower in a circus (or the square nearest downtown), a sculpture
// garden, a fountain square, and any more in turn
function assignDesigns(entries) {
  const designs = new Map(), free = entries.filter(e => e.deep && e.deep.distance >= 9);
  const downtown = e => Math.hypot(e.centre.x - CITY.downtown.u, e.centre.y - CITY.downtown.s);
  const roomy = list => list.filter(e => !e.circus).sort((a, b) => b.deep.distance - a.deep.distance);
  const take = (design, choose) => {
    const e = choose(free);
    if (!e) return;
    designs.set(e.index, design);
    free.splice(free.indexOf(e), 1);
  };
  take('garden', list => roomy(list).find(e => e.deep.distance >= 24));
  take('farmersmarket', list => roomy(list).find(e => e.deep.distance >= 20));
  take('clock', list => list.find(e => e.circus) ?? list.slice().sort((a, b) => downtown(a) - downtown(b))[0]);
  take('art', list => list.find(e => e.circus) ?? list[Math.floor(randomAt(list.length, 7411, CITY.seed) * list.length)]);
  take('plaza', list => list.slice().sort((a, b) => downtown(a) - downtown(b))[0]);
  const rest = ['plaza', 'art', 'clock'], turn = Math.floor(randomAt(entries.length, 7412, CITY.seed) * 3);
  free.slice().sort((a, b) => a.index - b.index).forEach((e, i) => designs.set(e.index, e.circus ? 'plaza' : rest[(i + turn) % 3]));
  return designs;
}

// A point `along` the square's axis and `across` it from (x, y)
const onAxis = (x, y, angle, along, across) => ({ x: x + Math.cos(angle) * along - Math.sin(angle) * across, y: y + Math.sin(angle) * along + Math.cos(angle) * across });

export function squareLayout(park, design, index) {
  const lawn = park.lawn;
  if (lawn.length < 3) return null;
  const deep = deepestPoint(lawn);
  const ring = signedArea(lawn) > 0 ? lawn : lawn.slice().reverse();
  if (!deep || deep.distance < 9) {
    const walks = deep && !park.circus ? stripWalk(ring, deep.point, longestAxis(ring)) : [];
    return { design, walks, plaza: null, features: [], panels: [], paved: false };
  }
  const centre = deep.point, d = deep.distance, axis = longestAxis(ring), features = [];
  const random = (salt) => randomAt(index, 7420 + salt, CITY.seed);
  const circus = Boolean(park.circus);
  // The paved circle at the heart of the square, and what stands in it
  let radius;
  if (design === 'farmersmarket') radius = clamp(d * .5, 15, 26);
  else if (design === 'garden') radius = clamp(d * .5, 11, 19);
  else if (design === 'art') radius = clamp(d * .26, 8, 12);
  else radius = clamp(d * .3, 9, circus ? 11 : 15);
  radius = Math.min(radius, d - 4);
  const walks = circus ? [] : squareWalks(ring, centre, radius, d > 22);
  const inner = radius - SQUARE_WALK;
  if (design === 'plaza') {
    const basin = Math.min(inner * .55, 7);
    features.push({ kind: 'fountain', x: centre.x, y: centre.y, size: basin / 3.4, r: basin + .6 });
    // A cafe's tables on the paving, on the side away from the busiest walk
    if (!circus) {
      const turn = axis + Math.PI / 2 + (random(1) < .5 ? 0 : Math.PI);
      for (let k = -1; k <= 1; k++) {
        const p = onAxis(centre.x, centre.y, turn + k * .42, inner - 1.5, 0);
        features.push({ kind: 'cafe', x: p.x, y: p.y, yaw: turn + k * .42, r: 1.8, colour: STALL_COLOURS[(index + k + 3) % STALL_COLOURS.length] });
      }
    }
  } else if (design === 'clock') {
    features.push({ kind: 'clocktower', x: centre.x, y: centre.y, yaw: axis, height: circus ? 14 : 17, r: 4.6 });
    // Four clipped trees in planters on the diagonals round it
    if (!circus && inner > 9) for (let k = 0; k < 4; k++) {
      const p = onAxis(centre.x, centre.y, axis + Math.PI / 4 + k * Math.PI / 2, inner - 2.6, 0);
      features.push({ kind: 'planter', x: p.x, y: p.y, r: 1.4 });
    }
  } else if (design === 'art') {
    // The centrepiece stands in a round pool; smaller works line the walks
    features.push({ kind: 'sculpture', x: centre.x, y: centre.y, yaw: axis, form: Math.floor(random(2) * 4), size: 1, pool: Math.min(inner - .4, 5.4), r: Math.min(inner, 6) });
    let form = Math.floor(random(3) * 4);
    for (const walk of walks.filter(walk => walk.length === 2)) {
      const [a, b] = walk, length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 22) continue;
      const t = .45, tx = (b.x - a.x) / length, ty = (b.y - a.y) / length, side = form % 2 ? 1 : -1;
      const x = a.x + (b.x - a.x) * t - ty * side * 5, y = a.y + (b.y - a.y) * t + tx * side * 5;
      if (!insidePolygon({ x, y }, ring) || distanceToRing({ x, y }, ring) < 5) continue;
      // facing the walk
      features.push({ kind: 'sculpture', x, y, yaw: Math.atan2(ty * side, tx * side), form: form++ % 4, size: .62, r: 2.4 });
    }
  } else if (design === 'garden') {
    // The glasshouse down the square's axis, in its paved circle
    const length = Math.min(inner * 1.62, 30), width = Math.min(inner * .78, 14);
    features.push({ kind: 'glasshouse', x: centre.x, y: centre.y, yaw: axis, w: length, d: width, r: Math.hypot(length, width) / 2 + 1 });
    // Beds of flowers beside the walks
    for (const walk of walks.filter(walk => walk.length === 2)) {
      const [a, b] = walk, length = Math.hypot(b.x - a.x, b.y - a.y), tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
      for (let t = 6; t + 6 < length - 3; t += 10) for (const side of [-1, 1]) {
        const x = a.x + tx * (t + 3) - ty * side * (SQUARE_WALK + 2.2), y = a.y + ty * (t + 3) + tx * side * (SQUARE_WALK + 2.2);
        if (!insidePolygon({ x, y }, ring) || distanceToRing({ x, y }, ring) < 4) continue;
        features.push({ kind: 'bed', x, y, yaw: Math.atan2(ty, tx), w: 6.5, d: 2.2, colour: BED_COLOURS[(features.length + index) % BED_COLOURS.length], r: 3.4 });
      }
    }
  } else if (design === 'farmersmarket') {
    // Rows of stalls across the circle, a bakery's kiosk at one end
    const kiosk = onAxis(centre.x, centre.y, axis, -(inner - 3.4), 0);
    // (its hatch, on its local -x, toward the stalls)
    features.push({ kind: 'kiosk', x: kiosk.x, y: kiosk.y, yaw: axis + Math.PI, r: 3.2 });
    for (let across = -inner + 5; across <= inner - 5; across += 9) for (let along = -inner + 5; along <= inner - 6; along += 6.5) {
      const p = onAxis(centre.x, centre.y, axis, along, across);
      if (Math.hypot(p.x - centre.x, p.y - centre.y) > inner - 3.2 || Math.hypot(p.x - kiosk.x, p.y - kiosk.y) < 7) continue;
      const k = features.length;
      features.push({ kind: 'stall', x: p.x, y: p.y, yaw: axis + (Math.round((across + inner) / 9) % 2 ? Math.PI : 0), colour: STALL_COLOURS[(k + index) % STALL_COLOURS.length], r: 2.4 });
    }
    for (const k of [-1, 1]) {
      const p = onAxis(kiosk.x, kiosk.y, axis, 4.5, k * 4.2);
      features.push({ kind: 'cafe', x: p.x, y: p.y, yaw: axis, r: 1.8, colour: '#f1e6cc' });
    }
  }
  // Nothing out on the lawn stands in the way of another walk
  const straight = walks.filter(walk => walk.length === 2);
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (Math.hypot(f.x - centre.x, f.y - centre.y) < inner) continue;
    const half = f.kind === 'bed' ? f.d / 2 : f.kind === 'sculpture' ? 1.2 : 1.5;
    if (straight.some(walk => distanceToPolyline(f, walk) < SQUARE_WALK + half + .4)) features.splice(i, 1);
  }
  // A paved square's lawns: inside its promenade, between its walks and
  // clear of the circle
  let panels = [];
  if (PAVED.has(design) && !circus && d > 24) {
    const inset = offsetPolygon(ring, -(d > 40 ? 17 : 13));
    if (inset.length >= 3) panels = difference([inset], solids([...walks.filter(walk => walk.length === 2).map(walk => bufferPolyline(walk, SQUARE_WALK + 2.6)),
      circle(centre.x, centre.y, radius + SQUARE_WALK + 4, 32)])).filter(piece => calcPolygonArea(piece.outer) > 90);
  }
  return { design, walks, plaza: { x: centre.x, y: centre.y, radius: inner, kind: design }, features, panels, paved: PAVED.has(design), axis, circus };
}

let parks = null;
export function cityParks() {
  if (parks) return parks;
  const squares = CITY.parkPlans.filter(park => park.square && park.lawn.length >= 3).map(park => {
    const deep = deepestPoint(park.lawn);
    return { index: park.index, deep, centre: deep?.point ?? park.lawn[0], circus: Boolean(park.circus), area: calcPolygonArea(park.lawn) };
  });
  const designs = assignDesigns(squares);
  parks = CITY.parkPlans.map((park, index) => {
    if (park.square) {
      const design = designs.get(index) ?? 'plaza';
      const layout = squareLayout(park, design, index) ?? { design, walks: [], plaza: null, features: [], panels: [], paved: false };
      return { park, index, ...layout, pond: null };
    }
    const layout = park.layout ?? {}, plaza = layout.plaza ?? null;
    return { park, index, design: 'park', walks: [], features: [], panels: [], plaza: plaza && plaza.kind !== 'pond' ? plaza : null, pond: layout.pond ?? null, loop: layout.loop ?? null };
  });
  return parks;
}

// Whether a point in a park is clear of its walks, plaza, pond and whatever
// stands in the square by `margin`
export function parkClear(entry, x, y, margin = 3) {
  const p = { x, y };
  if (entry.pond && (insidePolygon(p, entry.pond) || distanceToRing(p, entry.pond) < margin + 4)) return false;
  if (entry.plaza && Math.hypot(x - entry.plaza.x, y - entry.plaza.y) < entry.plaza.radius + SQUARE_WALK + margin) return false;
  for (const walk of entry.walks) if (distanceToPolyline(p, walk) < SQUARE_WALK + margin) return false;
  for (const feature of entry.features) if (Math.hypot(x - feature.x, y - feature.y) < feature.r + margin) return false;
  return true;
}

// The pond's edge, its water a little way down inside it
export const pondShore = pond => offsetPolygon(pond, -.6);
export const parkVariant = (entry, salt) => randomAt(entry.index, salt, CITY.seed);
