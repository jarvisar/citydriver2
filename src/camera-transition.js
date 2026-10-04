import * as THREE from 'three';

const DURATION = .4;
const direction = new THREE.Vector3(), baseline = new THREE.Vector3();
const yaw = vector => Math.atan2(vector.x, -vector.z);
const pitch = vector => Math.atan2(vector.y, Math.hypot(vector.x, vector.z));

// Keep the gaze when the wheel changes seats, using each camera's own limits.
export function carryCameraLook(rig, source, car, steady = false) {
  source.getWorldDirection(direction);
  rig.update(car, 0, steady);
  rig.camera.getWorldDirection(baseline);
  const turn = yaw(direction) - yaw(baseline);
  rig.look(Math.atan2(Math.sin(turn), Math.cos(turn)), pitch(baseline) - pitch(direction));
  rig.update(car, 0, steady);
}

export class CameraTransition {
  constructor() {
    this.camera = new THREE.PerspectiveCamera();
    this.offset = new THREE.Vector3(); this.rotation = new THREE.Quaternion();
    this.active = false; this.subject = null; this.elapsed = 0;
  }
  start(source, subject) {
    this.camera.copy(source);
    // Follow the subject through movement and origin shifts during the glide.
    this.offset.copy(source.position).sub(subject.position);
    this.rotation.copy(source.quaternion); this.fov = source.fov; this.near = source.near;
    this.widestFov = source.userData.widestFov ?? source.fov;
    this.subject = subject; this.elapsed = 0; this.active = true;
  }
  update(target, subject, dt) {
    if (!this.active) return;
    if (subject !== this.subject) { this.cancel(); return; }
    this.elapsed += Math.max(0, dt);
    const t = THREE.MathUtils.smoothstep(this.elapsed / DURATION, 0, 1);
    const camera = this.camera;
    camera.position.copy(subject.position).add(this.offset).lerp(target.position, t);
    camera.quaternion.copy(this.rotation).slerp(target.quaternion, t);
    camera.fov = THREE.MathUtils.lerp(this.fov, target.fov, t);
    camera.aspect = target.aspect; camera.near = Math.min(this.near, target.near); camera.far = target.far;
    camera.userData.widestFov = Math.max(this.widestFov, target.userData.widestFov ?? target.fov);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    if (this.elapsed >= DURATION) this.cancel();
  }
  cancel() { this.active = false; this.subject = null; }
}
