# City generation

The city is generated once per visit from the URL seed (`?seed=4817`) by a
plain JavaScript port of [MapGenerator](https://github.com/ProbableTrain/MapGenerator)
in `src/mapgen/`, and turned into the world the car drives in by `src/world/`.
Everything runs in metres on a 2880 × 2160 m domain, x east and y north, and
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
   radial field, with random sizes, decays and angles: MapGenerator's
   recommended field. The radial field's centre is downtown.

   The city has one district of each kind, each a single piece of it
   (`layDistricts`). They are grown on a 16 m raster of the land: Midtown
   from downtown, the other five from seeds spread as far apart (and from the
   water) as the land allows, all at once, each cell going to the district
   that reaches it first, so each district is one piece. Each grows at its
   own pace (so they differ in size, the biggest about a third of the city
   and the smallest a tenth), slower one way than the other (so some are
   long), through noise of its own (so the borders wander), and hardly across
   water, so the river is usually a border. The styles take the seeds they
   suit best, with a little chance (`prefer` in `city.js`): the old town and
   the civic quarter by downtown, the warehouses by the water, the garden
   quarter out where it's quiet. `districtAt` looks a point up on the raster
   through a small warp. The districts have their own random numbers, so the
   streets don't depend on them. (They were once the four grid fields, the
   one weighing most at a point, but with random sizes and decays one grid
   outweighs the rest nearly everywhere and the whole city was one or two
   districts; then a patchwork of small neighbourhoods, which repeated every
   style all over the city.)

   Two things are added to MapGenerator's field. The old town's streets wind:
   MapGenerator's rotational noise (30° over about 300 m) is applied only in
   the old town, fading over a street or so at its border (`districtNoise`),
   so its lanes curve while the rest of the city keeps its grids. And near the ring road the field
   turns to run along it or meet it square, fully at the ring and less so out
   to 300 m (`alignWith`), as MapGenerator's author advises for a waterfront;
   otherwise a grid at an angle to the edge meets the ring in a row of sharp
   corners and leftover wedges. A grid at 45° to the ring could turn either
   way, so the turn fades out as the angle nears 45° rather than meeting the
   other way in a seam, and downtown's rings keep their shape.

   Two quirks of MapGenerator's own are fixed. Its blend of basis fields
   doubled everything added before each new field (the first of five weighed
   sixteen times the last); the fields now add as weighted. And its
   Runge-Kutta step sampled the field at a fixed diagonal offset from the
   point, whatever the way ahead, and added the samples whichever way each
   eigenvector happened to face, so steps shrank and drifted wherever the
   field turned; the samples now lie along the way the streamline is going
   and are turned to agree.
2. **Water.** A coastline and a river are integrated through the field with
   rotational noise. The river is one smoothed centre line
   (`water.riverCentre`), cut to its longest run on land if the stream wanders
   out to sea and back: its channel, the bank roads either side and the
   water the game draws are all offsets of it, so the quays are the same width
   all along. Bank roads stop exactly on the coast road and meet it. A river
   that runs along the edge of the city, beside the ring road, would leave
   the ring on a causeway two roads wide between river and sea, so it is
   rejected and another tried (`alongEdge`).
3. **Roads.** Main, major and minor roads are streamlines of the field's major
   and minor eigenvectors, kept apart by `dsep` and `dtest`, as in
   MapGenerator. For the side streets the ring road is an existing
   streamline of whichever family runs along it there, as MapGenerator keeps
   its coast, so a street beside the ring stays a street's spacing from it
   rather than leaving a strip too thin to build on. (The avenues keep their
   own spacing, which the ring would crowd out.) After simplification every
   bend is rounded into a circular arc (`filletPolyline`, up to 80 m for main
   roads and 35 m for minor ones), so roads bend rather than kink. A
   streamline that closes on itself joins its two ends wherever they met,
   which can be out of line, so the loop is cut back past the join and closed
   straight across before it is rounded (`closeLoop`).
