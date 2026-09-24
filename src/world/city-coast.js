import { CITY } from './city.js';
import { ROAD_LEVEL, WATER_LEVEL } from './city-route.js';
import { randomAt } from './route.js';
import { distanceToPolyline, insidePolygon } from '../mapgen/polygon-util.js';

// The island's coast outside the city, in the same faceted low-poly style as
// everything else: sand running down into the sea with a line of surf,
// stretches of grey rock strewn with boulders, grassy banks where the river
// runs through the country, and a lighthouse on the furthest headland. All of
// it is baked into the static surfaces, so it costs no draw calls of its own.

const TOP = ROAD_LEVEL - .06;
const STYLES = {
  sand: { band: 7, bandColour: '#d8c9a2', width: 30, upper: '#cfbd91', lower: '#b3a077', depth: 1.6, surf: true },
  rock: { band: 0, width: 18, upper: '#8d897d', lower: '#6c6a63', depth: 2.2, rocks: true },
  bank: { band: 0, width: 14, upper: '#7f9a5f', lower: '#86795a', depth: 1 },
};
const ROCK_GREYS = ['#8b877b', '#7a776e', '#9a958a', '#6f6c64', '#a39d90'];
const jitter = (x, y, salt) => randomAt(Math.round(x * 3), Math.round(y * 3) + salt, CITY.seed) - .5;
// Stretches of the open coast are rock rather than sand
const rocky = p => CITY.field.noise2D(p.x / 240 + 11, p.y / 240 - 7) > .3;

// A triangle whose face looks toward `out` (map x, y and a height), coloured
function tri(surface, a, b, c, colour, out) {
  const ux = b[0] - a[0], uy = b[2] - a[2], uz = b[1] - a[1], vx = c[0] - a[0], vy = c[2] - a[2], vz = c[1] - a[1];
  // Normal in the renderer's axes (x, height, -y)
  const nx = uy * -vz - -uz * vy, ny = -uz * vx - ux * -vz, nz = ux * vy - uy * vx;
  const flip = nx * out[0] + ny * out[2] + nz * -out[1] < 0;
  const [p, q] = flip ? [c, b] : [b, c];
  surface.face(a[0], a[2], -a[1], p[0], p[2], -p[1], q[0], q[2], -q[1], colour);
}

// The slope from a run of shore (water on its right) down under the water,
// with a band of dry sand above it and surf where it meets the water. taper
// [start, end]: how far from each end (along the whole shore run) the slope
// is, so it narrows to nothing where the shore meets a quay wall.
const TAPER = 24;
function slope(ground, points, style, faceted = true, taper = null) {
  const n = points.length;
  if (n < 2) return;
  const normals = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    return { x: dy / length, y: -dx / length };
  });
  const bottom = WATER_LEVEL - style.depth, middle = TOP + (bottom - TOP) * .6;
  // Each middle vertex a little higher or lower, a little further or nearer: facets
  let along = 0;
  const rows = points.map((p, i) => {
    if (i) along += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
    const narrow = taper ? Math.min(1, (taper[0] + along) / TAPER, (taper[1] - along) / TAPER) : 1;
    const wobble = faceted ? jitter(p.x, p.y, 7601) : 0, reach = Math.max(.5, style.width * (1 + wobble * .08) * Math.max(0, narrow));
    const at = d => ({ x: p.x + normals[i].x * d, y: p.y + normals[i].y * d });
    return { band: at(-style.band * Math.max(0, narrow)), mid: at(reach * .6), end: at(reach), midHeight: middle + wobble * .8, reach };
  });
  for (let i = 0; i < n - 1; i++) {
    const a = points[i], b = points[i + 1], ra = rows[i], rb = rows[i + 1];
    if (style.band) { ground.flat(ra.band, a, b, TOP + .015, style.bandColour); ground.flat(ra.band, b, rb.band, TOP + .015, style.bandColour); }
    ground.slope(a, TOP, b, TOP, rb.mid, rb.midHeight, style.upper); ground.slope(a, TOP, rb.mid, rb.midHeight, ra.mid, ra.midHeight, style.upper);
    ground.slope(ra.mid, ra.midHeight, rb.mid, rb.midHeight, rb.end, bottom, style.lower); ground.slope(ra.mid, ra.midHeight, rb.end, bottom, ra.end, bottom, style.lower);
    if (!style.surf || randomAt(Math.round(a.x), Math.round(a.y) + 7602, CITY.seed) < .2) continue;
    // Surf: a broken white line on the water where the sand goes under it
    const line = (row, p, k) => {
      const f = Math.max(0, Math.min(1, (row.midHeight - WATER_LEVEL) / (row.midHeight - bottom))), d = row.reach * (.6 + .4 * f);
      return { x: p.x + normals[k].x * d, y: p.y + normals[k].y * d };
    };
    const sa = line(ra, a, i), sb = line(rb, b, i + 1), w = .5 + randomAt(Math.round(b.x), Math.round(b.y) + 7603, CITY.seed) * .9;
    const out = (p, k, d) => ({ x: p.x + normals[k].x * d, y: p.y + normals[k].y * d });
    ground.flat(out(sa, i, -.4), out(sb, i + 1, -.4), out(sb, i + 1, w), WATER_LEVEL + .18, '#e9f1ec');
    ground.flat(out(sa, i, -.4), out(sb, i + 1, w), out(sa, i, w), WATER_LEVEL + .18, '#e9f1ec');
  }
}

