import * as THREE from 'three';

// Labels that float up and fade: demolition prices, taxi pay and tips. A pool
// of canvas sprites drawn over everything, reusing the oldest when full.
// Screen-size caps keep them readable without covering the road.
// They rise over the player's car and go along with it: left where they
// popped, they were behind the car before they could be read. Through the
// driver's eyes (the camera within FIRST_PERSON of the car) over the roof is
// out of view, so they rise AHEAD meters in front instead.
const LABELS = 12, LABEL_LIFE = 1.8, LABEL_RISE = 2, LABEL_HEIGHT = 2.4, FIRST_PERSON = 3, AHEAD = 7;
const PIXEL_HEIGHT = 88, WORLD_HEIGHT = 1;
const eye = new THREE.Vector3(), base = new THREE.Vector3(), front = new THREE.Vector3(), up = new THREE.Vector3(), depth = new THREE.Vector3(), screen = new THREE.Vector3();
// Use CSS pixels and the shorter edge so rotating a phone cannot enlarge its rewards.
const pixelHeight = () => Math.max(56, Math.min(PIXEL_HEIGHT, Math.min(globalThis.innerWidth || 1280, globalThis.innerHeight || 800) * .15));
const stackSlots = () => Math.max(1, Math.min(4, Math.floor(((globalThis.innerHeight || 800) - 180) / (pixelHeight() * 1.12))));

