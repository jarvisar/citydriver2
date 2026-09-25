import * as THREE from 'three';
import { CITY_PLACES, SPACE_NAMES } from './city-places.js';
import { SHOP_BRANDS, placeName } from './city-businesses.js';
import { SHOP_SIGN_DESIGNS } from './city-shop-signs.js';
import { PLACE_SIGN_DESIGNS } from './city-place-signs.js';

export const SHOP_NAMES = Object.keys(SHOP_BRANDS);
// Art direction is chosen for each business and public service, independently
// of the city's random stream. Related public signs share a design on purpose.
export const SHOP_SIGNS = SHOP_NAMES.flatMap(category => SHOP_BRANDS[category].map((name, variant) => ({
  ...SHOP_SIGN_DESIGNS[category][variant], category, name,
})));
export const DISCOVERY_SIGNS = Object.keys(CITY_PLACES).flatMap(type => SPACE_NAMES[type].map((_, variant) => ({
  ...PLACE_SIGN_DESIGNS[type][variant], type, variant, name: placeName(type, variant),
})));
export const SIGN_CATALOG = [...SHOP_SIGNS, ...DISCOVERY_SIGNS].map((sign, tile) => Object.assign(sign, { tile }));
const shopsByCategory = Object.fromEntries(SHOP_NAMES.map(category => [category, SHOP_SIGNS.filter(sign => sign.category === category)]));

// A block's shops are dealt from the whole catalogue in turn, each block from
// a start and a stride of its own that changes the kind of shop at every
// step, so no two shops round a block share a name and a street of shops is
// not a bakery beside a bakery.
const STRIDES = [13, 37, 49, 73, 97, 109];
const mix = n => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
export function shopSignFor(building) {
  // (a private hash leaves the architecture's seeded random sequence untouched)
  if (building.shopSlot !== undefined) {
    const block = mix(Math.imul(building.shopBlock, 0x9e3779b1) ^ 7411), stride = STRIDES[block % STRIDES.length];
    return SHOP_SIGNS[(mix(block) + building.shopSlot * stride) % SHOP_SIGNS.length];
  }
  const choices = shopsByCategory[building.shop];
  return choices[mix(building.seed) % choices.length];
}
export function discoverySignFor(type, variant = 0) {
  return DISCOVERY_SIGNS.find(sign => sign.type === type && sign.variant === variant) ?? DISCOVERY_SIGNS.find(sign => sign.type === type);
}

