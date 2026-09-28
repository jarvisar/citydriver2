import * as THREE from 'three';
import { PAVEMENT_LEVEL as G } from './city-route.js';
import { cityAssets, parkedCars, Parts } from './city-assets.js';
import { buildHedge, round } from './city-detail-assets.js';
import { buildMonument } from './city-monuments.js';
import { basinRim, basinWater } from './city-public-space-geometry.js';
import { STALL_COLOURS, BED_COLOURS } from './city-parks.js';
import { itemFrame } from './city-layout-render.js';
import { tram, carriage, GAUGE, TRAM_LENGTH, CARRIAGE_LENGTH } from './city-rail.js';

// What a venue's grounds hold besides its forecourt and trees, so that each
// reads as what it is rather than a building in a park: a works' paved yard
// and its trams, a station's platforms, a market's stalls, fountains before
// the city hall, a museum's sculptures, a reading or healing garden, pools, a
// star garden, stands by the courts, a terrace or a ticket booth out front, a
// club's poster column, the post's pillar box. `cover` lays the lot to that
// paving instead of lawn (its trees in pits); `edge` plants trees only round
// the lot's edge, not in its open ground. Nothing here draws from the
// building's random stream: the skyline lays out the same grounds, and must
// draw what the detailed building draws.
export const GROUNDS = {
  station: { cover: '#c9bfa9', edge: true, features: ['platforms', 'bikes'] },
  depot: { cover: '#b9b4a8', edge: true, features: ['tracks', 'siding'] },
  market: { cover: '#cbbd9e', edge: true, features: ['stalls'] },
  farmersmarket: { cover: '#cbbd9e', edge: true, features: ['stalls'] },
  cityhall: { edge: true, features: ['fountains'] },
  museum: { features: ['sculptures'] },
  library: { features: ['reading'] },
  hospital: { features: ['healing'] },
  bathhouse: { features: ['pools'] },
  observatory: { features: ['stars'] },
  sports: { edge: true, features: ['stands'] },
  cinema: { features: ['booth'] },
  hotel: { features: ['terrace'] },
  donut: { features: ['terrace'] },
  music: { features: ['posters', 'stage'] },
  postoffice: { features: ['postbox', 'yard'] },
};
// Paint for the rolling stock, by the place's variant
const TRAMS = ['#c9463d', '#2f6b8a', '#d49a2e'], TRAINS = ['#6d2c34', '#2f5d4a', '#34507a'];
const RAIL = '#5d6061', PATH = '#d2c7ae', BALLAST = '#8b857a', BUFFER = '#8a3b32', POST_RED = '#b8453a';
// The heights things stand at: the lawn, the forecourt's paving, a slab laid on either
const LAWN_TOP = G + .05, PAVED_TOP = G + .07, SLAB_TOP = G + .1;

