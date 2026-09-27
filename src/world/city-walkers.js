import * as THREE from 'three';
import { Parts } from './city-assets.js';
import { compactGeometry } from './compact-geometry.js';

// Outfit, trim and silhouette are art-directed; skin and hair are selected
// independently. These are linear colors in the vertex shader, not tinting
// the entire person with their coat color.
export const WALKER_LOOKS = [
  { name: 'Harbor', coat: '#376f78', trim: '#e9c890', style: 0 },
  { name: 'Marigold', coat: '#c99438', trim: '#f2dfb8', style: 1 },
  { name: 'Clay', coat: '#b96753', trim: '#e7cdb3', style: 2 },
  { name: 'Iris', coat: '#7984b5', trim: '#edc5ac', style: 3 },
  { name: 'Fern', coat: '#7a9574', trim: '#efd9a8', style: 4 },
  { name: 'Mulberry', coat: '#855872', trim: '#edc9a3', style: 5 },
  { name: 'Cornflower', coat: '#5082b3', trim: '#efd8b9', style: 0 },
  { name: 'Oat', coat: '#d9c8a6', trim: '#568780', style: 1 },
  { name: 'Apricot', coat: '#d58d70', trim: '#f4dbad', style: 2 },
  { name: 'Olive', coat: '#78814f', trim: '#d9aa66', style: 3 },
  { name: 'Ink', coat: '#515d6a', trim: '#c88062', style: 4 },
  { name: 'Heather', coat: '#ac94b5', trim: '#ece0c3', style: 5 },
  { name: 'Copper', coat: '#a96643', trim: '#e2caa2', style: 6 },
  { name: 'Lagoon', coat: '#4c958d', trim: '#e9d99d', style: 7 },
  { name: 'Rosewood', coat: '#ad6075', trim: '#e6c1ad', style: 8 },
  { name: 'Atelier', coat: '#e1d3b5', trim: '#647a96', style: 9 },
  { name: 'Midnight', coat: '#394d70', trim: '#ce9c52', style: 10 },
  { name: 'Mist', coat: '#94b3b9', trim: '#e8d9c1', style: 11 },
  { name: 'Espresso', coat: '#705449', trim: '#cba780', style: 6 },
  { name: 'Seagrass', coat: '#8ba693', trim: '#eee2bc', style: 7 },
  { name: 'Aubergine', coat: '#68516e', trim: '#d8a2a0', style: 8 },
  { name: 'Saffron', coat: '#b9a04f', trim: '#576c68', style: 9 },
  { name: 'Evergreen', coat: '#43685d', trim: '#dda38b', style: 10 },
  { name: 'Peony', coat: '#c48f9a', trim: '#ecd5af', style: 11 },
];
export const WALKER_SKIN = ['#f4d3b6', '#e5b78f', '#cf996f', '#b97d56', '#a46949', '#96654a', '#79533f', '#654737'];
const skinWeights = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6, 7];
export const WALKER_HAIR = ['#302b2c', '#523c31', '#80533b', '#ae6740', '#ccaa6e', '#c6c1b5', '#686260', '#ece4d3'];
export const WALKER_STYLES = ['quiff', 'side-part', 'curls', 'bob', 'bun', 'bald',
  'crop-and-beard', 'rounded-curls', 'ponytail', 'beret', 'beanie', 'long-sweep'];
export const WALKER_COLORS = WALKER_LOOKS.map(look => look.coat);

// Channel masks pick the palette: cloth (r, 0, 0), skin (0, g, 0) and hair
// (0, 0, b), each shaded by its channel, trim (r, g, 0) and trousers
// (0, g, 1) shaded by g. Muted face details have all three channels and keep
// their own color. No textures or fragment shader branches are needed.
const cloth = new THREE.Color(1, 0, 0), skin = new THREE.Color(0, 1, 0);
const hair = new THREE.Color(0, 0, 1), trim = new THREE.Color(1, 1, 0);
const ink = '#302c32';

function ellipsoid(p, position, scale, color, segments = 8, rings = 4) {
  const geometry = new THREE.SphereGeometry(1, segments, rings);
  geometry.scale(...scale); p.add(geometry, position, color);
}

// Every silhouette adds the same pieces in the same order (a style without
// one collapses it to a point), so all twelve share one topology and the
// shader can morph between them: the coat, and the head (hair or hat, and
// the face); then what is worn is painted on the coat.
function silhouette(style) {
  const p = new Parts();
  walkerBody(p, style);
  walkerHead(p, style);
  walkerClothing(p, style);
  const merged = p.finish({ preserveNormals: true });
  const result = merged.toNonIndexed(); merged.dispose(); return result;
}

// Garments by style: long A-line coats, hip-length tops over trousers, and
// scarves wrapped round the collar.
const LONG = [3, 8, 11], TROUSERS = [1, 5, 6, 7, 9, 10], SCARF = [0, 4, 8, 11];

