import * as THREE from 'three';

// A resident is a peg: a coat or top over a stub of trousers, and a head
// floating over the collar, with no limbs at all. Four slots are mixed per
// person: the outfit, the hair or hat (with the ears it leaves showing), the
// face and what they wear on their back. Each slot is a set of morph targets
// of one fixed topology, so any combination is one instanced draw.

// Coats and their trim are art-directed pairs; everything else is chosen
// independently. Linear colors, mapped in the vertex shader.
export const WALKER_LOOKS = [
  { name: 'Harbor', coat: '#376f78', trim: '#e9c890' },
  { name: 'Marigold', coat: '#c99438', trim: '#f2dfb8' },
  { name: 'Clay', coat: '#b96753', trim: '#e7cdb3' },
  { name: 'Iris', coat: '#7984b5', trim: '#edc5ac' },
  { name: 'Fern', coat: '#7a9574', trim: '#efd9a8' },
  { name: 'Mulberry', coat: '#855872', trim: '#edc9a3' },
  { name: 'Cornflower', coat: '#5082b3', trim: '#efd8b9' },
  { name: 'Oat', coat: '#d9c8a6', trim: '#568780' },
  { name: 'Apricot', coat: '#d58d70', trim: '#f4dbad' },
  { name: 'Olive', coat: '#78814f', trim: '#d9aa66' },
  { name: 'Ink', coat: '#515d6a', trim: '#c88062' },
  { name: 'Heather', coat: '#ac94b5', trim: '#ece0c3' },
  { name: 'Copper', coat: '#a96643', trim: '#e2caa2' },
  { name: 'Lagoon', coat: '#4c958d', trim: '#e9d99d' },
  { name: 'Rosewood', coat: '#ad6075', trim: '#e6c1ad' },
  { name: 'Atelier', coat: '#e1d3b5', trim: '#647a96' },
  { name: 'Midnight', coat: '#394d70', trim: '#ce9c52' },
  { name: 'Mist', coat: '#94b3b9', trim: '#e8d9c1' },
  { name: 'Espresso', coat: '#705449', trim: '#cba780' },
  { name: 'Seagrass', coat: '#8ba693', trim: '#eee2bc' },
  { name: 'Aubergine', coat: '#68516e', trim: '#d8a2a0' },
  { name: 'Saffron', coat: '#b9a04f', trim: '#576c68' },
  { name: 'Evergreen', coat: '#43685d', trim: '#dda38b' },
  { name: 'Peony', coat: '#c48f9a', trim: '#ecd5af' },
  // Office suits, and the warehouse district's high-visibility work wear
  { name: 'Navy suit', coat: '#2f3b55', trim: '#c9cdd3' },
  { name: 'Charcoal suit', coat: '#3d3f45', trim: '#b8bcc2' },
  { name: 'Stone suit', coat: '#8c8577', trim: '#e6e1d6' },
  { name: 'Hi-vis', coat: '#d6d23c', trim: '#c4cacc' },
  { name: 'Safety orange', coat: '#df7432', trim: '#d2d6d6' },
  { name: 'Workwear', coat: '#3f5566', trim: '#e0b049' },
];
export const WALKER_SKIN = ['#f4d3b6', '#e5b78f', '#cf996f', '#b97d56', '#a46949', '#96654a', '#79533f', '#654737'];
const skinWeights = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6, 7];
export const WALKER_HAIR = ['#302b2c', '#523c31', '#80533b', '#ae6740', '#ccaa6e', '#c6c1b5', '#686260', '#ece4d3'];
// Trousers, and the accents: caps, bags, ties and headscarves
export const WALKER_LEGS = ['#44506a', '#3b3d44', '#4d4039', '#2e3a55', '#857a60', '#56604a', '#2a2a2e'];
export const WALKER_ACCENTS = ['#a8433a', '#c9973a', '#35506e', '#6f8a5b', '#7b5a45', '#2d2b2e', '#d6cbb6', '#b86a8d'];
export const WALKER_COLORS = WALKER_LOOKS.map(look => look.coat);

export const WALKER_OUTFITS = ['scarf-coat', 'team-top', 'parka', 'belted-coat', 'duffel', 'pullover', 'cardigan',
  'hooped-top', 'fitted-coat', 'jacket', 'vest', 'wrap-coat', 'dress', 'hoodie', 'suit', 'puffer'];
export const WALKER_STYLES = ['quiff', 'side-part', 'curls', 'bob', 'bun', 'bald', 'crop', 'afro',
  'ponytail', 'beret', 'beanie', 'long-sweep', 'cap', 'flat-cap', 'headscarf', 'sun-hat'];
export const WALKER_FACES = ['plain', 'glasses', 'moustache', 'sunglasses', 'round-glasses'];
export const WALKER_GEAR = ['none', 'backpack', 'shoulder-bag', 'satchel'];
const SLOTS = [WALKER_OUTFITS, WALKER_STYLES, WALKER_FACES, WALKER_GEAR];
// Each slot's targets follow the one before's
const SLOT_BASE = SLOTS.map((_, i) => SLOTS.slice(0, i).reduce((sum, slot) => sum + slot.length, 0));
export const WALKER_TARGETS = SLOT_BASE[3] + WALKER_GEAR.length;

// What colors a vertex: one of these palettes (or a fixed color), times a
// shade. The morphed "color" attribute carries [channel, shade, 0, 1].
const CH = { coat: 0, trim: 1, skin: 2, hair: 3, legs: 4, accent: 5, ink: 6, lens: 7, shirt: 8, straw: 9 };
export const WALKER_CHANNELS = CH;

// ---------------------------------------------------------------------------
// Building pieces. A slot's pieces go in the same order in every variant; a
// variant without one collapses it to a point (inside the head or body).

class Piece {
  constructor(slot) { this.slot = slot; this.position = []; this.normal = []; this.data = []; }
  // `paint` is [channel, shade], or a function of the triangle's index
  add(source, paint, position = [0, 0, 0], rotation = [0, 0, 0], scale = null) {
    // (scaled while still indexed, so smooth normals stay smooth)
    if (scale) source.scale(...scale);
    let g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    g.translate(...position);
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const [channel, shade] = typeof paint === 'function' ? paint(Math.floor(i / 3)) : paint;
      this.position.push(p.getX(i), p.getY(i), p.getZ(i));
      // (a piece collapsed to a point has no normal of its own)
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i), length = Math.hypot(nx, ny, nz) || 1;
      this.normal.push(nx / length, ny / length, nz / length);
      this.data.push(channel, shade, 0, 1);
    }
    g.dispose();
  }
  get count() { return this.position.length / 3; }
}

function sphere(w, h, scale, at, paint, piece) {
  piece.add(new THREE.SphereGeometry(1, w, h), paint, at, [0, 0, 0], scale);
}
// Something a variant does not have: every vertex at one point
function collapse(g, at) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...at);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------- the outfit

// Garments by outfit: long A-line coats and a dress, hip-length tops over
// trousers, and scarves wrapped round the collar.
const LONG = [3, 8, 11, 12], TROUSERS = [1, 5, 6, 7, 9, 10, 13, 14, 15], SCARF = [0, 4, 8, 11];

