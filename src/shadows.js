import * as THREE from 'three';
import { SHADOW_FADE } from './rendering-compat.js';
export { SHADOW_FADE, stabilizeShadowFiltering } from './rendering-compat.js';

const bounds = new THREE.Box3(), point = new THREE.Vector3(), direction = new THREE.Vector3(), toSun = new THREE.Vector3();

// The highest anything can cast from: the tallest towers (110-120 m) and the
// helicopter at its ceiling.
export const CASTER_TOP = 130;
// A lit surface looks its shadow up a texel and a bit out along its normal
// (about a texel keeps it from shadowing itself, and more lifts contact
// shadows off the ground: the tires), and a few centimeters towards the sun.
const NORMAL_BIAS = 1.15, DEPTH_BIAS = .035;

// The shadow camera round `bounds` (in the light's frame), with the fade band
// beyond it (and a texel over, which snapping may take), and the biases for
// its texels and depth. Returns a texel's size in meters.
function frame(sun, worldOrigin) {
  const lightCamera = sun.shadow.camera, { x: across, y: up } = sun.shadow.mapSize;
  const width = Math.ceil((bounds.max.x - bounds.min.x) / SHADOW_FADE * (1 + 2 / across) * 16) / 16;
  const height = Math.ceil((bounds.max.y - bounds.min.y) / SHADOW_FADE * (1 + 2 / up) * 16) / 16;
  const texelX = width / across, texelY = height / up;
  // Anchor to the absolute world, including floating-origin rebases. Camera
  // motion may shift the map by whole texels but cannot slide between them.
  point.set(0, 0, worldOrigin).applyMatrix4(lightCamera.matrixWorldInverse);
  const centerX = point.x + Math.round(((bounds.min.x + bounds.max.x) / 2 - point.x) / texelX) * texelX;
  const centerY = point.y + Math.round(((bounds.min.y + bounds.max.y) / 2 - point.y) / texelY) * texelY;
  lightCamera.left = centerX - width / 2;
  lightCamera.right = centerX + width / 2;
  lightCamera.bottom = centerY - height / 2;
  lightCamera.top = centerY + height / 2;
  // Depth: from as far towards the sun as anything covered can have a caster
  // (out of view, so a tower's evening shadow still reaches in; the low sun
  // needs more than the 250 m this once was, a high one far less) to the far
  // side of what is covered, past which nothing can shadow it.
  const rise = toSun.setFromMatrixPosition(sun.matrixWorld).sub(direction.setFromMatrixPosition(sun.target.matrixWorld)).normalize().y;
  lightCamera.near = -bounds.max.z - CASTER_TOP / Math.max(.15, rise);
  lightCamera.far = -bounds.min.z + 1;
  lightCamera.updateProjectionMatrix();
  const texel = Math.max(texelX, texelY);
  sun.shadow.normalBias = THREE.MathUtils.clamp(texel * NORMAL_BIAS, .05, .2);
  sun.shadow.bias = -DEPTH_BIAS / (lightCamera.far - lightCamera.near);
  return texel;
}

function lightFrame(sun) {
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  sun.shadow.updateMatrices(sun);
  return sun.shadow.camera.matrixWorldInverse;
}

// Enclose the visible terrain, from valleys to peaks, with shadows out to
// `distance` from a perspective camera. heightOrigin moves both height planes
// to a local elevation datum; translating them preserves the shadow map's
// texel density. Returns the shadow texel's size in meters.
export function fitSunShadow(camera, sun, heightOrigin = 0, worldOrigin = 0, distance = 100) {
  camera.updateMatrixWorld();
  const toLight = lightFrame(sun);
  bounds.makeEmpty();
  if (camera.isPerspectiveCamera) {
    // Enclose the nearby chase frustum in a sphere. Its size depends only on
    // the widest the lens gets (it opens with speed), so steering, pitching
    // and speeding up cannot stretch the shadow texels.
    const far = Math.min(distance, camera.far);
    const fov = Math.max(camera.userData.widestFov ?? 0, camera.getEffectiveFOV());
    const slope = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    const middle = Math.min(far, (camera.near + far) * (1 + slope * slope * (1 + camera.aspect * camera.aspect)) / 2);
    const halfHeight = far * slope;
    const radius = Math.ceil(Math.hypot(halfHeight * camera.aspect, halfHeight, far - middle) * 16) / 16;
    camera.getWorldDirection(point).multiplyScalar(middle).add(camera.position);
    point.applyMatrix4(toLight);
    bounds.min.copy(point).addScalar(-radius);
    bounds.max.copy(point).addScalar(radius);
  } else {
    camera.getWorldDirection(direction);
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const height of [-40, 180]) {
      point.set(x, y, -1).unproject(camera);
      point.addScaledVector(direction, (heightOrigin + height - point.y) / direction.y);
      bounds.expandByPoint(point.applyMatrix4(toLight));
    }
  }
  return frame(sun, worldOrigin);
}

// A headset can look any way at any moment, so its shadows reach `distance`
// every way round the head. The head turning changes nothing, and moving it
// shifts the map by whole texels. Returns the texel's size in meters.
export function fitSunShadowAround(position, sun, distance, worldOrigin = 0) {
  point.copy(position).applyMatrix4(lightFrame(sun));
  bounds.min.copy(point).addScalar(-distance);
  bounds.max.copy(point).addScalar(distance);
  return frame(sun, worldOrigin);
}
