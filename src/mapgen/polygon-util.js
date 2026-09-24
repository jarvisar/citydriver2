import Vector from './vector.js';

// Polygon and polyline geometry for the map generator. MapGenerator used jsts
// buffers, PolyK slices and isect sweeps here; these small routines cover the
// cases the generator actually needs: point tests, insetting a block into
// lots, buffering a river line, slicing a lot in two and closing a coastline
// against the domain rectangle.

export function signedArea(polygon) {
  let total = 0;
  for (let i = 0, n = polygon.length; i < n; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n];
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
}
export const calcPolygonArea = polygon => Math.abs(signedArea(polygon));

export function averagePoint(polygon) {
  if (polygon.length === 0) return Vector.zeroVector();
  const sum = Vector.zeroVector();
  for (const v of polygon) sum.add(v);
  return sum.divideScalar(polygon.length);
}

// The centre of area, which unlike the vertex average does not drift toward
// the densely sampled side of a curved block.
export function polygonCentroid(polygon) {
  let area = 0, x = 0, y = 0;
  for (let i = 0, n = polygon.length; i < n; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n], cross = a.x * b.y - b.x * a.y;
    area += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-9) return averagePoint(polygon);
  return new Vector(x / (3 * area), y / (3 * area));
}

export function polygonBounds(polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}

// Ray casting, after W. Randolph Franklin's pnpoly.
export function insidePolygon(point, polygon) {
  const n = polygon.length;
  if (n === 0) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y, xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > point.y) !== (yj > point.y) && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInRectangle(point, origin, dimensions) {
  return point.x >= origin.x && point.y >= origin.y && point.x <= origin.x + dimensions.x && point.y <= origin.y + dimensions.y;
}

// Drops repeated consecutive vertices, including a closing repeat of the first.
export function dedupePolygon(polygon, minDistance = 1e-6) {
  const out = [], apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) > minDistance;
  for (const p of polygon) if (!out.length || apart(out[out.length - 1], p)) out.push(p);
  while (out.length > 1 && !apart(out[0], out[out.length - 1])) out.pop();
  return out;
}

// Where two segments cross, or null. A negative tolerance ignores crossings
// at the very ends, so a polygon touching itself at a vertex is not a cross.
export function segmentIntersection(p1, p2, p3, p4, tolerance = 1e-9) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y, d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < 1e-12) return null;
  const dx = p3.x - p1.x, dy = p3.y - p1.y;
  const t = (dx * d2y - dy * d2x) / denominator, u = (dx * d1y - dy * d1x) / denominator;
  if (t < -tolerance || t > 1 + tolerance || u < -tolerance || u > 1 + tolerance) return null;
  return new Vector(p1.x + d1x * t, p1.y + d1y * t);
}

// True when no two non-adjacent edges cross.
export function isSimple(polygon) {
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentIntersection(a, b, polygon[j], polygon[(j + 1) % n], -1e-9)) return false;
    }
  }
  return true;
}

export function distanceToPolyline(point, points) {
  let closest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    closest = Math.min(closest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return closest;
}

// A polyline moved sideways by `distance` (positive to its left), with
// mitred corners that are clipped at sharp angles.
export function offsetPolyline(points, distance) {
  const n = points.length;
  if (n < 2) return points.map(p => p.clone());
  const normals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x, dy = points[i + 1].y - points[i].y, length = Math.hypot(dx, dy) || 1;
    normals.push([-dy / length, dx / length]);
  }
  return points.map((p, i) => {
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(i, n - 2)];
    const dot = Math.max(.25, 1 + a[0] * b[0] + a[1] * b[1]);
    return new Vector(p.x + (a[0] + b[0]) / dot * distance, p.y + (a[1] + b[1]) / dot * distance);
  });
}

// Cuts out the small loops an offset makes on the inside of a bend tighter
// than the offset distance: where two nearby segments cross, everything
// between them goes and the crossing joins the line up.
export function removeLoops(points, window = 24) {
  const out = points.slice();
  for (let i = 0; i < out.length - 3; i++) {
    for (let j = Math.min(out.length - 2, i + window); j >= i + 2; j--) {
      const hit = segmentIntersection(out[i], out[i + 1], out[j], out[j + 1], -1e-9);
      if (hit) { out.splice(i + 1, j - i, hit); break; }
    }
  }
  return out;
}
// A polyline offset sideways with its inside-bend loops removed
export function offsetPolylineClean(points, distance) { return removeLoops(offsetPolyline(points, distance)); }

