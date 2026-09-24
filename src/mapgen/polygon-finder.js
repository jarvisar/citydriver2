import { subdividePolygon, calcPolygonArea, interiorPoint } from './polygon-util.js';
import { insetPolygon } from './booleans.js';

// Finds the faces of the road graph: blocks, then lots and parks.
// params: maxLength (vertices per face), minArea, shrinkSpacing (number or a
// function of each edge), chanceNoDivide.
export default class PolygonFinder {
  constructor(nodes, params, tensorField, random = Math.random) {
    this.nodes = nodes; this.params = params; this.tensorField = tensorField; this.random = random;
    this.reset();
  }
  get polygons() {
    if (this._dividedPolygons.length > 0) return this._dividedPolygons;
    if (this._shrunkPolygons.length > 0) return this._shrunkPolygons.filter(p => p.length > 0);
    return this._polygons;
  }
  // Shrunk polygons stay aligned with the faces they came from (empty where
  // a face collapsed), and every lot remembers the face it was cut from.
  get shrunkPolygons() { return this._shrunkPolygons; }
  get lotBlocks() { return this._lotBlocks; }
  // The graph nodes round each face, parallel to its vertices
  get faceNodes() { return this._faceNodes; }
  reset() { this._polygons = []; this._shrunkPolygons = []; this._dividedPolygons = []; this._lotBlocks = []; this._faceNodes = []; }
  // Pull every edge in from the road so lots have the same setback all round
  shrink() {
    if (this._polygons.length === 0) this.findPolygons();
    const spacing = this.params.shrinkSpacing;
    const distance = typeof spacing === 'function' ? (a, b, i) => -spacing(a, b, i) : -spacing;
    this._shrunkPolygons = this._polygons.map(p => insetPolygon(p, distance));
  }
  divide() {
    if (this._polygons.length === 0) this.findPolygons();
    const polygons = this._shrunkPolygons.length > 0 ? this._shrunkPolygons : this._polygons;
    this._dividedPolygons = []; this._lotBlocks = [];
    polygons.forEach((p, block) => {
      if (p.length < 3) return;
      // minArea may vary across the map, so the lots downtown can be bigger
      const minArea = typeof this.params.minArea === 'function' ? this.params.minArea(p) : this.params.minArea;
      // An undivided block bigger than maxLotArea still splits, into a few big lots
      const keep = this.params.chanceNoDivide > 0 && this.random() < this.params.chanceNoDivide;
      const whole = keep && calcPolygonArea(p) <= (this.params.maxLotArea ?? Infinity);
      const lots = whole ? [p] : subdividePolygon(p, keep ? minArea * 5 : minArea, this.random);
      for (const lot of lots) { this._dividedPolygons.push(lot); this._lotBlocks.push(block); }
    });
  }
  // Every directed edge borders exactly one face. Walking from each unused
  // edge and always taking the next edge round from the one we arrived by
  // visits every face once. Faces with a dead end inside them are skipped,
  // as MapGenerator did, and the outer boundary is dropped by its winding.
  findPolygons() {
    this._shrunkPolygons = []; this._dividedPolygons = []; this._faceNodes = [];
    const sorted = new Map();
    const neighborsOf = node => {
      let list = sorted.get(node);
      if (!list) {
        list = node.adj.map(next => ({ next, angle: Math.atan2(next.value.y - node.value.y, next.value.x - node.value.x) }))
          .sort((a, b) => a.angle - b.angle);
        sorted.set(node, list);
      }
      return list;
    };
    const used = new Set(), key = (a, b) => `${a.id}:${b.id}`;
    const faces = [];
    for (const node of this.nodes) {
      for (const first of node.adj) {
        if (used.has(key(node, first))) continue;
        const walk = [], visited = [];
        let from = node, to = first, ok = true;
        for (let guard = 0; guard < this.params.maxLength * 40; guard++) {
          const edge = key(from, to);
          if (used.has(edge)) { ok = false; break; }
          used.add(edge); walk.push(edge); visited.push(from);
          // The next edge round from the one we came in by
          const list = neighborsOf(to), back = Math.atan2(from.value.y - to.value.y, from.value.x - to.value.x);
          let choice = null;
          for (const entry of list) if (entry.angle > back + 1e-12) { choice = entry.next; break; }
          if (choice === null) choice = list[0].next;
          if (choice === from) { ok = false; break; }
          from = to; to = choice;
          if (from === node && to === first) break;
        }
        if (!ok || walk.length < 3) continue;
        faces.push({ polygon: visited.map(n => n.value.clone()), nodes: visited });
      }
    }
    // Inner faces all wind the same way; the outer boundary winds the other
    let clockwise = 0, counter = 0;
    const areas = faces.map(({ polygon }) => polygon.reduce((sum, a, i) => { const b = polygon[(i + 1) % polygon.length]; return sum + a.x * b.y - b.x * a.y; }, 0) / 2);
    for (const area of areas) if (area < 0) clockwise++; else counter++;
    const keep = clockwise >= counter ? area => area < 0 : area => area > 0;
    const kept = faces.filter((face, i) => keep(areas[i]) && face.polygon.length < this.params.maxLength && this.onDryLand(face.polygon));
    this._polygons = kept.map(face => face.polygon);
    this._faceNodes = kept.map(face => face.nodes);
  }
  // A face whose inside is in the water or a park is not a block
  onDryLand(polygon) {
    // A point inside the face, which its centroid need not be
    const centre = interiorPoint(polygon);
    return this.tensorField.onLand(centre) && !this.tensorField.inParks(centre);
  }
  filterPolygonsByWater(polygons) { return polygons.filter(p => this.onDryLand(p)); }
}
