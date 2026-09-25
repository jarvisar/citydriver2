# City Map Generator

JavaScript port of the road, water, block and lot generation from [MapGenerator](https://github.com/ProbableTrain/MapGenerator) by Keir (ProbableTrain) and contributors. It is based on the paper *Interactive Procedural Street Modeling*.

A tensor field made of grid and radial fields is traced into streamlines, which become the main, major and minor roads. The coastline and river are traced the same way with added noise. The roads form a graph, the faces of the graph become blocks, and the blocks are split into lots.

## Changes from the Original

- Every `Math.random` call uses a seeded generator, so `?seed=` loads the same city.
- Two bugs are fixed. Basis fields now add by their weights (the original doubled everything before adding each new field, so the first of five weighed sixteen times the last). The Runge-Kutta step now samples along the direction the streamline is going and turns each sample to match the first (the original sampled at a fixed diagonal offset).
- Works in metres on a fixed area instead of screen pixels with a zoom.
- `jsts`, `isect`, `polyk`, `d3-quadtree`, `simplify-js` and `simplex-noise` are replaced by smaller versions in `polygon-util.js`, `graph.js`, `simplify.js` and `simplex-noise.js`.
- No drawing, GUI or export code. Each generator runs synchronously.
- Each block edge is set back by the width of its road, so lots sit further back from wide avenues than from side streets.
- The city has one district of each style, grown from seeds spread over the land so each district is one piece (`districts` option, `layDistricts`). Rotational noise can be limited to one district (`districtNoise`), so the old town's streets curve while the rest keep their grids.
- Near the ring road, the field turns to run along it or meet it square (`alignWith`). For minor roads, the ring counts as an existing streamline, the same way MapGenerator treats its coast.
- A streamline that loops back on itself is cut back past the join and closed with a straight line (`closeLoop`).
- Bends are rounded into arcs, a ring road closes off the city, and the network is cleaned up before blocks are found: overshoots are trimmed, dead ends are joined to the next street or removed, and disconnected roads are dropped (`road-network.js`).
- Faces aren't limited to twenty vertices, so curved blocks are kept.
- Blocks are split into a strip of lots facing the street with a shared yard behind (`lots.js`). MapGenerator's subdivision is still used for blocks too thin for a strip.
- The river's banks and channel are offsets of one smoothed centre line, and the bank roads meet the coast road.
- If a coast would leave more than `water.seaMax` of the area to the sea, it is generated again.
- The city is an island (`shore.js`) with a promenade outside its ring road. Land, river and sea are polygon booleans (`booleans.js`, using Clipper), so they fit together exactly.
- Two roads meeting end to end at an angle are joined at a nearby junction or rounded.
- Every road gets a street profile with a rank. The longest avenues become boulevards, long side streets between the avenues become collectors, and the other side streets depend on their district (`road-hierarchy.js`).
- Parks are laid out with gates, a loop walk and walks to a plaza or pond (`park-paths.js`) instead of being filled with streamlines.
- If a block's kerb overlaps a carriageway, the carriageway is cut out of the block instead of the whole block being dropped.
- A face counts as land if a point well inside it is on land, instead of checking its centroid.

## License

This directory is licensed under the GNU Lesser General Public License v3, like the original. See `COPYING` and `COPYING.LESSER`.
