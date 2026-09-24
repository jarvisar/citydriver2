import * as THREE from 'three';
import { CITY_PLACES, SPACE_NAMES } from './city-places.js';
import { SHOP_BRANDS, venueBrand, placeName } from './city-businesses.js';

export const SHOP_NAMES = Object.keys(SHOP_BRANDS);
const STYLES = [
  { shape: 'plaque', aspect: 4.4, font: 'Georgia, serif', weight: 'bold', background: '#244e51', ink: '#fff0cb', accent: '#d8ad66' },
  { shape: 'oval', aspect: 3.1, font: 'Georgia, serif', weight: 'italic', background: '#f2dfb7', ink: '#684134', accent: '#a75c43' },
  { shape: 'arch', aspect: 2.8, font: 'sans-serif', weight: 'bold', background: '#854847', ink: '#fff0d4', accent: '#e8ad76' },
  { shape: 'clipped', aspect: 4, font: 'monospace', weight: 'bold', background: '#343f60', ink: '#f8e2b9', accent: '#9fc9cd' },
  { shape: 'pennant', aspect: 3.5, font: 'sans-serif', weight: 'bold', background: '#426548', ink: '#fff2ce', accent: '#c4d498' },
];
const HEADERS = {
  clock: 'MEET UNDER THE CLOCK', market: 'THE MARKET QUARTER', garden: 'TAKE THE SCENIC ROUTE', depot: 'ON THE RIGHT TRACK',
  art: 'ART IN THE OPEN', cinema: 'NOW SHOWING', hotel: 'STAY A LITTLE LONGER', museum: 'A CITY OF STORIES',
  station: 'YOUR NEXT CHAPTER', library: 'GET LOST IN A BOOK', hospital: 'CARE CLOSE TO HOME', observatory: 'LOOK UP TONIGHT',
  music: 'FOLLOW THE MUSIC', sports: 'COME OUT & PLAY', firehouse: 'NEIGHBORHOOD HEROES', park: 'ROOM TO WANDER',
  plaza: 'MEET YOU HERE', postoffice: 'SIGNED, SEALED, DELIVERED', bathhouse: 'SOAK UP THE QUIET',
  farmersmarket: 'FRESH FROM THE GROWERS', donut: 'A LITTLE RING OF JOY', cityhall: 'THE HEART OF THE CITY',
};

export const SHOP_SIGNS = SHOP_NAMES.flatMap((category, c) => SHOP_BRANDS[category].map(([name, subtitle], variant) => ({
  ...STYLES[(c + variant) % STYLES.length], category, name, subtitle, header: '',
})));
// A place's board carries its name (see placeName) over what it is: a
// venue's own design, an open space's kind, or, where its name already says
// that, what is there
const OPEN_AIR = new Set(['park', 'plaza', 'clock', 'art', 'garden']);
const subtitleFor = (type, variant, place, design) => {
  if (venueBrand(type, variant) || type === 'cityhall') return design;
  if (OPEN_AIR.has(type)) return place.short;
  return design.toLowerCase() === place.short.toLowerCase() ? place.description.replace(/.$/, '') : place.short;
};
export const DISCOVERY_SIGNS = Object.entries(CITY_PLACES).flatMap(([type, place], i) => SPACE_NAMES[type].map((design, variant) => ({
  ...STYLES[(i + variant) % STYLES.length], type, variant,
  name: placeName(type, variant), subtitle: subtitleFor(type, variant, place, design),
  header: (venueBrand(type, variant)?.slogan ?? HEADERS[type]).toUpperCase(),
  aspect: [2.15, 1.85, 1.65, 2.2, 2][(i + variant) % STYLES.length], accent: place.color,
})));
export const SIGN_CATALOG = [...SHOP_SIGNS, ...DISCOVERY_SIGNS].map((sign, tile) => Object.assign(sign, { tile }));
const shopsByCategory = Object.fromEntries(SHOP_NAMES.map(category => [category, SHOP_SIGNS.filter(sign => sign.category === category)]));

export function shopSignFor(building) {
  // A private hash leaves the architecture's seeded random sequence untouched.
  let seed = Math.imul(building.seed ^ (building.seed >>> 16), 0x45d9f3b);
  seed = (seed ^ (seed >>> 16)) >>> 0;
  const choices = shopsByCategory[building.shop];
  return choices[seed % choices.length];
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
  } else if (shape === 'pennant') {
    ctx.moveTo(e, e); ctx.lineTo(w - e, e); ctx.lineTo(w - e, h * .79);
    ctx.lineTo(w / 2, h - e); ctx.lineTo(e, h * .79);
  } else ctx.roundRect(e, e, w - 2 * e, h - 2 * e, h * .12);
  ctx.closePath();
}
function lettering(ctx, text, x, y, width, size, font, weight = 'bold') {
  ctx.font = `${weight} ${size}px ${font}`;
  const fitted = Math.min(size, size * width / Math.max(1, ctx.measureText(text).width));
  ctx.font = `${weight} ${fitted}px ${font}`;
  ctx.fillText(text, x, y);
}
export function drawSign(ctx, sign) {
  const w = 512, h = w / sign.aspect;
  outline(ctx, sign.shape, w, h);
  ctx.fillStyle = sign.background; ctx.fill();
  ctx.strokeStyle = sign.accent; ctx.lineWidth = 4; ctx.stroke();
  ctx.save(); ctx.clip();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const inset = sign.shape === 'oval' ? .72 : .84;
  ctx.fillStyle = sign.background === '#f2dfb7' ? sign.ink : sign.accent;
  if (sign.header) lettering(ctx, sign.header, w / 2, h * .25, w * .68, h * .075, 'sans-serif');
  else {
    ctx.fillRect(w * .43, h * .17, w * .14, 2);
  }
  ctx.fillStyle = sign.ink;
  const title = sign.font === 'monospace' ? sign.name.toUpperCase() : sign.name;
  lettering(ctx, title, w / 2, h * .47, w * inset, h * (sign.header ? .20 : .32), sign.font, sign.weight);
  ctx.fillStyle = sign.header ? sign.ink : sign.accent;
  lettering(ctx, sign.subtitle.toUpperCase(), w / 2, h * .72, w * .70, h * (sign.header ? .085 : .10), 'sans-serif', 'normal');
  ctx.restore();
}
export function createSignMaterial() {
  let map = null;
  const { width, height, columns, rows, tileWidth, tileHeight, padding } = SIGN_ATLAS;
  if (globalThis.document) {
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
  const material = new THREE.MeshBasicMaterial({ map, alphaTest: .5, toneMapped: false });
  material.userData.signAtlas = true;
  material.customProgramCacheKey = () => `citydriver-sign-atlas-v1-${columns}-${rows}`;
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
  };
  return material;
}
