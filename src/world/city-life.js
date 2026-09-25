import * as THREE from 'three';

export { cityWalker, WALKER_COLORS, createWalkerMaterial, walkerAppearance, setWalkerAppearance, pairWalkers, taxiGroupAppearance } from './city-walkers.js';

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
