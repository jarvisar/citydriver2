import * as THREE from 'three';

const transform = new THREE.Object3D();

// A rigid frame: a pure rotation about (s, u). Buildings fitted into the
// generated lots turn with their lot; everything else uses heading 0.
export function cityRigidFrame(s, u, heading = 0) {
  const cos = Math.cos(heading), sin = Math.sin(heading);
  return { s, u, ns: cos, nu: sin, es: -sin, eu: cos, heading };
}

// Objects default to their own translation. Items placed inside rigid() carry
// the building's frame and anchor, so a whole structure turns as one.
export function cityItemMatrix(item, east = 0, start = 0, target = new THREE.Matrix4()) {
  const [x, y, z] = item.p;
  const anchor = item.anchor ?? { s: start - z, u: east + x };
  const f = item.frame ?? cityRigidFrame(anchor.s, anchor.u);
  transform.position.set(x, y, z); transform.scale.set(...item.scale);
  transform.rotation.set(0, item.yaw ?? 0, item.roll ?? 0); transform.updateMatrix();
  target.copy(transform.matrix);
  const e = target.elements;
  for (let column = 0; column <= 8; column += 4) {
    const x = e[column], z = e[column + 2];
    e[column] = f.eu * x - f.nu * z;
    e[column + 2] = -f.es * x + f.ns * z;
  }
  const du = east + x - anchor.u, ds = start - z - anchor.s;
  e[12] = f.u - east + f.eu * du + f.nu * ds;
  e[14] = start - f.s - f.es * du - f.ns * ds;
  return target;
}

export function cityAffinePoint(s, u, anchor, frame = cityRigidFrame(anchor.s, anchor.u)) {
  const ds = s - anchor.s, du = u - anchor.u;
  return { s: frame.s + ds * frame.ns + du * frame.es, u: frame.u + ds * frame.nu + du * frame.eu };
}
