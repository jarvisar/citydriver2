import { CLOSE, FILE } from './city-walks.js';
export { cityWalker, WALKER_COLORS, createWalkerMaterial, createWalkerAlert, addWalkerAlert, walkerAppearance, setWalkerAppearance, setWalkerTurn, pairWalkers, taxiGroupAppearance } from './city-walkers.js';

// Shared by street residents and waiting passengers. Absolute time means
// culled residents resume in the right place without maintaining a rig.
export function walkerFloat(walker, time, target = {}) {
  const phase = (walker.floatPhase ?? walker.phase) + time * (2.6 + walker.speed * 1.4);
  target.lift = .07 + Math.sin(phase) * .075;
  target.roll = Math.sin(phase * .5) * .055;
  target.stretch = 1 + Math.cos(phase) * .018;
  return target;
}

// How far behind their partner the second of a pair walks (m): in single file only
export const pairLag = walker => walker.pairOffset > 0 && walker.loop?.file ? FILE : 0;
export function offsetWalkerPose(pose, walker) {
  if (!walker.pairOffset) return pose;
  // Around blocks the eased yaw rotates the pair smoothly through corners.
  // (shoulder to shoulder all the way round a walk with no room for two
  // abreast, and in single file round one with no room for that: see WalkSpace)
  const loop = walker.loop, offset = loop?.file ? 0 : loop?.tight ? walker.pairOffset * CLOSE : walker.pairOffset;
  pose.x += Math.cos(pose.yaw) * offset;
  pose.s += Math.sin(pose.yaw) * offset;
  return pose;
}
