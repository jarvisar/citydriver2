// Resolve once per page load, before any terrain or shared scenery is built.
// An explicit seed makes a particular drive reproducible for testing or sharing.
export function resolveWorldSeed(search = '', randomSeed = freshSeed) {
  const value = new URLSearchParams(search).get('seed');
  if (value !== null && /^\d{1,10}$/.test(value)) {
    const seed = Number(value);
    if (seed <= 0xffffffff) return seed;
  }
  return randomSeed();
}

export function freshSceneStart(currentS, random = Math.random) {
  let s = Math.floor(random() * 40000) - 20000;
  // Leave the entire resident and prefetched area behind, even if the random
  // draw lands near the car. Keep starts in the same range as a new journey.
  if (Math.abs(s - currentS) < 2048) s += currentS >= 0 ? -4096 : 4096;
  return { s, distance: 0 };
}

function freshSeed() {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 0x100000000);
}
