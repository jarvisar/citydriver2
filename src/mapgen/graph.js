import Vector from './vector.js';
import { segmentIntersection } from './polygon-util.js';

// Node at every intersection and every vertex of the simplified road
// polylines, with its neighbours along those polylines.
export class Node {
  constructor(value, id) { this.value = value; this.id = id; this.segments = new Set(); this.neighbors = new Set(); this.adj = []; }
  addSegment(segment) { this.segments.add(segment); }
  addNeighbor(node) {
    if (node === this) return;
    this.neighbors.add(node); node.neighbors.add(this);
  }
}

// A hash of cells holding nodes: what MapGenerator asked of d3-quadtree.
class PointIndex {
  constructor(cellSize) { this.cellSize = cellSize; this.cells = new Map(); this.items = new Set(); }
  key(x, y) { return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`; }
  add(node) {
    const key = this.key(node.value.x, node.value.y);
    let cell = this.cells.get(key);
    if (!cell) { cell = new Set(); this.cells.set(key, cell); }
    cell.add(node); this.items.add(node);
  }
  addAll(nodes) { for (const node of nodes) this.add(node); }
  remove(node) {
    this.cells.get(this.key(node.value.x, node.value.y))?.delete(node);
    this.items.delete(node);
  }
  // The nearest node within radius, or undefined
  find(x, y, radius) {
    const r2 = radius * radius;
    const x0 = Math.floor((x - radius) / this.cellSize), x1 = Math.floor((x + radius) / this.cellSize);
    const y0 = Math.floor((y - radius) / this.cellSize), y1 = Math.floor((y + radius) / this.cellSize);
    let best, bestDistance = Infinity;
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const cell = this.cells.get(`${cx},${cy}`);
      if (!cell) continue;
      for (const node of cell) {
        const d = (node.value.x - x) ** 2 + (node.value.y - y) ** 2;
        if (d <= r2 && d < bestDistance) { bestDistance = d; best = node; }
      }
    }
    return best;
  }
  data() { return Array.from(this.items); }
}

// Every crossing between two segments, found through a cell hash rather than
// a sweep. Segments that share a vertex object are consecutive pieces of one
// polyline and are skipped.
export function findIntersections(segments, cellSize = 40) {
  const cells = new Map();
  segments.forEach((segment, index) => {
    segment.index = index;
    const x0 = Math.floor(Math.min(segment.from.x, segment.to.x) / cellSize), x1 = Math.floor(Math.max(segment.from.x, segment.to.x) / cellSize);
    const y0 = Math.floor(Math.min(segment.from.y, segment.to.y) / cellSize), y1 = Math.floor(Math.max(segment.from.y, segment.to.y) / cellSize);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const key = `${cx},${cy}`;
      let cell = cells.get(key);
      if (!cell) { cell = []; cells.set(key, cell); }
      cell.push(segment);
    }
  });
  const seen = new Set(), out = [], count = segments.length;
  for (const cell of cells.values()) {
    for (let i = 0; i < cell.length; i++) for (let j = i + 1; j < cell.length; j++) {
      const a = cell[i], b = cell[j], key = a.index < b.index ? a.index * count + b.index : b.index * count + a.index;
      if (seen.has(key)) continue;
      seen.add(key);
      if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
      const point = segmentIntersection(a.from, a.to, b.from, b.to, 1e-9);
      if (point) out.push({ point, segments: [a, b] });
    }
  }
  return out;
}

export default class Graph {
  // Builds a graph from streamlines: finds every intersection and links the
  // nodes in order along each polyline. edgeRoads maps "a:b" node ids to the
  // index of the streamline that joins them.
  constructor(streamlines, dstep, deleteDangling = false) {
    let nextId = 0;
    const segmentsOf = streamlines.map((streamline, road) => {
      const segments = [];
      for (let i = 0; i < streamline.length - 1; i++) segments.push({ from: streamline[i], to: streamline[i + 1], road });
      return segments;
    });
    const intersections = findIntersections(segmentsOf.flat());
    const index = new PointIndex(Math.max(4, dstep)), nodeAddRadius = .001;
    const fuzzyAdd = node => {
      // Only add if there isn't a node within radius; merge into it otherwise
      const existing = index.find(node.value.x, node.value.y, nodeAddRadius);
      if (existing === undefined) { node.id = nextId++; index.add(node); return; }
      for (const neighbor of node.neighbors) existing.addNeighbor(neighbor);
      for (const segment of node.segments) existing.addSegment(segment);
    };
    // Add all segment start and endpoints
    streamlines.forEach((streamline, road) => {
      const segments = segmentsOf[road];
      for (let i = 0; i < streamline.length; i++) {
        const node = new Node(streamline[i]);
        if (i > 0) node.addSegment(segments[i - 1]);
        if (i < streamline.length - 1) node.addSegment(segments[i]);
        fuzzyAdd(node);
      }
    });
    // Add all intersections
    for (const intersection of intersections) {
      const node = new Node(new Vector(intersection.point.x, intersection.point.y));
      for (const s of intersection.segments) node.addSegment(s);
      fuzzyAdd(node);
    }
    // For each simplified streamline, link the nodes in order along it
    this.edgeRoads = new Map();
    streamlines.forEach((streamline, road) => {
      for (const segment of segmentsOf[road]) {
        const nodes = this.nodesAlongSegment(segment, index, nodeAddRadius, dstep);
        for (let j = 0; j < nodes.length - 1; j++) {
          nodes[j].addNeighbor(nodes[j + 1]);
          this.edgeRoads.set(Graph.edgeKey(nodes[j], nodes[j + 1]), road);
        }
      }
    });
    if (deleteDangling) for (const n of index.data()) this.deleteDanglingNodes(n, index);
    this.nodes = index.data();
    this.restoreAdjacency();
    this.intersections = intersections.map(i => new Vector(i.point.x, i.point.y));
  }
  static edgeKey(a, b) { return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`; }
  // Polygon finding consumes adjacency; call this to walk the graph again
  restoreAdjacency() { for (const n of this.nodes) n.adj = Array.from(n.neighbors); }
  // Remove dead ends so polygon finding is not confused by them
  deleteDanglingNodes(n, index) {
    if (n.neighbors.size !== 1) return;
    index.remove(n);
    for (const neighbor of n.neighbors) {
      neighbor.neighbors.delete(n);
      this.deleteDanglingNodes(neighbor, index);
    }
  }
  // Walk along a segment and collect, in order, every node that lies on it
  nodesAlongSegment(segment, index, radius, step) {
    const start = segment.from, end = segment.to, difference = end.clone().sub(start), length = difference.length();
    if (length < 1e-9) return [];
    step = Math.min(step, length / 2);  // At least two steps along the segment
    const steps = Math.ceil(length / step), found = [], along = [];
    for (let i = 0; i <= steps; i++) {
      const x = start.x + difference.x * i / steps, y = start.y + difference.y * i / steps, toAdd = [];
      let closest = index.find(x, y, radius + step / 2);
      while (closest !== undefined) {
        index.remove(closest); found.push(closest);
        if (closest.segments.has(segment)) toAdd.push(closest);
        closest = index.find(x, y, radius + step / 2);
      }
      // Order by progress along the segment, not by closeness to the step point
      toAdd.sort((a, b) => (a.value.x - start.x) * difference.x + (a.value.y - start.y) * difference.y
        - (b.value.x - start.x) * difference.x - (b.value.y - start.y) * difference.y);
      along.push(...toAdd);
    }
    index.addAll(found);
    return along;
  }
}
