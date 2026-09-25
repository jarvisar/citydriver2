import { CITY, cityDistrict } from './world/city.js';
import { CityMapCache } from './city-map.js';

// The whole city on one page for the pause screen: every block tinted by its
// district, each neighbourhood named where its blocks are, downtown, and the
// car. The streets, water and parks come from the street map's cached paths.
export const DISTRICT_COLORS = {
  'Old town': '#c9785b', 'Market district': '#d9a441', 'Garden quarter': '#86b35e',
  'Warehouse district': '#9a93ad', 'Civic quarter': '#d9cfae', Midtown: '#6fa2d8',
};
const MARGIN = 60;

// Where the HUD says Downtown (see cityDistrict)
const DOWNTOWN = .558;
// Where to name each district: on the block nearest the middle of its
// blocks (the middle itself can be in the river), for any big enough to
// read, and downtown the same way. `blocks` counts each one's blocks.
export function worldMapLabels(city = CITY, minBlocks = 3) {
  const groups = new Map(), core = { style: 'Midtown', centres: [] };
  for (const block of city.blocks) {
    if (!block.style || block.sidewalk.length < 3) continue;
    const c = centre(block.sidewalk), index = city.neighbourhoodAt(c.x, c.y);
    const group = city.downtownDistance(c) < DOWNTOWN ? core : groups.get(index) ?? { style: city.districts[index]?.style ?? block.style, centres: [] };
    group.centres.push(c);
    if (group !== core) groups.set(index, group);
  }
  const place = ({ style, centres }, extra = {}) => {
    const middle = centre(centres), at = centres.reduce((best, c) => Math.hypot(c.x - middle.x, c.y - middle.y) < Math.hypot(best.x - middle.x, best.y - middle.y) ? c : best);
    return { name: style, style, x: at.x, y: at.y, blocks: centres.length, ...extra };
  };
  const labels = [...groups.values()].filter(group => group.centres.length >= minBlocks).map(group => place(group));
  if (core.centres.length) labels.push(place(core, { name: 'Downtown', downtown: true }));
  return labels;
}
function centre(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

export class WorldMap {
  constructor(city = CITY, cache = null) {
    this.city = city; this.cache = cache ?? new CityMapCache(city);
    // One path per district for the blocks' tint
    this.tints = new Map();
    for (const block of city.blocks) {
      if (!block.style || block.sidewalk.length < 3) continue;
      if (!this.tints.has(block.style)) this.tints.set(block.style, new Path2D());
      const path = this.tints.get(block.style);
      block.sidewalk.forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](p.x, p.y)); path.closePath();
    }
    this.labels = worldMapLabels(city);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const piece of city.land) for (const p of piece.outer) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    this.bounds = { minX: minX - MARGIN, minY: minY - MARGIN, maxX: maxX + MARGIN, maxY: maxY + MARGIN };
  }
  get aspect() { const b = this.bounds; return (b.maxX - b.minX) / (b.maxY - b.minY); }
  // World (u, s) to canvas pixels, for a canvas `width` CSS pixels wide
  frame(width) {
    const b = this.bounds, scale = width / (b.maxX - b.minX);
    return { scale, height: (b.maxY - b.minY) * scale, toCanvas: (u, s) => [(u - b.minX) * scale, (b.maxY - s) * scale], toWorld: (x, y) => ({ u: b.minX + x / scale, s: b.maxY - y / scale }) };
  }
  // The district under a canvas point, as the HUD would name it there
  districtAt(x, y, width) {
    const { u, s } = this.frame(width).toWorld(x, y), b = this.bounds;
    if (u < b.minX || u > b.maxX || s < b.minY || s > b.maxY || this.city.mask.at(u, s)) return null;
    return cityDistrict(s, u);
  }
  draw(canvas, vehicle) {
    const width = canvas.clientWidth || canvas.width, { scale, height, toCanvas } = this.frame(width);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    const ctx = canvas.getContext('2d'), b = this.bounds, cache = this.cache;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#20383e'; ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(-b.minX * scale, b.maxY * scale); ctx.scale(scale, -scale);
    for (const [style, path] of this.tints) { ctx.fillStyle = DISTRICT_COLORS[style] ?? '#48626a'; ctx.fill(path); }
    // the lots a shade darker, so the blocks keep their grain
    ctx.fillStyle = '#10202614'; ctx.fill(cache.lots);
    ctx.fillStyle = '#4e705d'; ctx.fill(cache.parks);
    ctx.fillStyle = '#477e8b'; ctx.fill(cache.water, 'evenodd');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [key, path] of cache.roads) {
      if (key === 'path') continue;
      ctx.strokeStyle = '#2b3f47'; ctx.lineWidth = Math.max(key, 1.4 / scale); ctx.stroke(path);
    }
    ctx.restore();
    // Names, downtown's first; one that would overlap a name already drawn is
    // left out, as a small map runs out of room
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const small = width < 560, drawn = [];
    for (const label of [...this.labels].sort((a, b) => Number(Boolean(b.downtown)) - Number(Boolean(a.downtown)))) {
      const [x, y] = toCanvas(label.x, label.y), lines = label.downtown ? ['DOWNTOWN'] : label.name.toUpperCase().split(' ');
      ctx.font = `${label.downtown ? 800 : 700} ${label.downtown ? (small ? 11 : 14) : small ? 10 : 13}px 'Segoe UI', Arial, sans-serif`;
      const lineHeight = label.downtown ? 15 : small ? 11 : 14, top = y - (lines.length - 1) * lineHeight / 2;
      const half = Math.max(...lines.map(line => ctx.measureText(line).width)) / 2 + 2;
      const box = { left: x - half, right: x + half, top: top - lineHeight / 2, bottom: top + (lines.length - .5) * lineHeight };
      if (drawn.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
      drawn.push(box);
      lines.forEach((line, i) => {
        ctx.lineWidth = small ? 3 : 4; ctx.strokeStyle = '#17262fd9'; ctx.strokeText(line, x, top + i * lineHeight);
        ctx.fillStyle = label.downtown ? '#ffd238' : '#f5f4e9'; ctx.fillText(line, x, top + i * lineHeight);
      });
    }
    // The car: a white arrow pointing the way it faces (heading 0 is north)
    if (vehicle) {
      const [x, y] = toCanvas(vehicle.u, vehicle.s);
      ctx.save(); ctx.translate(x, y); ctx.rotate(vehicle.heading ?? 0);
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fillStyle = '#ffd23840'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath();
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#17262f'; ctx.lineWidth = 2; ctx.stroke(); ctx.fill();
      ctx.restore();
    }
  }
}
