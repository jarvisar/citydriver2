import { navGraph } from './world/nav-graph.js';

// Junction control on the generated streets. A junction where two wide roads
// cross runs a shared signal cycle; a side street meeting a wider road stops
// and gives way; side streets meeting each other are four-way stops. The
// traffic, the autodrive and the signal lamps all read the same cycle.
const BIG = new Set(['main', 'major', 'coast', 'riverbank']);

export function cityGreen(axis, time) {
  const phase = ((time % 24) + 24) % 24;
  return axis === 'north' ? phase < 10 : phase >= 12 && phase < 22;
}

// Approaches at a junction fall into two groups by heading; the first group is
// 'north' for the cycle, the second 'east'.
export function junctionControls(nav = navGraph()) {
  if (nav.controls) return nav.controls;
  const controls = new Map();
  for (const node of nav.nodes) {
    const edges = node.edges.filter(edge => edge.kind !== 'path');
    if (edges.length < 3) continue;
    const approaches = new Map();
    const big = edges.filter(edge => BIG.has(edge.kind));
    const primary = edges[0], primaryHeading = headingInto(nav, primary, node);
    let bigAxes = new Set();
    for (const edge of big) bigAxes.add(Math.abs(Math.cos(headingInto(nav, edge, node) - primaryHeading)) > .7 ? 'a' : 'b');
    const crossingBig = bigAxes.size > 1;
    for (const edge of edges) {
      const heading = headingInto(nav, edge, node);
      const axis = Math.abs(Math.cos(heading - primaryHeading)) > .7 ? 'north' : 'east';
      let kind;
      if (BIG.has(edge.kind)) kind = crossingBig ? 'signal' : 'priority';
      else kind = big.length ? 'stop' : 'stop';
      const crossHalfWidth = Math.max(...edges.filter(other => other !== edge).map(other => other.profile.halfWidth));
      approaches.set(edge, { kind, axis, crossHalfWidth, heading });
    }
    controls.set(node, { approaches, signal: crossingBig, fourWay: !big.length });
  }
  nav.controls = controls;
  return controls;
}

// Heading of travel along an edge as it arrives at the node
function headingInto(nav, edge, node) {
  const direction = edge.b === node.id ? 1 : -1;
  return nav.pose(edge, edge.length, direction).heading;
}

export function approachControl(nav, edge, direction) {
  const node = nav.endNode(edge, direction), control = junctionControls(nav).get(node);
  return control ? { node, ...control.approaches.get(edge) } : null;
}

// How fast a driver may go toward the junction at the end of its edge.
// Signals follow the shared cycle; stops wait at the line until the junction
// is clear of priority traffic and take a short reservation; priority
// approaches never slow. `driver` keeps stopKey/stopWait/stopReleased.
export function junctionSpeed(driver, traffic, nav, edge, direction, along, speed, dt) {
  const control = approachControl(nav, edge, direction);
  if (!control) return Infinity;
  const remaining = edge.length - along, stopDistance = control.crossHalfWidth + 4;
  const gap = remaining - stopDistance;
  if (gap <= -2 || control.kind === 'priority') return Infinity;
  const key = control.node.id;
  if (control.kind === 'signal') {
    if (cityGreen(control.axis, traffic.time)) return Infinity;
    // Amber and red: stop at the line unless already past it
    return Math.sqrt(14 * Math.max(0, gap));
  }
  if (driver.stopKey !== key) { driver.stopKey = key; driver.stopWait = 0; driver.stopReleased = false; }
  if (driver.stopReleased) return Infinity;
  if (gap < 1.2 && speed < .4) driver.stopWait += dt;
  else if (gap >= 1.2) driver.stopWait = 0;
  const reservations = traffic.junctionReservations ??= new Map();
  for (const [id, reservation] of reservations) if (reservation.until <= traffic.time) reservations.delete(id);
  if (driver.stopWait >= .75 && !reservations.has(key)) {
    const node = control.node;
    const crossing = traffic.vehicles.some(other => {
      if (other === driver || !other.edge) return false;
      const distance = Math.hypot(other.s - node.y, other.u - node.x);
      if (distance < control.crossHalfWidth + 6) return true;  // in the box
      // Approaching on a road that does not stop here
      if (other.edge === edge && other.direction === direction) return false;
      const otherControl = approachControl(nav, other.edge, other.direction);
      if (!otherControl || otherControl.node !== node || otherControl.kind === 'stop') return false;
      const ahead = other.edge.length - other.along;
      return ahead < Math.max(18, other.speed * 3) && other.speed > .5;
    });
    if (!crossing) {
      reservations.set(key, { until: traffic.time + 5 });
      driver.stopReleased = true;
      return Infinity;
    }
  }
  return Math.sqrt(14 * Math.max(0, gap));
}
