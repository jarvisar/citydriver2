import * as THREE from 'three';

// Labels that float up and fade: demolition prices, taxi pay and tips. A pool
// of canvas sprites drawn over everything, reusing the oldest when full.
// Screen-size caps keep them readable without covering the road.
// They rise over the player's car and go along with it: left where they
// popped, they were behind the car before they could be read. Through the
// driver's eyes (the camera within FIRST_PERSON of the car) over the roof is
// out of view, so they rise AHEAD meters in front instead.
const LABELS = 12, LABEL_LIFE = 1.8, LABEL_RISE = 2, LABEL_HEIGHT = 2.4, FIRST_PERSON = 3, AHEAD = 7;
// PITCH is the stack's spacing in canvas heights. A captioned label's drawn rows take about .9 of one.
const PIXEL_HEIGHT = 80, WORLD_HEIGHT = 1, PITCH = 1.06;
const AMOUNT_FONT = "700 104px Oswald, 'Arial Narrow', Arial, sans-serif", CAPTION_FONT = "600 44px Oswald, 'Arial Narrow', Arial, sans-serif";
const eye = new THREE.Vector3(), base = new THREE.Vector3(), front = new THREE.Vector3(), up = new THREE.Vector3(), depth = new THREE.Vector3(), screen = new THREE.Vector3();
// Use CSS pixels and the shorter edge so rotating a phone cannot enlarge its rewards.
const pixelHeight = () => Math.max(52, Math.min(PIXEL_HEIGHT, Math.min(globalThis.innerWidth || 1280, globalThis.innerHeight || 800) * .14));
const stackSlots = () => Math.max(1, Math.min(4, Math.floor(((globalThis.innerHeight || 800) - 180) / (pixelHeight() * PITCH))));

