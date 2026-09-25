import * as THREE from 'three';
import { seededRandom } from './route.js';
import { PAVEMENT_LEVEL as G } from './city-route.js';
import { edgeFacade, edgeWindows, cornice, convexHull, exitDistance } from './city-buildings.js';
import { landmarkSite, venueFootprint } from './landmark-site.js';
import { discoverySignFor, signCore } from './city-signs.js';
import { round, clock, fireEngine } from './city-detail-assets.js';
import { roofWedge, vaultGeometry } from './city-roofs.js';
import { basinRim, basinWater } from './city-public-space-geometry.js';
import { balancingBeam, standingBeam, STANDING_BEAM } from './city-sculptures.js';
import { grassArea } from './city-grass.js';
import { faceYaw, alongYaw, itemFrame } from './city-layout-render.js';
import { buildMonument } from './city-monuments.js';
import { BED_COLOURS } from './city-parks.js';
import { intersection, solids } from '../mapgen/booleans.js';
import { offsetPolygon, calcPolygonArea, insidePolygon, distanceToPolyline } from '../mapgen/polygon-util.js';

// The places a passenger asks for stand out from the street they are on: a
// civic hall with a portico and a dome or a clock tower, a hotel tower, a
// vaulted station shed, a cinema's marquee, an observatory's dome, a club's
// courts. Each is fitted to its site the way any building is, a rectangle
// square to the site's main street (see landmark-site.js), built in map
// coordinates from that rectangle's own axes (along the street, and into the
// site), with the venue's name across its front or on a stone plinth in its
// forecourt. The rest of the site is its grounds: lawn, a paved forecourt
// from the street to the door and a path round the building, and trees along
// the edges and in the open lawn.

const dome = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const spire = new THREE.ConeGeometry(1, 1, 4);
const ring = new THREE.TorusGeometry(1, .42, 10, 22);
// The half-disc that closes each end of a vaulted roof
const gable = new THREE.CircleGeometry(1, 14, 0, Math.PI);
const frontGlazing = new THREE.PlaneGeometry(1, 1);
const STONE = '#e3d7bd', TRIM = '#efe4c9', COPPER = '#62958b', GLASS = '#5e8a9a', LAWN = '#7f9a5e', PAVING = '#c9bfa9';

const KIND = {
  cityhall: 'hall', museum: 'hall', library: 'hall', postoffice: 'hall', bathhouse: 'hall', hospital: 'hall',
  hotel: 'tower', station: 'shed', depot: 'shed', market: 'shed', farmersmarket: 'shed',
  cinema: 'marquee', music: 'marquee', observatory: 'observatory', sports: 'club', firehouse: 'firehouse',
  donut: 'diner', clock: 'plaza', art: 'plaza', garden: 'glasshouse',
};

