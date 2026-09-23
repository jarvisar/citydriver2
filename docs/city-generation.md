# City generation

The city is generated once per visit from the URL seed (`?seed=4817`) by a
plain JavaScript port of [MapGenerator](https://github.com/ProbableTrain/MapGenerator)
in `src/mapgen/`, and turned into the world the car drives in by `src/world/`.

## Pipeline

1. **Tensor field.** Four grid fields around the middle of the domain and one
   radial field, with random sizes, decays and angles. The radial field's
   centre is downtown: buildings get taller toward it.
2. **Water.** A coastline and a river are integrated through the field with
   rotational noise, then the river is widened into a channel with a road on
   each bank and a promenade road along the coast.
3. **Roads.** Main, major and minor roads are streamlines of the field's major
   and minor eigenvectors, kept apart by separation distances (`dsep`,
   `dtest`) and joined to their neighbours where they dangle. Minor roads
   inside parks wind with extra noise and become park paths.
4. **Blocks and lots.** The simplified roads form a planar graph; its faces are
   the blocks. Each block is shrunk by the width of its streets plus a
   sidewalk, then split across its longest side until the pieces are lots of
   700–1400 m².
5. **Parks.** Two big faces of the main and major road graph and three minor
   blocks.

Everything runs in metres on a 2400 × 1800 m domain and takes about a quarter
of a second. `node scripts/city-map-svg.mjs 4817 city.svg` draws a city as an
SVG for checking the generator without the game.

## World

`src/world/city.js` derives what the game needs: land pieces around the water,
a 4 m water mask for the tyres, quay walls, districts and the starting street.
`city-route.js` is the route the vehicle drives: heights, looseness and water
come from the nearest road and the mask, so the physics code is unchanged.

`citydriver-world.js` builds a static layer once (ground, roads with
markings and medians, kerbed sidewalks, lawns, lot slabs, water, quays,
bridge decks and piers) and streams chunks of 160 m as the car moves. Each
chunk holds the buildings on its lots, lamps, trees, benches and railings,
with the same batching, colliders and lamp records as citydriver's blocks.
Chunks outside the detail radius show a distant version of the same
buildings.

Buildings are citydriver's own facades and roofs, fitted to the largest
rectangle inside each lot (`fitRectangle` in `city-buildings.js`) and turned
with it. Lots with no room for a building become gardens. Styles follow the
district; footprint size and distance from downtown choose the type.

`nav-graph.js` turns the road graph into edges between junctions, which the
traffic, autodrive, taxi pickups and destinations and the map route use.
