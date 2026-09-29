import * as THREE from 'three';
import { PAVEMENT_LEVEL as G } from './city-route.js';
import { insidePolygon, offsetPolygon, offsetPolygonMapped, signedArea, calcPolygonArea } from '../mapgen/polygon-util.js';
import { intersection } from '../mapgen/booleans.js';

export const creamTrim = '#e4d2b0';
const signGeometry = new THREE.PlaneGeometry(1, 1);
const DOMESTIC_GLASS = ['#506971', '#405a65', '#617980'], OFFICE_GLASS = ['#638793', '#567783', '#71929b'];

export const ccw = polygon => signedArea(polygon) < 0 ? polygon.slice().reverse() : polygon;
// Andrew's monotone chain: the collision footprint has to be convex.
export function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 4) return sorted;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of sorted.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
// The pieces of a rectangle on a wall ({x0, x1, y0, y1}) outside a zone
function cutAround(pieces, z) {
  return pieces.flatMap(r => {
    if (r.x1 <= z.from || r.x0 >= z.to || r.y1 <= z.bottom || r.y0 >= z.top) return [r];
    const x0 = Math.max(r.x0, z.from), x1 = Math.min(r.x1, z.to);
    return [{ ...r, x1: z.from }, { ...r, x0: z.to }, { x0, x1, y0: r.y0, y1: z.bottom }, { x0, x1, y0: z.top, y1: r.y1 }]
      .filter(p => p.x1 - p.x0 > .05 && p.y1 - p.y0 > .05);
  });
}
// Coordinates on one wall of a building: offset along the wall from its
// middle, height, and distance outwards. The wall's own yaw turns each box.
// A sign mounted on the wall keeps its patch of wall `clear` ({from, to,
// bottom, top}): no window stands behind it, and the pilasters, fins and
// string courses that would cross it stop at its edges.
export function edgeFacade(c, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, span = Math.hypot(dx, dy) || 1, tx = dx / span, ty = dy / span, nx = ty, ny = -tx;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, yaw = Math.atan2(ty, tx);
  const point = (offset, outward) => ({ x: mx + tx * offset + nx * outward, s: my + ty * offset + ny * outward });
  return { span, yaw, street: false, clear: [], normal: { x: nx, y: ny },
    // A point's offset along the wall and distance out from it
    local(x, s) { const ex = x - mx, ey = s - my; return { offset: ex * tx + ey * ty, outward: ex * nx + ey * ny }; },
    // Whether a rectangle on the wall would stand behind a sign
    blocked(offset, y, w, h) { return this.clear.some(z => offset + w / 2 > z.from && offset - w / 2 < z.to && y + h / 2 > z.bottom && y - h / 2 < z.top); },
    // Whether the pavement in front of the wall at `offset`, `reach` metres
    // out and a little either side, is clear of `plots`: the building's own
    // footprint (a wing standing forward) and its neighbours' lots
    open(offset, reach) {
      return !(this.plots ?? []).some(plot => [-.35, .35].some(side => [.3, reach / 2, reach].some(out => {
        const p = this.position(offset + side, 0, out);
        return insidePolygon({ x: p[0], y: -p[2] }, plot);
      })));
    },
    position(offset, y, outward) { const p = point(offset, outward); return [p.x, y, -p.s]; },
    add(offset, y, outward, w, h, d, color, kind = 'solid', broad = false) {
      if (c.distant && kind === 'solid' && !broad) return;
      let pieces = [{ x0: offset - w / 2, x1: offset + w / 2, y0: y - h / 2, y1: y + h / 2 }];
      for (const z of this.clear) pieces = cutAround(pieces, z);
      // (a pilaster cut short by a sign stops, rather than leaving a stub
      // that looks like the sign's post)
      if (w < 1 && h > 3) pieces = pieces.filter(r => r.y1 - r.y0 >= Math.min(2.2, h - .01));
      for (const r of pieces) {
        const p = point((r.x0 + r.x1) / 2, outward), pw = r.x1 - r.x0, ph = r.y1 - r.y0, py = (r.y0 + r.y1) / 2;
        if (kind === 'inlay') {
          // Opaque inserts share the body's draw and need just two faces.
          const left = point(r.x0, outward + d / 2), right = point(r.x1, outward + d / 2);
          c.bodies.face(left.x, r.y0, -left.s, right.x, r.y0, -right.s, right.x, r.y1, -right.s, color);
          c.bodies.face(left.x, r.y0, -left.s, right.x, r.y1, -right.s, left.x, r.y1, -left.s, color);
        } else if (c.distant && (kind === 'glass' || kind === 'lit')) c.item(`distant-${kind}`, signGeometry, c.materials[kind], [p.x, py, -p.s], [pw, ph, 1], color, yaw);
        else c.box(p.x, py, p.s, pw, ph, d, color, kind, yaw);
      }
    } };
}

