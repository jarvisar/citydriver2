import { carEntry } from './cars.js';
import { bodyProfile, heightAt, WHEEL, BUS_DOORS } from './traffic-models.js';
import { taxiChequers } from './car-models.js';
import { PLANE_PROFILE } from './plane-model.js';
import { EXOTIC_DARK, EXOTIC_TRIM, EXOTIC_BODY, EXOTIC_BOTTOM, EXOTIC_ROOF, EXOTIC_WINDOW, EXOTIC_SWEEP, EXOTIC_WING } from './exotic-model.js';

// A side profile drawn from the same numbers the model is built from, so each
// card shows the car the player will actually be driving.
const SCALE = 47, GROUND = 130, CENTER = 140;
const PAINT = 'var(--car-paint)', GLASS = '#3d5b63', TIRE = '#2b3434', HUB = '#bfc4b9', TRIM = '#b9bfb4';
const CARBON = '#2e3538', VISOR = '#161b1d', SUIT = '#e7e3d5';

// Drawing helpers in the car's own meters: z runs from the nose at the right to
// the tail at the left, y up from the road. A lowered shell drops with `drop`.
// A car with road-car proportions fills the card at the shared scale; a long,
// low one is drawn a little larger and sat higher so it is framed rather than
// stranded along the bottom edge.
function pen({ drop = 0, scale = SCALE, ground = GROUND } = {}) {
  const px = z => (CENTER - z * scale).toFixed(1);
  const py = y => (ground - (y - drop) * scale).toFixed(1);
  const size = value => (value * scale).toFixed(1);
  return {
    px, py, size,
    slab: (front, rear, bottom, top, fill, rx = 1.5) =>
      `<rect x="${px(rear)}" y="${py(top)}" width="${size(rear - front)}" height="${size(top - bottom)}" rx="${rx}" fill="${fill}"/>`,
    shape2d: (points, fill) => `<polygon points="${points.map(([z, y]) => `${px(z)},${py(y)}`).join(' ')}" fill="${fill}"/>`,
    disc: (z, y, radius, fill) => `<circle cx="${px(z)}" cy="${py(y)}" r="${size(radius)}" fill="${fill}"/>`,
    shadow: half => `<ellipse cx="${CENTER}" cy="${ground + 4}" rx="${size(half)}" ry="4.5" fill="#00000022"/>`,
  };
}

export function carArt(id) {
  const entry = carEntry(id);
  const parts = entry.kind === 'formula' ? formulaParts(entry) : entry.kind === 'special' ? SPECIAL_ART[entry.shape.name](entry.shape)
    : entry.kind === 'helicopter' ? helicopterParts(entry.shape) : entry.kind === 'plane' ? planeParts()
      : entry.kind === 'classic' ? classicParts(entry) : entry.shape.name === 'exotic' ? exoticParts() : builtCarParts(entry);
  return `<svg class="chooser-art car-art" viewBox="0 0 280 142" aria-hidden="true">${parts.join('')}</svg>`;
}

