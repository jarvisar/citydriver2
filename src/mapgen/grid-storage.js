import Vector from './vector.js';

// Cartesian grid of cells, each holding the sample points that fall in it, so
// the separation tests the integrator runs at every step stay cheap.
export default class GridStorage {
  constructor(worldDimensions, origin, dsep) {
    this.worldDimensions = worldDimensions; this.origin = origin; this.dsep = dsep;
    this.dsepSq = dsep * dsep;
    this.gridDimensions = worldDimensions.clone().divideScalar(dsep);
    this.grid = [];
    for (let x = 0; x < this.gridDimensions.x; x++) {
      const column = [];
      for (let y = 0; y < this.gridDimensions.y; y++) column.push([]);
      this.grid.push(column);
    }
  }
  addAll(gridStorage) {
    for (const row of gridStorage.grid) for (const cell of row) for (const sample of cell) this.addSample(sample);
  }
  addPolyline(line) { for (const v of line) this.addSample(v); }
  // Does not enforce separation, does not clone
  addSample(v, coords = this.getSampleCoords(v)) { this.grid[coords.x][coords.y].push(v); }
  // Whether v is at least sqrt(dSq) away from every stored sample
  isValidSample(v, dSq = this.dsepSq) {
    const coords = this.getSampleCoords(v);
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      const cx = coords.x + x, cy = coords.y + y;
      if (cx < 0 || cy < 0 || cx >= this.gridDimensions.x || cy >= this.gridDimensions.y) continue;
      if (!this.vectorFarFromVectors(v, this.grid[cx][cy], dSq)) return false;
    }
    return true;
  }
  vectorFarFromVectors(v, vectors, dSq) {
    for (const sample of vectors) if (sample !== v && sample.distanceToSquared(v) < dSq) return false;
    return true;
  }
  // Samples in the cells around v: a square approximation of the circle
  getNearbyPoints(v, distance) {
    const radius = Math.ceil(distance / this.dsep - .5), coords = this.getSampleCoords(v), out = [];
    for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) {
      const cx = coords.x + x, cy = coords.y + y;
      if (cx < 0 || cy < 0 || cx >= this.gridDimensions.x || cy >= this.gridDimensions.y) continue;
      for (const v2 of this.grid[cx][cy]) out.push(v2);
    }
    return out;
  }
  getSampleCoords(worldV) {
    const x = worldV.x - this.origin.x, y = worldV.y - this.origin.y;
    if (x < 0 || y < 0 || x >= this.worldDimensions.x || y >= this.worldDimensions.y) return Vector.zeroVector();
    return new Vector(Math.floor(x / this.dsep), Math.floor(y / this.dsep));
  }
}
