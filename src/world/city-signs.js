import * as THREE from 'three';
import { CITY_PLACES, SPACE_NAMES } from './city-places.js';
import { placeName } from './city-businesses.js';
import { PLACE_SIGN_DESIGNS } from './city-place-signs.js';
import { SHEET_SIGNS, SIGN_SHEET_URL } from './city-sign-sheet.js';

// Every sign face in the city shares one atlas. Businesses (shops, offices,
// warehouses, flats) take theirs from the painted sign sheet by use (see
// city-sign-sheet.js and city-building-signs.js). The discovery places keep
// boards of their own, drawn here, since the sheet has nothing to stand in
// for City Hall or the observatory. Related public signs share a design.
export const BUSINESS_SIGNS = SHEET_SIGNS.map(sign => ({ ...sign, aspect: sign.rect[2] / sign.rect[3] }));
export const DISCOVERY_SIGNS = Object.keys(CITY_PLACES).flatMap(type => SPACE_NAMES[type].map((_, variant) => ({
  ...PLACE_SIGN_DESIGNS[type][variant], type, variant, name: placeName(type, variant),
})));
export const SIGN_CATALOG = [...BUSINESS_SIGNS, ...DISCOVERY_SIGNS].map((sign, tile) => Object.assign(sign, { tile }));
export const SIGN_USES = ['shop', 'firm', 'works', 'home', 'upstairs', 'vacant', 'decal'];
export const SIGNS_BY_USE = Object.fromEntries(SIGN_USES.map(use => [use, BUSINESS_SIGNS.filter(sign => sign.uses.includes(use))]));

// A block deals its buildings their signs of each use in turn, from a start
// and a stride of its own (one that shares no factor with the number of signs
// to deal), so no two buildings round a block with fewer lots than signs show
// the same one, and a street of shops is not a bakery beside a bakery. (A
// private hash leaves the architecture's seeded random sequence untouched.)
const STRIDES = [13, 37, 49, 73, 97, 109];
const mix = n => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export function dealSign(building, use) {
  const signs = SIGNS_BY_USE[use], salt = Math.imul(SIGN_USES.indexOf(use) + 1, 0x632be5ab);
  if (building.shopSlot === undefined) return signs[mix(building.seed ^ salt) % signs.length];
  const block = mix(Math.imul(building.shopBlock, 0x9e3779b1) ^ 7411 ^ salt), strides = STRIDES.filter(s => gcd(s, signs.length) === 1);
  return signs[(mix(block) + building.shopSlot * strides[block % strides.length]) % signs.length];
}
export const shopSignFor = building => dealSign(building, 'shop');
export function discoverySignFor(type, variant = 0) {
  return DISCOVERY_SIGNS.find(sign => sign.type === type && sign.variant === variant) ?? DISCOVERY_SIGNS.find(sign => sign.type === type);
}

// The atlas gives every face a rectangle at its own proportions, laid in rows,
// tallest first. The sheet's designs go in at .42 of their size (a small
// sticker at up to its own), about the texels a metre a fascia needs from
// across the street, and the drawn boards 120 px tall. Each keeps a gutter of
// its own edge pixels so that mipmaps do not bleed one face into the next.
const ATLAS_WIDTH = 4096, GUTTER = 4, SHEET_SCALE = .42, SMALL = 20000, DRAWN_HEIGHT = 120;
function faceSize(sign) {
  if (!sign.rect) return [Math.round(DRAWN_HEIGHT * sign.aspect), DRAWN_HEIGHT];
  const [, , w, h] = sign.rect, scale = Math.min(1, Math.max(SHEET_SCALE, Math.sqrt(SMALL / (w * h))));
  return [Math.round(w * scale), Math.round(h * scale)];
}
function layAtlas(signs) {
  let x = 0, y = 0, row = 0;
  for (const sign of signs.slice().sort((a, b) => faceSize(b)[1] - faceSize(a)[1] || a.tile - b.tile)) {
    const [w, h] = faceSize(sign);
    if (x + w + 2 * GUTTER > ATLAS_WIDTH) { y += row; x = 0; row = 0; }
    sign.atlas = [x + GUTTER, y + GUTTER, w, h];
    x += w + 2 * GUTTER; row = Math.max(row, h + 2 * GUTTER);
  }
  return Math.ceil((y + row) / 16) * 16;
}
export const SIGN_ATLAS = { width: ATLAS_WIDTH, height: layAtlas(SIGN_CATALOG), gutter: GUTTER };
// A sign's instances carry its rectangle in their colour, for the shader: the
// left edge, the bottom edge counted up (the texture is flipped), and the
// width and height packed into one (exact in a float up to 4096 x 4096)
for (const sign of SIGN_CATALOG) {
  const [x, y, w, h] = sign.atlas;
  sign.tint = [x, SIGN_ATLAS.height - y - h, w * 4096 + h];
}