// A boulder: an icosahedron pulled about and squashed, every face its own grey
const ICOSAHEDRON = (() => {
  const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
})();
function boulder(surface, x, y, base, size, salt) {
  const r = k => randomAt(Math.round(x * 7) + k, Math.round(y * 7) + salt, CITY.seed);
  const yaw = r(1) * Math.PI * 2, squash = .55 + r(2) * .3, c = Math.cos(yaw), s = Math.sin(yaw);
  const points = ICOSAHEDRON.v.map(([vx, vy, vz], k) => {
    const pull = .72 + r(10 + k) * .5, px = vx * size * pull, py = vz * size * pull;
    return [x + px * c - py * s, y + px * s + py * c, base + (vy + .35) * size * squash * pull];
  });
  ICOSAHEDRON.f.forEach(([i, j, k], face) => {
    const a = points[i], b = points[j], d = points[k];
    const out = [(a[0] + b[0] + d[0]) / 3 - x, (a[1] + b[1] + d[1]) / 3 - y, (a[2] + b[2] + d[2]) / 3 - base];
    tri(surface, a, b, d, ROCK_GREYS[Math.floor(r(40 + face) * ROCK_GREYS.length)], out);
  });
}

// A tapering prism of `sides` round (cx, cy) from y0 to y1, optionally capped
function frustum(surface, cx, cy, y0, y1, r0, r1, sides, colour, cap = true, turn = 0) {
  const ring = (r, y) => Array.from({ length: sides }, (_, k) => { const a = turn + k / sides * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, y]; });
  const lower = ring(r0, y0), upper = ring(r1, y1);
  for (let k = 0; k < sides; k++) {
    const a = lower[k], b = lower[(k + 1) % sides], c = upper[(k + 1) % sides], d = upper[k];
    const out = [(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy, 0];
    tri(surface, a, b, c, colour, out);
    if (r1 > 1e-6) tri(surface, a, c, d, colour, out);
  }
  if (cap && r1 > 1e-6) for (let k = 1; k < sides - 1; k++) tri(surface, upper[0], upper[k], upper[k + 1], colour, [0, 0, 1]);
}

// The furthest headland from the city, a little inland of its beach
export function lighthouseSite() {
  if (!CITY.ring) return null;
  let best = null;
  for (const run of CITY.shores) {
    if (run.kind !== 'beach') continue;
    for (let i = 1; i < run.points.length - 1; i += 2) {
      const p = run.points[i], a = run.points[i - 1], b = run.points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
      const site = { x: p.x + dy / length * -16, y: p.y - dx / length * -16 };
      const reach = distanceToPolyline(site, CITY.ring);
      if (reach < 40 || (best && reach <= best.reach)) continue;
      // Solid ground all round it
      if (![[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7]].every(([ox, oy]) => CITY.land.some(piece => insidePolygon({ x: site.x + ox, y: site.y + oy }, piece.outer)))) continue;
      best = { ...site, reach, seaward: { x: dy / length, y: -dx / length } };
    }
  }
  return best;
}

