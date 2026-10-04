import { Parts } from './city-assets.js';

// Rolling stock for a tram depot's yard and a station's platforms (see
// landmark-grounds.js): boxes baked with their colors into the props batch,
// as the squares' stalls are, made once per paint. Each runs along local z,
// its wheels on rails GAUGE apart whose tops are local y 0.
export const GAUGE = 1.435;
const GLASS = '#2e4650', UNDER = '#34383a', CREAM = '#ece2c6', LAMP = '#f2e6b8', DARK = '#1f2528';
const cache = new Map();
const made = (key, build) => { if (!cache.has(key)) cache.set(key, build()); return cache.get(key); };

// A single-deck tram, 13 m: a painted body with a cream band, windows all
// round, doors on its right, and a pantograph on its roof
export const TRAM_LENGTH = 13;
export function tram(paint) {
  return made(`tram-${paint}`, () => {
    const p = new Parts(), L = TRAM_LENGTH, W = 2.4;
    for (const z of [-L / 2 + 2.8, L / 2 - 2.8]) p.box([0, .38, z], [1.9, .56, 2.4], UNDER);
    p.box([0, .78, 0], [W - .24, .3, L - 1.4], UNDER);
    p.box([0, 2.05, 0], [W, 2.3, L], paint);
    p.box([0, 1.95, 0], [W + .03, .16, L + .03], CREAM);
    for (const x of [-1, 1]) p.box([x * (W / 2 + .01), 2.62, 0], [.04, .92, L - 1.8], GLASS);
    for (const z of [-1, 1]) {
      p.box([0, 2.62, z * (L / 2 + .01)], [W - .5, .98, .04], GLASS);
      p.box([0, 3.02, z * (L / 2 + .02)], [1.1, .2, .04], DARK);
      for (const x of [-.8, .8]) p.box([x, 1.2, z * (L / 2 + .02)], [.26, .14, .04], LAMP);
    }
    for (const z of [-L / 4, L / 4]) p.box([W / 2 + .02, 1.98, z], [.04, 2.06, 1.3], '#3b4a4f');
    p.box([0, 3.28, 0], [W - .34, .16, L - .9], '#cfcac0');
    // The pantograph: a frame on the roof, arms up to a bar across under the wire
    p.box([0, 3.42, 0], [.9, .12, 1.3], DARK);
    p.beam([0, 3.46, -.55], [0, 4.22, .05], .035, DARK, 4);
    p.beam([0, 4.22, .05], [0, 3.62, .5], .035, DARK, 4);
    p.box([0, 4.25, .05], [1.5, .05, .1], DARK);
    return p.finish();
  });
}

// A railway carriage, 17 m, with its gangway at each end and doors by them
export const CARRIAGE_LENGTH = 17;
export function carriage(paint) {
  return made(`carriage-${paint}`, () => {
    const p = new Parts(), L = CARRIAGE_LENGTH, W = 2.8;
    for (const z of [-L / 2 + 3, L / 2 - 3]) p.box([0, .45, z], [2.1, .7, 2.7], UNDER);
    p.box([0, 1.02, 0], [W - .3, .44, L - 2], UNDER);
    p.box([0, 2.5, 0], [W, 2.55, L], paint);
    p.box([0, 1.34, 0], [W + .03, .14, L + .03], CREAM);
    for (const x of [-1, 1]) {
      p.box([x * (W / 2 + .01), 2.78, 0], [.04, .86, L - 4.6], GLASS);
      for (const z of [-1, 1]) p.box([x * (W / 2 + .02), 2.35, z * (L / 2 - 1.2)], [.04, 2.05, .95], '#3a3f40');
    }
    p.box([0, 3.88, 0], [W - .2, .22, L - .2], '#8d9291');
    for (const z of [-1, 1]) p.box([0, 2.4, z * (L / 2 + .12)], [1.25, 2.2, .26], DARK);
    return p.finish();
  });
}