// Where each feature goes. `g` is the site as buildLandmark lays it out, in
// its own axes: u along the street and v into the site, the building W by D
// centred on (0, 0), its front at v `front` and the forecourt `court` wide
// from there out to the street. `taken` is what the builder puts on the
// grounds itself (a civic hall's beds and flags). Returns the cover, whether
// trees keep to the edge, the features and the rectangles they hold
// ({ u, v, w, d }), which the trees keep clear of.
export function planGrounds(g) {
  const programme = GROUNDS[g.type] ?? {};
  const held = [...g.taken ?? []], features = [];
  const building = { u: 0, v: 0, w: g.W + 3, d: g.D + 3 };
  const forecourt = { u: 0, v: g.front - 40, w: g.court + 1, d: 80 - 1.5 };
  if (g.plinth) held.push({ u: g.plinth.u, v: g.plinth.into, w: 8, d: 3.4 });
  const overlaps = (r, others = [building, forecourt, ...held], margin = 1) => others.some(o => Math.abs(r.u - o.u) < (r.w + o.w) / 2 + margin && Math.abs(r.v - o.v) < (r.d + o.d) / 2 + margin);
  // On the lot with a little to spare, tried every few metres along a long side
  const fits = r => {
    const w = r.w + 1.2, d = r.d + 1.2, nu = Math.max(2, Math.ceil(w / 6)), nv = Math.max(2, Math.ceil(d / 6));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) if (!g.onLot(r.u + (i / nu - .5) * w, r.v + (j / nv - .5) * d)) return false;
    return true;
  };
  const free = r => !overlaps(r) && fits(r);
  // Where a rectangle w by d may go in each zone, nearest first: `front`
  // either side of the forecourt, `left` and `right` beside the building
  // (level with its front first, `gap` from its walls), `back` behind it
  const candidates = (w, d, zone, gap = 2.5) => {
    const list = [];
    if (zone === 'front') for (let k = 0; k < 8; k++) for (let j = 0; j < 6; j++) for (const side of [-1, 1]) {
      list.push({ u: side * (g.court / 2 + w / 2 + 1.5 + j * 2.5), v: g.front - d / 2 - 1 - k * 1.5 });
    }
    if (zone === 'left' || zone === 'right') for (let k = 0; k < 10; k++) for (let j = 0; j < 8; j++) {
      list.push({ u: (zone === 'left' ? -1 : 1) * (g.W / 2 + w / 2 + gap + j * 2), v: g.front + d / 2 + k * 3 });
    }
    if (zone === 'back') for (let k = 0; k < 8; k++) for (const u of [0, -6, 6, -12, 12]) {
      list.push({ u, v: g.D / 2 + d / 2 + gap + k * 2 });
    }
    return list;
  };
  const spot = (w, d, zones, gap) => {
    for (const zone of zones) for (const c of candidates(w, d, zone, gap)) {
      const r = { ...c, w, d };
      // (a feature pressed up against the building may cover the path round it)
      if (gap < 2.5 ? !overlaps(r, [{ ...building, w: g.W, d: g.D }], gap / 2) && !overlaps(r, [forecourt, ...held]) && fits(r) : free(r)) { held.push(r); return r; }
    }
    return null;
  };
  // A matching pair either side of the way in, or failing that one
  const pair = (w, d) => {
    for (const c of candidates(w, d, 'front')) {
      if (c.u < 0) continue;
      const a = { ...c, w, d }, b = { ...a, u: -a.u };
      if (free(a) && free(b)) { held.push(a, b); return [a, b]; }
    }
    const one = spot(w, d, ['front']);
    return one ? [one] : [];
  };
  const add = (kind, r, extra = {}) => { if (r) features.push({ kind, ...r, ...extra }); };
  const round = ['left', 'right', 'back', 'front'];
  for (const kind of programme.features ?? []) {
    if (kind === 'platforms') {
      // An island platform beside the shed with a track either side, as long
      // as the site allows; or behind it along the street, as at a through
      // station; or failing both a single track and platform tight beside it
      const paint = TRAINS[g.variant % TRAINS.length];
      let r = spot(11, Math.min(g.D + 10, 64), ['left', 'right']) ?? spot(11, Math.min(g.D, 40), ['left', 'right']);
      if (r) { add('platforms', r, { paint, across: false, tracks: 2 }); continue; }
      for (const length of [64, 52, 42, 34]) if ((r = spot(length, 11, ['back']))) break;
      if (r) { add('platforms', r, { paint, across: true, tracks: 2 }); continue; }
      add('platforms', spot(6.6, Math.min(g.D, 36), ['left', 'right'], 1), { paint, across: false, tracks: 1 });
    } else if (kind === 'tracks') {
      // A track out of each workshop door across the yard toward the street
      for (const u of g.doors) {
        const r = { u, v: g.front - g.setback / 2, w: 3, d: g.setback - .5 };
        if (r.d > 2 && fits({ ...r, w: 1, d: r.d - 2 })) { features.push({ kind: 'track', ...r }); held.push(r); }
      }
    } else if (kind === 'siding') {
      // and a tram standing on a siding beside or behind the sheds
      add('siding', spot(4, TRAM_LENGTH + 3, ['left', 'right', 'back']), { paint: TRAMS[g.variant % TRAMS.length] });
    } else if (kind === 'stalls') {
      for (let k = 0; k < 8; k++) add('stall', spot(3.6, 2.8, ['front']), { colour: STALL_COLOURS[(k + g.variant) % STALL_COLOURS.length] });
    } else if (kind === 'fountains') {
      // A matching pair out on the lawns either side of the forecourt: the
      // portico's steps leave no room for one on the way in
      for (const radius of [3, 2.3]) {
        const found = pair(radius * 2 + 1, radius * 2 + 1);
        if (found.length) { for (const r of found) add('fountain', r, { radius }); break; }
      }
    } else if (kind === 'sculptures') {
      for (let k = 0; k < 4; k++) add('sculpture', spot(3, 3, k < 2 ? ['front', 'left', 'right'] : ['left', 'right', 'front']), { form: 1 + (k + g.variant) % 3 });
    } else if (kind === 'reading' || kind === 'healing') {
      add(kind, spot(15, 11, round) ?? spot(11, 9, round));
    } else if (kind === 'pools') {
      add('pools', spot(18, 12, round) ?? spot(12, 9, round));
    } else if (kind === 'stars') {
      add('stars', spot(14, 14, ['front', 'left', 'right', 'back']) ?? spot(10, 10, ['front', 'left', 'right', 'back']));
    } else if (kind === 'stands') {
      // Stands along the courts, one each side
      for (const zone of ['left', 'right']) add('stand', spot(3.6, Math.min(g.D * .5, 16), [zone]), { side: zone === 'left' ? -1 : 1 });
    } else if (kind === 'bikes') {
      add('bikes', spot(6, 2, ['front']));
    } else if (kind === 'booth') {
      add('booth', spot(3.2, 3.2, ['front']) ?? spot(2.6, 2.6, ['front']));
    } else if (kind === 'terrace') {
      for (let k = 0; k < 3; k++) add('cafe', spot(3.2, 3.2, ['front']) ?? spot(3.2, 3.2, ['left', 'right'], 1), { colour: STALL_COLOURS[(k + g.variant * 2) % STALL_COLOURS.length] });
    } else if (kind === 'posters') {
      // A poster column out front with the week's bills on it
      add('posters', spot(1.6, 1.6, ['front']) ?? spot(1.6, 1.6, ['left', 'right'], 1));
    } else if (kind === 'stage') {
      add('stage', spot(9, 6, ['back', 'left', 'right']));
    } else if (kind === 'postbox') {
      // A pillar box at the forecourt's street corner, on the side away from
      // the name's plinth (clear of the flags a deep forecourt has)
      const side = g.plinth?.u > 0 ? -1 : 1;
      for (const [u, v] of [[side * (g.court / 2 - 1.1), g.front - g.setback - 2.6], [side * (g.court / 2 - 1.1), g.front - 2.2]]) {
        if (g.onLot(u, v - 1.2) && g.onLot(u, v + 1.2)) { features.push({ kind: 'postbox', u, v, w: 1, d: 1 }); break; }
      }
    } else if (kind === 'yard') {
      add('yard', spot(12, 10, ['back', 'left', 'right']) ?? spot(8, 9, ['back', 'left', 'right']));
    }
  }
  // (a venue on a lot where the district has no lawns is paved to its edges, trees in pits)
  return { cover: programme.cover ?? (g.paved ? '#c9bfa9' : null), edge: Boolean(programme.edge || g.paved), features, held };
}

