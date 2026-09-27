import { PAVEMENT_LEVEL as G } from './city-route.js';
import { SIGNS_BY_USE, dealSign } from './city-signs.js';

// Every business says what it is in the way its building allows, with a sign
// from the sheet (city-sign-sheet.js) chosen for that use:
//   a shopfront: its name on the fascia, and a squarish one also hung from a
//     bracket at the end of the shop; stickers and cards in its windows; or,
//     standing empty, a letting board and a poster in the window
//   an upstairs business over a shop, on a sign standing out from the wall
//     beside the first-floor windows, over the upstairs door
//   an office: its name standing on the lobby canopy, and on a tower on a
//     frame on the roof, over the main front
//   a warehouse: its trade on the wall over the loading door
//   a tall block of flats, now and then: its name on the roof
// Which, and whether, comes from a hash of the building (never the city's
// random stream), so a building keeps its signs whatever is built around it.
const VACANT = .06, UPSTAIRS = { Midtown: .16, 'Market district': .16, 'Old town': .12 }, OTHERWISE = .05;
const CROWN = .6, WORKS = .75, HOME = .12;
const COMMERCIAL = new Set(['office', 'atrium', 'deco']);
// (an empty shop's broad letting board for the fascia, and its window poster)
const BOARD = SIGNS_BY_USE.vacant.find(sign => sign.aspect > 2), POSTER = SIGNS_BY_USE.vacant.find(sign => sign.aspect <= 2);
const mix = n => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const roll = (b, salt) => mix((b.seed ^ Math.imul(salt, 0x27d4eb2d)) >>> 0) / 2 ** 32;
// Squarish signs read best hanging over the pavement as well
export const hangs = sign => sign.aspect < 1.45;

export function buildingSignage(b) {
  const signs = {}, flat = b.roofType === 'flat' || b.roofType === 'terrace';
  if (b.shopfront) {
    if (roll(b, 1) < VACANT) signs.vacant = { board: roll(b, 2) < .5 ? BOARD : null, poster: POSTER };
    else {
      signs.shop = dealSign(b, 'shop');
      // (none, one or two, and never the same sticker twice)
      const count = [0, 0, 1, 1, 1, 2, 2][Math.floor(roll(b, 3) * 7)], decals = SIGNS_BY_USE.decal;
      const first = Math.floor(roll(b, 4) * decals.length);
      signs.decals = Array.from({ length: count }, (_, k) => decals[(first + k * 5) % decals.length]);
    }
    if (roll(b, 5) < (UPSTAIRS[b.district] ?? OTHERWISE)) {
      const upstairs = SIGNS_BY_USE.upstairs, dealt = dealSign(b, 'upstairs');
      signs.upstairs = dealt === signs.shop ? upstairs[(upstairs.indexOf(dealt) + 1) % upstairs.length] : dealt;
    }
  }
  if (COMMERCIAL.has(b.type)) {
    const firm = dealSign(b, 'firm');
    if (b.type !== 'deco') signs.lobby = firm;
    if (b.floors >= 5 && flat && roll(b, 6) < CROWN) signs.crown = firm;
  }
  if (b.type === 'warehouse' && roll(b, 7) < WORKS) signs.works = dealSign(b, 'works');
  if (b.type === 'apartment' && b.floors >= 5 && flat && roll(b, 8) < HOME) signs.crown = dealSign(b, 'home');
  return signs;
}

// Where along a front a sign goes, and how big: over the middle, unless a
// street tree's crown or a lamp's column stands in front of it there. Then
// it moves over one of the shop's windows or its door (`centres`), or to one
// end of the fascia, a little smaller if need be, if far less of it is hidden.
const IN_FRONT = { lamp: .3, 'median-lamp': .3, lantern: .3, 'street-lantern': .3, signal: .3 };
function obstaclesBefore(c, f) {
  const obstacles = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const piece of c.world?.furnitureByChunk?.get(`${c.ix + dx},${c.iz + dz}`) ?? []) {
    const reach = piece.kind === 'tree' ? piece.scale * .52 : IN_FRONT[piece.kind] ?? 0;
    if (!reach) continue;
    const q = f.local(piece.u - c.east, piece.s - c.start);
    if (q.outward > .5 && q.outward < 9 && Math.abs(q.offset) < f.span / 2 + reach) obstacles.push({ ...q, reach });
  }
  return obstacles;
}
function signPlace(c, f, w, centres) {
  const obstacles = obstaclesBefore(c, f), centre = { offset: 0, scale: 1 };
  if (!obstacles.length) return centre;
  // (the share of the sign hidden, from straight across the street)
  const hidden = (o, width) => obstacles.reduce((sum, p) => sum + Math.max(0, Math.min(o + width / 2, p.offset + p.reach) - Math.max(o - width / 2, p.offset - p.reach)), 0) / width;
  let best = centre, least = hidden(0, w);
  for (const scale of [1, .8]) {
    const end = f.span / 2 - 1.3 - w * scale / 2;
    for (const offset of [...centres, end, -end]) {
      if (Math.abs(offset) > end + 1e-6) continue;
      const share = hidden(offset, w * scale) + (1 - scale) * .5;
      if (share < least - .1) { best = { offset, scale }; least = share; }
    }
  }
  return best;
}
// Whether a sign standing out `reach` metres from the wall at `offset` is
// clear of the trees' crowns and the lamps along the pavement, and of any
// wall standing forward of this one (see edgeFacade's open)
function clearAt(c, f, offset, reach) {
  return (f.open?.(offset, reach) ?? true) && !obstaclesBefore(c, f).some(p => Math.abs(p.offset - offset) < p.reach + .4 && p.outward - p.reach < reach + .4);
}

