import * as THREE from 'three';

export const EXOTIC_MODEL = { name: 'exotic', width: 2.06, length: 4.5, cabin: [1.7, .47, 2.28], cabinZ: -.08, eye: [0, 1.3, -.85] };
export const EXOTIC_DARK = '#33465b', EXOTIC_TRIM = '#bdc2b7';
const GLASS = '#19292c', CARBON = '#1d282f', PAINT = '#ffffff';
const BELT = [.86, 1.04], PAINT_END = .28;

// [z, half-width, fender crown, bonnet/deck height, bonnet crease width].
// Wheel arches only divide the sides. The bonnet keeps its long triangular faces.
export const EXOTIC_BODY = [
  [-2.25, .84, .8, .845, .24], [-2.08, .96, .98, .925, .34], [-1.65, 1.03, 1.14, 1.01, .58],
  [-1.35, 1.03, 1.14, 1.02, .69], [-.92, 1.015, 1.095, 1.03, .8], [-.66, 1, 1.025, 1.02, .82],
  [.28, 1, 1.025, 1.02, .82], [.74, 1.025, 1.095, 1.06, .8], [1.35, 1.03, 1.165, 1.095, .76],
  [1.82, 1.015, 1.13, 1.09, .7], [2.25, .91, 1.015, 1.015, .57],
];
export const EXOTIC_ROOF = [[-.92, 1.03], [-.3, 1.475], [.12, 1.515], [.52, 1.48], [.8, 1.37], [1.28, 1.17], [1.82, 1.09]];
export const EXOTIC_WINDOW = [[-.78, 1.075], [-.31, 1.395], [-.11, 1.425], [.1, 1.43], [.32, 1.38], [.5, 1.265], [.615, 1.085]];
export const EXOTIC_SWEEP = [[-.69, 1.1], [-.47, 1.32], [-.2, 1.435], [.08, 1.46], [.34, 1.42], [.55, 1.285], [.69, 1.1], [.75, .91], [.68, .7], [.53, .51], [.31, .38], [.03, .325], [-.66, .3]];
export const EXOTIC_WING = { z: 1.94, y: 1.33, width: 1.7, depth: .3, height: .085, foot: 1.075 };
const arch = z => [[z - .54, .2], [z - .47, .49], [z - .3, .8], [z - .12, .915], [z + .12, .915], [z + .3, .8], [z + .47, .49], [z + .54, .2]];
export const EXOTIC_BOTTOM = [[-2.25, .2], ...arch(-1.35), ...arch(1.35), [2.25, .2]];

function sample(points, z, component = 1) {
  for (let i = 1; i < points.length; i++) if (z <= points[i][0]) {
    const a = points[i - 1], b = points[i], t = Math.max(0, (z - a[0]) / (b[0] - a[0]));
    return a[component] + (b[component] - a[component]) * t;
  }
  return points.at(-1)[component];
}
const inCabin = z => z >= EXOTIC_ROOF[0][0] && z <= EXOTIC_ROOF.at(-1)[0];
const sideTop = z => Math.max(sample(EXOTIC_BODY, z, 2), inCabin(z) ? sample(EXOTIC_ROOF, z) : 0);
const sideX = (z, y) => sample(EXOTIC_BODY, z) - (y <= BELT[0] ? .035 * (BELT[0] - y) / .66
  : y <= BELT[1] ? (y - BELT[0]) * .5 : .09 + (y - BELT[1]) * .36);