export class FloatingLabels {
  constructor(scene, name) {
    this.group = new THREE.Group(); this.group.name = name; scene.add(this.group);
    this.labels = globalThis.document ? Array.from({ length: LABELS }, () => {
      const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 208;
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true, fog: false });
      // (anchored by the bottom edge, so a label with no caption keeps its amount on the stack's rhythm)
      const sprite = new THREE.Sprite(material); sprite.visible = false; sprite.renderOrder = 3; sprite.userData.ambientOcclusion = false; sprite.center.set(.5, 0);
      this.group.add(sprite);
      return { canvas, ctx: canvas.getContext('2d'), map, material, sprite, age: Infinity, stack: 0, aspect: 1, rows: 1 };
    }) : [];
    this.next = 0; this.lastTime = null; this.shown = true;
    this.calm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }
  // A stand-in for the labels' program, compiled with the city
  warmupObjects() { return this.labels.length ? [new THREE.Sprite(this.labels[0].material)] : []; }
  reset() {
    for (const label of this.labels) { label.age = Infinity; label.sprite.visible = false; }
    this.lastTime = null;
  }
  // The pause menu's Popups switch
  get enabled() { return this.shown; }
  set enabled(on) { this.shown = on; if (!on) this.reset(); }
  // Shows `amount` under an optional `caption`, rising over the car (see
  // render). False if nothing popped (the labels are switched off).
  pop({ amount, caption = '', colour }) {
    if (!this.labels.length || !this.shown) return false;
    const label = this.labels[this.next]; this.next = (this.next + 1) % this.labels.length;
    const { ctx, canvas } = label;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    const centre = canvas.width / 2, accent = colour ?? '#9ff2e6';
    // (letter spacing keeps the outlined digits from running together; it trails, so centered text moves half of it back)
    ctx.font = AMOUNT_FONT; ctx.letterSpacing = '2px';
    const amountWidth = Math.min(680, ctx.measureText(amount).width), rise = ctx.measureText('0').actualBoundingBoxAscent;
    ctx.font = CAPTION_FONT; ctx.letterSpacing = '3px';
    const captionWidth = Math.min(620, ctx.measureText(caption).width), cap = ctx.measureText('H').actualBoundingBoxAscent;
    const width = Math.min(744, Math.max(176, amountWidth + 56, caption ? captionWidth + 100 : 0));
    // The amount sits near the bottom edge with the caption's plate just over it.
    // Empty space round them is cropped with the texture's UV transform, so short
    // rewards get the same type size as long ones.
    const baseline = canvas.height - 28, plateBottom = baseline - rise - 16, plateTop = plateBottom - 54;
    const top = Math.max(0, caption ? plateTop - 12 : baseline - rise - 18), rows = canvas.height - top;
    label.map.repeat.set(width / canvas.width, rows / canvas.height); label.map.offset.set((1 - width / canvas.width) / 2, 0);
    label.aspect = width / rows; label.rows = rows / canvas.height;
    if (caption) {
      const half = captionWidth / 2 + 32, left = centre - half, right = centre + half, slant = 10;
      const plate = ctx.createLinearGradient(0, plateTop, 0, plateBottom);
      plate.addColorStop(0, '#3e535d'); plate.addColorStop(.5, '#24363f'); plate.addColorStop(.5, '#17262f'); plate.addColorStop(1, '#0e1a22');
      ctx.beginPath(); ctx.moveTo(left + slant, plateTop); ctx.lineTo(right, plateTop); ctx.lineTo(right - slant, plateBottom); ctx.lineTo(left, plateBottom); ctx.closePath();
      ctx.shadowColor = '#030910c0'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
      ctx.fillStyle = plate; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.lineWidth = 2.5; ctx.strokeStyle = accent; ctx.stroke();
      ctx.fillStyle = '#ffffff30'; ctx.fillRect(left + slant + 3, plateTop + 4, right - left - slant - 8, 2);
      ctx.shadowColor = '#000000b0'; ctx.shadowOffsetY = 2; ctx.shadowBlur = 0;
      ctx.fillStyle = accent; ctx.fillText(caption, centre + 1.5, (plateTop + plateBottom + cap) / 2, 620);
    }
    ctx.font = AMOUNT_FONT; ctx.letterSpacing = '2px';
    const x = centre + 1;
    ctx.lineWidth = 14; ctx.strokeStyle = '#101c24';
    ctx.shadowColor = '#030910c0'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 6;
    ctx.strokeText(amount, x, baseline, 680);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = ctx.shadowOffsetY = 0;
    ctx.fillStyle = accent; ctx.fillText(amount, x, baseline + 4, 680);
    const ink = ctx.createLinearGradient(0, baseline - rise, 0, baseline);
    ink.addColorStop(0, '#ffffff'); ink.addColorStop(.45, '#fffbea'); ink.addColorStop(1, accent);
    ctx.fillStyle = ink; ctx.fillText(amount, x, baseline, 680);
    label.map.needsUpdate = true;
    // Short screens fit fewer slots. Reuse the oldest rather than covering another reward.
    const rising = this.labels.filter(other => other !== label && other.age < LABEL_LIFE);
    const stack = Array.from({ length: stackSlots() }, (_, slot) => slot).find(slot => !rising.some(other => other.stack === slot))
      ?? rising.reduce((oldest, other) => other.age > oldest.age ? other : oldest).stack;
    for (const other of rising) if (other.stack === stack) { other.age = LABEL_LIFE; other.sprite.visible = false; }
    Object.assign(label, { age: 0, stack });
    label.sprite.visible = true; label.material.opacity = 1;
    return true;
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
    // (the top label's top edge, allowing for the bounce, stays under the HUD)
    const ceiling = 1 - 2 * (Math.min(90, viewportHeight * .18) + labelHeight * (1 + highest * PITCH)) / viewportHeight;
    for (const label of this.labels) {
      if (label.age >= LABEL_LIFE) { if (label.sprite.visible) label.sprite.visible = false; continue; }
      label.age += dt;
      const t = Math.min(1, label.age / LABEL_LIFE), pop = this.calm ? 1 : t < .12 ? .55 + .6 * Math.sin(t / .12 * Math.PI / 2) : t < .24 ? 1.15 - .15 * (t - .12) / .12 : 1;
      label.sprite.position.copy(base);
      if (!this.calm) label.sprite.position.y += LABEL_RISE * (1 - (1 - t) ** 3);
      const pixels = camera ? 2 * (camera.isPerspectiveCamera ? Math.max(camera.near, depth.copy(label.sprite.position).sub(eye).dot(front)) : 1) / (camera.projectionMatrix.elements[5] * viewportHeight) : 0;
      const full = camera ? labelHeight * pixels : WORLD_HEIGHT, wantedHeight = full * label.rows;
      // (bottom-anchored, so dropped by about half a label to keep the middle where it rose from)
      label.sprite.position.addScaledVector(up, -.42 * full);
      // Bring the whole stack down when its top would run into the HUD or off screen.
      if (camera) {
        screen.copy(label.sprite.position).project(camera);
        if (screen.y > ceiling) label.sprite.position.addScaledVector(up, (ceiling - screen.y) * viewportHeight * pixels / 2);
      }
      label.sprite.position.addScaledVector(up, label.stack * full * PITCH);
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
