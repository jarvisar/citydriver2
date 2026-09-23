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

// Exact channel masks identify cloth, skin, hair and trim. Muted face details
// have all three channels and keep their own color. No textures or fragment
// shader branches are needed for the palette.
const cloth = new THREE.Color(1, 0, 0), skin = new THREE.Color(0, 1, 0);
const hair = new THREE.Color(0, 0, 1), trim = new THREE.Color(1, 1, 0);
const ink = '#302c32';

function ellipsoid(p, position, scale, color, segments = 8, rings = 4) {
  const geometry = new THREE.SphereGeometry(1, segments, rings);
  geometry.scale(...scale); p.add(geometry, position, color);
}

function silhouette(style) {
  const p = new Parts();
  const width = [1, 1.07, .96, 1.04, .93, 1.08, 1.02, 1.08, .96, 1.06, 1.08, .94][style];
  const profile = [[0, .3], [.225, .3], [.255, .36], [.28, .65], [.285, .85], [.255, .98], [.15, 1.085], [.13, 1.12], [0, 1.12]];
  // Longer flared coats, a compact jumper, and a soft jacket share topology.
  if (style === 3 || style === 8 || style === 11) { profile[1][0] = .29; profile[2][0] = .31; profile[3][0] = .29; }
  if ([1, 5, 7, 10].includes(style)) { profile[0][1] = profile[1][1] = .37; profile[2][1] = .41; }
  if (style === 9) { profile[3][0] = .32; profile[4][0] = .33; }
  if (style === 10) { profile[3][0] = .29; profile[4][0] = .30; }
  const body = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x * width, y)), 8);
  body.scale(1, 1, .8); p.add(body, [0, 0, 0], cloth);
  const coat = p.parts.at(-1), positions = coat.attributes.position, colors = coat.attributes.color;
  for (let i = 0; i < positions.count; i += 3) {
    const y = (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3;
    const stripe = [1, 5, 7].includes(style) && y > .65 && y < .85;
    const vest = style === 10 && y > .85;
    const accent = y > 1.085 || stripe || vest;
    for (let j = 0; j < 3; j++) {
      const shade = y < .41 ? .76 : 1;
      colors.setXYZ(i + j, accent ? 1 : shade, accent ? 1 : 0, 0);
    }
  }

  ellipsoid(p, [0, 1.45, 0], [.25, .265, .235], skin, 10, 6);

  // A separate sculpted cap leaves a real forehead. Its boundary goes behind
  // the temples instead of drawing a horizontal line across the face.
  const scalp = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const vertex = scalp.attributes.position, uv = scalp.attributes.uv;
  for (let i = 0; i < vertex.count; i++) {
    const phi = Math.atan2(vertex.getZ(i), -vertex.getX(i));
    const front = Math.max(0, -Math.sin(phi)), side = Math.cos(phi);
    const latitude = (1 - uv.getY(i)) * 1.25, row = Math.min(1, latitude);
    let edge = 1.85 - front * .88;
    if (style === 1) edge += front * (.22 + side * .6);
    if (style === 3 || style === 11) edge = (style === 11 ? 2.7 : 2.45) - front * (1.4 - side * .3);
    if (style === 4 || style === 8) edge -= .12;
    if (style === 6) edge = 1.7 - front * .68;
    if (style === 7) edge = 2.05 - front * .95;
    if (style === 9) edge = 1.75;
    if (style === 10) edge = 1.6 - front * .24;
    const theta = row * edge, top = 1 - row;
    const curl = style === 2 || style === 7 ? .022 * Math.cos(phi * 5 + row * Math.PI * 3) : 0;
    const radius = (style === 6 ? .264 : style === 7 ? .335 : .28) + curl + (style === 2 ? .024 : 0);
    let x = -Math.cos(phi) * Math.sin(theta) * radius;
    let y = Math.cos(theta) * ((style === 6 ? .277 : style === 7 ? .34 : .3) + curl);
    let z = Math.sin(phi) * Math.sin(theta) * radius * .94;
    if (style === 0) { x -= .045 * top; y += .085 * top + .03 * front * Math.sin(theta); }
    if (style === 1) { x -= .065 * top; y += .055 * top; }
    if ((style === 3 || style === 11) && y < 0) x *= 1.13;
    if (style === 9) { x = x * 1.2 - .05 * top; y = .13 + y * .56 + x * .2; }
    if (style === 10) y += .055 * top;
    // Return the rim inside the head. An open, paper-thin cap can leave
    // detached-looking slivers around the temples from oblique cameras.
    if (latitude > 1.01) { x *= .72; y *= .72; z *= .72; }
    vertex.setXYZ(i, style === 5 ? 0 : x, style === 5 ? 0 : y, style === 5 ? 0 : z);
  }
  scalp.computeVertexNormals(); p.add(scalp, [0, 1.46, 0], style === 9 || style === 10 ? trim : hair);
  // Reuse this same small piece for tied hair, a beard or a wool pompom.
  // The other styles collapse it inside the head, with no extra draw calls.
  const extra = {
    4: [[0, 1.72, .12], [.13, .13, .13]],
    6: [[0, 1.28, -.05], [.19, .10, .19]],
    8: [[0, 1.43, .27], [.105, .24, .115]],
    10: [[0, 1.83, 0], [.075, .075, .075]],
  }[style] ?? [[0, 1.45, 0], [0, 0, 0]];
  ellipsoid(p, extra[0], extra[1], style === 10 ? trim : hair, 6, 4);

  for (const side of [-1, 1]) {
    const eye = new THREE.CircleGeometry(.018, 4); eye.scale(1, 1.25, 1);
    p.add(eye, [side * .074, 1.458, -.226], ink, [0, Math.PI - side * .3, 0]);
    const glasses = new THREE.RingGeometry(.033, .044, 8);
    if (![5, 6, 9].includes(style)) glasses.scale(0, 0, 0);
    p.add(glasses, [side * .074, 1.46, -.24], ink, [0, Math.PI - side * .3, 0]);
  }
  const bridge = new THREE.PlaneGeometry(.065, .012);
  if (![5, 6, 9].includes(style)) bridge.scale(0, 0, 0);
  p.add(bridge, [0, 1.46, -.251], ink, [0, Math.PI, 0]);
  const pocket = style === 9, cardigan = style === 6, scarf = [0, 4, 8, 11].includes(style);
  const detail = new THREE.PlaneGeometry(...(pocket ? [.18, .14] : cardigan ? [.055, .57] : [.075, .24]));
  if (!pocket && !cardigan && !scarf) detail.scale(0, 0, 0);
  p.add(detail, pocket ? [0, .72, -.287] : cardigan ? [0, .73, -.253] : [-.075, .99, -.224], trim, [0, Math.PI, scarf ? -.13 : 0]);
  const merged = p.finish({ preserveNormals: true });
  const result = merged.toNonIndexed(); merged.dispose(); return result;
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

export function createWalkerMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .92 });
  material.customProgramCacheKey = () => 'citydriver-walker-palettes-v2';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      walkerCoats: { value: coatPalette }, walkerTrims: { value: trimPalette },
      walkerSkin: { value: skinPalette }, walkerHair: { value: hairPalette },
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      uniform vec3 walkerCoats[${coatPalette.length}];
      uniform vec3 walkerTrims[${trimPalette.length}];
      uniform vec3 walkerSkin[${skinPalette.length}];
      uniform vec3 walkerHair[${hairPalette.length}];
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
      if (mask.b == 0.0 && mask.r > 0.0 && mask.g > 0.0) vColor.rgb = walkerTrims[look.x];
      else if (mask.g == 0.0 && mask.b == 0.0) vColor.rgb = walkerCoats[look.x] * mask.r;
      else if (mask.r == 0.0 && mask.b == 0.0) vColor.rgb = walkerSkin[look.y] * mask.g;
      else if (mask.r == 0.0 && mask.g == 0.0) vColor.rgb = walkerHair[look.z] * mask.b;
    `);
  };
  return material;
}

function hash(seed) {
  let n = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
export function walkerAppearance(seed) {
  const look = hash(seed) % WALKER_LOOKS.length;
  return { look, skin: skinWeights[hash(seed ^ 0x3671) % skinWeights.length], hair: hash(seed ^ 0x9173) % WALKER_HAIR.length, style: WALKER_LOOKS[look].style };
}

// One palette per fare makes a party readable at driving distance. Some
// groups share a uniform; others share colors across different silhouettes.
const taxiWardrobes = [
  { looks: [10, 16], styles: [0, 6, 8] }, // work friends
  { looks: [5, 18], styles: [3, 4, 11] }, // evening out
  { looks: [13, 17], styles: [1, 7] }, // matching team tops
  { looks: [15, 21], styles: [9] }, // art club
  { looks: [16, 22], styles: [10] }, // winter outing
  { looks: [2, 8], styles: [0, 2, 4, 8] }, // festival friends
];
export function taxiGroupAppearance(seed, passenger) {
  const wardrobe = taxiWardrobes[hash(seed ^ 0x6321) % taxiWardrobes.length];
  const appearance = walkerAppearance(seed + passenger * 719);
  appearance.look = wardrobe.looks[hash(seed ^ 0x1709) % wardrobe.looks.length];
  appearance.style = wardrobe.styles[hash(seed + passenger * 31) % wardrobe.styles.length];
  return appearance;
}

// Pair existing residents rather than increasing the crowd. Shared travel
// phase/speed keeps them together through culling and streaming; their bob,
// proportions and wardrobe remain individual. No following AI is needed.
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