const sidePoint = (z, y, side, lift = 0) => [side * (sideX(z, y) + lift), y, z];
// Round both ends in plan and lean their upper faces back into the body.
const bendEnd = ([x, y, z]) => [x, y, z < -1.75
  ? z + Math.min(1, (-z - 1.75) / .5) * (.16 * Math.abs(x) + .1 * Math.max(0, y - .22))
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
    // The nose/tail change direction at the centreline. Split crossing faces
    // there so the bumper and recesses follow the same bend as the shell.
    const split = points.some(p => p[0] < 0) && points.some(p => p[0] > 0);
    for (const section of split ? [clip(points, 0, 0, false), clip(points, 0, 0, true)] : [points]) {
      const bent = section.map(bendEnd);
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
  function box([w, h, l], [x, y, z], color = CARBON, category = 'details') {
    const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
      .map(([sx, sy, sz]) => [x + sx * w / 2, y + sy * h / 2, z + sz * l / 2]);
    for (const [ids, out] of [[[0, 1, 2, 3], [0, 0, -1]], [[4, 5, 6, 7], [0, 0, 1]], [[0, 3, 7, 4], [-1, 0, 0]], [[1, 2, 6, 5], [1, 0, 0]], [[3, 2, 6, 7], [0, 1, 0]], [[0, 1, 5, 4], [0, -1, 0]]])
      face(ids.map(i => corners[i]), out, category, color);
  }
  // These panels share the shell's sections, including its shoulder. Trim
  // sits millimetres off that surface, rather than bridging across the curves.
  function sidePanel(points, side, color, category = 'details', lift = .004) {
    for (let j = 0; j + 1 < EXOTIC_BODY.length; j++) for (const [bottom, top] of [[0, BELT[0]], [BELT[0], BELT[1]], [BELT[1], 2]]) {
      const band = clip(clip(clip(clip(points, EXOTIC_BODY[j][0], 0, true), EXOTIC_BODY[j + 1][0], 0, false), bottom, 1, true), top, 1, false);
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

  const zs = [...new Set([...EXOTIC_BODY, ...EXOTIC_BOTTOM, ...EXOTIC_ROOF].map(p => p[0]))].sort((a, b) => a - b);
  for (const side of [-1, 1]) for (let i = 0; i + 1 < zs.length; i++) {
    const a = zs[i], b = zs[i + 1], dark = (a + b) / 2 > PAINT_END;
    const band = z => {
      const bottom = sample(EXOTIC_BOTTOM, z), top = sideTop(z);
      return [bottom, ...BELT.map(y => Math.max(bottom, Math.min(top, y))), top].map(y => sidePoint(z, y, side));
    };
    const left = band(a), right = band(b);
    for (let k = 0; k < 3; k++) face([left[k], right[k], right[k + 1], left[k + 1]], [side, 0, 0], dark ? 'details' : 'paint', dark ? EXOTIC_DARK : PAINT);
  }

  const bonnetRow = z => {
    const crown = sample(EXOTIC_BODY, z, 2), centre = sample(EXOTIC_BODY, z, 3), ridge = sample(EXOTIC_BODY, z, 4), width = sideX(z, crown);
    return [[width, crown], [ridge, centre + .018], [0, centre], [-ridge, centre + .018], [-width, crown]].map(([x, y]) => [x, y, z]);
  };
  // Follow the shell's edge at every section, while keeping long inner
  // faces. A straight edge between roof stations can otherwise leave slits
  // where a fender or the shoulder changes direction underneath it.
  function capBand(left, right, k, category, color) {
    if (k === 0 || k === 3) {
      const inner = k === 0 ? 1 : 3, side = k === 0 ? 1 : -1;
      const rim = zs.filter(z => z >= left[0][2] && z <= right[0][2]).reverse()
        .map(z => sidePoint(z, sideTop(z), side));
      face([left[inner], right[inner], ...rim], [0, 1, 0], category, color);
    } else face([left[k], right[k], right[k + 1], left[k + 1]], [0, 1, 0], category, color);
  }
  for (let i = 0; i + 1 < EXOTIC_BODY.length; i++) {
    const a = EXOTIC_BODY[i][0], b = EXOTIC_BODY[i + 1][0];
    if (a >= EXOTIC_ROOF[0][0] && b <= EXOTIC_ROOF.at(-1)[0]) continue;
    const left = bonnetRow(a), right = bonnetRow(b), dark = a > 0;
    for (let k = 0; k < 4; k++) capBand(left, right, k, dark ? 'details' : 'paint', dark ? EXOTIC_DARK : PAINT);
  }

  const roof = EXOTIC_ROOF.map(([z, y], i) => {
    const high = sideTop(z), width = sideX(z, high), inner = i >= 4 ? .52 + (z - .8) * .12 : width - .115;
    return [[width, high], [inner, y + .015], [0, y + .025], [-inner, y + .015], [-width, high]].map(([x, height]) => [x, height, z]);
  });
  for (let i = 0; i + 1 < roof.length; i++) for (let k = 0; k < 4; k++) {
    const rail = k === 0 || k === 3;
    if (!rail && i >= 4) continue;
    const blue = rail && i < 3, glass = !rail && i === 0;
    capBand(roof[i], roof[i + 1], k, blue ? 'paint' : 'details', blue ? PAINT : glass ? GLASS : EXOTIC_DARK);
  }
  // A rear window down between the flying buttresses, with a painted header
  // and a rear ledge. Leaving the centre of the loft open gives it real depth.
  const wellRim = [roof[4][1], roof[4][3], roof[5][3], roof[6][3], roof[6][1], roof[5][1]];
  const wellFloor = [[.47, 1.2, 1.01], [-.47, 1.2, 1.01], [-.545, 1.105, 1.34], [-.595, 1.045, 1.72], [.595, 1.045, 1.72], [.545, 1.105, 1.34]];
  for (let i = 0; i < wellRim.length; i++) {
    const next = (i + 1) % wellRim.length;
    face([wellRim[i], wellRim[next], wellFloor[next], wellFloor[i]], [0, 1, 0], 'details', EXOTIC_DARK);
  }
  face(wellFloor, [0, 1, 0], 'details', GLASS);
  for (const [row, z, direction, category, color] of [[roof[0], -.92, -1, 'paint', PAINT], [roof.at(-1), 1.82, 1, 'details', EXOTIC_DARK]]) {
    const deck = bonnetRow(z);
    for (let k = 0; k < 4; k++) face([row[k], row[k + 1], deck[k + 1], deck[k]], [0, 0, direction], category, color);
  }

  for (const side of [-1, 1]) {
    sidePanel(EXOTIC_WINDOW, side, GLASS);
    ribbon([[.245, 1.06], [.12, 1.425]], .043, side, EXOTIC_DARK);
    ribbon(EXOTIC_SWEEP, .065, side, EXOTIC_TRIM, 'details', .009);
    sidePanel([[-.8, .185], [.81, .185], [.74, .29], [-.76, .29]], side, CARBON);
    box([.1, .055, .09], [side * .995, 1.035, -.77]);
    box([.18, .135, .225], [side * 1.09, 1.105, -.79], PAINT, 'paint');
    for (const z of [-1.35, 1.35]) {
      const rim = arch(z);
      polygon(rim, [], ([along, y]) => [side * .775, y, along], [side, 0, 0], 'details', CARBON);
      for (let i = 0; i + 1 < rim.length; i++) {
        const [a, ay] = rim[i], [b, by] = rim[i + 1];
        face([sidePoint(a, ay, side), sidePoint(b, by, side), [side * .775, by, b], [side * .775, ay, a]], [0, .43 - (ay + by) / 2, z - (a + b) / 2], 'details', CARBON);
      }
    }
  }
  box([1.5, .055, 4.1], [0, .2, 0]);

  const grille = [[-.205, .205], [.205, .205], [.255, .535], [.235, .68], [.16, .78], [.065, .83], [-.065, .83], [-.16, .78], [-.235, .68], [-.255, .535]];
  const head = [[.36, .59], [.795, .625], [.79, .79], [.38, .765]];
  const inlet = [[.31, .265], [.775, .28], [.765, .475], [.35, .465]];
  const mirror = points => points.map(([x, y]) => [-x, y]).reverse();
  const frontHoles = [grille, head, mirror(head), inlet, mirror(inlet)];
  const endOutline = z => [...bonnetRow(z).map(([x, y]) => [x, y]), [-sideX(z, .2), .2], [sideX(z, .2), .2]];
  polygon(endOutline(-2.25), frontHoles, ([x, y]) => [x, y, -2.25], [0, 0, -1], 'paint', PAINT);

  function recess(outline, z, depth, end, color = CARBON) {
    const cx = outline.reduce((sum, p) => sum + p[0], 0) / outline.length, cy = outline.reduce((sum, p) => sum + p[1], 0) / outline.length;
    const inner = outline.map(([x, y]) => [cx + (x - cx) * .93, cy + (y - cy) * .83]);
    for (let i = 0; i < outline.length; i++) {
      const next = (i + 1) % outline.length;
      face([[...outline[i], z], [...outline[next], z], [...inner[next], z - end * depth], [...inner[i], z - end * depth]], [0, 0, end], 'details', color);
    }
    polygon(inner, [], ([x, y]) => [x, y, z - end * depth], [0, 0, end], 'details', '#131d22');
  }
  for (const opening of [head, mirror(head), inlet, mirror(inlet)]) recess(opening, -2.25, .065, -1);
  for (const side of [-1, 1]) face([[.46, .627], [.767, .65], [.755, .76], [.47, .745]].map(([x, y]) => [side * x, y, -2.218]), [0, 0, -1], 'headlights', '#fff5cf');
  const grilleInner = grille.map(([x, y]) => [x * .76, .5 + (y - .5) * .86]);
  for (let i = 0; i < grille.length; i++) {
    const next = (i + 1) % grille.length;
    face([[...grille[i], -2.275], [...grille[next], -2.275], [...grilleInner[next], -2.28], [...grilleInner[i], -2.28]], [0, 0, -1], 'details', EXOTIC_TRIM);
    face([[...grilleInner[i], -2.28], [...grilleInner[next], -2.28], [...grilleInner[next], -2.185], [...grilleInner[i], -2.185]], [0, 0, -1], 'details', CARBON);
  }
  polygon(grilleInner, [], ([x, y]) => [x, y, -2.18], [0, 0, -1], 'details', '#101718');

  const lampPanel = [[-.825, .68], [.825, .68], [.745, .915], [-.745, .915]];
  const rearInlet = [[.34, .265], [.825, .265], [.76, .53], [.385, .535]];
  const plate = [[-.23, .215], [.23, .215], [.31, .535], [-.31, .535]];
  polygon(endOutline(2.25), [lampPanel, rearInlet, mirror(rearInlet), plate], ([x, y]) => [x, y, 2.25], [0, 0, 1], 'details', EXOTIC_DARK);
  for (const opening of [lampPanel, rearInlet, mirror(rearInlet), plate]) recess(opening, 2.25, .075, 1, EXOTIC_DARK);
  for (const side of [-1, 1]) face([[.265, .738], [.755, .738], [.732, .818], [.27, .818]].map(([x, y]) => [side * x, y, 2.195]), [0, 0, 1], 'taillights', '#8e3328');
  const plateRim = [[-.16, .24], [.16, .24], [.22, .465], [-.22, .465]], plateInner = plateRim.map(([x, y]) => [x * .76, .35 + (y - .35) * .72]);
  polygon(plateRim, [plateInner], ([x, y]) => [x, y, 2.235], [0, 0, 1], 'details', EXOTIC_TRIM);

  const lip = plan => {
    face(plan.map(([x, along]) => [x, .235, along]), [0, 1, 0], 'details', CARBON);
    for (let i = 0; i < plan.length; i++) {
      const [x, along] = plan[i], [nx, nz] = plan[(i + 1) % plan.length];
      face([[x, .13, along], [nx, .13, nz], [nx, .235, nz], [x, .235, along]], [x + nx, 0, along + nz], 'details', CARBON);
    }
  };
  lip([[-.945, -2.04], [-.825, -2.265], [0, -2.275], [.825, -2.265], [.945, -2.04]]);
  lip([[-.975, 2.02], [-.89, 2.255], [0, 2.265], [.89, 2.255], [.975, 2.02]]);

  const wing = EXOTIC_WING;
  for (const side of [-1, 1]) box([.11, wing.y - wing.foot, .14], [side * .59, (wing.y + wing.foot) / 2, wing.z]);
  const wingPlan = [[-wing.width / 2 + .045, -wing.depth / 2], [wing.width / 2 - .045, -wing.depth / 2], [wing.width / 2, -.08], [wing.width / 2, wing.depth / 2], [-wing.width / 2, wing.depth / 2], [-wing.width / 2, -.08]];
  const wingTop = wingPlan.map(([x, z]) => [x, wing.y + wing.height / 2, z + wing.z]), wingBottom = wingPlan.map(([x, z]) => [x, wing.y - wing.height / 2, z + wing.z]);
  face(wingTop, [0, 1, 0], 'details', EXOTIC_DARK); face(wingBottom, [0, -1, 0], 'details', EXOTIC_DARK);
  for (let i = 0; i < wingTop.length; i++) {
    const next = (i + 1) % wingTop.length;
    face([wingTop[i], wingTop[next], wingBottom[next], wingBottom[i]], [wingTop[i][0] + wingTop[next][0], 0, wingPlan[i][1] + wingPlan[next][1]], 'details', EXOTIC_DARK);
  }

  const geometries = Object.fromEntries(Object.entries(parts).map(([key, { positions, colors }]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
    geometry.computeVertexNormals();
    return [key, geometry];
  }));
  const wheels = [-1, 1].flatMap(side => [-1.35, 1.35].map(z => ({ x: side * (EXOTIC_MODEL.width / 2 - wheel.inset), y: wheel.y, z, front: z < 0 })));
  return { ...geometries, wheels, roof: { y: 1.54, z: .1, length: .8, width: 1.5 } };
}
