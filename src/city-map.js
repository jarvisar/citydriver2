import { CITY } from './world/city.js';

// The local street map: the generated roads, water, parks and lots drawn
// from cached Path2D shapes in world coordinates, so each redraw is a few
// fills and strokes however far the car has come.
const WIDTHS = { main: 24, major: 18, coast: 18, riverbank: 16, minor: 12, path: 6 };
export class CityMapCache {
  constructor(city = CITY, makePath = () => new Path2D()) {
    this.city = city;
    this.water = makePath(); this.parks = makePath(); this.blocks = makePath(); this.lots = makePath();
    this.roads = Object.fromEntries(Object.keys(WIDTHS).map(kind => [kind, makePath()]));
    const polygon = (path, points) => { points.forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](p.x, p.y)); path.closePath(); };
    for (const piece of city.water) polygon(this.water, piece);
    for (const park of city.parks) polygon(this.parks, park);
    for (const block of city.blocks) if (block.sidewalk.length) polygon(this.blocks, block.sidewalk);
    for (const lot of city.lots) polygon(this.lots, lot);
    for (const road of city.roads) {
      const path = this.roads[road.kind] ?? this.roads.minor;
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
    ctx.fillStyle = '#477e8b'; ctx.fill(this.water);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [kind, path] of Object.entries(this.roads)) {
      ctx.strokeStyle = kind === 'path' ? '#5f7d63' : '#718e8d'; ctx.lineWidth = WIDTHS[kind]; ctx.stroke(path);
    }
    ctx.restore();
  }
}
