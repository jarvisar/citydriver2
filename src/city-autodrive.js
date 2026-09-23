import { navGraph } from './world/nav-graph.js';
import { onRoadAt } from './world/city-route.js';

// Cruise along whichever street the driver is on, in the direction they are
// facing, turning at random junctions. Lane following is local to the nav
// graph edge, so enabling cruise never aims across a block.
export class CityAutodrive {
  constructor({ random = Math.random } = {}) { this.random = random; this.enabled = false; this.reset(); }
  reset() { this.path = null; this.next = null; }
  toggle() { this.enabled = !this.enabled; this.reset(); return this.enabled; }
  canStart(player) { return Boolean(onRoadAt(player.s, player.u)); }
  update(player, traffic, speedLimit = player.stats.topSpeed, dt = 1 / 60) {
    const nav = navGraph();
    if (!this.path) {
      const hit = nav.nearest(player.s, player.u, 30);
      if (!hit) return { handbrake: true };
      const forward = nav.pose(hit.edge, hit.along, 1);
      const direction = Math.cos(player.heading - forward.heading) >= 0 ? 1 : -1;
      this.path = { edge: hit.edge, direction, along: direction > 0 ? hit.along : hit.edge.length - hit.along };
      this.next = null;
    }
    const path = this.path;
    // Where the car really is along the edge, so a slide does not lose it
    const hit = nav.nearest(player.s, player.u, 40);
    if (hit && hit.edge === path.edge) path.along = path.direction > 0 ? hit.along : hit.edge.length - hit.along;
    else if (hit && this.next && hit.edge === this.next.edge) {
      path.edge = this.next.edge; path.direction = this.next.direction; this.next = null;
      path.along = path.direction > 0 ? hit.along : hit.edge.length - hit.along;
    }
    const remaining = path.edge.length - path.along;
    if (remaining < 45 && !this.next) {
      const choices = nav.choices(path.edge, path.direction).filter(choice => choice.edge.kind !== 'path' || path.edge.kind === 'path');
      const options = choices.length ? choices : nav.choices(path.edge, path.direction);
      if (options.length) {
        const roll = this.random(), straight = options[0];
        this.next = Math.abs(straight.turn) < .5 && roll < .6 ? straight : options[Math.floor(roll * options.length)];
      }
    }
    const lookahead = Math.max(7, Math.abs(player.speed ?? 0) * .7);
    let aim;
    if (path.along + lookahead <= path.edge.length || !this.next) aim = nav.pose(path.edge, Math.min(path.edge.length, path.along + lookahead), path.direction, path.edge.profile.lane);
    else aim = nav.pose(this.next.edge, path.along + lookahead - path.edge.length, this.next.direction, this.next.edge.profile.lane);
    let turnSpeed = Infinity;
    if (this.next && Math.abs(this.next.turn) > .4) turnSpeed = Math.sqrt(36 + 14 * Math.max(0, remaining - 4));
    const ds = aim.s - player.s, du = aim.u - player.u, length = Math.hypot(ds, du);
    const along = ds / Math.max(.001, length), across = du / Math.max(.001, length);
    const cruiseSpeed = player.carId === 'formula' ? player.stats.topSpeed : path.edge.profile.speed * 1.15;
    let speed = Math.min(cruiseSpeed, speedLimit, player.stats.topSpeed, turnSpeed);
    for (const car of traffic.enabled ? traffic.vehicles : []) {
      const dx = car.u - player.u, dz = car.s - player.s, heading = Math.atan2(across, along);
      const ahead = dz * Math.cos(heading) + dx * Math.sin(heading);
      const beside = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
      if (ahead > 0 && beside < 3) speed = Math.min(speed, Math.sqrt(2 * 7 * Math.max(0, ahead - 10)));
    }
    return { touchDrive: { amount: speed / player.stats.topSpeed, along, across, heading: Math.atan2(across, along) } };
  }
}
