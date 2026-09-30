import { shapeHeight } from '../collision.js';
import { WATER_LEVEL } from './city-route.js';
import { COLOURS } from './city-streets.js';

// What the jumps look like (see city-jumps.js), built into a cell's bodies,
// the one flat-shaded mesh its buildings are (see CityChunk), in the cell's
// own coordinates: no draws of their own. Each is also its collider, the top
// the shape the cars and everything else stand on.

// Loading ramp: a steel wedge on a level platform, grated deck between yellow
// edges, hazard bars across the back where it drops away
const STEEL = { deck: '#4f5559', rib: '#62696d', edge: '#d9a62c', side: '#c9982a', frame: '#3b4043', dark: '#25292b', tyre: '#2c2f30' };
// River jump: a bridge deck poured as far as it got, on two columns in the
// river, rebar standing out of its broken end
const CONCRETE = { deck: '#6f7375', lane: '#d7d3c4', edge: '#bcb8ac', side: '#b2ad9f', under: '#8e8a7f', column: '#a9a497', steel: '#5b4c3f', rebar: '#8c5d3c', stripe: '#1f2224', hazard: '#e3b02c' };
// (drawn a centimetre over the surface driven on, off the ground's plane at the foot)
const LIFT = .01;

export function buildJump(c, site, part = null) {
  if (part === 'far') { farEnd(c, site); return; }
  if (!c.distant) c.features.colliders.push({ logicalPolygon: site.outline.map(p => [p.x, p.y]), top: site.top, shape: site.shape, jump: site });
  if (site.kind === 'mound') mound(c, site);
  else ramp(c, site);
}

// A frame along the ramp: `t` metres up it from its foot, `a` across (right
// positive), in the cell's own map coordinates, and the deck's height there
function frame(c, site) {
  const ju = Math.sin(site.heading), js = Math.cos(site.heading), ru = js, rs = -ju;
  const u = site.u - c.east, s = site.s - c.start;
  const shape = site.shape, world = { x: 0, z: 0 };
  return {
    at: (t, a) => ({ x: u + ju * t + ru * a, y: s + js * t + rs * a }),
    // (the collider's own shape, so what is drawn is what is driven on)
    height: t => { world.x = shape.x + shape.dx * t; world.z = shape.z + shape.dz * t; return shapeHeight(shape, world) + LIFT; },
    ju, js, ru, rs,
  };
}
// Two triangles of a quad p q r w (map points and heights), wound so the face
// looks the way (nu, ns) points on the map
function quad(surface, p, hp, q, hq, r, hr, w, hw, colour, nu, ns) {
  // (the normal of p q r in the scene, x east and z south, against the way wanted)
  const ax = q.x - p.x, ay = hq - hp, az = -(q.y - p.y), bx = r.x - p.x, by = hr - hp, bz = -(r.y - p.y);
  const nx = ay * bz - az * by, nz = ax * by - ay * bx;
  if (nx * nu - nz * ns >= 0) {
    surface.face(p.x, hp, -p.y, q.x, hq, -q.y, r.x, hr, -r.y, colour);
    surface.face(p.x, hp, -p.y, r.x, hr, -r.y, w.x, hw, -w.y, colour);
  } else {
    surface.face(p.x, hp, -p.y, r.x, hr, -r.y, q.x, hq, -q.y, colour);
    surface.face(p.x, hp, -p.y, w.x, hw, -w.y, r.x, hr, -r.y, colour);
  }
}
// A wall standing from a to b, its top sloping from ha to hb and its foot
// from fa to fb, facing (nu, ns)
function side(surface, a, ha, b, hb, fa, fb, colour, nu, ns) { quad(surface, a, ha, b, hb, b, fb, a, fa, colour, nu, ns); }
// A sloping strip of deck from t0 to t1, from a0 to a1 across
function deck(surface, f, t0, t1, a0, a1, colour, lift = 0) {
  const h0 = f.height(t0) + lift, h1 = f.height(t1) + lift;
  surface.slope(f.at(t0, a0), h0, f.at(t1, a0), h1, f.at(t1, a1), h1, colour);
  surface.slope(f.at(t0, a0), h0, f.at(t1, a1), h1, f.at(t0, a1), h0, colour);
}
// A triangle facing down (see Surface.slope, which faces up)
function underside(surface, a, ha, b, hb, c, hc, colour) {
  const ux = b.x - a.x, uz = -(b.y - a.y), vx = c.x - a.x, vz = -(c.y - a.y);
  if (uz * vx - ux * vz >= 0) surface.face(a.x, ha, -a.y, c.x, hc, -c.y, b.x, hb, -b.y, colour);
  else surface.face(a.x, ha, -a.y, b.x, hb, -b.y, c.x, hc, -c.y, colour);
}
// A box `w` across and `d` along the ramp at (t, a), from y0 up to y1
function block(surface, f, t, a, w, d, y0, y1, colour) {
  const corners = [f.at(t - d / 2, a - w / 2), f.at(t + d / 2, a - w / 2), f.at(t + d / 2, a + w / 2), f.at(t - d / 2, a + w / 2)], centre = f.at(t, a);
  for (let i = 0; i < 4; i++) {
    const p = corners[i], q = corners[(i + 1) % 4];
    side(surface, p, y1, q, y1, y0, y0, colour, (p.x + q.x) / 2 - centre.x, (p.y + q.y) / 2 - centre.y);
  }
  surface.slope(corners[0], y1, corners[1], y1, corners[2], y1, colour);
  surface.slope(corners[0], y1, corners[2], y1, corners[3], y1, colour);
}