4. **Ring road and cleanup** (`road-network.js`). A rounded ring road inset
   from the domain edge closes every outer block; streets are clipped to it and
   it stops at the sea, as one road from coast to coast. Where the ring and a
   waterside road were each clipped by the other's line their ends can miss by
   a hair, so `weldEnds` joins them (or carries a bank road that stops short
   on to the ring). A loop a streamline winds round the field's degenerate
   point (the middle of downtown) too small for a block becomes a circus
   (`circuses`): a round street at least 40 m across with a garden in the
   middle, every street that came inside it ending on it. `cleanNetwork`
   trims the overshoot MapGenerator leaves past a joined road and undoes the
   ways a streamline can meet a road badly: a stretch that runs alongside
   another road inside its carriageway, or within a pavement's width of its
   kerb where no block could stand between them, is cut out of the lesser road
   (and not carried back beside it), as is a sliver between two crossings a
   few metres apart; an end that joins at a shallow angle is cut back to its previous
   junction; and the swerve a streamline makes in its last few metres to join
   a road is cut off. It then carries each dead end on to the next street
   (snapping to a nearby junction) or cuts it back, and drops orphans.
   `spreadJunctions` then deals with two streets that stop on the same road
   a few metres apart, a knot of junctions no kerb can round: converging from
   the same side, the lesser gives way at its last junction; from opposite
   sides, a crossroads drawn out of true, its last stretch swings onto the
   other's junction; and a street stopping just short of a crossing swings
   onto it. `pruneNetwork` then walks the finished graph from every dead end back to
   its junction and removes the chain, however many end-to-end roads it
   spans, and drops small disconnected islands. `joinCorners` then deals with
   two roads that meet end to end at an angle, a corner no junction rounds: a
   dog-leg a few metres from a junction is removed and the other road's last
   stretch bent on to the junction, and any other corner is rounded into a
   curve. `easeKinks` eases a kink between junctions (where streamlines turn
   sharply round the field's degenerate points) into a curve. Last,
   `infillStreets` (`infill.js`) gives any block much wider than the
   streamlines' spacing (where they fanned out or one stopped short, leaving
   a yard the size of a park) the street they missed: traced along the field
   from its deepest point, meeting the streets either side square and clear
   of their junctions (or on a junction across the road, as a crossroads),
   and splitting the block as evenly as it can. The result is one
   connected network whose only loose ends are the sub-metre overshoots at
   T-junctions.
5. **Street profiles** (`road-hierarchy.js`). Every road takes its class's
   profile, and some take more. The longest avenues through the middle of
   town are promoted to boulevards until the city has 2.7 km of them (less
   for a smaller domain), so every seed has some however its field fell. The
   ring road is a parkway. Among the side streets, the collectors carry a
   neighbourhood's traffic through it: the longest side streets that run
   mostly more than 210 m from any avenue or other collector alongside them,
   so they fall between the avenues wherever those leave a neighbourhood
   without a through road (about one side street in ten). The rest follow
   their district: narrow lanes in the old town, parking bays where the
   houses have gardens, the warehouses have vans or downtown has shoppers,
   and plain two-lane streets elsewhere. Each profile has a rank, which
   decides who gives way at a junction, and its markings follow it: lanes
   down a boulevard, a double centre line down an avenue, a dashed one down
   a collector, and a local street or lane left plain.

   | Profile | Rank | Where | Width | Lanes |
   | --- | ---: | --- | ---: | --- |
   | Boulevard | 4 | main roads, promoted avenues | 24 m | two each way, planted median with trees and lamps |
   | Parkway | 4 | ring road | 22 m | two each way, grass median |
   | Avenue | 3 | major, coast | 18 m | one each way, double centre line |
   | Riverbank | 3 | bank roads | 16 m | one each way, double centre line |
   | Collector | 2 | long side streets between the avenues | 14.4 m (17.2 m with bays) | one each way, dashed centre line (parking bays where the district parks) |
   | Parking street | 1 | garden quarter, warehouses, midtown | 15.6 m | one each way, parking bays both sides |
   | Side street | 1 | market and civic quarters | 13 m | one each way |
   | Lane | 0 | old town | 10.4 m | one each way |
   | Park walk | | parks | 7.2 m | |
