import Vector from './vector.js';

// Douglas-Peucker with a radial-distance pre-pass, after simplify-js.
const sqDist = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
function sqSegDist(p, a, b) {
  let x = a.x, y = a.y, dx = b.x - x, dy = b.y - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b.x; y = b.y; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p.x - x; dy = p.y - y;
  return dx * dx + dy * dy;
}
function step(points, first, last, sqTolerance, out) {
  let maxSqDist = sqTolerance, index = -1;
  for (let i = first + 1; i < last; i++) {
    const d = sqSegDist(points[i], points[first], points[last]);
    if (d > maxSqDist) { index = i; maxSqDist = d; }
  }
  if (index < 0) return;
  if (index - first > 1) step(points, first, index, sqTolerance, out);
  out.push(points[index]);
  if (last - index > 1) step(points, index, last, sqTolerance, out);
}
export function simplify(points, tolerance = 1) {
  if (points.length <= 2) return points.map(p => new Vector(p.x, p.y));
  const sqTolerance = tolerance * tolerance;
  let previous = points[0], point = previous;
  const radial = [previous];
  for (let i = 1; i < points.length; i++) {
    point = points[i];
    if (sqDist(point, previous) > sqTolerance) { radial.push(point); previous = point; }
  }
  if (previous !== point) radial.push(point);
  const last = radial.length - 1, out = [radial[0]];
  step(radial, 0, last, sqTolerance, out);
  out.push(radial[last]);
  return out.map(p => new Vector(p.x, p.y));
}
