import * as THREE from 'three';
import { seededRandom } from './route.js';
import { PAVEMENT_LEVEL as G } from './city-route.js';
import { edgeFacade, edgeWindows, cornice, convexHull } from './city-buildings.js';
import { landmarkSite, venueFootprint } from './landmark-site.js';
export { landmarkSite } from './landmark-site.js';
import { discoverySignFor } from './city-signs.js';
import { round, clock, fireEngine } from './city-detail-assets.js';
import { roofWedge, vaultGeometry } from './city-roofs.js';
import { basinRim, basinWater } from './city-public-space-geometry.js';
import { balancingBeam } from './city-sculptures.js';
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
const plane = new THREE.PlaneGeometry(1, 1);
// The half-disc that closes each end of a vaulted roof
const gable = new THREE.CircleGeometry(1, 14, 0, Math.PI);
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
  const box = (u, y, v, w, h, d, colour, kind = 'solid') => { const p = at(u, v); c.box(p.x, y, p.s, w, h, d, colour, kind, along); };
  const colour = place.color, wall = kind === 'firehouse' ? '#a4574a' : kind === 'diner' ? '#e8c9c9' : kind === 'tower' ? '#d8c7a8' : STONE;
  const bodies = c.bodies, front = -D / 2;
  const sign = discoverySignFor(place.type, place.variant);
  // The building's record, collision and the venue's name across its front
  const record = height => c.features.buildings.push({ x: c.east + cx, s: c.start + cs, area: W * D, height, type: `landmark-${place.type}`, floors: Math.round(height / 3.6), roofType: 'flat', wall });
  const solidBody = ring => c.polygonSolid(convexHull(ring).map(p => [p.x, p.y]));
  // The name board, as big as fits between `bottom` and `top` and no wider
  // than `widthMax`, on a dark backing just proud of the wall at `into`
  const nameBoard = (bottom, top, widthMax, into = front - .25) => {
    if (c.distant || !sign) return;
    const h = Math.min(top - bottom, Math.min(widthMax, 8.5) / sign.aspect, 3.8), w = h * sign.aspect, y = (bottom + top) / 2, p = at(0, into);
    c.item('sign-board', plane, c.materials.signs, [p.x, y, -p.s], [w, h, 1], '#ffffff', facing).signTile = sign.tile;
    box(0, y, into + .12, w + .3, h + .3, .2, '#3d4246');
  };
  // Or on a low stone plinth in the forecourt, facing the street
  const plinthSign = (u, into, width = 4.6) => {
    if (c.distant || !sign) return;
    const h = width / sign.aspect, p = at(u, into);
    box(u, G + .45, into, width + .8, .9, .7, STONE);
    box(u, G + .93, into, width + 1, .1, .8, TRIM);
    box(u, G + 1 + h / 2 + .1, into + .08, width + .24, h + .24, .14, '#3d4246');
    c.item('sign-board', plane, c.materials.signs, [p.x, G + 1 + h / 2 + .1, -p.s], [width, h, 1], '#ffffff', facing).signTile = sign.tile;
    c.rigid(p.x, p.s, () => c.solid(p.x, p.s, width + .8, .7), itemFrame(c.start + p.s, c.east + p.x, along));
  };
  const windows = (ring, bottom, floors, type = 'deco') => {
    for (let i = 0; i < ring.length; i++) {
      const f = edgeFacade(c, ring[i], ring[(i + 1) % ring.length]);
      f.street = false;
      if (f.span >= 3) edgeWindows(c, { type, variation: 1, accent: colour }, f, bottom, floors, random);
    }
  };
  const civic = kind === 'hall' || place.type === 'station';
  const court = Math.min(W + 2, civic ? Math.max(14, W * .7) : Math.max(8, W * .5));
  // The grounds: the site laid to lawn, the forecourt from the street to the
  // door and a path round the building, clipped to the lot; trees along the
  // lot's edges and in its open lawn, clear of both; and for a civic hall
  // flower beds either side of the forecourt and its flags
  const grounds = () => {
    const lotLocal = lot.polygon.map(p => ({ x: p.x - c.east, y: p.y - c.start }));
    const paved = rect => intersection(solids([rect]), solids([lotLocal])).map(piece => piece.outer.map(p => [p.x, p.y]));
    c.polygon(lotLocal.map(p => [p.x, p.y]), G + .05, .06, LAWN);
    grassArea(c, lotLocal.map(p => [p.x, p.y]), LAWN, G + .08);
    const reach = setback + 8;
    for (const piece of paved(localRing(court, reach, front - reach / 2))) c.polygon(piece, G + .07, .06, PAVING);
    for (const piece of paved(localRing(W + 3.2, D + 3.2))) c.polygon(piece, G + .07, .06, PAVING);
    if (c.distant) return;
    // Where a tree may stand: on the lawn, clear of the lot's edge, the
    // building and the forecourt
    const edge = [...lotLocal, lotLocal[0]];
    const local = p => ({ along: (p.x - cx) * tx + (p.y - cs) * ty, into: (p.x - cx) * nx + (p.y - cs) * ny });
    const clear = (p, margin) => {
      const q = local(p);
      if (Math.abs(q.along) < W / 2 + margin && Math.abs(q.into) < D / 2 + margin) return false;
      if (Math.abs(q.along) < court / 2 + 2.5 && q.into < front + 1) return false;
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
        buildMonument(c, { kind: 'bed', u: c.east + bed.x, s: c.start + bed.s, yaw: along + Math.PI / 2, w: Math.min(setback - 1.5, 9), d: 2.2, colour: BED_COLOURS[(place.variant + (side > 0 ? 1 : 0)) % BED_COLOURS.length] }, bed.x, bed.s);
        // and a flag either side of the way in
        const pole = at(side * (court / 2 - .8), front - setback + 1.2);
        round(c, pole.x, G + 4.5, pole.s, .16, 9, .16, '#d9d6cc');
        box(side * (court / 2 - .8) + .75 * side, G + 8.1, front - setback + 1.2, 1.4, .9, .05, colour);
        c.post(pole.x, pole.s, .2);
      }
    }
  };
  const forecourtSign = () => plinthSign(-(court / 2 - 3.2), front - Math.max(1.6, setback * .55));
  const steps = (w, into) => { for (let k = 0; k < 3; k++) box(0, G + .1 + k * .2, into - 1.6 + k * .5, w + 2 - k * .6, .2 + k * .2, 1.2, TRIM); };
  const portico = (w, height, depth = 3.6) => {
    const count = Math.max(4, Math.round(w / 3.2)), spacing = w / count;
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
    c.item('roof-vault', vaultGeometry, material, [p.x, base, -p.s], [width / 2, rise, depth], roofColour, faceYaw(nx, ny));
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
      // A canopy over the ambulance entrance and a red cross on the front
      box(0, G + 4, front - 3, Math.min(14, W * .6), .4, 6, TRIM);
      for (const side of [-1, 1]) { const p = at(side * Math.min(6.5, W * .28), front - 5.6); round(c, p.x, G + 2, p.s, .4, 4, .4, TRIM); }
      box(0, G + H - 3.2, front - .15, 4.2, 1.2, .3, '#c9463d'); box(0, G + H - 3.2, front - .15, 1.2, 4.2, .3, '#c9463d');
      nameBoard(G + 4.8, G + 8.4, W * .6, front - .3);
    } else if (place.type === 'bathhouse') {
      // A terracotta vault over the pools
      vault(W - 1.2, Math.min(5, W * .2), D - 1.2, G + H, '#c07a55', c.materials.solid, '#d8b48f');
      // A tiled arcade across the front, turquoise piers under a terracotta band
      const bays = Math.max(3, Math.round(porch / 3.4));
      for (let k = 0; k <= bays; k++) box(-porch / 2 + k * porch / bays, G + 2.1, front - 1.4, .8, 4.2, .8, '#4aa3a0');
      box(0, G + 4.6, front - 1.4, porch + .8, .8, 1.2, '#c07a55');
      box(0, G + 5.05, front - 1.4, porch + 1.2, .12, 1.4, TRIM);
      for (let k = 0; k < bays; k++) box(-porch / 2 + (k + .5) * porch / bays, G + .06, front - 1.4, porch / bays - .8, .12, 1.8, '#7fc1bd');
      nameBoard(G + 5.6, G + H - 1, porch);
    } else {
      portico(porch, H - 3.2);
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
    box(0, G + 4.2, front - 2.4, Math.min(12, W * .5), .45, 4.8, COPPER);
    nameBoard(G + 4.9, G + H1 - .7, W * .7, front - .25);
    top = G + H2 + 4;
  } else if (kind === 'shed') {
    const H = 8, body = localRing(W, D), rise = Math.min(W * .24, 8);
    bodies.prism(body, G, G + H, wall);
    bodies.polygon(body, G + H, '#8d8c80');
    vault(W, rise, D, G + H, place.type === 'station' ? '#7e9aa0' : '#a47460');
    windows(body, G + 1, 1, 'loft');
    // A glazed entrance, and the name on the gable above it (or, where the
    // station's clock is, over the entrance)
    box(0, G + 3.2, front - .15, W * .55, 5, .2, GLASS, 'glass');
    if (place.type === 'station') {
      clock(c, at(0, front - .2).x, G + H + rise * .45, at(0, front - .2).s, Math.min(3.4, rise * .7), facing);
      nameBoard(G + 5.9, G + H - .3, W * .5, front - .4);
    } else nameBoard(G + H - .2, G + H + rise * .62, W * .45, front - .35);
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
    nameBoard(G + 5.4, G + H - 1.4, W * .75, front - .3);
    top = G + H;
  } else if (kind === 'observatory') {
    const H = 6, body = localRing(W, D, D * .1), radius = Math.min(W, D) * .3;
    bodies.prism(body, G, G + H, STONE);
    cornice(bodies, body, G + H, TRIM, '#8d9a92', STONE, .6, []);
    windows(body, G + .8, 1);
    domeOn(G + H, radius, 6, 0, D * .1);
    nameBoard(G + 1.3, G + H - .7, W * .6, front + D * .1 - .3);
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
    nameBoard(G + 2.2, G + H - .35, W * .5, D / 2 - depth - .3);
    top = G + H;
  } else if (kind === 'firehouse') {
    const H = 9, body = localRing(W, D);
    bodies.prism(body, G, G + H, wall);
    cornice(bodies, body, G + H, TRIM, '#7e7a74', wall, .8, []);
    windows(body, G + 5, 1, 'brick');
    const doors = Math.max(2, Math.min(3, Math.floor(W / 7)));
    for (let k = 0; k < doors; k++) box((k - (doors - 1) / 2) * W / (doors + .5), G + 2.3, front - .12, 4.4, 4.6, .2, '#b8453a');
    // The hose tower
    const p = at(W / 2 - 2.5, D / 2 - 2.5);
    c.box(p.x, G + 8.5, p.s, 4, 17, 4, wall, 'solid', along);
    c.box(p.x, G + 17.3, p.s, 4.6, .6, 4.6, TRIM, 'solid', along);
    nameBoard(G + 5.1, G + H - .6, W * .6, front - .25);
    // The heritage engine out on the forecourt, if there is room for it
    if (!c.distant && setback >= 4) { const q = at(0, front - 3.2); c.item('detail-fire-engine', fireEngine, c.materials.props, [q.x, G, -q.s], [.55, .55, .55], '#ffffff', faceYaw(tx, ty)); }
    top = G + 17.6;
  } else if (kind === 'diner') {
    const H = 5, body = localRing(W * .9, Math.min(D, 18), -D / 2 + Math.min(D, 18) / 2);
    bodies.prism(body, G, G + H, wall);
    cornice(bodies, body, G + H, '#f5eee0', '#e2a3b5', wall, .6, []);
    box(0, G + 2.1, -D / 2 - .15, W * .7, 2.4, .2, GLASS, 'glass');
    // The giant donut, standing up to face the street, and the name on a
    // board along the front of the roof
    const p = at(0, -D / 2 + Math.min(D, 18) / 2), radius = Math.min(4.6, W * .22);
    c.item('landmark-ring', ring, c.materials.solid, [p.x, G + H + radius * 1.1, -p.s], [radius, radius, radius], '#d98ea7', facing);
    c.item('landmark-ring', ring, c.materials.solid, [p.x, G + H + radius * 1.1, -p.s], [radius * .97, radius * .97, radius * 1.08], '#c98d5c', facing);
    nameBoard(G + H + .4, G + H + 2.5, W * .6, -D / 2 + .4);
    if (!c.distant) for (const side of [-1, 1]) box(side * 1.6, G + H + .2, -D / 2 + .52, .12, .5, .12, '#3d4246');
    top = G + H + radius * 2.2;
  } else if (kind === 'glasshouse') {
    const H = 7, body = localRing(W * .8, D * .7);
    bodies.prism(body, G, G + 1, STONE);
    bodies.prism(offsetPolygon(body, -.3), G + 1, G + H, GLASS);
    vault(W * .8, Math.min(W * .25, 6), D * .7, G + H, '#8fb9b5', c.materials.glass, '#8fb9b5');
    for (let k = -2; k <= 2; k++) { const q = at(k * W * .16, front + D * .15 + .1); round(c, q.x, G + H / 2 + .5, q.s, .22, H - 1, .22, '#e9e5d8'); }
    plinthSign(-(W * .25), front + D * .15 - 2.2);
    top = G + H + 6;
  } else {
    // An open square: paving, with a clock tower or a sculpture and a pool
    c.polygon(localRing(W + 3, D + 3).map(q => [q.x, q.y]), G + .09, .06, '#cdbf9f');
    const p = at(0, 0);
    if (place.type === 'clock') clockTower(0, 0, G, 16, 4.6);
    else {
      c.item('landmark-sculpture', balancingBeam, c.materials.solid, [p.x, G + .2, -p.s], [.32, .32, .32], colour, along);
      c.post(p.x, p.s, 3.5);
    }
    const pool = at(0, D * .3);
    if (!c.distant && D > 22) {
      c.item('basin-rim', basinRim, c.materials.solid, [pool.x, G + .35, -pool.s], [3.2, .7, 3.2], '#d7ccb3');
      c.item('basin-water', basinWater, c.materials.glass, [pool.x, G + .5, -pool.s], [3, 1, 3], '#4f93a0');
      c.post(pool.x, pool.s, 3.3);
    }
    plinthSign(-(W * .3), front + 1.8);
    record(16);
    return true;
  }
  record(top - G);
  solidBody(localRing(W, D));
  return true;
}
