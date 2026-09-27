// In fullscreen the mouse looks round the chase camera, as GTA's does. While
// the drive runs in the third-person view the pointer is locked to the scene
// (and let go for any menu), and moving it turns the camera round the car.
// The wheel brings the camera nearer or farther, in a window too.
// Radians of turn for each pixel the mouse travels
const TURN = .0025;
// Each pixel of scroll takes the camera e^ZOOM times as far out: a notch (100 px) about 13%
const ZOOM = .0012;

export class MouseLook {
  // `lockable()` says whether the mouse may look round now, `zoomable()`
  // whether the wheel may zoom; `look(yaw, pitch)` and `zoom(factor)` move
  // the camera (see ThirdPersonCamera). `released()` hears the player take
  // the pointer back while it may still look round: Escape frees a locked
  // pointer before the page hears the key.
  constructor(element, { lockable, zoomable, look, zoom, released = () => {} }) {
    this.element = element; this.lockable = lockable;
    document.addEventListener('pointerlockchange', () => { if (!this.locked && lockable()) released(); });
    // Only with a mouse to look with
    this.mouse = globalThis.matchMedia?.('(any-pointer: fine)') ?? { matches: true };
    // The lock is asked for once, then again after the next click or key: a
    // browser may want one of those before it grants it
    this.asked = false;
    document.addEventListener('mousedown', () => { this.asked = false; }, true);
    document.addEventListener('keydown', event => { if (!event.repeat) this.asked = false; }, true);
    // (a locked pointer's moves all go to the scene)
    element.addEventListener('mousemove', event => {
      if (this.locked && lockable()) look(event.movementX * TURN, event.movementY * TURN);
    });
    element.addEventListener('wheel', event => {
      // (Ctrl and the wheel, or a pinch, zoom the page)
      if (event.ctrlKey || !zoomable()) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? globalThis.innerHeight : 1);
      zoom(Math.exp(pixels * ZOOM));
    }, { passive: false });
  }
  get locked() { return document.pointerLockElement === this.element; }
  // Each frame: holds the pointer while the mouse may look round, and lets it go otherwise
  update() {
    if (!this.lockable() || !this.mouse.matches) {
      this.asked = false;
      if (this.locked) document.exitPointerLock();
    } else if (!this.locked && !this.asked && this.element.requestPointerLock) {
      this.asked = true;
      // (a promise in newer browsers; older ones fire pointerlockerror)
      try { Promise.resolve(this.element.requestPointerLock()).catch(() => {}); } catch { /* Asked again at the next click or key. */ }
    }
  }
}
