import { CITY, SIDEWALK } from './city.js';
import { PAVEMENT_LEVEL } from './city-route.js';
import { randomAt } from './route.js';
import { cityTrees } from './city-assets.js';
import { growRound } from '../mapgen/booleans.js';
import { offsetPolygon, insideIndexed, calcPolygonArea } from '../mapgen/polygon-util.js';

// Where people walk. A pavement is two bands: the furniture stands toward the
// curb (lamps, trees, bins, shelters, signs), and people walk the clear band
// along the lot line, WALK_OUT m out from it, a pair's two tracks PAIR either
// side of that. The lot line stays where it is whatever the pavement's width,
// so the walk is measured from it and never from the curb.
// A block's walk is routed when first wanted: bent toward the wall or the
// curb round whatever still stands in its way, by the furniture's own
// footprints, and again round anything a chunk's colliders show standing in
// it once that chunk is built (see survey: a tower's straight wall across a
// lot line that curves in, a venue's steps). Everyone on a loop goes round it
// one way at one pace (`direction`, `pace`), so nobody meets anybody head on
// or overtakes.
export const WALK_OUT = 1.2, PAIR = .46, BODY = .25;
// Where a walk is too narrow for a pair, they go shoulder to shoulder, CLOSE
// of their usual way apart. Too narrow for that, one goes behind the other, FILE m back
export const CLOSE = .65, FILE = .9;
// A walk is sampled every STEP m and moves aside no faster than SLOPE (m per
// m), keeps MARGIN clear of what it passes, WALL off the lot line (a garden
// wall's thickness) and KERB off the curb's edge
const STEP = .5, SLOPE = .35, MARGIN = .08, WALL = .2, KERB = .35, HALF = PAIR + BODY;
// How far toward the curb a walk may be bent (m)
const OUT_MOST = 1.6;

// What stands on a pavement, as the colliders have it (see
// CityChunk.furnitureSteps, which these follow): a post's radius, or a box
// [across, along, forward] in the piece's own frame (its yaw turns +x to `across`)
const POSTS = { lamp: .19, 'median-lamp': .19, bin: .29, bollard: .16, stop: .055, yield: .055, 'parking-sign': .045, lantern: .2, hydrant: .2, 'post-box': .28 };
const BOXES = { bench: [.7, 2, 0], cabinet: [.5, .9, 0], 'news-boxes': [.5, 1.65, 0], 'bike-rack': [.8, 1.3, 0], shelter: [1, 4, .25] };
// A shelter's bench and back as one box (see the shelter's collider), and its flag's post
export const SHELTER_BOX = BOXES.shelter, SHELTER_FLAG = { x: -.9, z: 1.6, radius: .06 };
// A tree's trunk as drawn, by its scale: the widest of the models at its
// foot, at the widest a tree of that scale is drawn (see CityChunk.tree)
const TRUNK = Math.max(...cityTrees.map(tree => {
  const p = tree.bark.attributes.position;
  let most = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < .25) most = Math.max(most, Math.hypot(p.getX(i), p.getZ(i)));
  return most;
})) * 1.06;

const CELL = 4, key = (ix, iy) => ix * 65536 + iy;
const span = { low: 0, high: 0, across: 0, gap: 0 };