// The area within `width` of a polyline, with flat ends: a river channel or a
// road surface. Replaces a jsts line buffer with CAP_FLAT.
export function bufferPolyline(line, width) {
  const points = dedupePolygon(line, 1e-6);
  if (points.length < 2) return [];
  const left = offsetPolylineClean(points, width), right = offsetPolylineClean(points, -width).reverse();
  return dedupePolygon(left.concat(right));
}

// The polygon grown (positive) or shrunk (negative) by `distance`, which may
// also be a function of each edge (a, b, index) so streets of different
// widths leave different setbacks. Returns [] when the shape collapses, as the
// original did when jsts returned a non-simple result.
export function offsetPolygon(input, distance) {
  let polygon = dedupePolygon(input);
  if (polygon.length < 3) return [];
  if (signedArea(polygon) < 0) polygon = polygon.slice().reverse();
  return offsetPolygonMapped(polygon, distance)?.points ?? [];
}

// The same offset for a clean counter-clockwise polygon, also saying which
// output vertex each input vertex became: source[k] is the index in points of
// input vertex k. Edges that collapse share their neighbours' vertex, so the
// map runs round the output in order. Returns null when the shape collapses.
export function offsetPolygonMapped(polygon, distance) {
  const distanceOf = typeof distance === 'function' ? distance : () => distance;
  const n = polygon.length;
  if (n < 3) return null;
  // edges[i] runs from vertex i to i + 1; counter-clockwise, so (dy, -dx) points outward
  const edges = polygon.map((a, i) => {
    const b = polygon[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1e-12, d = distanceOf(a, b, i);
    return { dx: dx / length, dy: dy / length, ox: a.x + dy / length * d, oy: a.y - dx / length * d, d };
  });
  const meet = (e0, e1, near) => {
    const cross = e0.dx * e1.dy - e0.dy * e1.dx, limit = 3 * Math.max(Math.abs(e0.d), Math.abs(e1.d)) + 1e-6;
    let x, y;
    if (Math.abs(cross) < 1e-9) {
      x = (near.x + e0.dy * e0.d + near.x + e1.dy * e1.d) / 2; y = (near.y - e0.dx * e0.d + near.y - e1.dx * e1.d) / 2;
    } else {
      const t = ((e1.ox - e0.ox) * e1.dy - (e1.oy - e0.oy) * e1.dx) / cross;
      x = e0.ox + e0.dx * t; y = e0.oy + e0.dy * t;
    }
    // Only where the two offset lines diverge (growing round an outside corner,
    // shrinking round an inside one) is a far mitre wrong; there it is cut
    // back. Shrinking round a sharp outside corner the far mitre is the
    // corner, and cutting it back would leave the edge too close to its road.
    if ((cross * (e0.d + e1.d) > 0 || Math.abs(cross) < 1e-9) && Math.hypot(x - near.x, y - near.y) > limit) {
      const ax = e0.dy + e1.dy, ay = -e0.dx - e1.dx, al = Math.hypot(ax, ay) || 1, d = (e0.d + e1.d) / 2;
      x = near.x + ax / al * d; y = near.y + ay / al * d;
    }
    return new Vector(x, y);
  };
  let verts = polygon.map((p, i) => meet(edges[(i - 1 + n) % n], edges[i], p)), edgeList = edges.slice();
  let owners = polygon.map((p, i) => [i]);
  // An edge that now runs backwards has collapsed: its two ends become the one
  // point where its neighbours' offset lines meet.
  for (let guard = 0; guard < n; guard++) {
    const m = verts.length;
    if (m < 3) return null;
    let flipped = -1;
    for (let k = 0; k < m; k++) {
      const a = verts[k], b = verts[(k + 1) % m];
      if ((b.x - a.x) * edgeList[k].dx + (b.y - a.y) * edgeList[k].dy < 0) { flipped = k; break; }
    }
    if (flipped < 0) break;
    if (flipped === m - 1) { verts.push(verts.shift()); edgeList.push(edgeList.shift()); owners.push(owners.shift()); flipped = m - 2; }
    const middle = new Vector((verts[flipped].x + verts[flipped + 1].x) / 2, (verts[flipped].y + verts[flipped + 1].y) / 2);
    verts.splice(flipped, 2, meet(edgeList[(flipped - 1 + m) % m], edgeList[(flipped + 1) % m], middle));
    owners.splice(flipped, 2, owners[flipped].concat(owners[flipped + 1]));
    edgeList.splice(flipped, 1);
  }
  // Merge coincident neighbours, keeping every owner
  const points = [], merged = [];
  verts.forEach((v, k) => {
    if (points.length && Math.hypot(points[points.length - 1].x - v.x, points[points.length - 1].y - v.y) <= 1e-6) merged[merged.length - 1].push(...owners[k]);
    else { points.push(v); merged.push(owners[k].slice()); }
  });
  while (points.length > 1 && Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) <= 1e-6) { merged[0].push(...merged.pop()); points.pop(); }
  if (points.length < 3 || signedArea(points) <= 0 || !isSimple(points)) return null;
  const source = new Array(n);
  merged.forEach((list, index) => { for (const k of list) source[k] = index; });
  return { points, source };
}

