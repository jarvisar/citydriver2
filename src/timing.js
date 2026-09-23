// Rendering follows requestAnimationFrame; only the driving simulation is fixed-rate.
// 120 Hz halves both the wait for a simulation tick and interpolation delay
// (8.3 ms instead of 16.7 ms), while retaining smooth, reproducible movement.
export const PHYSICS_STEP = 1 / 120;

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
