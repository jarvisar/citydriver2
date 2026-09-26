// A cell hash of road segments answering "which road is nearest here?", the
// question the block setbacks, the car's tyres and the traffic all ask.
// (Cells are keyed by number, within a million cells of the origin, and hold
// segment numbers; a query marks the segments it has seen with a stamp rather
// than a set, one row of stamps for each query running inside another's
// visit, and passes over a segment whose bounds lie beyond its reach.)
const cellKey = (cx, cy) => cx * 0x200000 + cy;
export class RoadIndex {
  #cells = new Map(); #bounds = []; #seen = []; #stamps = []; #depth = 0;
  constructor(roads, cellSize = 40) {
    this.roads = roads; this.cellSize = cellSize; this.segments = [];
    roads.forEach((road, roadIndex) => {
      const points = road.points;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length < 1e-9) continue;
        const id = this.segments.push({ road, roadIndex, index: i, ax: a.x, ay: a.y, bx: b.x, by: b.y, dx, dy, length }) - 1;
        this.#bounds.push(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
        const x0 = Math.floor(Math.min(a.x, b.x) / cellSize), x1 = Math.floor(Math.max(a.x, b.x) / cellSize);
        const y0 = Math.floor(Math.min(a.y, b.y) / cellSize), y1 = Math.floor(Math.max(a.y, b.y) / cellSize);
        for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
          const key = cellKey(cx, cy);
          let cell = this.#cells.get(key);
          if (!cell) { cell = []; this.#cells.set(key, cell); }
          cell.push(id);
        }
      }
    });
  }
  // Calls visit(segment, distance, t) for every segment within radius of the point
  each(x, y, radius, visit) {
    const x0 = Math.floor((x - radius) / this.cellSize), x1 = Math.floor((x + radius) / this.cellSize);
    const y0 = Math.floor((y - radius) / this.cellSize), y1 = Math.floor((y + radius) / this.cellSize);
    const depth = this.#depth++, segments = this.segments, bounds = this.#bounds, seen = this.#seen[depth] ??= new Uint32Array(segments.length);
    // (a micrometre beyond the radius, so no rounding in the distance can
    // bring a segment passed over back within it)
    const reach = radius + 1e-6;
    let stamp = this.#stamps[depth] = (this.#stamps[depth] ?? 0) + 1;
    if (stamp === 0xffffffff) { seen.fill(0); stamp = this.#stamps[depth] = 1; }
    try {
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const cell = this.#cells.get(cellKey(cx, cy));
        if (!cell) continue;
        for (let k = 0; k < cell.length; k++) {
          const id = cell[k];
          if (seen[id] === stamp) continue;
          seen[id] = stamp;
          const b = id * 4;
          if (bounds[b] - x > reach || x - bounds[b + 2] > reach || bounds[b + 1] - y > reach || y - bounds[b + 3] > reach) continue;
          const segment = segments[id];
          let t = ((x - segment.ax) * segment.dx + (y - segment.ay) * segment.dy) / (segment.length * segment.length);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const distance = Math.hypot(x - segment.ax - segment.dx * t, y - segment.ay - segment.dy * t);
          if (distance <= radius) visit(segment, distance, t);
        }
      }
    } finally { this.#depth--; }
  }
  // The segment with the lowest score within radius; score defaults to the
  // distance, so roads of different widths can pass (distance - halfWidth).
  // score(segment, distance, t, x, y) also gets the point asked about.
  nearest(x, y, radius = 40, score = null) {
    let best = null, bestScore = Infinity;
    this.each(x, y, radius, (segment, distance, t) => {
      const value = score ? score(segment, distance, t, x, y) : distance;
      if (value < bestScore) { bestScore = value; best = { segment, distance, t, score: value }; }
    });
    if (!best) return null;
    const { segment, t } = best;
    return { ...best, road: segment.road, roadIndex: segment.roadIndex, x: segment.ax + segment.dx * t, y: segment.ay + segment.dy * t,
      tx: segment.dx / segment.length, ty: segment.dy / segment.length };
  }
}