export class FloatingLabels {
  constructor(scene, name) {
    this.group = new THREE.Group(); this.group.name = name; scene.add(this.group);
    this.labels = globalThis.document ? Array.from({ length: LABELS }, () => {
      const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 208;
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true, fog: false });
      const sprite = new THREE.Sprite(material); sprite.visible = false; sprite.renderOrder = 3; sprite.userData.ambientOcclusion = false;
      this.group.add(sprite);
      return { canvas, ctx: canvas.getContext('2d'), map, material, sprite, age: Infinity, stack: 0, aspect: 1 };
    }) : [];
    this.next = 0; this.lastTime = null;
    this.calm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }
  // A stand-in for the labels' program, compiled with the city
  warmupObjects() { return this.labels.length ? [new THREE.Sprite(this.labels[0].material)] : []; }
  reset() {
    for (const label of this.labels) { label.age = Infinity; label.sprite.visible = false; }
    this.lastTime = null;
  }
  // Shows `amount` under an optional `caption`, rising over the car (see render).
  pop({ amount, caption = '', colour }) {
    if (!this.labels.length) return;
    const label = this.labels[this.next]; this.next = (this.next + 1) % this.labels.length;
    const { ctx, canvas } = label;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    const centre = canvas.width / 2, accent = colour ?? '#9ff2e6';
    ctx.font = "700 112px Oswald, 'Arial Narrow', Arial, sans-serif";
    const amountWidth = Math.min(680, ctx.measureText(amount).width);
    ctx.font = "600 44px Oswald, 'Arial Narrow', Arial, sans-serif";
    const captionWidth = Math.min(650, ctx.measureText(caption).width);
    const width = Math.min(744, Math.max(176, amountWidth + 64, captionWidth + 68));
    // Crop empty texture space so short rewards get the same readable type as long ones.
    label.map.repeat.set(width / canvas.width, 1); label.map.offset.x = (1 - width / canvas.width) / 2;
    label.aspect = width / canvas.height;
    if (caption) {
      const left = centre - captionWidth / 2 - 22, right = centre + captionWidth / 2 + 22;
      const plate = ctx.createLinearGradient(0, 10, 0, 62);
      plate.addColorStop(0, '#344852'); plate.addColorStop(1, '#101c24');
      ctx.fillStyle = plate; ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(left + 9, 10); ctx.lineTo(right, 10); ctx.lineTo(right - 9, 62); ctx.lineTo(left, 62); ctx.closePath();
      ctx.shadowColor = '#030910'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4; ctx.fill();
      ctx.shadowBlur = ctx.shadowOffsetY = 0; ctx.stroke();
      ctx.fillStyle = accent; ctx.fillText(caption, centre, 48, 650);
      ctx.fillStyle = '#ffffff30'; ctx.fillRect(left + 12, 13, right - left - 22, 2);
    }
    const baseline = caption ? 177 : 147;
    ctx.font = "700 112px Oswald, 'Arial Narrow', Arial, sans-serif";
    ctx.lineWidth = 18; ctx.strokeStyle = '#101c24';
    ctx.shadowColor = '#030910'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 7;
    ctx.strokeText(amount, centre, baseline, 680);
    ctx.shadowBlur = ctx.shadowOffsetY = 0;
    ctx.fillStyle = accent; ctx.fillText(amount, centre + 2, baseline + 5, 680);
    const ink = ctx.createLinearGradient(0, baseline - 108, 0, baseline);
    ink.addColorStop(0, '#ffffff'); ink.addColorStop(.45, '#fffbea'); ink.addColorStop(1, accent);
    ctx.fillStyle = ink; ctx.fillText(amount, centre, baseline, 680);
    label.map.needsUpdate = true;
    // Short screens fit fewer slots. Reuse the oldest rather than covering another reward.
    const rising = this.labels.filter(other => other !== label && other.age < LABEL_LIFE);
    const stack = Array.from({ length: stackSlots() }, (_, slot) => slot).find(slot => !rising.some(other => other.stack === slot))
      ?? rising.reduce((oldest, other) => other.age > oldest.age ? other : oldest).stack;
    for (const other of rising) if (other.stack === stack) { other.age = LABEL_LIFE; other.sprite.visible = false; }
    Object.assign(label, { age: 0, stack });
    label.sprite.visible = true; label.material.opacity = 1;
  }
  // Moves the labels up and fades them, over `car` (the player's, as drawn),
  // `height` its height. `camera`, if given, keeps near labels small.
  render(time, camera = null, car = null, height = 0) {
    if (camera) { camera.getWorldPosition(eye); up.set(0, 1, 0).transformDirection(camera.matrixWorld); front.set(0, 0, -1).transformDirection(camera.matrixWorld); }
    else up.set(0, 1, 0);
    if (car) {
      base.copy(car.position);
      if (camera && eye.distanceTo(base) < FIRST_PERSON) { base.add(depth.set(0, 0, -AHEAD).applyQuaternion(car.quaternion)); base.y += 1.6; }
      else base.y += Math.max(LABEL_HEIGHT, height + .9);
    }
    const dt = this.lastTime === null ? 0 : Math.min(.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const viewportHeight = globalThis.innerHeight || 800, viewportWidth = globalThis.innerWidth || 1280, labelHeight = pixelHeight();
    let highest = 0;
    for (const label of this.labels) if (label.age < LABEL_LIFE) highest = Math.max(highest, label.stack);
    const slots = stackSlots();
    // A rotation can leave more live rewards than the shorter screen can hold.
    if (highest >= slots) {
      const rising = this.labels.filter(label => label.age < LABEL_LIFE).sort((a, b) => a.age - b.age);
      for (const [slot, label] of rising.entries()) {
        if (slot < slots) label.stack = slot;
        else { label.age = LABEL_LIFE; label.sprite.visible = false; }
      }
      highest = Math.min(rising.length, slots) - 1;
    }
    const ceiling = 1 - (2 * Math.min(90, viewportHeight * .18) + labelHeight * 1.15 + highest * labelHeight * 2.24) / viewportHeight;
    for (const label of this.labels) {
      if (label.age >= LABEL_LIFE) { if (label.sprite.visible) label.sprite.visible = false; continue; }
      label.age += dt;
      const t = Math.min(1, label.age / LABEL_LIFE), pop = this.calm ? 1 : t < .12 ? .55 + .6 * Math.sin(t / .12 * Math.PI / 2) : t < .24 ? 1.15 - .15 * (t - .12) / .12 : 1;
      label.sprite.position.copy(base);
      if (!this.calm) label.sprite.position.y += LABEL_RISE * (1 - (1 - t) ** 3);
      const pixels = camera ? 2 * (camera.isPerspectiveCamera ? Math.max(camera.near, depth.copy(label.sprite.position).sub(eye).dot(front)) : 1) / (camera.projectionMatrix.elements[5] * viewportHeight) : 0;
      const wantedHeight = camera ? labelHeight * pixels : WORLD_HEIGHT;
      // Bring the whole stack down when its top would run into the HUD or off screen.
      if (camera) {
        screen.copy(label.sprite.position).project(camera);
        if (screen.y > ceiling) label.sprite.position.addScaledVector(up, (ceiling - screen.y) * viewportHeight * pixels / 2);
      }
      label.sprite.position.addScaledVector(up, label.stack * wantedHeight * 1.12);
      const width = Math.min(pop * wantedHeight * label.aspect, camera ? Math.min(viewportWidth * .55, 340) * pixels : 4);
      label.sprite.scale.set(width, width / label.aspect, 1);
      label.material.opacity = t > .75 ? 1 - (t - .75) / .25 : 1;
    }
  }
  dispose() {
    for (const label of this.labels) { label.map.dispose(); label.material.dispose(); }
    this.group.removeFromParent();
  }
}