export class WalkSpace {
  constructor() {
    this.cells = new Map(); this.loops = new Map(); this.surveyed = new Set();
    // (where a bus stop's riders wait: nobody else stands there)
    this.waits = [];
    this.routed = 0; this.stamp = 0;
  }
  // Something standing there: a disc, or (to `bx`, `by`) a wall's face that thick
  obstacle(x, y, radius, group, bx = x, by = y) {
    const item = { x, y, bx, by, radius, group, seen: 0 };
    const x0 = Math.floor((Math.min(x, bx) - radius) / CELL), x1 = Math.floor((Math.max(x, bx) + radius) / CELL), y0 = Math.floor((Math.min(y, by) - radius) / CELL), y1 = Math.floor((Math.max(y, by) + radius) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      const k = key(ix, iy);
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, list = []);
      list.push(item);
    }
  }
  // A box as a row of discs down its longer side, close enough together to
  // cover its corners at a hair over its half width each
  box(x, y, yaw, across, along, forward, group) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw), cx = x + cos * forward, cy = y + sin * forward;
    const long = Math.max(across, along) / 2, short = Math.min(across, along) / 2, radius = short * 1.03, reach = Math.max(0, long - short * .24);
    // (the longer side's way: across is along (cos, sin), along is (-sin, cos))
    const ax = across > along ? cos : -sin, ay = across > along ? sin : cos, count = Math.ceil(2 * reach / (short * .48));
    for (let i = 0; i <= count; i++) { const d = count ? -reach + 2 * reach * i / count : 0; this.obstacle(cx + ax * d, cy + ay * d, radius, group); }
  }
  // A piece of street furniture (see placeStreetFurniture) as what it takes up
  add(piece) {
    const kind = piece.kind, x = piece.u, y = piece.s, yaw = piece.yaw ?? 0, group = { kind };
    if (POSTS[kind]) this.obstacle(x, y, POSTS[kind], group);
    else if (kind === 'tree') this.obstacle(x, y, Math.max(.28, TRUNK * piece.scale), group);
    else if (BOXES[kind]) {
      this.box(x, y, yaw, ...BOXES[kind], group);
      // (a model's +z lies along (sin yaw, -cos yaw): see city-layout-render.js)
      if (kind === 'shelter') this.waits.push({ x: x - Math.cos(yaw), y: y - Math.sin(yaw), radius: 2.6 });
      if (kind === 'shelter') this.obstacle(x + Math.cos(yaw) * SHELTER_FLAG.x + Math.sin(yaw) * SHELTER_FLAG.z, y + Math.sin(yaw) * SHELTER_FLAG.x - Math.cos(yaw) * SHELTER_FLAG.z, SHELTER_FLAG.radius, group);
    }
    else if (kind === 'signal') this.obstacle(x, y, piece.mast ? .21 : .08, group);
    // (a board low enough to walk into, on its two posts)
    else if (kind === 'sign') this.box(x, y, yaw, piece.width ?? 4.2, .3, 0, group);
    else if (kind === 'fountain') this.obstacle(x, y, 3.5 * (piece.size ?? 1), group);
    else if (kind === 'rim') this.obstacle(x, y, piece.radius, group);
    else if (kind === 'bandstand') this.obstacle(x, y, 5.6, group);
    // (one length with round ends: as a row of discs each, the railings were five in six of everything the walks kept, 40 MB of it)
    else if (kind === 'railing') { const half = Math.max(0, (piece.length ?? 4) / 2 - .12), ax = -Math.sin(yaw) * half, ay = Math.cos(yaw) * half; this.obstacle(x - ax, y - ay, .125, group, x + ax, y + ay); }
  }
  // Whether a body of `radius` at (x, y) stands clear of what stands there by `margin`
  clear(x, y, radius = BODY, margin = 0) {
    return !this.near(x, y, radius + margin);
  }
  // Whether someone of `radius` can stand and wait at (x, y): clear of what
  // stands there, of a bus stop's riders and of where a block's people walk
  free(x, y, radius = BODY) {
    if (this.near(x, y, radius + MARGIN)) return false;
    for (const wait of this.waits) if ((wait.x - x) ** 2 + (wait.y - y) ** 2 < (wait.radius + radius) ** 2) return false;
    const place = CITY.pavement.find(x, y), loop = place?.kind === 'block' ? this.block(place.block) : null;
    if (!loop) return true;
    const points = loop.points, reach = (HALF + radius) ** 2;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const t = length > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
      if ((x - a.x - dx * t) ** 2 + (y - a.y - dy * t) ** 2 < reach) return false;
    }
    return true;
  }
  // The first thing within `reach` of (x, y), or null
  near(x, y, reach) {
    // (a piece is in every cell it reaches into, so the cells within reach are enough)
    const x0 = Math.floor((x - reach) / CELL), x1 = Math.floor((x + reach) / CELL), y0 = Math.floor((y - reach) / CELL), y1 = Math.floor((y + reach) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      const list = this.cells.get(key(ix, iy));
      if (list) for (const item of list) if (offBy(item, x, y) < reach) return item;
    }
    return null;
  }
  // Whether the straight way from a to b ({ x, y }) is clear for a body
  open(a, b, radius = BODY, margin = MARGIN) {
    const length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(length / .3));
    for (let i = 0; i <= steps; i++) if (this.near(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, radius + margin)) return false;
    return true;
  }
  // A block's walk: { index, points, cumulative, perimeter, direction, pace,
  // tight }, or null if it has none
  block(index) {
    if (!this.loops.has(index)) {
      const block = CITY.blocks[index];
      let loop = null;
      if (block?.kerb.length >= 3) {
        // (a block with no lot line, a broken one, keeps to the same way in from its curb)
        const base = block.inner?.length >= 3 ? largest(growRound([block.inner], WALK_OUT)) : offsetPolygon(block.kerb, -(SIDEWALK - WALK_OUT));
        loop = this.lay(base, block.kerb, index, WALK_OUT - HALF - WALL);
      }
      this.loops.set(index, loop);
    }
    return this.loops.get(index);
  }
  // The walk along a big park's pavement, which is too narrow for a band of
  // its own: just inside its lawn's edge
  park(index) {
    const id = -1 - index;
    if (!this.loops.has(id)) {
      const park = CITY.parkPlans[index];
      this.loops.set(id, park?.kerb.length >= 3 && park.lawn?.length >= 3 ? this.lay(offsetPolygon(park.lawn, -(HALF + WALL)), park.kerb, id, 1.5) : null);
    }
    return this.loops.get(id);
  }
  // A walk along `base` (a ring, anticlockwise) inside `kerb`, with `room` to
  // give toward the wall: sampled evenly, and routed. Its people are placed
  // by how far round the base they are (`cumulative`, `perimeter`), so
  // routing it again round something new moves nobody along it.
  lay(base, kerb, index, room) {
    if (base.length < 3) return null;
    let length = 0;
    const n = base.length;
    for (let i = 0; i < n; i++) { const a = base[i], b = base[(i + 1) % n]; length += Math.hypot(b.x - a.x, b.y - a.y); }
    if (length < 30) return null;
    // (kept for routing it again: single precision, a tenth of a millimeter here, is plenty)
    const count = Math.ceil(length / STEP), spacing = length / count, px = new Float32Array(count), py = new Float32Array(count);
    for (let i = 0, k = 0, done = 0, want = 0; i < n && k < count; i++) {
      const a = base[i], b = base[(i + 1) % n], side = Math.hypot(b.x - a.x, b.y - a.y);
      for (; k < count && want <= done + side; k++, want = k * spacing) { const t = side > 1e-9 ? (want - done) / side : 0; px[k] = a.x + (b.x - a.x) * t; py[k] = a.y + (b.y - a.y) * t; }
      done += side;
    }
    // (the way out to the curb at each sample, and how far out leaves a pair
    // on the pavement, KERB off its edge)
    const nx = new Float32Array(count), ny = new Float32Array(count), most = new Float32Array(count), probe = { x: 0, y: 0 };
    for (let i = 0; i < count; i++) {
      const a = (i + count - 1) % count, b = (i + 1) % count, tx = px[b] - px[a], ty = py[b] - py[a], l = Math.hypot(tx, ty) || 1;
      nx[i] = ty / l; ny[i] = -tx / l;
      let out = OUT_MOST;
      for (; out > -room; out -= .1) { probe.x = px[i] + nx[i] * (out + HALF + KERB); probe.y = py[i] + ny[i] * (out + HALF + KERB); if (insideIndexed(probe, kerb)) break; }
      most[i] = out;
    }
    const loop = {
      index, points: [], cumulative: [0], perimeter: length, tight: false, file: false, blocked: false, squeeze: 0,
      // Everyone on it goes the same way round at the same pace
      direction: randomAt(index, 7741, CITY.seed) < .5 ? 1 : -1, pace: 1.25 + randomAt(index, 7742, CITY.seed) * .7,
      base: { count, spacing, px, py, nx, ny, most, room },
    };
    this.route(loop);
    this.routed++;
    return loop;
  }
  // A walk's line through what stands along it: `points`, each `cumulative`
  // meters round its base
  route(loop) {
    const { count, spacing, px, py, nx, ny, most, room } = loop.base, low = new Float64Array(count).fill(-room), high = Float64Array.from(most);
    // What stands near each sample. A piece is passed on one side all the way
    // by: the side its nearest part is off the walk, unless it says (`out`)
    const met = [], sides = new Map(), reach = OUT_MOST + HALF + MARGIN, stamp = ++this.stamp;
    let near = [], cx0 = NaN, cx1 = NaN, cy0 = NaN, cy1 = NaN;
    for (let i = 0; i < count; i++) {
      const x = px[i], y = py[i];
      const x0 = Math.floor((x - reach) / CELL), x1 = Math.floor((x + reach) / CELL), y0 = Math.floor((y - reach) / CELL), y1 = Math.floor((y + reach) / CELL);
      // (the pieces in the cells round a sample, gathered again only as it moves on to others)
      if (x0 !== cx0 || x1 !== cx1 || y0 !== cy0 || y1 !== cy1) {
        near = []; cx0 = x0; cx1 = x1; cy0 = y0; cy1 = y1;
        for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
          const list = this.cells.get(key(ix, iy));
          if (list) for (const item of list) if (item.seen !== stamp + i) { item.seen = stamp + i; near.push(item); }
        }
      }
      for (const item of near) {
        if (!crossing(item, x, y, nx[i], ny[i], item.radius + HALF + MARGIN) || span.low > OUT_MOST + 1 || span.high < -room - 1) continue;
        const side = sides.get(item.group);
        if (!side || span.gap < side.gap) sides.set(item.group, { gap: span.gap, out: span.across > 0 });
        met.push(i, span.low, span.high, item.group);
      }
    }
    this.stamp += count;
    for (let k = 0; k < met.length; k += 4) {
      const i = met[k];
      if (met[k + 3].out ?? sides.get(met[k + 3]).out) high[i] = Math.min(high[i], met[k + 1]); else low[i] = Math.max(low[i], met[k + 2]);
    }
    // No faster aside than SLOPE: each limit reaches along the walk either way
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < count; i++) { const j = (i + count - 1) % count; high[i] = Math.min(high[i], high[j] + SLOPE * spacing); low[i] = Math.max(low[i], low[j] - SLOPE * spacing); }
      for (let i = count - 1; i >= 0; i--) { const j = (i + 1) % count; high[i] = Math.min(high[i], high[j] + SLOPE * spacing); low[i] = Math.max(low[i], low[j] - SLOPE * spacing); }
    }
    // Along the line where it is free, else as near it as the limits allow.
    // With no room for a pair, down the middle of what room there is
    let worst = 0;
    const points = new Array(count);
    for (let i = 0; i < count; i++) {
      const squeeze = low[i] - high[i], out = squeeze > 0 ? (low[i] + high[i]) / 2 : Math.max(low[i], Math.min(0, high[i]));
      points[i] = { x: px[i] + nx[i] * out, y: py[i] + ny[i] * out };
      if (squeeze > worst) { worst = squeeze; loop.squeezedAt = points[i]; }
    }
    // (only the points that shape it are kept, each still at its own distance round the base)
    const keep = simplify(points, .02);
    loop.points = []; loop.cumulative = [];
    for (let i = 0; i < count; i++) if (keep[i]) { loop.points.push(points[i]); loop.cumulative.push(i * spacing); }
    loop.cumulative.push(loop.perimeter + loop.cumulative[0]);
    // No room somewhere for two side by side (squeezed by less than their
    // margins, they still touch nothing): a pair closes up all the way round,
    // or with no room for that either goes in single file (see
    // offsetWalkerPose). No room for one, where a building stands right
    // across the pavement: nobody walks it.
    loop.squeeze = worst; loop.tight = worst > MARGIN; loop.file = worst > MARGIN + 2 * PAIR * (1 - CLOSE); loop.blocked = worst > 2 * PAIR + MARGIN;
    return loop;
  }
  // A chunk's colliders against the walks through it (`blocks`, their
  // indices), one walk a step: whatever stands in a walk that the furniture's
  // footprints did not say (a building out past its lot line, steps, a
  // venue's own furniture) becomes something to walk round, and the walk is
  // routed again. Once a chunk: what it finds stays found.
  *survey(chunk, blocks) {
    if (this.surveyed.has(chunk.index)) return;
    const solids = chunk.features.colliders.filter(c => !c.parked && !c.clutter && !c.shape && !(c.top !== undefined && c.top - PAVEMENT_LEVEL <= .3)), walled = new Set();
    for (const index of blocks) {
      const loop = this.block(index), tried = new Set();
      if (!loop) continue;
      for (let again = 0; again < 2; again++) {
        const found = solids.filter(solid => !tried.has(solid) && this.meets(loop, solid));
        if (!found.length) break;
        for (const solid of found) {
          tried.add(solid);
          if (walled.has(solid)) continue;
          walled.add(solid);
          // (what stands on the block's lots is passed on the curb's side,
          // however far out it comes: a walk begun inside a wall would
          // otherwise take the wall's far face for the nearer way round)
          const inner = CITY.blocks[index].inner, group = { kind: 'solid', out: inner?.length >= 3 && insideIndexed({ x: solid.x, y: -solid.z }, inner) ? false : undefined };
          // (a wall's face, in lengths of a cell or so: z is south)
          if (solid.corners) solid.corners.forEach((a, i) => {
            const b = solid.corners[(i + 1) % solid.corners.length], pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / CELL));
            for (let k = 0; k < pieces; k++) this.obstacle(a.x + (b.x - a.x) * k / pieces, -(a.z + (b.z - a.z) * k / pieces), .02, group, a.x + (b.x - a.x) * (k + 1) / pieces, -(a.z + (b.z - a.z) * (k + 1) / pieces));
          });
          else this.obstacle(solid.x, -solid.z, solid.reach, group);
        }
        this.route(loop);
      }
      yield;
    }
    // (only once it has run through: a build dropped part way is surveyed again when the chunk is built again)
    this.surveyed.add(chunk.index);
  }
  // Whether a pair on a walk would touch a collider (see CityChunk's)
  meets(loop, solid) {
    const points = loop.points, n = points.length, reach = solid.reach + HALF, cx = solid.x, cy = -solid.z;
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      if (Math.min(a.x, b.x) > cx + reach || Math.max(a.x, b.x) < cx - reach || Math.min(a.y, b.y) > cy + reach || Math.max(a.y, b.y) < cy - reach) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(length / .4));
      for (let k = 0; k <= steps; k++) {
        const x = a.x + (b.x - a.x) * k / steps, y = a.y + (b.y - a.y) * k / steps;
        if ((x - cx) ** 2 + (y - cy) ** 2 > reach * reach) continue;
        if (!solid.corners) return true;
        if (within(solid.corners, x, -y, HALF)) return true;
      }
    }
    return false;
  }
}

