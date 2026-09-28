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

// How far a run of shapes may spread, in metres, and how far past the view a
// shape still counts as in it (a few pixels, for its anti-aliased edge)
const RUN = 100, EDGE = 12;

// The local street map: the generated roads, water, parks and lots drawn
// from cached Path2D shapes in world coordinates. A venue with a block to
// itself shows as its grounds rather than the block's lots.
// The street map shows only ~350 m round the car, so the shapes are also kept
// in runs of neighbours, in their original order, each with its bounding box.
// A draw fills only the runs in view, joined into one path, and joins them
// again only when a run comes into view or leaves it. A shape out of view
// adds no winding inside it, so the result matches filling the whole city,
// except that Skia picks its anti-aliasing from the whole path: a few edge
// pixels come out a level or two different (about .03% at 2x). That cut a
// draw's raster from ~2.1 ms to ~1.3 ms.
// The whole-city paths (`water`, `parks`, `blocks`, `lots`, `roads`), which
// the city map draws, are built the first time they are asked for.
export class CityMapCache {
  constructor(city = CITY, makePath = () => new Path2D()) {
    this.city = city; this.makePath = makePath;
    const shapes = this.shapes = { water: [], parks: [], blocks: [], lots: [] };
    // The sea round the island has the island as a hole: filled even-odd
    for (const piece of [...city.seaWater, ...city.riverWater]) for (const ring of [piece.outer, ...piece.holes]) shapes.water.push(ring);
    for (const park of city.parks) shapes.parks.push(park);
    for (const block of city.blocks) if (block.sidewalk.length) shapes.blocks.push(block.sidewalk);
    const grounds = new Set();
    city.blocks.forEach((block, index) => { if (city === CITY && placeForBlock(index)) { grounds.add(index); shapes.parks.push(block.inner); } });
    city.lots.forEach((lot, index) => { if (!grounds.has(city.lotBlocks?.[index])) shapes.lots.push(lot); });
    // and a planted island as green
    if (city === CITY) for (const island of cityIslands()) shapes.parks.push(island.lawn);
    // One line per stroke: park walks, and the streets by their width
    this.lines = new Map();
    for (const road of city.roads) {
      const key = road.kind === 'path' ? 'path' : road.profile.halfWidth * 2;
      if (!this.lines.has(key)) this.lines.set(key, []);
      this.lines.get(key).push(road.points);
    }
    this.runs = Object.fromEntries(Object.entries(shapes).map(([layer, list]) => [layer, this.cut(list, 0, true)]));
    // A stroke's run reaches half the line width past its points
    this.strokes = new Map([...this.lines].map(([key, lines]) => [key, this.cut(lines, (key === 'path' ? 6 : key) / 2, false)]));
    this.showing = new Map();
  }
  // Consecutive shapes grouped while their box stays within RUN each way. A
  // bigger shape gets a run of its own.
  cut(list, reach, closed) {
    const runs = [];
    let run = null;
    for (const points of list) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of points) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
      const joined = run && Math.max(maxX, run.maxX) - Math.min(minX, run.minX) <= RUN && Math.max(maxY, run.maxY) - Math.min(minY, run.minY) <= RUN;
      if (!joined) { run = { minX, minY, maxX, maxY, path: this.makePath() }; runs.push(run); }
      else { run.minX = Math.min(run.minX, minX); run.minY = Math.min(run.minY, minY); run.maxX = Math.max(run.maxX, maxX); run.maxY = Math.max(run.maxY, maxY); }
      points.forEach((p, i) => run.path[i ? 'lineTo' : 'moveTo'](p.x, p.y));
      if (closed) run.path.closePath();
    }
    for (const run of runs) { run.minX -= reach; run.minY -= reach; run.maxX += reach; run.maxY += reach; }
    return runs;
  }
  // The runs touching the box, joined into one path. The last path made for
  // each layer is kept while the same runs are in view.
  within(name, runs, minX, minY, maxX, maxY) {
    const showing = this.showing.get(name);
    let count = 0, same = Boolean(showing);
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (run.minX > maxX || run.maxX < minX || run.minY > maxY || run.maxY < minY) continue;
      if (same && showing.runs[count] !== i) same = false;
      count++;
    }
    if (same && showing.runs.length === count) return showing.path;
    const path = this.makePath(), included = [];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (run.minX > maxX || run.maxX < minX || run.minY > maxY || run.maxY < minY) continue;
      path.addPath(run.path); included.push(i);
    }
    this.showing.set(name, { runs: included, path });
    return path;
  }
  whole(list, closed) {
    const path = this.makePath();
    for (const points of list) { points.forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](p.x, p.y)); if (closed) path.closePath(); }
    return path;
  }
  get water() { return this.#water ??= this.whole(this.shapes.water, true); }
  get parks() { return this.#parks ??= this.whole(this.shapes.parks, true); }
  get blocks() { return this.#blocks ??= this.whole(this.shapes.blocks, true); }
  get lots() { return this.#lots ??= this.whole(this.shapes.lots, true); }
  get roads() { return this.#roads ??= new Map([...this.lines].map(([key, lines]) => [key, this.whole(lines, false)])); }
  #water = null; #parks = null; #blocks = null; #lots = null; #roads = null;
  draw(ctx, vehicle, scale, width, height) {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-(vehicle.heading ?? 0));
    ctx.scale(scale, -scale);
    ctx.translate(-vehicle.u, -vehicle.s);
    // Whatever the heading, the view lies within this far of the car
    const reach = Math.hypot(width, height) / 2 / scale + EDGE;
    const minX = vehicle.u - reach, maxX = vehicle.u + reach, minY = vehicle.s - reach, maxY = vehicle.s + reach;
    const view = (name, runs) => this.within(name, runs, minX, minY, maxX, maxY);
    ctx.fillStyle = '#3a5155'; ctx.fill(view('blocks', this.runs.blocks));
    ctx.fillStyle = '#48626a'; ctx.fill(view('lots', this.runs.lots));
    ctx.fillStyle = '#4e705d'; ctx.fill(view('parks', this.runs.parks));
    ctx.fillStyle = '#477e8b'; ctx.fill(view('water', this.runs.water), 'evenodd');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [key, runs] of this.strokes) {
      ctx.strokeStyle = key === 'path' ? '#5f7d63' : '#718e8d'; ctx.lineWidth = key === 'path' ? 6 : key; ctx.stroke(view(key, runs));
    }
    ctx.restore();
  }
}
