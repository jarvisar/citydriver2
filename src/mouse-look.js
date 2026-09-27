// The mouse looks round the chase camera, as GTA's does, and through the
// player's eyes. While the drive runs in the third-person or the
// first-person view, a click on the scene locks the pointer to it (in
// fullscreen it is locked without one), and moving it turns the camera round
// the car, or the view. Once taken it is held, over menus and pauses, until
// the player takes it back (Escape). The wheel brings the camera nearer or
// farther, whether the pointer is locked or not.
// Radians of turn for each pixel the mouse travels
const TURN = .0025;
// Each pixel of scroll takes the camera e^ZOOM times as far out: a notch (100 px) about 13%
const ZOOM = .0012;

export class MouseLook {
  // `lookable()` says whether the mouse may look round now, `automatic()`
  // whether it takes the pointer without a click (fullscreen), `zoomable()`
  // whether the wheel may zoom; `look(yaw, pitch)` and `zoom(factor)` move
  // the camera (see ThirdPersonCamera). `released()` hears the player take
  // the pointer back while it may still look round (Escape frees a locked
  // pointer before the page hears the key); returning false says the
  // browser let it go on its own, and it is taken again. `captured()` hears
  // it taken.
  constructor(element, { lookable, automatic = () => false, zoomable, look, zoom, released = () => {}, captured = () => {} }) {
    this.element = element; this.lookable = lookable; this.automatic = automatic;
    // Only with a mouse to look with
    this.mouse = globalThis.matchMedia?.('(any-pointer: fine)') ?? { matches: true };
    // Taken, and wanted until the player takes it back; and let go by the
    // game itself (a menu, an overhead view), which is no taking back
    this.wanted = false; this.letGo = false;
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) { this.wanted = true; captured(); return; }
      const ours = this.letGo; this.letGo = false;
      if (ours || !lookable()) return;
      if (released() !== false) this.wanted = false;
      else this.asked = false;
    });
    // The lock is asked for once, then again after the next click or key: a
    // browser may want one of those before it grants it
    this.asked = false;
    document.addEventListener('mousedown', () => { this.asked = false; }, true);
    document.addEventListener('keydown', event => { if (!event.repeat) this.asked = false; }, true);
    // A click on the scene takes it at once, inside the click, as every browser allows
    element.addEventListener('mousedown', event => {
      if (event.button !== 0 || this.locked || !this.mouse.matches || !lookable()) return;
      this.wanted = true; this.request();
    });
    // (a locked pointer's moves all go to the scene)
    element.addEventListener('mousemove', event => {
      if (this.locked && lookable()) look(event.movementX * TURN, event.movementY * TURN);
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
  // Whether the pointer should be held now
  get holding() { return this.mouse.matches && this.lookable() && (this.wanted || this.automatic()); }
  request() {
    this.asked = true;
    if (!this.element.requestPointerLock) return;
    // (a promise in newer browsers; older ones fire pointerlockerror)
    try { Promise.resolve(this.element.requestPointerLock()).catch(() => {}); } catch { /* Asked again at the next click or key. */ }
  }
  // Each frame: holds the pointer while the mouse may look round, and lets it go otherwise
  update() {
    if (!this.holding) {
      this.asked = false;
      if (this.locked) { this.letGo = true; document.exitPointerLock(); }
    } else if (!this.locked && !this.asked) this.request();
  }
}
