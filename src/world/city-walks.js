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
// A walk is laid and routed SLICE samples a step when a chunk's survey does it
const SLICE = 128;

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
const span = { low: 0, high: 0, qx: 0, qy: 0 };
const grown = (old, size, Type = Float64Array) => { const next = new Type(size); if (old) next.set(old); return next; };
// All of a generator's steps at once, and what it returns
const through = steps => { for (;;) { const step = steps.next(); if (step.done) return step.value; } };
// A number for each key, or -1: the keys in a table with their numbers
// beside them, each in the first free place from where its hash puts it (a
// Map's lookups were a third of routing a walk)
class Table {
  constructor(bits = 10) { this.size = 0; this.shift = 32 - bits; this.keys = new Float64Array(1 << bits); this.values = new Int32Array(1 << bits).fill(-1); }
  get(key) {
    const keys = this.keys, values = this.values, mask = values.length - 1;
    for (let at = Math.imul(key, 0x9e3779b1) >>> this.shift; ; at = (at + 1) & mask) {
      if (values[at] < 0) return -1;
      if (keys[at] === key) return values[at];
    }
  }
  set(key, value) {
    if (this.size * 2 >= this.values.length) {
      const { keys, values } = this;
      this.shift--; this.size = 0; this.keys = new Float64Array(values.length * 2); this.values = new Int32Array(values.length * 2).fill(-1);
      for (let at = 0; at < values.length; at++) if (values[at] >= 0) this.set(keys[at], values[at]);
    }
    const mask = this.values.length - 1;
    let at = Math.imul(key, 0x9e3779b1) >>> this.shift;
    while (this.values[at] >= 0 && this.keys[at] !== key) at = (at + 1) & mask;
    if (this.values[at] < 0) this.size++;
    this.keys[at] = key; this.values[at] = value;
  }
}
// A route's working columns, kept from one to the next, and what it meets
// (a route taking steps keeps its meetings till it is done: one routed
// meanwhile makes its own)
let lows = new Float64Array(0), highs = new Float64Array(0), outX = new Float64Array(0), outY = new Float64Array(0), kept = new Uint8Array(0), gathered = new Int32Array(64), spareMeetings = null;
// The boxes round each stretch of a walk (see boxed), round each RUN of them and round the whole walk
const RUN = 8, whole = new Float64Array(4);
let boxes = new Float64Array(0), runs = new Float64Array(0);