// The coat's rings, [radius, height] from the hem up to the collar. Every
// style has nine: by default hem, hem roll, hip, waist, chest, shoulder (the
// widest, as a person's is), its round, its top and the collar.
function coatProfile(style) {
  const rows = [[.255, .3], [.272, .318], [.27, .45], [.274, .62], [.283, .8], [.29, .95], [.275, 1.03], [.21, 1.09], [.135, 1.12]];
  if (LONG.includes(style)) Object.assign(rows, { 0: [.275, .3], 1: [.305, .325], 2: [.298, .42], 3: [.278, .62] });
  if (style === 3) Object.assign(rows, { 3: [.272, .6], 4: [.275, .66] });
  // Legs together, then the underside of the top's hem
  if (TROUSERS.includes(style)) Object.assign(rows, { 0: [.195, .3], 1: [.21, .52], 2: [.262, .53], 3: [.268, .62] });
  if ([1, 5, 7].includes(style)) Object.assign(rows, { 3: [.272, .7], 4: [.28, .84] });
  // The plain pullover has a close ribbed hem, not the team tops' broad
  // chest stripe. Reuse their colour band lower down on a softer body.
  if (style === 5) Object.assign(rows, { 2: [.27, .53], 3: [.274, .55], 4: [.29, .59], 5: [.3, .95] });
  // A boxy jacket, as broad at the hem as the shoulders; a padded vest
  if (style === 9) Object.assign(rows, { 2: [.298, .53], 3: [.3, .62], 4: [.3, .8], 5: [.3, .95] });
  if (style === 10) Object.assign(rows, { 3: [.29, .62], 4: [.3, .8] });
  // Spend the waist ring on a scarf's fold. It sits inside the shoulders,
  // instead of widening into a stiff cape across all four coat styles.
  if (SCARF.includes(style)) rows.splice(2, 7, [.276, .64], [.283, .8], [.29, .95], [.236, 1.025], [.25, 1.045], [.218, 1.115], [.15, 1.145]);
  // The fitted coat draws in above a flared skirt; the long wrap falls
  // loosely from a higher waist. Keep this shaping after the scarf's rings.
  if (style === 8) Object.assign(rows, { 0: [.286, .3], 1: [.307, .325], 2: [.253, .64], 3: [.263, .8] });
  if (style === 11) Object.assign(rows, { 0: [.312, .3], 1: [.324, .325], 2: [.286, .64], 3: [.263, .8], 4: [.28, .95], 6: [.255, 1.04], 7: [.22, 1.105] });
  return rows;
}

// Columns round the coat, in degrees from the front: one down the middle and
// two close beside it, so a neckline comes to a point and an open front or a
// scarf's tail can be drawn on the coat itself.
const COLUMNS = [0, 24, 58, 90, 135, 180, -135, -90, -58, -24].map(a => a * Math.PI / 180);

// The coat: a lathe built by hand, with fans for the hem and collar (the
// stock lathe spent sixteen degenerate triangles on its poles). The chest is
// rounder than the flatter back. Each face notes its place for the clothing.
function walkerBody(p, style) {
  const width = [1, 1.07, .96, 1.04, .93, 1.08, 1.02, 1.08, .96, 1.06, 1.08, .94][style];
  const rows = coatProfile(style), columns = COLUMNS.length, top = rows.length - 1, grid = [];
  // The open fronts narrow toward their hem instead of looking like a
  // broad pasted-on stripe. The parka's panels close to a slim placket.
  const opening = style === 6 ? [.5, .5, .5, .55, .65, .8, .9, .9, .9]
    : style === 9 ? [.7, .7, .7, .8, .9, 1, 1, 1, 1] : null;
  rows.forEach(([r, y], j) => {
    const pinch = style === 2 ? .2 : opening?.[j] ?? 1;
    const angles = COLUMNS.map(a => Math.abs(a) < .5 ? a * pinch : a);
    // The collar stands higher at the back than the front
    const dip = j === top ? .018 : j === top - 1 ? .01 : 0;
    // The chest swells forward under the shoulders; the back stays flat
    const chest = .8 + .08 * Math.max(0, 1 - Math.abs(y - .9) / .25);
    // The parka's hood lies folded down the back: a pouch over the shoulder
    // blades, its rim open behind the head, where the collar's cap lines it
    const hood = (style === 2 && [[.025, 0], [.06, .01], [.08, .035], [.075, .07]][j - top + 3]) || [0, 0];
    for (const a of angles) {
      const c = Math.cos(a), back = Math.max(0, -c - .3) / .7;
      grid.push(new THREE.Vector3(Math.sin(a) * r * width, y - dip * c + hood[1] * back,
        c > 0 ? -c * r * width * chest : Math.sqrt(-c) * r * width * .72 + hood[0] * back));
    }
  });
  const at = (j, k) => j * columns + (k % columns);
  // Diagonals mirror about the front, so shapes drawn on the faces are
  // symmetric: each runs from the column nearer the front, below, to the
  // far one above, leaving a near and a far half of each quad.
  const faces = [];
  for (let j = 0; j < top; j++) for (let q = 0; q < columns; q++) {
    const [n, f] = Math.abs(COLUMNS[q]) < Math.abs(COLUMNS[(q + 1) % columns]) ? [q, q + 1] : [q + 1, q];
    faces.push({ band: j, q, near: true, v: [at(j, n), at(j + 1, n), at(j + 1, f)] });
    faces.push({ band: j, q, near: false, v: [at(j, n), at(j + 1, f), at(j, f)] });
  }
  // Smooth normals round the sides; the fans are flat
  const normals = grid.map(() => new THREE.Vector3()), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const face of faces) {
    const [a, b, c] = face.v.map(i => grid[i]);
    const normal = e1.subVectors(b, a).cross(e2.subVectors(c, a)), out = a.clone().add(b).add(c).setY(0);
    if (normal.dot(out) < 0) { face.v.reverse(); normal.negate(); }
    for (const i of face.v) normals[i].add(normal);
  }
  normals.forEach(n => n.normalize());
  const position = [], normal = [], places = [];
  const add = (points, pointNormals, place) => {
    for (let i = 0; i < 3; i++) { position.push(...points[i].toArray()); normal.push(...pointNormals[i].toArray()); }
    places.push(place);
  };
  for (const { v, ...place } of faces) add(v.map(i => grid[i]), v.map(i => normals[i]), place);
  // The hem's underside is band -1 and the collar's cap the top band
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  for (let k = 1; k + 1 < columns; k++) {
    add([grid[at(0, 0)], grid[at(0, k)], grid[at(0, k + 1)]], [down, down, down], { band: -1, q: -1 });
    add([grid[at(top, 0)], grid[at(top, k + 1)], grid[at(top, k)]], [up, up, up], { band: top, q: -1 });
  }
  const coat = new THREE.BufferGeometry();
  coat.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  coat.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  coat.userData.places = places;
  p.add(coat, [0, 0, 0], cloth);
}

