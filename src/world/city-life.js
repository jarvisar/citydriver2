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

export function offsetWalkerPose(pose, walker) {
  if (!walker.pairOffset) return pose;
  // Around blocks the eased yaw rotates the pair smoothly through corners.
  pose.x += Math.cos(pose.yaw) * walker.pairOffset;
  pose.s += Math.sin(pose.yaw) * walker.pairOffset;
  return pose;
}
