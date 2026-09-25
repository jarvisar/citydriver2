import * as THREE from 'three';

// How far the chase lens opens between a standstill and full speed.
const RUSH_FOV = 1.09;

export class ThirdPersonCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(45, 1, .1, 1200);
    this.initialized = false;
    this.heading = 0;
    this.headingVelocity = 0;
    this.pitch = 0;
    this.height = 0;
    this.forward = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.baseFov = 45;
    this.rush = 0;
  }
  resize(aspect) {
    this.camera.aspect = aspect;
    // Preserve enough horizontal room for the car on narrow phones.
    this.baseFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 8) / Math.min(aspect, 1)));
    // Fog and the sun's shadow are fitted to the lens, and both have to cover
    // the frame the car will have at full speed rather than the narrower one it
    // has standing still, so say how wide this lens ever gets.
    this.camera.userData.widestFov = this.baseFov * RUSH_FOV;
    this.camera.fov = this.baseFov * (1 + (RUSH_FOV - 1) * this.rush);
    this.camera.updateProjectionMatrix();
  }
  snap() { this.initialized = false; this.rush = 0; }
  update(car, dt) {
    // Past two fifths of the car's top speed the lens opens up and the chase
    // seat slides back, so a boulevard at full throttle feels quick and a
    // junction crawl does not.
    const rush = THREE.MathUtils.clamp(car.userData.speedRush ?? 0, 0, 1);
    this.rush = this.initialized ? THREE.MathUtils.damp(this.rush, rush, 3.5, dt) : rush;
    const fov = this.baseFov * (1 + (RUSH_FOV - 1) * this.rush);
    if (Math.abs(fov - this.camera.fov) > .01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // Look partly along travel during a slide so the exit stays in view and
    // the player can see the car's angle. The pose supplies interpolated slip.
    const heading = -car.rotation.y - (car.userData.slip ?? 0) * .65;
    // Let the horizon suggest the slope without copying every chassis movement.
    const pitch = THREE.MathUtils.clamp(car.rotation.x * .45, -.18, .18);
    if (!this.initialized) {
      this.heading = heading; this.headingVelocity = 0;
      this.pitch = pitch; this.height = car.position.y; this.initialized = true;
    } else {
      // A critically damped spring eases into and out of turns. Limit its error
      // so even a sudden U-turn produces a controlled orbit (about 125 deg/s).
      // Small steps keep the speed limit consistent across display refresh rates.
      for (let remaining = dt; remaining > 1e-8;) {
        const step = Math.min(remaining, 1 / 120);
        const difference = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
        const frequency = 10, change = THREE.MathUtils.clamp(difference, -.43, .43);
        const spring = this.headingVelocity - frequency * change;
        const decay = Math.exp(-frequency * step);
        this.heading += change + (-change + spring * step) * decay;
        this.headingVelocity = (this.headingVelocity - frequency * spring * step) * decay;
        remaining -= step;
      }
      this.pitch = THREE.MathUtils.damp(this.pitch, pitch, 2.5, dt);
      this.height = THREE.MathUtils.damp(this.height, car.position.y, 9, dt);
    }
    this.forward.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
    const distance = 14 + 2.2 * this.rush;
    this.camera.position.copy(car.position).addScaledVector(this.forward, -distance);
    // A lower chase position and a higher, farther aim show more of the road
    // and horizon, with the car sitting in the lower part of the frame.
    // A tall machine lifts the camera with it, so the road stays in view over its roof.
    const lift = car.userData.chaseLift ?? 0;
    this.camera.position.y = this.height + 4.5 + lift - Math.sin(this.pitch) * distance;
    this.target.copy(car.position).addScaledVector(this.forward, 7);
    this.target.y = this.height + 2.2 + lift * .35 + Math.sin(this.pitch) * 7;
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
