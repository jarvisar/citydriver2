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
    // Panels hang here: at the head's recentred position, level, facing the
    // way the game's camera looks. A HUD rides along with the car like a
    // dashboard, and a menu stays put while the drive is paused.
    this.anchor = new THREE.Group();
    this.rig.add(this.anchor);
    this.comfort = new ComfortVignette(this.camera);
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
      this.anchor.position.copy(this.origin);
      this.anchor.quaternion.copy(this.orientation).invert();
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

// Comfort: a soft dark ring closes in round the view while the game turns
// the camera or the car surges, the usual cure for being turned by something
// other than your own head. It is moderate (the middle of the view stays
// clear and bright), fades as soon as the turn ends and never shows while
// paused. The pause menu's Comfort vignette switch turns it off.
const APERTURE = { wide: THREE.MathUtils.degToRad(58), narrow: THREE.MathUtils.degToRad(34) };
export class ComfortVignette {
  constructor(camera, distance = .3) {
    // A ring whose inner edge is clear and whose feather and far edge are
    // dark; its scale sets the clear aperture.
    const geometry = new THREE.RingGeometry(1, 30, 48, 2);
    const position = geometry.getAttribute('position'), colors = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getY(i));
      colors.set([0, 0, 0, r < 1.01 ? 0 : .92], i * 4);
    }
    // The middle ring of vertices sets how soft the edge is.
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getY(i));
      if (r > 1.01 && r < 29) { const scale = 1.45 / r; position.setXY(i, position.getX(i) * scale, position.getY(i) * scale); }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    // Over the city but under the HUD and menus
    this.mesh.renderOrder = 998; this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.mesh.position.z = -distance; this.distance = distance;
    camera.add(this.mesh);
    this.enabled = true; this.amount = 0; this.heading = null; this.speed = 0;
  }
  // `source` is the game's camera, whose turning the headset is carried by.
  update(source, speed, dt, active) {
    const heading = yaw(source.quaternion);
    let target = 0;
    if (active && this.enabled && dt > 0 && this.heading !== null) {
      const turn = Math.abs(Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading))) / dt;
      const surge = Math.abs(speed - this.speed) / dt;
      // From 20 degrees a second of turning; fully in by 90. A hard launch or
      // stop adds a little.
      target = Math.min(1, Math.max(0, (turn - .35) / 1.2) + Math.max(0, (surge - 8) / 30));
    }
    this.heading = heading; this.speed = speed;
    if (!active || !this.enabled) this.amount = 0;
    // In quickly, out gently
    else if (dt > 0) this.amount = THREE.MathUtils.damp(this.amount, target, target > this.amount ? 8 : 2.5, dt);
    this.mesh.visible = this.amount > .02;
    if (this.mesh.visible) this.mesh.scale.setScalar(this.distance * Math.tan(THREE.MathUtils.lerp(APERTURE.wide, APERTURE.narrow, this.amount)));
  }
}