// The coat's rings, [radius, height] from the hem up to the collar. Every
// outfit has nine: by default hem, hem roll, hip, waist, chest, shoulder (the
// widest, as a person's is), its round, its top and the collar.
function coatProfile(style) {
  const rows = [[.255, .3], [.272, .318], [.27, .45], [.274, .62], [.283, .8], [.29, .95], [.275, 1.03], [.21, 1.09], [.135, 1.12]];
  if (LONG.includes(style)) Object.assign(rows, { 0: [.275, .3], 1: [.305, .325], 2: [.298, .42], 3: [.278, .62] });
  if (style === 3) Object.assign(rows, { 3: [.272, .6], 4: [.275, .66] });
  // Legs together, then the underside of the top's hem
  if (TROUSERS.includes(style)) Object.assign(rows, { 0: [.195, .3], 1: [.21, .52], 2: [.262, .53], 3: [.268, .62] });
  if ([1, 5, 7].includes(style)) Object.assign(rows, { 3: [.272, .7], 4: [.28, .84] });
  // The plain pullover has a close ribbed hem, not the team tops' broad
  // chest stripe. Reuse their color band lower down on a softer body.
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
  // A dress: a full skirt from a belted waist, a fitted bodice
  if (style === 12) Object.assign(rows, { 0: [.318, .3], 1: [.33, .32], 2: [.29, .47], 3: [.246, .64], 4: [.252, .68], 5: [.276, .9], 6: [.27, 1.0] });
  // A hoodie: roomy, with a pocket across the front
  if (style === 13) Object.assign(rows, { 2: [.28, .53], 3: [.29, .56], 4: [.29, .7], 5: [.296, .95] });
  // A suit: a jacket cut in at the waist and square at the shoulder
  if (style === 14) Object.assign(rows, { 2: [.275, .53], 3: [.262, .66], 4: [.28, .82], 5: [.3, .97], 6: [.285, 1.035] });
  // A puffer: fat quilted rings, one between each seam
  if (style === 15) Object.assign(rows, { 2: [.3, .54], 3: [.31, .66], 4: [.318, .8], 5: [.318, .93], 6: [.29, 1.03], 7: [.215, 1.1], 8: [.15, 1.14] });
  return rows;
}

// Columns round the coat, in degrees from the front: one down the middle and
// two close beside it, so a neckline comes to a point and an open front or a
// scarf's tail can be drawn on the coat itself.
const COLUMNS = [0, 24, 58, 90, 135, 180, -135, -90, -58, -24].map(a => a * Math.PI / 180);
// How broad each outfit is across the shoulders and front
const WIDTHS = [1, 1.07, .96, 1.04, .93, 1.08, 1.02, 1.08, .96, 1.06, 1.08, .94, .95, 1.06, 1.04, 1.04];

