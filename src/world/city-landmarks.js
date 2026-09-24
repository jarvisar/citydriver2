import * as THREE from 'three';
import { seededRandom } from './route.js';
import { PAVEMENT_LEVEL as G } from './city-route.js';
import { edgeFacade, edgeWindows, cornice, convexHull } from './city-buildings.js';
import { landmarkSite } from './landmark-site.js';
export { landmarkSite } from './landmark-site.js';
import { discoverySignFor } from './city-signs.js';
import { round, clock, fireEngine } from './city-detail-assets.js';
import { roofWedge, vaultGeometry } from './city-roofs.js';
import { basinRim, basinWater } from './city-public-space-geometry.js';
import { balancingBeam } from './city-sculptures.js';
import { grassArea } from './city-grass.js';
import { faceYaw, alongYaw } from './city-layout-render.js';
import { offsetPolygon, calcPolygonArea } from '../mapgen/polygon-util.js';

// The places a passenger asks for stand out from the street they are on: a
// civic hall with a portico and a dome or a clock tower, a hotel tower, a
// vaulted station shed, a cinema's marquee, an observatory's dome, a club's
// courts. Each is fitted to its lot the way any building is: a rectangle
// square to the lot's main street, set back behind a forecourt, and built in
// map coordinates from that rectangle's own axes (along the street, and into
// the lot), with the venue's own sign across its front.

const dome = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const spire = new THREE.ConeGeometry(1, 1, 4);
const ring = new THREE.TorusGeometry(1, .42, 10, 22);
const plane = new THREE.PlaneGeometry(1, 1);
// The half-disc that closes each end of a vaulted roof
const gable = new THREE.CircleGeometry(1, 14, 0, Math.PI);
const STONE = '#e3d7bd', TRIM = '#efe4c9', COPPER = '#62958b', GLASS = '#5e8a9a';

const KIND = {
  cityhall: 'hall', museum: 'hall', library: 'hall', postoffice: 'hall', bathhouse: 'hall', hospital: 'hall',
  hotel: 'tower', station: 'shed', depot: 'shed', market: 'shed', farmersmarket: 'shed',
  cinema: 'marquee', music: 'marquee', observatory: 'observatory', sports: 'club', firehouse: 'firehouse',
  donut: 'diner', clock: 'plaza', art: 'plaza', garden: 'glasshouse',
};

