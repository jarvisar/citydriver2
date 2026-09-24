import { navGraph } from './world/nav-graph.js';
import { junctionGeometry, stopLineDistance } from './world/junction-geometry.js';

// Junction control on the generated streets. A junction where two wide roads
// cross runs a shared signal cycle; a side street meeting a wider road stops
// and gives way; side streets meeting each other are four-way stops. The
// traffic, the autodrive and the signal lamps all read the same cycle, and
// everyone stops at the line the junction's geometry puts behind its crosswalk.
const BIG = new Set(['main', 'major', 'ring', 'coast', 'riverbank']);

export function cityGreen(axis, time) {
  const phase = ((time % 24) + 24) % 24;
  return axis === 'north' ? phase < 10 : phase >= 12 && phase < 22;
}

// Approaches at a junction fall into two groups by heading; the group of the
// widest road is 'north' for the cycle, the other 'east'.
export function junctionControls(nav = navGraph()) {
  if (nav.controls) return nav.controls;
  const controls = new Map(), geometry = junctionGeometry(nav);
  for (const node of nav.nodes) {
    const shape = geometry.get(node.id);
    if (!shape) continue;
    const edges = shape.arms.map(arm => arm.edge);
    const approaches = new Map();
    const big = edges.filter(edge => BIG.has(edge.kind));
    const primary = big[0] ?? edges[0], primaryHeading = headingInto(nav, primary, node);
    const bigAxes = new Set();
    for (const edge of big) bigAxes.add(Math.abs(Math.cos(headingInto(nav, edge, node) - primaryHeading)) > .7 ? 'a' : 'b');
    const crossingBig = bigAxes.size > 1;
    for (const edge of edges) {
      const heading = headingInto(nav, edge, node);
      const axis = Math.abs(Math.cos(heading - primaryHeading)) > .7 ? 'north' : 'east';
      const arm = shape.approaches.get(edge), clear = arm.clear;
      // A link inside a junction complex never stops: its traffic already has the junction
      const kind = arm.link ? 'priority' : BIG.has(edge.kind) ? (crossingBig ? 'signal' : 'priority') : 'stop';
      // Cars wait behind the crosswalk, which begins where the road leaves the junction
      approaches.set(edge, { kind, axis, clear, stopDistance: stopLineDistance(clear), heading, link: arm.link });
    }
    controls.set(node, { approaches, signal: crossingBig, fourWay: !big.length, radius: shape.radius });
  }
  nav.controls = controls;
  return controls;
}

// Heading of travel along an edge as it arrives at the node
function headingInto(nav, edge, node) {
  const direction = edge.b === node.id ? 1 : -1;
  return nav.pose(edge, edge.length, direction).heading;
}

// The control on the approach at the end of an edge, with its node and the
// junction's radius (cached: every driver asks every frame)
export function approachControl(nav, edge, direction) {
  const cache = nav.approachCache ??= new Map(), key = edge.id * 2 + (direction > 0 ? 1 : 0);
  if (cache.has(key)) return cache.get(key);
  const node = nav.endNode(edge, direction), control = junctionControls(nav).get(node);
  const approach = control ? { node, ...control.approaches.get(edge), radius: control.radius } : null;
  cache.set(key, approach);
  return approach;
}


// Who may cross a junction, and when. Each driver claims its way through a
// junction (its movement: from its lane, round its turn, into the lane it
// leaves by) before it crosses the stop line, and holds the claim until it
// is clear of the far side of the box. A claim is refused while anyone else
// holds one whose path comes within a car's width of it, so no two cars
// ever cross paths in a junction; cars following each other in one lane
// share it. Who asks first is the right of way: a green light, or the road
// that does not stop, lets its drivers ask as they approach; a stop sign
// makes them stop at the line first, and at a four-way stop the one that
// has waited longest goes first. Anyone about to cross the path of a driver
// with the right of way (a car on the main road, or coming straight on while
// it turns across them) who is nearly there waits for them. Nobody enters a
// junction whose way out is backed up, and where the street beyond is too
// short to stop on before the next junction (inside a junction complex) the
// next junction is claimed with this one. A driver is anything with an edge,
// direction, along, speed, next and turn (see world/lane-paths.js), and the
// plan beyond as `after` if it has one; the traffic's cars and the
// autodrive share one of these.
const DECEL = 4;  // comfortable braking toward a stop line, m/s²
const GIVE_WAY = 4.5;  // seconds of warning a driver giving way wants
const CLEAR = 2.9;  // two paths closer than this, centre to centre, share road
const LOOK = 70;  // how far ahead of a junction a driver starts to think about it

