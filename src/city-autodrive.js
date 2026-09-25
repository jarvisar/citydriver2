import { navGraph } from './world/nav-graph.js';
import { onRoadAt } from './world/city-route.js';

import { turnPath, approachSpeed, wayOn } from './world/lane-paths.js';
export { cityGreen } from './city-junctions.js';

// Where a point is along an edge in the direction of travel, and how far it
// is from the edge: its projection onto that edge alone, carried on past
// either end along the end segments
function travelAlong(edge, direction, u, s) {
  const points = edge.points;
  let off = Infinity, along = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    if (length2 < 1e-9) continue;
    let t = ((u - a.x) * dx + (s - a.y) * dy) / length2;
    t = Math.max(i === 0 ? -Infinity : 0, Math.min(i === points.length - 2 ? Infinity : 1, t));
    const d = Math.hypot(a.x + dx * t - u, a.y + dy * t - s);
    if (d < off) { off = d; along = edge.cumulative[i] + t * Math.sqrt(length2); }
  }
  return { along: direction > 0 ? along : edge.length - along, off };
}
// How far through a turn a point is, by its projection onto the turn's
// curve (sampled once a metre), carried on past its end
const turnSamples = new WeakMap();
function turnProgress(turn, u, s) {
  if (!turnSamples.has(turn)) {
    const count = Math.max(2, Math.ceil(turn.length)), points = [];
    for (let i = 0; i <= count; i++) { const p = turn.pose(turn.length * i / count); points.push({ x: p.u, y: p.s, d: turn.length * i / count }); }
    turnSamples.set(turn, points);
  }
  const points = turnSamples.get(turn);
  let best = Infinity, progress = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    if (length2 < 1e-9) continue;
    const t = Math.max(0, Math.min(i === points.length - 2 ? Infinity : 1, ((u - a.x) * dx + (s - a.y) * dy) / length2));
    const d = Math.hypot(a.x + dx * t - u, a.y + dy * t - s);
    if (d < best) { best = d; progress = a.d + t * (b.d - a.d); }
  }
  return progress;
}
// The street a car is on and the way it is going along it: of the streets
// within reach, the one whose lane it is nearest and most nearly facing along
function acquire(nav, player) {
  let best = null;
  nav.index.each(player.u, player.s, 30, (segment, distance, t) => {
    const edge = segment.road.edge, along = edge.cumulative[segment.index] + t * segment.length, forward = nav.pose(edge, along, 1);
    const facing = Math.cos(player.heading - forward.heading), score = Math.abs(distance - edge.profile.lane) + 10 * (1 - Math.abs(facing));
    if (!best || score < best.score) best = { score, edge, direction: facing >= 0 ? 1 : -1, along };
  });
  return best && { edge: best.edge, direction: best.direction, along: best.direction > 0 ? best.along : best.edge.length - best.along };
}

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
      this.path = acquire(nav, player);
      this.next = null;
      if (!this.path) return { handbrake: true };
    }
    const path = this.path;
    // Where the car really is along its way, so a slide does not lose it: its
    // projection onto its own street and the turn it is taking, never onto
    // whichever street happens to be nearest (in a wide road's outer lane, a
    // side street leaving at a slant can be nearer than the road itself)
    let turn = this.next ? turnPath(nav, path.edge, path.direction, this.next) : null;
    const place = travelAlong(path.edge, path.direction, player.u, player.s);
    path.along = place.along;
    if (turn && place.along > turn.start) {
      const through = turnProgress(turn, player.u, player.s);
      if (through < turn.length) path.along = turn.start + through;
      else {
        // Out of the turn and onto the next street
        path.edge = this.next.edge; path.direction = this.next.direction; this.next = null; turn = null; this.driver.stopWait = 0;
        path.along = travelAlong(path.edge, path.direction, player.u, player.s).along;
      }
    }
    // Knocked or pushed well off its way, it finds its street again
    const off = turn && path.along > turn.start ? 0 : travelAlong(path.edge, path.direction, player.u, player.s).off;
    if (off > Math.max(12, path.edge.profile.halfWidth + 6)) { this.path = null; return this.update(player, traffic, speedLimit, dt); }
    const remaining = path.edge.length - path.along;
    if (remaining < 70 && !this.next) {
      const roll = this.random();
      const pick = options => Math.abs(options[0].turn) < .5 && roll < .6 ? options[0] : options[Math.floor(roll * options.length)];
      this.next = wayOn(nav, path.edge, path.direction, pick, next => next.edge.kind !== 'path' || path.edge.kind === 'path');
      turn = this.next ? turnPath(nav, path.edge, path.direction, this.next) : null;
    }
    // The car heads straight for a point ahead, so round a curve it takes the
    // chord: in and near a turn the point is close enough that the chord cuts
    // the corner by no more than a quarter of a metre, clear of the kerb
    const inTurn = turn && path.along + 16 > turn.start && path.along < turn.start + turn.length;
    const lookahead = Math.min(Math.max(7, Math.abs(player.speed ?? 0) * .7), inTurn && Number.isFinite(turn.radius) ? Math.max(3, Math.sqrt(8 * turn.radius * .25)) : Infinity), ahead = path.along + lookahead;
    let aim, turnSpeed = Infinity;
    if (!turn) aim = nav.pose(path.edge, Math.min(path.edge.length, ahead), path.direction, path.edge.profile.lane);
    else {
      if (ahead <= turn.start) aim = nav.pose(path.edge, ahead, path.direction, path.edge.profile.lane);
      else if (ahead <= turn.start + turn.length) aim = turn.pose(ahead - turn.start);
      else aim = nav.pose(this.next.edge, turn.end + ahead - turn.start - turn.length, this.next.direction, this.next.edge.profile.lane);
      // A player's car corners a little harder than the traffic
      turnSpeed = approachSpeed(turn, turn.start - path.along, 4.5) * 1.15;
    }
    const ds = aim.s - player.s, du = aim.u - player.u, length = Math.hypot(ds, du);
    // A way ahead never lies behind a car already moving: if it does, the car
    // has lost its way, and finds it again rather than whipping round
    if (Math.abs(player.speed ?? 0) > 2 && length > 1 && (ds * Math.cos(player.heading) + du * Math.sin(player.heading)) / length < -.2 && !this.lost) {
      this.lost = true; this.path = null; this.next = null;
      const state = this.update(player, traffic, speedLimit, dt);
      this.lost = false;
      return state;
    }
    const along = ds / Math.max(.001, length), across = du / Math.max(.001, length);
    const cruiseSpeed = player.carId === 'formula' ? player.stats.topSpeed : path.edge.profile.speed * 1.15;
    let speed = Math.min(cruiseSpeed, speedLimit, player.stats.topSpeed, turnSpeed);
    // With no way on (a dead end), it pulls up at the end of the street
    if (!turn) speed = Math.min(speed, Math.sqrt(2 * 4 * Math.max(0, remaining - 3)));
    if (traffic.enabled && traffic.junctions) {
      Object.assign(this.driver, { edge: path.edge, direction: path.direction, along: path.along, speed: Math.abs(player.speed ?? 0), next: this.next, turn, s: player.s, u: player.u, spec: player.spec });
      speed = Math.min(speed, traffic.junctions.limit(this.driver, traffic.vehicles, null, dt));
    }
    // A car ahead in its lane holds it back; an oncoming one keeps to its own
    // lane (where the road bends past a junction it can look to be in the way,
    // and each would wait for the other), and the junctions settle crossings
    for (const car of traffic.enabled ? traffic.vehicles : []) {
      if (Math.cos(car.heading - player.heading) < -.5) continue;
      const dx = car.u - player.u, dz = car.s - player.s, heading = Math.atan2(across, along);
      const ahead = dz * Math.cos(heading) + dx * Math.sin(heading);
      const beside = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
      if (ahead > 0 && beside < 3) speed = Math.min(speed, Math.sqrt(2 * 7 * Math.max(0, ahead - 10)));
    }
    return { touchDrive: { amount: speed / player.stats.topSpeed, along, across, heading: Math.atan2(across, along) } };
  }
}