// The ticket booth's round roof, and an armillary sphere's rings: two
// upright, turned, and one lying flat
const booth = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
const upright = new THREE.TorusGeometry(1, .06, 4, 18), flat = new THREE.TorusGeometry(1, .06, 4, 18).rotateX(Math.PI / 2);
// A poster column: a green drum under a domed cap, pasted round with bills
const BILLS = ['#d9534f', '#f0c05a', '#3f7cac', '#ece4cf', '#7a5a9a', '#e07b39', '#2f8f83', '#1f2528'];
let posterColumn = null;
const posters = () => posterColumn ??= (() => {
  const p = new Parts(), green = '#2f4a3c';
  p.cylinder([0, .15, 0], .64, .68, .3, green, 12);
  p.cylinder([0, 1.6, 0], .55, .55, 2.6, green, 12);
  for (let k = 0; k < 8; k++) {
    const a = (k + .5) / 8 * Math.PI * 2;
    p.box([Math.sin(a) * .56, 1.05, Math.cos(a) * .56], [.38, .9, .03], BILLS[(k * 3) % BILLS.length], [0, a, 0]);
    p.box([Math.sin(a) * .56, 2.12, Math.cos(a) * .56], [.38, 1.02, .03], BILLS[(k * 5 + 2) % BILLS.length], [0, a, 0]);
  }
  p.cylinder([0, 3, 0], .7, .6, .2, green, 12);
  p.cone([0, 3.35, 0], .62, .5, green, 12);
  p.cylinder([0, 3.7, 0], .05, .05, .3, '#c9a34a', 6);
  return p.finish();
})();