function outline(ctx, shape, w, h) {
  const e = 5;
  ctx.beginPath();
  if (shape === 'oval') ctx.ellipse(w / 2, h / 2, w / 2 - e, h / 2 - e, 0, 0, Math.PI * 2);
  else if (shape === 'arch') {
    ctx.moveTo(e, h - e); ctx.lineTo(e, h * .35);
    ctx.bezierCurveTo(e, -h * .08, w - e, -h * .08, w - e, h * .35);
    ctx.lineTo(w - e, h - e);
  } else if (shape === 'clipped') {
    const c = h * .19;
    ctx.moveTo(c, e); ctx.lineTo(w - c, e); ctx.lineTo(w - e, c); ctx.lineTo(w - e, h - c);
    ctx.lineTo(w - c, h - e); ctx.lineTo(c, h - e); ctx.lineTo(e, h - c); ctx.lineTo(e, c);
  } else if (shape === 'rect') ctx.rect(e, e, w - 2 * e, h - 2 * e);
  else ctx.roundRect(e, e, w - 2 * e, h - 2 * e, h * .08);
  ctx.closePath();
}
function lettering(ctx, text, x, y, width, size, font, weight = 'bold') {
  ctx.font = `${weight} ${size}px ${font}`;
  const fitted = Math.min(size, size * width / Math.max(1, ctx.measureText(text).width));
  ctx.font = `${weight} ${fitted}px ${font}`;
  ctx.fillText(text, x, y);
}
// A few flat public-service symbols, with strokes thick enough for the atlas.
// These are identifiers, not a decorative badge added to every sign.
function pictogram(ctx, icon, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  ctx.lineWidth = .065; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle;
  const line = points => { ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); };
  if (icon === 'leaf') {
    ctx.beginPath(); ctx.moveTo(-.25, .3); ctx.quadraticCurveTo(-.5, -.3, .31, -.4);
    ctx.quadraticCurveTo(.47, .31, -.25, .3); ctx.fill();
    line([[-.33, .43], [-.08, .08]]);
  } else if (icon === 'cross') {
    ctx.fillRect(-.12, -.4, .24, .8); ctx.fillRect(-.4, -.12, .8, .24);
  } else if (icon === 'rail') {
    ctx.strokeRect(-.28, -.38, .56, .6); line([[-.28, -.1], [.28, -.1]]);
    line([[-.15, .22], [-.29, .42]]); line([[.15, .22], [.29, .42]]);
  } else if (icon === 'post') {
    ctx.strokeRect(-.4, -.26, .8, .52); line([[-.4, -.26], [0, .03], [.4, -.26]]);
  } else if (icon === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? .12 : .43; ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r); }
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
// A discovery place's board, 512 wide and 512 / aspect high
export function drawSign(ctx, sign) {
  const w = 512, h = w / sign.aspect;
  ctx.save();
  outline(ctx, sign.shape, w, h);
  ctx.fillStyle = sign.background; ctx.fill();
  ctx.clip();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (sign.layout === 'frame') {
    ctx.save(); ctx.translate(12, 12); outline(ctx, sign.shape, w - 24, h - 24);
    ctx.strokeStyle = sign.accent; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore();
  } else if (sign.layout === 'marquee') {
    ctx.fillStyle = sign.accent;
    for (const y of [.11, .87]) ctx.fillRect(w * .06, h * y, w * .88, Math.max(3, h * .025));
  } else if (sign.layout === 'band' && sign.subtitle) {
    ctx.fillStyle = sign.ink; ctx.fillRect(5, h * .69, w - 10, h * .31 - 5);
  }
  const left = sign.layout === 'left', split = sign.layout === 'split';
  const inset = sign.shape === 'oval' ? .74 : sign.layout === 'frame' ? .80 : .85;
  const x = left ? w * .08 : split ? w * .62 : w / 2, width = w * (split ? .61 : inset);
  if (left) ctx.textAlign = 'left';
  ctx.fillStyle = sign.ink;
  if (split && sign.icon) pictogram(ctx, sign.icon, w * .15, h * .5, Math.min(h * .64, w * .18));
  const lines = (sign.lines ?? [sign.name]).map(line => sign.uppercase ? line.toUpperCase() : line);
  const band = sign.layout === 'band' && sign.subtitle, two = lines.length > 1;
  const centre = band ? .36 : sign.subtitle ? .42 : .51;
  let size = h * (two ? .29 : .44);
  // Fit all title lines together, retaining a deliberate typographic hierarchy.
  ctx.font = `${sign.weight} ${size}px ${sign.font}`;
  size *= Math.min(1, width / Math.max(...lines.map(line => ctx.measureText(line).width), 1));
  lines.forEach((line, i) => lettering(ctx, line, x, h * centre + (i - (lines.length - 1) / 2) * h * .31, width, size, sign.font, sign.weight));
  if (sign.subtitle) {
    ctx.fillStyle = band ? sign.background : sign.ink;
    const y = band ? .83 : two ? .83 : .76;
    lettering(ctx, sign.subtitle.toUpperCase(), x, h * y, width * .95, h * .14, 'sans-serif', 'normal');
  }
  ctx.restore();
}
// The part of a sign's face, as shares of its width and height (and how far
// its middle sits above the face's), that its outline covers whatever its
// shape: what a board's core, posts and brackets can hide behind
const CORES = { rect: [.94, .86, 0], plaque: [.94, .86, 0], oval: [.66, .64, 0], arch: [.9, .62, -.1], clipped: [.88, .86, 0] };
export function signCore(sign, width, height) {
  const [w, h, y] = CORES[sign.shape] ?? CORES.plaque;
  return { width: width * w, height: height * h, y: height * y };
}