// The head, the hair or hat over it (a sculpted cap), one extra piece (a
// bun, beard, ponytail, pompom or beret) and the face: ears, eyes and brows.
function walkerHead(p, style) {
  ellipsoid(p, [0, 1.45, 0], [.25, .265, .235], skin, 10, 6);
  // A point `lift` out from the head's own facets toward `turn` radians
  // round from the face (toward +x) and `rise` up from its middle. Pieces
  // laid on the facets rather than the ideal ellipsoid meet them cleanly.
  const facets = p.parts.at(-1).attributes.position, centre = new THREE.Vector3(0, 1.45, 0);
  const ray = new THREE.Ray(), hit = new THREE.Vector3(), corner = [0, 1, 2].map(() => new THREE.Vector3());
  const onFace = (turn, rise, lift = 0) => {
    ray.set(centre, new THREE.Vector3(Math.sin(turn) * Math.cos(rise) * .25, Math.sin(rise) * .265,
      -Math.cos(turn) * Math.cos(rise) * .235).normalize());
    for (let i = 0; i < facets.count; i += 3) {
      corner.forEach((v, j) => v.fromBufferAttribute(facets, i + j));
      if (ray.intersectTriangle(...corner, false, hit)) return hit.addScaledVector(ray.direction, lift).toArray();
    }
    return onFace(turn + 1e-6, rise - 1e-6, lift); // exactly on an edge
  };
  // Remake a sphere as another closed shape: `at(ring, c)` places each ring
  // (pole to pole) round its section, keeping the sphere's winding.
  const reshape = (sphere, at) => {
    const { widthSegments } = sphere.parameters, position = sphere.attributes.position;
    for (let i = 0; i < position.count; i++) {
      position.setXYZ(i, ...at(Math.floor(i / (widthSegments + 1)), i % (widthSegments + 1) / widthSegments * Math.PI * 2));
    }
    sphere.computeVertexNormals(); return sphere;
  };
  // A shell lying on the head, along rings of [turn, rises, thick] (turn
  // increasing) between two [turn, rise] poles tucked into the head. Each
  // section runs from its upper edge out over three rises to its lower edge,
  // and back inside. Rings sit on the head's creases, and each face of the
  // shell over one row of facets, so none of the head shows through it.
  const shell = rings => (ring, c) => {
    if (rings[ring].length === 2) return onFace(...rings[ring], -.006);
    const [turn, rises, thick] = rings[ring], k = Math.round(c / (Math.PI / 4)) % 8;
    return onFace(turn, rises[Math.min(k, 8 - k)], [-.003, .65 * thick, thick, .8 * thick, -.003, -.03, -.03, -.03][k]);
  };
  const crease = Math.PI / 10; // half a facet's width

  // A separate sculpted cap leaves a real forehead. Its boundary goes behind
  // the temples instead of drawing a horizontal line across the face.
  const scalp = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const vertex = scalp.attributes.position, uv = scalp.attributes.uv;
  for (let i = 0; i < vertex.count; i++) {
    const phi = Math.atan2(vertex.getZ(i), -vertex.getX(i));
    const front = Math.max(0, -Math.sin(phi)), side = Math.cos(phi), back = Math.max(0, Math.sin(phi));
    const latitude = (1 - uv.getY(i)) * 1.25, ring = Math.min(4, Math.round(latitude * 4));
    // The beanie uses two rings at the same height for the lip of its folded
    // cuff; all other caps keep their evenly spaced rows.
    const row = style === 10 ? [0, .4, .78, .78, 1][ring] : Math.min(1, latitude);
    // The hairline, in radians from the crown. Short hair clears the ears and
    // comes down the back of the head to the nape: a cap stopping at the
    // ears read as hair on a bald ball from behind, and even as a face.
    let edge = 1.5 - front * .52 + back * .95;
    if (style === 1) edge += front * (.22 + side * .6);
    if (style === 2) edge = 1.85 - front * .88 + back * .6; // a mop over the ears
    if (style === 3 || style === 11) edge = (style === 11 ? 2.7 : 2.45) - front * (1.4 - side * .3);
    if (style === 4 || style === 8) edge -= .12 * (1 - back);
    if (style === 6) edge = 1.7 - front * .68 + back * .75;
    if (style === 7) edge = 2.05 - front * .95 + back * .45;
    if (style === 10) edge = 1.6 - front * .3 + back * .3;
    const theta = row * edge, top = 1 - row;
    // No curl at the crown, whose vertices must meet
    const curl = (style === 2 || style === 7) && row ? .022 * Math.cos(phi * 5 + row * Math.PI * 3) : 0;
    // Close crops under the beard and the beret
    const radius = (style === 6 || style === 9 ? .27 : style === 7 ? .335 : .28) + curl + (style === 2 ? .024 : 0);
    let x = -Math.cos(phi) * Math.sin(theta) * radius;
    let y = Math.cos(theta) * ((style === 6 || style === 9 ? .283 : style === 7 ? .34 : .3) + curl);
    let z = Math.sin(phi) * Math.sin(theta) * radius * .94;
    // Below the ears hair closes in to lie on the head, as cut hair does,
    // instead of flaring like a helmet; a beanie is pulled down behind.
    // Bobs hang free.
    const hug = [3, 11].includes(style) ? 0 : THREE.MathUtils.smoothstep(theta, ...(style === 7 ? [1.9, 2.6] : [1.35, 2.3]));
    const snug = [-Math.cos(phi) * Math.sin(theta) * .25 * 1.07, Math.cos(theta) * .265 * 1.07 - .01, Math.sin(phi) * Math.sin(theta) * .235 * 1.07];
    x += (snug[0] - x) * hug; y += (snug[1] - y) * hug; z += (snug[2] - z) * hug;
    if (style === 0) { x -= .045 * top; y += .085 * top + .03 * front * Math.sin(theta); }
    if (style === 1) { x -= .065 * top; y += .055 * top; }
    if (style === 3 || style === 11) {
      // Cut hair hangs from the temples instead of following the skull back
      // in under the jaw. The bob has a blunt edge; the long sweep drops
      // farther behind and over one shoulder, with its face left clear.
      const hang = THREE.MathUtils.smoothstep(theta, 1.35, 2.45);
      const fall = style === 11 ? .285 + .025 * side : .255;
      x += (-Math.cos(phi) * .264 - x) * hang;
      z += (Math.sin(phi) * .239 - z) * hang;
      y += (-fall - y) * hang;
      // These longer faces cross the head's widest facets between rows.
      // Leave a little clearance there, or a temple pokes through the hair.
      x *= 1.05; z *= 1.05;
    }
    if (style === 10) {
      y += .055 * top;
      if (ring >= 3) { x *= 1.08; z *= 1.08; }
    }
    // A sparse cap spans across, rather than along, some head facets at the
    // temples. Its close-fitting styles need the same small clearance.
    if ([0, 1, 4, 6, 8, 9].includes(style)) { x *= 1.04; z *= 1.04; }
    if (style === 5) {
      // Bald on top: a horseshoe of hair, narrow over the ears and deepest
      // behind, from the back of the crown to the nape. The crown rows sink
      // into the head straight under its upper edge, and the band runs out
      // at the temples.
      const upper = 1.35 - back * .2, lower = 1.5 + back * .85;
      const angle = [0, upper, upper, (upper + lower) / 2, lower][ring];
      const out = ring < 2 || front > .3 ? .85 : [1.025, 1.08 - back * .02, 1.05][ring - 2];
      x = -Math.cos(phi) * Math.sin(angle) * .25 * out;
      y = Math.cos(angle) * .265 * out - .01;
      z = Math.sin(phi) * Math.sin(angle) * .235 * out;
    }
    // Return the rim inside the head. An open, paper-thin cap can leave
    // detached-looking slivers around the temples from oblique cameras.
    if (latitude > 1.01) {
      const long = style === 3 || style === 11;
      x *= long ? .35 : .72; y *= long ? .65 : .72; z *= long ? .35 : .72;
    }
    vertex.setXYZ(i, x, y, z);
  }
  scalp.computeVertexNormals(); p.add(scalp, [0, 1.46, 0], style === 10 ? trim : hair);

  // Reuse this same small piece for tied hair, a beard, a wool pompom or a
  // beret worn over short hair. The other styles collapse it inside the head,
  // with no extra draw calls.
  const extra = new THREE.SphereGeometry(1, 8, 5);
  if (style === 6) {
    // A beard: a shell along the jaw from sideburn to sideburn, rising from
    // under the jaw to the cheek. A flat disc under the chin read as a strap
    // across the face, and an edge straight across under the eyes as a mask:
    // it dips from the sideburns to leave the upper lip bare.
    const cheek = [-.24, -.524, -.7, -.85, -.95], chin = [-.44, -.524, -.785, -1.047, -1.25];
    reshape(extra, shell([[-1.5, -.02], [-3 * crease, cheek, .022], [-crease, chin, .036],
      [crease, chin, .036], [3 * crease, cheek, .022], [1.5, -.02]]));
  } else if (style === 8) {
    // A ponytail gathered at the back of the crown, full below the tie and
    // tapering to its tip at the nape: rings of [y, z, width, depth].
    const rings = [[1.655, .19, 0, 0], [1.6, .255, .03, .028], [1.52, .3, .07, .058], [1.42, .315, .082, .066], [1.3, .305, .06, .05], [1.2, .28, 0, 0]];
    reshape(extra, (ring, c) => {
      const [y, z, width, depth] = rings[ring];
      return [-Math.cos(c) * width, y, z + Math.sin(c) * depth];
    });
  } else if (style === 9) {
    // A beret over short hair: a soft disc, widest near its underside
    // ([radius, y] rings), tilted over one ear. Made from the scalp, as it
    // was, it left the head bald beneath it.
    const rings = [[0, .1], [.2, .088], [.315, .05], [.36, 0], [.23, -.04], [0, -.05]];
    reshape(extra, (ring, c) => [-Math.cos(c) * rings[ring][0], rings[ring][1], Math.sin(c) * rings[ring][0] * .96]);
    extra.rotateZ(.22).rotateX(-.1).translate(-.04, 1.68, .02);
  } else {
    // A bun, a pompom, or nothing
    const [at, size] = { 4: [[0, 1.71, .13], [.135, .12, .13]], 10: [[0, 1.83, 0], [.075, .075, .075]] }[style] ?? [[0, 1.45, 0], [0, 0, 0]];
    extra.scale(...size).translate(...at);
  }
  p.add(extra, [0, 0, 0], style === 9 || style === 10 ? trim : hair);

  for (const side of [-1, 1]) {
    // Ears: small five-sided bipyramids leaning back, their inner half in
    // the head. Long hair and the afro cover them.
    const ear = new THREE.SphereGeometry(1, 5, 2);
    ear.scale(...([2, 3, 7, 11].includes(style) ? [0, 0, 0] : [.042, .022, .028]));
    p.add(ear, [side * .246, 1.44, .01], skin, [.25, 0, -side * Math.PI / 2]);
    // Oval eyes, not diamonds
    const eye = new THREE.CircleGeometry(.017, 6, Math.PI / 2); eye.scale(1, 1.25, 1);
    p.add(eye, [side * .074, 1.458, -.226], ink, [0, Math.PI - side * .3, 0]);
    // Short brows in a darker shade of the hair, laid on the facets and bent
    // over the crease between them, so no edge lifts off the face.
    const brow = [[.14, .245, .025], [crease, .248, .021], [.44, .232, .013]]
      .flatMap(([turn, rise, half]) => [onFace(side * turn, rise + half, .0025), onFace(side * turn, rise - half, .0025)]);
    const strip = [];
    for (const k of [0, 2]) {
      const [a, b, c, d] = brow.slice(k, k + 4);
      for (const triangle of [[a, b, c], [c, b, d]]) {
        const [u, v, w] = triangle.map(point => new THREE.Vector3(...point));
        const outward = v.clone().sub(u).cross(w.clone().sub(u)).dot(u.clone().sub(centre)) > 0;
        strip.push(...(outward ? [u, v, w] : [u, w, v]).flatMap(point => point.toArray()));
      }
    }
    const browGeometry = new THREE.BufferGeometry();
    browGeometry.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3));
    browGeometry.computeVertexNormals();
    p.add(browGeometry, [0, 0, 0], new THREE.Color(0, 0, .8));
    const glasses = new THREE.RingGeometry(.033, .044, 8);
    if (![5, 6, 9].includes(style)) glasses.scale(0, 0, 0);
    p.add(glasses, [side * .074, 1.46, -.24], ink, [0, Math.PI - side * .3, 0]);
  }
  const bridge = new THREE.PlaneGeometry(.065, .012);
  if (![5, 6, 9].includes(style)) bridge.scale(0, 0, 0);
  p.add(bridge, [0, 1.46, -.251], ink, [0, Math.PI, 0]);
}