6. **Shore** (`shore.js`). The island's outline is the outer edge of the
   promenade outside the ring road. Land is that outline less the harbour
   (the sea side of the coast road's promenade) and less the river's channel,
   carried on until it is out at sea at both ends; sharp needles of land are
   blunted, and a sliver of land or a puddle of water that the booleans leave
   where two shores all but touch is dropped. The city stands on its blocks and its roads with their
   promenades: bare land on the shore beyond them (the tip past where the ring
   and the coast road round a corner) is sea.
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
   part of the network (a car can drive them). Since the streets round the
   park can move in the cleanup, the park is taken again as the face of the
   finished streets its middle is in. Six small parks ("squares") are
   finished blocks, chosen well apart once the network is final, and each
   circus has a garden in the middle, so every park is a face of the network
   it sits in.
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
   folded into the lots; a block too thin for a strip, or whose stepped-in
   yard would shoot out past a sharp corner, is cut across instead
   (keeping only the lots on its streets: the middle of a big, winding block
   is its yard), and one block in twenty-five stays whole for a hall or a
   works. The
   generator checks its own output: where a block's kerb would reach onto a
   carriageway (two roads meeting at a shallow angle, a road carried a few
   metres past a junction, or the square end of a wide road carrying on
   round a bend as a narrower one), the carriageways and the joints between
   them are cut out of the block and the rest of it kept; only a sliver with
   little left is left as verge. A lot
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
  wherever another road crosses it (a street ending on the road leaves it
  whole) and kept off every carriageway, in pieces of a few lamps' spacing
  so a lookup never tests a promenade the length of the city; where the ring
  and the coast road meet end to end, the carriageway and the promenade are
  patched across the joint (`endJoints`); and whatever land is still bare
  once the blocks, parks, carriageways and promenades are laid (where a
  promenade stops short of a road crossing it, at a bridge's end, or cuts a
  corner round a bend) is paved as waterfront, so every pavement meets a kerb,
  and a sliver inland (where two roads meet end to end at an angle) is road.
  A scrap of bare land only becomes road where it lies against a road (never
  a strip along the water's edge), and a hairline scrap, where two outlines
  differ by a rounding, only seals the seam against a road. Last, each
  promenade loses the needles the booleans leave where two boundaries all
  but meet (an edge out and straight back), and a wedge thinner than 40 cm
  against the road that meets no other pavement is handed to it, so no kerb
  stands out on its own in the carriageway;
- each big park's kerb, the park less the carriageways round it as they are
  drawn, so it follows them however their widths change;
- a spatial index of all of these, so `surfaceAt(s, u)` in `city-route.js`
  answers `pavement`, `median`, `road` or `water` from exactly what is
  drawn;
- the districts: one each of the old town, garden quarter, warehouse
  district, market district and civic quarter, and Midtown round downtown. The HUD names the core Downtown and the
  waterfront Harbour or Riverfront.

`nav-graph.js` turns the road graph into edges between junctions (merging
junctions under 5 m apart into one) for the traffic, the autodrive, the taxi
and the map route. An edge ends where a road carries on as one of another
profile (an avenue into a boulevard), so each is marked as its own road,
except that a piece under 20 m (the ring road carried a few metres past a
junction before it hands over to the coast road) goes with the street it
carries on as, if that street is no wider, so a car turning onto it has the
street beyond to turn into.
`junction-geometry.js` gives each junction's approaches
their clearance: where the road leaves the junction box, from the kerb corners
it shares with its neighbours round the node. The crosswalk starts there, the
stop line and the sign or signal stand behind it on the approach's own
right-hand pavement, markings and medians stop short of it, and turning
traffic leaves its lane there. A street shorter than 24 m between two
junctions is the middle of one junction complex: it has no crosswalk or stop
of its own, and traffic crosses it in one turn.

Each junction's control follows the street hierarchy (`junctionControls` in
`city-junctions.js`). Two arterials crossing, a collector crossing an
arterial, and two collectors crossing downtown run a signal cycle; on an
approach 16 m wide or more the signal hangs from a mast arm, a head over each
lane. Otherwise the best-ranked road straight through the junction has the
right of way and the others stop for it; a better road that ends on a lesser
one makes it an all-way stop. Where only local streets meet, each district
does as a town of its kind would: the old town's lanes are left unmarked, the
garden quarter's quiet streets give way (a give-way sign and a row of teeth
across the lane), the warehouse district's side streets stop, and downtown
and the market and civic quarters have all-way stops at their crossroads,
with a share of each district's junctions doing otherwise. A crosswalk is
marked across every approach at a signal or a stop line, and across a
street nobody stops on only downtown and in the market; a quiet junction
has none. Where two junctions a few metres apart would lay two crosswalks
over each other, the one across the narrower road gives way, and a street
so short that the crosswalks at its two ends all but meet keeps only the one
where its traffic stops (`cityCrosswalks`).

