export class FieldIntegrator {
  constructor(field) { this.field = field; }
  sampleFieldVector(point, major) {
    const tensor = this.field.samplePoint(point);
    return major ? tensor.getMajor() : tensor.getMinor();
  }
  onLand(point) { return this.field.onLand(point); }
}

// One step of dstep along the field, by fourth-order Runge-Kutta. An
// eigenvector has no sign, so each sample is turned to agree with the one
// before it, the first with `direction` (the way the streamline is going)
// when there is one. (MapGenerator samples at a fixed diagonal offset from the
// point, whatever the way ahead, and adds the samples whichever way they
// face, so its steps shrink and drift wherever the field turns.)
export class RK4Integrator extends FieldIntegrator {
  constructor(field, params) { super(field); this.params = params; }
  integrate(point, major, direction = null) {
    const h = this.params.dstep, facing = (v, towards) => (towards && v.dot(towards) < 0 ? v.negate() : v);
    const k1 = facing(this.sampleFieldVector(point, major), direction);
    if (k1.lengthSq() === 0) return k1;
    const k2 = facing(this.sampleFieldVector(point.clone().add(k1.clone().multiplyScalar(h / 2)), major), k1);
    const k3 = facing(this.sampleFieldVector(point.clone().add(k2.clone().multiplyScalar(h / 2)), major), k1);
    const k4 = facing(this.sampleFieldVector(point.clone().add(k3.clone().multiplyScalar(h)), major), k1);
    return k1.add(k2.multiplyScalar(2)).add(k3.multiplyScalar(2)).add(k4).multiplyScalar(h / 6);
  }
}
