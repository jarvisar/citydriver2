// A cell hash of road segments answering "which road is nearest here?", the
// question the block setbacks, the car's tyres and the traffic all ask.
export class RoadIndex {
  constructor(roads, cellSize = 40) {
    this.roads = roads; this.cellSize = cellSize; this.cells = new Map(); this.segments = [];
    roads.forEach((road, roadIndex) => {
      const points = road.points;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length < 1e-9) continue;
        const segment = { road, roadIndex, index: i, ax: a.x, ay: a.y, bx: b.x, by: b.y, dx, dy, length };
        this.segments.push(segment);
        const x0 = Math.floor(Math.min(a.x, b.x) / cellSize), x1 = Math.floor(Math.max(a.x, b.x) / cellSize);
        const y0 = Math.floor(Math.min(a.y, b.y) / cellSize), y1 = Math.floor(Math.max(a.y, b.y) / cellSize);
        for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
          const key = `${cx},${cy}`;
          let cell = this.cells.get(key);
          if (!cell) { cell = []; this.cells.set(key, cell); }
          cell.push(segment);
        }
      }
    });
  }
  // Calls visit(segment, distance, t) for every segment within radius of the point
  each(x, y, radius, visit) {
    const x0 = Math.floor((x - radius) / this.cellSize), x1 = Math.floor((x + radius) / this.cellSize);
    const y0 = Math.floor((y - radius) / this.cellSize), y1 = Math.floor((y + radius) / this.cellSize);
    const seen = new Set();
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const cell = this.cells.get(`${cx},${cy}`);
      if (!cell) continue;
      for (const segment of cell) {
        if (seen.has(segment)) continue;
        seen.add(segment);
        let t = ((x - segment.ax) * segment.dx + (y - segment.ay) * segment.dy) / (segment.length * segment.length);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const distance = Math.hypot(x - segment.ax - segment.dx * t, y - segment.ay - segment.dy * t);
        if (distance <= radius) visit(segment, distance, t);
      }
    }
  }
  // The segment with the lowest score within radius; score defaults to the
  // distance, so roads of different widths can pass (distance - halfWidth).
  nearest(x, y, radius = 40, score = null) {
    let best = null, bestScore = Infinity;
    this.each(x, y, radius, (segment, distance, t) => {
      const value = score ? score(segment, distance, t) : distance;
      if (value < bestScore) { bestScore = value; best = { segment, distance, t, score: value }; }
    });
    if (!best) return null;
    const { segment, t } = best;
    return { ...best, road: segment.road, roadIndex: segment.roadIndex, x: segment.ax + segment.dx * t, y: segment.ay + segment.dy * t,
      tx: segment.dx / segment.length, ty: segment.dy / segment.length };
  }
}
