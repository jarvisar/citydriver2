import * as THREE from 'three';

// The page's own palette and type (city-theme.css), so the headset's panels
// read as the same game: slate panels, taxi yellow for the main action and a
// gold ring round whatever is selected.
const UI = {
  panel: '#263b45', glass: '#263b45f2', raised: '#304954', hover: '#3b5662', recessed: '#1b2d36',
  text: '#f5f4e9', muted: '#c4d3d8', line: '#afc9d13d', switchLine: '#afc9d180',
  accent: '#ffd238', accentHover: '#ffe177', gold: '#f3d899', onAccent: '#17262f',
  urgent: '#ffb5a6', onUrgent: '#721e15', font: "'Segoe UI', Arial, sans-serif",
};
// Fare ratings and goals, as the taxi HUD colours them (taxi.css).
export const TONES = { speedy: '#7ce787', normal: '#ffd238', slow: '#ff8a7a', goal: '#c3f4bb' };
// Where the panels hang: metres from the eyes, degrees below eye level and
// width in metres. Both are drawn at about 27 canvas pixels a degree, a
// Quest 3's own sharpness. A menu opens in front of wherever the player is
// looking, 5 degrees low as Android XR places its panels, well inside the
// 0.8-3 m Meta gives for pointing. The HUD sits under the car, which a chase
// view puts 12-18 degrees below the horizon (its top edge at 21), and is never
// pointed at. Meta's guidelines rule out panels locked to the head.
const MENU = { distance: 1.5, drop: 5, width: 1.02, pixels: 1024 };
const HUD = { distance: 1.55, drop: 21, width: .98, pixels: 1024, top: true };
// Menu layout, in canvas pixels. Rows are 2.6 degrees tall, Meta's 48 dp
// target, and labels about 1.1 degrees, above its 18 dp for easy reading.
const PAD = 40, ROW = 72, GAP = 10, HEADING = 44, COLUMN_GAP = 24, NARROW = 620, ROWS = 7;
// Meta's pointer: a short beam from the hand that fades out, and a dot on the panel.
const BEAM = .4;

