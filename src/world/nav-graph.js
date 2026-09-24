import { CITY, profileOf } from './city.js';
import { RoadIndex } from '../mapgen/road-index.js';

// The streets as a graph the traffic, autodrive and taxi can navigate: nodes
// at junctions and dead ends, edges along the road between them, with the
// road's polyline, class and profile. Built from the generator's node graph.
const STUB = 14;  // Dead ends shorter than this are the overshoot past a T-junction
const JOIN = 5;   // Junctions closer than this along a street are one junction

export class NavGraph {
  constructor(city = CITY) {
    const raw = city.nav;
    this.nodes = []; this.edges = [];
    const nodeIds = new Map();
    const junction = i => {
      if (!nodeIds.has(i)) { nodeIds.set(i, this.nodes.length); this.nodes.push({ id: this.nodes.length, x: raw[i].x, y: raw[i].y, edges: [] }); }
      return nodeIds.get(i);
    };
    const isJunction = i => raw[i].adj.length !== 2;
    const seen = new Set(), key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    const walk = (start, first, road) => {
      let previous = start, current = first;
      const points = [raw[start]];
      seen.add(key(previous, current));
      for (let guard = 0; guard < raw.length; guard++) {
        if (isJunction(current) || current === start) break;
        points.push(raw[current]);
        const next = raw[current].adj[0] === previous ? raw[current].adj[1] : raw[current].adj[0];
        seen.add(key(current, next)); previous = current; current = next;
      }
      points.push(raw[current]);
      this.addEdge(junction(start), junction(current), points, road);
    };
    for (let i = 0; i < raw.length; i++) {
      if (!isJunction(i)) continue;
      for (let k = 0; k < raw[i].adj.length; k++) if (!seen.has(key(i, raw[i].adj[k]))) walk(i, raw[i].adj[k], raw[i].roads[k]);
    }
    // Closed loops with no junction on them
    for (let i = 0; i < raw.length; i++) if (!isJunction(i) && !seen.has(key(i, raw[i].adj[0]))) walk(i, raw[i].adj[0], raw[i].roads[0]);
    this.pruneStubs();
    this.joinCloseJunctions();
    // Joining junctions can leave a stub of its own
    this.pruneStubs();
    this.index = new RoadIndex(this.edges.map(edge => ({ points: edge.points.map(p => ({ x: p.x, y: p.y })), edge, profile: edge.profile })), 48);
  }
  addEdge(a, b, points, roadIndex) {
    const road = CITY.roads[roadIndex] ?? null, kind = road?.kind ?? 'minor';
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const edge = { id: this.edges.length, a, b, points: points.map(p => ({ x: p.x, y: p.y })), cumulative, length: cumulative[cumulative.length - 1], kind, profile: profileOf(kind), roadIndex };
    if (edge.length < 1e-6) return;
    this.edges.push(edge); this.nodes[a].edges.push(edge); if (b !== a) this.nodes[b].edges.push(edge);
  }
  pruneStubs() {
    for (const edge of this.edges.slice()) {
      const dead = this.nodes[edge.a].edges.length === 1 || this.nodes[edge.b].edges.length === 1;
      if (!dead || edge.length >= STUB || edge.a === edge.b) continue;
      for (const id of [edge.a, edge.b]) this.nodes[id].edges = this.nodes[id].edges.filter(e => e !== edge);
      edge.pruned = true;
    }
    this.edges = this.edges.filter(edge => !edge.pruned);
    this.edges.forEach((edge, id) => { edge.id = id; });
  }
  // Two roads crossing a third a couple of metres apart make two junctions
  // joined by a sliver of street no car could turn through: they are one
  // junction, at the middle of the sliver.
  joinCloseJunctions() {
    const remeasure = edge => {
      edge.cumulative = [0];
      for (let i = 1; i < edge.points.length; i++) edge.cumulative.push(edge.cumulative[i - 1] + Math.hypot(edge.points[i].x - edge.points[i - 1].x, edge.points[i].y - edge.points[i - 1].y));
      edge.length = edge.cumulative[edge.cumulative.length - 1];
    };
    for (const edge of this.edges.slice().sort((p, q) => p.length - q.length)) {
      if (edge.pruned || edge.length >= JOIN || edge.a === edge.b) continue;
      const keep = this.nodes[edge.a], gone = this.nodes[edge.b];
      const x = (keep.x + gone.x) / 2, y = (keep.y + gone.y) / 2;
      edge.pruned = true;
      keep.edges = keep.edges.filter(e => e !== edge); gone.edges = gone.edges.filter(e => e !== edge);
      for (const other of gone.edges) {
        if (other.a === gone.id) other.a = keep.id;
        if (other.b === gone.id) other.b = keep.id;
        keep.edges.push(other);
      }
      gone.edges = [];
      keep.x = x; keep.y = y;
      // Every street meeting the junction now starts or ends at its new middle
      for (const other of keep.edges) {
        if (other.a === keep.id) other.points[0] = { x, y };
        if (other.b === keep.id) other.points[other.points.length - 1] = { x, y };
        remeasure(other);
        if (other.a === other.b && other.length < JOIN * 2) { other.pruned = true; keep.edges = keep.edges.filter(e => e !== other); }
      }
    }
    this.edges = this.edges.filter(edge => !edge.pruned);
    this.edges.forEach((edge, id) => { edge.id = id; });
  }
  // Direction +1 runs from node a to node b. `along` is measured from the
  // start of travel; `lane` offsets to the right of travel.
  pose(edge, along, direction = 1, lane = 0) {
    const distance = direction > 0 ? along : edge.length - along, points = edge.points, cumulative = edge.cumulative;
    let i = 0, hi = points.length - 2;
    const clamped = Math.max(0, Math.min(edge.length, distance));
    while (i < hi) { const mid = (i + hi + 1) >> 1; if (cumulative[mid] <= clamped) i = mid; else hi = mid - 1; }
    const a = points[i], b = points[i + 1], span = cumulative[i + 1] - cumulative[i] || 1;
    const t = Math.max(0, Math.min(1, (clamped - cumulative[i]) / span));
    let tx = (b.x - a.x) / span, ty = (b.y - a.y) / span;
    // Blend toward the neighbouring segment over each half, so the heading and
    // the lane beside the centre line turn smoothly through every vertex
    const neighbour = t > .5 ? i + 1 : i - 1, weight = Math.abs(t - .5);
    if (neighbour >= 0 && neighbour < points.length - 1) {
      const p = points[neighbour], q = points[neighbour + 1], length = cumulative[neighbour + 1] - cumulative[neighbour] || 1;
      tx = tx * (1 - weight) + (q.x - p.x) / length * weight; ty = ty * (1 - weight) + (q.y - p.y) / length * weight;
      const norm = Math.hypot(tx, ty) || 1; tx /= norm; ty /= norm;
    }
    if (direction < 0) { tx = -tx; ty = -ty; }
    const x = a.x + (b.x - a.x) * t + ty * lane, y = a.y + (b.y - a.y) * t - tx * lane;
    return { s: y, u: x, heading: Math.atan2(tx, ty), tx, ty, segment: i };
  }
  // The edge nearest a point and how far along it the point projects
  nearest(s, u, radius = 40) {
    const hit = this.index.nearest(u, s, radius);
    if (!hit) return null;
    const edge = hit.road.edge, along = edge.cumulative[hit.segment.index] + hit.t * hit.segment.length;
    return { edge, along, distance: hit.distance, x: hit.x, y: hit.y, tx: hit.tx, ty: hit.ty };
  }
  // The node at the end of travel and the edges leaving it
  endNode(edge, direction) { return this.nodes[direction > 0 ? edge.b : edge.a]; }
  // How to enter `next` from `node`: +1 when the node is its start
  directionFrom(next, node) { return next.a === node.id ? 1 : -1; }
  // Choices at the end of an edge, ranked by how straight they continue
  choices(edge, direction) {
    const node = this.endNode(edge, direction), end = this.pose(edge, edge.length, direction);
    const out = [];
    for (const next of node.edges) {
      if (next === edge && node.edges.length > 1) continue;
      const nextDirection = this.directionFrom(next, node), start = this.pose(next, 0, nextDirection);
      const turn = Math.atan2(Math.sin(start.heading - end.heading), Math.cos(start.heading - end.heading));
      out.push({ edge: next, direction: nextDirection, turn });
    }
    return out.sort((p, q) => Math.abs(p.turn) - Math.abs(q.turn));
  }
  // Shortest drive between two points, as a polyline of {s, u} through the
  // streets, by Dijkstra over the junction nodes.
  route(from, to) {
    const a = this.nearest(from.s, from.u, 120), b = this.nearest(to.s, to.u, 120);
    if (!a || !b) return [{ s: from.s, u: from.u }, { s: to.s, u: to.u }];
    const trace = (edge, start, end) => {
      // points between two distances along the edge, in order of travel
      const out = [], low = Math.min(start, end), high = Math.max(start, end);
      out.push(this.pose(edge, low, 1));
      for (let i = 0; i < edge.points.length; i++) if (edge.cumulative[i] > low && edge.cumulative[i] < high) out.push({ s: edge.points[i].y, u: edge.points[i].x });
      out.push(this.pose(edge, high, 1));
      return (start <= end ? out : out.reverse()).map(p => ({ s: p.s, u: p.u }));
    };
    if (a.edge === b.edge) return [{ s: from.s, u: from.u }, ...trace(a.edge, a.along, b.along), { s: to.s, u: to.u }];
    const distance = new Map(), previous = new Map(), done = new Set();
    const queue = [];
    const push = (node, cost, via) => { if (cost < (distance.get(node) ?? Infinity)) { distance.set(node, cost); previous.set(node, via); queue.push({ node, cost }); } };
    push(a.edge.a, a.along, { edge: a.edge, from: null, start: a.along });
    push(a.edge.b, a.edge.length - a.along, { edge: a.edge, from: null, start: a.along });
    const targets = new Map([[b.edge.a, b.along], [b.edge.b, b.edge.length - b.along]]);
    let best = null;
    while (queue.length) {
      let index = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[index].cost) index = i;
      const { node, cost } = queue.splice(index, 1)[0];
      if (done.has(node)) continue;
      done.add(node);
      if (targets.has(node)) {
        const total = cost + targets.get(node);
        if (!best || total < best.total) best = { node, total };
        if (best && cost > best.total) break;
      }
      for (const edge of this.nodes[node].edges) {
        const other = edge.a === node ? edge.b : edge.a;
        if (!done.has(other)) push(other, cost + edge.length, { edge, from: node });
      }
    }
    if (!best) return [{ s: from.s, u: from.u }, { s: to.s, u: to.u }];
    // Walk back from the best node to the first edge
    const legs = [];
    let node = best.node;
    while (node !== undefined) {
      const via = previous.get(node);
      if (!via) break;
      if (via.from === null) { legs.push(trace(via.edge, via.start, via.edge.a === node ? 0 : via.edge.length)); break; }
      legs.push(trace(via.edge, via.edge.a === via.from ? 0 : via.edge.length, via.edge.a === node ? 0 : via.edge.length));
      node = via.from;
    }
    legs.reverse();
    const last = trace(b.edge, b.edge.a === best.node ? 0 : b.edge.length, b.along);
    return [{ s: from.s, u: from.u }, ...legs.flat(), ...last, { s: to.s, u: to.u }];
  }
}

let shared = null;
export function navGraph() { return shared ??= new NavGraph(CITY); }
export function routeDistance(points) {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.s - points[i].s, p.u - points[i].u), 0);
}