function lighthouse(walls, glow, site) {
  const { x, y } = site, WHITE = '#f1eee4', RED = '#c7443a', STONE = '#a29b8c', DARK = '#3a3f45';
  // A stone plinth, the striped tower, its gallery, the lantern and its cap
  frustum(walls, x, y, TOP - .2, TOP + 1.4, 4.4, 4.1, 8, STONE, true, Math.PI / 8);
  const stripes = [WHITE, RED, WHITE, RED], height = 4.2, r = h => 3.1 - h / 17 * 1.25;
  stripes.forEach((colour, k) => frustum(walls, x, y, TOP + 1.4 + k * height, TOP + 1.4 + (k + 1) * height, r(k * height), r((k + 1) * height), 8, colour, false, Math.PI / 8));
  const deck = TOP + 1.4 + stripes.length * height;
  frustum(walls, x, y, deck, deck + .45, 2.75, 2.75, 8, DARK, true, Math.PI / 8);
  frustum(glow, x, y, deck + .45, deck + 2.5, 1.45, 1.45, 8, '#ffe49b', false, Math.PI / 8);
  frustum(walls, x, y, deck + 2.5, deck + 2.8, 2, 2, 8, DARK, true, Math.PI / 8);
  frustum(walls, x, y, deck + 2.8, deck + 5, 2, 0, 8, RED, false, Math.PI / 8);
  // The keeper's cottage beside it, landward: white walls and a red roof
  const back = { x: -site.seaward.x, y: -site.seaward.y }, side = { x: -back.y, y: back.x };
  const cx = x + back.x * 9 + side.x * 4, cy = y + back.y * 9 + side.y * 4;
  const corner = (u, v) => [cx + side.x * u + back.x * v, cy + side.y * u + back.y * v];
  const box = [corner(-3.5, -2.5), corner(3.5, -2.5), corner(3.5, 2.5), corner(-3.5, 2.5)];
  for (let k = 0; k < 4; k++) {
    const a = box[k], b = box[(k + 1) % 4], out = [(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy, 0];
    tri(walls, [...a, TOP], [...b, TOP], [...b, TOP + 3], WHITE, out); tri(walls, [...a, TOP], [...b, TOP + 3], [...a, TOP + 3], WHITE, out);
  }
  const ridgeA = [...corner(-3.9, 0), TOP + 5.2], ridgeB = [...corner(3.9, 0), TOP + 5.2];
  const eave = (u, v) => [...corner(u, v), TOP + 2.9];
  tri(walls, eave(-3.9, -3), eave(3.9, -3), ridgeB, RED, [back.x * -1, back.y * -1, 1]); tri(walls, eave(-3.9, -3), ridgeB, ridgeA, RED, [back.x * -1, back.y * -1, 1]);
  tri(walls, eave(-3.9, 3), ridgeB, eave(3.9, 3), RED, [back.x, back.y, 1]); tri(walls, eave(-3.9, 3), ridgeA, ridgeB, RED, [back.x, back.y, 1]);
  for (const u of [-3.5, 3.5]) tri(walls, [...corner(u, -2.5), TOP + 3], [...corner(u, 2.5), TOP + 3], [...corner(u, 0), TOP + 5.2], WHITE, [side.x * u, side.y * u, 0]);
}

// The coast into the static surfaces: ground (slopes and surf), walls
// (boulders and the lighthouse) and glow (the lighthouse's lantern)
export function buildCoast({ ground, walls, glow }) {
  for (const run of CITY.shores) {
    if (run.kind === 'quay') continue;
    const total = run.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - run.points[i].x, p.y - run.points[i].y), 0);
    const ends = run.closed ? null : [0, total];
    if (run.kind === 'bank') { slope(ground, run.points, STYLES.bank, false, ends); continue; }
    // Split each beach into runs of sand and of rock
    let start = 0, travelled = 0, pieceStart = 0;
    const distance = run.points.map((p, i) => i ? (travelled += Math.hypot(p.x - run.points[i - 1].x, p.y - run.points[i - 1].y)) : 0);
    for (let i = 1; i <= run.points.length; i++) {
      if (i < run.points.length && rocky(run.points[i]) === rocky(run.points[start])) continue;
      const piece = run.points.slice(start, Math.min(run.points.length, i + 1)), style = rocky(run.points[start]) ? STYLES.rock : STYLES.sand;
      pieceStart = distance[start];
      slope(ground, piece, style, true, ends && [pieceStart, total - pieceStart]);
      if (style.rocks) {
        // Boulders down the slope and along the water's edge
        for (let k = 0; k < piece.length - 1; k++) {
          const a = piece[k], b = piece[k + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, nx = dy / length, ny = -dx / length;
          for (let m = 0; m < 2; m++) {
            const t = randomAt(Math.round(a.x) + m, Math.round(a.y) + 7604, CITY.seed), d = 4 + randomAt(Math.round(a.x) + m, Math.round(a.y) + 7605, CITY.seed) * 12;
            const bx = a.x + dx * t + nx * d, by = a.y + dy * t + ny * d, fraction = d / STYLES.rock.width;
            const base = TOP + (WATER_LEVEL - STYLES.rock.depth - TOP) * Math.min(1, fraction) - .6;
            const size = 1 + randomAt(Math.round(bx), Math.round(by) + 7606, CITY.seed) * (m ? 1.6 : 2.8);
            boulder(walls, bx, by, base, size, 7607 + m);
          }
        }
      }
      start = i;
    }
  }
  const site = lighthouseSite();
  if (site) lighthouse(walls, glow, site);
  return site;
}
