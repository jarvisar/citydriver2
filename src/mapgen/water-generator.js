import StreamlineGenerator from './streamlines.js';
import { bufferPolyline, insidePolygon, lineRectanglePolygon, offsetPolylineClean, extendPolyline } from './polygon-util.js';
import { filletPolyline, clipInside } from './road-network.js';
import { simplify } from './simplify.js';

const polylineLength = points => points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(points[i]), 0);

// Integrates polylines to create a coastline and a river, with controllable
// noise. params extend the streamline params with coastNoise and riverNoise
// ({ noiseEnabled, noiseSize, noiseAngle }), riverBankSize and riverSize.
export default class WaterGenerator extends StreamlineGenerator {
  constructor(integrator, origin, worldDimensions, params, tensorField, random = Math.random) {
    super(integrator, origin, worldDimensions, params, random);
    this.tensorField = tensorField;
    this.TRIES = 100;
    this.coastlineMajor = true;
    this._coastline = [];  // Noisy line
    this._seaPolygon = [];  // Domain rectangle cut by the simplified coast road
    this._riverPolygon = [];
    this._riverSecondaryRoad = [];
    this.riverStreamline = [];  // Noisy centre line
    this.hasCoast = false; this.hasRiver = false;
  }
  get coastline() { return this._coastline; }
  get seaPolygon() { return this._seaPolygon; }
  get riverPolygon() { return this._riverPolygon; }
  get riverSecondaryRoad() { return this._riverSecondaryRoad; }
  createCoast() {
    let coastStreamline, major;
    if (this.params.coastNoise.noiseEnabled) this.tensorField.enableGlobalNoise(this.params.coastNoise.noiseAngle, this.params.coastNoise.noiseSize);
    let reached = false;
    for (let i = 0; i < this.TRIES; i++) {
      major = this.random() < .5;
      const seed = this.getSeed(major);
      if (seed === null) break;
      coastStreamline = this.extendStreamline(this.integrateStreamline(seed, major));
      if (this.reachesEdges(coastStreamline)) { reached = true; break; }
    }
    this.tensorField.disableGlobalNoise();
    if (!reached) return false;
    this._coastline = coastStreamline;
    this.coastlineMajor = major;
    // The promenade bends smoothly; the sea is cut by the same line
    const road = filletPolyline(this.simplifyStreamline(coastStreamline), this.params.coastRadius ?? 70);
    this._seaPolygon = this.getSeaPolygon(road);
    this.allStreamlinesSimple.push(road);
    this.tensorField.sea = this._seaPolygon;
    // Create intermediate samples
    const complex = this.complexifyStreamline(road);
    this.grid(major).addPolyline(complex);
    this.streamlines(major).push(complex);
    this.allStreamlines.push(complex);
    this.hasCoast = true;
    return true;
  }
  createRiver() {
    let riverStreamline, reached = false;
    // Need to ignore sea when integrating for edge check
    const oldSea = this.tensorField.sea;
    this.tensorField.sea = [];
    if (this.params.riverNoise.noiseEnabled) this.tensorField.enableGlobalNoise(this.params.riverNoise.noiseAngle, this.params.riverNoise.noiseSize);
    // One smoothed centre line is the river: its channel, the bank roads either
    // side of it and the water the game draws are all offsets of it, so the
    // quays are the same width all along and no bank road dips into the water.
    // Where the stream runs out to sea and back, only its longest run on land
    // is the river (the city is built over the rest), and a stream with no
    // real run on land is no river at all: try another
    let centre = null;
    for (let i = 0; i < this.TRIES; i++) {
      const seed = this.getSeed(!this.coastlineMajor);
      if (seed === null) break;
      riverStreamline = this.extendStreamline(this.integrateStreamline(seed, !this.coastlineMajor));
      if (!this.reachesEdges(riverStreamline)) continue;
      const smooth = filletPolyline(simplify(riverStreamline, 3), this.params.riverRadius ?? 90);
      centre = oldSea.length >= 3 ? clipInside(smooth, oldSea, .6, false).sort((a, b) => polylineLength(b) - polylineLength(a))[0] ?? null : smooth;
      // Nor is one that runs along the edge of the city, beside the ring road:
      // it would leave the ring on a causeway two roads wide between river and sea
      if (centre && polylineLength(centre) >= (this.params.riverMinLength ?? 600) && this.alongEdge(centre) <= (this.params.riverEdgeRun ?? 150)) { reached = true; break; }
    }
    this.tensorField.sea = oldSea;
    this.tensorField.disableGlobalNoise();
    if (!reached) return false;
    this.riverStreamline = riverStreamline;
    this.riverCentre = centre;
    this._riverPolygon = bufferPolyline(centre, this.params.riverSize - this.params.riverBankSize);
    // Each bank is the longest run of its offset line on land, cut exactly
    // where it meets the coast road and carried just across it, so the two
    // meet in a junction. The domain edge is left to the ring road.
    const bank = side => {
      // Offsets of the centre carried on out to sea, so both banks reach the coast road
      const line = offsetPolylineClean(extendPolyline(centre, 150), side * this.params.riverSize);
      const runs = this._seaPolygon.length >= 3 ? clipInside(line, this._seaPolygon, .6, false) : [line];
      return runs.sort((a, b) => b.length - a.length)[0] ?? [];
    };
    const road1 = bank(1), road2 = bank(-1);
    this.hasRiver = true;
    if (road1.length < 2 || road2.length < 2) { this.tensorField.river = this._riverPolygon; return true; }
    const road1Simple = road1, road2Simple = road2.slice().reverse();
    this.tensorField.river = road1Simple.concat(road2Simple);
    // Road 1 joins the coast road in the simplified list; road 2 is kept aside
    this.allStreamlinesSimple.push(road1Simple);
    this._riverSecondaryRoad = road2.slice();
    // Dense samples, so the separation tests see the banks all along
    for (const road of [road1, road2]) {
      const dense = this.complexifyStreamline(road);
      this.grid(!this.coastlineMajor).addPolyline(dense);
      this.streamlines(!this.coastlineMajor).push(dense);
      this.allStreamlines.push(dense);
    }
    return true;
  }
  // Every simplified water road, with the far river bank
  get streamlinesWithSecondaryRoad() {
    const withSecondary = this.allStreamlinesSimple.slice();
    if (this._riverSecondaryRoad.length > 1) withSecondary.push(this._riverSecondaryRoad);
    return withSecondary;
  }
  getSeaPolygon(polyline) { return lineRectanglePolygon(this.origin, this.worldDimensions, polyline); }
  // How far a line runs within `riverEdge` metres of the domain's edge, away
  // from its ends (where a river leaves the city it crosses the edge anyway)
  alongEdge(line, { margin = this.params.riverEdge ?? 170, mouth = 250 } = {}) {
    const total = polylineLength(line), x0 = this.origin.x, y0 = this.origin.y, x1 = x0 + this.worldDimensions.x, y1 = y0 + this.worldDimensions.y;
    let along = 0, near = 0;
    for (let i = 1; i < line.length; i++) {
      const p = line[i], step = p.distanceTo(line[i - 1]);
      along += step;
      if (along < mouth || total - along < mouth) continue;
      if (Math.min(p.x - x0, x1 - p.x, p.y - y0, y1 - p.y) < margin) near += step;
    }
    return near;
  }
  // Insert samples until neighbours are at most dstep apart
  complexifyStreamline(s) {
    const out = [];
    for (let i = 0; i < s.length - 1; i++) out.push(...this.complexifyStreamlineRecursive(s[i], s[i + 1]));
    return out;
  }
  complexifyStreamlineRecursive(v1, v2) {
    if (v1.distanceToSquared(v2) <= this.paramsSq.dstep) return [v1, v2];
    const halfway = v1.clone().add(v2.clone().sub(v1).multiplyScalar(.5));
    const complex = this.complexifyStreamlineRecursive(v1, halfway);
    complex.push(...this.complexifyStreamlineRecursive(halfway, v2));
    return complex;
  }
  // Pushes both ends out past the domain edge (mutates)
  extendStreamline(streamline) {
    streamline.unshift(streamline[0].clone().add(streamline[0].clone().sub(streamline[1]).setLength(this.params.dstep * 5)));
    streamline.push(streamline[streamline.length - 1].clone().add(
      streamline[streamline.length - 1].clone().sub(streamline[streamline.length - 2]).setLength(this.params.dstep * 5)));
    return streamline;
  }
  reachesEdges(streamline) { return this.vectorOffScreen(streamline[0]) && this.vectorOffScreen(streamline[streamline.length - 1]); }
  vectorOffScreen(v) {
    const x = v.x - this.origin.x, y = v.y - this.origin.y;
    return x <= 0 || y <= 0 || x >= this.worldDimensions.x || y >= this.worldDimensions.y;
  }
}
