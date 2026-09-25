import { KERB_RADIUS } from './city.js';

// The shape of every junction, derived once from the street graph and shared
// by everything that has to agree about it: where each road leaves the
// junction box (its kerb corners), where the crosswalk and the stop line are,
// where the sign or signal stands, and where turning traffic leaves one lane
// and joins the next.
//
// An approach's corners are with its neighbours round the node. Its side line
// meets a neighbour's side line where
//   t = (w_other + w_self * cos θ) / sin θ
// along it (θ the angle between the two roads), and the kerb round that
// corner is rounded, which carries the corner on by R / tan(θ / 2). The
// approach is clear of the junction beyond the furthest of its two corners.
export const CROSSWALK = 3.2;
// A street shorter than this between two junctions is the middle of one
// junction (a staggered crossroads): traffic carries on through it without
// stopping, and it has no crosswalk of its own.
export const LINK = 24;
const MAX_CLEAR = 34, LOOK = 6;

// Unit direction of an edge leaving a node, averaged over its first few metres
function leaving(nav, edge, node) {
  const direction = edge.a === node.id ? 1 : -1, along = Math.min(LOOK, edge.length * .4);
  const p = nav.pose(edge, along, direction);
  const dx = p.u - node.x, dy = p.s - node.y, length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length, direction };
}

export function junctionGeometry(nav) {
  if (nav.junctionGeometry) return nav.junctionGeometry;
  const junctions = new Map();
  for (const node of nav.nodes) {
    const edges = node.edges.filter(edge => edge.kind !== 'path');
    if (edges.length < 3) continue;
    const arms = edges.map(edge => {
      const t = leaving(nav, edge, node);
      return { edge, tx: t.x, ty: t.y, angle: Math.atan2(t.y, t.x), halfWidth: edge.profile.halfWidth, leaveDirection: t.direction };
    }).sort((a, b) => a.angle - b.angle);
    const n = arms.length;
    for (let i = 0; i < n; i++) {
      const arm = arms[i];
      let clear = 3;
      for (const other of [arms[(i + 1) % n], arms[(i - 1 + n) % n]]) {
        if (other === arm) continue;
        const cos = arm.tx * other.tx + arm.ty * other.ty, theta = Math.acos(Math.max(-1, Math.min(1, cos)));
        // Nearly straight on, the neighbour is the same street carrying on
        if (theta > Math.PI - .35 || theta < .2) continue;
        const corner = Math.max(0, (other.halfWidth + arm.halfWidth * cos) / Math.sin(theta));
        clear = Math.max(clear, corner + KERB_RADIUS / Math.tan(theta / 2));
      }
      arm.clear = Math.min(MAX_CLEAR, clear, arm.edge.length * .45);
    }
    for (const arm of arms) {
      const other = arm.edge.a === node.id ? arm.edge.b : arm.edge.a;
      arm.link = arm.edge.length < LINK && nav.nodes[other].edges.filter(edge => edge.kind !== 'path').length >= 3;
    }
    const approaches = new Map(arms.map(arm => [arm.edge, arm]));
    junctions.set(node.id, { node, arms, approaches, radius: Math.max(...arms.map(arm => arm.clear)) });
  }
  nav.junctionGeometry = junctions;
  return junctions;
}

// Distance from the node along an approach to its stop line
export const stopLineDistance = clear => clear + CROSSWALK + .7;
