import * as THREE from 'three';
import { dedupePolygon, offsetPolyline, signedArea } from '../mapgen/polygon-util.js';

// target.set(value), with each CSS string or hex number parsed once: Color.set
// parses a string afresh every call, and a city's faces and props ask for a
// few thousand colours millions of times. (A string Color.set can't read
// leaves the target as it was, as before.)
const parsed = new Map();
export function setColor(target, value) {
  if (typeof value !== 'string' && typeof value !== 'number') return target.set(value);
  let color = parsed.get(value);
  if (!color) {
    color = new THREE.Color(NaN, NaN, NaN).set(value);
    if (Number.isNaN(color.r)) return target.set(value);
    parsed.set(value, color);
  }
  return target.copy(color);
}

// Flat-shaded static geometry: every triangle carries its own face normal
// and colour, so the whole ground, the roads, the water or a cell's building
// bodies are one draw each. Points are {x, y} on the map (x east, y north).
// (Faces go straight into typed blocks at full precision, each twice the
// last up to a limit, never copied as they fill and joined once when built.
// `size` floats of each are used.)
export class Surface {
  constructor() { this.size = 0; this.blocks = []; this.block = null; this.room = 0; this.flows = null; this.color = new THREE.Color(); }
  face(ax, ay, az, bx, by, bz, cx, cy, cz, color, flow = null) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1; nx /= length; ny /= length; nz /= length;
    if (!this.room) this.addBlock();
    const block = this.block, o = block.used, p = block.positions, n = block.normals, c = block.colors;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az; p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz; p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;
    const { r, g, b } = setColor(this.color, color);
    for (let k = o; k < o + 9; k += 3) { n[k] = nx; n[k + 1] = ny; n[k + 2] = nz; c[k] = r; c[k + 1] = g; c[k + 2] = b; }
    block.used = o + 9; this.room -= 9; this.size += 9;
    if (flow) { this.flows ??= []; for (let i = 0; i < 3; i++) this.flows.push(flow[0], flow[1]); }
  }
  addBlock() {
    const floats = 9 * 256 * 2 ** Math.min(6, this.blocks.length);
    this.block = { used: 0, positions: new Float64Array(floats), normals: new Float64Array(floats), colors: new Float64Array(floats) };
    this.blocks.push(this.block); this.room = floats;
  }
  // All the blocks' values of one attribute, end to end
  joined(name, Type = Float32Array) {
    const out = new Type(this.size);
    let at = 0;
    for (const block of this.blocks) { out.set(block[name].subarray(0, block.used), at); at += block.used; }
    return out;
  }
  // The faces so far, each attribute end to end (a copy, to read)
  get positions() { return this.joined('positions', Float64Array); }
  get normals() { return this.joined('normals', Float64Array); }
  get colors() { return this.joined('colors', Float64Array); }
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
    geometry.setAttribute('position', new THREE.BufferAttribute(this.joined('positions'), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.joined('normals'), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.joined('colors'), 3));
    if (this.flows) geometry.setAttribute('flowDirection', new THREE.Float32BufferAttribute(this.flows, 2));
    geometry.computeBoundingSphere();
    return geometry;
  }
  // The same faces as build(), cut into square tiles by where each face's
  // middle falls, each tile in its first-drawn order: the renderer can leave
  // out the tiles off screen. Faces more than a quarter of a tile across (the
  // island's underlay, long straight roads) would stretch a tile's bounds, so
  // they are kept together. (Up to a whole tile across, they swelled a tile's
  // bounding sphere half as big again, and a view took in a tile or two more.)
  tiles(size) {
    const p = this.joined('positions', Float64Array), count = this.size / 9, tiles = new Map(), wide = [];
    for (let face = 0; face < count; face++) {
      const o = face * 9, x0 = p[o], x1 = p[o + 3], x2 = p[o + 6], z0 = p[o + 2], z1 = p[o + 5], z2 = p[o + 8];
      if (Math.max(x0, x1, x2) - Math.min(x0, x1, x2) > size / 4 || Math.max(z0, z1, z2) - Math.min(z0, z1, z2) > size / 4) { wide.push(face); continue; }
      // (tiles keyed by number, within a million tiles of the origin)
      const key = Math.floor((x0 + x1 + x2) / 3 / size) * 0x200000 + Math.floor((z0 + z1 + z2) / 3 / size);
      let tile = tiles.get(key);
      if (!tile) tiles.set(key, tile = []);
      tile.push(face);
    }
    const attributes = [['position', p, 3], ['normal', this.joined('normals'), 3], ['color', this.joined('colors'), 3], ...(this.flows ? [['flowDirection', this.flows, 2]] : [])];
    return [...tiles.values(), wide].filter(faces => faces.length).map(faces => {
      const geometry = new THREE.BufferGeometry();
      for (const [name, values, size] of attributes) {
        const stride = size * 3, array = new Float32Array(faces.length * stride);
        for (let i = 0, to = 0; i < faces.length; i++) for (let from = faces[i] * stride, end = from + stride; from < end;) array[to++] = values[from++];
        geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
      }
      geometry.computeBoundingSphere();
      return geometry;
    });
  }
  get empty() { return this.size === 0; }
}
