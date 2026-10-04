import { CITY, profileOf } from './city.js';
import { RoadIndex } from '../mapgen/road-index.js';

// The streets as a graph the traffic, autodrive and taxi can navigate: nodes
// at junctions and dead ends, edges along the road between them, with the
// road's polyline, class and profile. Built from the generator's node graph.
const STUB = 14;  // Dead ends shorter than this are the overshoot past a T-junction
const SHORT_PIECE = 20;  // A piece of street shorter than this goes with the street it carries on as
const JOIN = 5;   // Junctions closer than this along a street are one junction
const TANGENT = 1.5;  // Half the stretch of center line a heading is taken across

// The point `distance` along a polyline with cumulative lengths
function pointAlong(points, cumulative, distance) {
  let i = 0, hi = points.length - 2;
  while (i < hi) { const mid = (i + hi + 1) >> 1; if (cumulative[mid] <= distance) i = mid; else hi = mid - 1; }
  const a = points[i], b = points[i + 1], t = Math.max(0, Math.min(1, (distance - cumulative[i]) / (cumulative[i + 1] - cumulative[i] || 1)));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function remeasure(edge) {
  edge.cumulative = [0];
  for (let i = 1; i < edge.points.length; i++) edge.cumulative.push(edge.cumulative[i - 1] + Math.hypot(edge.points[i].x - edge.points[i - 1].x, edge.points[i].y - edge.points[i - 1].y));
  edge.length = edge.cumulative[edge.cumulative.length - 1];
}

export class NavGraph {
  constructor(city = CITY) {
    const raw = city.nav;
    this.nodes = []; this.edges = [];
    const nodeIds = new Map();
    const junction = i => {
      if (!nodeIds.has(i)) { nodeIds.set(i, this.nodes.length); this.nodes.push({ id: this.nodes.length, x: raw[i].x, y: raw[i].y, edges: [] }); }
      return nodeIds.get(i);
    };
    // A street ends where another carries on from it with a different profile
    // (an avenue into a boulevard), so each edge is marked as its own road
    const roadProfile = r => CITY.roads[r]?.profile ?? null;
    const isJunction = i => raw[i].adj.length !== 2 || roadProfile(raw[i].roads[0]) !== roadProfile(raw[i].roads[1]);
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
    this.mergeThrough();
    this.index = new RoadIndex(this.edges.map(edge => ({ points: edge.points.map(p => ({ x: p.x, y: p.y })), edge, profile: edge.profile })), 48);
    this.endpoints = new Map();
  }
  addEdge(a, b, points, roadIndex) {
    const road = CITY.roads[roadIndex] ?? null, kind = road?.kind ?? 'minor';
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const edge = { id: this.edges.length, a, b, points: points.map(p => ({ x: p.x, y: p.y })), cumulative, length: cumulative[cumulative.length - 1], kind, profile: road?.profile ?? profileOf(kind), roadIndex };
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
  // Two streets of a kind meeting end to end with nothing else there are one
  // street: split, the piece nearer a junction could leave a car no room to
  // turn. So is a street carried a few meters past a junction before it
  // hands over to another no wider (the ring road into the coast road, say):
  // the few meters go with the street beyond.
  mergeThrough() {
    for (const node of this.nodes) {
      if (node.edges.length !== 2) continue;
      const [first, second] = node.edges;
      if (first === second || first.a === first.b || second.a === second.b) continue;
      const alike = first.kind === second.kind && first.profile === second.profile;
      // (and no wider than the piece, whose markings it takes over)
      const [short, long] = first.length < second.length ? [first, second] : [second, first];
      if (!alike && (short.length >= SHORT_PIECE || long.profile.halfWidth > short.profile.halfWidth + .01)) continue;
      const into = first.b === node.id ? first.points : first.points.slice().reverse(), from = first.b === node.id ? first.a : first.b;
      const out = second.a === node.id ? second.points : second.points.slice().reverse(), to = second.a === node.id ? second.b : second.a;
      if (from === to) continue;
      // (the merged street is the longer piece's kind)
      if (!alike && long === second) { first.kind = second.kind; first.profile = second.profile; first.roadIndex = second.roadIndex; }
      first.a = from; first.b = to; first.points = [...into, ...out.slice(1)];
      remeasure(first);
      second.pruned = true; node.edges = [];
      this.nodes[to].edges = this.nodes[to].edges.map(edge => edge === second ? first : edge);
    }
    this.edges = this.edges.filter(edge => !edge.pruned);
    this.edges.forEach((edge, id) => { edge.id = id; });
  }
  // Two roads crossing a third a couple of meters apart make two junctions
  // joined by a sliver of street no car could turn through: they are one
  // junction, at the middle of the sliver.
  joinCloseJunctions() {
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
    // The heading is the chord across a few meters of the center line, so the
    // heading and the lane beside it turn smoothly through every vertex
    // however short the segments round it
    const behind = pointAlong(points, cumulative, Math.max(0, clamped - TANGENT)), ahead = pointAlong(points, cumulative, Math.min(edge.length, clamped + TANGENT));
    let tx = ahead.x - behind.x, ty = ahead.y - behind.y;
    const norm = Math.hypot(tx, ty);
    if (norm > 1e-9) { tx /= norm; ty /= norm; } else { tx = (b.x - a.x) / span; ty = (b.y - a.y) / span; }
    if (direction < 0) { tx = -tx; ty = -ty; }
    const x = a.x + (b.x - a.x) * t + ty * lane, y = a.y + (b.y - a.y) * t - tx * lane;
    return { s: y, u: x, heading: Math.atan2(tx, ty), tx, ty, segment: i };
  }
  // pose written into `out` without allocating, for the traffic's per-step
  // use. Same sums as pose, bit for bit (tests/fast-paths.test.js). With
  // `heading` false the atan2 is skipped and out.heading is left alone.
  poseInto(out, edge, along, direction = 1, lane = 0, heading = true) {
    const distance = direction > 0 ? along : edge.length - along, points = edge.points, cumulative = edge.cumulative, last = points.length - 2;
    let i = 0, hi = last;
    const clamped = Math.max(0, Math.min(edge.length, distance));
    while (i < hi) { const mid = (i + hi + 1) >> 1; if (cumulative[mid] <= clamped) i = mid; else hi = mid - 1; }
    const a = points[i], b = points[i + 1], span = cumulative[i + 1] - cumulative[i] || 1;
    const t = Math.max(0, Math.min(1, (clamped - cumulative[i]) / span));
    // pointAlong's segments for the chord ends, stepped to from i since the lengths only grow
    const back = Math.max(0, clamped - TANGENT), on = Math.min(edge.length, clamped + TANGENT);
    let j = i, k = i;
    while (j > 0 && !(cumulative[j] <= back)) j--;
    while (k < last && cumulative[k + 1] <= on) k++;
    const tb = Math.max(0, Math.min(1, (back - cumulative[j]) / (cumulative[j + 1] - cumulative[j] || 1))), ta = Math.max(0, Math.min(1, (on - cumulative[k]) / (cumulative[k + 1] - cumulative[k] || 1)));
    const p = points[j], q = points[j + 1], r = points[k], w = points[k + 1];
    let tx = (r.x + (w.x - r.x) * ta) - (p.x + (q.x - p.x) * tb), ty = (r.y + (w.y - r.y) * ta) - (p.y + (q.y - p.y) * tb);
    const norm = Math.hypot(tx, ty);
    if (norm > 1e-9) { tx /= norm; ty /= norm; } else { tx = (b.x - a.x) / span; ty = (b.y - a.y) / span; }
    if (direction < 0) { tx = -tx; ty = -ty; }
    out.s = a.y + (b.y - a.y) * t - tx * lane; out.u = a.x + (b.x - a.x) * t + ty * lane;
    if (heading) out.heading = Math.atan2(tx, ty);
    out.tx = tx; out.ty = ty; out.segment = i;
    return out;
  }
  // The edge nearest a point and how far along it the point projects
  nearest(s, u, radius = 40) {
    const hit = this.index.nearest(u, s, radius);
    if (!hit) return null;
    const edge = hit.road.edge, along = edge.cumulative[hit.segment.index] + hit.t * hit.segment.length;
    return { edge, along, distance: hit.distance, x: hit.x, y: hit.y, tx: hit.tx, ty: hit.ty };
  }
  // The edge a route starts or ends on, cached by exact position. Taxi offers
  // route from the same pickups to the same entrances over and over.
  endpoint(p) {
    const key = `${p.s},${p.u}`;
    let hit = this.endpoints.get(key);
    if (hit === undefined) {
      if (this.endpoints.size >= 2048) this.endpoints.clear();
      hit = this.nearest(p.s, p.u, 120);
      this.endpoints.set(key, hit);
    }
    return hit;
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
    const a = this.endpoint(from), b = this.endpoint(to);
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
    // Per-node state in arrays reused by every search. A node counts as
    // unvisited until this search stamps it. `from` is -1 for the start.
    const count = this.nodes.length;
    if (this.search?.cost.length !== count) this.search = { cost: new Float64Array(count), stamp: new Uint32Array(count), done: new Uint32Array(count),
      through: new Array(count), from: new Int32Array(count), serial: 0, heap: new Queue() };
    const search = this.search, { cost: distance, stamp, done, through, from: previous, heap } = search;
    if (++search.serial === 0xffffffff) { stamp.fill(0); done.fill(0); search.serial = 1; }
    const visit = search.serial;
    heap.clear();
    const push = (node, cost, edge, via) => {
      if (!(cost < (stamp[node] === visit ? distance[node] : Infinity))) return;
      stamp[node] = visit; distance[node] = cost; through[node] = edge; previous[node] = via; heap.push(node, cost);
    };
    push(a.edge.a, a.along, a.edge, -1);
    push(a.edge.b, a.edge.length - a.along, a.edge, -1);
    // On a loop edge both ends are one node, and endB's distance wins, as it
    // did when these were a Map
    const endA = b.edge.a, endB = b.edge.b, leftA = b.along, leftB = b.edge.length - b.along;
    let best = null;
    while (heap.size) {
      const cost = heap.cost(), node = heap.pop();
      if (done[node] === visit) continue;
      done[node] = visit;
      if (node === endB || node === endA) {
        const total = cost + (node === endB ? leftB : leftA);
        if (!best || total < best.total) best = { node, total };
        if (best && cost > best.total) break;
      }
      for (const edge of this.nodes[node].edges) {
        const other = edge.a === node ? edge.b : edge.a;
        if (done[other] !== visit) push(other, cost + edge.length, edge, node);
      }
    }
    if (!best) return [{ s: from.s, u: from.u }, { s: to.s, u: to.u }];
    // Walk back from the best node to the first edge
    const legs = [];
    let node = best.node;
    while (stamp[node] === visit) {
      const edge = through[node], via = previous[node];
      if (via < 0) { legs.push(trace(edge, a.along, edge.a === node ? 0 : edge.length)); break; }
      legs.push(trace(edge, edge.a === via ? 0 : edge.length, edge.a === node ? 0 : edge.length));
      node = via;
    }
    legs.reverse();
    const last = trace(b.edge, b.edge.a === best.node ? 0 : b.edge.length, b.along);
    return [{ s: from.s, u: from.u }, ...legs.flat(), ...last, { s: to.s, u: to.u }];
  }
}

// Binary heap for the search, cheapest first, ties in the order pushed. The
// linear scan it replaced took the cheapest entry nearest the front of its
// list, which is the same order, so routes come out exactly as before.
class Queue {
  constructor() { this.nodes = []; this.costs = []; this.orders = []; this.size = 0; this.order = 0; }
  clear() { this.size = 0; this.order = 0; }
  before(i, j) { return this.costs[i] < this.costs[j] || (this.costs[i] === this.costs[j] && this.orders[i] < this.orders[j]); }
  swap(i, j) {
    const { nodes, costs, orders } = this;
    const node = nodes[i], cost = costs[i], order = orders[i];
    nodes[i] = nodes[j]; costs[i] = costs[j]; orders[i] = orders[j];
    nodes[j] = node; costs[j] = cost; orders[j] = order;
  }
  push(node, cost) {
    let i = this.size++;
    this.nodes[i] = node; this.costs[i] = cost; this.orders[i] = this.order++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      this.swap(i, parent); i = parent;
    }
  }
  cost() { return this.costs[0]; }
  pop() {
    const node = this.nodes[0], last = --this.size;
    if (last > 0) {
      this.nodes[0] = this.nodes[last]; this.costs[0] = this.costs[last]; this.orders[0] = this.orders[last];
      let i = 0;
      for (;;) {
        const left = i * 2 + 1, right = left + 1;
        let first = i;
        if (left < last && this.before(left, first)) first = left;
        if (right < last && this.before(right, first)) first = right;
        if (first === i) break;
        this.swap(i, first); i = first;
      }
    }
    return node;
  }
}

let shared = null;
export function navGraph() { return shared ??= new NavGraph(CITY); }
export function routeDistance(points) {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.s - points[i].s, p.u - points[i].u), 0);
}
