import { CITY } from './world/city.js';

// The local street map: the generated roads, water, parks and lots drawn
// from cached Path2D shapes in world coordinates, so each redraw is a few
// fills and strokes however far the car has come.
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
    for (const lot of city.lots) polygon(this.lots, lot);
    for (const road of city.roads) {
      const key = road.kind === 'path' ? 'path' : road.profile.halfWidth * 2;
      if (!this.roads.has(key)) this.roads.set(key, makePath());
      const path = this.roads.get(key);
      road.points.forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](p.x, p.y));
    }
  }
  update() { /* the whole city is cached once */ }
  draw(ctx, vehicle, scale, width, height) {
    ctx.save();
    ctx.translate(width / 2 - vehicle.u * scale, height / 2 + vehicle.s * scale);
    ctx.scale(scale, -scale);
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
