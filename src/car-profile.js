import * as THREE from 'three';

// A car's height along its length, as loose pieces meet it (see
// LooseProps.contact): read once from its model, the highest point of it in
// each slice from tail to nose. A box as tall as the roof sign stood a wall
// up in front of the windscreen, and shoved a lamp post bodily down the
// street; this has the bonnet low and the windscreen set back, and a
// truck's cab flat up to its roof. Heights are over where the tyres meet
// the ground (the model's y = 0); forward is the model's -z.
export const SLICE = .25;
const toModel = new THREE.Matrix4(), partMatrix = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3();
export function carProfile(model, length) {
  const count = Math.max(1, Math.ceil(length / SLICE)), heights = new Float32Array(count), half = length / 2;
  // (each edge walked in short steps: a panel's height is at its edges, and a
  // raked windscreen stays a slope rather than one step as tall as its top)
  const mark = (along, y) => {
    const k = Math.floor((along + half) / SLICE);
    if (k >= 0 && k < count && y > heights[k]) heights[k] = y;
  };
  model.updateMatrixWorld(true); toModel.copy(model.matrixWorld).invert();
  model.traverse(part => {
    const position = part.geometry?.attributes.position;
    if (!position || part.isInstancedMesh) return;
    partMatrix.multiplyMatrices(toModel, part.matrixWorld);
    const index = part.geometry.index?.array, total = index ? index.length : position.count, corner = i => index ? index[i] : i;
    for (let t = 0; t + 2 < total; t += 3) for (let e = 0; e < 3; e++) {
      a.fromBufferAttribute(position, corner(t + e)).applyMatrix4(partMatrix);
      b.fromBufferAttribute(position, corner(t + (e + 1) % 3)).applyMatrix4(partMatrix);
      const steps = Math.max(1, Math.ceil(Math.abs(a.z - b.z) / (SLICE / 2)));
      for (let k = 0; k <= steps; k++) mark(-(a.z + (b.z - a.z) * k / steps), a.y + (b.y - a.y) * k / steps);
    }
  });
  let height = 0;
  for (const h of heights) height = Math.max(height, h);
  if (!height) heights.fill(height = 1.5);
  return { heights, slice: SLICE, length, height };
}