`lane-paths.js` is how a car gets from one street to the next: a circular arc
tangent to both lanes, as wide as the junction allows. The arc's apex keeps a
car's half-width clear of the rounded kerb on the inside of the turn, and when
a street bends as it arrives the widest candidate that stays on the
carriageway is used. Cars choose their way on when they join a street and
brake so they enter each turn at its own speed (a comfortable 2.8 m/s²
sideways), and slow in the same way for the street's own bends; they avoid
hairpins when there is another way on. The autodrive follows the same curves.
It tracks where it is by projecting the car onto its own street and onto the
turn it is taking, never onto whichever street is nearest (in a wide road's
outer lane a side street leaving at a slant can be nearer), aims closer in a
turn so it keeps to the curve rather than cutting across the kerb, pulls up
at a dead end, and if it is ever knocked off its way it finds its street
again instead of turning back to a point behind it.

`city-junctions.js` decides who may cross a junction and when. Before a car
crosses the stop line it claims its way through (from its lane, round its
turn, into the first metres of the lane beyond) and holds the claim until its
tail is out of the box. A claim is refused while anyone else holds one whose
path comes within a car's width of it, so two cars never cross paths in a
junction; cars in one lane share the junction and follow each other. The
right of way decides who asks first. A green light, or a road that does not
stop, lets its cars ask about 2.5 seconds out. A give-way sign slows them to
walking pace at the line and lets them ask a little before it, and a stop
sign makes them stop at the line first; at a four-way stop the car that has
waited longest goes first. A car gives way to anyone on a crossing path with
the better right of way who is less than 4.5 seconds from their line: the
main road over the side street that gives way over the one that stops, and
straight on over turning right over turning left. Nobody enters a
junction whose way out is backed up. Where the street beyond is too short to
stop on before the next junction (inside a junction complex), that junction
is claimed at the same time. The player's car, whose way nobody knows, is
given any junction it is in or heading into. Between junctions a car brakes
for whatever is on its own path ahead: along its lane, round its turn and
into the next street. That includes a car crossing in front of it and the
player, where the player will be a second from now if they are crossing or
coming the other way. The traffic and the autodrive share one set of claims.

`city-medians.js` lays out the raised medians down the boulevards and the
parkway, one per street between its junctions with rounded noses short of
the crosswalks; the renderer draws them, the furniture plants them and the
tyres ride up onto them from the same shapes. `city-parks.js` gives each park
its plaza or pond and lays out each square as one of the city's open-air
places: walks in from its corners and long sides to a paved circle, and in
and round the circle what the square is for. A botanical garden has a
glasshouse among flower beds and a market square rows of striped stalls and
a bakery's kiosk; these two take the roomiest squares. A clocktower square
has its tower on three steps (a circus's garden is the natural place for
one), a sculpture garden a centrepiece in a pool and smaller works along its
walks, and a fountain square a tiered fountain with a cafe's tables beside
it. No design comes up more than twice. A paved square has a promenade
under two rows of trees round its edge and lawns between its walks; a lawn
has its trees in groves. A square too narrow for a circle (a strip between
two streets) is a linear garden instead: one walk down the middle of its
length from edge to edge, with its lanterns, benches and trees along it.
The pieces (`city-monuments.js`) are laid out
square to the square's longest side, the tower and the glasshouse at both
detail levels.

