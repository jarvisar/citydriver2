import * as THREE from 'three';
import { SLEEK_SCALE } from './vehicle-scale.js';

// The Exotic: a low mid-engined coupe after the early-2000s Italian hypercars.
// A pointed racing nose between two big intakes, fenders standing high over
// the wheels with the headlamps swept up their tops, a narrow teardrop
// canopy set down between them, scoops ahead of the rear wheels, a louvered
// engine cover, a ducktail, and four round lamps in a black tail.
// (as modeled, and built a little smaller: see vehicle-scale.js)
export const EXOTIC_MODEL = { name: 'exotic', scale: SLEEK_SCALE, width: 2.06, length: 4.5, cabin: [1.3, .36, 1.9], cabinZ: -.2, eye: [0, 1.1, -.6] };
const GLASS = '#19292c', CARBON = '#1d282f', MESH = '#141a1e', CHROME = '#bcc1b8', COVER = '#20282c', PAINT = '#ffffff';
export const EXOTIC_CARBON = CARBON, EXOTIC_GLASS = GLASS;
// Below the first height the sides tuck under; above the second they lean in
const BELT = [.5, .86];

// Stations along the car: its half-width at the sills, the height of the top
// of its sides, and across its top from there to the middle the points of
// its section, [x, y] from the outside in, then the middle's height. In
// front, a fender's top, its inner slope, the valley beside the nose and the
// nose; along the cabin, the shoulder, the canopy's glass, its pillar and the
// roof; behind it the haunches, their slopes and the engine cover.
export const EXOTIC_STATIONS = [
  { z: -2.25, w: .8, top: .64, row: [[.66, .66], [.4, .58], [.26, .57], [.15, .6]], middle: .61 },
  { z: -2, w: .95, top: .79, row: [[.78, .81], [.44, .64], [.28, .63], [.17, .68]], middle: .69 },
  { z: -1.7, w: 1, top: .95, row: [[.8, .97], [.46, .7], [.29, .69], [.18, .74]], middle: .75 },
  { z: -1.35, w: 1.03, top: 1.04, row: [[.8, 1.06], [.46, .76], [.29, .75], [.18, .8]], middle: .81 },
  { z: -1.1, w: 1.02, top: .99, row: [[.75, 1], [.73, 1.01], [.67, .99], [.32, .87]], middle: .86 },
  { z: -.65, w: .99, top: .96, row: [[.73, .98], [.6, 1.17], [.54, 1.2], [.28, 1.24]], middle: 1.25 },
  { z: -.15, w: .97, top: .95, row: [[.72, .97], [.58, 1.24], [.52, 1.28], [.27, 1.31]], middle: 1.32 },
  { z: .35, w: .99, top: .96, row: [[.73, .98], [.6, 1.2], [.54, 1.24], [.28, 1.27]], middle: 1.28 },
  { z: .8, w: 1.03, top: 1.04, row: [[.8, 1.06], [.6, 1.12], [.5, 1.13], [.27, 1.14]], middle: 1.15 },
  { z: 1.3, w: 1.04, top: 1.07, row: [[.82, 1.09], [.56, 1.02], [.42, 1.01], [.22, 1.02]], middle: 1.02 },
  { z: 1.75, w: 1.03, top: 1.03, row: [[.82, 1.05], [.56, .97], [.42, .96], [.22, .96]], middle: .96 },
  { z: 2.08, w: .97, top: .95, row: [[.78, .96], [.56, .92], [.42, .91], [.22, .91]], middle: .91 },
  { z: 2.25, w: .88, top: .94, row: [[.72, .97], [.55, .97], [.42, .97], [.22, .97]], middle: .97 },
];
// What covers each stretch of the top between stations, from the outside in:
// paint, glass (the windscreen, the side windows, the rear screen) or the
// engine cover
const TOP = ['ppppp', 'ppppp', 'ppppp', 'ppppp', 'pgpgg', 'pgppp', 'pgppp', 'pppgg', 'pppcc', 'pppcc', 'pppcc', 'ppppp'];
const arch = z => [[z - .54, .2], [z - .47, .49], [z - .3, .8], [z - .12, .915], [z + .12, .915], [z + .3, .8], [z + .47, .49], [z + .54, .2]];
export const EXOTIC_BOTTOM = [[-2.25, .2], ...arch(-1.35), ...arch(1.35), [2.25, .2]];
// The side window, the scoop ahead of each rear wheel and the door's cut, side on
export const EXOTIC_WINDOW = [[-1.1, 1], [-.65, 1.17], [-.15, 1.24], [.35, 1.2], [.35, .98], [-.15, .97], [-.65, .98]];
export const EXOTIC_SCOOP = [[.2, .62], [.77, .44], [.78, .9], [.48, .92]];
const DOOR = [[[-1.03, .97], [-.92, .3]], [[.16, .95], [.13, .3]]];

