# Citydriver 2

Taxi driving game built with [Three.js](https://threejs.org/). Uses a port of [MapGenerator](https://github.com/ProbableTrain/MapGenerator) to generate a new island city every time the game loads.

Visit the [GitHub Pages site](https://citydriver2.ajarvis.co/) to access the latest deployment. Desktop builds for Windows, Linux and macOS are available under [Releases](https://github.com/jarvisar/citydriver2/releases).

This is the sequel to [Citydriver](https://github.com/jarvisar/citydriver). The endless grid from the first game is replaced by a generated city. The driving, cars, garage, weather, audio and taxi mode carry over from Citydriver.

![Main menu](docs/images/downtown.png)

## Features

- Island city with a harbour, a river, parks, boulevards and a ring road
- Six districts: Old town, Garden quarter, Warehouse district, Market district, Civic quarter and Midtown
- Buildings shaped to fit their lots
- Traffic that follows signals, stop signs and give-way signs
- Traffic that changes lanes on the boulevards and drives around crashed and stopped cars
- Landmarks and shops that passengers can ask to go to
- Taxi mode with group fares, shift goals, driver ranks and cabs to buy
- Demolition mode with a truck, damage chains, ratings and high scores
- Get out and walk around in free drive, and borrow cars from traffic
- Weather and night driving
- Keyboard, controller and touch screen support
- VR headsets such as Meta Quest, through WebXR
- Can be installed and played offline

## How to Play

Start a Taxi run to pick up passengers and earn money. Stop in a pickup ring, follow the arrow, then stop in the yellow drop-off zone before the fare clock runs out. Buildings have a short zone outside the entrance. Parks and squares let passengers out anywhere along their side of the street. Some passengers are in a hurry, want stunts or are nervous. An icon on their ring shows which. If time runs out with passengers aboard, the shift ends after the last one gets out. Earnings can be spent on faster cabs in the taxi fleet. See [progression and balance](docs/taxi-progression.md) and [taxi fleet](docs/taxi-fleet.md) for more details.

Demolition puts you in a truck with one minute to cause as much property damage as possible. Lamp posts, benches, signs, trees, bus shelters and cars all have a price, and parked cars are worth the most. Hits in quick succession build a chain. Every fourth hit raises the chain's multiplier, up to ×5, and the chain's damage is added to the total when it ends. Wrecking a moving car adds 3 seconds to the clock. Hitting a pedestrian costs a $5,000 fine and the chain in progress. Each run gets a rating, and the best five runs are kept as high scores. See [demolition](docs/demolition.md) for the prices and ratings.

Free drive has no timer. All three taxis are available in the garage, and weather settings and city discoveries are in the pause menu. The garage also has a helicopter that can fly over the city and land on roofs. Press forward on the main menu to enter free drive. Press R or select New city in the pause menu to generate a new city.

In free drive, press E to get out of the car and walk around. Walk up to your car, a car in traffic or a car parked along the street and press E to get in. A car taken from traffic drives off on its own when you get out. A parked car stays where you leave it and goes back to its space once you are far away. Your own car stays where you left it and is marked on both maps. Picking a car in the garage puts you in it. The helicopter can't be left. In first-person view on foot, A and D turn you. Once you click the view to look around with the mouse, A and D step sideways instead, like the left stick on a controller.

Every visit generates a new city. Add `?seed=4817` to the URL to load the same city again.

## Controls

| Action | Keyboard | Controller |
| --- | --- | --- |
| Accelerate | W / Up | RT / R2 or A / Cross |
| Brake / reverse | S / Down | LT / L2 or B / Circle |
| Steer | A D / Left Right | Left stick |
| Boost | Shift | RB / R1 |
| Drift / handbrake | Space | LB / L1 |
| Climb / descend (helicopter) | Space / Shift, or E / Q | Right stick, or RB / R1 and LB / L1 |
| Camera | V | X / Square |
| Pause | P / Escape (Escape also frees the mouse) | Start / Menu |
| Reset | R | Y / Triangle (in a run) |
| Garage / Taxi fleet | C / G | L3 |
| Autodrive (free drive) | H | D-pad Up |
| Get out / get in (free drive) | E | Y / Triangle |
| Walk (on foot) | W A S D / arrows | Left stick |
| Sprint (on foot) | Shift | RT / R2 or RB / R1 |
| Jump (on foot) | Space | A / Cross or LB / L1 |
| Fullscreen | F, or Fullscreen in the pause menu | D-pad Down (while driving), or Fullscreen in the pause menu |
| Look around (chase and first-person view) | Mouse, after a click on the view (at once in fullscreen) | Right stick (sideways only in the helicopter) |
| Camera distance (chase view) | Mouse wheel | |
| Sound | Pause menu | Pause menu |
| City map | M, or City map on the street map | View / Share |
| Street map (show / hide) | Its arrow button | |
| Menus | Tab, Enter | D-pad or left stick to choose, A / Cross to select, B / Circle to go back |

On touch screens, use the stick to drive, hold Boost, and tap Drift while steering in chase view. Release the stick to stop. In the helicopter, hold Climb or Descend. On foot, drag the stick the way to walk and push it further to run. Tap Jump, hold Sprint, and tap Get out or Get in.

### VR

In a headset's browser, such as the Meta Quest Browser, select `Enter VR` on the main menu or the pause menu. VR starts on a menu with the car standing still. Menus open in front of the player and the HUD sits below the car. Point at a menu with either controller and pull the trigger, or use a thumbstick and A.

| Action | Quest controllers |
| --- | --- |
| Accelerate | Right trigger |
| Brake / reverse | Left trigger |
| Steer | Left thumbstick |
| Boost | Right grip |
| Drift / handbrake | Left grip |
| Climb / descend (helicopter) | Right thumbstick, or right and left grip |
| Get out / get in (free drive) | Y |
| Walk (on foot) | Left thumbstick |
| Jump / sprint (on foot) | Left grip / right grip or right trigger |
| Look around | Right thumbstick (left and right) |
| Camera | A |
| Pause | B or left thumbstick click, and Y in a run |
| Reset car | X |
| Recenter view | Right thumbstick click |
| Menus | Point and pull the trigger, or a thumbstick to choose and A / X to select. B / Y to go back |

The pause menu has a comfort vignette that darkens the edges of the view in sharp turns. It is on by default. VR needs an HTTPS page. See [VR](docs/vr.md) for more details.

## Local Installation

Requires [Node.js](https://nodejs.org/) 22.12 or newer.

To install and run this app on a local machine, follow these steps:

1. Clone the repository:

   `git clone https://github.com/jarvisar/citydriver2.git`

2. Navigate to the project directory:

   `cd citydriver2`

3. Install the dependencies:

   `npm install`

4. Start the dev server:

   `npm run dev`

5. Open `http://localhost:5173` in a web browser.

Run `npm run build` for a production build. See [ELECTRON.md](ELECTRON.md) for the desktop app and [PWA.md](PWA.md) for offline installation.

## Tests

```sh
npm test
npm run test:smoke
```

`npm test` runs the unit tests for the city generator, navigation, handling, audio, garage, taxi and demolition rules. It builds the city for seed 4817. Set `TEST_WORLD_SEED` to test a different city.

`npm run test:smoke` drives through the city in a headless browser and reports any console errors. Start the dev server first. Set `CHROME_PATH` to use a different Chrome.

To draw a city as an SVG map, run `npm run city:svg -- 4817 city.svg`.

To try VR without a headset, add `?xr` to the dev server's URL. This emulates a Meta Quest 3 in the browser. `node scripts/vr-review.mjs` enters VR this way, steps through every headset menu and saves screenshots to `.artifacts/vr-review`.

## Deployment

Pushes to `main` are tested and deployed to GitHub Pages by GitHub Actions, using `/citydriver2/` as the base path. When setting up a fork, open the repository's Pages settings and set `Source` to `GitHub Actions`.

## Documentation

- [City generation](docs/city-generation.md)
- [Map generator changes](src/mapgen/README.md)
- [Handling](docs/handling.md)
- [Taxi progression](docs/taxi-progression.md)
- [Taxi fleet](docs/taxi-fleet.md)
- [Demolition](docs/demolition.md)
- [Driving HUD](docs/driving-hud.md)
- [UI styles](docs/ui-style.md)
- [VR](docs/vr.md)
- [Audio](docs/audio.md)
- [Performance](docs/performance.md)

## Screenshots

| Blocks from above | Street |
| --- | --- |
| ![Blocks of terraces around their yards, seen from above](docs/images/courtyards.png) | ![Driving down a street lined with parked cars](docs/images/street.png) |

| Park | Boulevard |
| --- | --- |
| ![A park with walks leading to a bandstand, seen from above](docs/images/park.png) | ![Driving down a boulevard with trees in the median](docs/images/boulevard.png) |

## License

The map generator in `src/mapgen/` is a port of MapGenerator by ProbableTrain and is licensed under the GNU Lesser General Public License v3.0. See `src/mapgen/COPYING.LESSER`.
