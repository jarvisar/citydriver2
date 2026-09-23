# Driving feel

The controller has grip driving and a deliberate powerslide. Speed-dependent
turning radius, separate chassis/travel headings, and a bounded slip angle supply
the handling; no suspension solver, tire model, or extra dependency is involved.

- Steering reaches 90% in about 38 ms; release takes about 26 ms. Countersteer
  changes direction on the first simulation tick instead of unwinding old input.
  Overlapping keyboard directions favor the newest press, ignoring key repeat.
- Small analog movements favor precision. The controller deadzone is 12%, with
  the remaining stick range remapped continuously. Full lock fits slow city
  junctions; high speed progressively widens the turning circle.
- Launch torque is up to 22% stronger on tarmac, fading out by 12 m/s. Top speeds
  and each car's grip/off-road differences remain defined by `src/cars.js`.
- Above 8 m/s, tap Drift while steering to start a slide. Keep gas and steering
  into the corner to sustain it after releasing the button. Holding Drift also
  works. Center, countersteer, lift, or brake to recover; a fresh tap starts the
  next slide. Slides end below 6 m/s and cannot start in reverse.
- Slide angle stays within 0.55 radians (about 32 degrees). Sliding tires scrub
  some speed; ordinary steering regains grip quickly. Brake beats gas in both
  modes. Straight handbraking stops and holds the car even with gas/boost held.
- The chase camera follows small turns more quickly while retaining a bounded
  U-turn orbit. In a slide it looks partly along travel to keep the exit visible.
  Tire audio follows actual slip after the handbrake button is released.
- Collisions use the travel direction. Taxi drift tips and skid marks follow
  the sustained slide; the existing scoring and boost rules are retained.

Keyboard, gamepad, XR, and the chase-view touch stick share this controller.
Overhead touch keeps screen-relative navigation and its stop-on-release behavior.
The driving HUD and README describe the tap-and-steer controls.

## City corners and car differences

Side streets are 13 m wide, avenues 18 m, and boulevards 22 m. Full-lock radius
is `hypot(lowSpeedRadius, speed² / corneringCapacity)`. This continuously blends
parking lock into a speed limit on cornering; no abrupt steering cutoff occurs.
Cornering capacity is an intentionally generous arcade `32 × grip` m/s².

Low-speed radius can differ independently of grip: the Micro gets a 3.2 m
parking radius, the Formula cars 3.6 m, and the truck 5.4 m. Both Formula
variants now have the strongest grip in the fleet (2.25 / 2.2 versus the taxi's
1.4). Grip also increases tire recovery quadratically, keeping normal Formula
turns within one degree of sideways slip throughout the tested speed range.
Drifting remains a deliberate input, including on the Formula cars.

Steady full-lock radii in metres, on tarmac (not diameters):

| Car | 10 m/s (22 mph) | 15 m/s (34 mph) | 20 m/s (45 mph) |
| --- | ---: | ---: | ---: |
| Default wagon | 5.56 | 8.40 | 13.32 |
| Taxi | 4.48 | 6.35 | 9.74 |
| GT Taxi | 4.21 | 5.85 | 8.87 |
| Formula Taxi | 3.87 | 4.81 | 6.73 |
| Formula | 3.86 | 4.77 | 6.62 |
| Micro | 4.05 | 6.43 | 10.42 |
| Truck | 6.72 | 10.51 | 16.91 |

The Formula's previous 20 m/s radius was 17.3 m. It now holds a much tighter
line at the same speed. A 50 m/s turn still needs about 35 m of radius; lift or
brake before a sharp junction. Full throttle during a turn increases speed and
widens the arc. The controller does not steer toward roads or brake for corners.

## Input timing

The existing 120 Hz fixed step is retained. Input is read each simulation tick;
gamepads are polled before simulation each display frame. Rendering interpolates
between ticks, adding 8.33 ms of simulation history. Steering and grip response
were shortened without changing the fixed-step loop or predicting through walls.
Device, event scheduling, rendering, GPU, and display delays are additional; these
figures describe the controller, not measured end-to-end latency.

## Research and choices

- [KidsCanCode: Car steering](https://kidscancode.org/godot_recipes/3.x/2d/car_steering/index.html)
  separates acceleration, steering and traction for a compact arcade controller.
  Separate facing/travel headings fit this game's existing collision system.
- [Livio De La Cruz: Implementing Racing Games](https://www.gamedeveloper.com/design/implementing-racing-games-an-intro-to-different-approaches-and-their-game-design-trade-offs)
  discusses building arcade mechanics directly versus simulating wheels.
  Explicit control over the slide and recovery suits narrow city streets.
- [Glenn Fiedler: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
  explains fixed simulation, interpolation and CPU headroom. Keep those properties
  rather than making driving depend on display refresh rate.
- [MDN: Using the Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)
  recommends fetching current controller state in the animation loop.
- [Three Fields Entertainment on Dangerous Driving](https://www.unrealengine.com/developer-interviews/three-fields-entertainment-explains-how-they-evolved-burnout-arcade-racing-formula-dangerous-driving)
  describes measuring handling and matching corners to it. Here the city's
  existing geometry sets the targets for each car's radius curve.
- [GRIP programmer Rob Baker on predictable handling](https://blog.playstation.com/archive/2018/08/01/defy-gravity-and-blast-along-ceilings-at-700mph-in-arcade-racer-grip-combat-racing-out-on-ps4-6th-november/)
  prioritizes predictable grip over aerodynamic fidelity. Formula grip here is
  strong at city speeds too, without a downforce simulation or sudden grip change.

The tap-to-slide behavior, thresholds and response rates are tuning choices for
this game, not settings copied from those references.

## Verification

Run `npm test` for all-car steering, tap/hold slides, exit controls, braking,
collisions, camera response, sound, touch, gamepad and refresh-rate coverage.
Scripted steering/drift paths are identical across 30–240 Hz display rates.
The footprint trials cover all 22 cars, three street widths, four approach
directions, both turns, and two speeds: 1,056 corners including the street exit.
Side-street trials use 15 m/s for road cars, 10 m/s for heavy trucks, and 25 m/s
for Formula cars. Wider streets use 18 / 10 / 28 m/s respectively; all also run
at 6 m/s. These are constant-speed handling trials, not full-throttle guarantees.

`node scripts/handling-sweep.mjs` prints every car's radius across speeds and saves
a report in `.artifacts/handling/`. CPU figures exclude rendering and are not
input latency measurements. Physical controller/touch feel still needs human
playtesting; automated checks establish response, recovery and consistency.
