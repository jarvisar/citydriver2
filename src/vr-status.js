import * as THREE from 'three';

const PAGE_SIZE = 6;

// Immersive sessions cannot show DOM menus. The game supplies the same actions
// to this small canvas menu, operated by stick/A or pointing with a trigger.
export class VRStatus {
  constructor(camera) {
    this.camera = camera; this.model = null; this.selected = 0;
    this.signature = ''; this.regions = []; this.triggers = new Map();
    this.raycaster = new THREE.Raycaster(); this.transform = new THREE.Matrix4();
  }
  update(model) {
    if (model?.id !== this.model?.id) this.selected = 0;
    this.model = model;
    if (!model) {
      if (this.mesh) this.mesh.visible = false;
      if (this.pointer) this.pointer.visible = false;
      this.signature = ''; this.triggers.clear(); return;
    }
    this.selected = Math.min(this.selected, Math.max(0, model.items.length - 1));
    const signature = JSON.stringify([model.id, model.title, model.items.map(item => item.label), this.selected]);
    if (signature === this.signature) return;
    this.signature = signature;
    if (!this.mesh) {
      this.canvas = document.createElement('canvas');
      // Keep the GPU texture dimensions fixed across button/menu transitions.
      this.canvas.width = 1024; this.canvas.height = 1024;
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.texture, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
      this.mesh.renderOrder = 1000; this.mesh.frustumCulled = false;
      this.camera.add(this.mesh);
      this.pointer = new THREE.Mesh(new THREE.CircleGeometry(.009, 16), new THREE.MeshBasicMaterial({ color: '#ffe6a5', depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
      this.pointer.renderOrder = 1001; this.pointer.visible = false;
      this.camera.add(this.pointer);
    }
    const driving = model.id === 'driving';
    this.contentHeight = driving ? 256 : 1024;
    this.mesh.scale.set(driving ? .48 : 1.65, driving ? .12 : 1.65, 1);
    this.mesh.position.set(driving ? .75 : 0, driving ? -.55 : 0, -2.4);
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, driving ? 4 : 1, 0, 0);
    ctx.fillStyle = '#183b34'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.regions = [];
    const row = (label, x, y, width, height, activate, selected = false) => {
      ctx.fillStyle = selected ? '#e78858' : '#31574e'; ctx.fillRect(x, y, width, height);
      ctx.fillStyle = selected ? '#183b34' : '#f6f5ea';
      ctx.font = `${driving ? 96 : 38}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(label, x + width / 2, y + height / 2 + (driving ? 32 : 13), width - 36);
      this.regions.push({ x, y, width, height, activate });
    };
    if (driving) {
      row('Ⅱ  Pause', 16, 16, 992, 224, () => this.activate());
    } else {
      ctx.fillStyle = '#f6f5ea'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(model.title, 512, 78, 920);
      const page = Math.floor(this.selected / PAGE_SIZE), start = page * PAGE_SIZE;
      model.items.slice(start, start + PAGE_SIZE).forEach((item, i) => {
        const index = start + i;
        row(item.label, 48, 120 + i * 112, 928, 94, () => { this.selected = index; this.activate(); }, this.selected === index);
      });
      if (model.items.length > PAGE_SIZE) {
        row('‹ Previous', 48, 812, 330, 80, () => this.page(-1));
        row('Next ›', 646, 812, 330, 80, () => this.page(1));
        ctx.fillStyle = '#f6f5ea'; ctx.font = '30px sans-serif';
        ctx.fillText(`${page + 1} / ${Math.ceil(model.items.length / PAGE_SIZE)}`, 512, 863);
      }
      ctx.fillStyle = '#f6f5ea'; ctx.font = '28px sans-serif';
      ctx.fillText(model.id === 'loading' ? 'Your drive will be ready shortly' : 'Stick ↑↓: choose · A: select · B: back / resume', 512, 950);
      ctx.fillText('Point + trigger to select · Left stick click: pause', 512, 994);
    }
    this.texture.needsUpdate = true; this.mesh.visible = true;
  }
  move(amount) {
    const count = this.model?.items.length ?? 0;
    if (!count) return;
    this.selected = (this.selected + amount % count + count) % count;
    this.update(this.model);
  }
  activate() { this.model?.items[this.selected]?.activate(); }
  page(direction) {
    const pages = Math.ceil((this.model?.items.length ?? 0) / PAGE_SIZE);
    if (!pages) return;
    this.selected = ((Math.floor(this.selected / PAGE_SIZE) + direction + pages) % pages) * PAGE_SIZE;
    this.update(this.model);
  }
  point(frame, referenceSpace, rig, enabled) {
    if (!this.mesh?.visible || !frame) return;
    this.pointer.visible = false;
    this.mesh.updateWorldMatrix(true, false);
    let activate;
    const sources = new Set(frame.session.inputSources);
    for (const source of this.triggers.keys()) if (!sources.has(source)) this.triggers.delete(source);
    for (const source of sources) {
      const trigger = source.gamepad?.buttons[0];
      const held = (trigger?.value ?? Number(trigger?.pressed ?? false)) > .5;
      const previous = this.triggers.get(source);
      this.triggers.set(source, held);
      if (!enabled || !source.targetRaySpace || source.hand) continue;
      const pose = frame.getPose(source.targetRaySpace, referenceSpace);
      if (!pose) continue;
      this.transform.fromArray(pose.transform.matrix).premultiply(rig.matrixWorld);
      this.raycaster.ray.origin.setFromMatrixPosition(this.transform);
      this.raycaster.ray.direction.set(0, 0, -1).transformDirection(this.transform);
      const hit = this.raycaster.intersectObject(this.mesh, false)[0];
      if (!hit) continue;
      const x = hit.uv.x * this.canvas.width, y = (1 - hit.uv.y) * this.contentHeight;
      const region = this.regions.find(region => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height);
      if (region) {
        this.pointer.position.copy(hit.point); this.camera.worldToLocal(this.pointer.position);
        this.pointer.position.z += .002; this.pointer.visible = true;
      }
      // A held driving trigger must be released before it can click a menu.
      if (region && held && previous === false && !activate) activate = region.activate;
    }
    activate?.();
  }
}
