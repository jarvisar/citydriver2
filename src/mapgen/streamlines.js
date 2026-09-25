import Vector from './vector.js';
import GridStorage from './grid-storage.js';
import { simplify } from './simplify.js';

// Creates the polylines that make up the roads by integrating the tensor
// field. See the paper 'Interactive Procedural Street Modeling'.
//
// params: dsep seed separation, dtest integration separation, dstep step size,
// dcirclejoin how far to look to join circles, dlookahead how far to look to
// join dangling ends, joinangle in radians, pathIterations, seedTries,
// simplifyTolerance, collideEarly chance 0-1.
export default class StreamlineGenerator {
  constructor(integrator, origin, worldDimensions, params, random = Math.random) {
    this.integrator = integrator; this.origin = origin; this.worldDimensions = worldDimensions;
    this.params = params; this.random = random;
    if (params.dstep > params.dsep) throw new Error('Streamline sample distance bigger than dsep');
    // Enforce test < sep
    params.dtest = Math.min(params.dtest, params.dsep);
    this.majorGrid = new GridStorage(worldDimensions, origin, params.dsep);
    this.minorGrid = new GridStorage(worldDimensions, origin, params.dsep);
    this.allStreamlines = []; this.streamlinesMajor = []; this.streamlinesMinor = [];
    this.allStreamlinesSimple = [];  // Reduced vertex count
    this.setParamsSq();
  }
  // Extends every open streamline end toward a nearby sample ahead of it
  joinDanglingStreamlines() {
    for (const major of [true, false]) {
      for (const streamline of this.streamlines(major)) {
        // Ignore circles
        if (streamline[0].equals(streamline[streamline.length - 1])) continue;
        const newStart = this.getBestNextPoint(streamline[0], streamline[4], streamline);
        if (newStart !== null) {
          for (const p of this.pointsBetween(streamline[0], newStart, this.params.dstep)) { streamline.unshift(p); this.grid(major).addSample(p); }
        }
        const newEnd = this.getBestNextPoint(streamline[streamline.length - 1], streamline[streamline.length - 4], streamline);
        if (newEnd !== null) {
          for (const p of this.pointsBetween(streamline[streamline.length - 1], newEnd, this.params.dstep)) { streamline.push(p); this.grid(major).addSample(p); }
        }
      }
    }
    // Reset simplified streamlines
    this.allStreamlinesSimple = this.allStreamlines.map(s => this.simplifyStreamline(s));
  }
  // Points from v1 to v2 separated by at most dstep, not including v1
  pointsBetween(v1, v2, dstep) {
    const d = v1.distanceTo(v2), nPoints = Math.floor(d / dstep);
    if (nPoints === 0) return [];
    const stepVector = v2.clone().sub(v1), out = [];
    for (let i = 1; i <= nPoints; i++) {
      const next = v1.clone().add(stepVector.clone().multiplyScalar(i / nPoints));
      if (this.integrator.integrate(next, true).lengthSq() > .001) out.push(next);  // Test for degenerate point
      else return out;
    }
    return out;
  }
  // Next best point to join a streamline end to; null without a good candidate
  getBestNextPoint(point, previousPoint, streamline) {
    const nearbyPoints = this.majorGrid.getNearbyPoints(point, this.params.dlookahead);
    nearbyPoints.push(...this.minorGrid.getNearbyPoints(point, this.params.dlookahead));
    const direction = point.clone().sub(previousPoint);
    let closestSample = null, closestDistance = Infinity;
    for (const sample of nearbyPoints) {
      if (sample.equals(point) || sample.equals(previousPoint)) continue;
      const differenceVector = sample.clone().sub(point);
      if (differenceVector.dot(direction) < 0) continue;  // Backwards
      const distanceToSample = point.distanceToSquared(sample);
      if (distanceToSample < 2 * this.paramsSq.dstep) { closestSample = sample; break; }
      const angleBetween = Math.abs(Vector.angleBetween(direction, differenceVector));
      if (angleBetween < this.params.joinangle && distanceToSample < closestDistance) { closestDistance = distanceToSample; closestSample = sample; }
    }
    // Overshoot the sample so the simplified polylines still cross
    if (closestSample !== null) closestSample = closestSample.clone().add(direction.setLength(this.params.simplifyTolerance * 4));
    return closestSample;
  }
  // Assumes s has already generated
  addExistingStreamlines(s) { this.majorGrid.addAll(s.majorGrid); this.minorGrid.addAll(s.minorGrid); }
  // All at once
  createAllStreamlines() {
    let major = true;
    while (this.createStreamline(major)) major = !major;
    this.joinDanglingStreamlines();
  }
  simplifyStreamline(streamline) { return simplify(streamline, this.params.simplifyTolerance); }
  // Finds a seed and integrates a streamline from it; false once no seed is found within params.seedTries
  createStreamline(major) {
    const seed = this.getSeed(major);
    if (seed === null) return false;
    const streamline = this.integrateStreamline(seed, major);
    if (this.validStreamline(streamline)) {
      this.grid(major).addPolyline(streamline);
      this.streamlines(major).push(streamline);
      this.allStreamlines.push(streamline);
      this.allStreamlinesSimple.push(this.simplifyStreamline(streamline));
    }
    return true;
  }
  validStreamline(s) { return s.length > 5; }
  setParamsSq() {
    this.paramsSq = Object.assign({}, this.params);
    for (const p in this.paramsSq) if (typeof this.paramsSq[p] === 'number') this.paramsSq[p] *= this.paramsSq[p];
  }
  samplePoint() {
    return new Vector(this.random() * this.worldDimensions.x, this.random() * this.worldDimensions.y).add(this.origin);
  }
  // A random seed clear of the other streamlines, or null after seedTries
  getSeed(major) {
    let seed = this.samplePoint(), i = 0;
    while (!this.isValidSample(major, seed, this.paramsSq.dsep)) {
      if (i >= this.params.seedTries) return null;
      seed = this.samplePoint(); i++;
    }
    return seed;
  }
  isValidSample(major, point, dSq, bothGrids = false) {
    let gridValid = this.grid(major).isValidSample(point, dSq);
    if (bothGrids) gridValid = gridValid && this.grid(!major).isValidSample(point, dSq);
    return this.integrator.onLand(point) && gridValid;
  }
  streamlines(major) { return major ? this.streamlinesMajor : this.streamlinesMinor; }
  grid(major) { return major ? this.majorGrid : this.minorGrid; }
  pointInBounds(v) {
    return v.x >= this.origin.x && v.y >= this.origin.y && v.x < this.worldDimensions.x + this.origin.x && v.y < this.worldDimensions.y + this.origin.y;
  }
  // Whether a streamline has turned through more than 180 degrees
  streamlineTurned(seed, originalDir, point, direction) {
    if (originalDir.dot(direction) < 0) {
      const perpendicularVector = new Vector(originalDir.y, -originalDir.x);
      const isLeft = point.clone().sub(seed).dot(perpendicularVector) < 0;
      const directionUp = direction.dot(perpendicularVector) > 0;
      return isLeft === directionUp;
    }
    return false;
  }
  // One step of the streamline integration process
  streamlineIntegrationStep(params, major, collideBoth) {
    if (!params.valid) return;
    params.streamline.push(params.previousPoint);
    const nextDirection = this.integrator.integrate(params.previousPoint, major, params.previousDirection);
    // Stop at degenerate point
    if (nextDirection.lengthSq() < .01) { params.valid = false; return; }
    // Make sure we travel in the same direction
    if (nextDirection.dot(params.previousDirection) < 0) nextDirection.negate();
    const nextPoint = params.previousPoint.clone().add(nextDirection);
    if (this.pointInBounds(nextPoint)
      && this.isValidSample(major, nextPoint, this.paramsSq.dtest, collideBoth)
      && !this.streamlineTurned(params.seed, params.originalDir, nextPoint, nextDirection)) {
      params.previousPoint = nextPoint; params.previousDirection = nextDirection;
    } else {
      // One more step
      params.streamline.push(nextPoint); params.valid = false;
    }
  }
  // Integrating in both directions at once reduces the impact of circles not joining up
  integrateStreamline(seed, major) {
    let count = 0, pointsEscaped = false;  // True once two integration fronts have moved dlookahead away
    const collideBoth = this.random() < this.params.collideEarly;
    const d = this.integrator.integrate(seed, major);
    const forwardParams = { seed, originalDir: d, streamline: [seed], previousDirection: d, previousPoint: seed.clone().add(d), valid: true };
    forwardParams.valid = this.pointInBounds(forwardParams.previousPoint);
    const negD = d.clone().negate();
    const backwardParams = { seed, originalDir: negD, streamline: [], previousDirection: negD, previousPoint: seed.clone().add(negD), valid: true };
    backwardParams.valid = this.pointInBounds(backwardParams.previousPoint);
    while (count < this.params.pathIterations && (forwardParams.valid || backwardParams.valid)) {
      this.streamlineIntegrationStep(forwardParams, major, collideBoth);
      this.streamlineIntegrationStep(backwardParams, major, collideBoth);
      // Join up circles
      const sqDistanceBetweenPoints = forwardParams.previousPoint.distanceToSquared(backwardParams.previousPoint);
      if (!pointsEscaped && sqDistanceBetweenPoints > this.paramsSq.dcirclejoin) pointsEscaped = true;
      if (pointsEscaped && sqDistanceBetweenPoints <= this.paramsSq.dcirclejoin) {
        forwardParams.streamline.push(forwardParams.previousPoint);
        forwardParams.streamline.push(backwardParams.previousPoint);
        backwardParams.streamline.push(backwardParams.previousPoint);
        break;
      }
      count++;
    }
    backwardParams.streamline.reverse().push(...forwardParams.streamline);
    return backwardParams.streamline;
  }
}
