import { CITY, cityStyleDistrict } from './city.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL, waterAt } from './city-route.js';
import { navGraph } from './nav-graph.js';
import { randomAt } from './route.js';
import { cityParks, parkClear } from './city-parks.js';
import { yardDrive } from './city-yards.js';
import { cityPlaces } from '../city-exploration.js';
import { insidePolygon, distanceToPolyline, polygonBounds, calcPolygonArea } from '../mapgen/polygon-util.js';

// Things to jump (see CarAir), placed once a city from its streets, parks and
// river, each where it makes sense:
//   - a loading ramp left in a parking bay in the warehouse district, facing
//     the traffic on its side of the street, with the bays either side kept
//     clear for a run at it and somewhere to come down
//   - mounds on a park's open lawn, clear of its walks, trees and pond
//   - the river jump: a half-built bridge off the end of a street that runs
//     straight at the river, reaching out over the water toward the far bank
// Each is a collider with a sloping top (`shape`, see shapeHeight in
// collision.js) that cars, people, loose pieces and the helicopter all stand
// on, and a `jump` the game names and counts. Placed from hashes of where
// they are, never the city's shared random stream.

// A loading ramp: its width, the slope's run and rise, how much steeper it
// gets toward its lip, and the level top beyond it
const LOADING = { width: 3.2, run: 6.5, rise: 1.3, curve: .35, flat: 1.6 };
// How much straight curb it wants behind it (a run at it) and ahead (to come
// down on), how far from either end of its street, and from the next one
const RUN_IN = 34, LAND = 30, END = 26, SPACING = 240, LOADING_MOST = 5;
// The river jump: its width, how far it reaches out over the water, its rise
// (a parabola, level at its foot and steepest at the lip) and the widest gap
// to the far bank it will ask a car to clear
const RIVER = { width: 5.4, over: 22, rise: 4.2, curve: 1 }, RIVER_GAP = [36, 74], RUN_UP = 90;
// Mounds: a park's open lawn gets one for every MOUND_AREA m² of it, at most
// MOUND_MOST, MOUND_APART meters apart
const MOUND_AREA = 5500, MOUND_MOST = 4, MOUND_APART = 34;

let planned = null;
// The city's jumps: `sites` (each placed piece and its collider) and `zones`,
// outlines nothing else is put in (the bays either side of a loading ramp,
// the promenade under the river jump and the water it crosses)
export function cityJumps() {
  if (planned) return planned;
  const nav = navGraph(), sites = [], zones = [];
  for (const site of [...loadingRamps(nav), ...riverJump(nav), ...mounds()]) {
    sites.push(site);
    for (const outline of site.keep) zones.push({ outline, bounds: polygonBounds(outline) });
  }
  sites.forEach((site, index) => { site.id = index; });
  planned = { sites, zones };
  return planned;
}
// Whether (u, s) is in a jump's zone, where nothing else stands
export function inJumpZone(u, s) {
  const p = { x: u, y: s };
  return cityJumps().zones.some(({ outline, bounds }) => u >= bounds.minX && u <= bounds.maxX && s >= bounds.minY && s <= bounds.maxY && insidePolygon(p, outline));
}