// How far (x, y) is from an obstacle's surface (under 0 inside a disc)
function offBy(item, x, y) {
  const dx = item.bx - item.x, dy = item.by - item.y, length = dx * dx + dy * dy;
  const t = length > 1e-12 ? Math.max(0, Math.min(1, ((x - item.x) * dx + (y - item.y) * dy) / length)) : 0;
  return Math.hypot(x - item.x - dx * t, y - item.y - dy * t) - item.radius;
}
// Where the line from (x, y) along (nx, ny) runs within `room` of an
// obstacle: false if nowhere, else into `span` from `low` to `high` along
// it, with how far along it the obstacle's nearest point is (`across`) and
// how far off its surface (`gap`)
function crossing(item, x, y, nx, ny, room) {
  const ax = item.x - x, ay = item.y - y, dx = item.bx - item.x, dy = item.by - item.y, length = Math.hypot(dx, dy);
  let low = Infinity, high = -Infinity;
  for (let end = 0; end < (length > 1e-9 ? 2 : 1); end++) {
    const cx = ax + dx * end, cy = ay + dy * end, b = cx * nx + cy * ny, d = b * b - (cx * cx + cy * cy - room * room);
    if (d > 0) { const r = Math.sqrt(d); low = Math.min(low, b - r); high = Math.max(high, b + r); }
  }
  if (length > 1e-9) {
    // (the wall's own frame, u along it and v across: the line there starts at (pu, pv) and runs along (lu, lv))
    const ux = dx / length, uy = dy / length, pu = -(ax * ux + ay * uy), pv = ax * uy - ay * ux, lu = nx * ux + ny * uy, lv = ny * ux - nx * uy;
    let from = -Infinity, to = Infinity;
    if (Math.abs(lv) > 1e-9) { const a = (-room - pv) / lv, b = (room - pv) / lv; from = Math.min(a, b); to = Math.max(a, b); } else if (Math.abs(pv) >= room) from = Infinity;
    if (Math.abs(lu) > 1e-9) { const a = -pu / lu, b = (length - pu) / lu; from = Math.max(from, Math.min(a, b)); to = Math.min(to, Math.max(a, b)); } else if (pu < 0 || pu > length) from = Infinity;
    if (from < to) { low = Math.min(low, from); high = Math.max(high, to); }
    const s = Math.max(0, Math.min(length, pu)), qx = ax + ux * s, qy = ay + uy * s;
    span.across = qx * nx + qy * ny; span.gap = Math.hypot(qx, qy) - item.radius;
  } else { span.across = ax * nx + ay * ny; span.gap = Math.hypot(ax, ay) - item.radius; }
  if (!(low < high)) return false;
  span.low = low; span.high = high;
  return true;
}
// Whether (x, z) is inside a collider's corners or within `reach` of them
function within(corners, x, z, reach) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i], b = corners[j], ex = b.x - a.x, ez = b.z - a.z, l = ex * ex + ez * ez;
    const t = l > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l)) : 0;
    if ((x - a.x - ex * t) ** 2 + (z - a.z - ez * t) ** 2 < reach * reach) return true;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

const largest = pieces => pieces.reduce((best, piece) => !best || calcPolygonArea(piece.outer) > calcPolygonArea(best) ? piece.outer : best, null) ?? [];

// Which points of a closed line to keep: all but those within `tolerance` of
// the line through the kept ones either side
function simplify(points, tolerance) {
  const n = points.length, keep = new Uint8Array(n);
  if (n < 8) return keep.fill(1);
  const half = n >> 1, stack = [[0, half], [half, n]];
  keep[0] = keep[half] = 1;
  while (stack.length) {
    const [from, to] = stack.pop(), a = points[from], b = points[to % n], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    let most = tolerance, at = -1;
    for (let i = from + 1; i < to; i++) { const d = Math.abs((points[i].x - a.x) * dy - (points[i].y - a.y) * dx) / length; if (d > most) { most = d; at = i; } }
    if (at < 0) continue;
    keep[at] = 1; stack.push([from, at], [at, to]);
  }
  return keep;
}