// What is worn, drawn on the coat's own faces (no decals floating off it)
// as colour masks: the coat, shaded, trim (shaded too) and trousers. Quads 0
// and 9 are the narrow panels either side of the front's middle, 4 and 5
// the back. Faces meeting in one colour in every style share vertices, so
// undersides are left to the light rather than shaded here.
const TRIM = [1, 1, 0], legs = shade => [0, shade, 1];
function clothingColor(style, { band, q, near }) {
  const panel = q === 0 || q === 9, side = [2, 3, 6, 7].includes(q), trousers = TROUSERS.includes(style);
  if (band < 0) return trousers ? legs(.6) : [.6, 0, 0];
  if (band === 8) return [1, .7, 0];
  if (trousers && band === 0) return legs(1);
  // A scarf's roll, and one tail down the chest
  if (SCARF.includes(style) && (band >= 5 || q === 9 && band >= 2)) return TRIM;
  // Crew necks' collars go all round, the others' show at the front; the
  // parka's hood is lined, and it closes on a placket
  if (band === 7 && style === 2) return q === 4 || q === 5 ? [1, .8, 0] : [1, 0, 0];
  if (band === 7) return [1, 5, 7, 10].includes(style) || panel ? TRIM : [1, 0, 0];
  if (style === 2 && panel && band >= 1) return TRIM;
  // The belted coat's V neck, and open fronts over a shirt
  if (style === 3 && (panel && (band === 6 || band === 5 && near) || band === 3)) return TRIM;
  if ([6, 9].includes(style) && panel && band >= 2) return TRIM;
  if ([1, 5, 7].includes(style) && band === 3) return TRIM;
  // A vest over a jumper, whose sleeves show at the sides
  if (style === 10 && side && band >= 2) return TRIM;
  return [!trousers && band === 0 ? .76 : 1, 0, 0];
}
function walkerClothing(p, style) {
  const coat = p.parts.find(part => part.userData.places), colors = coat.attributes.color;
  coat.userData.places.forEach((place, t) => {
    const mask = clothingColor(style, place);
    for (let i = 0; i < 3; i++) colors.setXYZ(t * 3 + i, ...mask);
  });
  delete coat.userData.places;
}