// A rectangle `length` along (ju, js) from (u, s) and `width` across it, as
// map points ({ x: u, y: s }), and grown by `margin` all round
function strip(u, s, ju, js, length, width, margin = 0) {
  const ru = js, rs = -ju, half = width / 2 + margin;
  const at = (along, across) => ({ x: u + ju * along + ru * across, y: s + js * along + rs * across });
  return [at(-margin, -half), at(-margin, half), at(length + margin, half), at(length + margin, -half)];
}
// A ramp's collider shape (see shapeHeight), from its foot (u, s) up (ju, js)
function rampShape(u, s, ju, js, { run, rise, curve, flat }, base) {
  return { kind: 'ramp', x: u, z: -s, dx: ju, dz: -js, run, rise, curve, flat, base };
}
// Whether an edge runs straight (within `tolerance` radians) from `from` to `to` along it
function straight(nav, edge, from, to, tolerance = .05) {
  const first = nav.pose(edge, from, 1, 0);
  for (let d = from + 4; d <= to; d += 4) {
    const p = nav.pose(edge, Math.min(d, to), 1, 0);
    if (first.tx * p.tx + first.ty * p.ty < Math.cos(tolerance)) return false;
  }
  return true;
}
// Where a jump is, for its name in the notebook: the nearest place within
// reach that no other jump is named by, else its district
function whereabouts(u, s, used) {
  let best = null, nearest = 320;
  for (const place of cityPlaces()) {
    const d = Math.hypot(place.u - u, place.s - s);
    if (d < nearest && !used.has(place.name)) { nearest = d; best = place; }
  }
  let name = best ? best.name : cityStyleDistrict(s, u);
  for (let n = 2; used.has(name); n++) name = `${best ? best.name : cityStyleDistrict(s, u)} ${n}`;
  used.add(name);
  return name;
}

// Loading ramps in the parking bays of the warehouse district's straight
// streets, clear of driveways, park gates and the venues' doors
function loadingRamps(nav) {
  const entrances = cityPlaces().map(place => place.entrance);
  const mouths = CITY.blocks.map(block => yardDrive(block.index)).filter(Boolean);
  const gates = (CITY.parkLayouts ?? []).flatMap(layout => layout.gates.map(gate => gate.street));
  const length = LOADING.run + LOADING.flat, candidates = [];
  for (const edge of nav.edges) {
    const profile = edge.profile;
    if (!profile.parking || edge.kind === 'path' || edge.length < 2 * END + RUN_IN + length + LAND) continue;
    const middle = nav.pose(edge, edge.length / 2, 1, 0);
    if (cityStyleDistrict(middle.s, middle.u) !== 'Warehouse district') continue;
    // (in the bay, its outer edge at the curb)
    const across = profile.halfWidth - LOADING.width / 2;
    // Its foot `a` along the edge, the traffic on its side (`side`) going the
    // way the edge runs or against it: a run at it behind, room to land ahead
    for (const side of [1, -1]) for (let a = END; a <= edge.length - END; a += 8) {
      const lo = side > 0 ? a - RUN_IN : a - length - LAND, hi = side > 0 ? a + length + LAND : a + RUN_IN;
      if (lo < END || hi > edge.length - END || !straight(nav, edge, lo, hi)) continue;
      const p = nav.pose(edge, a, 1, 0), u = p.u + p.ty * side * across, s = p.s - p.tx * side * across;
      const ju = p.tx * side, js = p.ty * side, d = a;
      const keep = strip(u - ju * RUN_IN, s - js * RUN_IN, ju, js, RUN_IN + length + LAND, 3.4);
      const clear = point => !entrances.some(e => Math.hypot(e.u - point.x, e.s - point.y) < 22)
        && !gates.some(g => Math.hypot(g.x - point.x, g.y - point.y) < 16)
        && !mouths.some(m => Math.hypot(m.mouth.x - point.x, m.mouth.y - point.y) < m.width / 2 + 9)
        && !waterAt(point.y, point.x);
      if (!keep.every(clear) || !clear({ x: u + ju * length / 2, y: s + js * length / 2 })) continue;
      candidates.push({ edge, u, s, ju, js, keep, score: randomAt(edge.id * 131 + Math.round(d), side > 0 ? 7501 : 7502, CITY.seed) });
    }
  }
  const chosen = [];
  for (const c of candidates.sort((a, b) => a.score - b.score)) {
    if (chosen.length >= LOADING_MOST) break;
    if (chosen.some(o => Math.hypot(o.u - c.u, o.s - c.s) < SPACING)) continue;
    chosen.push(c);
  }
  const used = new Set();
  return chosen.map(({ u, s, ju, js, keep }) => ({
    kind: 'loading', name: 'Loading ramp', where: whereabouts(u, s, used), u, s, heading: Math.atan2(ju, js),
    outline: strip(u, s, ju, js, length, LOADING.width), shape: rampShape(u, s, ju, js, LOADING, ROAD_LEVEL), top: ROAD_LEVEL + LOADING.rise,
    // (a car at its top speed reaches the first, boosted the second, and a
    // cab flat out the third)
    size: LOADING, keep: [keep], stars: [30, 50, 70],
    runup: { u: u - ju * RUN_IN, s: s - js * RUN_IN, heading: Math.atan2(ju, js) },
  }));
}

