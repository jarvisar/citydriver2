// 2D simplex noise after Stefan Gustavson's public-domain description, with a
// seeded permutation so a city's park paths and coast bends are reproducible.
const F2 = .5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1]];

export function createNoise2D(random = Math.random) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(random() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
  const corner = (x, y, g) => { let t = .5 - x * x - y * y; if (t < 0) return 0; t *= t; return t * t * (GRAD[g][0] * x + GRAD[g][1] * y); };
  return function noise2D(xin, yin) {
    const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s), t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const n0 = corner(x0, y0, permMod12[ii + perm[jj]]);
    const n1 = corner(x1, y1, permMod12[ii + i1 + perm[jj + j1]]);
    const n2 = corner(x2, y2, permMod12[ii + 1 + perm[jj + 1]]);
    return 70 * (n0 + n1 + n2);
  };
}