`city-streets.js` builds the static layer (carriageways with their rounded
corners, markings, medians, parking bays, crosswalks and stop lines, a zebra
at each park gate, pavements and kerbs, parks and squares with their plazas,
walks and ponds, the ground inside each block and its yard, promenades,
water, quay walls and bridges, each bridge with a raised footway along its
deck wherever its road has room outside its lanes and no promenade of its own
beside it, paved and kerbed as the promenade is and carried on over the bank
to the kerb of the road along the water, where it and the promenade become
one pavement round a rounded kerb corner (`city.js`: the carriageways round
each bridge end, not counting any hairline or scrap of road cut off beyond a
footway, are closed by the kerb radius, a sharp wedge more tightly);
the crosswalks and stop lines across a bridge road end at its footways, and
its signs stand on them; railings run along its edges over the water, never
across a road that joins it or a crosswalk at its end; where the shore runs under a carriageway or a
walk carried on over the water, the quay wall stops just beneath it and has
no coping or railing). A block too small or too pointed for any lot
(a wedge where streets meet at a slant) is a planted island
(`city-islands.js`): a lawn inside a paved rim, with trees where there is
room clear of the junctions, and on the bigger ones a flower bed or a small
sculpture. It also places the street furniture once: signals
and stop signs, lamps round every kerb clear of the junctions and trees
between them as each district plants its streets (an avenue of big trees in
the garden and civic quarters, smaller ones in the old town and none in its
lanes, and only some of the warehouse streets planted), every tree no bigger
than its room to the building line so its crown only brushes the fronts,
and its crown clear of every lamp, sign, signal and bus shelter, whichever
stood first (a street tree steps a metre or few along the kerb rather than
grow round one), lanterns on short posts rather than tall lamps along the
old town's and the garden quarter's own streets (their avenues keep the tall
ones), trees and double-armed lamps down the boulevards' medians, bus
shelters on the main roads, each with a bin at one end, bins where people
wait to cross (just short of the corners, at most of them where the
pavements are busy and a few where they are quiet), parked cars in two bays
in five, car parks lined out in the paved
yards behind the offices and warehouses, a little over half full, each with
a driveway in from the street between two of the buildings round it
(`city-yards.js`: the narrowest lot backing onto the yard gives up the
strip), a dropped kerb and a parking sign at its mouth and nothing parked
across it, railings
on the quays and bridges, benches along the wider promenades facing the
water, in the parks a fountain or a bandstand on the plaza, and in
the squares what each is for, lanterns and benches along the walks, an
avenue of trees round a park's loop and a row round every square's edge,
groves over the lawns, and trees gathered in groves in the back yards where
the houses have gardens (thickest in the garden quarter). Every place has its sign on the pavement by its entrance,
placed before the lamps and trees take the kerb, beside a venue's forecourt
rather than across it; where a frontage is all junction corners (a circus)
the sign stands just inside the grounds or the lawn. Props are turned with the helpers
in `city-layout-render.js` (`faceYaw`, `alongYaw`, `itemFrame`), one
convention for every item and its collider.

The layers are stacked so that no two surfaces of different looks ever lie in
one plane, where they would flicker as the camera moves: the bare island 6 cm
under the road, the markings 12 and 14 mm over it, the pavements 12 cm up,
the ground inside a block, a yard or a park's lawn and walks a centimetre or
two above that, and a plaza's paved disc over the ends of the walks that lead
to it. Anything that stands proud of what is round it is solid on every side:
the plaza's disc has its edge, a pond's coping and a quay's coping (a low
stone kerb along the top of the wall, overhanging the water a little) have
their outer faces down to the lawn, promenade or road, a coping's ends are
closed and stop at the kerb where a road crosses the shore (found to a couple
of centimetres), no scrap of coping stands on a metre or two of shore between
two roads, and rings like a pond's are offset as closed rings, so there is no
notch where they close. A driveway's dropped kerb spans exactly the pavement
in front of it, from the lot to the kerb however wide the pavement is, and a
stop line or a row of teeth that would fall on a crosswalk (where two
junctions are close) is left out. A bridge's side walls rise to the footway
only where it reaches the deck's edge, tested every quarter metre along the
road itself, which the deck follows round any bend.

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

