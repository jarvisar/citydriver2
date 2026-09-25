import Vector from './vector.js';

// A 2D symmetric traceless tensor stored as [cos 2θ, sin 2θ] scaled by r. Its
// major eigenvector points along the local street direction, the minor one
// across it.
export default class Tensor {
  constructor(r, matrix) { this.r = r; this.matrix = matrix; this.oldTheta = false; this._theta = this.calculateTheta(); }
  static get zero() { return new Tensor(0, [0, 0]); }
  get theta() {
    if (this.oldTheta) { this._theta = this.calculateTheta(); this.oldTheta = false; }
    return this._theta;
  }
  // The weighted sum of basis fields. (MapGenerator sets r to 2 after each
  // add without smoothing, which doubles everything added before: the first
  // field of five weighed sixteen times the last.)
  add(tensor, smooth) {
    this.matrix = this.matrix.map((v, i) => v * this.r + tensor.matrix[i] * tensor.r);
    if (smooth) {
      this.r = Math.hypot(...this.matrix);
      this.matrix = this.matrix.map(v => v / this.r);
    } else this.r = 1;
    this.oldTheta = true;
    return this;
  }
  scale(s) { this.r *= s; this.oldTheta = true; return this; }
  // Radians
  rotate(theta) {
    if (theta === 0) return this;
    let newTheta = this.theta + theta;
    if (newTheta < Math.PI) newTheta += Math.PI;
    if (newTheta >= Math.PI) newTheta -= Math.PI;
    this.matrix[0] = Math.cos(2 * newTheta) * this.r;
    this.matrix[1] = Math.sin(2 * newTheta) * this.r;
    this._theta = newTheta;
    return this;
  }
  getMajor() {
    if (this.r === 0) return Vector.zeroVector();
    return new Vector(Math.cos(this.theta), Math.sin(this.theta));
  }
  getMinor() {
    if (this.r === 0) return Vector.zeroVector();
    const angle = this.theta + Math.PI / 2;
    return new Vector(Math.cos(angle), Math.sin(angle));
  }
  calculateTheta() {
    if (this.r === 0) return 0;
    return Math.atan2(this.matrix[1] / this.r, this.matrix[0] / this.r) / 2;
  }
}