// The biggest rectangle square to the street (along ux, uy) that fits in a
// polygon: a house on a lot whose own outline is a wedge or an L.
export function fitRectangle(polygon, ux, uy) {
  const vx = -uy, vy = ux, centre = averagePoint(polygon);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of polygon) {
    const u = (p.x - centre.x) * ux + (p.y - centre.y) * uy, v = (p.x - centre.x) * vx + (p.y - centre.y) * vy;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const corners = (a, b, c, d) => [[a, c], [b, c], [b, d], [a, d]].map(([u, v]) => ({ x: centre.x + ux * u + vx * v, y: centre.y + uy * u + vy * v }));
  // Inside when its corners are and no edge of a concave polygon (a street
  // biting into a lot) cuts across it
  const crossed = rect => polygon.some((p, i) => rect.some((a, k) => segmentIntersection(a, rect[(k + 1) % 4], p, polygon[(i + 1) % polygon.length], -1e-9)));
  for (let k = 0; k < 24; k++) {
    const shrink = 1 - k * .04, rect = corners(u0 * shrink, u1 * shrink, v0 * shrink, v1 * shrink);
    if (rect.every(p => insidePolygon(p, polygon)) && !crossed(rect)) return rect;
  }
  return null;
}
// Both sides of the polygon cut by the infinite line through p1 and p2.
export function slicePolygon(polygon, p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y, n = polygon.length;
  const side = v => dx * (v.y - p1.y) - dy * (v.x - p1.x);
  const clip = keepPositive => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = polygon[i], b = polygon[(i + 1) % n], da = side(a), db = side(b);
      const insideA = keepPositive ? da >= 0 : da <= 0, insideB = keepPositive ? db >= 0 : db <= 0;
      if (insideA) out.push(a);
      if (insideA !== insideB) { const t = da / (da - db); out.push(new Vector(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)); }
    }
    return dedupePolygon(out);
  };
  return [clip(true), clip(false)].filter(piece => piece.length >= 3 && calcPolygonArea(piece) > 1e-6);
}

