import Tensor from './tensor.js';

export const FIELD_TYPE = Object.freeze({ Radial: 0, Grid: 1 });

// Grid or radial field, combined with others to make the tensor field. Its
// weight falls off from the centre over `size`, shaped by `decay`.
export class BasisField {
  constructor(centre, size, decay) { this._centre = centre.clone(); this._size = size; this._decay = decay; }
  set centre(centre) { this._centre.copy(centre); }
  get centre() { return this._centre.clone(); }
  set decay(decay) { this._decay = decay; }
  set size(size) { this._size = size; }
  getWeightedTensor(point, smooth) { return this.getTensor(point).scale(this.getTensorWeight(point, smooth)); }
  // Interpolates between (0 and 1)^decay
  getTensorWeight(point, smooth) {
    const normDistanceToCentre = point.clone().sub(this._centre).length() / this._size;
    if (smooth) return normDistanceToCentre ** -this._decay;
    // Stop (** 0) turning weight into 1, filling the domain even when outside 'size'
    if (this._decay === 0 && normDistanceToCentre >= 1) return 0;
    return Math.max(0, 1 - normDistanceToCentre) ** this._decay;
  }
}

export class Grid extends BasisField {
  constructor(centre, size, decay, theta) { super(centre, size, decay); this._theta = theta; this.FIELD_TYPE = FIELD_TYPE.Grid; }
  set theta(theta) { this._theta = theta; }
  get theta() { return this._theta; }
  getTensor() { return new Tensor(1, [Math.cos(2 * this._theta), Math.sin(2 * this._theta)]); }
}

export class Radial extends BasisField {
  constructor(centre, size, decay) { super(centre, size, decay); this.FIELD_TYPE = FIELD_TYPE.Radial; }
  getTensor(point) {
    const t = point.clone().sub(this._centre);
    return new Tensor(1, [t.y ** 2 - t.x ** 2, -2 * t.x * t.y]);
  }
}
