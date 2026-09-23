// Seeded pseudo-random numbers. Every generator takes one of these so a seed
// reproduces the same coastline, roads and lots on every visit.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomRange = (random, max, min = 0) => random() * (max - min) + min;