export class WalkSpace {
  constructor() {
    this.loops = new Map(); this.surveyed = new Set();
    // (where a bus stop's riders wait: nobody else stands there)
    this.waits = [];
    this.routed = 0; this.stamp = 0;
    // What stands there, in columns (as an object each, with a list for
    // every cell, they were 5 MB): a disc at (x, y), or a wall's face from
    // there to its far end (`tail`: where in `ends`, past 0), `radius` thick
    this.count = 0; this.x = new Float64Array(0); this.y = new Float64Array(0); this.radius = new Float64Array(0);
    this.tail = new Int32Array(0); this.seen = new Float64Array(0); this.groups = []; this.ends = [];
    // A cell's pieces, in the order they came: its first entry (`cells`),
    // each entry's piece and the entry after it, and a first entry's last
    this.cells = new Table(); this.entries = 0; this.piece = new Int32Array(0); this.next = new Int32Array(0); this.last = new Int32Array(0);
  }
  // Something standing there: a disc, or (to `bx`, `by`) a wall's face that thick
  obstacle(x, y, radius, group, bx = x, by = y) {
    const item = this.count++;
    if (item === this.x.length) {
      const size = Math.max(1024, item * 2);
      this.x = grown(this.x, size); this.y = grown(this.y, size); this.radius = grown(this.radius, size); this.tail = grown(this.tail, size, Int32Array); this.seen = grown(this.seen, size);
    }
    this.x[item] = x; this.y[item] = y; this.radius[item] = radius; this.groups.push(group);
    if (bx !== x || by !== y) { this.ends.push(bx - x, by - y); this.tail[item] = this.ends.length / 2; }
    const x0 = Math.floor((Math.min(x, bx) - radius) / CELL), x1 = Math.floor((Math.max(x, bx) + radius) / CELL), y0 = Math.floor((Math.min(y, by) - radius) / CELL), y1 = Math.floor((Math.max(y, by) + radius) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      const k = key(ix, iy), entry = this.entries++, first = this.cells.get(k);
      if (entry === this.piece.length) {
        const size = Math.max(2048, entry * 2);
        this.piece = grown(this.piece, size, Int32Array); this.next = grown(this.next, size, Int32Array); this.last = grown(this.last, size, Int32Array);
      }
      this.piece[entry] = item; this.next[entry] = -1;
      if (first < 0) this.cells.set(k, entry); else this.next[this.last[first]] = entry;
      this.last[first < 0 ? entry : first] = entry;
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
    // (a piece's parts are passed together: its group is only a number of its own)
    const kind = piece.kind, x = piece.u, y = piece.s, yaw = piece.yaw ?? 0, group = -this.count - 1;
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
  // Whether anything stands within `reach` of (x, y)
  near(x, y, reach) {
    // (a piece is in every cell it reaches into, so the cells within reach are enough)
    const x0 = Math.floor((x - reach) / CELL), x1 = Math.floor((x + reach) / CELL), y0 = Math.floor((y - reach) / CELL), y1 = Math.floor((y + reach) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      for (let entry = this.cells.get(key(ix, iy)); entry >= 0; entry = this.next[entry]) if (this.offBy(this.piece[entry], x, y) < reach) return true;
    }
    return false;
  }
  // How far (x, y) is from a piece's surface (under 0 inside a disc)
  offBy(item, x, y) {
    const ex = x - this.x[item], ey = y - this.y[item], tail = this.tail[item];
    if (!tail) return Math.hypot(ex, ey) - this.radius[item];
    const dx = this.ends[tail * 2 - 2], dy = this.ends[tail * 2 - 1], length = dx * dx + dy * dy;
    const t = length > 1e-12 ? Math.max(0, Math.min(1, (ex * dx + ey * dy) / length)) : 0;
    return Math.hypot(ex - dx * t, ey - dy * t) - this.radius[item];
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
    if (!this.loops.has(index)) through(this.laying(index));
    return this.loops.get(index);
  }
  // A block's walk laid a few steps at a time (see survey)
  *laying(index) {
    const block = CITY.blocks[index];
    let loop = null;
    if (block?.kerb.length >= 3) {
      // (a block with no lot line, a broken one, keeps to the same way in from its curb)
      const base = block.inner?.length >= 3 ? largest(growRound([block.inner], WALK_OUT)) : offsetPolygon(block.kerb, -(SIDEWALK - WALK_OUT));
      yield;
      loop = yield* this.laySteps(base, block.kerb, index, WALK_OUT - HALF - WALL);
    }
    // (unless it was wanted at once meanwhile, and laid then)
    if (!this.loops.has(index)) this.loops.set(index, loop);
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
  lay(base, kerb, index, room) { return through(this.laySteps(base, kerb, index, room)); }
  *laySteps(base, kerb, index, room) {
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
    // (SLICE probes a step: on a narrow pavement a sample takes a dozen or more)
    for (let i = 0, probes = 0; i < count; i++) {
      if (probes >= SLICE) { yield; probes = 0; }
      const a = (i + count - 1) % count, b = (i + 1) % count, tx = px[b] - px[a], ty = py[b] - py[a], l = Math.hypot(tx, ty) || 1;
      nx[i] = ty / l; ny[i] = -tx / l;
      let out = OUT_MOST;
      for (; out > -room; out -= .1) { probes++; probe.x = px[i] + nx[i] * (out + HALF + KERB); probe.y = py[i] + ny[i] * (out + HALF + KERB); if (insideIndexed(probe, kerb)) break; }
      most[i] = out;
    }
    const loop = {
      index, points: [], cumulative: [0], perimeter: length, tight: false, file: false, blocked: false, squeeze: 0,
      // Everyone on it goes the same way round at the same pace
      direction: randomAt(index, 7741, CITY.seed) < .5 ? 1 : -1, pace: 1.25 + randomAt(index, 7742, CITY.seed) * .7,
      base: { count, spacing, px, py, nx, ny, most, room },
    };
    yield;
    yield* this.routeSteps(loop);
    this.routed++;
    return loop;
  }
  // A walk's line through what stands along it: `points`, each `cumulative`
  // meters round its base
  route(loop) { return through(this.routeSteps(loop)); }
  // (SLICE samples a step. Anything set down while it is at it, it starts
  // again: the samples before it never saw that.)
  *routeSteps(loop) {
    const { count, spacing, px, py, nx, ny, most, room } = loop.base;
    // What stands near each sample. A piece is passed on one side all the way
    // by: the side its nearest part is off the walk, unless it says (`out`).
    // (Each meeting is four numbers in `met`: the sample, from and to along
    // its line, and the group's number, which `sides` gives and `owners`
    // takes back; `gaps` and `outs` are each group's nearest and its side.)
    const meetings = spareMeetings ?? { met: new Float64Array(1024), gaps: new Float64Array(64), outs: new Uint8Array(64), owners: [], sides: new Map() };
    spareMeetings = null;
    let { met, gaps, outs } = meetings, metCount = 0;
    const { owners, sides } = meetings, reach = OUT_MOST + HALF + MARGIN;
    owners.length = 0; sides.clear();
    let pieceCount, stamp, X, Y, R, tails, ends, seen, groups, cells, pieces, after;
    // (`lately`: the group met last, most often the next one's too, and its number)
    let near = 0, cx0 = NaN, cx1 = NaN, cy0 = NaN, cy1 = NaN, lately = sides, side = -1;
    for (let i = 0; i < count; i++) {
      if (i % SLICE === 0) {
        if (i) yield;
        if (!i || this.count !== pieceCount) {
          if (i) { i = 0; metCount = 0; owners.length = 0; sides.clear(); lately = sides; }
          pieceCount = this.count; stamp = ++this.stamp; this.stamp += count;
          ({ x: X, y: Y, radius: R, tail: tails, ends, seen, groups, cells, piece: pieces, next: after } = this);
        }
        // (the pieces gathered, as others may have gathered theirs meanwhile)
        cx0 = NaN;
      }
      const x = px[i], y = py[i], ux = nx[i], uy = ny[i];
      const x0 = Math.floor((x - reach) / CELL), x1 = Math.floor((x + reach) / CELL), y0 = Math.floor((y - reach) / CELL), y1 = Math.floor((y + reach) / CELL);
      // (the pieces in the cells round a sample, gathered again only as it moves on to others)
      if (x0 !== cx0 || x1 !== cx1 || y0 !== cy0 || y1 !== cy1) {
        near = 0; cx0 = x0; cx1 = x1; cy0 = y0; cy1 = y1;
        for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
          for (let entry = cells.get(key(ix, iy)); entry >= 0; entry = after[entry]) {
            const item = pieces[entry];
            if (seen[item] === stamp + i) continue;
            seen[item] = stamp + i;
            if (near === gathered.length) gathered = grown(gathered, near * 2, Int32Array);
            gathered[near++] = item;
          }
        }
      }
      for (let m = 0; m < near; m++) {
        // Where the line from the sample out along (ux, uy) runs within
        // `clear` of the piece, from `from` to `to` along it; (qx, qy) is
        // the piece's nearest point
        const item = gathered[m], ax = X[item] - x, ay = Y[item] - y, clear = R[item] + HALF + MARGIN, tail = tails[item];
        let from, to, qx = ax, qy = ay;
        if (tail) {
          if (!crossing(ax, ay, ends[tail * 2 - 2], ends[tail * 2 - 1], ux, uy, clear)) continue;
          from = span.low; to = span.high; qx = span.qx; qy = span.qy;
        } else {
          const b = ax * ux + ay * uy, d = b * b - (ax * ax + ay * ay - clear * clear);
          if (!(d > 0)) continue;
          const r = Math.sqrt(d);
          from = b - r; to = b + r;
          if (!(from < to)) continue;
        }
        if (from > OUT_MOST + 1 || to < -room - 1) continue;
        // (how far along the line the nearest point is, and how far off the piece's surface)
        const group = groups[item], gap = Math.hypot(qx, qy) - R[item];
        if (group !== lately) {
          lately = group; side = sides.get(group) ?? -1;
          if (side < 0) {
            sides.set(group, side = owners.length); owners.push(group);
            if (side === gaps.length) { gaps = grown(gaps, side * 2); outs = grown(outs, side * 2, Uint8Array); }
            gaps[side] = gap; outs[side] = qx * ux + qy * uy > 0 ? 1 : 0;
          }
        }
        if (gap < gaps[side]) { gaps[side] = gap; outs[side] = qx * ux + qy * uy > 0 ? 1 : 0; }
        if (metCount === met.length) met = grown(met, metCount * 2);
        met[metCount] = i; met[metCount + 1] = from; met[metCount + 2] = to; met[metCount + 3] = side; metCount += 4;
      }
    }
    if (lows.length < count) { lows = new Float64Array(count); highs = new Float64Array(count); outX = new Float64Array(count); outY = new Float64Array(count); kept = new Uint8Array(count); }
    const low = lows, high = highs;
    for (let i = 0; i < count; i++) { low[i] = -room; high[i] = most[i]; }
    for (let k = 0; k < metCount; k += 4) {
      const i = met[k], side = met[k + 3];
      if (owners[side].out ?? outs[side]) high[i] = Math.min(high[i], met[k + 1]); else low[i] = Math.max(low[i], met[k + 2]);
    }
    meetings.met = met; meetings.gaps = gaps; meetings.outs = outs; owners.length = 0; sides.clear(); spareMeetings = meetings;
    // No faster aside than SLOPE: each limit reaches along the walk either way
    const aside = SLOPE * spacing;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0, j = count - 1; i < count; j = i++) { high[i] = Math.min(high[i], high[j] + aside); low[i] = Math.max(low[i], low[j] - aside); }
      for (let i = count - 1, j = 0; i >= 0; j = i--) { high[i] = Math.min(high[i], high[j] + aside); low[i] = Math.max(low[i], low[j] - aside); }
    }
    // Along the line where it is free, else as near it as the limits allow.
    // With no room for a pair, down the middle of what room there is
    let worst = 0, worstAt = -1;
    for (let i = 0; i < count; i++) {
      const squeeze = low[i] - high[i], out = squeeze > 0 ? (low[i] + high[i]) / 2 : Math.max(low[i], Math.min(0, high[i]));
      outX[i] = px[i] + nx[i] * out; outY[i] = py[i] + ny[i] * out;
      if (squeeze > worst) { worst = squeeze; worstAt = i; }
    }
    // (only the points that shape it are kept, each still at its own distance round the base)
    simplify(outX, outY, count, .02, kept);
    loop.points = []; loop.cumulative = [];
    for (let i = 0; i < count; i++) {
      if (!kept[i] && i !== worstAt) continue;
      const point = { x: outX[i], y: outY[i] };
      if (i === worstAt) loop.squeezedAt = point;
      if (kept[i]) { loop.points.push(point); loop.cumulative.push(i * spacing); }
    }
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
      // (laying a walk takes steps of its own)
      const laid = !this.loops.has(index);
      if (laid) yield* this.laying(index);
      const loop = this.loops.get(index), tried = new Set();
      if (!loop) continue;
      if (laid) yield;
      for (let again = 0; again < 2; again++) {
        // (SLICE / 2 colliders a step, all against the walk as it was at the start)
        const found = [];
        let points = loop.points, stretches = 0;
        for (let k = 0; k < solids.length; k++) {
          if (k % (SLICE / 2) === 0) {
            if (k) yield;
            if (loop.points !== points) { points = loop.points; found.length = 0; k = 0; }
            stretches = boxed(points);
          }
          if (!tried.has(solids[k]) && touching(points, stretches, solids[k])) found.push(solids[k]);
        }
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
        yield* this.routeSteps(loop);
      }
      yield;
    }
    // (only once it has run through: a build dropped part way is surveyed again when the chunk is built again)
    this.surveyed.add(chunk.index);
  }
  // Whether a pair on a walk would touch a collider (see CityChunk's)
  meets(loop, solid) { return touching(loop.points, boxed(loop.points), solid); }
}

