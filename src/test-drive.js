import { TEST_DRIVE_SECONDS } from './cars.js';

// Said this long before a test drive ends
export const TEST_DRIVE_WARN = 15;
// Once time is up the car stops, or something flying lands itself, and then
// the player's own car takes its place. A plane gliding down from high up
// takes a while, so after this long it is swapped wherever it is.
export const TEST_DRIVE_ENDING = 25;

// A car the fleet doesn't own, out of the garage for a couple of minutes (see
// TaxiFleet.testDrive). The clock runs whether they are in it or not, and
// stops only with the game. main.js does the swapping: this only says when.
export class TestDrive {
  constructor() { this.id = null; this.left = 0; this.total = 0; this.over = false; this.ending = 0; this.warned = false; }
  get active() { return this.id !== null; }
  get fraction() { return this.total ? this.left / this.total : 0; }
  start(id, seconds = TEST_DRIVE_SECONDS) {
    Object.assign(this, { id, left: seconds, total: seconds, over: false, ending: 0, warned: false });
  }
  stop() { this.id = null; this.over = false; }
  // A step. `inCar`: the player is driving it. `still`: it has stopped (and
  // landed). Returns 'warn' as it nears the end, 'over' as time runs out,
  // 'done' once the car can be swapped, 'gone' if they weren't in it then
  // (it goes back to the garage from wherever it was left), or null.
  update(dt, { inCar, still }) {
    if (!this.active || !(dt > 0)) return null;
    if (!this.over) {
      this.left = Math.max(0, this.left - dt);
      if (this.left > 0) {
        if (this.warned || this.left > TEST_DRIVE_WARN) return null;
        this.warned = true; return 'warn';
      }
      this.over = true;
      if (!inCar) { this.stop(); return 'gone'; }
      return 'over';
    }
    if (!inCar) { this.stop(); return 'gone'; }
    this.ending += dt;
    if (!still && this.ending < TEST_DRIVE_ENDING) return null;
    this.stop(); return 'done';
  }
  // How long is left, as the HUD shows it
  get clock() {
    const seconds = Math.ceil(this.left);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