// Recursively divide a polygon across its longest side until the pieces are
// between half and twice minArea. Final pieces narrower than a 1:4 rectangle
// are dropped; a long block is still cut across, into lots that fit.
export function subdividePolygon(p, minArea, random = Math.random) {
  const area = calcPolygonArea(p);
  if (area < .5 * minArea) return [];
  let longestSideLength = 0, longestSide = [p[0], p[1]], perimeter = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], sideLength = a.distanceTo(b);
    perimeter += sideLength;
    if (sideLength > longestSideLength) { longestSideLength = sideLength; longestSide = [a, b]; }
  }
  // Shape index: nothing narrower than a 1:4 rectangle is a lot, and a strip
  // narrower than about 1:20 is not worth cutting at all. (A big block with a
  // long, winding outline has as low an index, and is cut all the same.)
  const shape = area / (perimeter * perimeter);
  if (shape < .012 && area < 12 * minArea) return [];
  if (area < 2 * minArea) return shape < .04 ? [] : [p];
  // Between 0.4 and 0.6 of the way along the longest side
  const deviation = random() * .2 + .4;
  const cut = longestSide[0].clone().add(longestSide[1].clone().sub(longestSide[0]).multiplyScalar(deviation));
  const difference = longestSide[1].clone().sub(longestSide[0]);
  const perpendicular = new Vector(difference.y, -difference.x).normalize().multiplyScalar(100);
  const pieces = slicePolygon(p, cut.clone().add(perpendicular), cut.clone().sub(perpendicular));
  if (pieces.length < 2 || pieces.some(piece => !isSimple(piece))) return [p];
  const divided = [];
  for (const piece of pieces) divided.push(...subdividePolygon(piece, minArea, random));
  return divided;
}

// The point where the segment from an inside point to an outside point leaves
// the rectangle.
function rectangleExit(inside, outside, minX, minY, maxX, maxY) {
  const dx = outside.x - inside.x, dy = outside.y - inside.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (maxX - inside.x) / dx); else if (dx < 0) t = Math.min(t, (minX - inside.x) / dx);
  if (dy > 0) t = Math.min(t, (maxY - inside.y) / dy); else if (dy < 0) t = Math.min(t, (minY - inside.y) / dy);
  return new Vector(Math.min(maxX, Math.max(minX, inside.x + dx * t)), Math.min(maxY, Math.max(minY, inside.y + dy * t)));
}

// The smaller of the two regions a polyline cuts the rectangle into: the sea
// side of a coastline. The line is expected to enter and leave the rectangle;
// any excursion outside it in between is flattened onto the boundary.
export function lineRectanglePolygon(origin, dimensions, line) {
  const minX = origin.x, minY = origin.y, maxX = origin.x + dimensions.x, maxY = origin.y + dimensions.y;
  const inside = p => p.x > minX && p.x < maxX && p.y > minY && p.y < maxY;
  const first = line.findIndex(inside);
  let last = line.length - 1;
  while (last >= 0 && !inside(line[last])) last--;
  if (first < 0 || last < first) return [];
  const clamp = p => new Vector(Math.min(maxX, Math.max(minX, p.x)), Math.min(maxY, Math.max(minY, p.y)));
  const entry = first > 0 ? rectangleExit(line[first], line[first - 1], minX, minY, maxX, maxY) : clamp(line[0]);
  const exit = last < line.length - 1 ? rectangleExit(line[last], line[last + 1], minX, minY, maxX, maxY) : clamp(line[last]);
  const chain = [entry, ...line.slice(first, last + 1).map(clamp), exit];
  const w = dimensions.x, h = dimensions.y, perimeter = 2 * (w + h);
  // Distance along the boundary, counter-clockwise from the origin corner
  const param = p => {
    if (Math.abs(p.y - minY) < 1e-6) return p.x - minX;
    if (Math.abs(p.x - maxX) < 1e-6) return w + (p.y - minY);
    if (Math.abs(p.y - maxY) < 1e-6) return w + h + (maxX - p.x);
    return 2 * w + h + (maxY - p.y);
  };
  const corners = [new Vector(minX, minY), new Vector(maxX, minY), new Vector(maxX, maxY), new Vector(minX, maxY)];
  const cornerParams = [0, w, w + h, 2 * w + h];
  const from = param(exit), to = param(entry);
  const build = ccw => {
    const span = ccw ? (to - from + perimeter) % perimeter : (from - to + perimeter) % perimeter;
    const between = [];
    for (let k = 0; k < 4; k++) {
      const d = ccw ? (cornerParams[k] - from + perimeter) % perimeter : (from - cornerParams[k] + perimeter) % perimeter;
      if (d > 1e-6 && d < span - 1e-6) between.push({ d, corner: corners[k] });
    }
    between.sort((a, b) => a.d - b.d);
    return dedupePolygon(chain.concat(between.map(item => item.corner)));
  };
  const a = build(true), b = build(false);
  return calcPolygonArea(a) <= calcPolygonArea(b) ? a : b;
}

