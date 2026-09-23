// Arcade handling. Four ideas, and nothing else: the steering angle chases the
// player instead of a spring, the turning radius is the tighter of what the
// lock and the tires allow, weight shifts to whichever end the pedals load, and
// the tires give a little at their limit and a lot when the handbrake asks.
// No suspension solver and no per-wheel tire model.

// What the player asks for. A stick needs fine control either side of centre;
// a key is always full lock, so the curve is applied to the request rather
// than to the smoothed angle below -- a keypress should not spend the first
// frames of its response climbing out of a dead zone it never entered.
export const steerCurve = input => input * (.62 + .38 * input * input);

// The angle chases the request rather than easing toward it. Turn-in is quick
// and quicker still the slower the car is going, so a parking correction lands
// at once while a motorway twitch takes a beat and the car stays settled at
// speed. Release and countersteer are quicker again, and a reversal starts
// from centre instead of spending frames unwinding the lock being abandoned.
export function steeringResponse(current, target, dt, stats, speed = 0) {
  if (dt <= 0) return current;
  if (current * target < 0) current = 0;
  const pace = stats ? Math.min(1, Math.abs(speed) / stats.topSpeed) : 0;
  const rate = Math.abs(target) < Math.abs(current) ? 135 : 115 - 60 * pace;
  return target + (current - target) * Math.exp(-dt * rate);
}

// How much cornering the tires will give: less on loose ground, more with the
// car's weight over its nose. This is the whole of the weight transfer model,
// and it is what makes braking into a junction and squeezing the throttle on
// the way out the quick way round a city block. Braking is worth more than
// power costs, so committing to a corner is rewarded and running wide on the
// exit is a nudge rather than a punishment.
const lateralLimit = (stats, looseness, bias) =>
  stats.cornering * (1 - .25 * looseness) * (1 + (bias > 0 ? .2 : .1) * bias);

// Two limits bind at once: the steering lock, which is what fits the car
// through a junction at walking pace, and the grip its tires have at speed.
// A quartic blend follows whichever one is binding without the 40 per cent
// inflation a hypotenuse leaves at the crossover -- and the crossover is
// exactly the 10-18 m/s band this city's corners are taken at.
export function turningRadius(speed, stats, looseness = 0, bias = 0) {
  const lock = stats.turnRadius / (1 - .25 * looseness);
  const arc = speed * speed / lateralLimit(stats, looseness, bias);
  const l = lock * lock, a = arc * arc;
  return Math.sqrt(Math.sqrt(l * l + a * a));
}

export function turnRate(speed, steer, stats, looseness = 0, drift = 0, bias = 0) {
  // Sliding tires point the car further into the bend than they carry it.
  return steer * speed / (turningRadius(speed, stats, looseness, bias) * (1 - .36 * drift));
}

// How hard the tires are working, from nothing to everything they have. Body
// roll and the slip below both read it, so what the car looks like and what it
// does come from the same number.
export function corneringLoad(speed, yaw, stats, looseness = 0, bias = 0) {
  return Math.min(1, Math.abs(yaw * speed) / lateralLimit(stats, looseness, bias));
}

// A handbrake tap arms a slide for a moment, so the button and the steering
// can be pressed in either order and neither has to be anticipated. Gas and
// steering carry the slide through a bend; centring, countersteering, lifting
// or braking hands control back to the tires. Entry and exit speeds differ so
// a slow slide cannot flicker on and off.
export function driftDirection(previous, speed, steer, input, armed) {
  if (input.brake || speed < 6) return 0;
  if (previous && steer * previous > .1 && (input.forward > .12 || input.handbrake)) return previous;
  if (!previous && armed && speed > 7.5 && Math.abs(steer) > .15) return Math.sign(steer);
  return 0;
}

export function travelHeading(previous, heading, dt, grip, drift, load = 0) {
  const slip = Math.atan2(Math.sin(previous - heading), Math.cos(previous - heading));
  // Tires give as they approach their limit, so a committed corner shows the
  // car leaning into it while ordinary driving still tracks the nose exactly.
  // A deliberate slide keeps its own far slower recovery, so slicks can slide.
  const bite = 1 - .45 * load * load;
  const traction = 60 * grip * grip * bite * (1 - drift) + 3.5 * Math.sqrt(grip) * drift;
  // Grip driving tracks input closely; slides keep enough sideways motion to
  // be visible, with a hard safety envelope against an uncontrolled spin.
  return heading + Math.max(-.55, Math.min(.55, slip * Math.exp(-dt * traction)));
}