// The coat: a lathe built by hand, with fans for the hem and collar (the
// stock lathe spent sixteen degenerate triangles on its poles). The chest is
// rounder than the flatter back. Each face notes its place for the clothing.
function walkerBody(piece, style) {
  const width = WIDTHS[style];
  const rows = coatProfile(style), columns = COLUMNS.length, top = rows.length - 1, grid = [];
  // The open fronts narrow toward their hem instead of looking like a
  // broad pasted-on stripe. The parka's panels close to a slim placket.
  const opening = style === 6 ? [.5, .5, .5, .55, .65, .8, .9, .9, .9]
    : style === 9 ? [.7, .7, .7, .8, .9, 1, 1, 1, 1] : style === 14 ? [.34, .34, .34, .34, .34, .34, 1.2, 1, 1] : null;
  rows.forEach(([r, y], j) => {
    const pinch = style === 2 ? .2 : opening?.[j] ?? 1;
    const angles = COLUMNS.map(a => Math.abs(a) < .5 ? a * pinch : a);
    // The collar stands higher at the back than the front
    const dip = j === top ? .018 : j === top - 1 ? .01 : 0;
    // The chest swells forward under the shoulders; the back stays flat
    const chest = .8 + .08 * Math.max(0, 1 - Math.abs(y - .9) / .25);
    // The parka's and hoodie's hoods lie folded down the back: a pouch over
    // the shoulder blades, its rim open behind the head, where the collar's
    // cap lines it
    const hood = ((style === 2 || style === 13) && [[.025, 0], [.06, .01], [.08, .035], [.075, .07]][j - top + 3]) || [0, 0];
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
  piece.add(coat, t => clothingColor(style, places[t]));
}

// What is worn, drawn on the coat's own faces (no decals floating off it).
// Quads 0 and 9 are the narrow panels either side of the front's middle, 4
// and 5 the back. Returns [channel, shade].
const COAT = [CH.coat, 1], TRIM = [CH.trim, 1];
function clothingColor(style, { band, q, near }) {
  const panel = q === 0 || q === 9, side = [2, 3, 6, 7].includes(q), back = q === 4 || q === 5, trousers = TROUSERS.includes(style);
  const front = panel || q === 1 || q === 8;
  if (band < 0) return trousers ? [CH.legs, .6] : [CH.coat, .6];
  if (band === 8) return style === 14 ? [CH.shirt, .8] : [CH.trim, .7];
  // A suit's trousers match its jacket
  if (trousers && band === 0) return style === 14 ? [CH.coat, .82] : [CH.legs, 1];
  // A scarf's roll, and one tail down the chest
  if (SCARF.includes(style) && (band >= 5 || q === 9 && band >= 2)) return TRIM;
  // Crew necks' collars go all round, the others' show at the front; the
  // parka's hood is lined, and it closes on a placket
  if (band === 7 && style === 2) return back ? [CH.trim, .8] : COAT;
  if (style === 13) {
    // The hood's lining, drawstrings, and a pocket across the front
    if (band === 7) return back ? [CH.coat, .7] : panel ? TRIM : COAT;
    if (band === 6 && panel && near) return TRIM;
    if (band === 3 && front) return [CH.coat, .86];
    if (band === 2) return [CH.coat, .9];
    return COAT;
  }
  if (style === 14) {
    // A shirt's V under the lapels, and a narrow tie from the knot to its
    // point above the jacket's button
    if (panel && band >= 5) return band === 5 && near ? [CH.accent, .9] : [CH.shirt, 1];
    if (panel && (band === 3 || band === 4)) return [CH.accent, 1];
    if (panel && band === 2 && near) return [CH.accent, 1];
    if ((q === 1 || q === 8) && band >= 5 && band <= 6) return [CH.coat, .78];
    if (band === 7) return [CH.coat, .9];
    return COAT;
  }
  if (style === 15) {
    // Quilted rings: the seams are shadowed
    if (band === 7) return [CH.coat, .8];
    return [CH.coat, [1, 1, .74, 1, .76, 1, .86][band] ?? 1];
  }
  if (style === 12) {
    // A belt at the waist; a round neck
    if (band === 3) return [CH.trim, .9];
    if (band === 7) return [CH.coat, .92];
    return [CH.coat, band === 0 ? .76 : 1];
  }
  if (band === 7) return [1, 5, 7, 10].includes(style) || panel ? TRIM : COAT;
  if (style === 2 && panel && band >= 1) return TRIM;
  // The belted coat's V neck, and open fronts over a shirt
  if (style === 3 && (panel && (band === 6 || band === 5 && near) || band === 3)) return TRIM;
  if ([6, 9].includes(style) && panel && band >= 2) return TRIM;
  if ([1, 5].includes(style) && band === 3) return TRIM;
  // Hoops: two bands round the chest
  if (style === 7 && (band === 3 || band === 5)) return TRIM;
  // A vest over a jumper, whose sleeves show at the sides
  if (style === 10 && side && band >= 2) return TRIM;
  return [CH.coat, !trousers && band === 0 ? .76 : 1];
}

function outfitSlot(style) {
  const piece = new Piece(0);
  walkerBody(piece, style);
  return piece;
}

// --------------------------------------------------------------- the head

const HEAD = new THREE.Vector3(0, 1.45, 0), HEAD_SIZE = [.25, .265, .235];
// The head's facets, for laying things on them
const headFacets = (() => {
  const g = new THREE.SphereGeometry(1, 10, 6).toNonIndexed();
  g.scale(...HEAD_SIZE); g.translate(HEAD.x, HEAD.y, HEAD.z);
  return g.attributes.position;
})();
const ray = new THREE.Ray(), hit = new THREE.Vector3(), corner = [0, 1, 2].map(() => new THREE.Vector3());
// A point `lift` out from the head's own facets toward `turn` radians round
// from the face (toward +x) and `rise` up from its middle. Pieces laid on the
// facets rather than the ideal ellipsoid meet them cleanly.
function onFace(turn, rise, lift = 0) {
  ray.set(HEAD, new THREE.Vector3(Math.sin(turn) * Math.cos(rise) * .25, Math.sin(rise) * .265,
    -Math.cos(turn) * Math.cos(rise) * .235).normalize());
  for (let i = 0; i < headFacets.count; i += 3) {
    corner.forEach((v, j) => v.fromBufferAttribute(headFacets, i + j));
    if (ray.intersectTriangle(...corner, false, hit)) return hit.addScaledVector(ray.direction, lift).toArray();
  }
  return onFace(turn + 1e-6, rise - 1e-6, lift); // exactly on an edge
}
// Remake a sphere as another closed shape: `at(ring, c)` places each ring
// (pole to pole) round its section, keeping the sphere's winding.
function reshape(sphereGeometry, at) {
  const { widthSegments } = sphereGeometry.parameters, position = sphereGeometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, ...at(Math.floor(i / (widthSegments + 1)), i % (widthSegments + 1) / widthSegments * Math.PI * 2));
  }
  sphereGeometry.computeVertexNormals(); return sphereGeometry;
}
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
// A strip of quads laid on the facets through [turn, rise, half-height]
// points, as the brows are, so no edge lifts off the face
function faceStrip(points, lift = .0025) {
  const ends = points.flatMap(([turn, rise, half]) => [onFace(turn, rise + half, lift), onFace(turn, rise - half, lift)]);
  const index = [];
  for (let k = 0; k + 3 < ends.length; k += 2) {
    for (const [i, j, l] of [[k, k + 1, k + 2], [k + 2, k + 1, k + 3]]) {
      const [u, v, w] = [i, j, l].map(n => new THREE.Vector3(...ends[n]));
      const outward = v.clone().sub(u).cross(w.clone().sub(u)).dot(u.clone().sub(HEAD)) > 0;
      index.push(...(outward ? [i, j, l] : [i, l, j]));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(ends.flat(), 3)); g.setIndex(index);
  g.computeVertexNormals(); return g;
}

// Hair and hats: a sculpted cap over the head, one extra piece (a bun,
// ponytail, pompom, beret, peak, brim or drape) and the ears it leaves showing.
function hairSlot(style) {
  const piece = new Piece(1);
  // A separate sculpted cap leaves a real forehead. Its boundary goes behind
  // the temples instead of drawing a horizontal line across the face.
  const scalp = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const vertex = scalp.attributes.position, uv = scalp.attributes.uv;
  const hat = style === 12 || style === 13 || style === 15;
  for (let i = 0; i < vertex.count; i++) {
    const phi = Math.atan2(vertex.getZ(i), -vertex.getX(i));
    const front = Math.max(0, -Math.sin(phi)), side = Math.cos(phi), back = Math.max(0, Math.sin(phi));
    const latitude = (1 - uv.getY(i)) * 1.25, ring = Math.min(4, Math.round(latitude * 4));
    // The beanie and the caps use two rings at the same height for the lip
    // of a cuff or a crown's edge; all other caps keep evenly spaced rows.
    const row = style === 10 ? [0, .4, .78, .78, 1][ring] : hat ? [0, .4, .66, .68, 1][ring] : Math.min(1, latitude);
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
    // A cap's crown comes down to the brow in front; hair shows under it
    // round the back
    if (hat) edge = 1.9 - front * .45 + back * .55;
    // A headscarf wraps the whole head and frames the face
    if (style === 14) edge = 2.75 - front * (1.62 - side * .25);
    const theta = row * edge, top = 1 - row;
    // No curl at the crown, whose vertices must meet
    const curl = (style === 2 || style === 7) && row ? .022 * Math.cos(phi * 5 + row * Math.PI * 3) : 0;
    // Close crops under the beret; a hat's crown stands proud of the hair
    const radius = (style === 6 || style === 9 ? .27 : style === 7 ? .335 : hat ? .285 : style === 14 ? .272 : .28) + curl + (style === 2 ? .024 : 0);
    let x = -Math.cos(phi) * Math.sin(theta) * radius;
    let y = Math.cos(theta) * ((style === 6 || style === 9 ? .283 : style === 7 ? .34 : hat ? .3 : style === 14 ? .292 : .3) + curl);
    let z = Math.sin(phi) * Math.sin(theta) * radius * .94;
    // Below the ears hair closes in to lie on the head, as cut hair does,
    // instead of flaring like a helmet; a beanie is pulled down behind.
    // Bobs hang free.
    const hug = [3, 11].includes(style) ? 0 : THREE.MathUtils.smoothstep(theta, ...(style === 7 ? [1.9, 2.6] : [1.35, 2.3]));
    const snug = [-Math.cos(phi) * Math.sin(theta) * .25 * 1.07, Math.cos(theta) * .265 * 1.07 - .01, Math.sin(phi) * Math.sin(theta) * .235 * 1.07];
    x += (snug[0] - x) * hug; y += (snug[1] - y) * hug; z += (snug[2] - z) * hug;
    if (style === 0) { x -= .045 * top; y += .085 * top + .03 * front * Math.sin(theta); }
    if (style === 1) { x -= .065 * top; y += .055 * top; }
    if (style === 3 || style === 11 || style === 14) {
      // Cut hair hangs from the temples instead of following the skull back
      // in under the jaw. The bob has a blunt edge; the long sweep drops
      // farther behind and over one shoulder, with its face left clear. A
      // headscarf falls to the collar all round.
      const hang = THREE.MathUtils.smoothstep(theta, 1.35, 2.45);
      const fall = style === 11 ? .285 + .025 * side : style === 14 ? .3 : .255;
      const out = style === 14 ? [.266, .245] : [.264, .239];
      x += (-Math.cos(phi) * out[0] - x) * hang;
      z += (Math.sin(phi) * out[1] - z) * hang;
      y += (-fall - y) * hang;
      // These longer faces cross the head's widest facets between rows.
      // Leave a little clearance there, or a temple pokes through the hair.
      x *= 1.05; z *= 1.05;
    }
    if (style === 10) {
      y += .055 * top;
      if (ring >= 3) { x *= 1.08; z *= 1.08; }
    }
    // A flat cap slopes forward from a raised back; a sun hat's crown is tall
    if (style === 13) { y += .03 * top - .045 * front * top; z *= 1.04; x *= 1.04; }
    if (style === 15) y += .06 * top;
    if (hat && ring >= 3) { x *= 1.04; z *= 1.04; }
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
      const long = style === 3 || style === 11 || style === 14;
      x *= long ? .35 : .72; y *= long ? .65 : .72; z *= long ? .35 : .72;
    }
    vertex.setXYZ(i, x, y, z);
  }
  scalp.computeVertexNormals();
  // (the sphere's rows are faces of 20 triangles a band, bar the first ten)
  const band = t => t < 10 ? 0 : 1 + Math.floor((t - 10) / 20);
  const paint = style === 10 ? () => TRIM : style === 14 ? t => [CH.accent, [1.06, 1.02, 1, .96, .82][band(t)]]
    : hat ? t => band(t) >= 3 ? [CH.hair, 1] : style === 15 ? (band(t) === 2 ? [CH.accent, 1] : [CH.straw, 1]) : [CH.accent, band(t) === 2 ? .82 : 1]
      : () => [CH.hair, 1];
  piece.add(scalp, paint, [0, 1.46, 0]);

  // One piece reused for tied hair, a wool pompom, a beret worn over short
  // hair, a cap's peak, a sun hat's brim or a headscarf's drape. The other
  // styles collapse it inside the head.
  const extra = new THREE.SphereGeometry(1, 8, 5);
  let extraPaint = [CH.hair, 1];
  if (style === 8) {
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
    extraPaint = TRIM;
  } else if (style === 12 || style === 13) {
    // A cap's peak: a stiff half disc standing out over the brow, tipped
    // down a little. A flat cap's is short and flush with its crown.
    const [reach, wide, lift] = style === 12 ? [.2, .19, 1.605] : [.12, .2, 1.63];
    const rings = [[0, .012], [.55, .012], [.9, .006], [1, 0], [.9, -.006], [0, -.008]];
    reshape(extra, (ring, c) => {
      const [r, y] = rings[ring], s = Math.sin(c);
      // the back half of the disc lies under the crown
      return [-Math.cos(c) * r * wide, y, s > 0 ? s * r * .08 : s * r * reach];
    });
    extra.rotateX(style === 12 ? .22 : .3).translate(0, lift, -.2);
    extraPaint = [CH.accent, style === 12 ? .85 : .9];
  } else if (style === 15) {
    // A sun hat's wide brim, drooping at its edge
    const rings = [[0, .018], [.2, .016], [.34, .006], [.4, -.018], [.3, -.008], [0, -.002]];
    reshape(extra, (ring, c) => [-Math.cos(c) * rings[ring][0], rings[ring][1], Math.sin(c) * rings[ring][0] * .95]);
    extra.rotateX(-.06).translate(0, 1.64, .01);
    extraPaint = [CH.straw, .92];
  } else if (style === 14) {
    // A headscarf's drape: under the chin and round the throat, spreading
    // over the collar onto the shoulders ([radius, y] rings)
    const rings = [[0, 1.33], [.215, 1.31], [.265, 1.21], [.315, 1.1], [.265, 1.05], [0, 1.06]];
    reshape(extra, (ring, c) => {
      const [r, y] = rings[ring], front = Math.max(0, -Math.sin(c));
      // (it comes down under the jaw in front, clear of the mouth)
      return [-Math.cos(c) * r, y - (ring < 3 ? .09 * front * front : 0), Math.sin(c) * r * .92 + .02];
    });
    extraPaint = [CH.accent, .92];
  } else {
    // A bun, a pompom, or nothing
    const [at, size] = { 4: [[0, 1.71, .13], [.135, .12, .13]], 10: [[0, 1.83, 0], [.075, .075, .075]] }[style] ?? [[0, 1.45, 0], [0, 0, 0]];
    if (size[0]) extra.scale(...size).translate(...at); else collapse(extra, at);
    if (style === 10) extraPaint = TRIM;
  }
  piece.add(extra, extraPaint);

  // Ears: small five-sided bipyramids leaning back, their inner half in
  // the head. Long hair, the afro and a headscarf cover them.
  const covered = [2, 3, 7, 11, 14].includes(style);
  for (const side of [-1, 1]) {
    const ear = new THREE.SphereGeometry(1, 5, 2);
    if (covered) collapse(ear, [side * .2, 1.44, 0]);
    else ear.scale(.042, .022, .028).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.25, 0, -side * Math.PI / 2))).translate(side * .246, 1.44, .01);
    piece.add(ear, [CH.skin, .96]);
  }
  return piece;
}