// A board flat on the wall, `out` metres proud of it, with the dark edge of
// the board round it (cut-out letters have none)
function wallSign(c, f, sign, offset, y, w, h, out) {
  const p = f.position(offset, y, out + (sign.letters ? 0 : .05));
  c.signFace('shop-signs', sign, p[0], p[1], -p[2], f.yaw, w, h, sign.letters ? null : .05, .05);
}
// A sign standing out from the wall at `offset`, its inner edge `wall` metres
// out, the bottom at `bottom`: painted both sides, hung from an arm over it
// when it is squarish, fixed by an arm at its top and foot when it is tall
function projectingSign(c, f, sign, offset, bottom, width, wall) {
  const h = width / sign.aspect, out = wall + .12 + width / 2, p = f.position(offset, bottom + h / 2, out);
  c.doubleSign('shop-signs', sign, p[0], p[1], -p[2], f.yaw + Math.PI / 2, width, h, .03, .04);
  const iron = '#2f3538', reach = .12 + width + (h > width * 1.3 ? -.1 : .12);
  if (h > width * 1.3) for (const y of [bottom + .15, bottom + h - .15]) f.add(offset, y, wall + reach / 2, .05, .06, reach, iron);
  else {
    const arm = bottom + h + .14;
    f.add(offset, arm, wall + reach / 2, .05, .06, reach, iron);
    f.add(offset, arm, wall + .04, .1, .26, .08, iron);
    for (const at of [out - width * .36, out + width * .36]) f.add(offset, (arm + bottom + h) / 2, at, .025, arm - bottom - h, .025, iron);
  }
}

// A shopfront's signs, in the shop's own coordinates: its fascia board runs
// from `bottom` to `top` (heights over the pavement) along the whole front;
// `centres` are where the name may move to (see signPlace), `panes` its
// display windows ({ offset, width, mullion }) and `door` its door's offset.
// Only the main front has the hanging sign, the stickers and the posters.
export function shopSigns(c, b, f, { bottom, top, centres, panes, door, primary }) {
  if (c.distant) return;
  const signs = b.signs ?? buildingSignage(b), sign = signs.shop ?? signs.vacant?.board;
  let fascia = null;
  if (sign) {
    // As big as the board allows, no wider than most of the front or 7.5 m,
    // and high enough that the awnings below hide none of it from across
    // the street
    const full = Math.min(1.3, top - bottom - .24, (f.span - .9) / sign.aspect, 7.5 / sign.aspect);
    const { offset, scale } = signPlace(c, f, full * sign.aspect, centres), h = full * scale, w = h * sign.aspect;
    wallSign(c, f, sign, offset, G + Math.min(top - .1 - h / 2, Math.max((top + bottom) / 2, 3.92 + h / 2)), w, h, .29);
    fascia = { from: offset - w / 2, to: offset + w / 2 };
  }
  if (!primary) return;
  // The hanging sign goes at the end away from the door, clear of the name
  // on the fascia and of the street trees
  if (signs.shop && hangs(signs.shop)) {
    const width = 1.15, end = door > 0 ? -1 : 1, offset = end * (f.span / 2 - .45);
    if (!(fascia && offset + .1 > fascia.from && offset - .1 < fascia.to) && clearAt(c, f, offset, 1.7)) {
      projectingSign(c, f, signs.shop, offset, G + bottom + .12, width, .28);
    }
  }
  const glass = .235, corners = panes.flatMap(pane => [-1, 1].map(edge => ({ pane, edge })))
    .sort((a, b) => Math.abs(a.pane.offset + a.edge * a.pane.width / 2 - door) - Math.abs(b.pane.offset + b.edge * b.pane.width / 2 - door));
  if (signs.vacant) {
    // A letting poster in the window nearest the door, beside its mullion
    const poster = signs.vacant.poster, pane = corners[0]?.pane;
    if (!pane) return;
    const room = pane.mullion ? pane.width / 2 - .2 : pane.width - .3, h = Math.min(.75, room / poster.aspect), w = h * poster.aspect;
    const offset = pane.mullion ? pane.offset + corners[0].edge * (w / 2 + .12) : pane.offset;
    const p = f.position(offset, G + 1.62, glass);
    c.signFace('shop-signs', poster, p[0], p[1], -p[2], f.yaw, w, h, null);
    return;
  }
  // Stickers and cards in the bottom corners of the windows, those by the
  // door first: a strip along the top of the glass, the rest at eye level
  let used = 0;
  for (const decal of signs.decals ?? []) {
    const h = decal.size, w = h * decal.aspect;
    while (used < corners.length) {
      const { pane, edge } = corners[used++], room = pane.mullion ? pane.width / 2 - .1 : pane.width;
      if (w > room - .3) continue;
      const y = decal.aspect > 5 ? G + 2.5 : G + Math.max(.9 + h / 2, 1.45);
      const p = f.position(pane.offset + edge * (pane.width / 2 - .14 - w / 2), y, glass);
      c.signFace('shop-signs', decal, p[0], p[1], -p[2], f.yaw, w, h, null);
      break;
    }
  }
}

