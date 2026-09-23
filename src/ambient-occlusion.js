// Soft shading is opt-in. Keep its code, shaders and render targets out of the
// normal startup path, and release its GPU resources when it is switched off.
export class AmbientOcclusion {
  constructor(renderer, scene, camera, { onReady = () => {}, load = () => import('./ambient-occlusion-pass.js') } = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.onReady = onReady; this.load = load; this.quality = 'high';
    this._enabled = false; this.effect = null; this.ready = null; this.disposed = false; this.failed = false;
  }
  get enabled() { return this._enabled; }
  set enabled(value) {
    if (value === this._enabled) return;
    this._enabled = value; this.failed = false;
    if (!value) { this.effect?.dispose(); this.effect = null; }
  }
  setQuality(quality) { this.quality = quality; this.effect?.setQuality(quality); }
  prepare() {
    if (this.ready || this.failed || this.disposed) return;
    this.ready = this.load().then(({ AmbientOcclusion: Effect }) => {
      if (this.disposed || !this.enabled) return;
      this.effect = new Effect(this.renderer, this.scene, this.camera);
      this.effect.setQuality(this.quality);
      this.onReady();
    }).catch(error => {
      this.failed = true;
      console.warn('Soft shading could not load; continuing with standard lighting.', error);
    }).finally(() => { this.ready = null; });
  }
  render(camera) {
    if (this.disposed) return;
    this.camera = camera;
    if (this.enabled && this.effect) this.effect.render(camera);
    else {
      this.renderer.render(this.scene, camera);
      if (this.enabled) this.prepare();
    }
  }
  dispose() { this.disposed = true; this.effect?.dispose(); this.effect = null; }
}