// A wall's window bays, .9 m in from each end of its front. The segments of
// a curved front share one run (`f.run`, see facadeRuns), laid out in groups
// of walls between bends, so each bay stays between two bends and the bays
// keep near one rhythm round the curve. The windows on this wall (their bay
// numbers and offsets from the wall's middle, a window over a bend inside a
// group of short walls nudged wholly onto one), the least spacing, and the
// piers between bays: one at each bend.
export function bayLayout(f, target, width = 0) {
  const run = f.run ?? { from: 0, length: f.span, groups: [[0, f.span]] }, half = f.span / 2;
  const at = d => d - run.from - half, own = o => o >= -half - 1e-6 && (o < half - 1e-6 || run.from + f.span > run.length - 1e-6);
  const windows = [], piers = [];
  let spacing = Infinity, bay = 0;
  // (a plain wall takes as many whole bays as fit; the groups of a run the
  // nearest number at the spacing that suits the whole run)
  const whole = run.length - 1.8, even = whole / Math.max(1, Math.round((whole + .2) / target));
  run.groups.forEach(([from, to], g) => {
    const start = from + (from === 0 ? .9 : 0), length = to - (to >= run.length - 1e-6 ? .9 : 0) - start;
    const bays = Math.max(1, f.run ? Math.round(length / even) : Math.floor((length + .2) / target)), step = length / bays;
    const mine = to > run.from - 1e-6 && from < run.from + f.span + 1e-6;
    if (mine) spacing = Math.min(spacing, step);
    for (let k = 0; k < bays; k++, bay++) {
      const o = at(start + (k + .5) * step), room = Math.max(0, half - Math.min(width, step - .5) / 2 - .05);
      if (own(o)) windows.push({ bay, offset: Math.max(-room, Math.min(room, o)) });
    }
    for (let k = g ? 1 : 0; k <= bays; k++) if (own(at(start + k * step))) piers.push(at(start + k * step));
  });
  return { spacing: Number.isFinite(spacing) ? spacing : f.span - 1.8, windows, piers };
}