// An upstairs business's sign, standing out from the wall at one of the
// piers beside the first-floor windows (`bays`: see windowBays), the one
// nearest the `side` end (a narrow front's pier by the corner, then) that
// has room between the windows' balconies and pilasters, fixed to the face
// of any pilaster on the pier itself. `floor` is the height of the first
// floor and `eaves` the top of the wall.
export function upstairsSign(c, f, sign, bays, side, floor, eaves) {
  if (c.distant || !sign) return;
  // (a tall sign or a broad one wider than a squarish one)
  const bottom = floor + .5, width = Math.min(sign.aspect < .8 ? 1.4 : sign.aspect > 1.5 ? 1.6 : 1.15, (eaves - .5 - bottom) * sign.aspect);
  if (width < .6) return;
  const pier = bays.piers.filter(offset => Math.abs(offset) < f.span / 2 - .8 && bays.windows.every(w => Math.abs(w.offset - offset) >= bays.windowWidth / 2 + .7))
    .sort((a, b) => side * (b - a)).find(offset => clearAt(c, f, offset, bays.pierFront + width + .4));
  if (pier !== undefined) projectingSign(c, f, sign, pier, bottom, width, bays.pierFront);
}

// A name on the roof over a front, standing on a steel frame just behind its
// parapet (`roof`, the roof's surface, and `parapet`, the parapet's top), as
// broad as fits within the corners. The roof's plant keeps 1.2 m in from the
// parapet; the strip the frame takes is returned for the chimneys to keep
// out of, as a polygon in the chunk's coordinates.
export function crownSign(c, f, sign, roof, parapet) {
  if (!sign) return null;
  // (a squarish logo or cut-out letters taller than a name on a board)
  const h = Math.min(sign.letters || sign.aspect < 2 ? 3.4 : 2.6, (f.span - 2.4) / sign.aspect, 18 / sign.aspect), w = h * sign.aspect;
  if (h < 1.2) return null;
  const strip = [[-w / 2 - .9, .1], [w / 2 + .9, .1], [w / 2 + .9, -1.6], [-w / 2 - .9, -1.6]].map(([along, out]) => {
    const p = f.position(along, 0, out);
    return { x: p[0], y: -p[2] };
  });
  if (c.distant) return strip;
  const bottom = parapet + .25, face = sign.letters ? -.6 : -.45, iron = '#3d4246';
  const p = f.position(0, bottom + h / 2, face);
  c.signFace('shop-signs', sign, p[0], p[1], -p[2], f.yaw, w, h, sign.letters ? null : .05, .06);
  // (posts from the roof up the back of the board, and a rail under it)
  const posts = Math.max(2, Math.ceil(w / 3.5) + 1), top = bottom + h * (sign.letters ? .35 : .85);
  for (let k = 0; k < posts; k++) f.add((k / (posts - 1) - .5) * (w - .7), (roof + top) / 2, -.68, .1, top - roof, .1, iron);
  f.add(0, bottom - .04, -.68, w - .5, .08, .08, iron);
  return strip;
}

// An office's name standing on its lobby canopy (the canopy's top at `top`,
// reaching `reach` out from the wall, `width` across), unless a street
// tree's crown reaches over it
export function lobbySign(c, f, sign, top, reach, width) {
  if (c.distant || !sign) return;
  const h = Math.min(sign.aspect < 2 ? 1.1 : .8, (width - .3) / sign.aspect), w = h * sign.aspect;
  if (obstaclesBefore(c, f).some(p => Math.abs(p.offset) < p.reach + w / 2 && p.outward - p.reach < reach)) return;
  const p = f.position(0, top + .06 + h / 2, reach - .25);
  c.signFace('shop-signs', sign, p[0], p[1], -p[2], f.yaw, w, h, sign.letters ? null : .05, .05);
}

// A warehouse's trade on the wall over its loading door's canopy (its top
// at `top`, `width` across), below the windows of the floor over it
export function worksSign(c, f, sign, top, width) {
  if (c.distant || !sign) return;
  const h = Math.min(sign.aspect < 2.5 ? 1.4 : 1.2, (width - .6) / sign.aspect, f.span * .8 / sign.aspect), w = h * sign.aspect;
  if (h < .55) return;
  wallSign(c, f, sign, 0, top + .14 + h / 2, w, h, .08);
}
