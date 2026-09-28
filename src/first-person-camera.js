import * as THREE from 'three';
import { LOOK_REST, LOOK_MOVING, LOOK_RETURN, settle } from './third-person-camera.js';

// The mouse and the right stick look round through the player's eyes (see
// MouseLook and `look`). In a car they turn the driver's head, at most
// HEAD_TURN either way and from HEAD_DOWN to HEAD_UP, and once the mouse has
// rested a moving car brings it back to the road ahead, as the chase camera
// does. On foot (`leash`, see Walker) the view is theirs to turn all the
// way round, from FOOT_DOWN to FOOT_UP, and they face where it looks (see
// walkingInput). Radians.
const HEAD_TURN = 2.3, HEAD_DOWN = -.9, HEAD_UP = .6, FOOT_DOWN = -1.3, FOOT_UP = 1.2;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

export class FirstPersonCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, .1, 1200);
    this.initialized = false;
    this.pitch = 0;
    this.orientation = new THREE.Euler(0, 0, 0, 'YXZ');
    this.eye = new THREE.Vector3();
    // Where the view looks, as a heading (on foot, its own), and how far the
    // mouse has turned and tilted it
    this.heading = 0; this.lookYaw = 0; this.lookPitch = 0; this.rested = 0;
  }
  resize(aspect) {
    this.camera.aspect = aspect;
    // Keep the road readable in portrait without an extreme vertical lens.
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) / Math.max(.7, Math.min(aspect, 1))));
    this.camera.updateProjectionMatrix();
  }
  // Turns the view by these many radians: to the right, and down
  look(yaw, pitch) { this.lookYaw += yaw; this.lookPitch -= pitch; this.rested = 0; }
  // (looking ahead again)
  snap() { this.initialized = false; this.lookYaw = 0; this.lookPitch = 0; }
  // `steady` leaves out the bob of someone's walk (see Walker's `eyeBob`): in a headset, and for reduced motion
  update(car, dt, steady = false) {
    const pitch = THREE.MathUtils.clamp(car.rotation.x, -.5, .5), own = Boolean(car.userData.leash);
    this.pitch = this.initialized ? THREE.MathUtils.damp(this.pitch, pitch, 7, dt) : pitch;
    if (!this.initialized) this.heading = -car.rotation.y;
    this.initialized = true;
    if (own) {
      this.heading = wrap(this.heading + this.lookYaw); this.lookYaw = 0;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch, FOOT_DOWN, FOOT_UP);
    } else {
      this.heading = -car.rotation.y;
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw, -HEAD_TURN, HEAD_TURN);
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch, HEAD_DOWN, HEAD_UP);
      if (this.lookYaw || this.lookPitch) {
        this.rested += dt;
        if (this.rested > LOOK_REST && Math.abs(car.userData.speed ?? 0) > LOOK_MOVING) {
          this.lookYaw = settle(this.lookYaw, 0, LOOK_RETURN, dt); this.lookPitch = settle(this.lookPitch, 0, LOOK_RETURN, dt);
        }
      }
    }
    // Follow the interpolated heading directly so steering never swings the
    // driver's view sideways. Ignore chassis roll and soften changes in slope.
    this.orientation.set(this.pitch + this.lookPitch, own ? -this.heading : car.rotation.y - this.lookYaw, 0);
    this.camera.quaternion.setFromEuler(this.orientation);
    if (car.userData.driverEye) this.eye.copy(car.userData.driverEye);
    else this.eye.set(0, 1.73, -1.01);
    if (!steady) this.eye.y += car.userData.eyeBob ?? 0;
    // Keep the eye fixed at the windshield as the chassis tilts.
    this.camera.position.copy(this.eye.applyQuaternion(car.quaternion)).add(car.position);
    this.camera.updateMatrixWorld();
  }
}