// The box round each stretch of a walk (from a point to the next: x from
// and to, y from and to) into `boxes`, and round each RUN of stretches into
// `runs`, for touching. How many stretches.
function boxed(points) {
  const n = points.length;
  if (boxes.length < n * 4) { boxes = new Float64Array(n * 4); runs = new Float64Array(Math.ceil(n / RUN) * 4); }
  whole[0] = whole[2] = Infinity; whole[1] = whole[3] = -Infinity;
  for (const p of points) { whole[0] = Math.min(whole[0], p.x); whole[1] = Math.max(whole[1], p.x); whole[2] = Math.min(whole[2], p.y); whole[3] = Math.max(whole[3], p.y); }
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n], o = i * 4, r = Math.floor(i / RUN) * 4;
    const x0 = boxes[o] = Math.min(a.x, b.x), x1 = boxes[o + 1] = Math.max(a.x, b.x), y0 = boxes[o + 2] = Math.min(a.y, b.y), y1 = boxes[o + 3] = Math.max(a.y, b.y);
    if (i % RUN === 0) { runs[r] = x0; runs[r + 1] = x1; runs[r + 2] = y0; runs[r + 3] = y1; continue; }
    if (x0 < runs[r]) runs[r] = x0;
    if (x1 > runs[r + 1]) runs[r + 1] = x1;
    if (y0 < runs[r + 2]) runs[r + 2] = y0;
    if (y1 > runs[r + 3]) runs[r + 3] = y1;
  }
  return n;
}
// Whether a pair on a walk's line (its n stretches boxed) would touch a
// collider: at a point every .4 m or so along it, within reach of the
// collider's middle and in it or beside it
function touching(points, n, solid) {
  const reach = solid.reach + HALF, cx = solid.x, cy = -solid.z, x0 = cx - reach, x1 = cx + reach, y0 = cy - reach, y1 = cy + reach;
  if (whole[0] > x1 || whole[1] < x0 || whole[2] > y1 || whole[3] < y0) return false;
  for (let i = 0; i < n; i++) {
    if (i % RUN === 0) { const r = i / RUN * 4; if (runs[r] > x1 || runs[r + 1] < x0 || runs[r + 2] > y1 || runs[r + 3] < y0) { i += RUN - 1; continue; } }
    const o = i * 4;
    if (boxes[o] > x1 || boxes[o + 1] < x0 || boxes[o + 2] > y1 || boxes[o + 3] < y0) continue;
    const a = points[i], b = points[(i + 1) % n], ex = b.x - a.x, ey = b.y - a.y, length = Math.hypot(ex, ey), steps = Math.max(1, Math.ceil(length / .4));
    // (only the points that can be within reach: a step over at each end, and a hair further off than the test below allows)
    let from = 0, to = steps;
    const long = ex * ex + ey * ey;
    if (long > 1e-12) {
      const wx = cx - a.x, wy = cy - a.y, t = (wx * ex + wy * ey) / long, wide = reach + 1e-6, clear = wide * wide - (wx * wx + wy * wy - t * t * long);
      if (clear < 0) continue;
      const half = Math.sqrt(clear / long);
      from = Math.max(0, Math.ceil((t - half) * steps) - 1); to = Math.min(steps, Math.floor((t + half) * steps) + 1);
    }
    for (let k = from; k <= to; k++) {
      const x = a.x + (b.x - a.x) * k / steps, y = a.y + (b.y - a.y) * k / steps;
      if ((x - cx) ** 2 + (y - cy) ** 2 > reach * reach) continue;
      if (!solid.corners) return true;
      if (within(solid.corners, x, -y, HALF)) return true;
    }
  }
  return false;
}

