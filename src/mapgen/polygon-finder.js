import { averagePoint, offsetPolygon, subdividePolygon } from './polygon-util.js';

// Finds the faces of the road graph: blocks, then lots and parks.
// params: maxLength (vertices per face), minArea, shrinkSpacing (number or a
// function of each edge), chanceNoDivide.
export default class PolygonFinder {
  constructor(nodes, params, tensorField, random = Math.random) {
    this.nodes = nodes; this.params = params; this.tensorField = tensorField; this.random = random;
    this._polygons = []; this._shrunkPolygons = []; this._dividedPolygons = [];
  }
  get polygons() {
    if (this._dividedPolygons.length > 0) return this._dividedPolygons;
    if (this._shrunkPolygons.length > 0) return this._shrunkPolygons;
    return this._polygons;
  }
  reset() { this._polygons = []; this._shrunkPolygons = []; this._dividedPolygons = []; }
  // Pull every edge in from the road so lots have the same setback all round
  shrink() {
    if (this._polygons.length === 0) this.findPolygons();
    const spacing = this.params.shrinkSpacing;
    const distance = typeof spacing === 'function' ? (a, b, i) => -spacing(a, b, i) : -spacing;
    this._shrunkPolygons = [];
    for (const p of this._polygons) {
      const shrunk = offsetPolygon(p, distance);
      if (shrunk.length > 0) this._shrunkPolygons.push(shrunk);
    }
  }
  divide() {
    if (this._polygons.length === 0) this.findPolygons();
    const polygons = this._shrunkPolygons.length > 0 ? this._shrunkPolygons : this._polygons;
    this._dividedPolygons = [];
    for (const p of polygons) {
      if (this.params.chanceNoDivide > 0 && this.random() < this.params.chanceNoDivide) { this._dividedPolygons.push(p); continue; }
      const divided = subdividePolygon(p, this.params.minArea, this.random);
      if (divided.length > 0) this._dividedPolygons.push(...divided);
    }
  }
  // Every directed edge borders exactly one face. Walking from each unused
  // edge and always taking the next edge round from the one we arrived by
  // visits every face once. Faces with a dead end inside them are skipped,
  // as MapGenerator did, and the outer boundary is dropped by its winding.
  findPolygons() {
    this._shrunkPolygons = []; this._dividedPolygons = [];
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
          if (choice === from && list.length > 1) { ok = false; break; }
          if (choice === from) { ok = false; break; }
          from = to; to = choice;
          if (from === node && to === first) break;
        }
        if (!ok || walk.length < 3) continue;
        faces.push(visited.map(n => n.value.clone()));
      }
    }
    // Inner faces all wind the same way; the outer boundary winds the other
    let clockwise = 0, counter = 0;
    const areas = faces.map(face => face.reduce((sum, a, i) => { const b = face[(i + 1) % face.length]; return sum + a.x * b.y - b.x * a.y; }, 0) / 2);
    for (const area of areas) if (area < 0) clockwise++; else counter++;
    const keep = clockwise >= counter ? area => area < 0 : area => area > 0;
    const polygons = faces.filter((face, i) => keep(areas[i]) && face.length < this.params.maxLength);
    this._polygons = this.filterPolygonsByWater(polygons);
  }
  filterPolygonsByWater(polygons) {
    const out = [];
    for (const p of polygons) {
      const centre = averagePoint(p);
      if (this.tensorField.onLand(centre) && !this.tensorField.inParks(centre)) out.push(p);
    }
    return out;
  }
}
