# City generation

The city is generated once per visit from the URL seed (`?seed=4817`) by a
plain JavaScript port of [MapGenerator](https://github.com/ProbableTrain/MapGenerator)
in `src/mapgen/`, and turned into the world the car drives in by `src/world/`.
Everything runs in metres on a 2400 × 1800 m domain, x east and y north, and
takes a few hundred milliseconds. The city is an island: the domain is ringed
by country and beaches, and the sea runs on past the fog.

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
   round the field's degenerate points) into a curve. `easePathEnds` slides a
   park path's entrance along its street until it is clear of the street's
   junctions, or where the street is too short cuts the path back to where it
   last crosses another path, so a path never splits an approach into a
   sliver. The result is one connected network whose only loose ends are the
   sub-metre overshoots at T-junctions.
5. **Shore** (`shore.js`). The island's outline is the ring road pushed out
   60–300 m in bays and headlands, closing in on the ring near the harbour so
   the two coasts meet cleanly. Land is that outline less the harbour (the sea
   side of the coast road's promenade) and less the river's channel, carried
   on until it is out at sea at both ends; sharp needles of land are blunted.
   The sea and the river are whatever the land is not. These are polygon
   booleans in whole millimetres (`booleans.js`, with
   [Clipper](https://www.angusj.com/delphi/clipper.php)), so land, river and
   sea tile the world exactly, whatever shapes the generator draws.
6. **Parks.** One big park is a face of the main, major, ring and water roads,
   chosen near 110,000 m² before the minor roads, so the minor roads through
   it wind with park noise and become its paths. A path is split from its
   street exactly where it crosses the park edge. Four small parks
   ("squares") are finished blocks, chosen well apart once the network is
   final, so every park is a face of the network it sits in.
7. **Blocks.** The faces of the cleaned graph; a face is dry land if a point
   well inside it is (a U-shaped face's centroid can lie outside it). Each
   face edge is set back by the width of the road it actually runs along (the
   graph knows which road each edge belongs to), giving the block's kerb line
   and, a pavement further in, its inner edge. Acute corners of the inner
   edge are cut off as small plazas (`chamferAcute`), so stepping the block
   in never throws a corner far away. Where stepping in would fold the
   outline over (a waist narrower than the step), the block less a strip
   along each edge is taken instead (`insetPolygon`), so a block never loses
   its kerb or its lots to its own shape.
8. **Lots** (`lots.js`). A strip of lots one plot deep all round each block,
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
   generator checks its own output: a block whose kerb would reach onto a
   carriageway (a sliver between two roads meeting at a shallow angle) is left
   as verge, and a lot that comes closer to a road than its pavement is
   dropped.

`node scripts/city-map-svg.mjs 4817 city.svg` draws a city as an SVG, with
the yards, for checking the generator without the game.

## World (`src/world/`)

`city.js` derives the surfaces the game stands on, once, so the renderer, the
tyres and the street furniture agree:

- the land, the sea and the river from the generator's shore, a 4 m water
  mask for the tyres filled from the same land, and the shores between them:
  quay walls where the city meets the water, beaches on the open sea and
  grassy banks where the river runs through the country, each run with its
  water on its right;
- the **kerbs**: every block's pavement edge with its junction corners rounded
  to 5.5 m, and the slivers of carriageway the rounding hands back to the
  junction;
- quays along the waterside roads and a pavement along the outside of the
  ring road, each cut wherever another road crosses it and kept off every
  carriageway;
- a spatial index of all of these, so `surfaceAt(s, u)` in `city-route.js`
  answers `pavement`, `road` or `water` from exactly what is drawn;
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
traffic leaves its lane there. A street shorter than 24 m between two
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

`city-streets.js` builds the static layer (the country, carriageways with
their rounded corners, markings, crosswalks and stop lines, pavements and
kerbs, parks and squares, the ground inside each block and its yard, quays,
water, walls and bridges) and places the street furniture once: signals and
stop signs, lamps and trees round every kerb clear of the junctions, bus
shelters on the main roads, bins, railings on the quays and bridges, the
hedge round the city, park trees and benches, a fountain in each square and a
sign at every venue. The country beyond the ring road is a patchwork of
fields with hedgerows and copses of woodland, with meadows between them where
the road looks out to sea. Props are turned with the helpers
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
blank. In the garden quarter a house on a wedge-shaped corner lot is a plain
rectangle square to its street. Heights follow the block (a street wall of
similar storeys) and rise toward downtown, with the odd tower above them.

The places a passenger asks for are landmarks (`city-landmarks.js`): a civic
hall with a portico and a dome or a clock tower, a hotel tower, a vaulted
station or market shed, a cinema's lit marquee, an observatory, a club's
courts, a firehouse, a diner with a giant donut, or an open square with a clock
tower or a sculpture. Each is fitted to its lot square to its main street
(`landmark-site.js`) with the venue's sign across its front, and the drop-off
is in the kerbside lane of the street it faces.

## Checking a city

- `npm test` includes the network, shore, lot, junction, furniture, building
  and traffic invariants; `TEST_WORLD_SEED=42 npm test` runs the whole suite
  against another city.
- `node scripts/city-map-svg.mjs <seed> city.svg` draws the plan.
- `node scripts/city-tour.mjs <seed>` takes screenshots round the city.
- `node scripts/world-stats.mjs` builds the world in Node and reports what it
  draws.
