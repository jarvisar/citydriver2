import { CITY } from './world/city.js';
import { placeForBlock } from './city-exploration.js';
import { cityIslands } from './world/city-islands.js';

// The car the player left parked (see OnFoot), on either map: a car in a
// ring of free drive's teal, `radius` pixels across, at (x, y)
export function drawParkedCar(ctx, x, y, radius = 6.5) {
  const k = radius / 6.5;
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fillStyle = '#17262f'; ctx.fill();
  ctx.lineWidth = 1.8 * k; ctx.strokeStyle = '#5fd0c0'; ctx.stroke();
  ctx.fillStyle = '#f5f4e9';
  ctx.fillRect(-3.6 * k, -.5 * k, 7.2 * k, 2.3 * k); ctx.fillRect(-2 * k, -2.5 * k, 4 * k, 2.2 * k);
  ctx.fillStyle = '#17262f';
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(side * 2 * k, 1.9 * k, .95 * k, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// The local street map: the generated roads, water, parks and lots drawn
// from cached Path2D shapes in world coordinates, so each redraw is a few
// fills and strokes however far the car has come. A venue with a block to
// itself shows as its grounds rather than the block's lots.
export class CityMapCache {
  constructor(city = CITY, makePath = () => new Path2D()) {
    this.city = city;
    this.water = makePath(); this.parks = makePath(); this.blocks = makePath(); this.lots = makePath();
    // One path per stroke: park walks, and the streets by their width
    this.roads = new Map();
    const polygon = (path, points) => { points.forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](p.x, p.y)); path.closePath(); };
    // The sea round the island has the island as a hole: filled even-odd
    for (const piece of [...city.seaWater, ...city.riverWater]) for (const ring of [piece.outer, ...piece.holes]) polygon(this.water, ring);
    for (const park of city.parks) polygon(this.parks, park);
    for (const block of city.blocks) if (block.sidewalk.length) polygon(this.blocks, block.sidewalk);
    const grounds = new Set();
    city.blocks.forEach((block, index) => { if (city === CITY && placeForBlock(index)) { grounds.add(index); polygon(this.parks, block.inner); } });
    city.lots.forEach((lot, index) => { if (!grounds.has(city.lotBlocks?.[index])) polygon(this.lots, lot); });
    // and a planted island as green
    if (city === CITY) for (const island of cityIslands()) polygon(this.parks, island.lawn);
    for (const road of city.roads) {
      const key = road.kind === 'path' ? 'path' : road.profile.halfWidth * 2;
      if (!this.roads.has(key)) this.roads.set(key, makePath());
      const path = this.roads.get(key);
      road.points.forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](p.x, p.y));
    }
  }
  draw(ctx, vehicle, scale, width, height) {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-(vehicle.heading ?? 0));
    ctx.scale(scale, -scale);
    ctx.translate(-vehicle.u, -vehicle.s);
    ctx.fillStyle = '#3a5155'; ctx.fill(this.blocks);
    ctx.fillStyle = '#48626a'; ctx.fill(this.lots);
    ctx.fillStyle = '#4e705d'; ctx.fill(this.parks);
    ctx.fillStyle = '#477e8b'; ctx.fill(this.water, 'evenodd');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [key, path] of this.roads) {
      ctx.strokeStyle = key === 'path' ? '#5f7d63' : '#718e8d'; ctx.lineWidth = key === 'path' ? 6 : key; ctx.stroke(path);
    }
    ctx.restore();
  }
}
