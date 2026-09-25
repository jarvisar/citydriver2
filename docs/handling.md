# Handling

The driving uses arcade grip handling with a powerslide for drifting. The handling comes from a speed-dependent turning radius, separate headings for where the car points and where it travels, and a limited slip angle. There's no suspension or tire simulation.

## Steering and Drifting

- Steering reaches 90% in about 38 ms and returns to centre in about 26 ms. Countersteering switches direction on the next simulation tick. If two keyboard directions are held, the newest press wins.
- The controller deadzone is 12%, and the rest of the stick range is remapped so small movements are precise. Full lock is tight enough for slow city junctions, and the turning circle widens at higher speed.
- Launch torque is up to 22% stronger on tarmac, fading out by 12 m/s. Top speeds, grip and off-road speed for each car are in `src/cars.js`.
- Brake takes priority over throttle. After stopping, holding brake waits 0.5 seconds before reversing, so the cab stays still for pickups and drop-offs. Release and press brake again to reverse straight away.
- Above 7.5 m/s, tap Drift while steering to start a slide. Keep the throttle and steering held into the corner to keep sliding after letting go of the button. Holding Drift also works. Centre the steering, countersteer, lift off or brake to recover. Slides end below 6 m/s and can't start in reverse.
- The slide angle is limited to 0.55 radians (about 32°). Sliding scrubs off some speed, and normal steering gets grip back quickly. Handbraking in a straight line stops the car and holds it, even with throttle or boost held.
- The chase camera follows small turns quickly and swings round for U-turns. During a slide it looks partly along the direction of travel so the exit stays in view.
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