export function buildLandmark(c, lot, place) {
  const site = landmarkSite(lot);
  if (!site) return false;
  const random = seededRandom((lot.seed ^ 0x51ed) >>> 0), kind = KIND[place.type] ?? 'hall';
  const { width: W, depth: D, tx, ty, nx, ny } = site;
  const cx = site.centre.x - c.east, cs = site.centre.y - c.start;
  // A point in the site's own axes: along the street, into the lot
  const at = (along, into) => ({ x: cx + tx * along + nx * into, s: cs + ty * along + ny * into });
  const localRing = (w, d, into = 0) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => { const p = at(u, v + into); return { x: p.x, y: p.s }; });
  const along = alongYaw(tx, ty), facing = faceYaw(-nx, -ny);
  const box = (u, y, v, w, h, d, colour, kind = 'solid') => { const p = at(u, v); c.box(p.x, y, p.s, w, h, d, colour, kind, along); };
  const colour = place.color, wall = kind === 'firehouse' ? '#a4574a' : kind === 'diner' ? '#e8c9c9' : kind === 'tower' ? '#d8c7a8' : STONE;
  const bodies = c.bodies, front = -D / 2;
  const sign = discoverySignFor(place.type, place.variant);
  // The building's record, collision and the venue's name across its front
  const record = height => c.features.buildings.push({ x: c.east + cx, s: c.start + cs, area: W * D, height, type: `landmark-${place.type}`, floors: Math.round(height / 3.6), roofType: 'flat', wall });
  const solidBody = ring => c.polygonSolid(convexHull(ring).map(p => [p.x, p.y]));
  const nameBoard = (y, widthMax, into = front - .25) => {
    if (c.distant || !sign) return;
    const w = Math.min(widthMax, 8.5), h = w / sign.aspect, p = at(0, into);
    c.item('sign-board', plane, c.materials.signs, [p.x, y, -p.s], [w, h, 1], '#ffffff', facing).signTile = sign.tile;
    box(0, y, into + .12, w + .3, h + .3, .2, '#3d4246');
  };
  const windows = (ring, bottom, floors, type = 'deco') => {
    for (let i = 0; i < ring.length; i++) {
      const f = edgeFacade(c, ring[i], ring[(i + 1) % ring.length]);
      f.street = false;
      if (f.span >= 3) edgeWindows(c, { type, variation: 1, accent: colour }, f, bottom, floors, random);
    }
  };
  const forecourt = () => { const p = localRing(W + 2, 4.5, front - 2.25); c.polygon(p.map(q => [q.x, q.y]), G + .03, .06, '#c9bfa9'); };
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
  forecourt();
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
      nameBoard(G + 6.4, W * .6, front - .3);
    } else if (place.type === 'bathhouse') {
      // A terracotta vault over the pools
      vault(W - 1.2, Math.min(5, W * .2), D - 1.2, G + H, '#c07a55', c.materials.solid, '#d8b48f');
      box(0, G + 2.6, front - .2, porch, 4.6, .4, '#4aa3a0');
      nameBoard(G + 6.2, porch);
    } else {
      portico(porch, H - 3.2);
      nameBoard(G + H - 1.6, porch * .8, front - 3.9);
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
    nameBoard(G + H1 - 2, W * .7, front - .25);
    top = G + H2 + 4;
  } else if (kind === 'shed') {
    const H = 8, body = localRing(W, D), rise = Math.min(W * .24, 8);
    bodies.prism(body, G, G + H, wall);
    bodies.polygon(body, G + H, '#8d8c80');
    vault(W, rise, D, G + H, place.type === 'station' ? '#7e9aa0' : '#a47460');
    windows(body, G + 1, 1, 'loft');
    // A glazed gable over the entrance
    box(0, G + 4.5, front - .15, W * .55, 5, .2, GLASS, 'glass');
    if (place.type === 'station') clock(c, at(0, front - .2).x, G + H + rise * .45, at(0, front - .2).s, Math.min(3.4, rise * .7), facing);
    if (place.type === 'market' || place.type === 'farmersmarket') {
      // Striped stall awnings along the front
      for (let k = -2; k <= 2; k++) box(k * W * .17, G + 3, front - 1.6, W * .15, .3, 3, k % 2 ? colour : '#f1e6cc');
    }
    nameBoard(G + H - 1.4, W * .6, front - .35);
    top = G + H + rise;
  } else if (kind === 'marquee') {
    const H = 13, body = localRing(W, D);
    bodies.prism(body, G, G + H, place.type === 'music' ? '#4b4f72' : '#b6604f');
    cornice(bodies, body, G + H, TRIM, '#6f6d77', place.type === 'music' ? '#4b4f72' : '#b6604f', .8, []);
    windows(body, G + 4.8, 2);
    // The marquee: a lit canopy and a sign above it
    box(0, G + 4.3, front - 2, Math.min(W * .8, 18), 1, 4, '#2c2c34');
    if (!c.distant) box(0, G + 4.3, front - 4.05, Math.min(W * .8, 18), .5, .1, '#ffd98a', 'lit');
    nameBoard(G + 7.6, W * .75, front - .3);
    top = G + H;
  } else if (kind === 'observatory') {
    const H = 6, body = localRing(W, D, D * .1), radius = Math.min(W, D) * .3;
    bodies.prism(body, G, G + H, STONE);
    cornice(bodies, body, G + H, TRIM, '#8d9a92', STONE, .6, []);
    windows(body, G + .8, 1);
    domeOn(G + H, radius, 6, 0, D * .1);
    nameBoard(G + 3.6, W * .6, front + D * .1 - .3);
    top = G + H + 6 + radius;
  } else if (kind === 'club') {
    // A clubhouse at the back, courts in front with their lines and hoops
    const depth = Math.max(7, D * .32), house = localRing(W, depth, D / 2 - depth / 2), H = 5;
    bodies.prism(house, G, G + H, '#e7dcc4');
    cornice(bodies, house, G + H, TRIM, '#8d9a92', '#e7dcc4', .6, []);
    windows(house, G + .6, 1);
    const court = localRing(W - 2, D - depth - 2, -depth / 2 - .5).map(p => [p.x, p.y]);
    c.polygon(court, G + .05, .06, '#b76a4f');
    const inner = localRing(W - 5, D - depth - 5, -depth / 2 - .5).map(p => [p.x, p.y]);
    c.polygon(inner, G + .07, .04, '#5d9a73');
    for (const side of [-1, 1]) { const p = at(side * (W / 2 - 3.5), -depth / 2 - .5); round(c, p.x, G + 1.6, p.s, .16, 3.2, .16, '#e8e3d2'); box(side * (W / 2 - 3.2), G + 3.1, -depth / 2 - .5, .1, .9, 1.3, '#f4f1e8'); c.post(p.x, p.s, .2); }
    nameBoard(G + 3.4, W * .5, D / 2 - depth - .3);
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
    nameBoard(G + 6.4, W * .6, front - .25);
    if (!c.distant && D > 20) { const q = at(-W / 2 - 3.6, 0); if (W > 16) c.item('detail-fire-engine', fireEngine, c.materials.props, [q.x, G, -q.s], [.55, .55, .55], '#ffffff', faceYaw(-nx, -ny)); }
    top = G + 17.6;
  } else if (kind === 'diner') {
    const H = 5, body = localRing(W * .9, Math.min(D, 18), -D / 2 + Math.min(D, 18) / 2);
    bodies.prism(body, G, G + H, wall);
    cornice(bodies, body, G + H, '#f5eee0', '#e2a3b5', wall, .6, []);
    box(0, G + 2.1, -D / 2 - .15, W * .7, 2.4, .2, GLASS, 'glass');
    // The giant donut, standing up to face the street
    const p = at(0, -D / 2 + Math.min(D, 18) / 2), radius = Math.min(4.6, W * .22);
    c.item('landmark-ring', ring, c.materials.solid, [p.x, G + H + radius * 1.1, -p.s], [radius, radius, radius], '#d98ea7', facing);
    c.item('landmark-ring', ring, c.materials.solid, [p.x, G + H + radius * 1.1, -p.s], [radius * .97, radius * .97, radius * 1.08], '#c98d5c', facing);
    nameBoard(G + H - 1.2, W * .55, -D / 2 - .3);
    top = G + H + radius * 2.2;
  } else if (kind === 'glasshouse') {
    const H = 7, body = localRing(W * .8, D * .7), p = at(0, 0);
    c.polygon(localRing(W, D).map(q => [q.x, q.y]), G + .05, .06, '#7f9a5e'); grassArea(c, localRing(W, D).map(q => [q.x, q.y]), '#7f9a5e', G + .08);
    bodies.prism(body, G, G + 1, STONE);
    bodies.prism(offsetPolygon(body, -.3), G + 1, G + H, GLASS);
    vault(W * .8, Math.min(W * .25, 6), D * .7, G + H, '#8fb9b5', c.materials.glass, '#8fb9b5');
    for (let k = -2; k <= 2; k++) { const q = at(k * W * .16, front + .1); round(c, q.x, G + H / 2 + .5, q.s, .22, H - 1, .22, '#e9e5d8'); }
    nameBoard(G + 2.6, W * .5, front - 1.6);
    top = G + H + 6;
  } else {
    // An open square: paving, with a clock tower or a sculpture and a pool
    c.polygon(localRing(W + 3, D + 3).map(q => [q.x, q.y]), G + .04, .06, '#cdbf9f');
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
    nameBoard(G + 2.4, 5, front - 1);
    record(16);
    return true;
  }
  record(top - G);
  solidBody(localRing(W, D));
  return true;
}
