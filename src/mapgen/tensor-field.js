import Tensor from './tensor.js';
import { Grid, Radial } from './basis-field.js';
import { insidePolygon } from './polygon-util.js';
import { createNoise2D } from './simplex-noise.js';

// Combines basis fields. Rotational noise is added inside parks, and over the
// whole domain while the coastline and river are being integrated.
export default class TensorField {
  constructor(noiseParams, random = Math.random) {
    this.noiseParams = noiseParams;
    this.noise2D = createNoise2D(random);
    this.basisFields = [];
    this.parks = []; this.sea = []; this.river = [];
    this.ignoreRiver = false; this.smooth = false;
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
    const tensorAcc = Tensor.zero;
    for (const field of this.basisFields) tensorAcc.add(field.getWeightedTensor(point, this.smooth), this.smooth);
    // Add rotational noise for parks - range -pi/2 to pi/2
    if (this.parks.some(p => insidePolygon(point, p))) {
      tensorAcc.rotate(this.getRotationalNoise(point, this.noiseParams.noiseSizePark, this.noiseParams.noiseAnglePark));
    }
    if (this.noiseParams.globalNoise) {
      tensorAcc.rotate(this.getRotationalNoise(point, this.noiseParams.noiseSizeGlobal, this.noiseParams.noiseAngleGlobal));
    }
    return tensorAcc;
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
