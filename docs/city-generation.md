# City Generation

A new city is generated every time the game loads, using the seed in the URL (`?seed=4817`). The street layout comes from a JavaScript port of [MapGenerator](https://github.com/ProbableTrain/MapGenerator) in `src/mapgen/` (see its [README](../src/mapgen/README.md) for what changed from the original). `src/world/` turns that layout into the world the car drives in.

Everything is measured in metres on a 2880 × 2160 m area, with x pointing east and y pointing north. Generating a city takes a few hundred milliseconds. The city is an island, with a promenade and quay wall running around the outside of the ring road and coast road.

MapGenerator's output is a rough street network with loose ends wherever a streamline stopped. The rest of the game (kerbs, lots, junction markings, traffic) needs a closed network with no dead ends, so the network is cleaned up first and everything else is built from it.

## Pipeline (`src/mapgen/`)

1. **Tensor field.** Four grid fields around the middle of the area and one radial field, with random sizes, decays and angles. The radial field's centre is downtown.

   Before any streets are traced, the land is split into six districts on a 16 m grid (`layDistricts`). Midtown grows from downtown, and the other five grow from seeds spread as far apart as the land allows. All six grow at the same time and each cell goes to whichever district reaches it first, so every district is one connected piece. Each district grows at its own speed, in its own direction and with its own noise, so they vary in size and shape and have uneven borders. Crossing water is expensive, so the river is usually a border. Each style picks the seed that suits it best (`DISTRICT_PREFER` in `src/world/city.js`): the old town and civic quarter near downtown, the warehouses near the water, and the garden quarter further out. Districts use their own random numbers so they don't change the streets.

   The old town gets MapGenerator's rotational noise (30° over about 300 m), fading out at its border (`districtNoise`), so its streets wind while the rest of the city keeps its grids. Near the ring road, the field turns to run along the ring or meet it square (`alignWith`). Without this, a grid at an angle to the edge meets the ring in a row of sharp corners.

2. **Water.** A coastline and a river are traced through the field with rotational noise. The sea is the smaller side of the coastline. If the sea would take more than 15% of the area (`water.seaMax`), the coast is generated again. The river is one smoothed centre line (`water.riverCentre`), and its channel, bank roads and water are all offsets of that line, so the river is the same width all the way along. A river running along the edge of the city next to the ring road is rejected and generated again (`alongEdge`).

3. **Roads.** Main, major and minor roads are streamlines of the field, spaced by `dsep` and `dtest` as in MapGenerator. Side streets treat the ring road as an existing streamline, so there's no strip too thin to build on beside it. Every bend is rounded into an arc (`filletPolyline`, up to 80 m for main roads and 35 m for minor ones). A streamline that loops back on itself is closed with a straight line before rounding (`closeLoop`).

4. **Ring road and cleanup** (`road-network.js`). A rounded ring road closes off the outer blocks, and streets are clipped to it. Small loops around the middle of downtown become circuses: round streets at least 40 m across with a garden in the middle (`circuses`). Then:

   - `cleanNetwork` trims overshoots, removes stretches that run too close alongside another road, cuts back ends that join at a shallow angle, and joins or removes dead ends.
   - `spreadJunctions` fixes streets that stop on the same road a few metres apart.
   - `pruneNetwork` removes dead-end chains and small disconnected pieces.
   - `joinCorners` joins or rounds two roads that meet end to end at an angle, and `easeKinks` smooths sharp kinks between junctions.
   - `infillStreets` (`infill.js`) adds a street through any block that is much wider than the normal spacing.

   The result is one connected network.

5. **Street profiles** (`road-hierarchy.js`). Every road gets a profile. The longest avenues through the middle of town become boulevards until the city has 2.7 km of them. The ring road is a parkway. About one side street in ten becomes a collector, picked from the longest side streets that are far from any avenue. The other side streets depend on their district. The rank decides who gives way at junctions, and the road markings follow the profile.

   | Profile | Rank | Where | Width | Lanes |
   | --- | ---: | --- | ---: | --- |
   | Boulevard | 4 | main roads, promoted avenues | 24 m | two each way, planted median with trees and lamps |
   | Parkway | 4 | ring road | 22 m | two each way, grass median |
   | Avenue | 3 | major, coast | 18 m | one each way, double centre line |
   | Riverbank | 3 | bank roads | 16 m | one each way, double centre line |
   | Collector | 2 | long side streets between the avenues | 14.4 m (17.2 m with bays) | one each way, dashed centre line |
   | Parking street | 1 | garden quarter, warehouses, Midtown | 15.6 m | one each way, parking bays both sides |
   | Side street | 1 | market and civic quarters | 13 m | one each way |
   | Lane | 0 | old town | 10.4 m | one each way |
   | Park walk | | parks | 7.2 m | |

6. **Shore** (`shore.js`). The island's outline is the outer edge of the promenade outside the ring road. Land is that outline minus the harbour and the river's channel. Sharp points of land and tiny slivers of land or water are removed. The sea and river are everything that isn't land. These are polygon booleans in whole millimetres (`booleans.js`, using [Clipper](https://www.angusj.com/delphi/clipper.php)), so land, river and sea fit together exactly.

7. **Parks** (`park-paths.js`). One big park (around 110,000 m²) is chosen before the minor roads are traced, so they stop at its edge. It gets gates on its streets, a loop walk just inside its edge, and walks from each gate to a round plaza in the middle, or around a pond in a big park. The walks connect to the streets and can be driven on. Six smaller squares are picked from the finished blocks, spread well apart, and each circus has a garden in the middle.

8. **Blocks.** The faces of the cleaned-up road graph. Each edge is set back by the width of its road to give the kerb line, and a pavement's width further in for the inner edge. Sharp corners are cut off as small plazas (`chamferAcute`).

9. **Lots** (`lots.js`). Each block gets a strip of lots one plot deep around its edge, all facing the street, with a shared yard behind. Corner lots wrap around their corners. Each lot edge is marked `street`, `side` or `rear`. Each district has its own lot sizes (`LOT_STYLES` in `src/world/city.js`): narrow and deep in the old town, wide in the warehouse district and downtown. Blocks too thin for a strip are cut across instead. Where a kerb would overlap a carriageway, the carriageway is cut out of the block. Lots that come closer to a road than its pavement are dropped.

## World (`src/world/`)

`city.js` builds the surfaces the game uses once, so the renderer, the tyres and the street furniture all agree:

- Land, sea and river from the shore, a 4 m water mask for the tyres, and the quay walls between them.
- Kerbs: each block's pavement edge, with its corners rounded to 5.5 m.
- Promenades along the waterfront roads and outside the ring road, cut wherever another road crosses. Bare land left over is paved as waterfront, or becomes road if it's next to a road.
- Each big park's kerb.
- A spatial index of all of these, so `surfaceAt(s, u)` in `city-route.js` returns `pavement`, `median`, `road` or `water`.
- The districts. The HUD calls the middle of the city Downtown and the waterfront Harbour or Riverfront.

`nav-graph.js` turns the road graph into edges between junctions for traffic, autodrive, the taxi and the map route. Junctions less than 5 m apart are merged.

`junction-geometry.js` works out where each road leaves a junction. The crosswalk starts there, the stop line and sign or signal stand behind it, and road markings stop short of it. A street shorter than 24 m between two junctions is treated as part of one bigger junction.

Junction controls follow the street hierarchy (`junctionControls` in `city-junctions.js`). Traffic lights are used where two main roads cross, where a collector crosses a main road, and where two collectors cross downtown. Approaches 16 m or wider get lights on a mast arm. Otherwise the higher-ranked road has right of way and the others stop or give way. Where only local streets meet, it depends on the district: no markings in the old town, give-way signs in the garden quarter, stop signs in the warehouse district, and all-way stops downtown and in the market and civic quarters. Crosswalks are painted at every signal and stop line (`cityCrosswalks`).

`lane-paths.js` connects lanes through a junction with a circular arc, as wide as the junction allows while keeping clear of the kerb. Cars pick their next turn when they enter a street and slow down to take each turn at about 2.8 m/s² of sideways acceleration. Autodrive follows the same curves.

`city-junctions.js` also decides who can go through a junction. Before crossing the stop line, a car claims its path through the junction and holds it until it's through. A claim is refused if it comes within a car's width of someone else's, so cars never cross paths inside a junction. On a green light or a main road, cars can claim about 2.5 seconds early. Give-way signs slow cars to walking pace, stop signs make them stop first, and at an all-way stop the car that has waited longest goes first. Cars give way to anyone with right of way who is less than 4.5 seconds from their line, and nobody enters a junction if the exit is backed up. The player's car always gets the junction it's in or heading into. Traffic and autodrive share the same claims.

`city-medians.js` lays out the raised medians on the boulevards and parkway. `city-parks.js` lays out each park's plaza or pond and gives each square a design: a botanical garden with a glasshouse, a market square with stalls, a clocktower, a sculpture garden, or a fountain with cafe tables. No design is used more than twice. A square too narrow for a circle becomes a linear garden with one walk down the middle. The pieces are in `city-monuments.js`.

`city-streets.js` builds the static layer: roads, markings, medians, parking bays, crosswalks, stop lines, pavements, kerbs, parks, squares, promenades, water, quay walls and bridges. Bridges get a raised footway where there's room. Blocks too small for any lot become planted islands (`city-islands.js`). It also places all of the street furniture once: signals, signs, lamps, street trees, bus shelters, bins, parked cars, car parks behind offices and warehouses (`city-yards.js`), railings, benches, and a sign at each destination's entrance. Each district plants its streets differently. Trees are sized to fit between the kerb and the buildings and kept clear of lamps, signs and shelters. Props are rotated with the helpers in `city-layout-render.js` (`faceYaw`, `alongYaw`, `itemFrame`).

Surfaces are stacked at different heights so no two different surfaces share a plane and flicker: the bare ground 6 cm below the road, markings 12 and 14 mm above it, pavements 12 cm up, and the ground inside blocks, yards and parks a centimetre or two above that. Anything raised has solid sides.

`citydriver-world.js` streams the city in 160 m chunks as the car moves. Each chunk holds the buildings and furniture in it. Chunks outside the detail radius show a simpler distant version.

## Buildings

Buildings follow their lots (`city-buildings.js`). The footprint is the lot stepped in from each edge: a small gap from the pavement, a party wall or garden gap at the sides depending on the district, and a yard behind. Each wall knows whether it faces the street, a neighbour or the yard. Shopfronts, doors and windows go on the street side, windows go on the yard side if there's room, and party walls are blank.

Odd-shaped lots are built as wings along each street: a fan-shaped lot keeps its front and leaves the rest as yard, a corner lot becomes an L shape, and a corner sharper than 70° gets a flat front instead of a point. In the garden quarter, a house on a wedge-shaped lot is a plain rectangle facing its street. Heights are similar along a block and get taller toward downtown, with the occasional tower.

Small detached houses have hipped roofs. In the old town, market district and garden quarter, many buildings up to six storeys have pitched roofs with the ridge along the street, so a terrace looks like a row of houses. Warehouses have low roofs with a vent, and downtown and the civic quarter are mostly flat. Flat roofs get equipment that suits the building: lift housing and plant on offices, skylights on sheds, stair heads and chimneys on flats, and sometimes a water tank or roof garden.

Shop names are dealt around each block from the full list, so no two shops on the same block share a name. A lot with no room for a building becomes a garden. Where buildings are set back behind gardens, a path runs from the pavement to each door, and a hedge (a low stone wall in the civic quarter) runs along the pavement.

## Destinations

The places passengers ask for (`city-exploration.js`) are the parks, the squares and about thirty venues. Every venue type appears somewhere in every city, spread out evenly, and no type is used more than twice. Venues go where their district suits them: a hotel or cinema in Midtown, a depot by the warehouses, an observatory in the garden quarter. The big ones (museum, station, hospital, library, baths, market hall, tram depot, sports club, observatory) get their own block, and City Hall gets the best block closest to downtown. Smaller ones (cinema, jazz club, hotel, fire station, post office, diner) take a lot on an ordinary street.

Each one is a landmark (`city-landmarks.js`), such as a civic hall with a portico and dome, a hotel tower, a vaulted station, a cinema with a lit marquee, a fire station with an engine out front, or a diner with a giant donut. The building faces its main street (`landmark-site.js`) and is set back behind a forecourt, with lawn, paths and trees around it. The drop-off is in the kerbside lane of that street.

## Checking a City

- `npm test` checks the road network, street profiles, parks, shore, lots, junctions, furniture, buildings, destinations and traffic. `TEST_WORLD_SEED=42 npm test` runs the tests on a different city.
- `tests/city-geometry.test.js` builds the meshes around the start and a bridge end, and checks for overlapping surfaces and for kerbs or walls left standing in the road.
- `npm run city:svg -- <seed> city.svg` draws the city plan as an SVG.
- `node scripts/city-tour.mjs <seed>` takes screenshots around the city.
- `node scripts/world-stats.mjs` builds the world in Node and reports what it draws.
