export class BrowserVR {
  constructor({ renderer, buttons, onStart, onEnd, onVisibility, onError, onSupport = () => {}, canEnter = () => true, navigator = globalThis.navigator, secure = globalThis.isSecureContext }) {
    Object.assign(this, { renderer, buttons, onStart, onEnd, onVisibility, onError, onSupport, canEnter, navigator, secure });
    this.session = null;
    this.pending = false;
    this.supported = false;
    this.visibilityChanged = () => onVisibility(this.session?.visibilityState === 'visible');
    this.ended = () => {
      this.session?.removeEventListener('visibilitychange', this.visibilityChanged);
      this.session?.removeEventListener('end', this.ended);
      this.session = null;
      this.refresh();
      onEnd();
    };
    for (const button of buttons) button.addEventListener('click', () => void this.toggle());
  }
  get active() { return this.session !== null; }
  get visible() { return this.active && this.session.visibilityState === 'visible'; }
  refresh() {
    for (const button of this.buttons) {
      button.hidden = !this.supported;
      button.disabled = this.pending;
      // Buttons that carry an icon keep it: only their label span is rewritten.
      (button.querySelector?.('.vr-entry-label') ?? button).textContent = this.active ? 'Exit VR' : 'Enter VR';
      button.setAttribute('aria-label', this.active ? 'Exit virtual reality' : 'Enter virtual reality');
    }
  }
  async detect() {
    // The desktop wrapper is deliberately outside the scope of browser VR.
    if (!this.secure || /Electron\//i.test(this.navigator.userAgent) || !this.navigator.xr) return;
    // A headset can be plugged in or removed long after the page loads, so the
    // entry stays in step with what the browser reports.
    this.navigator.xr.addEventListener?.('devicechange', () => void this.check());
    await this.check();
  }
  async check() {
    try { this.supported = await this.navigator.xr.isSessionSupported('immersive-vr'); }
    catch { this.supported = false; }
    this.refresh(); this.onSupport(this.supported);
  }
  async toggle() {
    if (this.pending || !this.supported || (!this.active && !this.canEnter())) return;
    this.pending = true; this.refresh();
    try {
      if (this.session) { await this.session.end(); return; }
      // Call directly from the button's user gesture. A local reference space
      // works seated or standing and does not depend on floor tracking. Hands
      // can point at the menus when the controllers are put down.
      const session = await this.navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local'], optionalFeatures: ['layers', 'hand-tracking'] });
      this.session = session;
      session.addEventListener('end', this.ended);
      session.addEventListener('visibilitychange', this.visibilityChanged);
      this.renderer.xr.enabled = true;
      this.renderer.xr.setReferenceSpaceType('local');
      // Supersample both eyes and preserve peripheral detail. The framebuffer
      // scale must be set before the session allocates its render targets.
      this.renderer.xr.setFramebufferScaleFactor(1.5);
      this.renderer.xr.setFoveation(0);
      await this.renderer.xr.setSession(session);
      if (this.session === session) this.onStart();
    } catch (error) {
      if (this.session) {
        try { await this.session.end(); } catch { this.ended(); }
      }
      this.onError(error);
    } finally { this.pending = false; this.refresh(); }
  }
}
