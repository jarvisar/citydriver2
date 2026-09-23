import * as THREE from 'three';

// The stick stays hidden until a thumb lands on the scene, then anchors right
// there: the knob follows the thumb up to the rim and lifting hides it again.
export class TouchStick {
  constructor(element, onDrive, zone) {
    this.element = element; this.onDrive = onDrive; this.zone = zone;
    this.pointer = null; this.engaged = false; this.vector = { x: 0, y: 0 };
    zone.addEventListener('pointerdown', event => this.start(event));
    zone.addEventListener('pointermove', event => this.move(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(type, event => {
      if (event.pointerId === this.pointer) this.release();
    });
    window.addEventListener('resize', () => this.release());
  }
  // Only while the touch controls are on screen: not in menus, pauses or with a controller.
  available() {
    const controls = this.element.parentElement, style = getComputedStyle(controls);
    return style.display !== 'none' && style.visibility === 'visible' && !controls.closest('[inert]');
  }
  start(event) {
    if (this.pointer !== null || event.pointerType === 'mouse' || !this.available()) return;
    event.preventDefault();
    this.pointer = event.pointerId; this.origin = { x: event.clientX, y: event.clientY };
    this.zone.setPointerCapture(event.pointerId);
    const style = this.element.style;
    style.left = `${event.clientX}px`; style.top = `${event.clientY}px`;
    style.setProperty('--stick-x', '0px'); style.setProperty('--stick-y', '0px');
    this.element.classList.add('active');
    this.radius = this.element.offsetWidth * .3;
  }
  move(event) {
    if (event.pointerId !== this.pointer) return;
    event.preventDefault();
    const x = (event.clientX - this.origin.x) / this.radius, y = (this.origin.y - event.clientY) / this.radius;
    const length = Math.hypot(x, y), amount = Math.min(1, length);
    const strength = amount <= .12 ? 0 : (amount - .12) / .88;
    this.vector = { x: length ? x / length * strength : 0, y: length ? y / length * strength : 0 };
    this.element.style.setProperty('--stick-x', `${length ? x / length * amount * this.radius : 0}px`);
    this.element.style.setProperty('--stick-y', `${length ? -y / length * amount * this.radius : 0}px`);
    // A tap is not a drive: only a drag past the dead zone takes control.
    if (strength) { this.engaged = true; this.onDrive(); }
  }
  release() {
    const pointer = this.pointer; this.pointer = null; this.vector = { x: 0, y: 0 };
    this.element.classList.remove('active');
    if (pointer !== null && this.zone.hasPointerCapture(pointer)) this.zone.releasePointerCapture(pointer);
  }
  clear() { if (this.engaged || this.pointer !== null) this.release(); this.engaged = false; }
}

// In the chase view the stick controls the car, independent of camera rotation.
// Use the existing analog driving physics for gradual steering and brake/reverse.
export function thirdPersonDrivingInput(stick) {
  return {
    forward: Math.max(0, stick.y), brake: Math.max(0, -stick.y),
    left: Math.max(0, -stick.x), right: Math.max(0, stick.x),
    handbrake: Math.hypot(stick.x, stick.y) === 0,
  };
}

// Invert the terrain's local screen projection. Including terrain height and the
// actual road coordinates keeps cardinal and diagonal drags aligned with pixels
// even on slopes, bends, or after rotating/resizing the camera.
export function touchDrivingInput(stick, camera, route, s, u, origin = 0) {
  const amount = Math.min(1, Math.hypot(stick.x, stick.y));
  if (!amount) return { amount: 0 };
  const step = .1, p = route.position(s, u), a = route.position(s + step, u), b = route.position(s, u + step);
  const along = { x: (a.x - p.x) / step, y: (a.y - p.y) / step, z: (a.z - p.z) / step };
  const across = { x: (b.x - p.x) / step, y: (b.y - p.y) / step, z: (b.z - p.z) / step };
  camera.updateMatrixWorld();
  const m = camera.matrixWorld.elements;
  // Perspective also changes scale with depth. Evaluate its local derivative
  // at the car, in the same rebased coordinates used to render the scene.
  const point = camera.isPerspectiveCamera
    ? new THREE.Vector3(p.x, p.y + .13, p.z + origin).applyMatrix4(camera.matrixWorldInverse) : null;
  if (point && point.z >= -.1) return { amount: 0 };
  const depth = v => m[8] * v.x + m[9] * v.y + m[10] * v.z;
  const screenX = v => m[0] * v.x + m[1] * v.y + m[2] * v.z - (point ? point.x / point.z * depth(v) : 0);
  const screenY = v => m[4] * v.x + m[5] * v.y + m[6] * v.z - (point ? point.y / point.z * depth(v) : 0);
  const ax = screenX(along), ay = screenY(along), bx = screenX(across), by = screenY(across);
  const determinant = ax * by - ay * bx;
  if (Math.abs(determinant) < .001) return { amount: 0 };
  let ds = (stick.x * by - stick.y * bx) / determinant;
  let du = (ax * stick.y - ay * stick.x) / determinant;
  const dx = along.x * ds + across.x * du, dz = along.z * ds + across.z * du;
  const length = Math.hypot(dx, dz);
  if (length < .0001) return { amount: 0 };
  ds /= length; du /= length;
  return { amount, along: ds, across: du, heading: Math.atan2(dx, -dz) };
}