function walkerGeometry() {
  const variants = WALKER_STYLES.map((_, style) => silhouette(style));
  for (const variant of variants) {
    const color = variant.attributes.color, rgba = new Float32Array(color.count * 4);
    for (let i = 0; i < color.count; i++) rgba.set([color.getX(i), color.getY(i), color.getZ(i), 1], i * 4);
    variant.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  }
  const geometry = variants[0];
  // Index against ALL silhouettes, so a seam/normal needed by a different
  // hairstyle cannot be lost. The stock morph path also works in shadow/AO
  // passes, avoiding a second custom animation or depth implementation.
  for (let i = 0; i < variants.length; i++) for (const name of ['position', 'normal', 'color']) {
    geometry.setAttribute(`${name}${i}`, variants[i].attributes[name]);
  }
  compactGeometry(geometry);
  for (const name of ['position', 'normal', 'color']) {
    geometry.morphAttributes[name] = variants.map((_, i) => {
      const attribute = geometry.getAttribute(`${name}${i}`);
      attribute.name = WALKER_STYLES[i]; geometry.deleteAttribute(`${name}${i}`); return attribute;
    });
  }
  for (const variant of variants.slice(1)) variant.dispose();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
export const cityWalker = walkerGeometry();

const coatPalette = WALKER_LOOKS.map(look => new THREE.Color(look.coat));
const trimPalette = WALKER_LOOKS.map(look => new THREE.Color(look.trim));
const skinPalette = WALKER_SKIN.map(color => new THREE.Color(color));
const hairPalette = WALKER_HAIR.map(color => new THREE.Color(color));
// Trousers: denim, charcoal and brown, by look
const legsPalette = ['#44506a', '#3b3d44', '#4d4039'].map(color => new THREE.Color(color));

export function createWalkerMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .92 });
  material.customProgramCacheKey = () => 'citydriver-walker-palettes-v4';
  // Demolition's warning (see createWalkerAlert): 1 glows them red at the
  // edges; 0, as everywhere else, leaves them exactly as they were
  material.userData.alert = { value: 0 };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      walkerCoats: { value: coatPalette }, walkerTrims: { value: trimPalette },
      walkerSkin: { value: skinPalette }, walkerHair: { value: hairPalette }, walkerLegs: { value: legsPalette },
      walkerAlert: material.userData.alert,
    });
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform float walkerAlert;
    `).replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      if (walkerAlert > 0.0) {
        float walkerRim = 1.0 - abs(dot(normal, isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.85, .1, .07), .45 * walkerAlert);
        totalEmissiveRadiance += walkerAlert * mix(vec3(.5, .03, .02), vec3(1.2, .6, .5), walkerRim * walkerRim) * (.2 + 1.2 * walkerRim * walkerRim);
      }
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      uniform vec3 walkerCoats[${coatPalette.length}];
      uniform vec3 walkerTrims[${trimPalette.length}];
      uniform vec3 walkerSkin[${skinPalette.length}];
      uniform vec3 walkerHair[${hairPalette.length}];
      uniform vec3 walkerLegs[${legsPalette.length}];
    `).replace('#include <color_vertex>', 'vColor = color;')
      // Select the one active shape directly in the color pass: three fetches
      // per vertex regardless of cast size. Keep stock morph weights for the
      // renderer's shadow and optional AO override materials.
      .replace('#include <morphinstance_vertex>', `
      int walkerShape = 0;
      #ifdef USE_INSTANCING_COLOR
        walkerShape = int(fract(instanceColor.r) * 16.0 + 0.5);
      #endif
    `).replace('#include <morphnormal_vertex>', 'objectNormal = getMorph(gl_VertexID, walkerShape, 1).xyz;')
      .replace('#include <morphtarget_vertex>', 'transformed = getMorph(gl_VertexID, walkerShape, 0).xyz;')
      .replace('#include <morphcolor_vertex>', `
      vColor = getMorph(gl_VertexID, walkerShape, 2);
      ivec3 look = ivec3(0, 2, 0);
      #ifdef USE_INSTANCING_COLOR
        look = ivec3(instanceColor);
      #endif
      vec3 mask = vColor.rgb;
      if (mask.b == 0.0 && mask.r > 0.0 && mask.g > 0.0) vColor.rgb = walkerTrims[look.x] * mask.g;
      else if (mask.g == 0.0 && mask.b == 0.0) vColor.rgb = walkerCoats[look.x] * mask.r;
      else if (mask.r == 0.0 && mask.b == 0.0) vColor.rgb = walkerSkin[look.y] * mask.g;
      else if (mask.r == 0.0 && mask.g == 0.0) vColor.rgb = walkerHair[look.z] * mask.b;
      else if (mask.r == 0.0 && mask.b == 1.0) vColor.rgb = walkerLegs[look.x % ${legsPalette.length}] * mask.g;
    `);
  };
  return material;
}