// The sheet, loading as soon as a page imports this: null where there is no
// page (Node), or if it cannot be had (its signs are then left blank)
// (decoded off the main thread, not at the first drawImage)
export const signSheet = globalThis.document ? new Promise(resolve => {
  const image = new Image();
  image.src = SIGN_SHEET_URL;
  image.decode().then(() => resolve(image), () => { console.warn('The sign sheet did not load'); resolve(null); });
}) : Promise.resolve(null);
// The atlas is drawn once a page: the discovery boards at once, the sheet's
// designs as soon as it has loaded. Each face's edge pixels are copied out
// into its gutter.
let atlasCanvas = null;
function spread(ctx, [x, y, w, h]) {
  const g = GUTTER, canvas = ctx.canvas;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x, y, w, 1, x, y - g, w, g);
  ctx.drawImage(canvas, x, y + h - 1, w, 1, x, y + h, w, g);
  ctx.drawImage(canvas, x, y - g, 1, h + 2 * g, x - g, y - g, g, h + 2 * g);
  ctx.drawImage(canvas, x + w - 1, y - g, 1, h + 2 * g, x + w, y - g, g, h + 2 * g);
  ctx.imageSmoothingEnabled = true;
}
function drawAtlas() {
  const canvas = document.createElement('canvas'); canvas.width = SIGN_ATLAS.width; canvas.height = SIGN_ATLAS.height;
  const ctx = canvas.getContext('2d');
  for (const sign of DISCOVERY_SIGNS) {
    const [x, y, w, h] = sign.atlas;
    ctx.save(); ctx.translate(x, y); ctx.scale(w / 512, h / (512 / sign.aspect));
    drawSign(ctx, sign); ctx.restore();
    spread(ctx, sign.atlas);
  }
  signSheet.then(image => {
    if (!image) return;
    ctx.imageSmoothingQuality = 'high';
    for (const sign of BUSINESS_SIGNS) {
      const [x, y, w, h] = sign.atlas;
      if (sign.backing) { ctx.fillStyle = sign.backing; ctx.fillRect(x, y, w, h); }
      ctx.drawImage(image, ...sign.rect, x, y, w, h);
      spread(ctx, sign.atlas);
    }
  });
  return canvas;
}

