import * as THREE from 'three';
import { dedupePolygon, offsetPolyline, signedArea } from '../mapgen/polygon-util.js';

// Flat-shaded static geometry: every triangle carries its own face normal
// and colour, so the whole ground, the roads, the water or a cell's building
// bodies are one draw each. Points are {x, y} on the map (x east, y north).
export class Surface {
  constructor() { this.positions = []; this.normals = []; this.colors = []; this.flows = null; this.color = new THREE.Color(); }
  face(ax, ay, az, bx, by, bz, cx, cy, cz, color, flow = null) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1; nx /= length; ny /= length; nz /= length;
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const { r, g, b } = this.color.set(color);
    for (let i = 0; i < 3; i++) { this.normals.push(nx, ny, nz); this.colors.push(r, g, b); }
    if (flow) { this.flows ??= []; for (let i = 0; i < 3; i++) this.flows.push(flow[0], flow[1]); }
  }
  // Horizontal triangle with its normal up (or down), whichever way the points wind.
  flat(a, b, c, y, color, flow = null, up = true) {
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < 1e-9) return;
    if ((cross > 0) === up) this.face(a.x, y, -a.y, b.x, y, -b.y, c.x, y, -c.y, color, flow);
    else this.face(a.x, y, -a.y, c.x, y, -c.y, b.x, y, -b.y, color, flow);
  }
  polygon(points, y, color, flowOf = null, up = true, holes = []) {
    const clean = dedupePolygon(points);
    if (clean.length < 3) return;
    const rings = holes.map(hole => dedupePolygon(hole)).filter(hole => hole.length >= 3), all = [clean, ...rings].flat();
    const toVector = p => new THREE.Vector2(p.x, p.y);
    const faces = THREE.ShapeUtils.triangulateShape(clean.map(toVector), rings.map(ring => ring.map(toVector)));
    for (const [i0, i1, i2] of faces) {
      const a = all[i0], b = all[i1], c = all[i2];
      this.flat(a, b, c, y, color, flowOf ? flowOf((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3) : null, up);
    }
  }
  // A strip of road along a polyline
  ribbon(points, halfWidth, y, color) {
    const left = offsetPolyline(points, halfWidth), right = offsetPolyline(points, -halfWidth);
    for (let i = 0; i < points.length - 1; i++) {
      this.flat(left[i], right[i], right[i + 1], y, color);
      this.flat(left[i], right[i + 1], left[i + 1], y, color);
    }
  }
  // Vertical faces along a polyline, closed when asked. The faces look to the
  // right of the direction of travel, so a clockwise ring faces outward.
  wall(points, top, bottom, color, closed = false) {
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      this.face(a.x, top, -a.y, b.x, top, -b.y, b.x, bottom, -b.y, color);
      this.face(a.x, top, -a.y, b.x, bottom, -b.y, a.x, bottom, -a.y, color);
    }
  }
  // The sides of an extruded ring, facing outward whichever way the ring winds
  prism(points, bottom, top, color) {
    const ring = signedArea(points) > 0 ? points.slice().reverse() : points;
    this.wall(ring, top, bottom, color, true);
  }
  // A sloping triangle: map points with their own heights, normal made to point up
  slope(a, ay, b, by, c, cy, color) {
    const ux = b.x - a.x, uz = -(b.y - a.y), vx = c.x - a.x, vz = -(c.y - a.y);
    if (uz * vx - ux * vz >= 0) this.face(a.x, ay, -a.y, b.x, by, -b.y, c.x, cy, -c.y, color);
    else this.face(a.x, ay, -a.y, c.x, cy, -c.y, b.x, by, -b.y, color);
  }
  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.flows) geometry.setAttribute('flowDirection', new THREE.Float32BufferAttribute(this.flows, 2));
    geometry.computeBoundingSphere();
    return geometry;
  }
  get empty() { return this.positions.length === 0; }
}