export class JunctionTraffic {
  constructor(nav = navGraph()) {
    this.nav = nav; this.time = 0;
    this.claims = new Map();  // node id -> the claims on it
    this.movements = new Map(); this.conflicts = new Map();
  }
  reset() { this.claims.clear(); }
  // Forget claims their drivers have stopped asking about (a car recycled,
  // the autodrive switched off)
  tick(time) {
    this.time = time;
    for (const [id, claims] of this.claims) {
      for (const claim of claims.values()) if (claim.seen < time - 1) this.drop(claim);
      if (!claims.size) this.claims.delete(id);
    }
  }
  drop(claim) {
    for (const node of claim.nodes) this.claims.get(node.id)?.delete(claim);
    const driver = claim.driver;
    if (driver.claim === claim) { driver.claim = null; if (driver.pending) this.drop(driver.pending); }
    if (driver.leaving === claim) driver.leaving = null;
    if (driver.pending === claim) driver.pending = null;
  }
  // The way through the junction at the end of `edge`: the lane from the stop
  // line, the turn, and the first metres of the lane beyond, as points a metre
  // apart, and every junction node it crosses (two across a junction complex)
  movement(edge, direction, next, turn) {
    const key = `${edge.id}:${direction}>${next.edge.id}:${next.direction}${next.via ? `/${next.via.id}` : ''}`;
    if (this.movements.has(key)) return this.movements.get(key);
    const nav = this.nav, control = approachControl(nav, edge, direction), node = nav.endNode(edge, direction), nodes = [node];
    if (next.via) nodes.push(nav.endNode(next.via, nav.directionFrom(next.via, node)));
    const points = [], add = p => points.push({ x: p.u, y: p.s });
    for (let d = Math.max(0, edge.length - (control?.stopDistance ?? 8)); d < turn.start; d += 1) add(nav.pose(edge, d, direction, edge.profile.lane));
    for (let d = 0; d <= turn.length; d += 1) add(turn.pose(d));
    const exit = Math.min(next.edge.length, turn.end + 5);
    for (let d = turn.end; d <= exit; d += 1) add(nav.pose(next.edge, d, next.direction, next.edge.profile.lane));
    const bounds = { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
    // How far it turns: right (clockwise) positive
    const first = turn.pose(0), last = turn.pose(turn.length), angle = Math.atan2(Math.sin(last.heading - first.heading), Math.cos(last.heading - first.heading));
    const kind = Math.abs(angle) < .5 ? 0 : Math.abs(angle) > 2.6 ? 3 : angle > 0 ? 1 : 2;
    // Where the lane beyond leaves the junction box: the car is through once its tail is past that
    const box = junctionGeometry(nav).get(nodes.at(-1).id)?.approaches.get(next.edge)?.clear ?? turn.end;
    const movement = { key, edge, direction, out: next.edge, outDirection: next.direction, nodes, points, bounds, kind, exit: Math.min(turn.end, box + .5) };
    this.movements.set(key, movement);
    return movement;
  }
  // Whether two movements' paths come within a car's width of each other.
  // Cars in one lane share it (they follow each other), and two ways into
  // the same lane always meet.
  conflict(a, b) {
    if (a === b || (a.edge === b.edge && a.direction === b.direction)) return false;
    const key = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
    if (this.conflicts.has(key)) return this.conflicts.get(key);
    let hit = a.out === b.out && a.outDirection === b.outDirection;
    if (!hit && a.bounds.minX - CLEAR < b.bounds.maxX && b.bounds.minX - CLEAR < a.bounds.maxX && a.bounds.minY - CLEAR < b.bounds.maxY && b.bounds.minY - CLEAR < a.bounds.maxY) {
      for (const p of a.points) {
        for (const q of b.points) if (Math.abs(p.x - q.x) < CLEAR && Math.abs(p.y - q.y) < CLEAR && Math.hypot(p.x - q.x, p.y - q.y) < CLEAR) { hit = true; break; }
        if (hit) break;
      }
    }
    this.conflicts.set(key, hit);
    return hit;
  }
  // Everything a driver holds (a recycled car, a reset)
  release(driver) {
    if (driver.claim) this.drop(driver.claim);
    if (driver.pending) this.drop(driver.pending);
    if (driver.leaving) this.drop(driver.leaving);
  }
  // The right of way: a green light or a road that does not stop over a stop
  // sign, and among those, straight on over turning right over turning left
  precedence(control, movement) { return (control.kind === 'stop' ? 0 : 10) - movement.kind; }
  // How fast `driver` may go toward the junction at the end of its edge.
  // `drivers` are everyone else who might have the right of way; `player`,
  // the player's own car, whose way through nobody knows, is given the
  // junction whenever it is in it or heading into it.
  limit(driver, drivers, player, dt) {
    const nav = this.nav, { edge, direction, next, turn } = driver, half = (driver.spec?.length ?? 4.5) / 2;
    // Past the line of the junction it claimed: the claim is held until the
    // car is clear of the far side of the box
    if (driver.claim) {
      const m = driver.claim.movement;
      if (edge !== m.edge || direction !== m.direction) {
        if (driver.leaving) this.drop(driver.leaving);
        // Only the junction it is leaving: across a junction complex it has passed the first
        const leaving = driver.leaving = driver.claim;
        driver.claim = null;
        for (const node of leaving.nodes.slice(0, -1)) this.claims.get(node.id)?.delete(leaving);
        leaving.nodes = leaving.nodes.slice(-1);
        // and the junction beyond, if it was claimed with that one
        const pending = driver.pending;
        driver.pending = null;
        if (pending?.movement.edge === edge && pending.movement.direction === direction && pending.next === next) driver.claim = pending;
        else if (pending) this.drop(pending);
      } else if (next !== driver.claim.next) this.drop(driver.claim);
      if (driver.claim) driver.claim.seen = this.time;
      if (driver.pending) driver.pending.seen = this.time;
    }
    if (driver.leaving) {
      const m = driver.leaving.movement;
      if (edge !== m.out || direction !== m.outDirection || driver.along > m.exit + half + 1.5) this.drop(driver.leaving);
      else driver.leaving.seen = this.time;
    }
    if (!next || !turn || next.edge === edge) return Infinity;
    const control = approachControl(nav, edge, direction);
    if (!control?.kind) return Infinity;
    const remaining = edge.length - driver.along;
    if (remaining > LOOK) { if (driver.claim) this.drop(driver.claim); return Infinity; }
    // The car's front stops at the line
    const gap = remaining - control.stopDistance - half * .8, speed = driver.speed;
    const green = control.kind !== 'signal' || cityGreen(control.axis, this.time);
    if (driver.claim) {
      // A light that changes before the car reaches its line: it stops if it can
      if (green || gap < speed * speed / (2 * 6) + .5) return Infinity;
      this.drop(driver.claim);
    }
    const stopping = gap > .4 ? Math.max(1.4, Math.sqrt(2 * DECEL * (gap - .3))) : 0;
    let asking;
    if (gap < -1.5) asking = true;  // over the line already
    else if (control.kind === 'stop') {
      if (gap < 1.2 && speed < 1.2) driver.stopWait = (driver.stopWait ?? 0) + dt;
      else if (gap > 3) driver.stopWait = 0;
      asking = driver.stopWait > .6;
    } else asking = green ? gap < Math.max(18, speed * 2.5) : gap < speed * speed / (2 * 6);
    if (!asking) return stopping;
    // The junction, and the next one too if there is no room to stop between them
    const chain = [{ movement: this.movement(edge, direction, next, turn), control, next }], after = driver.after;
    if (after?.edge === next.edge && after.direction === next.direction && after.next && after.turn && after.next.edge !== after.edge) {
      const beyond = approachControl(nav, next.edge, next.direction);
      if (beyond?.kind && next.edge.length - beyond.stopDistance - chain[0].movement.exit < half * 2 + 3) chain.push({ movement: this.movement(next.edge, next.direction, after.next, after.turn), control: beyond, next: after.next });
    }
    return this.grant(driver, chain, drivers, player) ? Infinity : stopping;
  }
  grant(driver, chain, drivers, player) {
    const nav = this.nav;
    // Nobody crossing, or bound to cross, where these movements go
    for (const { movement } of chain) for (const node of movement.nodes) for (const claim of this.claims.get(node.id)?.values() ?? []) {
      if (claim.driver !== driver && this.conflict(movement, claim.movement)) return false;
    }
    if (player && chain.some(({ movement }) => this.playerIn(movement, player))) return false;
    for (const other of drivers) {
      if (other === driver || !other.edge) continue;
      // Room on the far side: nobody standing just beyond the junction in the
      // lane it leaves by (nor, where it cannot stop between two, anywhere between)
      const last = chain.at(-1).movement;
      if (other.edge === last.out && other.direction === last.outDirection && other.along < last.exit + 9 && other.speed < 1.5) return false;
      if (chain.length > 1 && other.edge === chain[0].movement.out && other.direction === chain[0].movement.outDirection && other.speed < 1.5) return false;
      // (a car still clearing a junction behind it gives way to nobody: it has to get out of the box)
      if (driver.leaving || other.claim || !other.next || !other.turn || other.next.edge === other.edge) continue;
      // Giving way to anyone with the right of way on a crossing path who is nearly there
      const theirControl = approachControl(nav, other.edge, other.direction);
      if (!theirControl?.kind || (theirControl.kind === 'signal' && !cityGreen(theirControl.axis, this.time))) continue;
      for (const { movement, control } of chain) {
        if (!movement.nodes.includes(theirControl.node)) continue;
        const theirs = this.movement(other.edge, other.direction, other.next, other.turn);
        if (this.precedence(theirControl, theirs) <= this.precedence(control, movement)) continue;
        const gap = other.edge.length - other.along - theirControl.stopDistance;
        if (gap < -1.5 || gap / Math.max(other.speed, 1) > GIVE_WAY) continue;
        if (this.conflict(movement, theirs)) return false;
      }
    }
    const claims = chain.map(({ movement, next }) => {
      const claim = { driver, movement, nodes: movement.nodes.slice(), next, seen: this.time };
      for (const node of movement.nodes) {
        if (!this.claims.has(node.id)) this.claims.set(node.id, new Map());
        this.claims.get(node.id).set(claim, claim);
      }
      return claim;
    });
    driver.claim = claims[0]; driver.pending = claims[1] ?? null;
    return true;
  }
  // The player's car on this movement's path, or heading onto it within the
  // next couple of seconds
  playerIn(movement, player) {
    const b = movement.bounds, reach = Math.min(40, Math.max(0, player.speed ?? 0) * 2.5), hx = Math.sin(player.heading), hy = Math.cos(player.heading);
    for (let d = 0; d <= reach; d += 2) {
      const x = player.u + hx * d, y = player.s + hy * d;
      if (x < b.minX - 3.5 || x > b.maxX + 3.5 || y < b.minY - 3.5 || y > b.maxY + 3.5) continue;
      for (const p of movement.points) if (Math.hypot(p.x - x, p.y - y) < 3.5) return true;
    }
    return false;
  }
}
