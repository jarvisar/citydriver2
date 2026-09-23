import Vector from './vector.js';

export class FieldIntegrator {
  constructor(field) { this.field = field; }
  sampleFieldVector(point, major) {
    const tensor = this.field.samplePoint(point);
    return major ? tensor.getMajor() : tensor.getMinor();
  }
  onLand(point) { return this.field.onLand(point); }
}

export class EulerIntegrator extends FieldIntegrator {
  constructor(field, params) { super(field); this.params = params; }
  integrate(point, major) { return this.sampleFieldVector(point, major).multiplyScalar(this.params.dstep); }
}

export class RK4Integrator extends FieldIntegrator {
  constructor(field, params) { super(field); this.params = params; }
  integrate(point, major) {
    const k1 = this.sampleFieldVector(point, major);
    const k23 = this.sampleFieldVector(point.clone().add(Vector.fromScalar(this.params.dstep / 2)), major);
    const k4 = this.sampleFieldVector(point.clone().add(Vector.fromScalar(this.params.dstep)), major);
    return k1.add(k23.multiplyScalar(4)).add(k4).multiplyScalar(this.params.dstep / 6);
  }
}
