import * as THREE from 'three';
import { Parts } from './city-assets.js';

export { cityWalker, WALKER_COLORS, WALKER_LOOKS, WALKER_STYLES, WALKER_SKIN, WALKER_HAIR, createWalkerMaterial, walkerAppearance, setWalkerAppearance, pairWalkers, taxiGroupAppearance } from './city-walkers.js';

function canalBoat() {
  const p = new Parts();
  // A clipped stern and pointed bow read as a hull even from the low camera.
  // Two tiny extrusions stay inside the existing merged boat instance.
  const outline = [[-1.5,6.5],[1.5,6.5],[2,5.7],[2,-4.8],[1.2,-6],[0,-6.65],[-1.2,-6],[-2,-4.8],[-2,5.7]];
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const hull = new THREE.ExtrudeGeometry(shape, { depth: .9, bevelEnabled: false, steps: 1 });
  const vertices = hull.attributes.position;
  for (let i = 0; i < vertices.count; i++) if (vertices.getZ(i) > .45) vertices.setX(i, vertices.getX(i) * .82);
  hull.computeVertexNormals(); hull.rotateX(Math.PI / 2);
  p.add(hull, [0, .87, 0], '#46626b');
  const deck = new THREE.ExtrudeGeometry(shape, { depth: .15, bevelEnabled: false, steps: 1 });
  deck.rotateX(Math.PI / 2); deck.scale(1.035, 1, 1.02);
  p.add(deck, [0, 1.005, 0], '#dbcdb0');
  p.box([0, 1.42, 1.4], [3.1, .9, 7.7], '#b6634c');
  p.box([0, 2.04, 1.4], [3, .5, 7.6], '#e9d4ad');
  for (const side of [-1, 1]) for (const z of [-1, 1.2, 3.4]) p.box([side * 1.52, 2.03, z], [.03, .34, 1.3], '#537b87');
  p.box([0, 2.39, 1.4], [3.4, .2, 8.1], '#49655f');
  p.cylinder([.7, 2.8, 3.5], .19, .19, .75, '#4f5755', 8);
  for (const side of [-1, 1]) p.box([side * 1.7, 1.23, -4.5], [.12, .6, 3], '#b4b7a4');
  p.box([0, 1.3, -5.6], [1.4, .6, 1], '#9eaa7c');
  return p.finish();
}

export const cityBoat = canalBoat();

// Shared by street residents and waiting passengers. Absolute time means
// culled residents resume in the right place without maintaining a rig.
export function walkerFloat(walker, time, target = {}) {
  const phase = (walker.floatPhase ?? walker.phase) + time * (2.6 + walker.speed * 1.4);
  target.lift = .07 + Math.sin(phase) * .075;
  target.roll = Math.sin(phase * .5) * .055;
  target.stretch = 1 + Math.cos(phase) * .018;
  return target;
}

export function offsetWalkerPose(pose, walker, river = false) {
  if (!walker.pairOffset) return pose;
  // Keep each partner on the same side when a river promenade reverses.
  // Around blocks the eased yaw rotates the pair smoothly through corners.
  const x = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  pose.x += (river ? Math.abs(x) : x) * walker.pairOffset;
  pose.s += (river ? Math.abs(s) : s) * walker.pairOffset;
  return pose;
}

export function walkerPose(walker, time, river = false) {
  const direction = walker.direction ?? 1;
  const travel = walker.phase + time * walker.speed * direction;
  if (river) {
    const offset = ((travel % 144) + 144) % 144;
    const north = offset === 0 || (offset !== 72 && (offset < 72) === (direction > 0));
    return { x: walker.side ? 97.5 : 14.5, s: 20 + (offset < 72 ? offset : 144 - offset), yaw: north ? 0 : Math.PI };
  }
  const offset = ((travel % 332) + 332) % 332, side = Math.floor(offset / 83), along = offset % 83;
  // Ease the quarter-turn over the last/first 80 cm of each pavement edge.
  const turn = .8, blend = along < turn ? (along + turn) / (2 * turn) : (along - 83 + turn) / (2 * turn);
  const eased = THREE.MathUtils.smoothstep(blend, 0, 1);
  const yaw = -(side + (along < turn ? eased - 1 : eased)) * Math.PI / 2 + (direction < 0 ? Math.PI : 0);
  if (side === 0) return { x: 14.5, s: 14.5 + along, yaw };
  if (side === 1) return { x: 14.5 + along, s: 97.5, yaw };
  if (side === 2) return { x: 97.5, s: 97.5 - along, yaw };
  return { x: 97.5 - along, s: 14.5, yaw };
}
