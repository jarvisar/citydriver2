import * as THREE from 'three';

// Labels that float up and fade: demolition prices, taxi pay and tips. A pool
// of canvas sprites drawn over everything, reusing the oldest when full. Near
// the camera a label is at most NEAR times its distance wide, so it cannot
// cover the road.
const LABELS = 12, LABEL_LIFE = 1.3, LABEL_RISE = 2.6, LABEL_HEIGHT = 2.4, NEAR = .3;
const eye = new THREE.Vector3();

export class FloatingLabels {
  constructor(scene, name) {
    this.group = new THREE.Group(); this.group.name = name; scene.add(this.group);
    this.labels = globalThis.document ? Array.from({ length: LABELS }, () => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true, fog: false });
      const sprite = new THREE.Sprite(material); sprite.visible = false; sprite.renderOrder = 3; sprite.userData.ambientOcclusion = false;
      this.group.add(sprite);
      return { canvas, ctx: canvas.getContext('2d'), map, material, sprite, age: Infinity, x: 0, y: 0, z: 0, size: 1 };
    }) : [];
    this.next = 0; this.lastTime = null;
  }
  // A stand-in for the labels' program, compiled with the city
  warmupObjects() { return this.labels.length ? [new THREE.Sprite(this.labels[0].material)] : []; }
  reset() {
    for (const label of this.labels) { label.age = Infinity; label.sprite.visible = false; }
    this.lastTime = null;
  }
  // Shows `amount` under an optional `caption`, rising from (x, y, z) in world
  // coordinates (z is -s), `size` metres wide
  pop({ x, y, z, amount, caption = '', colour, size }) {
    if (!this.labels.length) return;
    const label = this.labels[this.next]; this.next = (this.next + 1) % this.labels.length;
    const { ctx, canvas } = label;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#17262f'; ctx.fillStyle = colour;
    if (caption) {
      ctx.font = "800 38px 'Segoe UI', Arial, sans-serif"; ctx.lineWidth = 9;
      ctx.strokeText(caption, 256, 50, 500); ctx.fillText(caption, 256, 50, 500);
    }
    ctx.font = "900 88px 'Segoe UI', Arial, sans-serif"; ctx.lineWidth = 14;
    ctx.strokeText(amount, 256, 138, 500); ctx.fillText(amount, 256, 138, 500);
    label.map.needsUpdate = true;
    // (stacked over any other still rising from the same spot)
    const stack = this.labels.filter(other => other !== label && other.age < .6 && Math.hypot(other.x - x, other.z - z) < 4).length;
    Object.assign(label, { age: 0, x, y: y + LABEL_HEIGHT + stack * .8, z, size });
    label.sprite.visible = true;
  }
  // Moves the labels up and fades them. `camera`, if given, keeps near labels
  // small.
  render(origin, time, camera = null) {
    this.group.position.z = origin;
    if (camera) camera.getWorldPosition(eye);
    const dt = this.lastTime === null ? 0 : Math.min(.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    for (const label of this.labels) {
      if (label.age >= LABEL_LIFE) { if (label.sprite.visible) label.sprite.visible = false; continue; }
      label.age += dt;
      const t = Math.min(1, label.age / LABEL_LIFE), pop = t < .1 ? .55 + 4.5 * t : t < .2 ? 1 + .15 * (1 - (t - .1) / .1) : 1;
      const at = label.sprite.position.set(label.x, label.y + LABEL_RISE * (1 - (1 - t) ** 3), label.z);
      const size = pop * (camera ? Math.min(label.size, Math.hypot(at.x - eye.x, at.y - eye.y, at.z + origin - eye.z) * NEAR) : label.size);
      label.sprite.scale.set(size, size * .3125, 1);
      label.material.opacity = t > .7 ? 1 - (t - .7) / .3 : 1;
    }
  }
  dispose() {
    for (const label of this.labels) { label.map.dispose(); label.material.dispose(); }
    this.group.removeFromParent();
  }
}