// A wall's upper windows: their width, where they stand and the piers
// between them (see bayLayout), by the kind of building, and how far out
// from the wall the pilasters or fins on its piers come (`pierFront`)
const PIER_PILASTERS = { deco: [.18, .38, .4], atrium: [.4, .25, .85], pavilion: [.4, .25, .85] };
const FIN_RENDER = new THREE.Color('#efe6d3'), fins = new Map();
const paleFin = wall => { let colour = fins.get(wall); if (!colour) fins.set(wall, colour = `#${new THREE.Color(wall).lerp(FIN_RENDER, .5).getHexString()}`); return colour; };
export function windowBays(b, f) {
  const modern = b.type === 'office' || b.type === 'atrium', loft = b.type === 'warehouse' || b.type === 'loft';
  const target = modern ? 4.4 : loft ? 6.5 : b.variation === 1 ? 5.6 : 4.8, { spacing } = bayLayout(f, target);
  const windowWidth = Math.min(modern ? spacing - .36 : loft ? Math.min(3.7, spacing - 1) : b.variation === 2 ? 2.25 : 1.65, spacing - .5);
  const pilaster = PIER_PILASTERS[b.type];
  return { windowWidth, pierFront: pilaster ? pilaster[0] + pilaster[2] / 2 : 0, ...bayLayout(f, target, windowWidth + .25) };
}
export function edgeWindows(c, b, f, bottom, floors, random) {
  const modern = b.type === 'office' || b.type === 'atrium', loft = b.type === 'warehouse' || b.type === 'loft', span = f.span;
  if (span < 3.2 && !f.run) return;
  const bays = windowBays(b, f), { windows, piers } = bays;
  // (a window on a curved front is no wider than its own short wall, so it
  // never reaches over a bend and stands off the next wall)
  const windowWidth = f.run ? Math.min(bays.windowWidth, span - .35) : bays.windowWidth, edge = Math.max(0, span / 2 - (windowWidth + .25) / 2 - .02);
  // On a curved front a window's frame stays on its own wall, clear of the
  // bend, and of two windows nudged onto one short wall the first is kept
  const kept = [], shown = windows.map(({ offset }) => {
    if (!f.run) return offset;
    const at = Math.max(-edge, Math.min(edge, offset));
    if (kept.some(other => Math.abs(other - at) < windowWidth + .3)) return null;
    kept.push(at); return at;
  });
  const h = loft ? 2.45 : modern ? 2.75 : 2.2, frame = b.type === 'brick' || b.type === 'townhouse' ? '#e0ccab' : '#b3c5bc';
  for (let floor = 0; floor < floors; floor++) {
    const y = bottom + 1.7 + floor * 3.6;
    if (modern) f.add(0, y - 1.42, .1, span + .1, .28, .3, '#b6c9c8', 'solid', true);
    if (b.type === 'deco' && floor === floors - 1) f.add(0, y + 1.55, .2, span + .4, .35, .5, '#ded2b8', 'solid', true);
    for (const [k, { bay }] of windows.entries()) {
      const offset = shown[k], occupancy = random(), lit = occupancy < .1;
      if (offset === null || windowWidth < .6) continue;
      // Balconies stack over one another, with a glazed door down to the
      // deck. The other bays keep their ordinary windows and sills.
      const balcony = b.type === 'apartment' && f.street && bay % 3 === b.variation % 3 && span >= windowWidth + 1.7;
      const height = balcony ? 2.58 : h, centre = balcony ? y - .19 : y;
      // (no window, sill or balcony behind a sign)
      if (f.clear.length && f.blocked(offset, y - .3, windowWidth + 1.2, h + 1.2)) continue;
      f.add(offset, centre, .075, windowWidth + .25, height + .25, .11, frame);
      // Quiet changes of glazing and partly lowered blinds break the repeated
      // black grid. Reuse this window's existing draw, never the city's stream.
      const palette = modern ? OFFICE_GLASS : DOMESTIC_GLASS;
      const glass = palette[Math.min(2, Math.floor(occupancy * 3))];
      const blind = !lit && !loft && !balcony && occupancy > .73 ? height * (occupancy > .9 ? .43 : .23) : 0;
      // The blind occupies its own part of the opening, with no overlapping
      // glazing faces or close parallel layers to flicker down the street.
      f.add(offset, centre - blind / 2, .17, windowWidth, height - blind, .09, lit ? '#e3c38d' : glass, lit ? 'lit' : 'glass');
      if (blind) f.add(offset, centre + (height - blind) / 2, .17, windowWidth, blind, c.distant ? 0 : .09, modern ? '#a5b3ad' : '#c5baa3', 'inlay');
      if (loft || b.variation === 1) f.add(offset, y, .25, .09, h, .07, frame);
      if (!modern && !balcony) f.add(offset, y - h / 2 - .14, .25, windowWidth + .44, .14, .48, frame);
      if (b.type === 'townhouse') {
        // (down to the top of the sill they flank, not hanging just above it)
        for (const sign of [-1, 1]) f.add(offset + sign * (windowWidth / 2 + .4), y - .035, .2, .5, h + .07, .15, b.accent, 'solid', true);
        f.add(offset, y, .265, windowWidth, .12, .1, creamTrim);
      }
      if (b.type === 'loft') f.add(offset, y, .265, windowWidth, .12, .1, '#c8bda8');
      if (balcony) {
        f.add(offset, y - 1.58, .68, windowWidth + 1.1, .2, 1.5, '#d1c9b5', 'solid', true);
        // Lower privacy panels with an open handrail above: a balcony reads
        // as usable space instead of a coloured box pasted onto the wall.
        f.add(offset, y - 1.18, 1.36, windowWidth + 1.1, .6, .12, b.accent, 'solid', true);
        f.add(offset, y - .57, 1.36, windowWidth + 1.16, .08, .12, '#495b5c');
        for (const edge of [-1, 1]) {
          const end = offset + edge * (windowWidth + .95) / 2;
          f.add(end, y - 1.18, .65, .1, .6, 1.3, b.accent);
          f.add(end, y - .73, 1.36, .07, .32, .08, '#495b5c');
          f.add(end, y - .57, .65, .08, .08, 1.3, '#495b5c');
        }
        if ((floor + bay + b.variation) % 3 === 0) f.add(offset, y - .84, 1.13, windowWidth * .7, .24, .38, '#6e8856');
      }
    }
  }
  // (pilasters, fins and string courses stop under the cornice or eaves that
  // cap the wall, rather than meeting its faces)
  const rise = floors * 3.6 - .12;
  const pilaster = PIER_PILASTERS[b.type];
  if (b.type === 'deco') for (const pier of piers) f.add(pier, bottom + rise / 2, pilaster[0], pilaster[1], rise, pilaster[2], '#cfbea2', 'solid', true);
  if (b.type === 'loft' || b.type === 'townhouse') for (let floor = 1; floor < floors; floor++) {
    f.add(0, bottom + floor * 3.6 - .12, .16, span + .2, b.type === 'loft' ? .4 : .22, .3, '#d6c1a0', 'solid', true);
  }
  // (a pavilion's fins are its own wall in a paler render: a fixed timber
  // brown stood out as stripes on blue and green walls)
  const fin = b.type === 'pavilion' ? paleFin(b.wall) : '#d5d9bd';
  if (b.type === 'atrium' || b.type === 'pavilion') for (const pier of piers) {
    f.add(pier, bottom + rise / 2, pilaster[0], pilaster[1], rise, pilaster[2], fin, 'solid', true);
  }
}

