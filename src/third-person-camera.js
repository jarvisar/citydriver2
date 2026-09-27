import * as THREE from 'three';

// How far the chase lens opens between a standstill and full speed.
const RUSH_FOV = 1.09;
// A building in the way pulls the camera in toward this height over the car
// (a tall machine's lift on top), and it eases back out at this rate.
const PIVOT = 1.8, OPEN_RATE = 2.5;
// High up, the helicopter's chase seat rises this much and aims this far
// below its usual mark, so the streets stay in view (see `chaseDip`).
const DIP_RISE = 4, DIP_DROP = 10;
// The mouse turns the camera round the pivot (see MouseLook), tilting it from
// a little under its usual place to looking down from about 70° (radians
// from where it would be). Once the mouse has rested LOOK_REST s, a car moving
// faster than LOOK_MOVING m/s swings it back behind at LOOK_RETURN, as GTA's
// does; one standing still leaves it where it was put.
const TILT_LOW = -.25, TILT_HIGH = 1.05;
export const LOOK_REST = 1.5, LOOK_MOVING = 2, LOOK_RETURN = 2.5;
// The wheel takes it this much nearer or farther, easing there at ZOOM_RATE
const ZOOM_NEAR = .45, ZOOM_FAR = 2, ZOOM_RATE = 10;
// However it is turned, it keeps this far over the ground under it
const GROUND_CLEAR = .6;
// Someone on foot (see Walker) says how much closer and lower to frame them,
// as a share of a car's distances (`chaseScale`), which the camera eases to
// at SCALE_RATE as they get out or in. It follows them on a leash
// (`leash`) rather than swinging round behind: it turns only as they walk
// across its view (`velocity`), so walking toward it shows their face
// instead of spinning it round, as Hit & Run's and Mario 64's cameras do.
// The mouse turns it for good.
const SCALE_RATE = 3;
// (eases toward a goal, and lands on it exactly, so the camera comes back bit for bit)
export const settle = (value, goal, rate, dt) => {
  const next = THREE.MathUtils.damp(value, goal, rate, dt);
  return Math.abs(next - goal) < 1e-4 ? goal : next;
};

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
    this.dip = 0;
    // `sight(from, to)` answers how far from the car toward the camera the view
    // is clear (see sightLine); `reach` is how far out the camera stands.
    this.sight = null;
    this.reach = null;
    this.pivot = new THREE.Vector3();
    // `ground(x, z)` is the height of the ground under a point
    this.ground = null;
    // How far the mouse has turned the camera (see `look`) and the wheel's distance (`zoomBy`)
    this.lookYaw = 0; this.lookPitch = 0; this.rested = 0;
    this.zoom = 1; this.zoomTarget = 1;
    this.axis = new THREE.Vector3();
    // How far toward framing someone on foot it has come (see SCALE_RATE),
    // and the lift it has come to
    this.scale = 1; this.lift = 0;
  }
  // Turns the camera round the car by these many radians: to the right, and
  // up to look down on it
  look(yaw, pitch) {
    this.lookYaw = Math.atan2(Math.sin(this.lookYaw + yaw), Math.cos(this.lookYaw + yaw));
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + pitch, TILT_LOW, TILT_HIGH);
    this.rested = 0;
  }
  // Takes the camera this many times as far out
  zoomBy(factor) { this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * factor, ZOOM_NEAR, ZOOM_FAR); }
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
  // (back behind the car, at the distance the player chose)
  snap() { this.initialized = false; this.rush = 0; this.dip = 0; this.reach = null; this.lookYaw = 0; this.lookPitch = 0; }
  update(car, dt) {
    // Past two fifths of the car's top speed the lens opens up and the chase
    // seat slides back, so a boulevard at full throttle feels quick and a
    // junction crawl does not.
    const rush = THREE.MathUtils.clamp(car.userData.speedRush ?? 0, 0, 1);
    this.rush = this.initialized ? THREE.MathUtils.damp(this.rush, rush, 3.5, dt) : rush;
    // A flying machine says how far to look down, 0 on the ground to 1 high up
    const dip = THREE.MathUtils.clamp(car.userData.chaseDip ?? 0, 0, 1);
    this.dip = this.initialized ? THREE.MathUtils.damp(this.dip, dip, 1.5, dt) : dip;
    const framing = car.userData.chaseScale ?? 1, raised = car.userData.chaseLift ?? 0;
    this.scale = this.initialized ? settle(this.scale, framing, SCALE_RATE, dt) : framing;
    this.lift = this.initialized ? settle(this.lift, raised, SCALE_RATE, dt) : raised;
    const fov = this.baseFov * (1 + (RUSH_FOV - 1) * this.rush);
    if (Math.abs(fov - this.camera.fov) > .01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // Look partly along travel during a slide so the exit stays in view and
    // the player can see the car's angle. The pose supplies interpolated slip.
    const heading = -car.rotation.y - (car.userData.slip ?? 0) * .65;
    // Let the horizon suggest the slope without copying every chassis movement.
    const pitch = THREE.MathUtils.clamp(car.rotation.x * .45, -.18, .18);
    if (!this.initialized) {
      this.heading = heading; this.headingVelocity = 0;
      this.pitch = pitch; this.height = car.position.y; this.zoom = this.zoomTarget; this.initialized = true;
    } else {
      if (car.userData.leash) {
        // On a leash: turned toward where they have walked to from where the
        // camera stood, and wherever the mouse has turned it
        this.heading += this.lookYaw; this.lookYaw = 0; this.headingVelocity = 0;
        const velocity = car.userData.velocity, distance = (14 + 2.2 * this.rush) * this.scale;
        if (velocity && dt > 0) this.heading = Math.atan2(Math.sin(this.heading) * distance + velocity.x * dt, Math.cos(this.heading) * distance - velocity.z * dt);
      }
      // A critically damped spring eases into and out of turns. Limit its error
      // so even a sudden U-turn produces a controlled orbit (about 125 deg/s).
      // Small steps keep the speed limit consistent across display refresh rates.
      else for (let remaining = dt; remaining > 1e-8;) {
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
      this.zoom = settle(this.zoom, this.zoomTarget, ZOOM_RATE, dt);
      if (this.lookYaw || this.lookPitch) {
        this.rested += dt;
        if (this.rested > LOOK_REST && Math.abs(car.userData.speed ?? 0) > LOOK_MOVING) {
          this.lookYaw = settle(this.lookYaw, 0, LOOK_RETURN, dt); this.lookPitch = settle(this.lookPitch, 0, LOOK_RETURN, dt);
        }
      }
    }
    const yaw = this.heading + this.lookYaw;
    this.forward.set(Math.sin(yaw), 0, -Math.cos(yaw));
    const scale = this.scale, distance = (14 + 2.2 * this.rush) * scale;
    this.camera.position.copy(car.position).addScaledVector(this.forward, -distance);
    // A lower chase position and a higher, farther aim show more of the road
    // and horizon, with the car sitting in the lower part of the frame.
    // A tall machine lifts the camera with it, so the road stays in view over its roof.
    const lift = this.lift;
    this.camera.position.y = this.height + 4.5 * scale + lift - Math.sin(this.pitch) * distance + this.dip * DIP_RISE;
    this.target.copy(car.position).addScaledVector(this.forward, 7 * scale);
    this.target.y = this.height + 2.2 * scale + lift * .35 + Math.sin(this.pitch) * 7 * scale - this.dip * DIP_DROP;
    this.pivot.set(car.position.x, this.height + PIVOT * scale + lift, car.position.z);
    // The mouse's tilt and the wheel's distance turn and scale the camera and
    // its aim together about the pivot, so the car keeps its place in the
    // frame. (The axis points to the car's left: a positive tilt raises it.)
    if (this.lookPitch || this.zoom !== 1) {
      this.axis.set(this.forward.z, 0, -this.forward.x);
      this.camera.position.sub(this.pivot).applyAxisAngle(this.axis, this.lookPitch).multiplyScalar(this.zoom).add(this.pivot);
      this.target.sub(this.pivot).applyAxisAngle(this.axis, this.lookPitch).multiplyScalar(this.zoom).add(this.pivot);
    }
    // A building between the car and the camera brings it in along that line,
    // at once so no frame looks out from inside a wall, then lets it back out
    // gently once the view clears, as most driving games' chase cameras do.
    const open = this.sight?.(this.pivot, this.camera.position) ?? 1;
    const eased = this.reach === null || open < this.reach ? open : THREE.MathUtils.damp(this.reach, open, OPEN_RATE, dt);
    const before = this.reach ?? eased, line = this.camera.position.distanceTo(this.pivot);
    this.reach = open - eased < 1e-3 ? open : eased;
    if (this.reach < 1) this.camera.position.sub(this.pivot).multiplyScalar(this.reach).add(this.pivot);
    // How far it was just pulled in, and how fast it is easing out, for the
    // headset's comfort vignette (see ComfortVignette)
    this.camera.userData.jump = Math.max(0, before - this.reach) * line;
    this.camera.userData.glide = dt > 0 ? Math.max(0, this.reach - before) * line / dt : 0;
    // Nor, turned down low, does it go into the ground
    const floor = (this.ground?.(this.camera.position.x, this.camera.position.z) ?? -Infinity) + GROUND_CLEAR;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