const lerp = (a, b, t) => a + (b - a) * t;
function sample(points, z, component = 1) {
  for (let i = 1; i < points.length; i++) if (z <= points[i][0]) {
    const a = points[i - 1], b = points[i], t = Math.max(0, (z - a[0]) / (b[0] - a[0]));
    return lerp(a[component], b[component], t);
  }
  return points.at(-1)[component];
}
// A station's value at z, between stations
function along(z, read) {
  const s = EXOTIC_STATIONS, found = s.findIndex(p => p.z >= z), i = Math.max(1, found < 0 ? s.length - 1 : found);
  const a = s[i - 1], b = s[i], t = Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z)));
  return lerp(read(a), read(b), t);
}
const sideTop = z => along(z, s => s.top);
const sideX = (z, y) => along(z, s => s.w) - (y <= BELT[0] ? .06 * (BELT[0] - y) / (BELT[0] - .2) : y <= BELT[1] ? 0 : (y - BELT[1]) * .5);
const sidePoint = (z, y, side, lift = 0) => [side * (sideX(z, y) + lift), y, z];
// A station's section across the top, [x, y, z] from the right side to the left
function section(s) {
  const half = [[sideX(s.z, s.top), s.top], ...s.row];
  return [...half, [0, s.middle], ...half.slice().reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x, y, s.z]);
}
// The top's height at (z, x), between stations and across their sections
function topAt(z, x) {
  const s = EXOTIC_STATIONS, found = s.findIndex(p => p.z >= z), i = Math.max(1, found < 0 ? s.length - 1 : found), a = section(s[i - 1]), b = section(s[i]);
  const t = Math.min(1, Math.max(0, (z - s[i - 1].z) / (s[i].z - s[i - 1].z))), row = a.map((p, k) => [lerp(p[0], b[k][0], t), lerp(p[1], b[k][1], t)]);
  for (let k = 0; k + 1 < row.length; k++) if (x <= row[k][0] && x >= row[k + 1][0]) return lerp(row[k][1], row[k + 1][1], (row[k][0] - x) / (row[k][0] - row[k + 1][0] || 1));
  return row[Math.floor(row.length / 2)][1];
}
// The nose comes to a point in plan and the tail rounds off, both leaning
// their upper faces back into the body. Ahead of and behind the wheel
// arches only, which stay where the wheels are.
const bendEnd = ([x, y, z]) => [x, y, z < -1.9
  ? z + Math.min(1, (-z - 1.9) / .35) * (.3 * Math.abs(x) + .06 * Math.max(0, y - .22))
  : z > 1.9 ? z - Math.min(1, (z - 1.9) / .35) * (.12 * Math.abs(x) + .07 * Math.max(0, y - .2)) : z];

function clip(points, value, axis, above) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], ina = above ? a[axis] >= value : a[axis] <= value, inb = above ? b[axis] >= value : b[axis] <= value;
    if (ina) result.push(a);
    if (ina !== inb) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      result.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return result;
}