function ramp(c, site) {
  const f = frame(c, site), size = site.size, half = size.width / 2, run = size.run, flat = size.flat ?? 0, end = run + flat;
  const surface = c.bodies, river = site.kind === 'river', look = river ? CONCRETE : STEEL;
  // (samples along the slope, closer toward the lip where it curves most)
  const count = river ? 10 : 6, steps = [0];
  for (let i = 1; i <= count; i++) steps.push(run * Math.sqrt(i / count));
  if (flat > 0) steps.push(end);
  const edge = river ? .45 : .28;
  for (let i = 0; i < steps.length - 1; i++) {
    const t0 = steps[i], t1 = steps[i + 1];
    deck(surface, f, t0, t1, -half, -half + edge, look.edge);
    deck(surface, f, t0, t1, half - edge, half, look.edge);
    if (river) {
      // (a carriageway's worth of asphalt with a broken lane line down it)
      deck(surface, f, t0, t1, -half + edge, -.08, look.deck);
      deck(surface, f, t0, t1, .08, half - edge, look.deck);
      deck(surface, f, t0, t1, -.08, .08, i % 2 ? look.deck : look.lane);
    } else {
      deck(surface, f, t0, t1, -half + edge, half - edge, look.deck);
      // (a grated deck's ribs across it)
      for (let k = 1; k < 4; k++) { const t = t0 + (t1 - t0) * k / 4; deck(surface, f, t - .04, t + .04, -half + edge, half - edge, look.rib, .006); }
    }
  }
  if (river) riverSides(c, site, f, steps, half, look);
  else loadingSides(c, site, f, steps, half, look);
}

function loadingSides(c, site, f, steps, half, look) {
  const surface = c.bodies, end = steps.at(-1), base = site.shape.base;
  // Yellow sides down to the street, and the back where it drops away
  for (let i = 0; i < steps.length - 1; i++) {
    const t0 = steps[i], t1 = steps[i + 1], h0 = f.height(t0), h1 = f.height(t1);
    side(surface, f.at(t0, -half), h0, f.at(t1, -half), h1, base, base, look.side, -f.ru, -f.rs);
    side(surface, f.at(t0, half), h0, f.at(t1, half), h1, base, base, look.side, f.ru, f.rs);
  }
  // (black and yellow bars across its back)
  const top = f.height(end), bars = 7;
  for (let k = 0; k < bars; k++) {
    const a0 = -half + 2 * half * k / bars, a1 = -half + 2 * half * (k + 1) / bars;
    side(surface, f.at(end, a0), top, f.at(end, a1), top, base + .35, base + .35, k % 2 ? look.edge : look.dark, f.ju, f.js);
  }
  side(surface, f.at(end, -half), base + .35, f.at(end, half), base + .35, base, base, look.frame, f.ju, f.js);
  // It stands on two wheels under its platform, and a pair of legs at its foot
  for (const a of [-half + .35, half - .35]) {
    block(surface, f, end - .5, a, .26, .6, base, base + .56, look.tyre);
    block(surface, f, 1.2, a * .8, .14, .14, base, f.height(1.2) - .03, look.frame);
  }
}

