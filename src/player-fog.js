import * as THREE from 'three';

// The visible city follows the player, not the lens. Zoom, orbit and a wall
// pulling the camera in must all leave a building's haze alone.
export class PlayerFog extends THREE.Fog {
  constructor(color) {
    super(color, 100, 205);
    this.isPlayerFog = true;
    this.origin = new THREE.Vector3();
  }

  setRange(near, far, detailed, distance) {
    this.far = Math.min(far, detailed ? 310 : 205);
    const start = Math.min(near, this.far * .5);
    this.near = start + (this.far - start) * distance * .5;
  }

  intersectsSphere(sphere) {
    return sphere.center.distanceToSquared(this.origin) < (this.far + sphere.radius) ** 2;
  }
}

const centre = new THREE.Vector3();
export function fitFogDistance(camera, fog, trackedHead = null) {
  if (!camera.isPerspectiveCamera || !fog?.isFog) return;
  let reach = fog.far;
  if (fog.isPlayerFog) {
    // A sphere's furthest depth is its centre's depth plus its radius. XR
    // can look anywhere, so include the whole offset from the tracked head.
    camera.updateMatrixWorld();
    reach += trackedHead ? trackedHead.distanceTo(fog.origin)
      : -centre.copy(fog.origin).applyMatrix4(camera.matrixWorldInverse).z;
  }
  const far = Math.max(camera.near + 1, Math.ceil(reach) + 1);
  if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
}
