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

function freshSeed() {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 0x100000000);
}