// The face: the head, eyes, brows, a nose, glasses and facial hair. No
// mouth: the face stays as quiet as a toy's.
function faceSlot(face) {
  const piece = new Piece(2);
  sphere(10, 6, HEAD_SIZE, HEAD.toArray(), [CH.skin, 1], piece);
  const glasses = [1, 3, 4].includes(face);
  for (const side of [-1, 1]) {
    // Tall oval eyes, not diamonds
    const eye = new THREE.CircleGeometry(.018, 8); eye.scale(1, 1.3, 1);
    piece.add(eye, [CH.ink, 1], [side * .076, 1.458, -.226], [0, Math.PI - side * .3, 0]);
    // Short brows in a darker shade of the hair, laid on the facets and bent
    // over the crease between them
    piece.add(faceStrip([[side * .14, .245, .025], [side * crease, .248, .021], [side * .44, .232, .013]]), [CH.hair, .8]);
    const ring = new THREE.RingGeometry(face === 3 ? 0 : face === 4 ? .038 : .034, face === 4 ? .048 : .045, 8);
    if (face === 1) ring.scale(1.12, .82, 1);
    if (face === 3) ring.scale(1.15, .9, 1);
    if (!glasses) collapse(ring, [side * .07, 1.46, -.2]);
    piece.add(ring, face === 3 ? [CH.lens, 1] : [CH.ink, 1], [side * .074, 1.46, -.24], glasses ? [0, Math.PI - side * .3, 0] : [0, 0, 0]);
  }
  const bridge = new THREE.PlaneGeometry(.065, .012);
  if (!glasses) collapse(bridge, [0, 1.46, -.2]);
  piece.add(bridge, [CH.ink, 1], glasses ? [0, 1.46, -.251] : [0, 0, 0], glasses ? [0, Math.PI, 0] : [0, 0, 0]);
  // A four-sided nose, broader or longer on some faces
  const nose = [[.036, .031, .036], [.034, .034, .038], [.043, .034, .038], [.031, .031, .036], [.036, .036, .041]][face];
  sphere(4, 2, nose, onFace(0, -.1, -.012), [CH.skin, .97], piece);
  // Facial hair: a mustache under the nose. (No beards: a shell along the
  // jaw looked ugly, the user found, and a goatee read as an open mouth.)
  const whiskers = new THREE.SphereGeometry(1, 8, 5);
  if (face === 2) {
    const lip = [-.17, -.19, -.23, -.27, -.29];
    reshape(whiskers, shell([[-.5, -.3], [-.3, lip, .012], [-.12, lip, .018], [.12, lip, .018], [.3, lip, .012], [.5, -.3]]));
  } else collapse(whiskers, HEAD.toArray());
  piece.add(whiskers, [CH.hair, .92]);
  return piece;
}

// ------------------------------------------------------------ what's worn

