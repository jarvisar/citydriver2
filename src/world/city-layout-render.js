import * as THREE from 'three';

// A rigid frame: a pure rotation about (s, u). Buildings fitted into the
// generated lots turn with their lot; everything else uses heading 0.
export function cityRigidFrame(s, u, heading = 0) {
  const cos = Math.cos(heading), sin = Math.sin(heading);
  return { s, u, ns: cos, nu: sin, es: -sin, eu: cos, heading };
}

// Objects default to their own translation. Items placed inside rigid() carry
// the building's frame and anchor, so a whole structure turns as one.
// (Worked out as an Object3D at p with rotation (0, yaw, roll) and the item's
// scale composes its matrix, sum for sum in the same order, so not a bit of
// it differs, a zero's sign included: through an Object3D itself, a city's
// million items a load spent most of their time in its setters and callbacks.)
let turned = NaN, turnedCos = 1, turnedSin = 0;
export function cityItemMatrix(item, east = 0, start = 0, target = new THREE.Matrix4()) {
  const p = item.p, x = p[0], y = p[1], z = p[2], scale = item.scale, sx = scale[0], sy = scale[1], sz = scale[2];
  const anchor = item.anchor ?? null, frame = item.frame ?? null, au = anchor ? anchor.u : east + x, as = anchor ? anchor.s : start - z;
  // (with no frame of its own, cityRigidFrame's at its anchor)
  let fu = au, fs = as, ns = 1, nu = 0, es = -0, eu = 1;
  if (frame) { fu = frame.u; fs = frame.s; ns = frame.ns; nu = frame.nu; es = frame.es; eu = frame.eu; }
  // The quaternion of the Euler angles (0, yaw, roll), in order XYZ (half of
  // nothing has a cosine of 1 and is its own sine)
  // (one item's yaw is most often the last one's, a wall's boxes one after another)
  const yaw = (item.yaw ?? 0) / 2, roll = (item.roll ?? 0) / 2;
  if (yaw !== turned && yaw !== 0) { turned = yaw; turnedCos = Math.cos(yaw); turnedSin = Math.sin(yaw); }
  const c2 = yaw === 0 ? 1 : turnedCos, s2 = yaw === 0 ? yaw : turnedSin, c3 = roll === 0 ? 1 : Math.cos(roll), s3 = roll === 0 ? roll : Math.sin(roll);
  const qx = 0 * c2 * c3 + s2 * s3, qy = s2 * c3 - 0 * c2 * s3, qz = c2 * s3 + 0 * s2 * c3, qw = c2 * c3 - 0 * s2 * s3;
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz, xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2, wx = qw * x2, wy = qw * y2, wz = qw * z2;
  // Its columns, each turned into the frame
  const e = target.elements;
  let a = (1 - (yy + zz)) * sx, b = (xz - wy) * sx;
  e[0] = eu * a - nu * b; e[1] = (xy + wz) * sx; e[2] = -es * a + ns * b; e[3] = 0;
  a = (xy - wz) * sy; b = (yz + wx) * sy;
  e[4] = eu * a - nu * b; e[5] = (1 - (xx + zz)) * sy; e[6] = -es * a + ns * b; e[7] = 0;
  a = (xz + wy) * sz; b = (1 - (xx + yy)) * sz;
  e[8] = eu * a - nu * b; e[9] = (yz - wx) * sz; e[10] = -es * a + ns * b; e[11] = 0;
  const du = east + x - au, ds = start - z - as;
  e[12] = fu - east + eu * du + nu * ds; e[13] = y; e[14] = start - fs - es * du - ns * ds; e[15] = 1;
  return target;
}

export function cityAffinePoint(s, u, anchor, frame = cityRigidFrame(anchor.s, anchor.u)) {
  const ds = s - anchor.s, du = u - anchor.u;
  return { s: frame.s + ds * frame.ns + du * frame.es, u: frame.u + ds * frame.nu + du * frame.eu };
}

// One convention for turning props on the map (x east, y north). An item's
// yaw turns its local +x to (cos yaw, sin yaw) and its local +z, the side
// signs and signals are modeled facing, to (sin yaw, -cos yaw).
// A rigid frame's heading turns the other way: frame heading h lays out the
// same axes as item yaw -h, so a collider in cityRigidFrame(s, u, -yaw)
// matches an item placed with yaw.
export const faceYaw = (dx, dy) => Math.atan2(dx, -dy);
export const alongYaw = (dx, dy) => Math.atan2(dy, dx);
export const itemFrame = (s, u, yaw) => cityRigidFrame(s, u, -yaw);
