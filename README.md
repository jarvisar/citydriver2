# Citydriver 2

Taxi driving game built with [Three.js](https://threejs.org/). This is
[Citydriver](https://github.com/jarvisar/citydriver) with its endless grid
replaced by a city generated from a tensor field: a coastline, a river,
neighbourhoods laid out on their own grids, curving avenues, a ring road round
the edge, parks with winding paths, and blocks cut into street-front lots. The
layout comes from a port of
[MapGenerator](https://github.com/ProbableTrain/MapGenerator) by ProbableTrain
(`src/mapgen/`, LGPL-3.0); the driving, cars, garage, weather, audio, menus and
taxi shift are Citydriver's.

![The main menu over the generated city](docs/images/downtown.png)

Each block is platted into a strip of lots round a shared yard, and every
building takes the shape of its lot, so facades bend with the streets, corner
buildings wrap their corners and the street walls run unbroken. Each
neighbourhood has its own character, from narrow old-town terraces to houses
with gardens and warehouses, and the places passengers ask for are landmarks of
their own.

| Street-front blocks round their yards | On the street |
| --- | --- |
| ![Blocks of terraces round green yards, seen from above](docs/images/courtyards.png) | ![Driving down a tree-lined street](docs/images/street.png) |

## How to play

Start a **Taxi run** to pick up passengers and earn money. Stop in a pickup
ring, follow the arrow, then stop in the yellow drop-off ring before the fare
clock runs out. Fares, ratings, the shift clock, groups, tips, shift goals,
licences and the career work as in Citydriver; see
[progression and balance](docs/taxi-progression.md) and the
[taxi fleet](docs/taxi-fleet.md).

**Free drive** has no timer. All three taxis are available in the garage,
along with weather settings and city discoveries in the pause menu. Press
forward on the main menu to enter free drive, or **R** to generate a new
city.

Every visit generates a new city. Use `?seed=4817` to load the same city
again.

## Controls

| Action | Keyboard | Controller |
| --- | --- | --- |
| Accelerate | W / Up | RT / R2 or A / Cross |
| Brake / reverse | S / Down | LT / L2 or B / Circle |
| Steer | A D / Left Right | Left stick |
| Boost | Shift | RB / R1 |
| Drift / handbrake | Space | D-pad Down |
| Camera | V | X / Square |
| Pause | P / Escape | Start / Menu |
| Reset | R | Y / Triangle |
| Garage / Taxi fleet | C / G | L3 |
| Autodrive (free drive) | H | D-pad Up |
| Fullscreen | F | LB / L1 |
| Sound | M | Pause menu |
| Map | Map button | View / Share |
| Menus | Tab, Enter | D-pad or left stick to choose, A / Cross to select, B / Circle to go back |

On touch screens, use the stick to drive, hold Boost, and tap Drift while
steering in chase view. Release the stick to stop.

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Run `npm run build` for a production build.

[Desktop setup](ELECTRON.md) · [Offline installation](PWA.md) ·
[City generation](docs/city-generation.md) · [Development notes](docs/)

## Tests

```sh
npm test
npm run build
npm run test:smoke
```

`npm test` covers the generator, the route, the navigation graph, handling,
audio, the garage and the taxi rules. `npm run test:smoke` drives through the
generated city in a headless browser against a running dev server
(`npm run dev`), and reports console errors; set `CHROME_PATH` to use another
Chrome executable.

`node scripts/city-map-svg.mjs 4817 city.svg` draws a generated city as an
SVG map.

## GitHub Pages

In **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow
tests pull requests and deploys successful builds from `main` using
`/citydriver2/` as the base path.

## License

The map generator in `src/mapgen/` is a port of MapGenerator and is
distributed under the GNU Lesser General Public License v3.0; see
`src/mapgen/COPYING.LESSER`.
