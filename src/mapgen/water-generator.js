import StreamlineGenerator from './streamlines.js';
import { bufferPolyline, insidePolygon, lineRectanglePolygon } from './polygon-util.js';

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
    const road = this.simplifyStreamline(coastStreamline);
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
    for (let i = 0; i < this.TRIES; i++) {
      const seed = this.getSeed(!this.coastlineMajor);
      if (seed === null) break;
      riverStreamline = this.extendStreamline(this.integrateStreamline(seed, !this.coastlineMajor));
      if (this.reachesEdges(riverStreamline)) { reached = true; break; }
    }
    this.tensorField.sea = oldSea;
    this.tensorField.disableGlobalNoise();
    if (!reached) return false;
    this.riverStreamline = riverStreamline;
    // Create river roads
    const expandedNoisy = this.complexifyStreamline(bufferPolyline(riverStreamline, this.params.riverSize));
    this._riverPolygon = bufferPolyline(riverStreamline, this.params.riverSize - this.params.riverBankSize);
    // Make sure expandedNoisy[0] is off screen
    const firstOffScreen = expandedNoisy.findIndex(v => this.vectorOffScreen(v));
    for (let i = 0; i < firstOffScreen; i++) expandedNoisy.push(expandedNoisy.shift());
    const riverSplitPoly = this.getSeaPolygon(riverStreamline);
    const onLand = v => !insidePolygon(v, this._seaPolygon) && !this.vectorOffScreen(v);
    const road1 = expandedNoisy.filter(v => onLand(v) && insidePolygon(v, riverSplitPoly));
    const road2 = expandedNoisy.filter(v => onLand(v) && !insidePolygon(v, riverSplitPoly));
    this.hasRiver = true;
    if (road1.length < 2 || road2.length < 2) { this.tensorField.river = this._riverPolygon; return true; }
    const road1Simple = this.simplifyStreamline(road1), road2Simple = this.simplifyStreamline(road2);
    if (road1[0].distanceToSquared(road2[0]) < road1[0].distanceToSquared(road2[road2.length - 1])) road2Simple.reverse();
    this.tensorField.river = road1Simple.concat(road2Simple);
    // Road 1 joins the coast road in the simplified list; road 2 is kept aside
    this.allStreamlinesSimple.push(road1Simple);
    this._riverSecondaryRoad = road2Simple;
    this.grid(!this.coastlineMajor).addPolyline(road1);
    this.grid(!this.coastlineMajor).addPolyline(road2);
    this.streamlines(!this.coastlineMajor).push(road1);
    this.streamlines(!this.coastlineMajor).push(road2);
    this.allStreamlines.push(road1);
    this.allStreamlines.push(road2);
    return true;
  }
  // Every simplified water road, with the far river bank
  get streamlinesWithSecondaryRoad() {
    const withSecondary = this.allStreamlinesSimple.slice();
    if (this._riverSecondaryRoad.length > 1) withSecondary.push(this._riverSecondaryRoad);
    return withSecondary;
  }
  getSeaPolygon(polyline) { return lineRectanglePolygon(this.origin, this.worldDimensions, polyline); }
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
