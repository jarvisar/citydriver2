import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);
const heading = new THREE.Euler(0, 0, 0, 'YXZ');
const rotation = new THREE.Quaternion();
const yaw = quaternion => heading.setFromQuaternion(rotation.copy(quaternion), 'YXZ').y;

// The rig follows the game's camera; WebXR alone owns the camera underneath
// it. Moving the rig must never overwrite the headset's tracked pose.
export class XRCameraRig {
  constructor() {
    this.rig = new THREE.Group();
    this.camera = new THREE.PerspectiveCamera(60, 1, .1, 1200);
    this.rig.add(this.camera);
    this.origin = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.offset = new THREE.Vector3();
    this.centered = false;
  }
  recenter() { this.centered = false; }
  update(source, pose) {
    if (!this.centered && pose) {
      this.origin.copy(pose.transform.position);
      // Recenter heading only. Capturing head pitch/roll here tilts the world
      // permanently when entering VR while looking down at the Enter button.
      this.orientation.setFromAxisAngle(up, -yaw(pose.transform.orientation));
      this.centered = true;
    }
    this.rig.position.copy(source.position);
    if (source.isOrthographicCamera) {
      // Match the overhead view's vertical framing at its focal plane using
      // a 60-degree perspective lens. The headset supplies the actual lenses.
      const distance = (source.top - source.bottom) / (2 * Math.tan(Math.PI / 6));
      source.getWorldDirection(this.offset);
      this.rig.position.addScaledVector(this.offset, source.userData.focusDistance - distance);
    }
    // Keep physical up aligned with world up, even on hills and when looking
    // sideways. Pitch and roll come exclusively from the tracked headset.
    this.rig.quaternion.setFromAxisAngle(up, yaw(source.quaternion)).multiply(this.orientation);
    this.rig.position.sub(this.offset.copy(this.origin).applyQuaternion(this.rig.quaternion));
    this.rig.updateMatrixWorld(true);
  }
}