function riverSides(c, site, f, steps, half, look) {
  const surface = c.bodies, end = steps.at(-1), shore = site.shore, slab = 1.1, base = site.shape.base;
  // Over the promenade its sides come down to it. Out over the water it is a
  // slab on its columns, its underside open
  for (let i = 0; i < steps.length - 1; i++) {
    const t0 = steps[i], t1 = steps[i + 1], h0 = f.height(t0), h1 = f.height(t1);
    const foot = t => t <= shore ? base : Math.max(base, f.height(t) - slab), f0 = foot(t0), f1 = foot(t1);
    for (const sideOf of [-1, 1]) side(surface, f.at(t0, sideOf * half), h0, f.at(t1, sideOf * half), h1, f0, f1, look.side, f.ru * sideOf, f.rs * sideOf);
    if (t1 > shore) {
      const a = f.at(t0, -half), b = f.at(t1, -half), cc = f.at(t1, half), d = f.at(t0, half);
      underside(surface, a, f0, b, f1, cc, f1, look.under);
      underside(surface, a, f0, cc, f1, d, f0, look.under);
    }
  }
  // Its broken end: hazard bars on a steel edge, and the rebar left standing out
  const top = f.height(end), bottom = top - slab, bars = 9;
  for (let k = 0; k < bars; k++) {
    const a0 = -half + 2 * half * k / bars, a1 = -half + 2 * half * (k + 1) / bars;
    side(surface, f.at(end, a0), top, f.at(end, a1), top, top - .35, top - .35, k % 2 ? look.hazard : look.stripe, f.ju, f.js);
  }
  side(surface, f.at(end, -half), top - .35, f.at(end, half), top - .35, bottom, bottom, look.steel, f.ju, f.js);
  for (let k = 0; k < 7; k++) {
    const a = -half + .5 + (2 * half - 1) * k / 6, out = .5 + ((k * 37) % 5) * .18, y = bottom + .25 + ((k * 53) % 3) * .28;
    block(surface, f, end + out / 2, a, .06, out, y, y + .06, look.rebar);
  }
  // Two pairs of columns in the river under the slab
  for (const at of [shore + (end - shore) * .35, shore + (end - shore) * .75]) {
    for (const a of [-half * .55, half * .55]) block(surface, f, at, a, .9, .9, WATER_LEVEL - .3, f.height(at) - slab, look.column);
  }
}

