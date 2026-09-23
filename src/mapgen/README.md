# City map generator

Plain JavaScript port of the road, water, block and lot generation from
[MapGenerator](https://github.com/ProbableTrain/MapGenerator) by Keir
(ProbableTrain) and contributors. The algorithm follows the paper
*Interactive Procedural Street Modeling*: a tensor field made of grid and
radial basis fields is integrated into streamlines that become the main, major
and minor roads; a coastline and a river are integrated the same way with
rotational noise; a planar graph of the roads yields blocks, which are shrunk
and subdivided into lots.

Changes from the original TypeScript:

- Every `Math.random` call takes a seeded generator, so `?seed=` reproduces a city.
- Works in metres on a fixed domain rather than screen pixels with a zoom.
- `jsts`, `isect`, `polyk`, `d3-quadtree`, `simplify-js` and `simplex-noise`
  are replaced by the small implementations in `polygon-util.js`, `graph.js`,
  `simplify.js` and `simplex-noise.js`.
- No drawing, GUI or export code. Each generator runs synchronously.
- Block edges can shrink by a different amount per edge, so lots sit back from
  wide avenues further than from side streets.

This directory is distributed under the GNU Lesser General Public License
version 3, like the original. See `COPYING` and `COPYING.LESSER`.