// The river jump, off the end of a street running straight at the river:
// across the bank road, up over the promenade and out over the water, with
// the far bank near enough to reach at a taxi's speed
function riverJump(nav) {
  if (!CITY.hasRiver) return [];
  const bank = new Set(nav.edges.filter(edge => edge.kind === 'riverbank'));
  if (!bank.size) return [];
  const bridges = (CITY.bridges ?? []).map(bridge => bridge.points);
  const candidates = [];
  for (const node of nav.nodes) {
    const along = node.edges.find(edge => bank.has(edge));
    if (!along) continue;
    for (const edge of node.edges) {
      if (bank.has(edge) || edge.kind === 'path' || edge.kind === 'riverbank' || edge.length < RUN_UP + 10) continue;
      // The street's last stretch, coming up to the bank road
      const end = edge.a === node.id ? 0 : edge.length, toward = end ? 1 : -1;
      const tail = nav.pose(edge, end - toward * 2, 1, 0), ju = tail.tx * toward, js = tail.ty * toward;
      if (!straight(nav, edge, end ? edge.length - RUN_UP : 0, end ? edge.length : RUN_UP, .06)) continue;
      // It has to meet the river square on (the bank road's way, where they meet)
      const across = nav.pose(along, along.a === node.id ? 1 : along.length - 1, 1, 0), square = Math.abs(ju * across.ty - js * across.tx);
      if (square < Math.cos(.45)) continue;
      // The foot at the far curb of the bank road, in line with the lane
      // coming up to it (a boulevard's median is down the middle), then the water
      const half = along.profile.halfWidth, lane = edge.profile.lane;
      const footU = node.x + ju * (half + .3) + js * lane, footS = node.y + js * (half + .3) - ju * lane;
      let shore = 0;
      while (shore < 30 && !waterAt(footS + js * shore, footU + ju * shore)) shore += .5;
      if (shore >= 30 || shore < 2) continue;
      const run = shore + RIVER.over, lipU = footU + ju * run, lipS = footS + js * run;
      let gap = 0;
      while (gap < 120 && waterAt(lipS + js * gap, lipU + ju * gap)) gap += 1;
      if (gap < RIVER_GAP[0] || gap > RIVER_GAP[1]) continue;
      // Clear of every bridge by a good way, over the whole flight
      const flight = [{ x: footU, y: footS }, { x: lipU + ju * (gap + 40), y: lipS + js * (gap + 40) }];
      if (bridges.some(line => line.some(p => distanceToPolyline(p, flight) < 70))) continue;
      // Better with a street carrying on from the far bank to come down in
      const far = { x: lipU + ju * (gap + 20), y: lipS + js * (gap + 20) };
      const onward = nav.nodes.some(other => other !== node && Math.hypot(other.x - far.x, other.y - far.y) < 26);
      candidates.push({ node, ju, js, footU, footS, run, gap, shore, score: (onward ? 0 : 1) + randomAt(node.id, 7511, CITY.seed) * .5 });
    }
  }
  if (!candidates.length) return [];
  const chosen = candidates.sort((a, b) => a.score - b.score)[0], { ju, js, footU, footS } = chosen;
  // The water mask is in 4 m cells: the quay walls say where the banks
  // really are, for the ramp's slab and the far bank's end of the bridge
  const near = quayCrossing(footU, footS, ju, js, 0, 34);
  const shore = near?.t ?? chosen.shore, run = shore + RIVER.over;
  const lipU = footU + ju * run, lipS = footS + js * run;
  const landing = quayCrossing(lipU, lipS, ju, js, 0, chosen.gap + 10), gap = landing?.t ?? chosen.gap;
  const size = { ...RIVER, run, flat: 0 }, farU = lipU + ju * gap, farS = lipS + js * gap;
  const across = RIVER.width / 2 + .15, keep = [strip(footU, footS, ju, js, run, RIVER.width, 3), strip(lipU, lipS, ju, js, gap, 34)];
  // No coping where the ramp crosses the quay (it would stand through a low
  // ramp's deck), nor behind the far end of the bridge
  const quays = [strip(footU + ju * (shore - 1.5), footS + js * (shore - 1.5), ju, js, 3, 2 * across)];
  const abutment = landing ? farEnd(farU, farS, ju, js, landing) : null;
  if (abutment) {
    const from = abutment.front - .5, to = Math.max(...abutment.back) + 1;
    quays.push(strip(farU + ju * from, farS + js * from, ju, js, to - from, abutment.width + .3));
    // (and a gap in the railing, the lamps and benches cleared off the
    // promenade behind it, somewhere to come down)
    keep.push(strip(farU - ju * 3, farS - js * 3, ju, js, 14, RIVER.width + 8));
  }
  return [{
    kind: 'river', name: 'River jump', where: 'the river', u: footU, s: footS, heading: Math.atan2(ju, js),
    outline: strip(footU, footS, ju, js, run, RIVER.width), shape: rampShape(footU, footS, ju, js, size, PAVEMENT_LEVEL), top: PAVEMENT_LEVEL + RIVER.rise,
    size, shore, gap, keep, quays: quays.map(outline => ({ outline, bounds: polygonBounds(outline) })), abutment,
    // (cleared by coming down on the far bank or the bridge's end there,
    // and stars for how far past it, a jump being measured from where it
    // left the ramp)
    stars: [0, 12, 24].map(d => Math.floor(gap + (abutment?.front ?? 0)) + d),
    runup: { u: footU - ju * (RUN_UP + 12), s: footS - js * (RUN_UP + 12), heading: Math.atan2(ju, js) },
    lip: { u: lipU, s: lipS }, far: { u: farU, s: farS },
  }];
}
// Where the line from (u, s) along (ju, js) first crosses a quay wall, from
// `from` to `to` meters along it: how far, and the wall's way there
function quayCrossing(u, s, ju, js, from, to) {
  const ax = u + ju * from, ay = s + js * from, bx = u + ju * to, by = s + js * to;
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(ay, by), maxY = Math.max(ay, by);
  let best = null;
  for (const wall of CITY.walls) for (let i = 0; i < wall.length - 1; i++) {
    const p = wall[i], q = wall[i + 1];
    if (Math.max(p.x, q.x) < minX || Math.min(p.x, q.x) > maxX || Math.max(p.y, q.y) < minY || Math.min(p.y, q.y) > maxY) continue;
    const ex = q.x - p.x, ey = q.y - p.y, denom = ju * ey - js * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const dx = p.x - u, dy = p.y - s, t = (dx * ey - dy * ex) / denom, k = (dx * js - dy * ju) / denom;
    if (t < from || t > to || k < 0 || k > 1 || (best && t >= best.t)) continue;
    const length = Math.hypot(ex, ey);
    best = { t, wu: ex / length, ws: ey / length };
  }
  return best;
}
// The far bank's end of the bridge: a slab out over the water from the quay
// wall, its back along the wall and its front square to the jump, as wide as
// the ramp. None where the wall runs too far off square to meet it.
const ABUTMENT = { out: 1.8, depth: 1.1 };
function farEnd(u, s, ju, js, wall) {
  const ru = js, rs = -ju, half = RIVER.width / 2 + .5;
  // (how far along the jump the wall is, a meter to the side: the cross
  // product of the ways, which is 1 square on)
  const square = ju * wall.ws - js * wall.wu;
  if (Math.abs(square) < Math.cos(.6)) return null;
  const along = a => -a * (ru * wall.ws - rs * wall.wu) / square;
  const back = [-half, half].map(a => ({ a, t: along(a) })), front = Math.min(...back.map(b => b.t)) - ABUTMENT.out;
  const at = (t, a) => ({ x: u + ju * t + ru * a, y: s + js * t + rs * a });
  const outline = [at(back[0].t, -half), at(back[1].t, half), at(front, half), at(front, -half)];
  return { outline, width: 2 * half, front, back: back.map(b => b.t), top: PAVEMENT_LEVEL + .02, depth: ABUTMENT.depth, u, s };
}
// Whether (u, s) is on a quay wall a river jump crosses, where the wall's
// coping stops (see buildStreetSurfaces)
export function onJumpQuay(u, s) {
  const p = { x: u, y: s };
  return cityJumps().sites.some(site => site.quays?.some(({ outline, bounds }) => u >= bounds.minX && u <= bounds.maxX && s >= bounds.minY && s <= bounds.maxY && insidePolygon(p, outline)));
}

