import { resolveWorldSeed } from './generation.js';

// One seed per visit; URL seeds reproduce the same blocks in every direction.
export const SEED = resolveWorldSeed(globalThis.location?.search);
export const CHUNK_LENGTH = 128;

export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function randomAt(a, b = 0, seed = SEED) {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed, 144269);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function seededRandom(seed) {
  let i = 0;
  return () => randomAt(seed, i++);
}