const font = (size, weight = 400) => `${weight} ${size}px ${UI.font}`;
function fit(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > width) end--;
  return `${text.slice(0, end)}…`;
}
// Hint lines break between their ' · ' parts where they can.
function wrap(ctx, text, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const part of paragraph.split(' · ')) {
      const next = line ? `${line} · ${part}` : part;
      if (line && ctx.measureText(next).width > width) { lines.push(line); line = part; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
// Pour a long list down two columns a page, with a heading over each group
// (again at the top of a page it carries on to).
function pour(items, body) {
  const pages = [], limit = ROWS * (ROW + GAP);
  let page = null, column = 1, y = limit, group = null;
  for (const index of body) {
    const item = items[index];
    let heading = Boolean(item.group) && item.group !== group;
    if (y + (heading ? 8 + HEADING : 0) + ROW > limit) {
      column++; y = 0;
      if (column > 1) { page = { rows: [], headings: [], height: 0 }; pages.push(page); column = 0; heading = Boolean(item.group); }
    }
    if (heading) { if (y > 0) y += 8; page.headings.push({ text: item.group, column, y }); y += HEADING; group = item.group; }
    page.rows.push({ index, column, y }); y += ROW + GAP;
    page.height = Math.max(page.height, y);
  }
  return pages;
}
function box(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

// One canvas on a plane, cropped to what was drawn so the panel fits its content.
class Panel {
  constructor(parent, { width, pixels }, height, order) {
    this.canvas = document.createElement('canvas');
    // Fixed texture dimensions across redraws; only the crop changes.
    this.canvas.width = pixels; this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4;
    this.scale = width / pixels;
    // Drawn after everything else and through it, so no fare badge or lamp
    // halo shows through a menu.
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    this.mesh.renderOrder = order; this.mesh.frustumCulled = false; this.mesh.visible = false;
    parent.add(this.mesh);
  }
  clear() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  crop(width, height) {
    this.width = width; this.height = height;
    this.mesh.scale.set(width * this.scale, height * this.scale, 1);
    this.texture.repeat.set(width / this.canvas.width, height / this.canvas.height);
    this.texture.offset.set(0, 1 - height / this.canvas.height);
    if (this.top) this.mesh.position.copy(this.base).addScaledVector(this.up, -height * this.scale / 2);
    this.texture.needsUpdate = true; this.mesh.visible = true;
  }
  // Hang it `distance` metres out and `drop` degrees low, tilted to face
  // the eyes: by its middle, or by its top edge so a taller one grows down.
  hang({ distance, drop, top = false }) {
    const angle = THREE.MathUtils.degToRad(drop);
    this.base = new THREE.Vector3(0, -Math.sin(angle) * distance, -Math.cos(angle) * distance);
    this.up = new THREE.Vector3(0, Math.cos(angle), -Math.sin(angle));
    this.top = top; this.mesh.position.copy(this.base);
    this.mesh.rotation.set(-angle, 0, 0);
  }
}

// Immersive sessions cannot show the page's menus or HUD. The game describes
// both as plain models and this draws them on canvases in the headset: a menu
// worked by stick and A or by pointing and pulling a trigger, and a HUD that
// is only read.
//
// A menu model is `{ id, title, subtitle, hint, columns, flow, image, items }`.
// Each item has a `label` and `activate`, and may have `value`, `toggle`
// (on/off), `swatch` (a colour), `current`, `primary`, `disabled`, `header`
// (the action beside the title, as Resume is on the pause screen), `footer`,
// `column` (0 or 1) and `group` (a heading over its rows). `flow` pours a long
// list into two columns of pages; `mark` is an image beside the title.
export class VRStatus {
  constructor(camera, anchor = camera) {
    this.camera = camera; this.anchor = anchor;
    this.model = null; this.hudModel = null; this.entries = []; this.selected = 0; this.pageIndex = 0;
    this.signature = ''; this.hudSignature = ''; this.regions = []; this.order = [];
    this.memory = new Map(); this.triggers = new Map(); this.hovers = new Map(); this.selecting = new Set(); this.flash = null;
    this.raycaster = new THREE.Raycaster(); this.transform = new THREE.Matrix4(); this.stretch = new THREE.Matrix4();
    this.head = new THREE.Vector3(); this.facing = new THREE.Vector3();
  }
  build() {
    if (this.menu) return;
    this.menuFrame = new THREE.Group(); this.anchor.add(this.menuFrame);
    this.menu = new Panel(this.menuFrame, MENU, 1024, 1000); this.menu.hang(MENU);
    this.hudFrame = new THREE.Group(); this.anchor.add(this.hudFrame);
    this.hudPanel = new Panel(this.hudFrame, HUD, 256, 999); this.hudPanel.hang(HUD);
    // A beam from each hand while a menu is up, and a dot where it points.
    const beam = new THREE.CylinderGeometry(.003, .0015, 1, 6, 1, true); beam.rotateX(Math.PI / 2); beam.translate(0, 0, -.5);
    const fade = beam.getAttribute('position'), alpha = new Float32Array(fade.count * 4);
    for (let i = 0; i < fade.count; i++) alpha.set([1, 1, 1, .8 * (1 + fade.getZ(i))], i * 4);
    beam.setAttribute('color', new THREE.BufferAttribute(alpha, 4));
    const beamMaterial = new THREE.MeshBasicMaterial({ color: UI.text, vertexColors: true, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const dotMaterial = new THREE.MeshBasicMaterial({ color: UI.gold, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const dot = new THREE.CircleGeometry(.009, 20);
    this.rays = [0, 1].map(() => {
      const ray = new THREE.Mesh(beam, beamMaterial); ray.matrixAutoUpdate = false; ray.renderOrder = 1001; ray.frustumCulled = false; ray.visible = false;
      const cursor = new THREE.Mesh(dot, dotMaterial); cursor.renderOrder = 1002; cursor.frustumCulled = false; cursor.visible = false;
      this.menuFrame.add(cursor);
      return { ray, cursor };
    });
  }
  // Hand-tracked pinches arrive as select events rather than a trigger.
  attach(session) {
    this.selecting.clear();
    session.addEventListener('selectstart', event => this.selecting.add(event.inputSource));
    session.addEventListener('selectend', event => this.selecting.delete(event.inputSource));
  }
  get visible() { return Boolean(this.model); }
  toast(text, tone = '') { this.flash = { text, tone, until: performance.now() + 2200 }; }
  update(model) {
    if (!model) {
      if (this.menu) { this.menu.mesh.visible = false; for (const { ray, cursor } of this.rays) ray.visible = cursor.visible = false; }
      if (this.model) this.memory.clear();
      this.model = null; this.signature = ''; this.triggers.clear(); this.hovers.clear(); return;
    }
    this.build();
    if (model.id !== this.model?.id) {
      // Coming back from a chooser returns to the row that opened it.
      if (this.model) this.memory.set(this.model.id, this.selected);
      if (!this.model) this.placed = false;
      // A pointer already resting on the panel leaves the default alone
      // until it moves to another row.
      this.settle = true;
      const primary = model.items.findIndex(item => item.primary && !item.disabled);
      this.selected = this.memory.get(model.id) ?? Math.max(0, primary);
      this.pageIndex = -1;
    }
    this.model = model;
    const body = model.items.flatMap((item, index) => item.header || item.footer ? [] : [index]);
    this.flowPages = model.flow ? pour(model.items, body) : null;
    this.pages = Math.max(1, this.flowPages?.length ?? 1);
    // The page buttons join the list, so the stick reaches them as well.
    this.entries = this.pages > 1 ? [...model.items,
      { label: '‹ Previous', footer: true, page: -1, activate: () => this.page(-1) },
      { label: 'Next ›', footer: true, page: 1, activate: () => this.page(1) }] : model.items;
    this.selected = Math.min(this.selected, this.entries.length - 1);
    const at = this.flowPages?.findIndex(page => page.rows.some(row => row.index === this.selected)) ?? -1;
    if (at >= 0) this.pageIndex = at;
    this.pageIndex = Math.min(Math.max(this.pageIndex, 0), this.pages - 1);
    const signature = JSON.stringify([model.id, model.title, model.subtitle, model.hint, model.imageKey, model.mark?.complete,
      this.entries.map(item => [item.label, item.value, item.toggle, item.swatch, item.current, item.disabled]), this.selected, this.pageIndex]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.draw();
  }
  // The visual reading order, which the stick follows.
  navigable() { return this.order.filter(index => !this.entries[index].disabled); }
  move(action) {
    const order = this.navigable();
    if (!order.length) return;
    const current = order.indexOf(this.selected);
    if (action === 'vrMenuPrevious' || action === 'vrMenuNext') {
      const step = action === 'vrMenuNext' ? 1 : -1;
      this.selected = order[((current < 0 ? 0 : current + step) % order.length + order.length) % order.length];
    } else {
      // Left and right cross to the nearest row of the other column, or turn the page.
      const from = this.regions.find(region => region.index === this.selected), direction = action === 'vrMenuRight' ? 1 : -1;
      let best = null, bestCost = Infinity;
      if (from) for (const region of this.regions) {
        if (this.entries[region.index].disabled) continue;
        const dx = (region.x + region.width / 2 - from.x - from.width / 2) * direction;
        if (dx <= from.width / 4) continue;
        const cost = Math.abs(region.y + region.height / 2 - from.y - from.height / 2) * 3 + dx;
        if (cost < bestCost) { bestCost = cost; best = region; }
      }
      if (best) this.selected = best.index;
      else if (this.pages > 1) { this.page(direction); return; }
    }
    this.update(this.model);
  }
  activate() {
    const item = this.entries[this.selected];
    if (item && !item.disabled) item.activate();
  }
  page(direction) {
    if (!this.model || this.pages < 2) return;
    this.pageIndex = (this.pageIndex + direction + this.pages) % this.pages;
    // The page buttons keep the selection, so they can be pressed again.
    if (!this.entries[this.selected]?.page) this.selected = this.flowPages[this.pageIndex].rows[0].index;
    this.signature = ''; this.update(this.model);
  }
  draw() {
    const model = this.model, panel = this.menu, ctx = panel.ctx;
    const header = [], body = [], footer = [];
    this.entries.forEach((item, index) => (item.header ? header : item.footer ? footer : body).push(index));
    const two = model.flow || model.columns === 2 || model.image;
    const width = two ? MENU.pixels : NARROW, inner = width - PAD * 2;
    // A single column of buttons centres them, as the page's title screen does.
    this.narrow = !two;
    const column = two && !model.image ? (inner - COLUMN_GAP) / 2 : inner;
    this.regions = [];
    const place = (index, x, y, w, h = ROW) => this.regions.push({ index, x, y, width: w, height: h });
    // Header: the title and a line under it, with the header action beside them.
    let y = PAD;
    const mark = model.mark?.complete ? 64 : 0, titleX = PAD + (mark ? mark + 16 : 0);
    const titleWidth = inner - (titleX - PAD) - (header.length || this.pages > 1 ? 260 : 0);
    if (header.length) place(header[0], width - PAD - 240, y, 240, 70);
    y += Math.max(56 + (model.subtitle ? 38 : 0), header.length ? 74 : 0) + 26;
    const top = y, columnsY = [top, top], headings = [];
    if (model.image) {
      const scale = Math.min(inner / model.image.width, 520 / model.image.height);
      this.imageBox = { x: PAD + (inner - model.image.width * scale) / 2, y, width: model.image.width * scale, height: model.image.height * scale };
      y += this.imageBox.height + 20;
    } else this.imageBox = null;
    if (model.flow) {
      const page = this.flowPages[this.pageIndex], x = c => PAD + c * (column + COLUMN_GAP);
      for (const heading of page.headings) headings.push({ text: heading.text, x: x(heading.column), y: top + heading.y });
      for (const row of page.rows) place(row.index, x(row.column), top + row.y, column);
      // Every page as tall as the tallest, so the panel keeps still
      y = top + Math.max(...this.flowPages.map(page => page.height));
    } else if (!model.image) {
      const groups = [null, null];
      for (const index of body) {
        const item = this.entries[index], c = two ? item.column ?? 0 : 0;
        if (item.group && item.group !== groups[c]) {
          if (groups[c] !== null || columnsY[c] > top) columnsY[c] += 8;
          headings.push({ text: item.group, x: PAD + c * (column + COLUMN_GAP), y: columnsY[c] });
          columnsY[c] += HEADING; groups[c] = item.group;
        }
        place(index, PAD + c * (column + COLUMN_GAP), columnsY[c], column);
        columnsY[c] += ROW + GAP;
      }
      y = Math.max(y, ...columnsY);
    }
    if (footer.length) {
      y += 6;
      const each = (inner - (footer.length - 1) * GAP) / footer.length;
      footer.forEach((index, i) => place(index, PAD + i * (each + GAP), y, each));
      y += ROW + GAP;
    }
    ctx.font = font(24);
    const hint = model.hint ? wrap(ctx, model.hint, inner) : [];
    const height = Math.ceil(y + (hint.length ? 8 + hint.length * 32 : 0) + PAD - GAP);
    // Reading order: header, each column top to bottom, then the footer.
    this.order = [...header, ...this.regions.filter(r => body.includes(r.index)).sort((a, b) => a.x - b.x || a.y - b.y).map(r => r.index), ...footer];
    if (model.flow) this.order = [...header, ...body, ...footer];

    panel.clear();
    box(ctx, 1, 1, width - 2, height - 2, 30, UI.panel, UI.line);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    if (mark) ctx.drawImage(model.mark, PAD, PAD + 4, mark, mark);
    // Headings as the page's, tight; the wordmark tighter still.
    ctx.fillStyle = UI.text; ctx.font = font(50, 750); ctx.letterSpacing = model.wordmark ? '-3px' : '-1px';
    ctx.fillText(fit(ctx, model.title ?? '', titleWidth), titleX, PAD + 46); ctx.letterSpacing = '0px';
    if (model.subtitle) { ctx.fillStyle = UI.muted; ctx.font = font(27); ctx.fillText(fit(ctx, model.subtitle, titleWidth), titleX, PAD + 90); }
    ctx.fillStyle = UI.line; ctx.fillRect(PAD, top - 14, inner, 2);
    ctx.font = font(22, 750); ctx.fillStyle = UI.gold; ctx.letterSpacing = '2px';
    for (const heading of headings) ctx.fillText(heading.text.toUpperCase(), heading.x + 2, heading.y + 28);
    ctx.letterSpacing = '0px';
    if (this.imageBox) {
      const b = this.imageBox;
      ctx.save(); ctx.beginPath(); ctx.roundRect(b.x, b.y, b.width, b.height, 16); ctx.clip();
      ctx.drawImage(model.image, b.x, b.y, b.width, b.height); ctx.restore();
      box(ctx, b.x, b.y, b.width, b.height, 16, null, UI.line);
    }
    for (const region of this.regions) this.row(region, this.entries[region.index], region.index === this.selected);
    if (this.pages > 1 && !header.length) {
      ctx.fillStyle = UI.muted; ctx.font = font(27, 600); ctx.textAlign = 'right';
      ctx.fillText(`Page ${this.pageIndex + 1} / ${this.pages}`, width - PAD, PAD + 42);
    }
    ctx.fillStyle = UI.muted; ctx.font = font(24); ctx.textAlign = 'center';
    hint.forEach((line, i) => ctx.fillText(fit(ctx, line, inner), width / 2, y + 22 + i * 32));
    panel.crop(width, height);
  }
  row({ x, y, width, height }, item, selected) {
    const ctx = this.menu.ctx, middle = y + height / 2;
    ctx.globalAlpha = item.disabled ? .5 : 1;
    const fill = item.primary ? selected ? UI.accentHover : UI.accent : selected ? UI.hover : UI.raised;
    box(ctx, x, y, width, height, 14, fill, item.primary ? null : UI.line);
    if (selected) {
      ctx.beginPath(); ctx.roundRect(x - 6, y - 6, width + 12, height + 12, 19);
      ctx.strokeStyle = UI.gold; ctx.lineWidth = 4; ctx.stroke();
    }
    ctx.textBaseline = 'middle';
    let left = x + 22, right = x + width - 22;
    if (item.swatch) {
      ctx.beginPath(); ctx.arc(left + 17, middle, 17, 0, Math.PI * 2);
      ctx.fillStyle = item.swatch; ctx.fill(); ctx.strokeStyle = UI.switchLine; ctx.lineWidth = 2; ctx.stroke();
      left += 48;
    }
    if (item.toggle !== undefined) {
      // As the page's .panel-switch: yellow when on.
      const w = 58, h = 32, sx = right - w, sy = middle - h / 2;
      box(ctx, sx, sy, w, h, h / 2, item.toggle ? UI.accent : UI.recessed, item.toggle ? null : UI.switchLine);
      ctx.beginPath(); ctx.arc(item.toggle ? sx + w - h / 2 : sx + h / 2, middle, h / 2 - 5, 0, Math.PI * 2);
      ctx.fillStyle = item.toggle ? UI.onAccent : UI.muted; ctx.fill();
      right = sx - 16;
    } else if (item.current || item.value) {
      // (a colour is ticked, as the page's swatches are ringed)
      const tick = item.current && item.swatch;
      ctx.font = font(tick ? 32 : item.current ? 22 : 26, item.current ? 750 : 400); ctx.textAlign = 'right';
      ctx.fillStyle = item.current ? item.primary ? UI.onAccent : UI.accent : item.primary ? UI.onAccent : UI.muted;
      const value = tick ? '✓' : item.current ? 'CURRENT' : fit(ctx, item.value, width * .45);
      ctx.fillText(value, right, middle + 1);
      right -= ctx.measureText(value).width + 16;
    }
    const centred = item.primary || item.footer || item.header || this.narrow;
    ctx.font = font(31, item.primary ? 750 : 600); ctx.fillStyle = item.primary ? UI.onAccent : UI.text;
    ctx.textAlign = centred && item.toggle === undefined && !item.value && !item.current ? 'center' : 'left';
    const label = fit(ctx, item.label, right - left);
    ctx.fillText(label, ctx.textAlign === 'center' ? x + width / 2 : left, middle + 1);
    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  }
  // The driving HUD: `{ taxi, clock, urgent, cash, fares, stage, title,
  // distance, detail, timer: { text, tone, fraction }, heading, place,
  // weather, hint }`,
  // plus the latest toast, which takes the task's last line as it does on
  // the page. Null hides it.
  hud(model) {
    const now = performance.now();
    if (this.flash && this.flash.until < now) this.flash = null;
    this.hudModel = model;
    if (!model) { if (this.hudPanel) this.hudPanel.mesh.visible = false; this.hudSignature = ''; return; }
    this.build();
    const flash = this.flash;
    const signature = JSON.stringify([model, flash?.text, flash?.tone]);
    if (signature === this.hudSignature) return;
    this.hudSignature = signature;
    const panel = this.hudPanel, ctx = panel.ctx, W = HUD.pixels, H = 150;
    panel.clear();
    ctx.textBaseline = 'alphabetic';
    const glass = (x, w, fill = UI.glass) => box(ctx, x, 0, w, H, 22, fill, UI.line);
    const line = (text, x, y, size, weight, color, width, align = 'left') => {
      ctx.font = font(size, weight); ctx.fillStyle = color; ctx.textAlign = align;
      ctx.fillText(fit(ctx, text, width), x, y);
    };
    const toast = flash && { text: flash.text, color: TONES[flash.tone] ?? UI.text };
    if (model.taxi) {
      glass(0, 160, model.urgent ? UI.urgent : UI.glass);
      ctx.letterSpacing = '2px'; line('SHIFT', 80, 42, 20, 750, model.urgent ? UI.onUrgent : UI.muted, 140, 'center'); ctx.letterSpacing = '0px';
      line(model.clock, 80, 114, 64, 750, model.urgent ? UI.onUrgent : UI.text, 140, 'center');
      const x = 174, w = W - 174 * 2;
      glass(x, w);
      let right = x + w - 24;
      // The fare's clock and the distance left keep their places through a toast.
      const pill = (text, color) => {
        ctx.font = font(24, 750); const tw = ctx.measureText(text).width + 28;
        box(ctx, right - tw, 16, tw, 36, 18, UI.recessed, null);
        line(text, right - tw / 2, 43, 24, 750, color, tw, 'center');
        right -= tw + 10;
      };
      if (model.timer) pill(model.timer.text, TONES[model.timer.tone] ?? UI.text);
      if (model.distance) pill(model.distance, UI.text);
      if (model.timer) {
        box(ctx, x + 2, H - 10, w - 4, 8, 4, UI.recessed, null);
        box(ctx, x + 2, H - 10, Math.max(8, (w - 4) * model.timer.fraction), 8, 4, TONES[model.timer.tone] ?? UI.accent, null);
      }
      ctx.letterSpacing = '1px'; line(model.stage.toUpperCase(), x + 24, 43, 23, 750, UI.accent, right - x - 24); ctx.letterSpacing = '0px';
      line(model.title, x + 24, 88, 38, 750, UI.text, w - 48);
      line(toast?.text ?? model.detail, x + 24, 128, 26, toast ? 700 : 400, toast?.color ?? UI.muted, w - 48);
      glass(W - 160, 160);
      line(model.cash, W - 80, 78, 42, 750, UI.text, 140, 'center');
      line(model.fares, W - 80, 116, 22, 400, UI.muted, 140, 'center');
    } else {
      const w = 600, x = (W - w) / 2 + 60;
      glass(x - 120, 108);
      line(model.heading, x - 66, 95, 52, 750, UI.gold, 90, 'center');
      glass(x, w);
      line(model.place, x + 26, 66, 36, 750, UI.text, w - 52);
      line(toast?.text ?? model.weather, x + 26, 112, 26, toast ? 700 : 400, toast?.color ?? UI.muted, w - 52);
    }
    let height = H;
    if (model.hint) {
      ctx.font = font(23); const hw = Math.min(W - 40, ctx.measureText(model.hint).width + 44);
      box(ctx, (W - hw) / 2, H + 14, hw, 44, 22, UI.glass, UI.line);
      line(model.hint, W / 2, H + 44, 23, 400, UI.text, hw - 36, 'center');
      height = H + 60;
    }
    panel.crop(W, height + 2);
  }
  // Put the menu in front of the head: level, a little low, and turned to
  // wherever the player is looking. It then stays put until it closes.
  placeMenu() {
    this.anchor.updateWorldMatrix(true, false);
    this.camera.getWorldPosition(this.head); this.anchor.worldToLocal(this.head);
    this.camera.getWorldDirection(this.facing).transformDirection(this.transform.copy(this.anchor.matrixWorld).invert());
    this.menuFrame.position.copy(this.head);
    this.menuFrame.rotation.set(0, Math.atan2(-this.facing.x, -this.facing.z), 0);
    this.placed = true;
  }
  point(frame, referenceSpace, rig, enabled) {
    if (!this.menu?.mesh.visible || !frame) return;
    if (!this.placed) this.placeMenu();
    const mesh = this.menu.mesh;
    mesh.updateWorldMatrix(true, false);
    let activate, moved;
    const sources = [...frame.session.inputSources];
    for (const map of [this.triggers, this.hovers]) for (const source of map.keys()) if (!sources.includes(source)) map.delete(source);
    for (const { ray, cursor } of this.rays) ray.visible = cursor.visible = false;
    let hand = 0;
    for (const source of sources) {
      const trigger = source.gamepad?.buttons[0];
      const held = (trigger?.value ?? Number(trigger?.pressed ?? false)) > .5 || this.selecting.has(source);
      const previous = this.triggers.get(source);
      this.triggers.set(source, held);
      if (!enabled || !source.targetRaySpace || hand >= this.rays.length) continue;
      const pose = frame.getPose(source.targetRaySpace, referenceSpace);
      if (!pose) continue;
      this.transform.fromArray(pose.transform.matrix).premultiply(rig.matrixWorld);
      this.raycaster.ray.origin.setFromMatrixPosition(this.transform);
      this.raycaster.ray.direction.set(0, 0, -1).transformDirection(this.transform);
      const hit = this.raycaster.intersectObject(mesh, false)[0];
      const { ray, cursor } = this.rays[hand++];
      if (ray.parent !== rig) rig.add(ray);
      ray.matrix.fromArray(pose.transform.matrix).multiply(this.stretch.makeScale(1, 1, Math.min(BEAM, hit?.distance ?? BEAM)));
      ray.matrixWorldNeedsUpdate = true; ray.visible = true;
      let index;
      if (hit) {
        cursor.position.copy(hit.point); this.menuFrame.worldToLocal(cursor.position);
        cursor.quaternion.copy(mesh.quaternion); cursor.visible = true;
        const x = hit.uv.x * this.menu.width, y = (1 - hit.uv.y) * this.menu.height;
        const region = this.regions.find(region => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height);
        if (region && !this.entries[region.index].disabled) index = region.index;
      }
      // Each hand's pointer selects a row it moves onto, as a mouse hovers.
      // One resting on the panel as it opens (or in a lap) moves nothing.
      if (!this.settle && index !== undefined && index !== this.hovers.get(source)) moved = index;
      this.hovers.set(source, index);
      // A trigger already held when the menu appeared (the gas pedal) must be
      // released before it can press anything.
      if (index !== undefined && held && previous === false && !activate) activate = () => { this.selected = index; this.activate(); };
    }
    this.settle = false;
    if (moved !== undefined && moved !== this.selected) { this.selected = moved; this.update(this.model); }
    activate?.();
  }
}
