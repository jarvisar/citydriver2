import Tensor from './tensor.js';
import { Grid, Radial, FIELD_TYPE } from './basis-field.js';
import { insidePolygon } from './polygon-util.js';
import { createNoise2D } from './simplex-noise.js';

const smoothstep = t => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

// Combines basis fields. Rotational noise is added inside parks, over the
// whole domain while the coastline and river are being integrated, and over
// any neighbourhood given its own; near the ring road the streets turn to
// meet it square.
export default class TensorField {
  constructor(noiseParams, random = Math.random) {
    this.noiseParams = noiseParams;
    this.noise2D = createNoise2D(random);
    this.basisFields = [];
    this.parks = []; this.sea = []; this.river = [];
    this.ignoreRiver = false; this.smooth = false;
    // Rotational noise over one neighbourhood rather than the whole domain:
    // each { index, angle, size } turns the streets where basis field
    // `index` weighs most, fading out with its share of the weight
    this.districtNoise = [];
  }
  enableGlobalNoise(angle, size) {
    this.noiseParams.globalNoise = true; this.noiseParams.noiseAngleGlobal = angle; this.noiseParams.noiseSizeGlobal = size;
  }
  disableGlobalNoise() { this.noiseParams.globalNoise = false; }
  addGrid(centre, size, decay, theta) { this.addField(new Grid(centre, size, decay, theta)); }
  addRadial(centre, size, decay) { this.addField(new Radial(centre, size, decay)); }
  addField(field) { this.basisFields.push(field); }
  removeField(field) { const index = this.basisFields.indexOf(field); if (index > -1) this.basisFields.splice(index, 1); }
  reset() { this.basisFields = []; this.parks = []; this.sea = []; this.river = []; }
  getCentrePoints() { return this.basisFields.map(field => field.centre); }
  getBasisFields() { return this.basisFields; }
  samplePoint(point) {
    // Degenerate point
    if (!this.onLand(point)) return Tensor.zero;
    // Default field is a grid
    if (this.basisFields.length === 0) return new Tensor(1, [0, 0]);
    const tensorAcc = Tensor.zero, weights = this.weights;
    let total = 0;
    for (let i = 0; i < this.basisFields.length; i++) {
      const field = this.basisFields[i], weight = weights[i] = field.getTensorWeight(point, this.smooth);
      total += weight;
      tensorAcc.add(field.getTensor(point).scale(weight), this.smooth);
    }
    // Add rotational noise for parks - range -pi/2 to pi/2
    if (this.parks.some(p => insidePolygon(point, p))) {
      tensorAcc.rotate(this.getRotationalNoise(point, this.noiseParams.noiseSizePark, this.noiseParams.noiseAnglePark));
    }
    if (this.noiseParams.globalNoise) {
      tensorAcc.rotate(this.getRotationalNoise(point, this.noiseParams.noiseSizeGlobal, this.noiseParams.noiseAngleGlobal));
    }
    // A neighbourhood's own noise, as much as that neighbourhood's field weighs there
    for (const { index, angle, size } of this.districtNoise) {
      const share = total > 0 ? weights[index] / total : 0;
      if (share > .01) tensorAcc.rotate(this.getRotationalNoise(point, size, angle) * share);
    }
    if (this.alignment) this.align(point, tensorAcc, total > 0 && this.radialIndex >= 0 ? weights[this.radialIndex] / total : 0);
    return tensorAcc;
  }
  get weights() { return this._weights ??= []; }
  get radialIndex() { return this.basisFields.findIndex(field => field.FIELD_TYPE === FIELD_TYPE.Radial); }
  // Streets near a fixed line (the ring road round the city's edge) turn to
  // run along it or meet it square, more the nearer they are, out to `reach`
  // metres from it (MapGenerator's advice for a waterfront: keep the field
  // parallel to the water there). The line's distance and direction are kept
  // on a grid of `cell` metres.
  alignWith(line, reach, cell = 24) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of line) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const margin = reach + cell * 2;
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;
    const cols = Math.ceil((maxX - minX) / cell) + 1, rows = Math.ceil((maxY - minY) / cell) + 1, data = new Float32Array(cols * rows * 3);
    // Far from the line is out of reach (a large finite distance, so the interpolation stays a number)
    for (let k = 0; k < data.length; k += 3) { data[k] = 1e6; data[k + 1] = 1; }
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      // The direction as a cross (mod 90 degrees), so it interpolates
      const angle = Math.atan2(dy, dx), c4 = Math.cos(4 * angle), s4 = Math.sin(4 * angle);
      const col0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - margin - minX) / cell)), col1 = Math.min(cols - 1, Math.ceil((Math.max(a.x, b.x) + margin - minX) / cell));
      const row0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - margin - minY) / cell)), row1 = Math.min(rows - 1, Math.ceil((Math.max(a.y, b.y) + margin - minY) / cell));
      for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) {
        const x = minX + col * cell, y = minY + row * cell, k = (row * cols + col) * 3;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)), d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
        if (d < data[k]) { data[k] = d; data[k + 1] = c4; data[k + 2] = s4; }
      }
    }
    this.alignment = { minX, minY, cell, cols, rows, data, reach };
  }
  align(point, tensor, radialShare) {
    const { minX, minY, cell, cols, rows, data, reach } = this.alignment;
    const fx = (point.x - minX) / cell, fy = (point.y - minY) / cell, col = Math.floor(fx), row = Math.floor(fy);
    if (col < 0 || row < 0 || col >= cols - 1 || row >= rows - 1) return;
    const tx = fx - col, ty = fy - row, k00 = (row * cols + col) * 3, k10 = k00 + 3, k01 = k00 + cols * 3, k11 = k01 + 3;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    const distance = data[k00] * w00 + data[k10] * w10 + data[k01] * w01 + data[k11] * w11;
    if (distance >= reach) return;
    const c4 = data[k00 + 1] * w00 + data[k10 + 1] * w10 + data[k01 + 1] * w01 + data[k11 + 1] * w11;
    const s4 = data[k00 + 2] * w00 + data[k10 + 2] * w10 + data[k01 + 2] * w01 + data[k11 + 2] * w11;
    let delta = (Math.atan2(s4, c4) / 4 - tensor.theta) % (Math.PI / 2);
    if (delta > Math.PI / 4) delta -= Math.PI / 2;
    if (delta < -Math.PI / 4) delta += Math.PI / 2;
    // Streets at 45 degrees to the line could turn either way: they turn
    // less the nearer they are to 45, so the two ways never meet in a seam.
    // Downtown's rings keep their shape.
    const near = smoothstep(1 - distance / reach), square = smoothstep((Math.PI / 4 - Math.abs(delta)) / (Math.PI / 12));
    tensor.rotate(delta * near * square * (1 - radialShare));
  }
  // Noise angle is in degrees
  getRotationalNoise(point, noiseSize, noiseAngle) {
    return this.noise2D(point.x / noiseSize, point.y / noiseSize) * noiseAngle * Math.PI / 180;
  }
  onLand(point) {
    const inSea = insidePolygon(point, this.sea);
    if (this.ignoreRiver) return !inSea;
    return !inSea && !insidePolygon(point, this.river);
  }
  inParks(point) {
    for (const p of this.parks) if (insidePolygon(point, p)) return true;
    return false;
  }
}