export function buildLandmark(c, lot, place) {
  const site = place.footprint ?? venueFootprint(landmarkSite(lot), place.type);
  if (!site) return false;
  const random = seededRandom((lot.seed ^ 0x51ed) >>> 0), kind = KIND[place.type] ?? 'hall';
  const { width: W, depth: D, tx, ty, nx, ny, setback } = site;
  const cx = site.centre.x - c.east, cs = site.centre.y - c.start;
  // A point in the site's own axes: along the street, into the lot
  const at = (along, into) => ({ x: cx + tx * along + nx * into, s: cs + ty * along + ny * into });
  const localRing = (w, d, into = 0, along = 0) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => { const p = at(u + along, v + into); return { x: p.x, y: p.s }; });
  const along = alongYaw(tx, ty), facing = faceYaw(-nx, -ny);
  const box = (u, y, v, w, h, d, colour, kind = 'solid') => {
    // All glazed boxes here face the street. At skyline distance their
    // fronts join the ordinary windows' plane batch, without another draw.
    const p = at(u, v - (c.distant && kind === 'glass' ? d / 2 : 0));
    if (c.distant && kind === 'glass') c.item('distant-glass', frontGlazing, c.materials.glass, [p.x, y, -p.s], [w, h, 1], colour, facing);
    else c.box(p.x, y, p.s, w, h, d, colour, kind, along);
  };
  const colour = place.color, wall = kind === 'firehouse' ? '#a4574a' : kind === 'diner' ? '#e8c9c9' : kind === 'tower' ? '#d8c7a8' : STONE;
  const bodies = c.bodies, front = -D / 2;
  const sign = discoverySignFor(place.type, place.variant);
  // The building's record, collision and the venue's name across its front
  const record = height => c.features.buildings.push({ x: c.east + cx, s: c.start + cs, area: W * D, height, type: `landmark-${place.type}`, floors: Math.round(height / 3.6), roofType: 'flat', wall });
  const solidBody = ring => c.polygonSolid(convexHull(ring).map(p => [p.x, p.y]));
  // The name board, as big as fits between `bottom` and `top` and no wider
  // than `widthMax` (or than `fits` allows, for one on a gable), its board
  // mounted a hand's width proud of the wall at `wall`. The patch of wall
  // round it is kept clear of windows and pilasters (see edgeFacade).
  const boards = [];
  const keepClear = (wall, halfWidth, bottom, top, u = 0) => boards.push({ wall, from: u - halfWidth, to: u + halfWidth, bottom, top });
  const nameBoard = (bottom, top, widthMax, wall = front, fits = () => true) => {
    if (!sign) return;
    let h = Math.min(top - bottom - .2, Math.min(widthMax, 8.5) / sign.aspect, 3.8);
    while (h > .8 && !fits(h * sign.aspect + .2, bottom + .1 + h)) h *= .92;
    const w = h * sign.aspect, y = Math.min((bottom + top) / 2, bottom + .1 + h / 2), p = at(0, wall - .15);
    keepClear(wall, w / 2 + .45, y - h / 2 - .45, y + h / 2 + .45);
    if (c.distant) return;
    c.signFace('sign-board', sign, p.x, y, p.s, facing, w, h, .06, .09);
    // (brackets behind the board hold it off the wall)
    const core = signCore(sign, w, h);
    for (const side of [-1, 1]) box(side * core.width * .3, y + core.y, wall - .05, .14, core.height * .8, .1, '#2f3538');
  };
  // Or free-standing on a low stone plinth, facing the street
  const plinthSign = (u, into, width = 4.6) => {
    if (c.distant || !sign) return;
    const p = at(u, into);
    box(u, G + .45, into, width * .8 + .8, .9, .7, STONE);
    box(u, G + .93, into, width * .8 + 1, .1, .8, TRIM);
    c.standingSign(sign, p.x, p.s, facing, width, 1.1, { height: .98 });
    c.rigid(p.x, p.s, () => c.solid(p.x, p.s, width * .8 + .8, .7), itemFrame(c.start + p.s, c.east + p.x, along));
  };
  // Windows round a body, drawn once the name boards are up so that none
  // stands behind one
  const windowRuns = [];
  const windows = (ring, bottom, floors, type = 'deco') => windowRuns.push([ring, bottom, floors, type]);
  const drawWindows = () => {
    for (const [ring, bottom, floors, type] of windowRuns) for (let i = 0; i < ring.length; i++) {
      const f = edgeFacade(c, ring[i], ring[(i + 1) % ring.length]);
      f.street = false;
      // (a board on this wall: square with it, and close to its face)
      for (const board of boards) {
        const q = f.local(at(0, board.wall).x, at(0, board.wall).s);
        if (Math.abs(q.outward) < .6 && Math.abs(f.normal.x * nx + f.normal.y * ny) > .95) f.clear.push({ ...board, from: q.offset + board.from, to: q.offset + board.to });
      }
      if (f.span >= 3) edgeWindows(c, { type, variation: 1, accent: colour }, f, bottom, floors, random);
    }
  };
  // A way in beneath the canopy or portico. Reserve it before the window
  // pass so that no sill or pilaster runs across the doorway. The same few
  // pieces serve a glazed pair of public doors or a single staff door.
  const entrance = (u = 0, wall = front, w = 2.8, h = 3.1, level = .1) => {
    keepClear(wall, w / 2 + .35, G + level, G + level + h + .3, u);
    box(u, G + level + h / 2, wall - .12, w + .3, h + .24, .16, TRIM);
    box(u, G + level + h / 2, wall - .23, w, h, .08, '#375563', 'glass');
    if (w > 1.6) box(u, G + level + h / 2, wall - .3, .1, h, .08, TRIM);
    if (!c.distant) for (const side of w > 1.6 ? [-1, 1] : [1]) box(u + side * (w > 1.6 ? .18 : w * .32), G + level + 1.25, wall - .36, .06, .42, .08, '#cfb88a');
  };
  const civic = kind === 'hall' || place.type === 'station';
  const court = Math.min(W + 2, civic ? Math.max(14, W * .7) : Math.max(8, W * .5));
  const lotLocal = lot.polygon.map(p => ({ x: p.x - c.east, y: p.y - c.start }));
  // A hall under a portico has its name on a stone plinth on the lawn to one
  // side of its forecourt, facing the street where the flower bed on that side
  // would be, clear of the way up to its door; with no lawn there to take it,
  // at the forecourt's edge
  const plinthAt = (() => {
    if (kind !== 'hall' || place.type === 'hospital' || place.type === 'bathhouse') return null;
    const into = front - Math.max(2, setback * .55);
    const onLot = (u, v) => { const p = at(u, v); return insidePolygon({ x: p.x, y: p.s }, lotLocal); };
    if (setback >= 4.5) for (const side of [-1, 1]) {
      const u = side * (court / 2 + 3.3);
      if ([-3.2, 3.2].every(du => [-.8, .8].every(dv => onLot(u + du, into + dv)))) return { u, into, side };
    }
    // (no lawn: against the front beside the portico's steps, or failing that
    // at the forecourt's edge)
    const porch = Math.min(W * .62, 22);
    for (const side of [-1, 1]) {
      const u = side * (porch / 2 + 3.9);
      if ([-2.6, 2.6].every(du => [-.5, .5].every(dv => onLot(u + du, front - 1.4 + dv)))) return { u, into: front - 1.4, side: 0 };
    }
    return { u: -(court / 2 - 3.2), into: front - Math.max(1.6, setback * .55), side: 0 };
  })();
  // The grounds: the site laid to lawn, the forecourt from the street to the
  // door and a path round the building, clipped to the lot; trees along the
  // lot's edges and in its open lawn, clear of both and of the name's plinth;
  // and for a civic hall flower beds either side of the forecourt and its flags
  const grounds = () => {
    const paved = rect => intersection(solids([rect]), solids([lotLocal])).map(piece => piece.outer.map(p => [p.x, p.y]));
    c.polygon(lotLocal.map(p => [p.x, p.y]), G + .05, .06, LAWN);
    grassArea(c, lotLocal.map(p => [p.x, p.y]), LAWN, G + .08);
    const reach = setback + 8;
    for (const piece of paved(localRing(court, reach, front - reach / 2))) c.polygon(piece, G + .07, .06, PAVING);
    // The path round the building, carried on to the lot's edge wherever it
    // stops so short of it that only a strip of lawn would be left between
    const halfW = W / 2 + 1.6, halfD = D / 2 + 1.6, spread = [-.9, -.45, 0, .45, .9];
    const gap = ([u, v], du, dv) => { const p = at(u, v), q = { x: p.x, y: p.s }; return insidePolygon(q, lotLocal) ? exitDistance(q, tx * du + nx * dv, ty * du + ny * dv, lotLocal) : 0; };
    const grow = (points, du, dv) => { const gaps = points.map(p => gap(p, du, dv)).filter(Number.isFinite); return gaps.length && Math.min(...gaps) < 3 ? Math.min(8, Math.max(...gaps)) + .5 : 0; };
    const out = { front: grow(spread.map(k => [k * halfW, -halfD]), 0, -1), back: grow(spread.map(k => [k * halfW, halfD]), 0, 1),
      left: grow(spread.map(k => [-halfW, k * halfD]), -1, 0), right: grow(spread.map(k => [halfW, k * halfD]), 1, 0) };
    const around = [at(-halfW - out.left, -halfD - out.front), at(halfW + out.right, -halfD - out.front), at(halfW + out.right, halfD + out.back), at(-halfW - out.left, halfD + out.back)];
    for (const piece of paved(around.map(p => ({ x: p.x, y: p.s })))) c.polygon(piece, G + .07, .06, PAVING);
    if (c.distant) return;
    // Where a tree may stand: on the lawn, clear of the lot's edge, the
    // building and the forecourt
    const edge = [...lotLocal, lotLocal[0]];
    const local = p => ({ along: (p.x - cx) * tx + (p.y - cs) * ty, into: (p.x - cx) * nx + (p.y - cs) * ny });
    const clear = (p, margin) => {
      const q = local(p);
      if (Math.abs(q.along) < W / 2 + margin && Math.abs(q.into) < D / 2 + margin) return false;
      if (q.along > -halfW - out.left - 1 && q.along < halfW + out.right + 1 && q.into > -halfD - out.front - 1 && q.into < halfD + out.back + 1) return false;
      if (Math.abs(q.along) < court / 2 + 2.5 && q.into < front + 1) return false;
      // (nor on the name's plinth, or between it and the street)
      if (plinthAt && Math.abs(q.along - plinthAt.u) < 3.2 + margin && q.into < plinthAt.into + .8 + margin) return false;
      return insidePolygon(p, lotLocal) && distanceToPolyline(p, edge) > 2.6;
    };
    const trees = [];
    const plant = (p, scale) => { if (trees.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 6.5)) return; trees.push(p); c.tree(p.x, p.y, scale); };
    const inward = offsetPolygon(lotLocal, -3.4);
    if (inward.length >= 3) {
      const loop = [...inward, inward[0]];
      let travelled = random() * 9;
      for (let i = 0; i < loop.length - 1; i++) {
        const a = loop[i], b = loop[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y);
        for (; travelled < length; travelled += 9.5) {
          const p = { x: a.x + (b.x - a.x) * travelled / length, y: a.y + (b.y - a.y) * travelled / length };
          if (clear(p, 4.5)) plant(p, 6.8 + random() * 2);
        }
        travelled -= length;
      }
    }
    // A few more in the open lawn, in loose groups
    const area = calcPolygonArea(lotLocal), wanted = Math.floor(area / 520);
    for (let k = 0, placed = 0; k < wanted * 6 && placed < wanted; k++) {
      const q = at((random() - .5) * (W + 40), (random() - .5) * (D + 40)), p = { x: q.x, y: q.s };
      if (!clear(p, 6)) continue;
      const before = trees.length;
      plant(p, 7 + random() * 2.5);
      if (trees.length > before) placed++;
    }
    if (civic && setback >= 5) {
      for (const side of [-1, 1]) {
        const bed = at(side * (court / 2 + 2), front - setback / 2);
        if (!insidePolygon({ x: bed.x, y: bed.s }, lotLocal)) continue;
        if (plinthAt?.side !== side) buildMonument(c, { kind: 'bed', u: c.east + bed.x, s: c.start + bed.s, yaw: along + Math.PI / 2, w: Math.min(setback - 1.5, 9), d: 2.2, colour: BED_COLOURS[(place.variant + (side > 0 ? 1 : 0)) % BED_COLOURS.length] }, bed.x, bed.s);
        // and a flag either side of the way in
        const pole = at(side * (court / 2 - .8), front - setback + 1.2);
        round(c, pole.x, G + 4.5, pole.s, .16, 9, .16, '#d9d6cc');
        box(side * (court / 2 - .8) + .75 * side, G + 8.1, front - setback + 1.2, 1.4, .9, .05, colour);
        c.post(pole.x, pole.s, .2);
      }
    }
  };
  const forecourtSign = () => plinthSign(plinthAt.u, plinthAt.into);
  const steps = (w, into) => { for (let k = 0; k < 3; k++) box(0, G + .1 + k * .2, into - 1.6 + k * .5, w + 2 - k * .6, .2 + k * .2, 1.2, TRIM); };
  const portico = (w, height, depth = 3.6) => {
    // Paired columns leave a central opening; the steps meet a landing all
    // the way back to the door rather than ending in a drop behind them.
    const count = Math.max(4, Math.round(w / 6.4) * 2), spacing = w / count;
    box(0, G + .4, front - depth / 2, w + .8, .8, depth, TRIM);
    for (let k = 0; k < count; k++) { const p = at(-w / 2 + (k + .5) * spacing, front - depth / 2); round(c, p.x, G + height / 2, p.s, .9, height, .9, TRIM); }
    box(0, G + height + .6, front - depth / 2 + .2, w + 1, 1.2, depth + .6, TRIM);
    // A pediment of two wedges meeting at the middle
    for (const side of [-1, 1]) {
      const p = at(side * w / 4, front - depth / 2 + .2), rise = Math.min(3.2, w * .14);
      c.item('roof-fill', roofWedge, c.materials.solid, [p.x, G + height + 1.2, -p.s], [w / 2 + .5, rise, depth + .6], TRIM, along + (side > 0 ? Math.PI : 0));
    }
    steps(w, front - depth);
    for (const side of [-1, 1]) { const p = at(side * (w / 2 + .6), front - depth); c.post(p.x, p.s, .6); }
  };
  const domeOn = (y, radius, drum = 3, u = 0, v = 0) => {
    const p = at(u, v);
    round(c, p.x, y + drum / 2, p.s, radius * 2.1, drum, radius * 2.1, STONE);
    c.item('landmark-dome', dome, c.materials.solid, [p.x, y + drum, -p.s], [radius, radius * .9, radius], COPPER);
    round(c, p.x, y + drum + radius * .9 + .6, p.s, .5, 1.4, .5, TRIM);
  };
  // A barrel vault along the depth of the building, closed at both ends
  const vault = (width, rise, depth, base, roofColour, material = c.materials.solid, endColour = STONE) => {
    const p = at(0, 0);
    // (its eaves a little proud of the walls all round: the vault's edge dips
    // below its base, and flush it would share the top of each wall's face)
    c.item('roof-vault', vaultGeometry, material, [p.x, base, -p.s], [width / 2 + .15, rise, depth + .3], roofColour, faceYaw(nx, ny));
    for (const end of [-1, 1]) {
      const q = at(0, end * (depth / 2 - .08));
      c.item(end < 0 ? 'landmark-gable-front' : 'landmark-gable', gable, end < 0 && material === c.materials.solid ? c.materials.glass : material, [q.x, base, -q.s], [width / 2 - .1, rise - .1, 1], end < 0 ? '#8fb3b4' : endColour, end < 0 ? facing : facing + Math.PI);
    }
  };
  const clockTower = (u, v, base, height, size = 5) => {
    const p = at(u, v);
    c.box(p.x, base + height / 2, p.s, size, height, size, STONE, 'solid', along);
    c.box(p.x, base + height + .3, p.s, size + .6, .6, size + .6, TRIM, 'solid', along);
    c.item('landmark-spire', spire, c.materials.solid, [p.x, base + height + .6 + 2.2, -p.s], [size * .78, 4.4, size * .78], COPPER, along + Math.PI / 4);
    if (!c.distant) for (let k = 0; k < 4; k++) {
      const yaw = facing + k * Math.PI / 2, q = { x: p.x + Math.sin(yaw) * (size / 2 + .06), s: p.s - Math.cos(yaw) * (size / 2 + .06) };
      clock(c, q.x, base + height - size * .55, q.s, size * .72, yaw);
    }
    c.post(p.x, p.s, size * .6);
  };
  grounds();
  let top = G;
  if (kind === 'hall') {
    const H = place.type === 'cityhall' ? 15 : place.type === 'hospital' ? 16 : 12.5, body = localRing(W, D);
    bodies.prism(body, G, G + H, wall);
    cornice(bodies, body, G + H, TRIM, '#8d9a92', wall, 1, []);
    windows(body, G + 1, Math.floor((H - 2) / 3.6));
    const porch = Math.min(W * .62, 22);
    if (place.type === 'hospital') {
      entrance(0, front, 3.8, 3.35);
      // A canopy over the ambulance entrance and a red cross on the front
      box(0, G + 4, front - 2.1, Math.min(14, W * .6), .4, 4.2, TRIM);
      for (const side of [-1, 1]) { const p = at(side * Math.min(6.5, W * .28), front - 3.8); round(c, p.x, G + 2, p.s, .4, 4, .4, TRIM); }
      box(0, G + H - 3.2, front - .15, 4.2, 1.2, .3, '#c9463d'); box(0, G + H - 3.2, front - .15, 1.2, 4.2, .3, '#c9463d');
      keepClear(front, 2.5, G + H - 5.7, G + H - .7);
      // (the name above the canopy, clear of it from across the street)
      nameBoard(G + 5.8, G + 9.4, W * .6);
    } else if (place.type === 'bathhouse') {
      // A terracotta vault over the pools
      vault(W - 1.2, Math.min(5, W * .2), D - 1.2, G + H, '#c07a55', c.materials.solid, '#d8b48f');
      // A tiled arcade across the front, turquoise piers under a terracotta band
      const bays = Math.max(3, Math.round(porch / 3.4));
      entrance(bays % 2 ? 0 : porch / bays / 2, front, Math.min(2.5, porch / bays - 1.1));
      for (let k = 0; k <= bays; k++) box(-porch / 2 + k * porch / bays, G + 2.1, front - 1.4, .8, 4.2, .8, '#4aa3a0');
      box(0, G + 4.6, front - 1.4, porch + .8, .8, 1.2, '#c07a55');
      box(0, G + 5.05, front - 1.4, porch + 1.2, .12, 1.4, TRIM);
      for (let k = 0; k < bays; k++) box(-porch / 2 + (k + .5) * porch / bays, G + .06, front - 1.4, porch / bays - .8, .12, 1.8, '#7fc1bd');
      nameBoard(G + 5.9, G + H - 1, porch);
    } else {
      portico(porch, H - 3.2);
      entrance(0, front, Math.min(2.8, porch / Math.max(4, Math.round(porch / 6.4) * 2) - 1.2), 3.6, .8);
      forecourtSign();
    }
    if (place.type === 'cityhall' || place.type === 'museum') domeOn(G + H + .5, Math.min(W, D) * .2);
    if (place.type === 'library') { const p = localRing(Math.min(W, D) * .4, Math.min(W, D) * .4); bodies.prism(p, G + H, G + H + 4.5, GLASS); bodies.polygon(p, G + H + 4.5, TRIM); }
    if (place.type === 'cityhall' || place.type === 'postoffice') clockTower(0, D / 2 - 4, G + H, 11);
    top = G + H + 12;
  } else if (kind === 'tower') {
    const podium = localRing(W, D), H1 = 9, floors = 11 + Math.floor(random() * 6), tower = localRing(W - 6, D - 6, 1.5), H2 = H1 + floors * 3.6;
    bodies.prism(podium, G, G + H1, wall);
    cornice(bodies, podium, G + H1, TRIM, '#8a9189', wall, .8, []);
    bodies.prism(tower, G + H1, G + H2, '#cdb892');
    windows(podium, G + 1.2, 2); windows(tower, G + H1 + .4, floors, 'office');
    // A stepped copper crown and a canopy over the door
    const crown = localRing(W - 10, D - 10, 1.5);
    if (calcPolygonArea(crown) > 20) { bodies.prism(crown, G + H2, G + H2 + 4, COPPER); bodies.polygon(crown, G + H2 + 4, '#4d7a72'); }
    bodies.polygon(tower, G + H2, '#8a9189');
    box(0, G + 4.2, front - 1.7, Math.min(12, W * .5), .45, 3.4, COPPER);
    entrance(0, front, 3.4, 3.5);
    nameBoard(G + 5.5, G + H1 - .6, W * .7);
    top = G + H2 + 4;
  } else if (kind === 'shed') {
    const H = 8, body = localRing(W, D), rise = Math.min(W * .24, 8);
    bodies.prism(body, G, G + H, wall);
    bodies.polygon(body, G + H, '#8d8c80');
    vault(W, rise, D, G + H, place.type === 'station' ? '#7e9aa0' : '#a47460');
    windows(body, G + 1, 1, 'loft');
    // A glazed entrance, and the name on the gable above it (or, where the
    // station's clock is, over the entrance)
    keepClear(front, W * .275 + .35, G + .4, G + 5.9);
    box(0, G + 3.2, front - .08, W * .55 + .3, 5.3, .12, TRIM);
    box(0, G + 3.2, front - .2, W * .55, 5, .1, GLASS, 'glass');
    entrance(0, front - .2, 3.4, place.type === 'market' || place.type === 'farmersmarket' ? 2.65 : 3.5);
    if (place.type === 'station') {
      clock(c, at(0, front - .2).x, G + H + rise * .45, at(0, front - .2).s, Math.min(3.4, rise * .7), facing);
      nameBoard(G + 5.9, G + H - .3, W * .5);
    } else {
      // (on the gable's glass, the whole board inside its curve)
      const a = W / 2 - .1, b = rise - .1;
      nameBoard(G + H + .3, G + H + rise * .7, W * .45, front + .08, (w, top) => w / 2 + .4 <= a * Math.sqrt(Math.max(0, 1 - ((top - G - H) / b) ** 2)));
    }
    if (place.type === 'market' || place.type === 'farmersmarket') {
      // Striped stall awnings along the front
      for (let k = -2; k <= 2; k++) box(k * W * .17, G + 3, front - 1.6, W * .15, .3, 3, k % 2 ? colour : '#f1e6cc');
    }
    top = G + H + rise;
  } else if (kind === 'marquee') {
    const H = 13, body = localRing(W, D);
    bodies.prism(body, G, G + H, place.type === 'music' ? '#4b4f72' : '#b6604f');
    cornice(bodies, body, G + H, TRIM, '#6f6d77', place.type === 'music' ? '#4b4f72' : '#b6604f', .8, []);
    windows(body, G + 4.8, 2);
    // The marquee: a lit canopy and a sign above it
    box(0, G + 4.3, front - 2, Math.min(W * .8, 18), 1, 4, '#2c2c34');
    if (!c.distant) box(0, G + 4.3, front - 4.05, Math.min(W * .8, 18), .5, .1, '#ffd98a', 'lit');
    nameBoard(G + 6.2, G + H - 1.4, W * .75);
    for (const side of [-1, 1]) entrance(side * 1.65, front, 2.6, 3.2);
    top = G + H;
  } else if (kind === 'observatory') {
    const H = 6, body = localRing(W, D, D * .1), radius = Math.min(W, D) * .3;
    bodies.prism(body, G, G + H, STONE);
    cornice(bodies, body, G + H, TRIM, '#8d9a92', STONE, .6, []);
    windows(body, G + .8, 1);
    domeOn(G + H, radius, 6, 0, D * .1);
    nameBoard(G + 3.8, G + H - .4, W * .6, front + D * .1);
    entrance(0, front + D * .1, 2.6);
    top = G + H + 6 + radius;
  } else if (kind === 'club') {
    // A clubhouse at the back, and courts side by side in front of it:
    // tennis on green with a net across, or basketball on blue with a hoop at
    // each end, each lined in white
    const depth = Math.max(7, D * .32), house = localRing(W, depth, D / 2 - depth / 2), H = 5;
    bodies.prism(house, G, G + H, '#e7dcc4');
    cornice(bodies, house, G + H, TRIM, '#8d9a92', '#e7dcc4', .6, []);
    windows(house, G + .6, 1);
    const length = D - depth - 2, middle = -depth / 2 - .5, count = Math.max(1, Math.floor((W - 2) / 15)), unit = (W - 2) / count;
    const flat = (w, d, into, u, y, height, tint) => c.polygon(localRing(w, d, into, u).map(p => [p.x, p.y]), y, height, tint);
    flat(W - 2, length, middle, 0, G + .09, .06, '#b76a4f');
    for (let k = 0; k < count; k++) {
      const u = -(W - 2) / 2 + (k + .5) * unit, tennis = (k + place.variant) % 2 === 0, w = unit - 3, d = length - 4;
      flat(w, d, middle, u, G + .11, .04, tennis ? '#5d9a73' : '#4f7fa6');
      if (c.distant) continue;
      for (const end of [-1, 1]) {
        flat(w, .14, middle + end * (d / 2 - .07), u, G + .14, .02, '#f1eee4');
        flat(.14, d, middle, u + end * (w / 2 - .07), G + .14, .02, '#f1eee4');
      }
      flat(w, .14, middle, u, G + .14, .02, '#f1eee4');
      if (tennis) {
        box(u, G + .5, middle, w + .8, .9, .05, '#e8e3d2');
        for (const side of [-1, 1]) { const p = at(u + side * (w / 2 + .4), middle); round(c, p.x, G + .55, p.s, .1, 1.1, .1, '#3d4246'); c.post(p.x, p.s, .12); }
      } else for (const end of [-1, 1]) {
        const p = at(u, middle + end * (d / 2 + .4));
        round(c, p.x, G + 1.6, p.s, .16, 3.2, .16, '#e8e3d2'); box(u, G + 3.1, middle + end * (d / 2 - .1), 1.4, .9, .08, '#f4f1e8'); c.post(p.x, p.s, .2);
      }
    }
    nameBoard(G + 1.9, G + H - .5, W * .5, D / 2 - depth);
    entrance(W * .3, D / 2 - depth, 2.6);
    top = G + H;
  } else if (kind === 'firehouse') {
    const H = 9, body = localRing(W, D);
    bodies.prism(body, G, G + H, wall);
    cornice(bodies, body, G + H, TRIM, '#7e7a74', wall, .8, []);
    windows(body, G + 5, 1, 'brick');
    const doors = Math.max(2, Math.min(3, Math.floor(W / 7)));
    for (let k = 0; k < doors; k++) {
      const u = (k - (doors - 1) / 2) * W / (doors + .5);
      box(u, G + 2.35, front - .08, 4.7, 4.7, .12, TRIM);
      box(u, G + 2.3, front - .2, 4.4, 4.6, .1, '#b8453a');
      box(u, G + 3.25, front - .28, 3.7, .65, .06, '#375563', 'glass');
      if (!c.distant) for (const height of [1.2, 2.2]) box(u, G + height, front - .28, 4.2, .06, .06, '#a26b59');
    }
    entrance(W / 2 - 1.1, front, 1.2, 2.6);
    // The hose tower
    const p = at(W / 2 - 2.5, D / 2 - 2.5);
    c.box(p.x, G + 8.5, p.s, 4, 17, 4, wall, 'solid', along);
    c.box(p.x, G + 17.3, p.s, 4.6, .6, 4.6, TRIM, 'solid', along);
    nameBoard(G + 5.1, G + H - .6, W * .6);
    // The heritage engine out on the forecourt, if there is room for it
    if (!c.distant && setback >= 4) { const q = at(0, front - 3.2); c.item('detail-fire-engine', fireEngine, c.materials.props, [q.x, G, -q.s], [.55, .55, .55], '#ffffff', faceYaw(tx, ty)); }
    top = G + 17.6;
  } else if (kind === 'diner') {
    const H = 5, body = localRing(W * .9, Math.min(D, 18), -D / 2 + Math.min(D, 18) / 2);
    bodies.prism(body, G, G + H, wall);
    cornice(bodies, body, G + H, '#f5eee0', '#e2a3b5', wall, .6, []);
    box(0, G + 2.1, -D / 2 - .15, W * .7, 2.4, .2, GLASS, 'glass');
    entrance(0, front - .2, 2.4);
    // The roof sign: the name on a board standing on legs just behind the
    // parapet, clear over it, and the giant donut on its posts behind and
    // above the board, facing the street, so that neither hides the other
    const deck = G + H + .18, bottom = G + H + .95, radius = Math.min(3.2, W * .16);
    const h = sign ? Math.min(2.6, W * .55 / sign.aspect) : 2.6, boardTop = bottom + h, into = -D / 2 + .9;
    if (sign && !c.distant) {
      const w = h * sign.aspect, p = at(0, into), core = signCore(sign, w, h);
      c.signFace('sign-board', sign, p.x, bottom + h / 2, p.s, facing, w, h, .06, .09);
      for (const side of [-1, 1]) box(side * core.width * .32, (deck + bottom + h / 2 + core.y) / 2, into + .1, .14, bottom + h / 2 + core.y - deck, .12, '#2f3538');
    }
    const middle = boardTop + .35 + radius * 1.42, p = at(0, into + 1.6);
    c.item('landmark-ring', ring, c.materials.solid, [p.x, middle, -p.s], [radius, radius, radius], '#d98ea7', facing);
    c.item('landmark-ring', ring, c.materials.solid, [p.x, middle, -p.s], [radius * .97, radius * .97, radius * 1.08], '#c98d5c', facing);
    for (const side of [-1, 1]) { const q = at(side * radius * .55, into + 1.6); round(c, q.x, (deck + middle - radius * 1.1) / 2, q.s, .22, middle - radius * 1.1 - deck, .22, '#3d4246'); }
    top = middle + radius * 1.42;
  } else if (kind === 'glasshouse') {
    const H = 7, body = localRing(W * .8, D * .7);
    bodies.prism(body, G, G + 1, STONE);
    bodies.prism(offsetPolygon(body, -.3), G + 1, G + H, GLASS);
    vault(W * .8, Math.min(W * .25, 6), D * .7, G + H, '#8fb9b5', c.materials.glass, '#8fb9b5');
    for (let k = -2; k <= 2; k++) { const q = at(k * W * .16, front + D * .15 + .1); round(c, q.x, G + H / 2 + .5, q.s, .22, H - 1, .22, '#e9e5d8'); }
    plinthSign(-(W * .25), front + D * .15 - 2.2);
    entrance(0, front + D * .15, 2.6, 3.4);
    top = G + H + 6;
  } else {
    // An open square: paving, with a clock tower or a sculpture and a pool
    c.polygon(localRing(W + 3, D + 3).map(q => [q.x, q.y]), G + .09, .06, '#cdbf9f');
    const p = at(0, 0);
    if (place.type === 'clock') clockTower(0, 0, G, 16, 4.6);
    else {
      c.item('landmark-sculpture', balancingBeam, c.materials.solid, [p.x, G + .2, -p.s], [.32, .32, .32], colour, along);
      c.item('landmark-sculpture-base', standingBeam, c.materials.solid, [p.x, G + .2, -p.s], [.32, .32, .32], STANDING_BEAM, along);
      c.post(p.x, p.s, 3.5);
    }
    const pool = at(0, D * .3);
    if (!c.distant && D > 22) {
      c.item('basin-rim', basinRim, c.materials.solid, [pool.x, G + .35, -pool.s], [3.2, .7, 3.2], '#d7ccb3');
      c.item('basin-water', basinWater, c.materials.glass, [pool.x, G + .5, -pool.s], [3, 1, 3], '#4f93a0');
      c.post(pool.x, pool.s, 3.3);
    }
    plinthSign(-(W * .3), front + 1.8);
    drawWindows();
    record(16);
    return true;
  }
  drawWindows();
  record(top - G);
  solidBody(localRing(W, D));
  return true;
}
