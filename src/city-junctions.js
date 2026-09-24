import { navGraph } from './world/nav-graph.js';
import { junctionGeometry, stopLineDistance } from './world/junction-geometry.js';
import { CITY, cityStyleDistrict } from './world/city.js';
import { randomAt } from './world/route.js';

// Junction control on the generated streets, by the streets' ranks (see
// mapgen/road-hierarchy.js). Two arterials crossing, or a collector crossing
// an arterial, run a shared signal cycle, as do two collectors crossing
// downtown. Otherwise the best-ranked road straight through the junction
// has the right of way and the others stop for it, or where only local
// streets meet, do as their district does: the old town's lanes are left
// unmarked, the garden quarter's quiet streets give way, the warehouse
// district's stop, and downtown and the busier quarters have all-way stops
// at their crossroads (a few junctions in each do otherwise). The traffic, the
// autodrive and the signal lamps all read the same cycle, and everyone stops
// or gives way at the line the junction's geometry puts behind its crosswalk.
const BIG = new Set(['main', 'major', 'ring', 'coast', 'riverbank']);
const rankOf = edge => edge.profile?.rank ?? (BIG.has(edge.kind) ? 3 : 1);
// How local streets meet in each district: 'open' (nobody stops), 'yield'
// (the lesser street gives way), 'stop' (it stops) or 'all' (everyone stops
// at a crossroads), and the share of junctions that do the next thing instead
const LOCAL_RULES = {
  'Old town': ['open', .25, 'yield'], 'Garden quarter': ['yield', .25, 'stop'], 'Warehouse district': ['stop', .2, 'all'],
  'Market district': ['all', .3, 'stop'], 'Civic quarter': ['all', .35, 'stop'], Midtown: ['all', .15, 'stop'],
};
// Where crosswalks are marked across a street nobody stops on
const DENSE = new Set(['Midtown', 'Market district']);

export function cityGreen(axis, time) {
  const phase = ((time % 24) + 24) % 24;
  return axis === 'north' ? phase < 10 : phase >= 12 && phase < 22;
}