// Demolition's warning: a resident costs a fine, so they glow red (the
// walker material's `alert`) and show as red ghosts through anything but a
// building: trees, posts, signals, signs, cars. Buildings draw first
// (renderOrder -2, as for the car silhouette); the mask then marks in the
// stencil where a resident stands in front of them, before anything else
// draws; the ghost draws last, only there, and only where something nearer
// covers them. `lift` brings a pass that far toward the lens along its own
// ray: the ghost's keeps a resident's head from counting as cover over their
// own coat, and the mask's lets one brushing a wall keep their glow. Needs a
// stencil buffer (see createRendering). No render targets or extra geometry:
// two more instanced draws a chunk, only while the warning is on.
const alertVertex = /* glsl */`
  #include <common>
  #include <morphtarget_pars_vertex>
  uniform float lift;
  varying float vRim;
  varying float vFade;
  void main() {
    vec3 transformed = position, objectNormal = normal;
    #ifdef USE_MORPHTARGETS
      int walkerShape = 0;
      #ifdef USE_INSTANCING_COLOR
        walkerShape = int(fract(instanceColor.r) * 16.0 + 0.5);
      #endif
      transformed = getMorph(gl_VertexID, walkerShape, 0).xyz;
      objectNormal = getMorph(gl_VertexID, walkerShape, 1).xyz;
    #endif
    vec4 mvPosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
      objectNormal = mat3(instanceMatrix) * objectNormal;
    #endif
    mvPosition = modelViewMatrix * mvPosition;
    float reach = length(mvPosition.xyz);
    vec3 toLens = isOrthographic ? vec3(0.0, 0.0, 1.0) : -mvPosition.xyz / reach;
    vRim = 1.0 - abs(dot(normalize(normalMatrix * objectNormal), toLens));
    // (overhead, every resident in view is near the car)
    vFade = isOrthographic ? 1.0 : 1.0 - smoothstep(90.0, 150.0, reach);
    mvPosition.xyz += toLens * min(lift, reach * .5);
    gl_Position = projectionMatrix * mvPosition;
  }
`;
export function createWalkerAlert() {
  const mask = new THREE.ShaderMaterial({
    name: 'walker-alert-mask', uniforms: { lift: { value: .25 } }, vertexShader: alertVertex,
    fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
    colorWrite: false, depthWrite: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  // (drawn once a pixel: the first face there clears its mark, so no part of
  // a resident blends over another)
  const ghost = new THREE.ShaderMaterial({
    name: 'walker-alert-ghost', uniforms: { lift: { value: .6 } }, vertexShader: alertVertex,
    fragmentShader: /* glsl */`
      varying float vRim;
      varying float vFade;
      // (light enough to stand out by brightness alone, whatever the
      // player's colour vision: dark red on leaves is one shade to many)
      void main() {
        float edge = smoothstep(.3, .85, vRim);
        gl_FragColor = vec4(mix(vec3(1.0, .36, .28), vec3(1.0, .93, .9), edge), (.75 + .25 * edge) * vFade);
      }
    `,
    transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.ZeroStencilOp,
  });
  mask.visible = ghost.visible = false;
  return { mask, ghost };
}
// The mask and ghost of a mesh of residents: copies sharing its geometry and
// instances, so they follow it wherever it is drawn
export function addWalkerAlert(mesh, { mask, ghost }) {
  const copies = [[mask, -1], [ghost, 2]].map(([material, order]) => {
    const copy = new THREE.InstancedMesh(mesh.geometry, material, mesh.count);
    copy.name = `${mesh.name}-${material.name}`; copy.renderOrder = order;
    // (an instanced mesh with morphs needs its morph texture, though the
    // shader picks the shape from the instance colour)
    copy.instanceMatrix = mesh.instanceMatrix; copy.instanceColor = mesh.instanceColor; copy.morphTexture = mesh.morphTexture;
    copy.boundingSphere = mesh.boundingSphere; copy.userData.ambientOcclusion = false;
    mesh.add(copy);
    return copy;
  });
  const dispose = mesh.dispose.bind(mesh);
  mesh.dispose = () => { for (const copy of copies) { copy.morphTexture = null; copy.dispose(); } return dispose(); };
}

function hash(seed) {
  let n = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
// Hair within a shade of the face (blond on tan, brown on brown) loses the
// hairline, brows and beard in it; such a pair takes the next darker hair.
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hairClash = WALKER_SKIN.map(s => WALKER_HAIR.map(h => Math.hypot(...rgb(s).map((c, i) => c - rgb(h)[i])) < 34));
export function walkerAppearance(seed) {
  const look = hash(seed) % WALKER_LOOKS.length, skin = skinWeights[hash(seed ^ 0x3671) % skinWeights.length];
  let hair = hash(seed ^ 0x9173) % WALKER_HAIR.length;
  while (hairClash[skin][hair]) hair = (hair + WALKER_HAIR.length - 1) % WALKER_HAIR.length;
  return { look, skin, hair, style: WALKER_LOOKS[look].style };
}

// One small wardrobe per fare makes a party readable at driving distance.
// A team shares its tops; other groups take turns between two coordinated
// coats across different silhouettes (four of one coat read as clones).
const taxiWardrobes = [
  { looks: [10, 16], styles: [0, 6, 8] }, // work friends
  { looks: [5, 18], styles: [3, 4, 11] }, // evening out
  { looks: [13, 17], styles: [1, 7], uniform: true }, // matching team tops
  { looks: [15, 21], styles: [9] }, // art club
  { looks: [16, 22], styles: [10] }, // winter outing
  { looks: [2, 8], styles: [0, 2, 4, 8] }, // festival friends
];
export function taxiGroupAppearance(seed, passenger) {
  const wardrobe = taxiWardrobes[hash(seed ^ 0x6321) % taxiWardrobes.length];
  const appearance = walkerAppearance(seed + passenger * 719);
  appearance.look = wardrobe.looks[(hash(seed ^ 0x1709) + (wardrobe.uniform ? 0 : passenger)) % wardrobe.looks.length];
  appearance.style = wardrobe.styles[hash(seed + passenger * 31) % wardrobe.styles.length];
  return appearance;
}

// Pair existing residents rather than increasing the crowd. Shared travel
// phase/speed keeps them together through culling and streaming; their bob,
// proportions and wardrobe remain individual.
const pairStyles = { masculine: [0, 1, 5, 6], feminine: [3, 4, 8, 11] };
export function pairWalkers(walkers, seed) {
  for (let i = 0; i + 1 < walkers.length; i += 2) {
    const key = hash(seed + i * 941);
    if (key % 100 >= 38) continue;
    const a = walkers[i], b = walkers[i + 1], kind = hash(key) % 100;
    const mixed = kind < 70, first = kind >= 85 || (mixed && key % 2) ? 'feminine' : 'masculine';
    const second = mixed ? (first === 'masculine' ? 'feminine' : 'masculine') : first;
    for (const [walker, presentation, offset] of [[a, first, -.46], [b, second, .46]]) {
      walker.floatPhase = walker.phase;
      walker.pairOffset = offset;
      walker.appearance.presentation = presentation;
      walker.appearance.style = pairStyles[presentation][hash(key + (offset > 0 ? 73 : 29)) % 4];
    }
    b.phase = a.phase; b.speed = a.speed; b.side = a.side; b.direction = a.direction;
    if (a.appearance.look === b.appearance.look) b.appearance.look = (b.appearance.look + 7) % WALKER_LOOKS.length;
  }
}

const encoded = new THREE.Color();
const selection = { morphTargetInfluences: new Array(WALKER_STYLES.length).fill(0) };
export function setWalkerAppearance(mesh, index, appearance) {
  const { look, skin, hair } = appearance;
  // Reuse the existing per-instance color buffer for three palette indices.
  // These and the one-hot shape selection are uploaded only at creation.
  const style = appearance.style ?? WALKER_LOOKS[look].style;
  mesh.setColorAt(index, encoded.setRGB(look + style / 16, skin, hair));
  selection.morphTargetInfluences.fill(0);
  selection.morphTargetInfluences[style] = 1;
  mesh.setMorphAt(index, selection);
  mesh.instanceColor.needsUpdate = true; mesh.morphTexture.needsUpdate = true;
}