export function exoticGeometry(wheel) {
  const parts = Object.fromEntries(['paint', 'details', 'headlights', 'taillights'].map(key => [key, { positions: [], colors: [] }]));
  const tint = new THREE.Color(), normal = new THREE.Vector3(), edge = new THREE.Vector3(), origin = new THREE.Vector3(), outward = new THREE.Vector3();
  function face(points, out, category = 'paint', color = PAINT) {
    const target = parts[category]; tint.set(color);
    // The nose and tail change direction at the centerline. Split crossing
    // faces there so the bumpers and recesses follow the same bend as the shell.
    const split = points.some(p => p[0] < 0) && points.some(p => p[0] > 0);
    for (const piece of split ? [clip(points, 0, 0, false), clip(points, 0, 0, true)] : [points]) {
      const bent = piece.map(bendEnd);
      for (let i = 1; i + 1 < bent.length; i++) {
        const a = bent[0], b = bent[i], c = bent[i + 1];
        origin.fromArray(a); normal.fromArray(b).sub(origin).cross(edge.fromArray(c).sub(origin));
        if (normal.lengthSq() < 1e-12) continue;
        const triangle = normal.dot(outward.fromArray(out)) >= 0 ? [a, b, c] : [a, c, b];
        for (const p of triangle) { target.positions.push(...p); target.colors.push(tint.r, tint.g, tint.b); }
      }
    }
  }
  function polygon(points, holes, project, out, category, color) {
    const vectors = list => list.map(p => new THREE.Vector2(...p)), flat = [points, ...holes].flat();
    for (const triangle of THREE.ShapeUtils.triangulateShape(vectors(points), holes.map(vectors))) face(triangle.map(i => project(flat[i])), out, category, color);
  }
  function box([w, h, l], [x, y, z], color = CARBON, category = 'details', skip = '') {
    const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
      .map(([sx, sy, sz]) => [x + sx * w / 2, y + sy * h / 2, z + sz * l / 2]);
    for (const [ids, out, name] of [[[0, 1, 2, 3], [0, 0, -1], '-z'], [[4, 5, 6, 7], [0, 0, 1], '+z'], [[0, 3, 7, 4], [-1, 0, 0], '-x'], [[1, 2, 6, 5], [1, 0, 0], '+x'], [[3, 2, 6, 7], [0, 1, 0], '+y'], [[0, 1, 5, 4], [0, -1, 0], '-y']])
      if (!skip.includes(name)) face(ids.map(i => corners[i]), out, category, color);
  }
  // A ring of `sides` points round (x, y) at z, facing along z
  const round = (x, y, z, radius, sides = 10, turn = 0) => Array.from({ length: sides }, (_, k) => {
    const a = turn + k / sides * Math.PI * 2; return [x + Math.cos(a) * radius, y + Math.sin(a) * radius, z];
  });
  // Panels on the sides share the shell's stations and belt bands, so each
  // piece lies flat on the wall it is drawn on, millimeters off it
  const breaks = EXOTIC_STATIONS.map(s => s.z);
  function sidePanel(points, side, color, category = 'details', lift = .004) {
    for (let j = 0; j + 1 < breaks.length; j++) for (const [bottom, top] of [[0, BELT[0]], [BELT[0], BELT[1]], [BELT[1], 2]]) {
      const band = clip(clip(clip(clip(points, breaks[j], 0, true), breaks[j + 1], 0, false), bottom, 1, true), top, 1, false);
      if (band.length >= 3) polygon(band, [], ([z, y]) => sidePoint(z, y, side, lift), [side, 0, 0], category, color);
    }
  }
  function ribbon(path, width, side, color, category = 'details', lift = .008) {
    const offsets = path.map((p, i) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [(b[1] - a[1]) * width / (2 * length), (a[0] - b[0]) * width / (2 * length)];
    });
    const point = (i, sign) => path[i].map((value, k) => value + offsets[i][k] * sign);
    for (let i = 0; i + 1 < path.length; i++) sidePanel([point(i, 1), point(i + 1, 1), point(i + 1, -1), point(i, -1)], side, color, category, lift);
  }
  // A patch laid on the top, [z, x] corners, `lift` over it, in a small
  // grid that follows the top's curve rather than sinking into it
  const onTop = (corners, category, color, lift = .014, cells = 3) => {
    const [a, b, c, d] = corners, at = (u, v) => {
      const z = lerp(lerp(a[0], b[0], u), lerp(d[0], c[0], u), v), x = lerp(lerp(a[1], b[1], u), lerp(d[1], c[1], u), v);
      return [x, topAt(z, x) + lift, z];
    };
    for (let i = 0; i < cells; i++) for (let j = 0; j < 2; j++) face([at(j / 2, i / cells), at((j + 1) / 2, i / cells), at((j + 1) / 2, (i + 1) / cells), at(j / 2, (i + 1) / cells)], [0, 1, 0], category, color);
  };

  // The sides, sill to shoulder, round the wheel arches
  const zs = [...new Set([...breaks, ...EXOTIC_BOTTOM.map(p => p[0])])].sort((a, b) => a - b);
  for (const side of [-1, 1]) for (let i = 0; i + 1 < zs.length; i++) {
    const band = z => {
      const bottom = sample(EXOTIC_BOTTOM, z), top = sideTop(z);
      return [bottom, ...BELT.map(y => Math.max(bottom, Math.min(top, y))), top].map(y => sidePoint(z, y, side));
    };
    const left = band(zs[i]), right = band(zs[i + 1]);
    for (let k = 0; k < 3; k++) face([left[k], right[k], right[k + 1], left[k + 1]], [side, 0, 0]);
  }

  // The top, station to station. Its outermost strips follow the sides'
  // top edge through every break between, so no slit opens where an arch
  // or the shoulder changes direction underneath them.
  const COLOURS = { p: ['paint', PAINT], g: ['details', GLASS], c: ['details', COVER] };
  for (let i = 0; i + 1 < EXOTIC_STATIONS.length; i++) {
    const a = section(EXOTIC_STATIONS[i]), b = section(EXOTIC_STATIONS[i + 1]), last = a.length - 1;
    for (let k = 0; k < last; k++) {
      const [category, color] = COLOURS[TOP[i][k < last / 2 ? k : last - 1 - k]];
      if (k === 0 || k === last - 1) {
        const inner = k === 0 ? 1 : last - 1, side = k === 0 ? 1 : -1;
        const rim = zs.filter(z => z >= a[0][2] && z <= b[0][2]).reverse().map(z => sidePoint(z, sideTop(z), side));
        face([a[inner], b[inner], ...rim], [0, 1, 0], category, color);
      } else face([a[k], b[k], b[k + 1], a[k + 1]], [0, 1, 0], category, color);
    }
  }
  // The engine cover's louvers, the hood's two vents, and the headlamps up
  // the front of each fender
  for (let k = 0; k < 6; k++) { const z = 1.02 + k * .17; box([.62, .018, .045], [0, topAt(z, 0) + .012, z], PAINT, 'paint', '-y-x+x'); }
  for (const side of [-1, 1]) {
    onTop([[-1.66, side * .24], [-1.66, side * .38], [-1.38, side * .4], [-1.38, side * .25]], 'details', '#141b20', .016, 2);
    onTop([[-2.23, side * .64], [-2.2, side * .88], [-1.74, side * 1], [-1.82, side * .72]], 'details', CARBON, .012, 2);
    onTop([[-2.19, side * .69], [-2.16, side * .85], [-1.79, side * .96], [-1.85, side * .77]], 'headlights', '#fff5cf', .022, 2);
  }

  for (const side of [-1, 1]) {
    sidePanel(EXOTIC_SCOOP, side, CARBON);
    for (const door of DOOR) ribbon(door, .018, side, '#2a3236');
    sidePanel([[-.8, .185], [.81, .185], [.74, .29], [-.76, .29]], side, CARBON);
    // A mirror on a stalk from the door's top
    box([.12, .035, .05], [side * 1, 1.0, -.8]);
    box([.14, .095, .2], [side * 1.1, 1.05, -.78], PAINT, 'paint');
    for (const z of [-1.35, 1.35]) {
      const rim = arch(z);
      polygon(rim, [], ([along, y]) => [side * .775, y, along], [side, 0, 0], 'details', CARBON);
      for (let i = 0; i + 1 < rim.length; i++) {
        const [a, ay] = rim[i], [b, by] = rim[i + 1];
        face([sidePoint(a, ay, side), sidePoint(b, by, side), [side * .775, by, b], [side * .775, ay, a]], [0, .43 - (ay + by) / 2, z - (a + b) / 2], 'details', CARBON);
      }
    }
  }
  box([1.5, .055, 4.1], [0, .2, 0], CARBON, 'details', '+y');

  // Each end's face from the top's section down to the sills, with its openings
  // (down each side through the belt's bends, so the face meets the sides' tuck-under without a slit)
  const endOutline = s => {
    const down = [...BELT.filter(y => y < s.top).reverse(), .2].map(y => [sideX(s.z, y), y]);
    return [...section(s).map(([x, y]) => [x, y]), ...down.map(([x, y]) => [-x, y]), ...down.reverse()];
  };
  const mirror = points => points.map(([x, y]) => [-x, y]).reverse();
  function recess(outline, z, depth, end, color = CARBON, floor = '#131d22') {
    const cx = outline.reduce((sum, p) => sum + p[0], 0) / outline.length, cy = outline.reduce((sum, p) => sum + p[1], 0) / outline.length;
    const inner = outline.map(([x, y]) => [cx + (x - cx) * .94, cy + (y - cy) * .84]);
    for (let i = 0; i < outline.length; i++) {
      const next = (i + 1) % outline.length;
      face([[...outline[i], z], [...outline[next], z], [...inner[next], z - end * depth], [...inner[i], z - end * depth]], [0, 0, end], 'details', color);
    }
    polygon(inner, [], ([x, y]) => [x, y, z - end * depth], [0, 0, end], 'details', floor);
  }
  // The nose: two big intakes either side of its point, and a slot under it
  const front = EXOTIC_STATIONS[0], intake = [[.25, .27], [.68, .27], [.7, .45], [.6, .5], [.3, .47]], slot = [[-.15, .26], [.15, .26], [.12, .4], [-.12, .4]];
  polygon(endOutline(front), [intake, mirror(intake), slot], ([x, y]) => [x, y, front.z], [0, 0, -1], 'paint', PAINT);
  for (const opening of [intake, mirror(intake), slot]) recess(opening, front.z, .08, -1, CARBON, MESH);
  // The tail: four round lamps in a black mesh band, twin pipes in the
  // middle and a finned diffuser under them
  const tail = EXOTIC_STATIONS.at(-1), band = [[-.74, .62], [.74, .62], [.72, .86], [-.72, .86]], diffuser = [[-.6, .23], [.6, .23], [.64, .42], [-.64, .42]];
  polygon(endOutline(tail), [band, diffuser], ([x, y]) => [x, y, tail.z], [0, 0, 1], 'paint', PAINT);
  recess(band, tail.z, .075, 1, CARBON, MESH);
  recess(diffuser, tail.z, .09, 1, CARBON, MESH);
  for (const x of [-.57, -.35, .35, .57]) {
    const z = tail.z - .062;
    polygon(round(x, .74, z, .09, 8), [round(x, .74, z, .074, 8)], ([px, py]) => [px, py, z], [0, 0, 1], 'details', CHROME);
    face(round(x, .74, z - .004, .076, 8), [0, 0, 1], 'taillights', '#8e3328');
  }
  for (const x of [-.13, .13]) {
    const outer = round(x, .53, 0, .068, 8, Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const [ax, ay] = outer[k], [bx, by] = outer[(k + 1) % 8];
      face([[ax, ay, tail.z - .1], [bx, by, tail.z - .1], [bx, by, tail.z + .05], [ax, ay, tail.z + .05]], [ax + bx - 2 * x, ay + by - 1.06, 0], 'details', CHROME);
    }
    face(round(x, .53, tail.z + .045, .05, 8, Math.PI / 8), [0, 0, 1], 'details', '#0c1012');
  }
  for (const x of [-.4, -.2, 0, .2, .4]) box([.025, .16, .2], [x, .315, tail.z - .07], CARBON, 'details', '-y-z');

  // A splitter under the nose and the diffuser's floor under the tail
  const lip = plan => {
    face(plan.map(([x, z]) => [x, .235, z]), [0, 1, 0], 'details', CARBON);
    for (let i = 0; i < plan.length; i++) {
      const [x, z] = plan[i], [nx, nz] = plan[(i + 1) % plan.length];
      face([[x, .13, z], [nx, .13, nz], [nx, .235, nz], [x, .235, z]], [x + nx, 0, z + nz], 'details', CARBON);
    }
  };
  lip([[-.92, -2], [-.8, -2.24], [0, -2.27], [.8, -2.24], [.92, -2]]);
  lip([[-.97, 2.02], [-.88, 2.24], [0, 2.26], [.88, 2.24], [.97, 2.02]]);

  const geometries = Object.fromEntries(Object.entries(parts).map(([key, { positions, colors }]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
    geometry.computeVertexNormals();
    return [key, geometry];
  }));
  const wheels = [-1, 1].flatMap(side => [-1.35, 1.35].map(z => ({ x: side * (EXOTIC_MODEL.width / 2 - wheel.inset), y: wheel.y, z, front: z < 0 })));
  return { ...geometries, wheels, roof: { y: 1.33, z: -.15, length: .8, width: 1.1 } };
}
