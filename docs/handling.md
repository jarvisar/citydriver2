# Handling

The driving uses arcade grip handling with a powerslide for drifting. The handling comes from a speed-dependent turning radius, separate headings for where the car points and where it travels, and a limited slip angle. There's no tire simulation, and the suspension is just a spring on the body for landings (see [Jumps and Landings](#jumps-and-landings)).

## Steering and Drifting

- Steering reaches 90% in about 38 ms and returns to centre in about 26 ms. Countersteering switches direction on the next simulation tick. If two keyboard directions are held, the newest press wins.
- The controller deadzone is 12%, and the rest of the stick range is remapped so small movements are precise. Full lock is tight enough for slow city junctions, and the turning circle widens at higher speed.
- Launch torque is up to 22% stronger on tarmac, fading out by 12 m/s. Top speeds, grip and off-road speed for each car are in `src/cars.js`.
- Brake takes priority over throttle. After stopping, holding brake waits 0.5 seconds before reversing, so the cab stays still for pickups and drop-offs. Release and press brake again to reverse straight away.
- Above 7.5 m/s, tap Drift while steering to start a slide. Hold the throttle and steering into the corner to keep sliding after letting go of the button. Holding Drift also works. Centre the steering, countersteer, lift off or brake to recover. Slides end below 6 m/s and can't start in reverse.
- The slide angle is limited to 0.55 radians (about 32°). Sliding scrubs off some speed, and normal steering gets grip back quickly. Handbraking in a straight line stops the car and holds it, even with throttle or boost held.
- The chase camera follows small turns quickly and swings round for U-turns. During a slide it looks partly along the direction of travel so the exit stays in view.
- After a click on the view (straight away in fullscreen) the mouse turns the chase camera around the car, and Escape gives the pointer back. A controller's right stick does the same. The mouse wheel moves the camera closer or further away. While the car is moving, the camera swings back behind it a moment after the mouse or stick stops. It stays out of buildings and above the ground.
- Collisions, tire sounds, skid marks and taxi drift tips all follow the actual slide.

Keyboard, controller, VR and the chase-view touch stick all use the same steering. Touch boost reaches the same top speed as the keyboard, and letting go of the stick stops the cab even while Boost is held. The overhead view's touch controls stay relative to the screen.

## Turning Radius

Side streets are 13 m wide, avenues 18 m and boulevards 24 m. The full-lock radius blends the car's low-speed lock with a grip limit of `speed² / cornering`, where `cornering` is `32 × grip` m/s² (`turningRadius` in `src/handling.js`). The blend follows whichever limit is tighter without a sudden change between them. Loose ground reduces grip, and braking into a corner gives a little extra.