// The jetpack's card, from behind: two tanks either side of a back plate,
// nozzles and their flames. It is the player's own mustard pack, so the
// garage's paint leaves it alone.
export function gearArt() {
  const tank = x => `<rect x="${x}" y="28" width="28" height="66" rx="13" fill="#d9a441"/><rect x="${x + 6}" y="36" width="5" height="48" rx="2.5" fill="#f3d27e"/>`
    + `<rect x="${x}" y="50" width="28" height="4" fill="#b98632"/><rect x="${x}" y="74" width="28" height="4" fill="#b98632"/><rect x="${x + 8}" y="21" width="12" height="9" rx="2" fill="${TRIM}"/>`
    + `<polygon points="${x + 6},92 ${x + 22},92 ${x + 25},102 ${x + 3},102" fill="#8d9696"/>`
    + `<path d="M${x + 4} 102 Q${x + 14} 138 ${x + 24} 102 Z" fill="#ffd238"/><path d="M${x + 9} 102 Q${x + 14} 124 ${x + 19} 102 Z" fill="#ff9433"/>`;
  const strap = (from, bend, to) => `<path d="M${from} 38 C${from} 18 ${bend} 12 ${to} 26" stroke="${CARBON}" stroke-width="6" stroke-linecap="round" fill="none"/>`;
  return `<svg class="chooser-art car-art" viewBox="0 0 280 142" aria-hidden="true"><ellipse cx="${CENTER}" cy="${GROUND + 4}" rx="46" ry="4.5" fill="#00000022"/>`
    + strap(132, 116, 108) + strap(148, 164, 172) + tank(104) + tank(148)
    + `<rect x="128" y="34" width="24" height="60" rx="6" fill="${CARBON}"/><circle cx="140" cy="52" r="6" fill="${SUIT}"/><path d="M140 52 L143.5 48" stroke="${CARBON}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}

// A built road car, from the profile its model is lofted through: the glass
// house and its panes between the pillars, the body over them with dark wheel
// wells, the roof, bumpers and lamps at the ends, then the wheels.
function builtCarParts(entry) {
  const shape = entry.shape, { length: l, cabin: [, ch], drop = 0 } = shape;
  const profile = bodyProfile(shape), { body, top, bottom, front, rear, glassRear, roof: [roofFront, roofRear], posts, lamps } = profile;
  const [rf, rr] = body.rake, roofY = 1.22 + ch, radius = WHEEL.radius;
  const draw = pen({ drop }), { slab, shape2d, disc, shadow } = draw;
  // The glass's front and rear edges at a height; a van's panes stop under
  // the header, at the load box.
  const frontEdge = y => front + rf * (y - 1.22) / ch, rearEdge = y => body.cab ? glassRear : rear - rr * (y - 1.22) / ch;
  const paneTop = body.cab ? roofY - .32 : roofY - .04, header = frontEdge(roofY - .3);
  const lefts = [y => frontEdge(y) + .075, ...posts.map(z => () => z + .06)];
  const rights = [...posts.map(z => () => z - .06), y => rearEdge(y) - (body.cab ? .02 : (body.pillar ?? .14) - .025)];
  const house = body.cab ? [[front, 1.22], [header, roofY - .3], [header, roofY], [rear, roofY], [rear, 1.22]]
    : [[front, 1.22], [front + rf, roofY], [rear - rr, roofY], [rear, 1.22]];
  const bumper = body.bumper === undefined ? TRIM : body.bumper, [nose, tail] = body.corner;
  const [, headHeight, , headY] = lamps.head, [, tailHeight, , tailY] = lamps.tail;
  const parts = [
    shadow(l * .55),
    shape2d(house, PAINT),
    ...lefts.map((left, i) => shape2d([[left(1.22), 1.22], [left(paneTop), paneTop], [rights[i](paneTop), paneTop], [rights[i](1.22), 1.22]], GLASS)),
    ...[1, 5].map(i => shape2d(bottom.slice(i, i + 4), '#1c2323')),
    shape2d([...top, ...[...bottom].reverse()], PAINT),
    slab(roofFront - .06, roofRear + (body.cab ? .01 : .06), roofY - .025, roofY + .075, PAINT, 1),
    slab(-l / 2 - .02, -l / 2 + .07, headY - headHeight / 2, headY + headHeight / 2, '#ffeec2', 1),
    ...(body.bed ? [] : [slab(l / 2 - .07, l / 2 + .02, tailY - tailHeight / 2, tailY + tailHeight / 2, '#c4483a', 1)]),
  ];
  if (bumper) for (const [end, corner, arch] of [[-1, nose, bottom[1][0]], [1, tail, bottom[8][0]]]) {
    const reach = Math.min(corner + .1, l / 2 - Math.abs(arch) + .04), low = (end < 0 ? body.nose : body.tail)[0] + .03;
    parts.push(end < 0 ? slab(-l / 2 - .05, -l / 2 + reach, low, low + .18, bumper, 1) : slab(l / 2 - reach, l / 2 + .05, low, low + .18, bumper, 1));
  }
  parts.push(...[-profile.wheelZ, profile.wheelZ].map(z => disc(z, radius + drop, radius, TIRE) + disc(z, radius + drop, radius * .46, HUB)));
  parts.push(...accessories(entry, { ...draw, l, roofY, profile }));
  return parts;
}

function exoticParts() {
  const { slab, shape2d, disc, shadow, px, py, size } = pen();
  const top = EXOTIC_BODY.map(([z, , crown, centre]) => [z, Math.max(crown, centre + .018)]), wing = EXOTIC_WING;
  const line = (points, width, color) => `<polyline points="${points.map(([z, y]) => `${px(z)},${py(y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${size(width)}" stroke-linejoin="bevel"/>`;
  return [
    shadow(2.4),
    shape2d([...top, ...[...EXOTIC_BOTTOM].reverse()], PAINT),
    shape2d([...top.filter(([z]) => z >= .28), ...[...EXOTIC_BOTTOM].reverse().filter(([z]) => z >= .28), [.28, .2]], EXOTIC_DARK),
    shape2d([...EXOTIC_ROOF, [1.82, 1.02], [-.92, 1.02]], EXOTIC_DARK),
    shape2d([...EXOTIC_ROOF.slice(0, 3), [.28, 1.501], [.28, 1.02], [-.92, 1.02]], PAINT),
    shape2d(EXOTIC_WINDOW, '#253436'),
    line([[.245, 1.06], [.12, 1.425]], .043, EXOTIC_DARK),
    line(EXOTIC_SWEEP, .065, EXOTIC_TRIM),
    slab(-.76, .77, .19, .29, CARBON, 0),
    slab(-2.27, -2.05, .13, .235, CARBON, 0),
    slab(-2.13, -2.05, .627, .76, '#ffeec2', 0),
    slab(2.08, 2.14, .738, .818, '#c4483a', 0),
    slab(2.02, 2.24, .13, .235, CARBON, 0),
    slab(wing.z - .065, wing.z + .065, wing.foot, wing.y, CARBON, 0),
    slab(wing.z - wing.depth / 2, wing.z + wing.depth / 2, wing.y - wing.height / 2, wing.y + wing.height / 2, EXOTIC_DARK, 0),
    ...[-1.35, 1.35].map(z => disc(z, WHEEL.radius, WHEEL.radius, TIRE) + disc(z, WHEEL.radius, WHEEL.hubRadius, HUB)),
    slab(-.9025, -.6775, 1.0375, 1.1725, PAINT, 1),
  ];
}

// The wagon, from createClassicCar's measurements: the tub with its bonnet and
// boot stepped up, the glasshouse and pillars under the cream hardtop, squared
// arches over the wheels, and the trim's load. A tall load draws the whole car
// smaller, so the load is framed rather than cut off by the card.
const CREAM = '#f5e8c8';
const WAGON_TOP = { snow: 2.69, plains: 2.95, city: 3.26 };
// The rack's bars run across the hardtop, so the side sees their ends on their feet.
const wagonBars = slab => [-.48, .75].map(z => slab(z - .075, z + .075, 2.11, 2.24, '#5b6663', 1));
function classicParts(entry) {
  const radius = entry.shape.wheelRadius, top = WAGON_TOP[entry.trim] ?? 2.4;
  const draw = pen({ scale: Math.min(SCALE, 126 / top) }), { slab, shape2d, disc, shadow } = draw;
  const parts = [
    shadow(2.2),
    slab(-.83, 1.07, 1.165, 1.975, GLASS, 0),
    ...[-.795, .23, 1.035].map(z => slab(z - .045, z + .045, 1.19, 1.97, PAINT, 0)),
    slab(-.86, 1.14, 1.16, 1.32, PAINT, 0),
    slab(-1.88, -.76, 1.18, 1.42, PAINT, 1),
    slab(1.06, 1.88, 1.17, 1.39, PAINT, 1),
    slab(-1.95, 1.95, .58, 1.22, PAINT, 2),
    slab(-.885, 1.145, 1.96, 2.12, CREAM, 1.5),
    slab(-2.055, -1.885, .57, .71, TRIM, 1),
    slab(1.885, 2.055, .57, .71, TRIM, 1),
    // Lamps drawn a little deeper than they stand out, so they read side on.
    slab(-1.99, -1.87, .92, 1.14, '#ffeec2', 2),
    slab(1.87, 1.99, .95, 1.11, '#c4483a', 2),
    slab(-.715, -.645, 1.355, 1.485, PAINT, 1),
    ...[.06, .7].map(z => slab(z - .1, z + .1, 1.115, 1.165, TRIM, 1)),
  ];
  for (const z of [-1.18, 1.21]) parts.push(
    shape2d([[z - .58, .58], [z - .37, .99], [z + .37, .99], [z + .58, .58]], TIRE),
    shape2d([[z - .7, .58], [z - .46, 1.07], [z + .46, 1.07], [z + .7, .58], [z + .58, .58], [z + .37, .99], [z - .37, .99], [z - .58, .58]], '#00000024'),
    disc(z, radius, radius, TIRE), disc(z, radius, .23, CREAM),
  );
  parts.push(...accessories(entry, draw));
  return parts;
}

// The open-wheeler shares no bodywork with the road cars, so it draws its own
// silhouette back to front: wings, floor, engine cover, then the tub and the
// driver, with the exposed slicks laid over the lot.
function formulaParts(entry) {
  const { slab, shape2d, disc, shadow } = pen({ scale: 50, ground: 112 });
  const radius = entry.shape.wheelRadius, wheelZ = entry.shape.wheelZ;
  const wheel = z => disc(z, radius, radius, TIRE) + disc(z, radius, radius * .44, HUB);
  // The two-seater's sidepods run forward to make its wider tub.
  const pod = entry.taxi ? -1.05 : -.3;
  return [
    shadow(2.55),
    // Rear wing: from the side it is one tall endplate on a pylon from the
    // crash structure, with the upper flap showing as a lighter band across it.
    slab(2.04, 2.22, .42, .96, CARBON, 1),
    slab(1.98, 2.52, .9, 1.34, CARBON, 3),
    slab(2.02, 2.48, 1.14, 1.2, '#4a5457', 1),
    // Front wing's endplate, the flat carbon floor and the diffuser ramping up
    // under the crash structure and its rain light.
    slab(-2.66, -2.1, .12, .44, CARBON, 2),
    slab(-1.55, 2.2, .08, .22, CARBON, 1),
    shape2d([[1.7, .08], [1.7, .2], [2.42, .36], [2.42, .08]], CARBON),
    slab(2.1, 2.42, .3, .44, CARBON, 1),
    slab(2.4, 2.47, .33, .42, '#c4483a', 1),
    // Airbox over the driver's head, its top sweeping back into the engine
    // cover, with the inlet's edge at the front.
    shape2d([[.48, .66], [.5, 1.1], [.62, 1.1], [1.3, .76], [2.1, .58], [2.1, .28], [.48, .28]], PAINT),
    slab(.45, .53, .8, 1.04, VISOR, 1),
    // Nose cone rising through the scuttle to the cockpit surround, with the
    // sidepod alongside sloping away at the back, its inlet, and a dark sill so
    // the two do not read as one slab of paint.
    shape2d([[-2.6, .3], [-2.6, .48], [-1.45, .62], [-.9, .66], [-.9, .26], [-1.62, .24]], PAINT),
    shape2d([[-.9, .22], [-.9, .66], [-.62, .72], [-.55, .8], [.42, .82], [.56, .74], [1.1, .68], [1.1, .2]], PAINT),
    shape2d(entry.taxi ? [[pod, .2], [pod, .62], [.8, .62], [1.3, .42], [1.3, .2]] : [[pod, .2], [pod, .62], [1.25, .4], [1.25, .2]], PAINT),
    slab(-1.1, 2.1, .18, .3, CARBON, 1),
    shape2d([[pod + .01, .32], [pod + .05, .55], [pod + .25, .55], [pod + .19, .32]], VISOR),
    // Cockpit opening inside the raised surround, the driver down in it, and
    // the halo: a pillar ahead of them and a hoop dropping behind their head.
    shape2d([[-.5, .66], [-.44, .78], [.34, .79], [.4, .67]], VISOR),
    disc(-.02, .92, .18, SUIT),
    slab(-.22, -.02, .82, .92, VISOR, 1),
    shape2d([[-.74, .66], [-.64, 1.03], [.08, 1.03], [.4, .72], [.3, .72], [.04, .97], [-.58, .97], [-.66, .66]], CARBON),
    wheel(-wheelZ), wheel(wheelZ),
    ...(entry.taxi ? [
      // Checkers down the tub, the roof sign on its plinth, and lamps on the
      // front wing.
      ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => slab(-.56 + i * .14, -.43 + i * .14, .36 + (i % 2) * .1, .46 + (i % 2) * .1, VISOR, 0)),
      slab(.74, .9, 1, 1.18, PAINT, 0),
      slab(.52, 1.1, 1.16, 1.4, '#fff0b6'),
      '<text x="100" y="54" text-anchor="middle" font-size="8" font-weight="900" fill="#172229">TAXI</text>',
      slab(-2.72, -2.6, .26, .34, '#ffeec2', 1),
    ] : []),
  ];
}

// The specials are drawn one by one from their models' own measurements, each
// at the scale that frames it. A raked cabin is a painted frame with a smaller
// glass house inside it.
const LAMP = '#ffeec2', TAIL = '#c4483a', ENGINE = '#59625f', SEAT = '#3a4441', SHOCK = '#d9a441', AMBER = '#e0a23a', CANVAS = '#e9e2cb', LEATHER = '#8a5a3a';
const cabin = ({ shape2d }, front, rear, bottom, top, rake = .24, inset = .08) => [
  shape2d([[front, bottom], [front + rake, top], [rear - rake / 2, top], [rear, bottom]], PAINT),
  shape2d([[front + inset * 1.6, bottom + inset], [front + rake + inset, top - inset], [rear - rake / 2 - inset, top - inset], [rear - inset, bottom + inset]], GLASS),
];
const tyres = ({ disc }, wheels) => Object.values(wheels).map(({ radius, z }) => disc(z, radius, radius, TIRE) + disc(z, radius, radius * .46, HUB));

const SPECIAL_ART = {
  buggy(shape) {
    const draw = pen({ scale: 54, ground: 124 }), { slab, shape2d, disc, shadow } = draw;
    return [
      shadow(1.9),
      // Cage first, so the tub and the engine sit in front of its feet; the
      // back stays run down to the bumper behind the engine.
      slab(.64, .72, .83, 1.79, CARBON, 1),
      shape2d([[-.94, .9], [-.86, .9], [-.62, 1.79], [-.7, 1.79]], CARBON),
      shape2d([[.63, 1.79], [.73, 1.79], [1.75, .74], [1.65, .74]], CARBON),
      slab(-.7, .72, 1.72, 1.79, CARBON, 1),
      slab(-.7, .6, 1.79, 1.85, PAINT, 2),
      slab(-.69, -.63, 1.84, 1.97, LAMP, 1),
      slab(.43, .57, .84, 1.28, SEAT, 3),
      slab(1.07, 1.69, .74, 1.16, ENGINE, 3), slab(1.25, 1.51, 1.16, 1.42, TRIM, 2),
      slab(1.17, 1.755, .705, .775, CARBON, 1), disc(1.72, .84, .075, TRIM),
      shape2d([[1.7, .84], [1.76, .84], [1.8, 1], [1.74, 1]], TRIM),
      slab(-1, 1.2, .49, .84, PAINT, 4), slab(-.93, -.63, .8, 1.03, PAINT, 2),
      shape2d([[-.93, .49], [-.93, .83], [-1.68, .68], [-1.68, .54]], PAINT),
      slab(-1.045, -.925, .88, 1.08, CARBON, 3), slab(-1.075, -1.025, .895, 1.065, LAMP, 1),
      slab(.7, .78, 1.07, 1.23, TAIL, 1),
      ...tyres(draw, shape.wheels),
    ];
  },
  monster(shape) {
    const draw = pen({ scale: 36, ground: 126 }), { slab, shape2d, shadow } = draw;
    const shocks = z => [-1, 1].map(lean => shape2d([[z - lean * .05, .85], [z + lean * .05, .85], [z + lean * .45, 1.75], [z + lean * .35, 1.75]], SHOCK));
    return [
      shadow(2.6),
      slab(-2.05, 2.05, .98, 1.22, CARBON, 2),
      ...shocks(-1.55), ...shocks(1.55),
      slab(.705, .795, 2, 2.99, CARBON, 1), slab(.71, .81, 2.99, 3.17, CARBON, 1), slab(.63, .74, 3, 3.16, LAMP, 1),
      // The fender line clears the tires; the cab's sills come down between them.
      slab(-2.25, 2.25, 1.73, 2.11, PAINT, 4),
      slab(-.82, .82, 1.45, 1.8, PAINT, 3),
      ...cabin(draw, -1.03, .52, 2.11, 2.81),
      slab(-.84, .46, 2.79, 2.91, PAINT, 2),
      slab(.53, 2.25, 2.11, 2.43, PAINT, 2),
      slab(-.92, -.68, 2.23, 2.41, PAINT, 1),
      slab(-2.41, -2.19, 1.52, 1.76, TRIM, 2), slab(2.19, 2.41, 1.52, 1.76, TRIM, 2),
      slab(-2.3, -2.12, 1.84, 2.04, LAMP, 2), slab(2.12, 2.29, 1.91, 2.33, TAIL, 2),
      ...tyres(draw, shape.wheels),
    ];
  },
  hotrod(shape) {
    const draw = pen({ scale: 52, ground: 116 }), { slab, shape2d, shadow } = draw;
    return [
      shadow(2.3),
      slab(-1.95, 1.95, .45, .6, CARBON, 1), slab(1.9, 1.96, .49, .55, TRIM, 0),
      shape2d([[1.125, .6], [1.125, 1.2], [1.975, 1.015], [1.975, .685]], PAINT),
      slab(-.2, 1.15, .6, 1.2, PAINT, 3),
      // Three-window cab: door glass ahead of a painted back that slopes
      // from the roof down to the deck.
      shape2d([[-.05, 1.2], [.11, 1.56], [.66, 1.56], [.8, 1.2]], GLASS),
      shape2d([[.7, 1.2], [.6, 1.56], [.93, 1.56], [1.145, 1.2]], PAINT),
      slab(.07, .93, 1.55, 1.65, PAINT, 2),
      slab(-1.79, -.17, .6, 1.12, PAINT, 3),
      // Blower and scoop, its mouth to the front.
      slab(-1.28, -.72, 1.1, 1.32, TRIM, 2),
      shape2d([[-1.22, 1.31], [-1.22, 1.53], [-.88, 1.42], [-.88, 1.31]], TRIM),
      slab(-1.235, -1.215, 1.35, 1.51, CARBON, 0),
      // Headers sweeping down the bonnet side into the pipe along the sill.
      ...[0, 1, 2, 3].map(i => -1.25 + i * .2).map(z => shape2d([[z - .04, .86], [z + .04, .86], [z + .18, .64], [z + .1, .64]], TRIM)),
      slab(-1.15, .5, .55, .69, TRIM, 3),
      slab(-1.93, -1.78, .55, 1.21, TRIM, 2),
      // Bucket lamp on its stalk, round tail lamp.
      slab(-1.785, -1.735, .66, .875, TRIM, 0),
      slab(-1.84, -1.68, .87, 1.09, TRIM, 4), slab(-1.855, -1.83, .89, 1.07, LAMP, 1),
      slab(1.97, 2.02, .785, .935, TAIL, 1),
      ...tyres(draw, shape.wheels),
    ];
  },
  rig(shape) {
    const draw = pen({ scale: 32, ground: 128 }), { slab, shape2d, shadow } = draw;
    return [
      shadow(3.75),
      slab(-3.5, 3.6, .6, .9, CARBON, 2),
      slab(1.79, 2.71, .98, 1.1, TRIM, 1), slab(2, 2.5, .89, .99, CARBON, 0),
      slab(3.6, 3.64, .27, .89, CARBON, 1), slab(3.57, 3.65, .88, 1, TRIM, 1),
      // The sleeper's raised roof rises off the cab's in a short slope.
      slab(.25, 1.65, 1.025, 2.875, PAINT, 3),
      shape2d([[.25, 2.86], [.25, 2.905], [.7, 3.175], [1.65, 3.175], [1.65, 2.86]], PAINT),
      slab(.8, 1.3, 2.35, 2.65, GLASS, 1),
      slab(-1.55, .25, 1.025, 1.975, PAINT, 3),
      ...cabin(draw, -1.5, .2, 1.975, 2.725),
      slab(-1.44, .16, 1.96, 2.02, TRIM, 0),
      shape2d([[-1.53, 1.98], [-1.46, 1.98], [-1.22, 2.73], [-1.29, 2.73]], TRIM),
      slab(-.46, -.34, 1.975, 2.725, PAINT, 0),
      slab(-.29, -.01, 1.8, 1.88, TRIM, 1),
      slab(-1.315, .25, 2.72, 2.84, PAINT, 2), slab(-1.28, -1.18, 2.84, 2.91, AMBER, 1),
      shape2d([[-3.45, 1.03], [-3.45, 1.89], [-1.55, 1.975], [-1.55, 1.025]], PAINT),
      slab(.04, .22, 1, 3.5, TRIM, 2),
      slab(-3.56, -3.45, 1.035, 1.885, TRIM, 1), slab(-3.65, -3.4, .55, .85, TRIM, 2),
      slab(-.125, 1.225, .52, 1.12, TRIM, 8),
      slab(-1.2, -.4, .69, .85, TRIM, 1), slab(-1.13, -.47, .94, 1.06, '#59625f', 1),
      slab(-1.615, -1.585, .67, 1.09, CARBON, 0),
      slab(-3.27, -1.55, 1.1, 1.345, PAINT, 3),
      // West Coast mirror standing off the door.
      slab(-1.35, -1.15, 2.02, 2.48, TRIM, 1),
      slab(-3.325, -3.21, 1.08, 1.32, LAMP, 2), slab(3.64, 3.68, .9, .98, TAIL, 1),
      ...tyres(draw, shape.wheels),
    ];
  },
  // The bus's curb side, both doors on it, as busGeometry lays them out
  bus(shape) {
    const draw = pen({ scale: 21, ground: 122 }), { slab, disc, shadow } = draw, half = shape.length / 2;
    const on = -BUS_DOORS.on, off = -BUS_DOORS.off;
    const panes = (from, to, count) => Array.from({ length: count }, (_, i) => {
      const step = (to - from) / count;
      return slab(from + step * i + .06, from + step * (i + 1) - .06, 1.28, 2.62, GLASS, 1);
    });
    return [
      shadow(half + .2),
      ...Object.values(shape.wheels).map(({ radius, z }) => disc(z, radius, radius + .12, '#1c2323')),
      slab(-half, half, .4, 3.06, PAINT, 4),
      slab(-half + .3, half - .3, 3.02, 3.09, CANVAS, 1),
      slab(1.4, 3.8, 3.09, 3.31, TRIM, 1),
      ...panes(on + .68, off - .72, 3), ...panes(off + .72, half - .35, 3),
      slab(on + .68, off - .72, 1.11, 1.21, CANVAS, 0), slab(off + .72, half - .35, 1.11, 1.21, CANVAS, 0),
      ...[on, off].flatMap(z => [slab(z - .55, z + .55, .44, 2.62, CARBON, 1), slab(z - .015, z + .015, .44, 2.62, TRIM, 0)]),
      slab(-half - .05, -half + .3, .31, .57, CARBON, 1), slab(half - .3, half + .05, .33, .59, CARBON, 1),
      slab(-half - .02, -half + .08, .64, .8, LAMP, 1), slab(half - .08, half + .02, .78, 1.33, TAIL, 1),
      slab(-half + .02, -half + .1, 2.2, 2.54, TRIM, 1),
      ...tyres(draw, shape.wheels),
    ];
  },
  micro(shape) {
    const draw = pen({ scale: 58, ground: 126 }), { slab, shape2d, shadow } = draw;
    return [
      shadow(1.35),
      // The bubble in two tiers, a pillar between its windows, and a canvas top.
      shape2d([[-.8, .76], [-.6, 1.12], [-.28, 1.5], [.46, 1.5], [.7, 1.12], [.74, .76]], GLASS),
      slab(.1, .17, .8, 1.5, PAINT, 0),
      slab(-.31, .47, 1.495, 1.545, CANVAS, 2),
      slab(-.18, .38, 1.545, 1.585, CARBON, 1), slab(-.07, .31, 1.58, 1.74, LEATHER, 2),
      slab(.1, .14, 1.575, 1.745, CARBON, 0),
      shape2d([[-1.15, .34], [-1.08, .78], [0, .9], [1.09, .8], [1.15, .34], [0, .32]], PAINT),
      slab(-1.21, -1.11, .38, .46, TRIM, 1), slab(1.11, 1.21, .38, .46, TRIM, 1),
      slab(-1.16, -1.1, .515, .685, LAMP, 3), slab(1.1, 1.15, .56, .68, TAIL, 2),
      ...tyres(draw, shape.wheels),
    ];
  },
};

function accessories(entry, draw) {
  const { slab, shape2d, disc, px, py, size, l, roofY } = draw;
  // A taxi's sign on its foot over the middle of the roof, a little deeper
  // than the model's so its lettering fits, and the checkers along the doors.
  if (entry.taxi) {
    const { roof: [front, rear] } = draw.profile, z = (front + rear) / 2, top = roofY + .075, chequers = taxiChequers(entry.shape);
    return [
      ...(entry.shape.name === 'sports' ? coupeKit(draw) : []),
      slab(z - .22, z + .22, top, top + .04, CARBON, 0),
      slab(z - .2, z + .2, top + .04, top + .34, '#fff0b6', 1),
      `<text x="${px(z)}" y="${py(top + .13)}" text-anchor="middle" font-size="5.6" font-weight="900" fill="#172229">TAXI</text>`,
      ...Array.from({ length: chequers.count }, (_, i) => {
        const z0 = chequers.start + i * chequers.size, y0 = chequers.low + (i % 2) * chequers.size;
        return slab(z0, z0 + chequers.size, y0, y0 + chequers.size, CARBON, 0);
      }),
    ];
  }
  switch (entry.trim ?? entry.shape.name) {
    // A round bale lies on the hardtop between the bars, its wrapped end to
    // the side and a strap round it.
    case 'plains': return [
      ...wagonBars(slab),
      disc(.135, 2.515, .435, '#5e4c33'), disc(.135, 2.515, .42, '#d8b566'),
      disc(.135, 2.515, .36, '#b8964f'), disc(.135, 2.515, .2, '#d8b566'),
    ];
    // A bicycle stands in a wheel tray across the bars, held at its down tube.
    case 'city': {
      const axle = 2.595, bracket = [.08, axle - .04], cluster = [.26, axle + .5], rearHub = [.58, axle];
      const line = (a, b, width, color) => `<line x1="${px(a[0])}" y1="${py(a[1])}" x2="${px(b[0])}" y2="${py(b[1])}" stroke="${color}" stroke-width="${size(width)}" stroke-linecap="round"/>`;
      const frame = (a, b) => line(a, b, .06, '#c9453f');
      const wheel = z => `<circle cx="${px(z)}" cy="${py(axle)}" r="${size(.3)}" fill="none" stroke="#4d5755" stroke-width="${size(.07)}"/>`;
      return [
        ...wagonBars(slab), slab(-.8, .84, 2.24, 2.285, '#4d5755', 0), line([-.16, 2.285], [-.16, axle + .22], .044, '#4d5755'),
        wheel(-.58), wheel(.58),
        frame([-.58, axle], [-.316, axle + .6]), frame([-.36, axle + .5], cluster), frame([-.395, axle + .42], bracket),
        frame(bracket, [.3, axle + .62]), frame(cluster, rearHub), frame(bracket, rearHub),
        disc(.08, axle - .04, .1, '#c9cbb6'),
        slab(.16, .38, axle + .62, axle + .66, '#2f3336', 1), slab(-.334, -.298, axle + .582, axle + .618, '#2f3336', 0),
      ];
    }
    // The board lies on the bars, its stringer along the top.
    case 'coast': return [...wagonBars(slab), slab(-1.61, 1.69, 2.24, 2.35, CREAM, 3), slab(-1.405, 1.445, 2.345, 2.365, PAINT, 0)];
    // The spare hangs on the tail, seen edge on.
    case 'desert': return [slab(1.955, 2.235, .74, 1.7, '#3d4745', 6), slab(2.2, 2.245, .99, 1.45, CREAM, 1)];
    // The roof box, its nose chamfered, on the bars.
    case 'snow': return [
      ...wagonBars(slab),
      shape2d([[-.8, 2.31], [-.66, 2.24], [1, 2.24], [1.06, 2.29], [1.06, 2.54], [-.74, 2.54], [-.8, 2.49]], '#48545c'),
      slab(-.73, .99, 2.54, 2.66, '#536774', 2), slab(-.74, 1, 2.66, 2.685, TRIM, 0),
    ];
    // Two cases on the front bar, a rolled tent strapped to the back one.
    case 'jungle': return [
      ...wagonBars(slab), slab(-.7, -.4, 2.24, 2.58, '#5f6b3f', 2),
      disc(.75, 2.43, .19, '#c9b48b'), disc(.75, 2.43, .07, '#a8946c'),
    ];
    // The default car's rack is empty: its load changes with the scenery.
    case 'classic': return wagonBars(slab);
    // Rails along the estate's roof.
    case 'wagon': {
      const [front, rear] = draw.profile.roof;
      return [slab(front + .06, rear - .06, roofY + .075, roofY + .135, '#3a4441', 1)];
    }
    // The bed's wall, standing on the body behind the cab, with its lamp.
    case 'pickup': {
      const { body, rear } = draw.profile;
      return [
        slab(rear + .06, l / 2, body.bed - body.shoulder[1], body.rail, 'var(--car-paint)', 1),
        slab(l / 2 - .05, l / 2 + .02, body.rail - .32, body.rail - .06, '#c4483a', 1),
      ];
    }
    // A rubbing strip along the load box's flank, between the arches (the
    // front arch's back edge, bottom[4], is at minus the rear arch's front).
    case 'van': {
      const reach = -draw.profile.bottom[4][0] - .1;
      return [slab(-reach, reach, .765, .835, '#46514f', 1)];
    }
    case 'sports': return coupeKit(draw);
    default: return [];
  }
}

// The coupe's splitter, sills and wing on its stalks, as its model has them.
function coupeKit({ slab, l, profile }) {
  const { body, top, bottom } = profile, deck = heightAt(top, l / 2 - .3), sill = -bottom[4][0] - .02;
  return [
    slab(-l / 2 - .11, -l / 2 + .05, body.nose[0] - .005, body.nose[0] + .045, CARBON, 1),
    slab(-sill, sill, body.sill + .01, body.sill + .13, CARBON, 1),
    slab(l / 2 - .35, l / 2 - .25, deck, deck + .17, PAINT, 0),
    slab(l / 2 - .45, l / 2 - .11, deck + .155, deck + .205, PAINT, 1),
  ];
}

// The helicopter, from helicopter.js's measurements: an egg of a cabin, glass
// in front of its door frame and paint behind, the roof fairing, the
// tapering boom and swept tail, and the rotors seen edge on.
function helicopterParts(shape) {
  const draw = pen({ scale: 24, ground: 124 }), { px, py, size, slab, shape2d, disc, shadow } = draw;
  const hub = -1.35, rotor = shape.rotor;
  // A path through points and cubic curves, in the model's meters
  const path = (steps, fill, extra = '') => `<path d="${steps.map(([command, ...points]) => command + points.map(([z, y]) => `${px(z)} ${py(y)}`).join(' ')).join('')}Z" fill="${fill}"${extra}/>`;
  const nose = [-3.52, 1.5], chin = [-3.2, .9], belly = [-1.95, .78], tip = [-.45, 1.8], rim = [-1.37, 2.28], crown = [-2.1, 2.33];
  return [
    shadow(3.2),
    slab(hub - rotor, hub + rotor, 2.815, 2.865, CARBON, 1),
    slab(hub - .07, hub + .07, 2.35, 2.8, CARBON, 0), slab(hub - .17, hub + .17, 2.71, 2.87, HUB, 1),
    // Skids on their struts, turned up at the nose, behind the cabin
    shape2d([[-2.35, .08], [-2.25, .08], [-2.1, 1], [-2.2, 1]], CARBON),
    shape2d([[-.25, .08], [-.15, .08], [-1.15, 1.26], [-1.25, 1.26]], CARBON),
    slab(-2.85, .55, 0, .11, CARBON, 3),
    shape2d([[-2.8, 0], [-2.85, .11], [-3.2, .36], [-3.26, .27]], CARBON),
    // Tail: boom, tailplane, fin and lower fin, and the tail rotor's blur
    shape2d([[-.9, 1.56], [-.9, 2], [3.55, 2.05], [3.55, 1.87]], PAINT),
    slab(2.78, 3.2, 1.875, 1.925, PAINT, 0),
    shape2d([[3, 1.9], [3.5, 2.9], [3.85, 2.9], [3.7, 1.9]], PAINT),
    shape2d([[3.3, 2], [3.55, 1.42], [3.72, 1.42], [3.7, 2]], PAINT),
    disc(3.5, 2.05, .64, '#2b343440'), slab(3.445, 3.555, 1.41, 2.69, CARBON, 1), disc(3.5, 2.05, .07, HUB),
    slab(3.66, 3.82, 2.89, 2.99, '#c4483a', 1),
    // The roof fairing falling onto the boom, and the exhaust under it
    shape2d([[-2, 2.27], [-1.3, 2.42], [-.3, 2.06], [-.3, 1.95], [-2, 1.95]], PAINT),
    shape2d([[-.7, 1.45], [-.7, 1.6], [-.3, 1.54], [-.3, 1.39]], CARBON),
    // The cabin: all glass, then its painted back up to the glass's edge
    // (outlined, so it stands clear of the boom and fairing), the door frame
    // and a glint
    path([['M', nose], ['C', [-3.52, 1.2], [-3.4, 1], chin], ['C', [-3, .8], [-2.9, .78], [-2.7, .78]], ['L', belly], ['C', [-1.3, .78], [-.75, 1.2], tip],
      ['C', [-.6, 2.02], [-.9, 2.22], rim], ['C', [-1.6, 2.31], [-1.85, 2.33], crown], ['C', [-3, 2.33], [-3.52, 1.95], nose]], '#4d737c'),
    path([['M', chin], ['C', [-3, .8], [-2.9, .78], [-2.7, .78]], ['L', belly], ['C', [-1.3, .78], [-.75, 1.2], tip], ['C', [-.6, 2.02], [-.9, 2.22], rim]], PAINT,
      ' stroke="#0000002e" stroke-width="1.2" stroke-linejoin="round"'),
    shape2d([[-2.36, 1.52], [-2.28, 1.52], [-2, 2.34], [-2.08, 2.34]], PAINT),
    `<ellipse cx="${px(-2.9)}" cy="${py(1.95)}" rx="${size(.34)}" ry="${size(.17)}" fill="#ffffff2e"/>`,
    slab(-2.08, -1.92, .73, .81, '#c4483a', 1),
  ];
}

// The plane, from plane-model.js's own tables: the fuselage with its stripe
// and windows, the wing over the cabin on its V struts, the striped rudder,
// the tailplane end on, the propeller edge on, and the fat tires on their
// legs. The wing is its root section drawn a bit thicker. Its cream tip is
// left out: seen end on it sits above the root (the dihedral) and made the
// whole wing look cream.
function planeParts() {
  const draw = pen({ scale: 27, ground: 126 }), { px, py, slab, shape2d, disc, shadow } = draw;
  const { body, windows, wing, lift, struts: { foot: [footX, footY, footZ], reach, spars }, fin, tailplane, elevator, rudder, stripes, hub: [, hubY, hubZ], main, nose } = PLANE_PROFILE;
  // A member from one point to another, `width` along
  const member = ([z0, y0], [z1, y1], width, fill) => shape2d([[z0 - width / 2, y0], [z0 + width / 2, y0], [z1 + width / 2, y1], [z1 - width / 2, y1]], fill);
  // An outline through the fuselage's stations, nose to tail along one edge
  // of each section and back along another
  const band = (top, bottom) => [...body.map(station => [station[0], top(station)]), ...[...body].reverse().map(station => [station[0], bottom(station)])];
  const edge = rudder.map(([y, back]) => [back, y]), foot = [footZ, footY], spar = 2.2 + lift(reach), jury = 2.2 + lift((footX + reach) / 2);
  return [
    shadow(3.4),
    shape2d(fin, PAINT),
    ...[-.62, .2].map(z => member([z, .86], [main.z, main.y], .06, CARBON)),
    slab(nose.z - .045, nose.z + .045, .78, .9, HUB, 0), slab(nose.z - .05, nose.z + .05, .635, .685, CARBON, 0), slab(nose.z - .035, nose.z + .035, nose.radius, .66, CARBON, 0),
    member([-2.62, .9], [-2.42, .78], .06, CARBON),
    shape2d(band(station => station[5][1], station => station[1][1]), PAINT),
    shape2d(band(station => station[3][2], station => station[3][1]), CREAM),
    ...Object.entries(windows).filter(([, faces]) => faces.includes(4)).map(([k]) => {
      const [a, b] = [body[k], body[+k + 1]];
      return shape2d([[a[0], a[4][1]], [a[0], a[5][1]], [b[0], b[5][1]], [b[0], b[4][1]]], '#4d737c');
    }),
    // Struts from the fuselage's side to both spars, and the jury struts
    ...spars.flatMap(z => [member(foot, [z, spar], .075, CREAM), member([(z + footZ) / 2, (spar + footY) / 2], [(z + footZ) / 2, jury], .05, CREAM)]),
    // (outlined, as the helicopter's cabin is, so it stands clear of the cabin's roof)
    `<polygon points="${wing.map(([z, y]) => `${px(z)},${py(2.18 + (y - 2.18) * 1.5)}`).join(' ')}" fill="${PAINT}" stroke="#0000002e" stroke-width="1.2" stroke-linejoin="round"/>`,
    shape2d(tailplane, PAINT), shape2d(tailplane.map(([z, y]) => [3.2 - (3.2 - z) * .55, y]), CREAM),
    shape2d(elevator, PAINT), shape2d(elevator.map(([z, y]) => [3.215 + (z - 3.215) * .65, y]), CREAM),
    shape2d([[3.215, edge[0][1]], [3.215, edge.at(-1)[1]], ...[...edge].reverse()], PAINT),
    ...stripes.map(k => shape2d([[3.215, edge[k][1]], [3.215, edge[k + 1][1]], edge[k + 1], edge[k]], CREAM)),
    slab(3.04, 3.16, 2.715, 2.775, TAIL, 1), slab(.22, .38, .81, .88, TAIL, 1),
    // The propeller edge on, cream at the tips, through the spinner
    slab(hubZ - .045, hubZ + .045, hubY - .86, hubY + .86, CARBON, 1),
    slab(hubZ - .03, hubZ + .03, hubY + .86, hubY + .95, CREAM, 1), slab(hubZ - .03, hubZ + .03, hubY - .95, hubY - .86, CREAM, 1),
    shape2d([[hubZ + .115, hubY - .24], [hubZ + .115, hubY + .24], [hubZ, hubY + .22], [hubZ - .09, hubY + .14], [hubZ - .15, hubY], [hubZ - .09, hubY - .14], [hubZ, hubY - .22]], CREAM),
    disc(main.z, main.y, main.radius, TIRE), disc(main.z, main.y, main.radius * .33, CREAM),
    disc(nose.z, nose.radius, nose.radius, TIRE), disc(nose.z, nose.radius, nose.radius * .33, CREAM),
  ];
}
