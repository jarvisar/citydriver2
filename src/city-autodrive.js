import { navGraph } from './world/nav-graph.js';
import { onRoadAt } from './world/city-route.js';

import { turnPath, approachSpeed, wayOn } from './world/lane-paths.js';
export { cityGreen } from './city-junctions.js';

// Cruise along whichever street the driver is on, in the direction they are
// facing, turning at random junctions. Lane following is local to the nav
// graph edge and the turn curve onto the next one (the same curves the
// traffic drives), so enabling cruise never aims across a block.
export class CityAutodrive {
  constructor({ random = Math.random } = {}) { this.random = random; this.enabled = false; this.reset(); }
  // The autodrive drives like the traffic: it claims its way through each
  // junction with theirs (see city-junctions.js), as this driver
  reset() { this.path = null; this.next = null; this.driver = { claim: null, leaving: null, stopWait: 0 }; }
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
      path.edge = this.next.edge; path.direction = this.next.direction; this.next = null; this.driver.stopWait = 0;
      path.along = path.direction > 0 ? hit.along : hit.edge.length - hit.along;
    }
    const remaining = path.edge.length - path.along;
    if (remaining < 70 && !this.next) {
      const roll = this.random();
      const pick = options => Math.abs(options[0].turn) < .5 && roll < .6 ? options[0] : options[Math.floor(roll * options.length)];
      this.next = wayOn(nav, path.edge, path.direction, pick, next => next.edge.kind !== 'path' || path.edge.kind === 'path');
    }
    const lookahead = Math.max(7, Math.abs(player.speed ?? 0) * .7), ahead = path.along + lookahead;
    let aim, turnSpeed = Infinity;
    const turn = this.next ? turnPath(nav, path.edge, path.direction, this.next) : null;
    if (!turn) aim = nav.pose(path.edge, Math.min(path.edge.length, ahead), path.direction, path.edge.profile.lane);
    else {
      if (ahead <= turn.start) aim = nav.pose(path.edge, ahead, path.direction, path.edge.profile.lane);
      else if (ahead <= turn.start + turn.length) aim = turn.pose(ahead - turn.start);
      else aim = nav.pose(this.next.edge, turn.end + ahead - turn.start - turn.length, this.next.direction, this.next.edge.profile.lane);
      // A player's car corners a little harder than the traffic
      turnSpeed = approachSpeed(turn, turn.start - path.along, 4.5) * 1.15;
    }
    const ds = aim.s - player.s, du = aim.u - player.u, length = Math.hypot(ds, du);
    const along = ds / Math.max(.001, length), across = du / Math.max(.001, length);
    const cruiseSpeed = player.carId === 'formula' ? player.stats.topSpeed : path.edge.profile.speed * 1.15;
    let speed = Math.min(cruiseSpeed, speedLimit, player.stats.topSpeed, turnSpeed);
    if (traffic.enabled && traffic.junctions) {
      Object.assign(this.driver, { edge: path.edge, direction: path.direction, along: path.along, speed: Math.abs(player.speed ?? 0), next: this.next, turn, s: player.s, u: player.u, spec: player.spec });
      speed = Math.min(speed, traffic.junctions.limit(this.driver, traffic.vehicles, null, dt));
    }
    for (const car of traffic.enabled ? traffic.vehicles : []) {
      const dx = car.u - player.u, dz = car.s - player.s, heading = Math.atan2(across, along);
      const ahead = dz * Math.cos(heading) + dx * Math.sin(heading);
      const beside = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
      if (ahead > 0 && beside < 3) speed = Math.min(speed, Math.sqrt(2 * 7 * Math.max(0, ahead - 10)));
    }
    return { touchDrive: { amount: speed / player.stats.topSpeed, along, across, heading: Math.atan2(across, along) } };
  }
}
