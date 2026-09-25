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
- Two quirks are fixed. Basis fields add as weighted (the original doubled
  everything before each new field, so the first of five weighed sixteen
  times the last). The Runge-Kutta step samples along the way the streamline
  is going, each sample turned to agree with the first (the original sampled
  at a fixed diagonal offset and added the samples whichever way they faced).
- Works in metres on a fixed domain rather than screen pixels with a zoom.
- `jsts`, `isect`, `polyk`, `d3-quadtree`, `simplify-js` and `simplex-noise`
  are replaced by the small implementations in `polygon-util.js`, `graph.js`,
  `simplify.js` and `simplex-noise.js`.
- No drawing, GUI or export code. Each generator runs synchronously.
- Block edges shrink by the width of the road each one runs along, which the
  road graph records, so lots sit back from wide avenues further than from
  side streets.
- The city is a patchwork of neighbourhoods a few blocks across, each with a
  style (`districts` option, `layNeighbourhoods`), and rotational noise can
  be given to one style's neighbourhoods rather than the whole domain
  (`districtNoise`, each with a `share(point)`), so an old town's streets
  wind while the rest keep their grids.
- Near the ring road the field turns to run along it or meet it square
  (`alignWith`), and for the minor roads the ring is an existing streamline of
  the family running along it, as MapGenerator treats its coast.
- A streamline that closes on itself is cut back past the join and closed
  straight across, so its two fronts never leave a hook (`closeLoop`).
- Bends are rounded into arcs, a ring road closes the city, and the network is
  cleaned before blocks are found: overshoots trimmed, dead ends joined to the
  next street or removed, orphans dropped (`road-network.js`).
- Faces are not limited to twenty vertices, so curved blocks are kept.
- Blocks are platted into a strip of street-front lots round a shared yard
  (`lots.js`), with MapGenerator's subdivision kept for blocks too thin for a
  strip.
- The river's banks and channel are offsets of one smoothed centre line, and
  its bank roads meet the coast road.
- The city is an island (`shore.js`) ending at a promenade outside its ring
  road: land, river and sea are polygon booleans (`booleans.js`, with
  Clipper) over the island's outline, the harbour and the river's channel,
  so they tile the world exactly.
- Two roads meeting end to end at an angle are joined at the nearby junction
  or rounded.
- Every road takes a street profile with a rank, the longest avenues are
  promoted to boulevards, long side streets between the avenues become
  collectors, and the other side streets follow their district
  (`road-hierarchy.js`).
- A park is laid out rather than grown from streamlines: gates on its
  streets, a loop walk and walks to a plaza or a pond (`park-paths.js`).
- A block whose kerb reaches onto a carriageway has the carriageway cut out
  of it rather than being dropped.
- A face is dry land if a point well inside it is, not its centroid.

This directory is distributed under the GNU Lesser General Public License
version 3, like the original. See `COPYING` and `COPYING.LESSER`.
