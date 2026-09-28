// Rendering follows requestAnimationFrame; only the driving simulation is fixed-rate.
// 120 Hz halves both the wait for a simulation tick and interpolation delay
// (8.3 ms instead of 16.7 ms), while retaining smooth, reproducible movement.
export const PHYSICS_STEP = 1 / 120;

// Draws at most `cap` frames a second (see Graphics.frameCap). A frame is drawn
// once a frame's worth of time is owed, less half a display interval, so a cap
// that divides the display's rate is held evenly (60 on 120 Hz is every other
// frame) and any other cap averages out without going over. The display's
// rate is the shortest gap between callbacks over the last second.
export class FramePacer {
  constructor() { this.last = null; this.owed = 0; this.shortest = Infinity; this.window = Infinity; this.windowStart = 0; }
  // The display's refresh rate, once a second of it has been measured
  get displayRate() { return Number.isFinite(this.shortest) ? 1000 / this.shortest : null; }
  // True if this callback should draw nothing
  skip(timestamp, cap) {
    const gap = this.last === null ? 0 : Math.max(0, timestamp - this.last);
    if (gap > 0) this.window = Math.min(this.window, gap);
    this.last = timestamp;
    if (timestamp - this.windowStart >= 1000) { this.shortest = this.window; this.window = Infinity; this.windowStart = timestamp; }
    const interval = cap ? 1000 / cap : 0;
    if (!interval || !Number.isFinite(this.shortest) || interval <= this.shortest * 1.05) { this.owed = 0; return false; }
    this.owed += gap;
    if (this.owed < interval - this.shortest / 2 - .25) return true;
    // (never ahead: a late frame doesn't buy an early one after it)
    this.owed = Math.min(0, this.owed - interval);
    return false;
  }
}

export class FrameClock {
  constructor() { this.reset(); }
  reset() { this.lastTime = null; this.accumulator = 0; this.dt = 0; this.alpha = 0; }
  suspend() { this.lastTime = null; }
  tick(timestamp, running, step) {
    this.dt = this.lastTime === null ? 0 : Math.max(0, Math.min((timestamp - this.lastTime) / 1000, .1));
    this.lastTime = timestamp;
    if (running) {
      this.accumulator += this.dt;
      while (this.accumulator + 1e-12 >= PHYSICS_STEP) {
        step(PHYSICS_STEP);
        this.accumulator = Math.max(0, this.accumulator - PHYSICS_STEP);
      }
      this.alpha = this.accumulator / PHYSICS_STEP;
    }
  }
}
