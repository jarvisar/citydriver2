import * as THREE from 'three';
import { CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from './camera-preferences.js';

// How far the chase lens opens between a standstill and full speed, and a
// moment more as a turbo fires (see Drift), unless the player is `calm`
// (prefers reduced motion)
const RUSH_FOV = 1.09, TURBO_FOV = 1.06;
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
const ZOOM_RATE = 10;
// However it is turned, it keeps this far over the ground under it (and
// this far under a bridge's deck, see `lid`)
const GROUND_CLEAR = .6, LID_CLEAR = .5;
// Someone on foot (see Walker) says how much closer and lower to frame them,
// as a share of a car's distances (`chaseScale`), which the camera eases to
// at SCALE_RATE as they get out or in. It follows them on a leash
// (`leash`) rather than swinging round behind: it turns only as they walk
// across its view (`velocity`), so walking toward it shows their face
// instead of spinning it round, as Hit & Run's and Mario 64's cameras do.
// The mouse turns it for good.
const SCALE_RATE = 3;
// On foot, something low beside them (a car, most often) can bring the
// camera in nearer than CRANE_NEAR (m) to their head. It rises up to CRANE
// (m) to look over it instead, if that sees them better, easing at
// CRANE_RATE. It stays up until the low view would be clear by a margin.
const CRANE = 2.6, CRANE_NEAR = 2.5, CRANE_RATE = 4;
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
    this.rush = 0; this.punch = 0; this.calm = false;
    this.dip = 0;
    // `sight(from, to)` answers how far from the car toward the camera the view
    // is clear (see sightLine); `reach` is how far out the camera stands.
    this.sight = null;
    this.reach = null; this.reachDistance = 0;
    this.pivot = new THREE.Vector3();
    // `ground(x, z)` is the height of the ground under a point, `decked(x, z)`
    // whether a bridge's deck is over it, and `lid` the deck it keeps under
    this.ground = null; this.decked = null; this.lid = null;
    // How far the mouse has turned the camera (see `look`) and the wheel's distance (`zoomBy`)
    this.lookYaw = 0; this.lookPitch = 0; this.rested = 0;
    this.zoom = 1; this.zoomTarget = 1;
    this.axis = new THREE.Vector3();
    // How far toward framing someone on foot it has come (see SCALE_RATE),
    // the lift it has come to, and how far it has risen over something low (see CRANE)
    this.scale = 1; this.lift = 0; this.crane = 0; this.craning = false;
    this.raised = new THREE.Vector3();
    this.centering = false; this.clearance = null;
  }
  // Turns the camera round the car by these many radians: to the right, and
  // up to look down on it
  look(yaw, pitch) {
    if (yaw || pitch) this.centering = false;
    this.lookYaw = Math.atan2(Math.sin(this.lookYaw + yaw), Math.cos(this.lookYaw + yaw));
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + pitch, TILT_LOW, TILT_HIGH);
    this.rested = 0;
  }
  // Takes the camera this many times as far out
  zoomBy(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.setZoom(this.zoomTarget * factor);
  }
  setZoom(value) {
    if (!Number.isFinite(value)) return;
    this.zoomTarget = THREE.MathUtils.clamp(value, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    this.rested = 0;
  }
  recenter(car, immediate = false) {
    this.centering = !immediate;
    if (immediate) { this.heading = -car.rotation.y; this.headingVelocity = 0; this.lookYaw = this.lookPitch = 0; }
  }
  resize(aspect) {
    this.camera.aspect = aspect;
    // Preserve enough horizontal room for the car on narrow phones.
    this.baseFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 8) / Math.min(aspect, 1)));
    // The sun's shadow is fitted to the lens, and has to cover
    // the frame the car will have at full speed rather than the narrower one it
    // has standing still, so say how wide this lens ever gets.
    this.camera.userData.widestFov = this.baseFov * RUSH_FOV * TURBO_FOV;
    this.camera.fov = this.baseFov * (1 + (RUSH_FOV - 1) * this.rush);
    this.camera.updateProjectionMatrix();
  }
  // (back behind the car, at the distance the player chose)
  snap() { this.initialized = false; this.rush = 0; this.punch = 0; this.dip = 0; this.reach = null; this.lookYaw = 0; this.lookPitch = 0; this.crane = 0; this.craning = false; this.lid = null; this.centering = false; }
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
    const turbo = this.calm ? 0 : THREE.MathUtils.clamp(car.userData.turbo ?? 0, 0, 1);
    this.punch = this.initialized ? THREE.MathUtils.damp(this.punch, turbo, turbo > this.punch ? 14 : 2.5, dt) : 0;
    const fov = this.baseFov * (1 + (RUSH_FOV - 1) * this.rush) * (1 + (TURBO_FOV - 1) * this.punch);
    if (Math.abs(fov - this.camera.fov) > .01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // Look partly along travel during a slide so the exit stays in view and
    // the player can see the car's angle. The pose supplies interpolated slip.
    // (a car in the air says which way it flies, and the camera looks that
    // way whatever its nose is doing: see CarAir)
    const heading = car.userData.travel ?? -car.rotation.y - (car.userData.slip ?? 0) * .65;
    // Let the horizon suggest the slope without copying every chassis movement.
    // (a plane says how far to lean with its climb or dive: see Plane)
    const pitch = car.userData.chasePitch ?? THREE.MathUtils.clamp(car.rotation.x * .45, -.18, .18);
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
      // (and it follows a jump up and down loosely, so the car rises in the
      // frame and the view doesn't bob with every arc, nor with a drift's
      // hop, a headset's view included)
      this.height = THREE.MathUtils.damp(this.height, car.position.y, car.userData.travel == null && !car.userData.hopping ? 9 : 1.6, dt);
      this.zoom = settle(this.zoom, this.zoomTarget, ZOOM_RATE, dt);
      if (this.lookYaw || this.lookPitch) {
        this.rested += dt;
        if (!car.userData.leash && this.rested > LOOK_REST && Math.abs(car.userData.speed ?? 0) > LOOK_MOVING) {
          this.lookYaw = settle(this.lookYaw, 0, LOOK_RETURN, dt); this.lookPitch = settle(this.lookPitch, 0, LOOK_RETURN, dt);
        }
      }
    }
    if (this.centering) {
      this.lookYaw = settle(this.lookYaw, 0, 8, dt); this.lookPitch = settle(this.lookPitch, 0, 8, dt);
      const turn = car.userData.leash ? Math.atan2(Math.sin(-car.rotation.y - this.heading), Math.cos(-car.rotation.y - this.heading)) : 0;
      if (turn) this.heading += turn - settle(turn, 0, 8, dt);
      if (!this.lookYaw && !this.lookPitch && Math.abs(turn) < 1e-4) this.centering = false;
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
    // On foot, rising over a car beside them rather than coming in to their
    // head: the camera and the point it keeps its view from both go up
    if (car.userData.leash && this.sight && this.initialized) {
      const low = this.sight(this.pivot, this.camera.position) * this.camera.position.distanceTo(this.pivot);
      if (low < CRANE_NEAR || (this.craning && low < CRANE_NEAR + 1.5)) {
        this.raised.copy(this.camera.position); this.raised.y += CRANE; this.pivot.y += CRANE;
        this.craning = this.sight(this.pivot, this.raised) * this.raised.distanceTo(this.pivot) > low + 1;
        this.pivot.y -= CRANE;
      } else this.craning = false;
    } else this.craning = false;
    this.crane = settle(this.crane, this.craning ? CRANE : 0, CRANE_RATE, dt);
    if (this.crane) { this.camera.position.y += this.crane; this.pivot.y += this.crane; }
    // Cast toward the position the lens can actually occupy. Clamping under
    // a bridge after casting an unobstructed high ray could put it in a wall.
    const lid = this.lid = car.userData.lid ?? (this.lid && this.decked?.(this.camera.position.x, this.camera.position.z) ? this.lid : null);
    this.clampHeight(this.camera.position, lid);
    if (lid != null) { this.pivot.y = Math.min(this.pivot.y, lid - LID_CLEAR); this.target.y = Math.min(this.target.y, lid - LID_CLEAR); }
    // A building between the car and the camera brings it in along that line,
    // at once so no frame looks out from inside a wall, then lets it back out
    // gently once the view clears, as most driving games' chase cameras do.
    const open = this.sight?.(this.pivot, this.camera.position) ?? 1;
    const line = this.camera.position.distanceTo(this.pivot), clear = open * line;
    // Ease metres, not a fraction of a line that changes while zooming.
    // Free zoom already eases on its own; only an obstruction needs this lag.
    const before = this.reach === null ? clear : this.reach === 1 ? line : Math.min(this.reachDistance, line);
    const previousDistance = this.reach === null ? clear : this.reachDistance;
    const eased = clear < before ? clear : THREE.MathUtils.damp(before, clear, OPEN_RATE, dt);
    this.reachDistance = clear - eased < line * 1e-3 ? clear : eased;
    this.reach = line > 1e-8 ? this.reachDistance / line : 1;
    if (this.reach < 1) {
      this.camera.position.sub(this.pivot).multiplyScalar(this.reach).add(this.pivot);
      // As with wheel zoom, keep the player's place in the frame through a pull-in.
      this.target.sub(this.pivot).multiplyScalar(this.reach).add(this.pivot);
    }
    // How far it was just pulled in, and how fast it is easing out, for the
    // headset's comfort vignette (see ComfortVignette)
    // A pull-in can land on a different hillside. Both ends already lie under
    // the lid, so this correction only raises the lens; raising a clear ray
    // cannot enter one of sightLine's footprints bounded by a roof height.
    this.clampHeight(this.camera.position, lid);
    this.camera.userData.jump = Math.max(0, Math.min(before, previousDistance) - this.reachDistance);
    this.camera.userData.glide = dt > 0 ? Math.max(0, this.reachDistance - before) / dt : 0;
    const floor = (this.ground?.(this.camera.position.x, this.camera.position.z) ?? -Infinity) + GROUND_CLEAR;
    // Zoomed out or flying, give thin road and paving layers more depth precision.
    // Fit after collision/ground clamps so a wall pulling us in cannot clip the car.
    const wantedNear = .1 + (this.dip < .005 ? 0 : this.dip * .9) + Math.max(0, this.zoom - 1) * .5;
    const groundRoom = this.camera.position.y - floor + GROUND_CLEAR;
    const roofRoom = lid != null ? lid - this.camera.position.y : Infinity;
    const slope = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const lensRoom = wantedNear > .1 ? (this.clearance?.(this.camera.position) ?? Infinity) / Math.hypot(1, slope, slope * this.camera.aspect) : Infinity;
    const near = Math.max(.1, Math.min(wantedNear, this.camera.position.distanceTo(this.pivot) * .1, groundRoom * .5, roofRoom * .5, lensRoom));
    if (near < this.camera.near || near - this.camera.near > .02) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
  clampHeight(point, lid) {
    const before = point.y, floor = (this.ground?.(point.x, point.z) ?? -Infinity) + GROUND_CLEAR;
    point.y = Math.max(point.y, floor);
    if (lid != null) point.y = Math.min(point.y, lid - LID_CLEAR);
    return point.y !== before;
  }
}
