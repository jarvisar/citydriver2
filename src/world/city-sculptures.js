import * as THREE from 'three';
import { rectanglePolygon, subtractPolygon } from './city-surfaces.js';
import { compactGeometry } from './compact-geometry.js';

// Both tilted beams have the same depth. Cut the gold beam around the orange
// one so their front and rear faces meet without overlapping coplanar patches.
// Coordinates are relative to the sculpture's center and pavement height.
const orange = rectanglePolygon(-3, 11, 5, 22, -.35);
const gold = rectanglePolygon(4, 19, 5, 17, .8);
const extrude = polygons => {
  const shapes = polygons.map(points => {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    return shape;
  });
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 5, steps: 1, bevelEnabled: false });
  geometry.translate(0, 0, -2.5);
  return compactGeometry(geometry);
};
// The gold beam leans out from the top of the orange one, which stands on
// the plinth; they are drawn in two colours, so each is its own geometry
export const balancingBeam = extrude(subtractPolygon(gold, orange));
export const standingBeam = extrude([orange]);
export const STANDING_BEAM = '#d19a3c';