// On the back only: a backpack, a bag hung at the hip from one shoulder, or
// a satchel slung across the back. Straps are strips wrapped over the
// outermost of every outfit's surfaces, so they lie along a coat (a little
// proud of the slimmest) instead of standing off it as straight bars.
let profiles = null;
function coatReach(angle, y) {
  let most = 0;
  profiles ??= WALKER_OUTFITS.map((_, style) => coatProfile(style));
  profiles.forEach((rows, style) => {
    let r = rows[0][0];
    for (let j = 0; j + 1 < rows.length; j++) {
      const [[ra, ya], [rb, yb]] = [rows[j], rows[j + 1]];
      if (y >= ya && y <= yb) { r = ra + (rb - ra) * (y - ya) / (yb - ya || 1); break; }
      if (y > yb) r = rb;
    }
    const c = Math.cos(angle), w = WIDTHS[style], chest = .8 + .08 * Math.max(0, 1 - Math.abs(y - .9) / .25);
    const x = Math.sin(angle) * r * w, z = c > 0 ? -c * r * w * chest : Math.sqrt(-c) * r * w * .72;
    // the parka's and hoodie's hoods over the shoulder blades
    const hood = (style === 2 || style === 13) && c < -.3 && y > .9 ? .07 * Math.min(1, (y - .9) / .15) * (-c - .3) / .7 : 0;
    most = Math.max(most, Math.hypot(x, z + hood));
  });
  return most;
}
// A strip `width` wide through [angle from the front, y] points, `lift` off
// the coat: one face each segment's width, facing out
const STRAP_STEPS = 4;
function strap(points, width = .045, lift = .012) {
  const along = [];
  for (let k = 0; k <= STRAP_STEPS; k++) {
    const t = k / STRAP_STEPS * (points.length - 1), i = Math.min(points.length - 2, Math.floor(t)), f = t - i;
    const angle = points[i][0] + (points[i + 1][0] - points[i][0]) * f, y = points[i][1] + (points[i + 1][1] - points[i][1]) * f;
    along.push([angle, y]);
  }
  const at = (angle, y) => {
    const r = coatReach(angle, y) + lift, d = new THREE.Vector2(Math.sin(angle), -Math.cos(angle));
    return new THREE.Vector3(d.x * r, y, d.y * r);
  };
  const rails = along.map(([angle, y], k) => {
    const [a0, y0] = along[Math.max(0, k - 1)], [a1, y1] = along[Math.min(along.length - 1, k + 1)];
    const tangent = at(a1, y1).sub(at(a0, y0)).normalize(), out = at(angle, y).setY(0).normalize();
    const across = new THREE.Vector3().crossVectors(tangent, out).multiplyScalar(width / 2);
    const middle = at(angle, y);
    // each rail back onto the surface
    return [middle.clone().add(across), middle.clone().sub(across)].map(p => at(Math.atan2(p.x, -p.z), p.y));
  });
  // (indexed, so its faces share smooth corners)
  const position = rails.flat().flatMap(p => p.toArray()), index = [];
  for (let k = 0; k < STRAP_STEPS; k++) {
    const [a, b, c, d] = [k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 3], [u, v, w] = [a, b, c].map(i => rails[i >> 1][i & 1]);
    const outward = v.clone().sub(u).cross(w.clone().sub(u)).dot(u.clone().setY(0)) > 0;
    index.push(...(outward ? [a, b, c, c, b, d] : [a, c, b, c, d, b]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3)); g.setIndex(index);
  g.computeVertexNormals(); return g;
}
const DEG = Math.PI / 180;
function gearSlot(gear) {
  const piece = new Piece(3);
  const bag = new THREE.BoxGeometry(1, 1, 1), flap = new THREE.BoxGeometry(1, 1, 1);
  let straps;
  const place = (g, size, at, rotation = [0, 0, 0]) => {
    g.scale(...size).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation))).translate(...at);
  };
  if (gear === 1) {
    // A backpack high on the back, its straps over the shoulders to the chest
    place(bag, [.3, .34, .13], [0, .79, .29], [-.08, 0, 0]);
    place(flap, [.28, .1, .14], [0, .965, .292], [-.2, 0, 0]);
    straps = [-1, 1].map(side => strap([[side * 150 * DEG, .93], [side * 120 * DEG, 1.07], [side * 55 * DEG, 1.06], [side * 35 * DEG, .86]]));
  } else if (gear === 2) {
    // A bag at the right hip, its strap up the side and over the shoulder
    place(bag, [.1, .22, .26], [.35, .6, .03], [0, 0, .06]);
    place(flap, [.11, .09, .27], [.353, .69, .03], [0, 0, .06]);
    straps = [strap([[88 * DEG, .7], [90 * DEG, .95], [95 * DEG, 1.07]]), strap([[95 * DEG, 1.07], [60 * DEG, 1.08], [30 * DEG, 1.02]])];
  } else if (gear === 3) {
    // A satchel at the small of the back, slung from the left shoulder
    place(bag, [.32, .22, .09], [.05, .66, .275], [0, 0, -.12]);
    place(flap, [.3, .12, .1], [.04, .74, .279], [-.1, 0, -.12]);
    straps = [strap([[160 * DEG, .76], [-150 * DEG, .95], [-110 * DEG, 1.07]]), strap([[-110 * DEG, 1.07], [-45 * DEG, 1.0], [30 * DEG, .78], [75 * DEG, .66]])];
  } else {
    for (const g of [bag, flap]) collapse(g, [0, .9, 0]);
    straps = [0, 1].map(() => collapse(strap([[0, .8], [0, .9]]), [0, .9, 0]));
  }
  piece.add(bag, [CH.accent, 1]);
  piece.add(flap, [CH.accent, .82]);
  for (const g of straps) piece.add(g, [CH.accent, .72]);
  return piece;
}

// ---------------------------------------------------------------- assembly

// Every slot's variants share their topology; the base geometry is the first
// variant of each. The targets hold each variant's difference from it, zero
// outside its own slot, so the stock morph path (the AO prepass, with one
// weight per slot) builds exactly the combination the color pass does.
function walkerGeometry() {
  const slots = [outfitSlot, hairSlot, faceSlot, gearSlot].map((build, s) => SLOTS[s].map((_, v) => build(v)));
  for (const [s, variants] of slots.entries()) for (const [v, piece] of variants.entries()) {
    if (piece.count !== variants[0].count) throw new Error(`walker slot ${s} variant ${v}: ${piece.count} vertices, not ${variants[0].count}`);
  }
  // Index exact duplicates: two corners are one vertex only if they agree in
  // every variant of their slot (and are in the same slot). Corners are
  // hashed by their float bits, and a hash's first corner checked in full.
  const bits = slots.map(variants => variants.map(piece => ({
    position: new Uint32Array(new Float32Array(piece.position).buffer),
    normal: new Uint32Array(new Float32Array(piece.normal).buffer),
    data: new Uint32Array(new Float32Array(piece.data).buffer),
  })));
  const same = (variants, i, j) => variants.every(({ position, normal, data }) => {
    for (let n = 0; n < 3; n++) if (position[i * 3 + n] !== position[j * 3 + n] || normal[i * 3 + n] !== normal[j * 3 + n]) return false;
    return data[i * 4] === data[j * 4] && data[i * 4 + 1] === data[j * 4 + 1];
  });
  const unique = new Map(), sources = [], index = [];
  for (const [s, variants] of slots.entries()) {
    for (let i = 0; i < variants[0].count; i++) {
      let key = s + 1;
      for (const { position, normal, data } of bits[s]) {
        for (let n = 0; n < 3; n++) key = Math.imul(key ^ position[i * 3 + n], 0x01000193) ^ Math.imul(normal[i * 3 + n], 0x9e3779b1);
        key = Math.imul(key ^ data[i * 4], 0x01000193) ^ data[i * 4 + 1];
      }
      let at = -1;
      for (const candidate of unique.get(key) ?? []) if (sources[candidate][0] === s && same(bits[s], sources[candidate][1], i)) { at = candidate; break; }
      if (at < 0) {
        at = sources.length; sources.push([s, i]);
        if (unique.has(key)) unique.get(key).push(at); else unique.set(key, [at]);
      }
      index.push(at);
    }
  }
  const count = sources.length, geometry = new THREE.BufferGeometry();
  const base = { position: new Float32Array(count * 3), normal: new Float32Array(count * 3), color: new Float32Array(count * 4) };
  const slotOf = new Float32Array(count);
  const targets = { position: [], normal: [], color: [] };
  for (let t = 0; t < WALKER_TARGETS; t++) for (const name of ['position', 'normal', 'color']) targets[name].push(new Float32Array(count * (name === 'color' ? 4 : 3)));
  const source = { position: 'position', normal: 'normal', color: 'data' };
  sources.forEach(([s, i], k) => {
    slotOf[k] = s;
    const variants = slots[s];
    for (const [name, key] of Object.entries(source)) {
      const size = name === 'color' ? 4 : 3, first = variants[0][key].slice(i * size, i * size + size);
      base[name].set(first, k * size);
      variants.forEach((piece, v) => {
        const values = piece[key].slice(i * size, i * size + size);
        targets[name][SLOT_BASE[s] + v].set(values.map((value, n) => value - first[n]), k * size);
      });
    }
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(base.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(base.normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(base.color, 4));
  geometry.setAttribute('walkerSlot', new THREE.BufferAttribute(slotOf, 1));
  geometry.setIndex(index);
  geometry.morphTargetsRelative = true;
  const names = SLOTS.flat();
  for (const name of ['position', 'normal', 'color']) {
    geometry.morphAttributes[name] = targets[name].map((array, t) => {
      const attribute = new THREE.BufferAttribute(array, name === 'color' ? 4 : 3); attribute.name = names[t]; return attribute;
    });
  }
  // Bound every combination: the tallest hat, the widest brim, the backpack
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-.5, .25, -.5), new THREE.Vector3(.5, 1.95, .5));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.05, 0), 1.05);
  return geometry;
}
export const cityWalker = walkerGeometry();