Each car has its own low-speed radius as well as its grip: 3.2 m for the Micro, 3.6 m for the Formula cars and 5.4 m for the truck. The Formula cars have the most grip (2.25 for the Formula and 2.2 for the Formula Taxi, compared to the Taxi's 1.4). Every car only drifts when you press Drift.

Full-lock radius in metres on tarmac, from `node scripts/handling-sweep.mjs`:

| Car | 10 m/s (22 mph) | 15 m/s (34 mph) | 20 m/s (45 mph) |
| --- | ---: | ---: | ---: |
| Default wagon | 4.80 | 7.33 | 12.56 |
| Taxi | 4.03 | 5.44 | 9.01 |
| GT Taxi | 3.81 | 4.98 | 8.16 |
| Formula Taxi | 3.62 | 4.06 | 5.90 |
| Formula | 3.62 | 4.03 | 5.79 |
| Micro | 3.46 | 5.73 | 9.95 |
| Truck | 5.77 | 9.29 | 16.08 |

A Formula at 50 m/s still needs about 35 m to turn, so slow down before sharp junctions. The game doesn't steer toward roads or brake for corners.

## Jumps and Landings

Cars go up and down with what they drive over and can leave the ground off ramps, mounds and crests. It's still arcade physics, not a vehicle simulation. The code is in [src/car-air.js](../src/car-air.js).

- The four wheels and the middle of the car each check what's under them: the street, or the top of a ramp, a mound, a roof or another car. The car sits on the highest of those it can reach, pitched and rolled to match.
- A wheel climbs up to 0.45 m, like a kerb or the foot of a ramp. Anything taller is a wall.
- Kerbs never lift a car off its tyres. A drop of up to 0.3 m is followed straight away and the body settles after it.
- The car leaves the ground wherever the ground falls away faster than it can fall, like a ramp's lip or a crest taken fast. It also counts as off the ground once both front wheels are over an edge, so it can't keep steering on its back wheels.
- Gravity is 13 m/s², a bit more than real, so jumps come down with some weight. A car keeps nearly all its speed in the air.
- In the air the nose follows the arc and comes round to the ground over the last couple of metres, so the car lands on its wheels. Going slowly over an edge, it tips over it instead.
- Steering in the air turns the nose up to about 24° off the way the car is flying, and it straightens up when you let go. Hold Drift and steer to spin it. Let go and it carries on round to the next full turn.
- Landing more than about 30° off the way it's going spins the car out. A bit off, it slides for a moment while the tyres grip again. Coming down faster than 5 m/s scrubs off some speed, up to 15%, and faster than 12 m/s shakes the camera a little.
- A car can come down on another car's bonnet or roof and drive off it. The car underneath gets knocked about and its driver stops for a moment.
- A car that falls in the river sinks and is put back at the start of its run-up.

## Helicopter

The helicopter in the garage flies with the driving controls. Forward and brake fly it forward and back, steering turns it, and Climb and Descend move it up and down. It holds its height when nothing is pressed and slows to a hover on its own. Pressing forward on the ground lifts it off to a low hover.

- It reaches 40 m/s (90 mph), climbs at 8 m/s and descends at 9 m/s. It turns at about 110° a second while hovering and banks into turns at speed.
- It slows down as it gets close to the ground, so landings are gentle. It can land on streets and roofs. Over the water it hovers just above the surface.
- It bumps into buildings below their roofs and flies over them above. It meets street furniture like a car does until it is above it. More than 2.5 m up, it passes over traffic and people.
- It flies up to 120 m above the streets. The chase camera tilts down the higher it goes.
- Low over the river it fits under the bridges. The piers are solid. A deck a little too low to pass under ducks it down.
- Close to the ground its downwash kicks up dust, or spray off the water.
- Pressing E sets it down where it is and lets you out. Over the water it heads for the nearest street first, and under a bridge it flies out from under the deck before that. Left with nobody in it, it does the same and its rotor winds down.
- Autodrive only works in cars. Changing to a car in the air puts the car in the nearest lane.

The flight code is in [src/helicopter.js](../src/helicopter.js).

## Plane

The plane uses the same controls. On the ground it taxis like a slow car on its nose wheel and brakes with S, then backs up at 4 m/s. Holding W, it lifts off by itself at 25 m/s. Holding Space as well, it lifts off at 19 m/s and climbs.

- In the air it cruises at 34 m/s and holds its height when nothing is pressed. W takes it up to 56 m/s and S down to 17 m/s. Climbs and dives change its speed a little.
- Steering banks it up to about 57° and turns it at about 55° a second at cruising speed, tighter when slow.
- If it slows right down in the air, the nose drops until it has flying speed again.
- It never flies into the ground. Near the floor it can only sink at 1.1 m/s plus 0.75 m/s for every metre of height, so a dive flattens out and holding Shift lands it softly. A landing faster than 4.5 m/s, or with the wings banked over 0.6 rad, bounces.
- It can land on streets, parks and flat roofs, and says so after a gentle landing or one on a roof. Over the water it skims 1.1 m above it and can't land.
- Its wings hit buildings as well as its body. It glances off anything it flies into instead of stopping dead in the air.
- A double tap of a steering direction does a barrel roll that steps it about 5 m to that side. A double tap of climb loops the loop, about 44 m high, if it's flying faster than 24 m/s with 5 m of room below. A press held longer than 0.28 s isn't a tap.
- Pressing E makes it glide down at 3.2 m/s and land, heading for the nearest street first if it's over the water. Left with nobody in it after a jump, it circles down near where you left it and lands.

The flight code is in [src/plane.js](../src/plane.js), and the model in [src/plane-model.js](../src/plane-model.js).

## Input Timing

The simulation runs at a fixed 120 Hz. Input is read every tick, and controllers are polled before each frame's simulation. Rendering interpolates between ticks, which adds 8.33 ms. Device, rendering and display delays come on top of that.

## References

- [KidsCanCode: Car steering](https://kidscancode.org/godot_recipes/3.x/2d/car_steering/index.html)
- [Livio De La Cruz: Implementing Racing Games](https://www.gamedeveloper.com/design/implementing-racing-games-an-intro-to-different-approaches-and-their-game-design-trade-offs)
- [Glenn Fiedler: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
- [MDN: Using the Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)
- [Three Fields Entertainment on Dangerous Driving](https://www.unrealengine.com/developer-interviews/three-fields-entertainment-explains-how-they-evolved-burnout-arcade-racing-formula-dangerous-driving)
- [Rob Baker on GRIP's handling](https://blog.playstation.com/archive/2018/08/01/defy-gravity-and-blast-along-ceilings-at-700mph-in-arcade-racer-grip-combat-racing-out-on-ps4-6th-november/)

## Tests

`npm test` covers steering, slides, braking, reversing, collisions, the camera, sound, touch, controllers and different refresh rates for every car. Steering and drift paths are identical from 30 to 240 Hz. The corner tests drive all 22 cars through three street widths, four approach directions, both turn directions and two speeds, for 1,056 corners in total.

`node scripts/handling-sweep.mjs` prints each car's turning radius at different speeds and saves a report to `.artifacts/handling/`.