// Mounds on the parks' open lawns (not the squares): where the groves leave
// the grass open, clear of the walks, the pond, the plaza and the lawn's edge
function mounds() {
  const sites = [];
  for (const entry of cityParks()) {
    const park = entry.park, lawn = park.lawn;
    if (park.square || lawn.length < 3) continue;
    const bounds = polygonBounds(lawn), area = calcPolygonArea(lawn), ring = [...lawn, lawn[0]];
    const wanted = Math.min(MOUND_MOST, Math.floor(area / MOUND_AREA));
    const grove = (x, y) => CITY.field.noise2D(x / 75 + entry.index * 13, y / 75 - entry.index * 7);
    const candidates = [];
    for (let x = bounds.minX + 12; x < bounds.maxX - 12; x += 9) for (let y = bounds.minY + 12; y < bounds.maxY - 12; y += 9) {
      const salt = Math.round(x) * 7919 + Math.round(y);
      const rx = 8 + randomAt(salt, 7521, CITY.seed) * 5, rz = rx * (.62 + randomAt(salt, 7522, CITY.seed) * .3), reach = rx + 3;
      const p = { x, y };
      if (!insidePolygon(p, lawn) || distanceToPolyline(p, ring) < reach + 2 || grove(x, y) > -.12) continue;
      if (!parkClear(entry, x, y, reach) || nearPath(x, y, reach + 2)) continue;
      candidates.push({ x, y, rx, rz, salt, score: grove(x, y) + randomAt(salt, 7523, CITY.seed) * .3 });
    }
    const chosen = [];
    for (const c of candidates.sort((a, b) => a.score - b.score)) {
      if (chosen.length >= wanted) break;
      if (chosen.some(o => Math.hypot(o.x - c.x, o.y - c.y) < MOUND_APART + o.rx + c.rx)) continue;
      chosen.push(c);
    }
    for (const { x, y, rx, rz, salt } of chosen) {
      const height = rx * (.12 + randomAt(salt, 7524, CITY.seed) * .06), angle = randomAt(salt, 7525, CITY.seed) * Math.PI;
      const cos = Math.cos(angle), sin = Math.sin(angle), base = PAVEMENT_LEVEL + .02;
      // (its outline a little outside the hump, so a wheel meets it at the lawn)
      const outline = Array.from({ length: 16 }, (_, k) => {
        const t = k / 16 * Math.PI * 2, a = Math.cos(t) * (rx + .2), b = Math.sin(t) * (rz + .2);
        return { x: x + a * cos - b * sin, y: y + a * sin + b * cos };
      });
      // (the collider lies with z south, so the ellipse turns the other way)
      sites.push({
        kind: 'mound', name: 'Mound', where: null, u: x, s: y, heading: angle, outline, top: base + height,
        shape: { kind: 'mound', x, z: -y, rx, rz, cos, sin: -sin, height, base }, size: { rx, rz, height, angle },
        keep: [outline.map(p => ({ x: x + (p.x - x) * 1.25, y: y + (p.y - y) * 1.25 }))], stars: null, runup: null,
      });
    }
  }
  return sites;
}
function nearPath(x, y, reach) {
  const road = CITY.roadIndex.nearest(x, y, reach + 12, (segment, distance) => distance - segment.road.profile.halfWidth);
  return Boolean(road && road.score < reach);
}