export function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
  return length;
}

// The polyline with both ends carried straight on by `distance`.
export function extendPolyline(line, distance) {
  if (line.length < 2) return line.slice();
  const first = line[0].clone().add(line[0].clone().sub(line[1]).setLength(distance));
  const last = line[line.length - 1].clone().add(line[line.length - 1].clone().sub(line[line.length - 2]).setLength(distance));
  return [first, ...line, last];
}

// Splits a polygon along a polyline that crosses it, returning the piece on
// each side. When the line crosses more than twice, the longest run inside the
// polygon is the cut and the rest of the line is ignored. Without a crossing
// the polygon is returned whole.
export function splitPolygonByPolyline(polygon, line) {
  const n = polygon.length, crossings = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    for (let j = 0; j < n; j++) {
      const c = polygon[j], d = polygon[(j + 1) % n], p = segmentIntersection(a, b, c, d, 1e-9);
      if (!p) continue;
      const t = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (p.x - a.x) / (b.x - a.x) : (p.y - a.y) / (b.y - a.y);
      const u = Math.abs(d.x - c.x) > Math.abs(d.y - c.y) ? (p.x - c.x) / (d.x - c.x) : (p.y - c.y) / (d.y - c.y);
      crossings.push({ line: i, t, edge: j, u, point: p });
    }
  }
  crossings.sort((p, q) => p.line - q.line || p.t - q.t);
  if (crossings.length < 2) return [polygon];
  const chainBetween = (e, x) => e.line === x.line ? [e.point, x.point] : [e.point, ...line.slice(e.line + 1, x.line + 1), x.point];
  let best = null, entry = null, exit = null, bestLength = -1;
  for (let k = 0; k + 1 < crossings.length; k++) {
    const chain = chainBetween(crossings[k], crossings[k + 1]);
    const a = chain[Math.floor((chain.length - 1) / 2)], b = chain[Math.ceil((chain.length - 1) / 2)];
    if (!insidePolygon(new Vector((a.x + b.x) / 2, (a.y + b.y) / 2), polygon)) continue;
    const length = polylineLength(chain);
    if (length > bestLength) { bestLength = length; best = chain; entry = crossings[k]; exit = crossings[k + 1]; }
  }
  if (!best) return [polygon];
  const forward = [], backward = [];
  if (!(exit.edge === entry.edge && exit.u <= entry.u)) {
    let j = (exit.edge + 1) % n;
    for (let guard = 0; guard < n; guard++) { forward.push(polygon[j]); if (j === entry.edge) break; j = (j + 1) % n; }
  }
  if (!(exit.edge === entry.edge && exit.u >= entry.u)) {
    let j = exit.edge;
    for (let guard = 0; guard < n; guard++) { backward.push(polygon[j]); if (j === (entry.edge + 1) % n) break; j = (j - 1 + n) % n; }
  }
  return [best.concat(forward), best.concat(backward)].map(piece => dedupePolygon(piece)).filter(piece => piece.length >= 3);
}

// A point well inside a polygon, however it bends: the middles of the spans
// along a few horizontal lines, and of those the one furthest from an edge.
// (A centroid can fall outside a U-shaped polygon.)
export function interiorPoint(polygon, lines = 11) {
  const n = polygon.length, bounds = polygonBounds(polygon);
  let best = null, bestDistance = -1;
  for (let k = 0; k < lines; k++) {
    const y = bounds.minY + (bounds.maxY - bounds.minY) * (k + .5) / lines, crossings = [];
    for (let i = 0; i < n; i++) {
      const a = polygon[i], b = polygon[(i + 1) % n];
      if ((a.y > y) !== (b.y > y)) crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const p = new Vector((crossings[i] + crossings[i + 1]) / 2, y);
      let distance = Infinity;
      for (let j = 0; j < n; j++) distance = Math.min(distance, pointSegmentDistance(p, polygon[j], polygon[(j + 1) % n]));
      if (distance > bestDistance) { bestDistance = distance; best = p; }
    }
  }
  return best ?? averagePoint(polygon);
}
function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

