// Two cars meeting, as rigid rectangles sliding on a flat plane. Each is
// { x, z, heading, halfWidth, halfLength, vx, vz, spin?, mass? } in the
// coordinates trafficContact reads. Unless it says what it weighs, a car weighs
// what its footprint covers, so a van moves a hatchback further than the
// hatchback moves it. Turning is measured the way heading is: positive swings
// the nose to the car's own right. Anything that stands still whatever hits it
// (a wall, a tree) is a body of infinite mass at the point of contact.

// Cars crumple far more than they rebound, and scrape as they slide past.
export const CAR_SURFACE = { bounce: .2, friction: .3 };
// Below this closing speed a touch does not bounce at all, so a car leaning on
// another, or on a wall, rests against it instead of chattering; the full
// bounce comes in by twice this.
const REST = 1.5;
// Tonnes: .18 to the square metre puts a hatchback at 1.1 and a van at 1.8.
export const footprintMass = (width, length) => width * length * .18;

// Where they touch: the middle of whichever corners have gone inside the other
// car. That is the nose for a square hit, the overlap for an offset one, and
// the corner itself for a clip. Two thin boxes can cross without either
// holding a corner of the other; given the contact normal, that falls back to
// the part of `a` furthest into the other.
export function contactPoint(a, b, normal = null) {
  let x = 0, z = 0, count = 0;
  for (const [car, other] of [[a, b], [b, a]]) {
    const cos = Math.cos(car.heading), sin = Math.sin(car.heading), otherCos = Math.cos(other.heading), otherSin = Math.sin(other.heading);
    for (const [side, end] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const cx = car.x + cos * car.halfWidth * side + sin * car.halfLength * end, cz = car.z + sin * car.halfWidth * side - cos * car.halfLength * end;
      const dx = cx - other.x, dz = cz - other.z;
      if (Math.abs(dx * otherCos + dz * otherSin) > other.halfWidth + .02 || Math.abs(dx * otherSin - dz * otherCos) > other.halfLength + .02) continue;
      x += cx; z += cz; count++;
    }
  }
  if (count) return { x: x / count, z: z / count };
  return normal ? leadingPoint(a, normal) : { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}
// The part of a car furthest against a normal pointing out at it: the middle
// of its face when that meets the normal square, otherwise the corner.
export function leadingPoint(car, normal) {
  const cos = Math.cos(car.heading), sin = Math.sin(car.heading);
  const across = -(normal.x * cos + normal.z * sin), along = -(normal.x * sin - normal.z * cos);
  const side = Math.abs(across) < .05 ? 0 : Math.sign(across), end = Math.abs(along) < .05 ? 0 : Math.sign(along);
  return { x: car.x + cos * car.halfWidth * side + sin * car.halfLength * end, z: car.z + sin * car.halfWidth * side - cos * car.halfLength * end };
}

// The blow itself, along the contact normal (which points from b to a): what
// each car's velocity and rate of turn change by, or null when they are
// already coming apart. The speed they meet at is taken where they touch, so a
// spinning car's swinging tail hits harder than its middle would. A hit away
// from a car's middle spends part of itself turning that car, so it moves the
// pair less than a square one. Sliding past each other, the two scrape: a
// second, sideways blow no stronger than `friction` times the first, which
// takes speed off a glancing hit and turns the car that was dragged.
// `closing` is how fast they met; `slide` how fast they were sliding past.
export function collisionImpulse(a, b, normal, point, { bounce = CAR_SURFACE.bounce, friction = CAR_SURFACE.friction } = {}) {
  const body = car => {
    const mass = car.mass ?? footprintMass(car.halfWidth * 2, car.halfLength * 2);
    const inertia = mass === Infinity ? Infinity : mass * (car.halfWidth ** 2 + car.halfLength ** 2) / 3;
    const rx = point.x - car.x, rz = point.z - car.z, spin = car.spin ?? 0;
    return { mass, inertia, rx, rz, vx: car.vx - spin * rz, vz: car.vz + spin * rx };
  };
  const p = body(a), q = body(b);
  const vx = p.vx - q.vx, vz = p.vz - q.vz, closing = vx * normal.x + vz * normal.z;
  if (closing >= 0) return null;
  const lever = (r, x, z) => r.rx * z - r.rz * x;
  // How hard it is to change the pair's speed along a direction at the point
  const stiffness = (x, z) => 1 / p.mass + 1 / q.mass + lever(p, x, z) ** 2 / p.inertia + lever(q, x, z) ** 2 / q.inertia;
  const rebound = bounce * Math.min(1, Math.max(0, (-closing - REST) / REST));
  const j = -(1 + rebound) * closing / stiffness(normal.x, normal.z);
  // The scrape runs against the way they slide past each other
  let tx = vx - closing * normal.x, tz = vz - closing * normal.z, jt = 0;
  const slide = Math.hypot(tx, tz);
  if (slide > 1e-6) { tx /= slide; tz /= slide; jt = Math.min(slide / stiffness(tx, tz), friction * j); }
  const ix = normal.x * j - tx * jt, iz = normal.z * j - tz * jt;
  return {
    a: { x: ix / p.mass, z: iz / p.mass, spin: lever(p, ix, iz) / p.inertia },
    b: { x: -ix / q.mass, z: -iz / q.mass, spin: -lever(q, ix, iz) / q.inertia },
    closing: -closing, slide,
  };
}

// How a body rocks on its springs after a blow: radians a second of swing for
// each m/s the blow changes its speed along and across it, the furthest it
// swings, and a spring that settles in about two bounces. The nose dips into a
// blow from ahead, and the body rolls away from one from the side.
const ROCK = { pitch: .045, roll: .065, most: .14, spring: 130, damp: 6.5 };
export function rockFrom(jolt, along, across) { jolt.pitchRate += along * ROCK.pitch; jolt.rollRate -= across * ROCK.roll; }
// One step of the swing; false once it has settled.
export function rock(jolt, dt) {
  if (!jolt.pitch && !jolt.roll && !jolt.pitchRate && !jolt.rollRate) return false;
  jolt.pitchRate -= (ROCK.spring * jolt.pitch + ROCK.damp * jolt.pitchRate) * dt;
  jolt.rollRate -= (ROCK.spring * jolt.roll + ROCK.damp * jolt.rollRate) * dt;
  jolt.pitch = Math.min(ROCK.most, Math.max(-ROCK.most, jolt.pitch + jolt.pitchRate * dt));
  jolt.roll = Math.min(ROCK.most, Math.max(-ROCK.most, jolt.roll + jolt.rollRate * dt));
  if (Math.abs(jolt.pitch) + Math.abs(jolt.roll) > 1e-3 || Math.abs(jolt.pitchRate) + Math.abs(jolt.rollRate) > .01) return true;
  jolt.pitch = jolt.roll = jolt.pitchRate = jolt.rollRate = 0;
  return false;
}