// Approaches at a junction fall into two groups by heading; the group of the
// best-ranked road is 'north' for the cycle, the other 'east'. Each approach
// is 'signal', 'stop', 'yield' or 'priority' (nobody stops), and says whether
// a crosswalk is marked across it: at a signal or wherever traffic stops,
// and across a street nobody stops on only downtown and in the market.
export function junctionControls(nav = navGraph()) {
  if (nav.controls) return nav.controls;
  const controls = new Map(), geometry = junctionGeometry(nav);
  for (const node of nav.nodes) {
    const shape = geometry.get(node.id);
    if (!shape) continue;
    const edges = shape.arms.map(arm => arm.edge), heading = new Map(edges.map(edge => [edge, headingInto(nav, edge, node)]));
    // The road through the junction: the pair of arms most nearly straight
    // across from each other, the best ranked (and the longest) first
    let through = null, throughScore = -Infinity;
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j], straight = -Math.cos(heading.get(a) - heading.get(b));
      if (straight < .5 && edges.length > 2) continue;
      const score = Math.min(rankOf(a), rankOf(b)) * 100 + Math.max(rankOf(a), rankOf(b)) * 10 + straight + Math.min(a.length, b.length, 300) / 1000;
      if (score > throughScore) { throughScore = score; through = [a, b]; }
    }
    const primary = through ? (rankOf(through[0]) >= rankOf(through[1]) ? through[0] : through[1]) : edges[0], primaryHeading = heading.get(primary);
    const axisOf = edge => Math.abs(Math.cos(heading.get(edge) - primaryHeading)) > .7 ? 'north' : 'east';
    const real = edges.filter(edge => !shape.approaches.get(edge).link);
    const topOf = axis => Math.max(-1, ...edges.filter(edge => axisOf(edge) === axis).map(rankOf));
    const cross = edges.filter(edge => axisOf(edge) === 'east'), crossTop = topOf('east'), top = topOf('north');
    const district = cityStyleDistrict(node.y, node.x), random = randomAt(node.id, 7501, CITY.seed);
    // Signals: two arterials crossing; a collector crossing an arterial (both
    // its arms there); two collectors crossing downtown
    const crossesOver = cross.filter(edge => rankOf(edge) >= 2).length >= 2;
    const signal = (top >= 3 && crossTop >= 3) || (top >= 3 && crossTop >= 2 && crossesOver) || (district === 'Midtown' && top >= 2 && crossTop >= 2 && crossesOver);
    // Everyone else: the road through has the right of way, and the rest stop
    // for it, or among local streets do as the district does
    // (a better road that ends here, on a lesser one running through)
    const endsHere = through && edges.some(edge => !through.includes(edge) && !shape.approaches.get(edge).link && rankOf(edge) > Math.min(...through.map(rankOf)));
    let rule;
    if (signal) rule = 'signal';
    else if (endsHere) rule = 'all';
    else if (top < 0) rule = 'open';  // walks through a park
    else if (top >= 2 && top > crossTop) rule = 'stop';
    else if (top >= 2) rule = 'all';  // two collectors crossing
    else {
      const [usual, share, other] = LOCAL_RULES[district] ?? ['stop', 0, 'stop'];
      rule = random < share ? other : usual;
      // (an all-way stop is for a crossroads: at a T the stem stops)
      if (rule === 'all' && real.length < 4) rule = 'stop';
    }
    const approaches = new Map();
    for (const edge of edges) {
      const arm = shape.approaches.get(edge), clear = arm.clear, onThrough = through?.includes(edge);
      // A link inside a junction complex never stops: its traffic already has the junction
      const kind = arm.link ? 'priority' : rule === 'signal' ? 'signal' : rule === 'open' ? 'priority' : rule === 'all' ? 'stop'
        : onThrough ? 'priority' : rankOf(edge) < 0 ? 'stop' : rule;
      const crosswalk = !arm.link && rankOf(edge) >= 0 && (kind === 'signal' || kind === 'stop' || (kind === 'priority' && rule !== 'open' && DENSE.has(district) && rankOf(edge) <= 2));
      // Cars wait behind the crosswalk, which begins where the road leaves the junction
      approaches.set(edge, { kind, axis: axisOf(edge), clear, stopDistance: stopLineDistance(clear), heading: heading.get(edge), link: arm.link, crosswalk });
    }
    controls.set(node, { approaches, signal, fourWay: rule === 'all', rule, district, radius: shape.radius });
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
const YIELD_SPEED = 5;  // how fast a driver giving way crosses its line, m/s
const PATIENCE = 10;  // seconds at a stop or give-way line before the traffic lets a driver out (half on a green light)

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
  // The right of way: a green light or a road that does not stop over a
  // give-way sign over a stop sign, and among those, straight on over turning
  // right over turning left. A driver who has waited at a stop or give-way
  // line for a while is let out, and one waiting on a green light to turn
  // across the oncoming traffic is let across: the traffic it waits for gives
  // way to it, as drivers do, rather than streaming past for ever.
  precedence(control, movement, driver = null) {
    const patient = (driver?.stopWait ?? 0) > (control.kind === 'signal' ? PATIENCE / 2 : PATIENCE) && control.kind !== 'priority';
    return (patient ? 14 : control.kind === 'stop' ? 0 : control.kind === 'yield' ? 5 : 10) - movement.kind;
  }
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
    } else if (control.kind === 'yield' || control.kind === 'signal') {
      // (how long it has waited to be let out, or on green for a gap to turn across)
      if (gap < 1.2 && speed < 1.2 && green) driver.stopWait = (driver.stopWait ?? 0) + dt;
      else if (gap > 3) driver.stopWait = 0;
    }
    if (asking === undefined) asking = control.kind === 'yield' ? gap < Math.max(12, speed * 2.5) : green ? gap < Math.max(18, speed * 2.5) : gap < speed * speed / (2 * 6);
    // A driver giving way slows to look as it comes to the line, whether or
    // not it has been given the junction yet (and asks early enough to stop)
    const look = control.kind === 'yield' && gap > -1 ? Math.sqrt(YIELD_SPEED * YIELD_SPEED + 2 * DECEL * Math.max(0, gap)) : Infinity;
    if (!asking) return control.kind === 'yield' ? look : stopping;
    // The junction, and the next one too if there is no room to stop between them
    const chain = [{ movement: this.movement(edge, direction, next, turn), control, next }], after = driver.after;
    if (after?.edge === next.edge && after.direction === next.direction && after.next && after.turn && after.next.edge !== after.edge) {
      const beyond = approachControl(nav, next.edge, next.direction);
      if (beyond?.kind && next.edge.length - beyond.stopDistance - chain[0].movement.exit < half * 2 + 3) chain.push({ movement: this.movement(next.edge, next.direction, after.next, after.turn), control: beyond, next: after.next });
    }
    return this.grant(driver, chain, drivers, player) ? look : stopping;
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
        if (this.precedence(theirControl, theirs, other) <= this.precedence(control, movement, driver)) continue;
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