Roofs follow the buildings under them. A small detached house has a hipped
roof. In the old town, the market district and the garden quarter many of
the plain four-sided buildings of up to six storeys have a pitched roof in
terracotta or slate, its ridge along the street, its gables on the party
walls and chimney stacks on them, so a terrace reads as a row of houses; a
warehouse has a low one along its length with a vent on the ridge, and
downtown and the civic quarter stay mostly flat. What stands on a flat roof
follows what the building is: a lift overrun and plant on the offices,
skylights down a shed, a stair head and chimney stacks on flats, now and then
a water tank on old brick or a roof garden, all square to the building. A
house or a terrace of houses has an ordinary ground floor in its own walls
over a low plinth, and a detached one windows round its garden; a block over
shops or offices stands on a tall stone base. Where that tall ground floor is
not a shopfront or a lobby, its windows are as tall as the storey, transomed
level with the head of a door that has a fanlight over it, and a warehouse
has a door for its staff beside the loading door and a row of high windows
along the rest of its front. A block's shops are dealt their names round the
block from the whole catalogue in turn, so no two shops round a block share
a name and neighbouring shops sell different things. The trim on a facade stops under the
cornice or eaves that cap its wall (pilasters, fins, string courses), and
where two buildings share a party wall each cornice reaches only to the lot
line, where the neighbour's meets it, rather than overlapping it; a door's
step stands above the garden path that leads to it, and a vaulted hall's
roof overhangs its walls. A lot with no room for a
building is a garden: one more lawn where the houses have gardens, and in
the built-up districts (most often the sharp tip where two streets meet at a
slant) a little public garden inside a paved rim, with trees sized to it.
Where buildings stand back behind gardens, a paved path runs from the
pavement to each door, a shop's whole front is paved to the street, and a
clipped hedge (in the civic quarter a low stone wall) runs along the
pavement with a gap at each path, so no door opens onto the lawn.

The places a passenger asks for (`city-exploration.js`) are the parks and
squares and some thirty venues, every kind in the notebook somewhere in
every city. The venues are spread evenly: the best sites first, as far
apart as there are sites for about two of each kind, dealt out a round at a
time so no kind comes up more than twice, the second time under another
name, and where its district wants it (a hotel or a cinema in midtown, a
depot by the warehouses, an observatory in the garden quarter). The grand
ones (a museum, a station, a hospital, a library, baths, a market hall, a
tram depot, a sports club, an observatory) have a compact block to
themselves, and City Hall the best block nearest downtown, which may face
a square; a cinema, a jazz club, a hotel, a fire station, a post office or
a diner takes a lot in a street of other buildings. A kind that no square
could be (a city short of squares) has a block of its own instead, and a
kind the dealing left out takes the best site that fits it, nearer its
neighbours the fewer sites the city has.

Each is a landmark (`city-landmarks.js`): a civic hall with a portico and a
dome or a clock tower, a hotel tower, a vaulted station or market shed,
baths behind a tiled arcade, a cinema's lit marquee, an observatory, a
club's lined tennis and basketball courts, a firehouse with its engine out
front, a diner with a giant donut. Its building is fitted square to its
site's main street (`landmark-site.js`), no bigger than its kind of building
is and set back behind a forecourt, and the rest of the site is its
grounds: lawn, the paved forecourt from the street to the door, a path round
the building (carried on to the pavement wherever it stops a strip of lawn
short of it), trees along the edges and in the open lawn, and before a civic
hall flower beds and flags. The name is across the front, fitted between the
doors and the cornice, or on a stone plinth in the forecourt where a portico
would hide it. The drop-off is in the kerbside lane of the street it faces,
with the venue on the right, clear of the junctions. A site's rectangle has
no lot edge across it, so a street biting into a lot is never built over.

## Checking a city

- `npm test` includes the network, street profile, park layout, shore, lot,
  junction, furniture, building, place and traffic invariants;
  `TEST_WORLD_SEED=42 npm test` runs the whole suite against another city.
- `tests/city-geometry.test.js` builds the meshes round the start and round
  a bridge end and checks them as drawn: no two surfaces of different looks
  in one plane, and no kerb, coping or wall standing up on its own in the
  road.
- `node scripts/city-map-svg.mjs <seed> city.svg` draws the plan.
- `node scripts/city-tour.mjs <seed>` takes screenshots round the city.
- `node scripts/world-stats.mjs` builds the world in Node and reports what it
  draws.