// Build what planGrounds laid out, near detail only (bar the platforms'
// canopy and train, which are big enough to see across the city)
export function buildGrounds(g, plan) {
  const { c, at, box } = g;
  const slab = (w, d, v, u, y, colour) => c.polygon(g.localRing(w, d, v, u).map(p => [p.x, p.y]), y, .05, colour);
  const monument = (piece, u, v) => { const p = at(u, v); buildMonument(c, { u: c.east + p.x, s: c.start + p.s, ...piece }, p.x, p.s); };
  const hold = (u, v, w, d) => { const p = at(u, v); c.rigid(p.x, p.s, () => c.solid(p.x, p.s, w, d), itemFrame(c.start + p.s, c.east + p.x, g.along)); };
  const stock = (key, geometry, u, v, yaw = g.facing) => { const p = at(u, v); c.item(key, geometry, c.materials.props, [p.x, G + .23, -p.s], [1, 1, 1], '#ffffff', yaw); };
  // Rails along v, or along u
  const rails = (u, v, length, across = false) => {
    for (const side of [-1, 1]) {
      if (across) box(u, G + .15, v + side * GAUGE / 2, length, .1, .08, RAIL);
      else box(u + side * GAUGE / 2, G + .15, v, .08, .1, length, RAIL);
    }
  };
  // Street furniture that a car can knock over, standing on the ground at `y`
  const fitting = (kind, u, v, yaw, y, collider) => {
    const p = at(u, v), item = c.prop?.(kind, p.x, p.s, yaw, y);
    if (!item) return;
    collider(p);
    c.knockable?.([item], [{ kind, geometry: cityAssets[kind] }]);
  };
  // (a bench's length is along its own z: a quarter turn lays it along the street)
  const bench = (u, v, y) => fitting('bench', u, v, g.along + Math.PI / 2, y, () => hold(u, v, 2, .7));
  for (const f of plan.features) {
    const { u, v, w, d } = f;
    if (f.kind === 'platforms') { platforms(g, f, { slab, hold, stock, rails }); continue; }
    if (c.distant) continue;
    if (f.kind === 'track') rails(u, v, d);
    else if (f.kind === 'siding') {
      slab(3.6, d, v, u, SLAB_TOP, BALLAST);
      rails(u, v, d - .4);
      box(u, G + .55, v + d / 2 - .45, 2.1, .9, .5, BUFFER);
      stock(`rail-tram-${f.paint}`, tram(f.paint), u, v - .6);
      hold(u, v - .6, 2.6, TRAM_LENGTH);
    } else if (f.kind === 'stall') monument({ kind: 'stall', colour: f.colour, yaw: g.facing }, u, v);
    else if (f.kind === 'cafe') monument({ kind: 'cafe', colour: f.colour, yaw: g.along }, u, v);
    else if (f.kind === 'fountain') {
      // A round basin on a stone step, a jet's pedestal in the middle
      const p = at(u, v), r = f.radius;
      c.item('basin-rim', basinRim, c.materials.solid, [p.x, G + .4, -p.s], [r, .8, r], '#d7ccb3');
      c.item('basin-water', basinWater, c.materials.glass, [p.x, G + .62, -p.s], [r * .94, 1, r * .94], '#4f93a0');
      round(c, p.x, G + .95, p.s, .9, 1.1, .9, '#d9d1bf');
      round(c, p.x, G + 1.75, p.s, 1.5, .18, 1.5, '#cfc5ad');
      round(c, p.x, G + 2.1, p.s, .36, .6, .36, '#d9d1bf');
      c.post(p.x, p.s, r);
    } else if (f.kind === 'sculpture') {
      box(u, G + .45, v, 2.2, .9, 2.2, '#d9d1bf');
      const p = at(u, v);
      buildMonument(c, { kind: 'sculpture', u: c.east + p.x, s: c.start + p.s, yaw: g.facing, form: f.form, size: .7 }, p.x, p.s);
    } else if (f.kind === 'reading' || f.kind === 'healing') {
      // A garden room: clipped hedges round it, open in the middle of each
      // side, paths crossing it, beds in its quarters and benches
      slab(w - 1.6, 1.8, v, u, SLAB_TOP, PATH); slab(1.8, d - 1.6, v, u, SLAB_TOP, PATH);
      const hedge = (hu, hv, length, alongU) => { const p = at(hu, hv); buildHedge(c.bodies, p.x, LAWN_TOP, p.s, alongU ? length : .8, 1.1, alongU ? .8 : length, '#4f7a45', g.along); };
      for (const side of [-1, 1]) for (const half of [-1, 1]) {
        hedge(u + half * (w / 4 + .6), v + side * d / 2, w / 2 - 2.4, true);
        hedge(u + side * w / 2, v + half * (d / 4 + .6), d / 2 - 2.4, false);
      }
      for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        monument({ kind: 'bed', yaw: g.along, w: Math.max(2.4, w / 2 - 4.2), d: Math.min(2, d / 2 - 2.8), colour: BED_COLOURS[(du + 2 * dv + 3 + g.variant) % BED_COLOURS.length] }, u + du * w / 4, v + dv * d / 4);
      }
      for (const side of [-1, 1]) bench(u + side * (w / 4), v + side * 1.9, LAWN_TOP);
      if (f.kind === 'healing') {
        const p = at(u, v);
        c.item('basin-rim', basinRim, c.materials.solid, [p.x, G + .3, -p.s], [1.4, .6, 1.4], '#d7ccb3');
        c.item('basin-water', basinWater, c.materials.glass, [p.x, G + .46, -p.s], [1.3, 1, 1.3], '#4f93a0');
        c.post(p.x, p.s, 1.4);
      }
    } else if (f.kind === 'pools') {
      // A tiled terrace, a long pool with a coping round it and loungers
      const long = w >= d, pw = long ? w - 5 : w - 3.4, pd = long ? d * .42 : d - 5.2, pv = long ? v - d * .14 : v;
      slab(w, d, v, u, SLAB_TOP, '#e2d6bf');
      box(u, G + .22, pv, pw + .7, .24, pd + .7, '#f0e9d8');
      box(u, G + .3, pv, pw, .1, pd, '#4fb6b2', 'glass');
      hold(u, pv, pw + .7, pd + .7);
      if (long) for (let k = 0; k < 4; k++) box(u - pw / 2 + (k + .5) * pw / 4, G + .35, v + d / 2 - 1.8, .7, .26, 1.9, '#f7f3ea');
    } else if (f.kind === 'stars') {
      // A round garden: beds laid like a compass's points round an
      // armillary sphere on a stone column
      const p = at(u, v), r = w / 2 - 1;
      c.polygon(Array.from({ length: 16 }, (_, k) => { const q = at(u + Math.cos(k / 16 * Math.PI * 2) * r, v + Math.sin(k / 16 * Math.PI * 2) * r); return [q.x, q.s]; }), SLAB_TOP, .05, PATH);
      for (let k = 0; k < 8; k++) {
        const a = (k + .5) / 8 * Math.PI * 2;
        monument({ kind: 'bed', yaw: g.along + a, w: Math.max(2, r * .5), d: 1.3, colour: BED_COLOURS[(k + g.variant) % BED_COLOURS.length] }, u + Math.cos(a) * r * .66, v + Math.sin(a) * r * .66);
      }
      round(c, p.x, G + .95, p.s, .55, 1.7, .55, '#d9d1bf');
      for (const turn of [0, Math.PI / 2]) c.item('armillary-upright', upright, c.materials.solid, [p.x, G + 2.7, -p.s], [.85, .85, .85], '#b58a3a', g.along + turn);
      c.item('armillary-flat', flat, c.materials.solid, [p.x, G + 2.7, -p.s], [.85, .85, .85], '#b58a3a', g.along);
      c.post(p.x, p.s, .6);
    } else if (f.kind === 'stand') {
      // Three rows of seats stepping up away from the courts
      for (let k = 0; k < 3; k++) box(u + f.side * (k * 1.1 - 1.1), G + .25 + k * .35, v, 1.1, .5 + k * .7, d, k % 2 ? '#c9c2b0' : '#b3aa98');
      hold(u, v, w, d);
    } else if (f.kind === 'bikes') {
      for (const k of [-1, 1]) fitting('bike-rack', u + k * 1.5, v, g.along, PAVED_TOP, () => hold(u + k * 1.5, v, .8, 1.3));
    } else if (f.kind === 'booth') {
      // A little ticket booth with a round roof and a lit window to the street
      box(u, G + 1.2, v, 1.8, 2.4, 1.8, '#b6604f');
      box(u, G + 1.55, v - .92, 1.1, .8, .06, '#f2d27a', 'lit');
      const p = at(u, v);
      c.item('booth-roof', booth, c.materials.solid, [p.x, G + 2.4, -p.s], [1.25, .6, 1.25], '#2c2c34');
      hold(u, v, 1.9, 1.9);
    } else if (f.kind === 'posters') {
      const p = at(u, v);
      c.item('poster-column', posters(), c.materials.props, [p.x, LAWN_TOP, -p.s], [1, 1, 1], '#ffffff', g.facing);
      c.post(p.x, p.s, .66);
    } else if (f.kind === 'stage') {
      // A courtyard stage: a low platform, a back wall, a roof, tables before it
      slab(w, d, v, u, SLAB_TOP, '#b9ad97');
      box(u, G + .4, v + d / 2 - 1.8, w - 3, .6, 3.2, '#3b3548');
      box(u, G + 2.4, v + d / 2 - .3, w - 3, 4, .3, '#4b4f72');
      box(u, G + 4.5, v + d / 2 - 1.8, w - 2.4, .2, 3.8, '#2c2c34');
      hold(u, v + d / 2 - 1.8, w - 3, 3.2);
      for (const k of [-1, 1]) monument({ kind: 'cafe', colour: STALL_COLOURS[(k + 2 + g.variant) % STALL_COLOURS.length], yaw: g.along }, u + k * 2.2, v - d / 2 + 1.8);
    } else if (f.kind === 'postbox') {
      fitting('post-box', u, v, g.facing, PAVED_TOP, p => c.post(p.x, p.s, .3));
    } else if (f.kind === 'yard') {
      // A parcel yard, paved, with the post's red vans in it
      slab(w, d, v, u, SLAB_TOP, '#bdb7aa');
      for (const k of w >= 10 ? [-1, 1] : [0]) {
        const p = at(u + k * w / 4, v);
        c.item('parked-paint-van', parkedCars.van.paint, c.materials.solid, [p.x, SLAB_TOP, -p.s], [1, 1, 1], POST_RED, g.facing);
        c.item('parked-trim-van', parkedCars.van.trim, c.materials.props, [p.x, SLAB_TOP, -p.s], [1, 1, 1], '#ffffff', g.facing);
        hold(u + k * w / 4, v, 2.2, 5.3);
      }
    }
  }
}