// All silhouettes are alpha cutouts on the same two-triangle plane. Tiles use
// padding and a half-texel inset; only one atlas is uploaded per world.
const atlasRows = Math.ceil(SIGN_CATALOG.length / 8);
export const SIGN_ATLAS = { width: 2048, height: atlasRows * 128, columns: 8, rows: atlasRows, tileWidth: 256, tileHeight: 128, padding: 4 };
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
// A few flat trade/service symbols, with strokes thick enough for the atlas.
// These are identifiers, not a decorative badge added to every sign.
function pictogram(ctx, icon, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  ctx.lineWidth = .065; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle;
  const line = points => { ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); };
  const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); };
  if (icon === 'cup') {
    line([[-.32, -.26], [.22, -.26], [.19, .23], [-.26, .23], [-.32, -.26]]);
    ctx.beginPath(); ctx.arc(.23, -.05, .18, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    line([[-.36, .35], [.31, .35]]);
  } else if (icon === 'record') {
    circle(0, 0, .4); circle(0, 0, .14);
    ctx.beginPath(); ctx.arc(0, 0, .28, -1.3, .1); ctx.stroke();
  } else if (icon === 'bicycle') {
    circle(-.3, .19, .2); circle(.3, .19, .2);
    line([[-.3, .19], [-.13, -.16], [.08, .19], [-.3, .19], [.18, -.18], [.3, .19]]);
    line([[.18, -.18], [.13, -.32], [.27, -.32]]); line([[-.23, -.2], [-.08, -.2]]);
  } else if (icon === 'leaf') {
    ctx.beginPath(); ctx.moveTo(-.25, .3); ctx.quadraticCurveTo(-.5, -.3, .31, -.4);
    ctx.quadraticCurveTo(.47, .31, -.25, .3); ctx.fill();
    line([[-.33, .43], [-.08, .08]]);
  } else if (icon === 'book') {
    line([[0, .32], [-.38, .23], [-.38, -.34], [0, -.25], [.38, -.34], [.38, .23], [0, .32], [0, -.25]]);
  } else if (icon === 'bowl') {
    ctx.beginPath(); ctx.arc(0, -.04, .38, 0, Math.PI); ctx.closePath(); ctx.stroke();
    line([[-.19, .4], [.19, .4]]); line([[-.05, -.2], [.37, -.4]]); line([[-.12, -.3], [.28, -.5]]);
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
function shopLettering(ctx, sign, w, h, x, width) {
  const trade = sign.shopType, side = trade && sign.typePosition === 'side';
  const above = trade && sign.typePosition === 'above', band = trade && sign.layout === 'band';
  const lines = (sign.lines ?? [sign.name]).map(line => sign.uppercase ? line.toUpperCase() : line);
  const two = lines.length > 1, scales = lines.map((_, i) => sign.lineScales?.[i] ?? 1);
  if (side) {
    x = w * .075; width = w * .55; ctx.textAlign = 'left';
    ctx.fillStyle = sign.accent; ctx.fillRect(w * .665, h * .24, 2, h * .52);
  }
  const size = h * (sign.nameSize ?? (two ? .30 : .41));
  // Explicit line breaks and emphasis belong to each business's lettering.
  // A trade label always remains secondary, even on a long, fitted name.
  const fit = Math.min(1, ...lines.map((line, i) => {
    ctx.font = `${sign.weight} ${size * scales[i]}px ${sign.font}`;
    return width / Math.max(1, ctx.measureText(line).width);
  }));
  const centre = side || !trade ? .51 : band ? .35 : above ? .60 : sign.shape === 'arch' ? .46 : .42;
  ctx.fillStyle = sign.ink;
  lines.forEach((line, i) => lettering(ctx, line, x, h * (centre + (i - (lines.length - 1) / 2) * .31),
    width, size * scales[i] * fit, sign.font, sign.weight));
  if (!trade) return;
  const tradeSize = Math.min(h * (sign.typeSize ?? .16), size * fit * .65);
  ctx.fillStyle = band ? sign.background : sign.ink;
  if (side) ctx.textAlign = 'center';
  const framed = sign.layout === 'frame';
  const tradeY = side ? .51 : above ? (framed ? .24 : .20) : band ? .84 : two ? (framed ? .79 : .84) : .77;
  lettering(ctx, sign.typeUppercase ? trade.toUpperCase() : trade, side ? w * .81 : x,
    h * tradeY, side ? w * .23 : width * .94,
    tradeSize, 'sans-serif', 'normal');
}
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
  } else if (sign.layout === 'band' && (sign.shopType || sign.subtitle)) {
    ctx.fillStyle = sign.ink; ctx.fillRect(5, h * .69, w - 10, h * .31 - 5);
  }

  const left = sign.layout === 'left', split = sign.layout === 'split';
  const inset = sign.shape === 'oval' ? .74 : sign.layout === 'frame' ? .80 : .85;
  const x = left ? w * .08 : split ? w * .62 : w / 2, width = w * (split ? .61 : inset);
  if (left) ctx.textAlign = 'left';
  ctx.fillStyle = sign.ink;
  if (split && sign.icon) pictogram(ctx, sign.icon, w * .15, h * .5, Math.min(h * .64, w * .18));
  if (sign.category) {
    shopLettering(ctx, sign, w, h, x, width);
    ctx.restore(); return;
  }
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
// The painted faces, and a board for each: the same silhouette in dark paint
// a little bigger, behind the face, so a sign's board follows its shape (an
// oval board behind an oval sign) rather than showing a box's corners
export function createSignMaterials() {
  const signs = createSignMaterial(), edges = createSignMaterial({ map: signs.map, edge: '#2f3538' });
  return { signs, edges };
}
export function createSignMaterial({ map: shared = undefined, edge = null } = {}) {
  let map = shared ?? null;
  const { width, height, columns, rows, tileWidth, tileHeight, padding } = SIGN_ATLAS;
  if (shared === undefined && globalThis.document) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    for (const sign of SIGN_CATALOG) {
      ctx.save();
      ctx.translate(sign.tile % columns * tileWidth + padding, Math.floor(sign.tile / columns) * tileHeight + padding);
      ctx.scale((tileWidth - 2 * padding) / 512, (tileHeight - 2 * padding) / (512 / sign.aspect));
      drawSign(ctx, sign); ctx.restore();
    }
    map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  }
  const material = new THREE.MeshBasicMaterial({ map, alphaTest: .5, toneMapped: false, side: edge ? THREE.DoubleSide : THREE.FrontSide });
  material.userData.signAtlas = true;
  const ink = edge ? new THREE.Color(edge) : null;
  material.customProgramCacheKey = () => `citydriver-sign-atlas-v2-${columns}-${rows}${edge ? '-edge' : ''}`;
  material.onBeforeCompile = shader => {
    // Reuse instanceColor as a tile index; no per-sign uniforms, geometries or
    // per-frame uploads. Keep the atlas colors independent of this index.
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `
        #ifdef USE_INSTANCING_COLOR
          vColor = vec4(1.0);
        #endif
      `)
      .replace('#include <uv_vertex>', `
        #include <uv_vertex>
        #if defined(USE_MAP) && defined(USE_INSTANCING_COLOR)
          float tile = floor(instanceColor.r + 0.5);
          vec2 cell = vec2(mod(tile, ${columns}.0), ${rows - 1}.0 - floor(tile / ${columns}.0));
          vMapUv = (cell * vec2(${tileWidth}.0, ${tileHeight}.0) + vec2(${padding + .5})
            + uv * vec2(${tileWidth - 2 * padding - 1}.0, ${tileHeight - 2 * padding - 1}.0)) / vec2(${width}.0, ${height}.0);
        #endif
      `);
    // A board keeps only its sign's silhouette, in its own flat colour
    if (ink) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        diffuseColor.rgb = vec3(${ink.r.toFixed(4)}, ${ink.g.toFixed(4)}, ${ink.b.toFixed(4)});
      `);
  };
  return material;
}