// The shape of one combination, for tests and tools: positions, normals and
// [channel, shade] per vertex of the indexed geometry
export function walkerShape({ outfit = 0, style = 0, face = 0, gear = 0 } = {}) {
  const picks = [outfit, style, face, gear].map((v, s) => SLOT_BASE[s] + v), slot = cityWalker.attributes.walkerSlot.array;
  const out = {};
  for (const name of ['position', 'normal', 'color']) {
    const base = cityWalker.attributes[name].array, size = name === 'color' ? 4 : 3, values = new Float32Array(base.length);
    for (let k = 0; k < slot.length; k++) {
      const target = cityWalker.morphAttributes[name][picks[slot[k]]].array;
      for (let n = 0; n < size; n++) values[k * size + n] = base[k * size + n] + target[k * size + n];
    }
    out[name] = values;
  }
  out.slot = slot; out.index = cityWalker.index.array;
  return out;
}

// What a person knocked flying lies on (see LooseProps): rings round the peg
// and the head, each point as far out as the body goes that way, plus the
// crown and the middle of the hem. Sampled from the mesh, 7 points held the
// whole person, and they sank a third of a meter into the road between them. Each ring reaches as far as
// four in five variants of the coat, hair and face do, so a cap's peak or a
// ponytail stays out of the road but a sun hat's brim or a puffer's bulk does
// not lift everyone else off it. Bags are left out. The margin covers the
// flats between the ring's eight points.
const CONTACT_RINGS = [.32, .62, .92, 1.12, 1.3, 1.48, 1.66], CONTACT_MARGIN = .03;
function walkerContact() {
  const around = 8, reach = CONTACT_RINGS.map(() => new Float32Array(around));
  let crown = 0;
  for (const [s, name] of ['outfit', 'style', 'face'].entries()) {
    const found = CONTACT_RINGS.map(() => Array.from({ length: around }, () => [])), tops = [];
    for (let v = 0; v < SLOTS[s].length; v++) {
      const { position: p, slot, index } = walkerShape({ [name]: v });
      // (only corners of real triangles: a piece a variant lacks is folded to a point somewhere)
      const used = new Uint8Array(slot.length), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let t = 0; t < index.length; t += 3) {
        a.fromArray(p, index[t] * 3); b.fromArray(p, index[t + 1] * 3); c.fromArray(p, index[t + 2] * 3);
        if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-12) used[index[t]] = used[index[t + 1]] = used[index[t + 2]] = 1;
      }
      const most = CONTACT_RINGS.map(() => new Float32Array(around));
      let top = 0;
      for (let k = 0; k < slot.length; k++) {
        if (!used[k] || slot[k] !== s) continue;
        const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
        top = Math.max(top, y);
        CONTACT_RINGS.forEach((h, j) => {
          if (Math.abs(y - h) < .1) for (let d = 0; d < around; d++) most[j][d] = Math.max(most[j][d], x * Math.cos(d * Math.PI / 4) + z * Math.sin(d * Math.PI / 4));
        });
      }
      most.forEach((row, j) => row.forEach((r, d) => found[j][d].push(r)));
      tops.push(top);
    }
    const most = list => list.sort((x, y) => x - y)[Math.floor(list.length * .8)];
    found.forEach((row, j) => row.forEach((list, d) => { reach[j][d] = Math.max(reach[j][d], most(list)); }));
    crown = Math.max(crown, most(tops));
  }
  const points = [];
  CONTACT_RINGS.forEach((h, j) => {
    for (let d = 0; d < around; d++) {
      const r = reach[j][d] + CONTACT_MARGIN;
      points.push(r * Math.cos(d * Math.PI / 4), h, r * Math.sin(d * Math.PI / 4));
    }
  });
  // (and the middle of the hem, so they cannot stand astride a bench's slat)
  points.push(0, CONTACT_RINGS[0], 0, 0, crown + CONTACT_MARGIN, 0);
  return new Float32Array(points);
}
cityWalker.userData.contact = walkerContact();

// -------------------------------------------------------------- materials

const palette = colors => colors.map(color => new THREE.Color(color));
const coatPalette = palette(WALKER_LOOKS.map(look => look.coat)), trimPalette = palette(WALKER_LOOKS.map(look => look.trim));
const skinPalette = palette(WALKER_SKIN), hairPalette = palette(WALKER_HAIR);
const legsPalette = palette(WALKER_LEGS), accentPalette = palette(WALKER_ACCENTS);
// Fixed colors: ink (eyes, frames), dark lenses, shirt white, straw
const fixed = palette(['#302c32', '#26282c', '#eceae4', '#d7bf86']);

// Each instance's color holds its choices as whole numbers (exact in a
// float): red the shapes and coat, green the other palettes. Blue is the
// head's turn (see setWalkerTurn).
const PACK = {
  outfit: [0, 4], style: [4, 4], face: [8, 3], gear: [11, 2], look: [13, 5],
  skin: [0, 3], hair: [3, 3], legs: [6, 3], accent: [9, 3],
};
const glslBits = (word, [shift, size]) => `int((${word} >> ${shift}u) & ${(1 << size) - 1}u)`;
const decode = /* glsl */`
  uvec2 walkerBits = uvec2(0u);
  #ifdef USE_INSTANCING_COLOR
    walkerBits = uvec2(instanceColor.rg + .5);
  #endif
  // The head's turn from the body (radians), set each frame
  float walkerTurn = 0.0;
  #ifdef USE_INSTANCING_COLOR
    walkerTurn = instanceColor.b;
  #endif
  int walkerSlotIndex = int(walkerSlot + .5);
  bool walkerHead = walkerSlotIndex == 1 || walkerSlotIndex == 2;
  mat2 walkerYaw = mat2(cos(walkerTurn), -sin(walkerTurn), sin(walkerTurn), cos(walkerTurn));
  int walkerPick = walkerSlotIndex == 0 ? ${glslBits('walkerBits.x', PACK.outfit)}
    : walkerSlotIndex == 1 ? ${SLOT_BASE[1]} + ${glslBits('walkerBits.x', PACK.style)}
    : walkerSlotIndex == 2 ? ${SLOT_BASE[2]} + ${glslBits('walkerBits.x', PACK.face)}
    : ${SLOT_BASE[3]} + ${glslBits('walkerBits.x', PACK.gear)};
`;
const slotAttribute = /* glsl */`
  attribute float walkerSlot;
  #ifdef WALKER_POSE
    uniform float walkerSquash;
    uniform vec3 walkerHeadShift;
    uniform mat3 walkerHeadTilt;
  #endif
`;
// The morphed shape, the head turned about its upright axis. The player's
// own figure (WALKER_POSE, see walkerPose) also squashes its body about the
// feet, keeping its volume, and tilts and moves its head on its own.
const HEAD_PIVOT = `vec3(0.0, ${HEAD.y.toFixed(3)}, 0.0)`;
const shaped = /* glsl */`
  transformed += getMorph(gl_VertexID, walkerPick, 0).xyz;
  if (walkerHead) transformed.xz = walkerYaw * transformed.xz;
  #ifdef WALKER_POSE
    if (walkerHead) transformed = walkerHeadTilt * (transformed - ${HEAD_PIVOT}) + ${HEAD_PIVOT} + walkerHeadShift;
    else transformed *= vec3(inversesqrt(walkerSquash), walkerSquash, inversesqrt(walkerSquash));
  #endif
`;
const shapedNormal = /* glsl */`
  objectNormal += getMorph(gl_VertexID, walkerPick, 1).xyz;
  if (walkerHead) objectNormal.xz = walkerYaw * objectNormal.xz;
  #ifdef WALKER_POSE
    if (walkerHead) objectNormal = walkerHeadTilt * objectNormal;
    else objectNormal *= vec3(sqrt(walkerSquash), 1.0 / walkerSquash, sqrt(walkerSquash));
  #endif
`;

