import * as THREE from 'three';
import { compactGeometry } from './compact-geometry.js';

// Spend vertices on broad silhouettes, not tiny props. These templates are
// shared by every site and detail level; none are rebuilt during streaming.
export const ROUND_SEGMENTS = 24;
export function ellipsePoints(x, s, w, d, segments = ROUND_SEGMENTS) {
  return Array.from({ length: segments }, (_, i) => {
    const angle = i / segments * Math.PI * 2;
    return [x + Math.cos(angle) * w / 2, s + Math.sin(angle) * d / 2];
  });
}

const circle = ellipsePoints(0, 0, 2, 2);

function basinGeometry(outline) {
  const vertices = [];
  const triangle = (a, b, c) => vertices.push(...a, ...b, ...c);
  const point = (p, radius, y) => [p[0] * radius, y, -p[1] * radius];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const ao = point(a, 1, .5), bo = point(b, 1, .5);
    const ai = point(a, .94, .5), bi = point(b, .94, .5);
    const ab = point(a, 1, -.5), bb = point(b, 1, -.5);
    const al = point(a, .94, -.5), bl = point(b, .94, -.5);
    // Coping, exterior and recessed inner wall. No buried bottom or floor.
    triangle(ao, bo, bi); triangle(ao, bi, ai);
    triangle(ab, bb, bo); triangle(ab, bo, ao);
    triangle(ai, bi, bl); triangle(ai, bl, al);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return compactGeometry(geometry);
}
function waterGeometry(outline) {
  const vertices = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    vertices.push(0, 0, 0, a[0], 0, -a[1], b[0], 0, -b[1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return compactGeometry(geometry);
}
export const basinRim = basinGeometry(circle);
export const basinWater = waterGeometry(circle);
