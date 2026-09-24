# City generation

The city is generated once per visit from the URL seed (`?seed=4817`) by a
plain JavaScript port of [MapGenerator](https://github.com/ProbableTrain/MapGenerator)
in `src/mapgen/`, and turned into the world the car drives in by `src/world/`.
Everything runs in metres on a 2400 × 1800 m domain, x east and y north, and
takes a few hundred milliseconds. The city is an island with a harbour's edge
all round: a promenade and a quay wall outside the ring road and the coast
road, and the sea running on past the fog.

MapGenerator's output is a sketch of a street network: streamline ends stop
wherever the separation test or the domain edge stopped them, and its blocks
and lots are faces of whatever graph that sketch makes. The game needs more
than a sketch. Every later stage (kerbs, lots, junction markings, traffic)
assumes a closed network with no dangling roads, so the pipeline below cleans
the network first and derives everything else from it, once, in one place.

## Pipeline (`src/mapgen/`)

1. **Tensor field.** Four grid fields around the middle of the domain and one
   radial field, with random sizes, decays and angles. The radial field's
   centre is downtown. Each grid field is also a neighbourhood: a block
   belongs to the grid that weighs most at its centre (`districtAt`).
2. **Water.** A coastline and a river are integrated through the field with
   rotational noise. The river is one smoothed centre line
   (`water.riverCentre`), cut to its longest run on land if the stream wanders
   out to sea and back: its channel, the bank roads either side and the
   water the game draws are all offsets of it, so the quays are the same width
   all along. Bank roads stop exactly on the coast road and meet it.
3. **Roads.** Main, major and minor roads are streamlines of the field's major
   and minor eigenvectors, kept apart by `dsep` and `dtest`, as in
   MapGenerator. After simplification every bend is rounded into a circular
   arc (`filletPolyline`, up to 80 m for main roads and 35 m for minor ones),
   so roads bend rather than kink.
4. **Ring road and cleanup** (`road-network.js`). A rounded ring road inset
   from the domain edge closes every outer block; streets are clipped to it and
   it stops at the sea. `cleanNetwork` trims the overshoot MapGenerator leaves
   past a joined road and undoes the ways a streamline can meet a road badly:
   a stretch that runs alongside another road inside its carriageway is cut
   out of the lesser road, as is a sliver between two crossings a few metres
   apart; an end that joins at a shallow angle is cut back to its previous
   junction; and the swerve a streamline makes in its last few metres to join
   a road is cut off. It then carries each dead end on to the next street
   (snapping to a nearby junction) or cuts it back, and drops orphans.
   `pruneNetwork` then walks the finished graph from every dead end back to
   its junction and removes the chain, however many end-to-end roads it
   spans, and drops small disconnected islands. `joinCorners` then deals with
   two roads that meet end to end at an angle, a corner no junction rounds: a
   dog-leg a few metres from a junction is removed and the other road carried
   on to the junction, and any other corner is rounded into a curve.
   `easeKinks` eases a kink between junctions (where streamlines turn sharply
   round the field's degenerate points) into a curve. The result is one
   connected network whose only loose ends are the sub-metre overshoots at
   T-junctions.
5. **Street profiles** (`road-hierarchy.js`). Every road takes its class's
   profile, and some take more. The longest avenues through the middle of
   town are promoted to boulevards until the city has 2.2 km of them, so
   every seed has some however its field fell. The ring road is a parkway.
   Side streets follow their district: narrow lanes in the old town, parking
   bays where the houses have gardens, the warehouses have vans or downtown
   has shoppers, and plain two-lane streets elsewhere.

   | Profile | Where | Width | Lanes |
   | --- | --- | ---: | --- |
   | Boulevard | main roads, promoted avenues | 24 m | two each way, planted median with trees and lamps |
   | Parkway | ring road | 22 m | two each way, grass median |
   | Avenue | major, coast | 18 m | one each way, dashed centre line |
   | Riverbank | bank roads | 16 m | one each way, dashed centre line |
   | Parking street | garden quarter, warehouses, midtown | 15.6 m | one each way, parking bays both sides |
   | Side street | market and civic quarters | 13 m | one each way |
   | Lane | old town | 10.4 m | one each way |
   | Park walk | parks | 7.2 m | |
6. **Shore** (`shore.js`). The island's outline is the outer edge of the
   promenade outside the ring road. Land is that outline less the harbour
   (the sea side of the coast road's promenade) and less the river's channel,
   carried on until it is out at sea at both ends; sharp needles of land are
   blunted.
   The sea and the river are whatever the land is not. These are polygon
   booleans in whole millimetres (`booleans.js`, with
   [Clipper](https://www.angusj.com/delphi/clipper.php)), so land, river and
   sea tile the world exactly, whatever shapes the generator draws.
7. **Parks** (`park-paths.js`). One big park is a face of the main, major,
   ring and water roads, chosen near 110,000 m² before the minor roads, which
   stop at its edge. Once the streets are final the park is laid out as a
   park is: gates in the middle of its street frontages, clear of junctions
   and of its corners; a loop walk a little in from its edge, gently
   wobbled and rounded; and walks from each gate across the lawn to a round
   plaza at its heart, or, in a big park, round a pond. Every walk joins the
   loop, the plaza and a street, so the walks have no dead end, and they are
   part of the network (a car can drive them). Four small parks ("squares")
   are finished blocks, chosen well apart once the network is final, so
   every park is a face of the network it sits in.
8. **Blocks.** The faces of the cleaned graph; a face is dry land if a point
   well inside it is (a U-shaped face's centroid can lie outside it). Each
   face edge is set back by the width of the road it actually runs along (the
   graph knows which road each edge belongs to), giving the block's kerb line
   and, a pavement further in, its inner edge. Acute corners of the inner
   edge are cut off as small plazas (`chamferAcute`), so stepping the block
   in never throws a corner far away. Where stepping in would fold the
   outline over (a waist narrower than the step), the block less a strip
   along each edge is taken instead (`insetPolygon`), so a block never loses
   its kerb or its lots to its own shape.
9. **Lots** (`lots.js`). A strip of lots one plot deep all round each block,
   each fronting the street, with a shared yard behind: the band between the
   block's inner edge and that edge stepped in by the lot depth is cut along
   rulings that run square to the street and fan only at corners, so the lots
   tile the block exactly and corner lots wrap their corners. Every lot knows
   the kind of each edge: `street`, `side` (a neighbour) or `rear` (the yard).
   Each district plats its blocks its own way (`LOT_STYLES` in
   `world/city.js`: narrow deep plots in the old town, wide ones in the
   warehouse district and downtown). A yard only a few metres across is
   folded into the lots; a block too thin for a strip is cut across instead,
   and one block in twenty-five stays whole for a hall or a works. The
   generator checks its own output: where a block's kerb would reach onto a
   carriageway (two roads meeting at a shallow angle, or a road carried a few
   metres past a junction), the carriageways are cut out of the block and the
   rest of it kept; only a sliver with little left is left as verge. A lot
   that comes closer to a road than its pavement is dropped. A carriageway
   ends square across its road's ends (`carriagewayScore`), so a wide road
   ending at a T-junction does not reach into the block across it.

`node scripts/city-map-svg.mjs 4817 city.svg` draws a city as an SVG, with
the yards, medians, plazas and ponds, for checking the generator without the
game.

## World (`src/world/`)

`city.js` derives the surfaces the game stands on, once, so the renderer, the
tyres and the street furniture agree:

- the land, the sea and the river from the generator's shore, a 4 m water
  mask for the tyres filled from the same land, and the quay walls between
  them, each run with its water on its right;
- the **kerbs**: every block's pavement edge with its junction corners rounded
  to 5.5 m, and the slivers of carriageway the rounding hands back to the
  junction;
- promenades along the waterside roads and outside the ring road, each cut
  wherever another road crosses it and kept off every carriageway;
- a spatial index of all of these, so `surfaceAt(s, u)` in `city-route.js`
  answers `pavement`, `median`, `road` or `water` from exactly what is
  drawn;
- the districts: each grid neighbourhood takes one of the old town, garden
  quarter, warehouse district, market district or civic quarter per seed, and
  the radial field is Midtown. The HUD names the waterfront Harbour or
  Riverfront.

`nav-graph.js` turns the road graph into edges between junctions (merging
junctions under 5 m apart into one) for the traffic, the autodrive, the taxi
and the map route. `junction-geometry.js` gives each junction's approaches
their clearance: where the road leaves the junction box, from the kerb corners
it shares with its neighbours round the node. The crosswalk starts there, the
stop line and the sign or signal stand behind it on the approach's own
right-hand pavement, markings and medians stop short of it, and turning
traffic leaves its lane there. Where two wide roads cross, the junction runs
a signal cycle, and on an approach 16 m wide or more the signal hangs from a
mast arm, a head over each lane. A street shorter than 24 m between two
junctions is the middle of one junction complex: it has no crosswalk or stop
of its own, and traffic crosses it in one turn.

`lane-paths.js` is how a car gets from one street to the next: a circular arc
tangent to both lanes, as wide as the junction allows. The arc's apex keeps a
car's half-width clear of the rounded kerb on the inside of the turn, and when
a street bends as it arrives the widest candidate that stays on the
carriageway is used. Cars choose their way on when they join a street and
brake so they enter each turn at its own speed (a comfortable 2.8 m/s²
sideways), and slow in the same way for the street's own bends; they avoid
hairpins when there is another way on. The autodrive follows the same curves.

`city-medians.js` lays out the raised medians down the boulevards and the
parkway, one per street between its junctions with rounded noses short of
the crosswalks; the renderer draws them, the furniture plants them and the
tyres ride up onto them from the same shapes. `city-parks.js` gives each park
its plaza or pond and lays out each square: walks in from its corners and
long sides to a paved circle round a fountain.

`city-streets.js` builds the static layer (carriageways with their rounded
corners, markings, medians, parking bays, crosswalks and stop lines, a zebra
at each park gate, pavements and kerbs, parks and squares with their plazas,
walks and ponds, the ground inside each block and its yard, promenades,
water, quay walls and bridges) and places the street furniture once: signals
and stop signs, lamps and trees round every kerb clear of the junctions,
trees and double-armed lamps down the boulevards' medians, bus shelters on
the main roads, bins, parked cars in two bays in five, railings on the quays
and bridges, and in the parks a fountain or a bandstand on the plaza,
lanterns and benches along the walks, an avenue of trees round the loop,
groves over the lawns, and a few trees in the back yards where the houses
have gardens. A sign stands at every venue. Props are turned with the helpers
in `city-layout-render.js` (`faceYaw`, `alongYaw`, `itemFrame`), one
convention for every item and its collider.

`citydriver-world.js` streams chunks of 160 m as the car moves. Each chunk
holds the buildings on its lots and the furniture in it, with the same
batching, colliders and lamp records as citydriver's blocks; chunks outside the
detail radius show a distant version of the same buildings.

## Buildings

Buildings follow their lots (`city-buildings.js`). The footprint is the lot
stepped in edge by edge: a small step from the pavement in front, a party
wall or a garden gap at the sides by district, and a yard behind so the
building is only as deep as its kind of building is. Each wall knows whether it
faces the street, a neighbour or the yard: shopfronts, doors and windows go on
the street, windows on the yard when there is room behind, and party walls are
blank.

Awkward lots do not make awkward buildings. A terrace or block is massed as
wings a building's depth deep along each of its streets, as real buildings
are: a fan-shaped lot keeps its front and leaves its tail as yard, a corner
lot becomes an L, and a corner still sharper than 70° gets a blunt corner
facade, a flatiron's nose, rather than a knife edge. In the garden quarter a
house on a wedge-shaped lot is a plain rectangle square to its street, and a
lot too small for one is a garden. Heights follow the block (a street wall of
similar storeys) and rise toward downtown, with the odd tower above them.

The places a passenger asks for are landmarks (`city-landmarks.js`): a civic
hall with a portico and a dome or a clock tower, a hotel tower, a vaulted
station or market shed, a cinema's lit marquee, an observatory, a club's
courts, a firehouse, a diner with a giant donut, or an open square with a clock
tower or a sculpture. Each is fitted to its lot square to its main street
(`landmark-site.js`) with the venue's sign across its front, and the drop-off
is in the kerbside lane of the street it faces.

## Checking a city

- `npm test` includes the network, street profile, park layout, shore, lot,
  junction, furniture, building and traffic invariants;
  `TEST_WORLD_SEED=42 npm test` runs the whole suite against another city.
- `node scripts/city-map-svg.mjs <seed> city.svg` draws the plan.
- `node scripts/city-tour.mjs <seed>` takes screenshots round the city.
- `node scripts/world-stats.mjs` builds the world in Node and reports what it
  draws.