// Where the line from a sample along (nx, ny) runs within `room` of a wall's
// face, which begins (ax, ay) from the sample and runs (dx, dy): false if
// nowhere, else into `span` from `low` to `high` along the line, with the
// face's nearest point to the sample (`qx`, `qy`)
function crossing(ax, ay, dx, dy, nx, ny, room) {
  const length = Math.hypot(dx, dy);
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
    const s = Math.max(0, Math.min(length, pu));
    span.qx = ax + ux * s; span.qy = ay + uy * s;
  } else { span.qx = ax; span.qy = ay; }
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

// Which of the first n points (xs, ys) of a closed line to keep, into `keep`:
// all but those within `tolerance` of the line through the kept ones either side
function simplify(xs, ys, n, tolerance, keep) {
  if (n < 8) { keep.fill(1, 0, n); return; }
  keep.fill(0, 0, n);
  const half = n >> 1, stack = [0, half, half, n];
  keep[0] = keep[half] = 1;
  while (stack.length) {
    const to = stack.pop(), from = stack.pop(), ax = xs[from], ay = ys[from], dx = xs[to % n] - ax, dy = ys[to % n] - ay, length = Math.hypot(dx, dy) || 1;
    // (`over`: no point with less across than that is further off than the furthest so far, so only the others are divided)
    let most = tolerance, over = tolerance * length * .999999, at = -1;
    for (let i = from + 1; i < to; i++) {
      const across = Math.abs((xs[i] - ax) * dy - (ys[i] - ay) * dx);
      if (across <= over) continue;
      const d = across / length;
      if (d > most) { most = d; over = across; at = i; }
    }
    if (at < 0) continue;
    keep[at] = 1; stack.push(from, at, at, to);
  }
}