export function shopAwning(c, f, offset, width, accent, variation) {
  const stripes = !c.distant && variation % 2 === 0 ? 8 : 1;
  const reach = 1.4 + variation * .16, back = G + 3.52, front = G + 3.04;
  const quad = (a, b, d, e, colour) => {
    c.bodies.face(...a, ...b, ...d, colour); c.bodies.face(...a, ...d, ...e, colour);
    c.bodies.face(...d, ...b, ...a, colour); c.bodies.face(...e, ...d, ...a, colour);
  };
  // At a distance a cream-striped canopy keeps its average colour.
  const plain = c.distant && variation % 2 === 0 ? new THREE.Color(accent).lerp(new THREE.Color('#e6d8b8'), .5) : accent;
  for (let stripe = 0; stripe < stripes; stripe++) {
    const left = offset + (stripe / stripes - .5) * width, right = left + width / stripes;
    const colour = stripes > 1 && stripe % 2 === 0 ? '#e6d8b8' : plain;
    const a = f.position(left, back, .2), b = f.position(right, back, .2);
    const d = f.position(right, front, reach), e = f.position(left, front, reach);
    quad(a, b, d, e, colour);
    quad(e, d, f.position(right, front - .2, reach), f.position(left, front - .2, reach), colour);
  }
}

// The flat top between two rings of the same size
function cap(bodies, a, b, y, colour) {
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    bodies.flat(a[i], a[j], b[j], y, colour); bodies.flat(a[i], b[j], b[i], y, colour);
  }
}
// A cornice, a parapet and the roof deck inside it, with the same again round
// any courtyard. Returns the deck polygon and the holes in it.
// A wall shared with the house next door carries its cornice only to the lot
// line (`reach` gives each wall's), where the neighbour's meets it; and no
// cornice reaches past its lot (`within`) at all. (The reach alone let two
// neighbours' cornices overlap where a wall stood nearer its lot line than
// the district's setback, their tops flickering through each other.)
export function cornice(bodies, ring, top, trim, roofColour, wall, parapet, courts = [], reach = null, within = null) {
  let band = (reach && signedArea(ring) > 0 && offsetPolygonMapped(ring, (p, q, k) => reach(k))?.points) || offsetPolygon(ring, .32);
  if (within?.length >= 3 && band.length >= 3) band = intersection([ccw(band)], [ccw(within)]).sort((p, q) => calcPolygonArea(q.outer) - calcPolygonArea(p.outer))[0]?.outer ?? band;
  const courtBands = courts.map(court => offsetPolygon(court, -.32)).filter(p => p.length >= 3);
  if (band.length >= 3) { bodies.prism(band, top - .3, top + .12, trim); bodies.polygon(band, top + .12, trim, null, true, courtBands); }
  else bodies.polygon(ring, top + .12, trim, null, true, courtBands);
  for (const courtBand of courtBands) bodies.wall(ccw(courtBand), top + .12, top - .3, trim, true);
  const inner = offsetPolygon(ring, -.32);
  bodies.prism(ring, top + .12, top + .12 + parapet, wall);
  if (inner.length >= 3) {
    bodies.wall(ccw(inner), top + .12 + parapet, top + .12, wall, true);
    if (inner.length === ring.length) cap(bodies, ring, inner, top + .12 + parapet, wall);
  }
  const holes = [];
  for (const court of courts) {
    const outer = offsetPolygon(court, .32);
    bodies.wall(ccw(court), top + .12 + parapet, top + .12, wall, true);
    if (outer.length >= 3) {
      bodies.prism(outer, top + .12, top + .12 + parapet, wall);
      if (outer.length === court.length) cap(bodies, court, outer, top + .12 + parapet, wall);
    }
    holes.push(outer.length >= 3 ? outer : court);
  }
  const deck = inner.length >= 3 ? inner : ring;
  bodies.polygon(deck, top + .18, roofColour, null, true, holes);
  return { deck, holes };
}

// How far a ray from p along (dx, dy) runs before it leaves a polygon
export function exitDistance(p, dx, dy, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], q = polygon[(i + 1) % polygon.length], ex = q.x - a.x, ey = q.y - a.y, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den, u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}
