import * as THREE from 'three';

// A car's height along its length, as loose pieces meet it (see
// LooseProps.contact): read once from its model, the highest point of it in
// each slice from tail to nose. A box as tall as the roof sign stood a wall
// up in front of the windscreen, and shoved a lamp post bodily down the
// street; this has the bonnet low and the windscreen set back, and a
// truck's cab flat up to its roof. Heights are over where the tires meet
// the ground (the model's y = 0); forward is the model's -z. `sides` leaves
// out the middle meter, where a cab's roof sign stands: counted all the way
// across, a post caught behind it off to one side rode along for good.
export const SLICE = .25, MIDDLE = .5;
const toModel = new THREE.Matrix4(), partMatrix = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3();
export function carProfile(model, length) {
  const count = Math.max(1, Math.ceil(length / SLICE)), heights = new Float32Array(count), sides = new Float32Array(count), half = length / 2;
  // (each edge walked in short steps: a panel's height is at its edges, and a
  // raked windscreen stays a slope rather than one step as tall as its top)
  const mark = (along, y, x) => {
    const k = Math.floor((along + half) / SLICE);
    if (k < 0 || k >= count) return;
    if (y > heights[k]) heights[k] = y;
    if (Math.abs(x) >= MIDDLE && y > sides[k]) sides[k] = y;
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
      for (let k = 0; k <= steps; k++) mark(-(a.z + (b.z - a.z) * k / steps), a.y + (b.y - a.y) * k / steps, a.x + (b.x - a.x) * k / steps);
    }
  });
  let height = 0;
  for (const h of heights) height = Math.max(height, h);
  if (!height) { heights.fill(height = 1.5); sides.fill(height); }
  return { heights, sides, slice: SLICE, length, height };
}
// Where a car's boost flames come out, in its body's meters (x right, z
// back): low on the back of the car, found by casting rays at its tail. The
// backs differ too much for one place: a fixed .36 m up and half the length
// back hung under the classic's high tail and floated behind the Formula's
// gearbox. TAIL_DEEP is how far a face can be in front of the back and still
// count as the back (more is under the car: an axle, the floor).
const TAIL_DEEP = .3, TAIL_SIDES = [.34, .26, .18];
const caster = new THREE.Raycaster(), toBody = new THREE.Matrix4(), from = new THREE.Vector3(), back = new THREE.Vector3();
export function tailPipes(body) {
  body.updateWorldMatrix(true, true); toBody.copy(body.matrixWorld).invert();
  const box = new THREE.Box3().setFromObject(body).applyMatrix4(toBody), behind = box.max.z + 1;
  back.set(0, 0, -1).transformDirection(body.matrixWorld);
  // How far back the body reaches at (x, y), or -Infinity where the ray misses
  const reach = (x, y) => {
    caster.set(from.set(x, y, behind).applyMatrix4(body.matrixWorld), back);
    const hit = caster.intersectObject(body, true)[0];
    return hit ? hit.point.applyMatrix4(toBody).z : -Infinity;
  };
  for (const x of TAIL_SIDES) {
    // (both sides, so a lopsided tail doesn't leave one flame in the air)
    const heights = [];
    for (let y = Math.max(.08, box.min.y); y < Math.min(1.8, box.max.y); y += .04) heights.push({ y, z: Math.min(reach(x, y), reach(-x, y)) });
    const rear = Math.max(...heights.map(h => h.z));
    if (!Number.isFinite(rear)) continue;
    // The bottom of the back, and the flame's middle a little over it, so the
    // cone starts in the bodywork rather than under it
    const bottom = heights.find(h => h.z > rear - TAIL_DEEP);
    const at = heights.find(h => h.y >= bottom.y + .12 && h.z > rear - TAIL_DEEP) ?? bottom;
    return { x, y: at.y, z: at.z - .04 };
  }
  return { x: .34, y: .36, z: box.max.z - .05 };
}
// How high a car stands `along` meters from its middle toward its nose, or
// -Infinity off either end
export function profileHeight(profile, along) {
  if (along < -profile.length / 2 || along >= profile.length / 2) return -Infinity;
  const k = Math.floor((along + profile.length / 2) / profile.slice);
  return k >= 0 && k < profile.heights.length ? profile.heights[k] : -Infinity;
}