// The far bank's end of the bridge (see farEnd in city-jumps.js): a slab out
// from the quay wall, level with the promenade, with the same broken end as
// the ramp's, its rebar reaching back toward it
function farEnd(c, site) {
  const end = site.abutment, look = CONCRETE, surface = c.bodies, top = end.top, bottom = top - end.depth;
  const ju = Math.sin(site.heading), js = Math.cos(site.heading), ru = js, rs = -ju, u = end.u - c.east, s = end.s - c.start;
  const f = { at: (t, a) => ({ x: u + ju * t + ru * a, y: s + js * t + rs * a }) };
  // (a level plate, a shape so the cameras take it as ground, as the ramps are)
  if (!c.distant) c.features.colliders.push({ logicalPolygon: end.outline.map(p => [p.x, p.y]), top, shape: { kind: 'ramp', x: end.u, z: -end.s, dx: ju, dz: -js, run: 1, rise: 0, curve: 0, flat: 0, base: top } });
  const [bl, br, fr, fl] = end.outline.map(p => ({ x: p.x - c.east, y: p.y - c.start }));
  surface.slope(bl, top, br, top, fr, top, look.side);
  surface.slope(bl, top, fr, top, fl, top, look.side);
  underside(surface, bl, bottom, br, bottom, fr, bottom, look.under);
  underside(surface, bl, bottom, fr, bottom, fl, bottom, look.under);
  side(surface, fl, top, bl, top, bottom, bottom, look.side, -ru, -rs);
  side(surface, br, top, fr, top, bottom, bottom, look.side, ru, rs);
  // Its end, facing the ramp across the water
  const half = end.width / 2, bars = 9;
  for (let k = 0; k < bars; k++) {
    const a0 = -half + 2 * half * k / bars, a1 = -half + 2 * half * (k + 1) / bars;
    side(surface, f.at(end.front, a0), top, f.at(end.front, a1), top, top - .35, top - .35, k % 2 ? look.hazard : look.stripe, -ju, -js);
  }
  side(surface, fl, top - .35, fr, top - .35, bottom, bottom, look.steel, -ju, -js);
  for (let k = 0; k < 7; k++) {
    const a = -half + .5 + (2 * half - 1) * k / 6, out = .5 + ((k * 41) % 5) * .18, y = bottom + .25 + ((k * 29) % 3) * .28;
    block(surface, f, end.front - out / 2, a, .06, out, y, y + .06, look.rebar);
  }
}

// A mound: turf rising gently from the lawn to a rounded top, with a pair of
// worn tyre tracks over it the short way, where it is steepest, so it reads
// as something to jump. Faceted in strips along its long axis (the tracks
// are strips of their own), each spanning the mound from edge to edge.
const TURF = { lawn: COLOURS.lawn, worn: '#869c62', rut: '#7f6c50' };
function mound(c, site) {
  const { rx, rz, height, angle } = site.size, cx = site.u - c.east, cy = site.s - c.start, base = site.shape.base + LIFT;
  const cos = Math.cos(angle), sin = Math.sin(angle), surface = c.bodies, columns = 12;
  // (q is across the tracks, along the long axis, and p along them)
  const point = (q, p) => ({ x: cx + q * cos - p * sin, y: cy + q * sin + p * cos });
  const reach = q => rz * Math.sqrt(Math.max(0, 1 - (q / rx) ** 2));
  const h = (q, p) => { const f = (q / rx) ** 2 + (p / rz) ** 2; return base + height * Math.max(0, 1 - f) ** 2; };
  const rows = [.55, 1.05];
  for (let q = 1.05 + 2.2; q < rx - .6; q += 2.2) rows.push(q);
  rows.push(rx);
  const lines = [...rows.map(q => -q).reverse(), ...rows];
  for (let j = 0; j < lines.length - 1; j++) {
    const q0 = lines[j], q1 = lines[j + 1], r0 = reach(q0), r1 = reach(q1), middle = Math.abs(q0 + q1) / 2;
    const look = middle < .55 ? TURF.worn : middle < 1.05 ? TURF.rut : TURF.lawn;
    for (let i = 0; i < columns; i++) {
      const x0 = -1 + 2 * i / columns, x1 = -1 + 2 * (i + 1) / columns;
      // (the tracks stop short of the lawn, where the mound is barely off it)
      const colour = Math.max(Math.abs(x0), Math.abs(x1)) > .85 ? TURF.lawn : look;
      const a = point(q0, x0 * r0), b = point(q0, x1 * r0), cc = point(q1, x1 * r1), d = point(q1, x0 * r1);
      const ha = h(q0, x0 * r0), hb = h(q0, x1 * r0), hc = h(q1, x1 * r1), hd = h(q1, x0 * r1);
      // (a strip's outer edge at the mound's end is a point)
      if (r0 > 1e-6) surface.slope(a, ha, b, hb, cc, hc, colour);
      if (r1 > 1e-6) surface.slope(a, ha, cc, hc, d, hd, colour);
    }
  }
}