// A platform with its yellow edges and a track beside it or either side, on
// ballast, under a canopy on posts, buffers at the tracks' ends and a train
// standing at the face nearer the building. Laid along v beside the shed, or
// along u (`across`) behind it. In its own terms `a` runs along the tracks
// and `b` across them.
function platforms(g, f, { slab, hold, stock, rails }) {
  const { c, at, box } = g, across = f.across;
  const long = across ? f.w : f.d, wide = across ? f.d : f.w, length = long - 2;
  const P = (a, b) => across ? [f.u + a, f.v + b] : [f.u + b, f.v + a];
  const piece = (a, b, y, la, h, lb, colour) => { const [u, v] = P(a, b); box(u, y, v, across ? la : lb, h, across ? lb : la, colour); };
  // (b toward the building: it stands at smaller v behind, or toward u = 0 beside)
  const toward = across ? -1 : f.u > 0 ? -1 : 1;
  const single = f.tracks === 1, deck = single ? toward * 1.5 : 0, faces = single ? [-toward * 1.8] : [-3.5, 3.5];
  slab(across ? long : wide - .4, across ? wide - .4 : long, f.v, f.u, SLAB_TOP, BALLAST);
  piece(0, deck, G + .5, length, .9, 3.6, '#bdb6a6');
  for (const edge of single ? [-toward] : [-1, 1]) piece(0, deck + edge * 1.72, G + .955, length, .02, .16, '#e3c65a');
  for (const b of faces) {
    const [u, v] = P(0, b);
    rails(u, v, long - .6, across);
    // (buffers where the tracks end: at the far end beside the shed, both ends behind it)
    for (const end of across ? [-1, 1] : [1]) piece(end * (long / 2 - .45), b, G + .55, .5, .9, 2.1, BUFFER);
  }
  const posts = Math.max(2, Math.round(length / 9));
  for (let k = 0; k <= posts; k++) {
    const [u, v] = P(-length / 2 + 1 + k * (length - 2) / posts, deck), p = at(u, v);
    round(c, p.x, G + 2.9, p.s, .16, 4, .16, '#3d4246');
  }
  const canopy = single ? 4.6 : 6.2, shift = single ? -toward * .5 : 0;
  piece(0, deck + shift, G + 5.05, length, .22, canopy, '#62958b');
  piece(0, deck + shift, G + 4.88, length - .4, .12, canopy - .6, '#dcd6c6');
  { const [u, v] = P(0, deck); hold(u, v, across ? length : 4.4, across ? 4.4 : length); }
  // The train at the face nearer the building, from the platform's street end
  const track = single ? faces[0] : toward * 3.5, step = CARRIAGE_LENGTH + .6;
  const count = Math.min(3, Math.floor((length - 1) / step)), start = across ? -count * step / 2 : -length / 2 + .8;
  for (let k = 0; k < count; k++) {
    const [u, v] = P(start + (k + .5) * step, track);
    stock(`rail-carriage-${f.paint}`, carriage(f.paint), u, v, g.facing + (across ? Math.PI / 2 : 0));
  }
  if (count) { const [u, v] = P(start + count * step / 2, track); hold(u, v, across ? count * step : 3, across ? 3 : count * step); }
}