// The pose of the player's own figure (see Walker), read by its material and
// its shadow: how far its body is squashed (under 1) or stretched, and how
// far its head is moved and turned from where it floats
export function walkerPose() {
  return { walkerSquash: { value: 1 }, walkerHeadShift: { value: new THREE.Vector3() }, walkerHeadTilt: { value: new THREE.Matrix3() } };
}

// `pose` (see walkerPose) is only for the player's figure: the residents'
// program is the same without it
export function createWalkerMaterial(pose = null) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .92 });
  material.customProgramCacheKey = () => 'citydriver-walker-slots-v5';
  if (pose) material.defines = { WALKER_POSE: '' };
  // Demolition's warning (see createWalkerAlert): 1 glows them red at the
  // edges; 0, as everywhere else, leaves them exactly as they were
  material.userData.alert = { value: 0 };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      walkerCoats: { value: coatPalette }, walkerTrims: { value: trimPalette },
      walkerSkin: { value: skinPalette }, walkerHair: { value: hairPalette }, walkerLegs: { value: legsPalette },
      walkerAccents: { value: accentPalette }, walkerFixed: { value: fixed },
      walkerAlert: material.userData.alert, ...pose,
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
      ${slotAttribute}
      uniform vec3 walkerCoats[${coatPalette.length}];
      uniform vec3 walkerTrims[${trimPalette.length}];
      uniform vec3 walkerSkin[${skinPalette.length}];
      uniform vec3 walkerHair[${hairPalette.length}];
      uniform vec3 walkerLegs[${legsPalette.length}];
      uniform vec3 walkerAccents[${accentPalette.length}];
      uniform vec3 walkerFixed[${fixed.length}];
    `).replace('#include <color_vertex>', 'vColor = vec4(1.0);')
      // Fetch only this vertex's own slot's choice: three fetches a vertex,
      // however many variants there are
      .replace('#include <morphinstance_vertex>', decode)
      .replace('#include <morphnormal_vertex>', shapedNormal)
      .replace('#include <morphtarget_vertex>', shaped)
      .replace('#include <morphcolor_vertex>', `
      vec4 walkerPaint = color + getMorph(gl_VertexID, walkerPick, 2);
      int channel = int(walkerPaint.x + .5);
      int look = ${glslBits('walkerBits.x', PACK.look)}, skin = ${glslBits('walkerBits.y', PACK.skin)};
      vec3 paint = walkerFixed[0];
      if (channel == ${CH.coat}) paint = walkerCoats[look];
      else if (channel == ${CH.trim}) paint = walkerTrims[look];
      else if (channel == ${CH.skin}) paint = walkerSkin[skin];
      else if (channel == ${CH.hair}) paint = walkerHair[${glslBits('walkerBits.y', PACK.hair)}];
      else if (channel == ${CH.legs}) paint = walkerLegs[${glslBits('walkerBits.y', PACK.legs)}];
      else if (channel == ${CH.accent}) paint = walkerAccents[${glslBits('walkerBits.y', PACK.accent)}];
      else if (channel == ${CH.lens}) paint = walkerFixed[1];
      else if (channel == ${CH.shirt}) paint = walkerFixed[2];
      else if (channel == ${CH.straw}) paint = walkerFixed[3];
      vColor = vec4(paint * walkerPaint.y, 1.0);
    `);
  };
  return material;
}

// The shadow caster: the same combination, by the same fetch (the stock
// path would read every target's weight at every vertex). The residents all
// share one. A posed figure has its own, reading its pose.
let depthMaterial = null;
export function walkerDepthMaterial(pose = null) {
  if (depthMaterial && !pose) return depthMaterial;
  const material = new THREE.MeshDepthMaterial({ side: THREE.BackSide, colorWrite: false });
  material.name = pose ? 'shadow-depth-walker-posed' : 'shadow-depth-walker';
  material.customProgramCacheKey = () => 'citydriver-walker-depth-v5';
  if (pose) material.defines = { WALKER_POSE: '' };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, pose);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${slotAttribute}`)
      .replace('#include <morphinstance_vertex>', decode)
      .replace('#include <morphtarget_vertex>', shaped);
  };
  if (!pose) depthMaterial = material;
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
  ${slotAttribute}
  uniform float lift;
  varying float vRim;
  varying float vFade;
  void main() {
    vec3 transformed = position, objectNormal = normal;
    #ifdef USE_MORPHTARGETS
      ${decode}
      ${shaped}
      objectNormal += getMorph(gl_VertexID, walkerPick, 1).xyz;
      if (walkerHead) objectNormal.xz = walkerYaw * objectNormal.xz;
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
      // player's color vision: dark red on leaves is one shade to many)
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
    // shader picks the shape from the instance color)
    copy.instanceMatrix = mesh.instanceMatrix; copy.instanceColor = mesh.instanceColor; copy.morphTexture = mesh.morphTexture;
    copy.boundingSphere = mesh.boundingSphere; copy.userData.ambientOcclusion = false;
    mesh.add(copy);
    return copy;
  });
  const dispose = mesh.dispose.bind(mesh);
  mesh.dispose = () => { for (const copy of copies) { copy.morphTexture = null; copy.dispose(); } return dispose(); };
}

// ------------------------------------------------------------- wardrobes

