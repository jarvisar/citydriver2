// Mutable 2D vector, as in MapGenerator: methods change the vector and return
// it, so callers clone before deriving a new one.
export default class Vector {
  constructor(x, y) { this.x = x; this.y = y; }
  static zeroVector() { return new Vector(0, 0); }
  static fromScalar(s) { return new Vector(s, s); }
  // -pi to pi
  static angleBetween(v1, v2) {
    let angle = v1.angle() - v2.angle();
    if (angle > Math.PI) angle -= 2 * Math.PI;
    else if (angle <= -Math.PI) angle += 2 * Math.PI;
    return angle;
  }
  static isLeft(linePoint, lineDirection, point) {
    const perpendicular = new Vector(lineDirection.y, -lineDirection.x);
    return point.clone().sub(linePoint).dot(perpendicular) < 0;
  }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  angle() { return Math.atan2(this.y, this.x); }
  clone() { return new Vector(this.x, this.y); }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  cross(v) { return this.x * v.y - this.y * v.x; }
  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y; return dx * dx + dy * dy; }
  divide(v) { if (v.x === 0 || v.y === 0) return this; this.x /= v.x; this.y /= v.y; return this; }
  divideScalar(s) { return s === 0 ? this : this.multiplyScalar(1 / s); }
  dot(v) { return this.x * v.x + this.y * v.y; }
  equals(v) { return v.x === this.x && v.y === this.y; }
  length() { return Math.sqrt(this.lengthSq()); }
  lengthSq() { return this.x * this.x + this.y * this.y; }
  multiply(v) { this.x *= v.x; this.y *= v.y; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; return this; }
  negate() { return this.multiplyScalar(-1); }
  normalize() { const l = this.length(); return l === 0 ? this : this.divideScalar(l); }
  rotateAround(center, angle) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const x = this.x - center.x, y = this.y - center.y;
    this.x = x * cos - y * sin + center.x; this.y = x * sin + y * cos + center.y;
    return this;
  }
  set(v) { this.x = v.x; this.y = v.y; return this; }
  setX(x) { this.x = x; return this; }
  setY(y) { this.y = y; return this; }
  setLength(length) { return this.normalize().multiplyScalar(length); }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
}