// The painted faces, and a board for each: the same silhouette in dark paint
// a little bigger, behind the face, so a sign's board follows its shape (an
// oval board behind an oval sign) rather than showing a box's corners.
// Both are lit as painted panels are, in the sun and the shade of what
// stands round them; after dark the faces light up (`glow`, see
// CitydriverWorld.setWindowGlow), their own colours added as light.
// A face lies a few centimetres in front of its board, and the board in
// front of the wall: past a couple of hundred metres that is less than a
// step of the depth buffer, so each is also drawn a few steps nearer than
// it stands (the face more than its board), or they fight far off.
export function createSignMaterials() {
  const signs = createSignMaterial(), edges = createSignMaterial({ map: signs.map, edge: '#2f3538' });
  return { signs, edges };
}
export function createSignMaterial({ map: shared = undefined, edge = null } = {}) {
  let map = shared ?? null;
  const { width, height } = SIGN_ATLAS;
  if (shared === undefined && globalThis.document) {
    atlasCanvas ??= drawAtlas();
    map = new THREE.CanvasTexture(atlasCanvas); map.colorSpace = THREE.SRGBColorSpace;
    // (fascias are mostly seen at a slant, from along the street)
    map.anisotropy = 8;
    signSheet.then(image => { if (image) map.needsUpdate = true; });
  }
  const material = new THREE.MeshStandardMaterial({
    map, alphaTest: .5, roughness: edge ? .8 : .62, metalness: 0, side: edge ? THREE.DoubleSide : THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: edge ? -1 : -2, polygonOffsetUnits: edge ? -2 : -4,
  });
  material.userData.signAtlas = true;
  const glow = material.userData.glow = { value: 0 };
  const ink = edge ? new THREE.Color(edge) : null;
  material.customProgramCacheKey = () => `citydriver-sign-atlas-v4-${width}x${height}${edge ? '-edge' : ''}`;
  material.onBeforeCompile = shader => {
    // Reuse instanceColor as the face's atlas rectangle (see tint); no
    // per-sign uniforms, geometries or per-frame uploads. Keep the atlas
    // colours independent of it.
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `
        #ifdef USE_INSTANCING_COLOR
          vColor = vec4(1.0);
        #endif
      `)
      .replace('#include <uv_vertex>', `
        #include <uv_vertex>
        #if defined(USE_MAP) && defined(USE_INSTANCING_COLOR)
          float faceWidth = floor(instanceColor.b / 4096.0), faceHeight = instanceColor.b - faceWidth * 4096.0;
          vMapUv = (instanceColor.rg + 0.5 + uv * vec2(faceWidth - 1.0, faceHeight - 1.0)) / vec2(${width}.0, ${height}.0);
        #endif
      `);
    // A board keeps only its sign's silhouette, in its own flat colour
    if (ink) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        diffuseColor.rgb = vec3(${ink.r.toFixed(4)}, ${ink.g.toFixed(4)}, ${ink.b.toFixed(4)});
      `);
    // (a face lit from within after dark)
    else {
      shader.uniforms.signGlow = glow;
      shader.fragmentShader = `uniform float signGlow;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * signGlow;
      `);
    }
  };
  return material;
}