function hash(seed) {
  let n = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
// A weighted pick: [value, weight] pairs
function pick(key, pairs) {
  const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  let at = key % total;
  for (const [value, weight] of pairs) { if (at < weight) return value; at -= weight; }
  return pairs[0][0];
}
// Hair within a shade of the face (blond on tan, brown on brown) loses the
// hairline, brows and mustache in it; such a pair takes the next darker hair.
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const distance = (a, b) => Math.hypot(...rgb(a).map((c, i) => c - rgb(b)[i]));
const luma = hex => { const [r, g, b] = rgb(hex); return .3 * r + .59 * g + .11 * b; };
const hairClash = WALKER_SKIN.map(s => WALKER_HAIR.map(h => distance(s, h) < 34));

// Hairstyles by presentation, and those anyone wears
const HAIR_BY = {
  masculine: [[0, 3], [1, 3], [5, 2], [6, 3], [12, 2], [13, 2], [2, 1], [7, 1], [10, 1], [9, 1]],
  feminine: [[3, 3], [4, 3], [8, 3], [11, 3], [14, 1], [15, 1], [2, 2], [7, 1], [9, 1], [10, 1]],
};
const FACES_BY = {
  masculine: [[0, 8], [1, 4], [2, 3], [3, 1], [4, 2]],
  feminine: [[0, 9], [1, 3], [3, 2], [4, 3]],
};
// Each district dresses its own way: which outfits, which coats (look
// indices, beside the common ones), what is carried and worn on the head
const COMMON = Array.from({ length: 24 }, (_, i) => i);
const DISTRICTS = {
  Midtown: { outfits: [[14, 6], [3, 3], [8, 3], [0, 2], [9, 2], [6, 1], [12, 1]], looks: [24, 25, 26, 16, 10, 7, 15, 20], gear: [[0, 6], [2, 3], [3, 3], [1, 1]] },
  'Civic quarter': { outfits: [[14, 3], [3, 3], [0, 3], [11, 2], [9, 2], [6, 2], [12, 2], [5, 1]], looks: [24, 26], gear: [[0, 6], [2, 3], [3, 2], [1, 1]] },
  'Old town': { outfits: [[0, 3], [3, 3], [4, 3], [8, 3], [11, 3], [6, 2], [12, 2], [5, 1]], looks: [], gear: [[0, 7], [2, 3], [3, 2]], hats: [[13, 3], [9, 2]] },
  'Garden quarter': { outfits: [[6, 3], [5, 3], [12, 3], [1, 2], [7, 2], [11, 2], [4, 2], [10, 1]], looks: [], gear: [[0, 7], [2, 2], [1, 2]], hats: [[15, 3]] },
  'Market district': { outfits: [[13, 3], [1, 3], [7, 3], [5, 2], [6, 2], [2, 2], [15, 2], [12, 2], [9, 1]], looks: [], gear: [[0, 4], [1, 4], [2, 3], [3, 1]], hats: [[12, 2]] },
  'Warehouse district': { outfits: [[10, 4], [15, 3], [13, 3], [2, 3], [9, 2], [1, 2], [5, 1]], looks: [27, 28, 29, 29], gear: [[0, 5], [1, 4], [3, 1]], hats: [[10, 3], [12, 3]] },
};
const ANY = { outfits: WALKER_OUTFITS.map((_, i) => [i, i === 14 ? 1 : 2]), looks: [], gear: [[0, 6], [1, 2], [2, 2], [3, 1]] };
const FEMININE_ONLY = [12], BACKLESS = [2, 13]; // dresses; hoods where a pack would sit
export function walkerAppearance(seed, district = null) {
  const wardrobe = DISTRICTS[district] ?? ANY;
  const presentation = hash(seed ^ 0x5bd1) % 2 ? 'feminine' : 'masculine';
  const skin = skinWeights[hash(seed ^ 0x3671) % skinWeights.length];
  let hair = hash(seed ^ 0x9173) % WALKER_HAIR.length;
  while (hairClash[skin][hair]) hair = (hair + WALKER_HAIR.length - 1) % WALKER_HAIR.length;
  let outfit = pick(hash(seed ^ 0x2e41), wardrobe.outfits);
  if (presentation === 'masculine' && FEMININE_ONLY.includes(outfit)) outfit = 9;
  // A district's own coats one time in three (its suits and work wear only
  // on the outfits cut for them); otherwise any of the common coats
  const own = wardrobe.looks.filter(look => look < 24 || (look < 27 ? outfit === 14 : [10, 15, 13, 2, 9].includes(outfit)));
  let look = own.length && hash(seed ^ 0x77a1) % 3 === 0 ? own[hash(seed ^ 0x13) % own.length] : COMMON[hash(seed) % COMMON.length];
  if (outfit === 14 && look < 24) look = 24 + hash(seed ^ 0x41) % 3;
  // Hats come with the district's weather and work
  let style = pick(hash(seed ^ 0x61c3), [...HAIR_BY[presentation], ...(wardrobe.hats ?? [])]);
  const face = pick(hash(seed ^ 0x0f3d), FACES_BY[presentation]);
  let gear = pick(hash(seed ^ 0x4a7b), wardrobe.gear);
  if (BACKLESS.includes(outfit) && gear !== 2) gear = 0;
  // Trousers a clear step lighter or darker than the top over them
  let legs = hash(seed ^ 0x2d9) % WALKER_LEGS.length;
  for (let tries = 0; tries < WALKER_LEGS.length && Math.abs(luma(WALKER_LEGS[legs]) - luma(WALKER_LOOKS[look].coat)) < 28; tries++) legs = (legs + 1) % WALKER_LEGS.length;
  // One accent a person: never the coat's own color
  let accent = hash(seed ^ 0x6e11) % WALKER_ACCENTS.length;
  if (distance(WALKER_ACCENTS[accent], WALKER_LOOKS[look].coat) < 60) accent = (accent + 3) % WALKER_ACCENTS.length;
  // Ties and headscarves in the deeper accents
  if ((outfit === 14 || style === 14) && ![0, 2, 3, 5, 7].includes(accent)) accent = [0, 2, 3, 5, 7][accent % 5];
  return { look, skin, hair, style, outfit, face, gear, legs, accent, presentation };
}

// One small wardrobe per fare makes a party readable at driving distance.
// A team shares its tops; other groups take turns between two coordinated
// coats across different silhouettes (four of one coat read as clones).
const taxiWardrobes = [
  { looks: [24, 25], outfits: [14, 3, 8] }, // work friends
  { looks: [5, 18], outfits: [3, 11, 12] }, // evening out
  { looks: [13, 17], outfits: [1, 7], uniform: true }, // matching team tops
  { looks: [15, 21], outfits: [9, 6] }, // art club
  { looks: [16, 22], outfits: [10, 15] }, // winter outing
  { looks: [2, 8], outfits: [13, 5, 12, 2] }, // festival friends
];
export function taxiGroupAppearance(seed, passenger) {
  const wardrobe = taxiWardrobes[hash(seed ^ 0x6321) % taxiWardrobes.length];
  const appearance = walkerAppearance(seed + passenger * 719);
  appearance.look = wardrobe.looks[(hash(seed ^ 0x1709) + (wardrobe.uniform ? 0 : passenger)) % wardrobe.looks.length];
  appearance.outfit = wardrobe.outfits[hash(seed + passenger * 31) % wardrobe.outfits.length];
  if (appearance.presentation === 'masculine' && FEMININE_ONLY.includes(appearance.outfit)) appearance.outfit = 3;
  if (BACKLESS.includes(appearance.outfit) && appearance.gear !== 2) appearance.gear = 0;
  return appearance;
}

// Pair existing residents rather than increasing the crowd. Shared travel
// phase/speed keeps them together through culling and streaming; their bob,
// proportions and wardrobe remain individual.
export function pairWalkers(walkers, seed) {
  for (let i = 0; i + 1 < walkers.length; i += 2) {
    const key = hash(seed + i * 941);
    if (key % 100 >= 38) continue;
    const a = walkers[i], b = walkers[i + 1];
    for (const [walker, offset] of [[a, -.46], [b, .46]]) {
      walker.floatPhase = walker.phase;
      walker.pairOffset = offset;
    }
    b.phase = a.phase; b.speed = a.speed; b.side = a.side; b.direction = a.direction;
    // Partners dress apart: another coat, and another cut
    if (a.appearance.look === b.appearance.look) b.appearance.look = (b.appearance.look + 7) % 24;
    if (a.appearance.outfit === b.appearance.outfit) b.appearance.outfit = (b.appearance.outfit + 5) % WALKER_OUTFITS.length;
    if (b.appearance.presentation === 'masculine' && FEMININE_ONLY.includes(b.appearance.outfit)) b.appearance.outfit = 9;
    if (BACKLESS.includes(b.appearance.outfit) && b.appearance.gear !== 2) b.appearance.gear = 0;
  }
}

const selection = { morphTargetInfluences: new Array(WALKER_TARGETS).fill(0) };
const packed = (appearance, names) => names.reduce((sum, name) => sum + ((appearance[name] ?? 0) << PACK[name][0]), 0);
export function setWalkerAppearance(mesh, index, appearance) {
  const full = { outfit: 0, face: 0, gear: 0, legs: appearance.look % 3, accent: 0, ...appearance };
  // Two whole numbers in the per-instance color; the one-hot weights (one a
  // slot) for the renderer's own AO prepass. Both are uploaded
  // only when a resident is made.
  mesh.setColorAt(index, new THREE.Color().setRGB(
    packed(full, ['outfit', 'style', 'face', 'gear', 'look']), packed(full, ['skin', 'hair', 'legs', 'accent']), 0));
  selection.morphTargetInfluences.fill(0);
  [full.outfit, full.style, full.face, full.gear].forEach((v, s) => { selection.morphTargetInfluences[SLOT_BASE[s] + v] = 1; });
  mesh.setMorphAt(index, selection);
  mesh.instanceColor.needsUpdate = true; mesh.morphTexture.needsUpdate = true;
  mesh.customDepthMaterial ??= walkerDepthMaterial();
}

// Turn a resident's head from their body, radians about the upright (the
// same sense as their yaw). Only the color pass, shadow and warning see it;
// the caller flags `instanceColor.needsUpdate` once for the whole mesh.
export function setWalkerTurn(mesh, index, angle) {
  mesh.instanceColor.array[index * 3 + 2] = angle;
}
