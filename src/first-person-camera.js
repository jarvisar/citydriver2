import * as THREE from 'three';

export class FirstPersonCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, .1, 1200);
    this.initialized = false;
    this.pitch = 0;
    this.orientation = new THREE.Euler(0, 0, 0, 'YXZ');
    this.eye = new THREE.Vector3();
  }
  resize(aspect) {
    this.camera.aspect = aspect;
    // Keep the road readable in portrait without an extreme vertical lens.
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) / Math.max(.7, Math.min(aspect, 1))));
    this.camera.updateProjectionMatrix();
  }
  snap() { this.initialized = false; }
  update(car, dt) {
    const pitch = THREE.MathUtils.clamp(car.rotation.x, -.5, .5);
    this.pitch = this.initialized ? THREE.MathUtils.damp(this.pitch, pitch, 7, dt) : pitch;
    this.initialized = true;
    // Follow the interpolated heading directly so steering never swings the
    // driver's view sideways. Ignore chassis roll and soften changes in slope.
    this.orientation.set(this.pitch, car.rotation.y, 0);
    this.camera.quaternion.setFromEuler(this.orientation);
    if (car.userData.driverEye) this.eye.copy(car.userData.driverEye);
    else this.eye.set(0, 1.73, -1.01);
    // Keep the eye fixed at the windshield as the chassis tilts; the viewing
    // direction still softens pitch and keeps the horizon free of body roll.
    this.camera.position.copy(this.eye.applyQuaternion(car.quaternion)).add(car.position);
    this.camera.updateMatrixWorld();
  }
}
