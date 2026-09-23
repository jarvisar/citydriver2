import { carEntry } from './cars.js';

// A side profile drawn from the same numbers the model is built from, so each
// card shows the car the player will actually be driving.
const SCALE = 47, GROUND = 130, CENTER = 140;
const PAINT = 'var(--car-paint)', GLASS = '#3d5b63', TIRE = '#2b3434', HUB = '#bfc4b9', TRIM = '#b9bfb4';
const CARBON = '#2e3538', VISOR = '#161b1d', SUIT = '#e7e3d5';

// Drawing helpers in the car's own metres: z runs from the nose at the right to
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
  const parts = entry.kind === 'formula' ? formulaParts(entry) : entry.kind === 'special' ? SPECIAL_ART[entry.shape.name](entry.shape) : roadCarParts(entry);
  return `<svg class="chooser-art car-art" viewBox="0 0 280 142" aria-hidden="true">${parts.join('')}</svg>`;
}

function roadCarParts(entry) {
  const shape = entry.shape;
  const { length: l, cabin: [, cabinHeight, cabinLength], cabinZ: cz, drop = 0 } = shape;
  const cabinY = shape.cabinY ?? 1.22, roofY = cabinY + cabinHeight;
  const radius = shape.wheelRadius ?? .43, wheelZ = shape.wheelZ ?? l * .3;
  const draw = pen({ drop }), { slab, shape2d, disc, shadow } = draw;
  const wheel = z => disc(z, radius + drop, radius, TIRE) + disc(z, radius + drop, radius * .46, HUB);
  const glassInset = .09;
  const parts = [
    shadow(l * .55),
    slab(-l / 2, l / 2, .565, cabinY, PAINT, 5),
    // Cabin, then a smaller glass house inside it, keeps the faceted look.
    shape2d([[cz - cabinLength / 2, cabinY], [cz - cabinLength / 2 + .24, roofY], [cz + cabinLength / 2 - .12, roofY], [cz + cabinLength / 2, cabinY]], PAINT),
    shape2d([
      [cz - cabinLength / 2 + glassInset, cabinY + glassInset], [cz - cabinLength / 2 + .24 + glassInset, roofY - glassInset],
      [cz + cabinLength / 2 - .12 - glassInset, roofY - glassInset], [cz + cabinLength / 2 - glassInset, cabinY + glassInset],
    ], GLASS),
    slab(-l / 2, l / 2, .6, .72, TRIM, 2),
    // Lamps at each end.
    slab(-l / 2 - .02, -l / 2 + .16, .9, 1.12, '#ffeec2', 2),
    slab(l / 2 - .16, l / 2 + .02, .9, 1.1, '#c4483a', 2),
  ];
  if (entry.kind === 'built') {
    parts.push(
      slab(cz - cabinLength / 2 + .18, cz + cabinLength / 2 - .06, roofY - .025, roofY + .075, PAINT, 1),
      slab(cz + .1, cz + .22, cabinY, roofY, PAINT, 0),
      slab(-l / 2 + .18, l / 2 - .18, .565, .66, PAINT, 0),
      slab(-l / 2 - .06, -l / 2 + .16, .59, .73, CARBON, 1),
      slab(l / 2 - .16, l / 2 + .06, .59, .73, CARBON, 1),
      slab(cz + .26, cz + .5, 1.077, 1.142, TRIM, 1),
    );
    if (shape.name === 'van') parts.push(
      slab(cz + cabinLength / 2 - 2, cz + cabinLength / 2, cabinY + .03, roofY - .03, PAINT, 1),
      slab(cz + cabinLength / 2 - 1.875, cz + cabinLength / 2 - .125, 1.467, 1.512, '#697773', 0),
    );
  }
  // The wheels stand outboard of the bodywork, so they sit over it.
  parts.push(wheel(-wheelZ), wheel(wheelZ));
  parts.push(...accessories(entry, { ...draw, l, cz, cabinLength, roofY, radius }));
  return parts;
}

// The open-wheeler shares no bodywork with the road cars, so it draws its own
// silhouette back to front: wings, floor, engine cover, then the tub and the
// driver, with the exposed slicks laid over the lot.
function formulaParts(entry) {
  const { slab, shape2d, disc, shadow } = pen({ scale: 50, ground: 112 });
  const radius = entry.shape.wheelRadius, wheelZ = entry.shape.wheelZ;
  const wheel = z => disc(z, radius, radius, TIRE) + disc(z, radius, radius * .44, HUB);
  return [
    shadow(2.55),
    // Rear wing: from the side it is one tall endplate on a central pylon, with
    // the upper flap showing as a lighter band across it.
    slab(2.06, 2.24, .52, .96, CARBON, 1),
    slab(1.98, 2.52, .9, 1.34, CARBON, 3),
    slab(2.02, 2.48, 1.14, 1.2, '#4a5457', 1),
    // Front wing and its endplate, at the other end of the flat carbon floor.
    slab(-2.56, -2, .14, .26, CARBON, 1),
    slab(-2.64, -2.46, .08, .4, CARBON, 2),
    slab(-1.55, 2.2, .08, .22, CARBON, 1),
    slab(2.02, 2.42, .08, .4, CARBON, 2),
    // Engine cover falling away behind the airbox.
    shape2d([[.95, .62], [.95, .98], [2.1, .56], [2.1, .28], [.95, .28]], PAINT),
    shape2d([[.42, .66], [.55, 1.12], [1, 1.12], [1.15, .62]], PAINT),
    shape2d([[.45, .75], [.55, 1.06], [.67, 1.06], [.58, .75]], VISOR),
    // Nose cone tapering back into the tub, with the sidepod alongside and a
    // dark sill so the two do not read as one slab of paint.
    shape2d([[-2.6, .3], [-2.6, .48], [-1.45, .62], [-.9, .66], [-.9, .26], [-1.62, .24]], PAINT),
    shape2d([[-.9, .22], [-.9, .66], [-.62, .72], [-.55, .8], [.42, .82], [.56, .74], [1.1, .68], [1.1, .2]], PAINT),
    slab(-1.05, 1.25, .22, .58, PAINT, 4),
    slab(-1.1, 2.1, .18, .3, CARBON, 1),
    shape2d([[-1.04, .32], [-1, .55], [-.8, .55], [-.86, .32]], VISOR),
    // Cockpit opening inside the raised surround, the driver down in it, and
    // the halo hoop over the top.
    shape2d([[-.5, .66], [-.44, .78], [.34, .79], [.4, .67]], VISOR),
    disc(-.02, .92, .18, SUIT),
    slab(-.27, -.06, .84, .96, VISOR, 1),
    shape2d([[-.72, .66], [-.62, 1.02], [.5, 1.02], [.5, .95], [-.53, .95], [-.62, .66]], CARBON),
    // Running lamp in the nose, rain light on the rear wing.
    slab(-2.64, -2.5, .34, .46, '#ffeec2', 2),
    slab(2.18, 2.32, 1, 1.14, '#c4483a', 2),
    wheel(-wheelZ), wheel(wheelZ),
    ...(entry.taxi ? [slab(.5, 1.08, 1.12, 1.37, '#fff0b6'), '<text x="100" y="52" text-anchor="middle" font-size="8" font-weight="900" fill="#172229">TAXI</text>'] : []),
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
    const draw = pen({ scale: 54, ground: 124 }), { slab, shape2d, shadow } = draw;
    return [
      shadow(1.9),
      // Cage first, so the tub and the engine sit in front of its feet.
      slab(.64, .72, .83, 1.79, CARBON, 1),
      shape2d([[-.94, .9], [-.86, .9], [-.62, 1.79], [-.7, 1.79]], CARBON),
      shape2d([[.64, 1.79], [.72, 1.79], [1.4, 1], [1.3, 1]], CARBON),
      slab(-.7, .72, 1.72, 1.79, CARBON, 1),
      slab(-.6, .6, 1.79, 1.86, PAINT, 2),
      slab(-.73, -.64, 1.85, 1.98, LAMP, 1),
      slab(.43, .57, .88, 1.44, SEAT, 3), slab(-.05, .45, .81, .95, SEAT, 2),
      slab(1.07, 1.69, .74, 1.16, ENGINE, 3), slab(1.55, 1.65, 1.05, 1.6, TRIM, 1),
      slab(-1, 1.2, .49, .83, PAINT, 4), slab(-.93, -.63, .8, 1.03, PAINT, 2),
      shape2d([[-.93, .49], [-.93, .83], [-1.68, .68], [-1.68, .54]], PAINT),
      slab(-1.04, -.93, .88, 1.08, LAMP, 2), slab(.7, .78, 1.07, 1.23, TAIL, 1),
      ...tyres(draw, shape.wheels),
    ];
  },
  monster(shape) {
    const draw = pen({ scale: 36, ground: 126 }), { slab, shape2d, shadow } = draw;
    const shocks = z => [-1, 1].map(lean => shape2d([[z + lean * .36, .85], [z + lean * .27, .85], [z + lean * .02, 1.5], [z + lean * .11, 1.5]], SHOCK));
    return [
      shadow(2.6),
      slab(-2.05, 2.05, .98, 1.22, CARBON, 2),
      ...shocks(-1.55), ...shocks(1.55),
      slab(.7, .8, 2.11, 3, CARBON, 1), slab(.64, .86, 2.99, 3.17, LAMP, 2),
      slab(-2.25, 2.25, 1.45, 2.11, PAINT, 5),
      ...cabin(draw, -1.03, .52, 2.11, 2.81),
      slab(-.84, .46, 2.79, 2.91, PAINT, 2),
      slab(.53, 2.25, 2.11, 2.43, PAINT, 2),
      slab(-2.41, -2.19, 1.28, 1.52, TRIM, 2), slab(2.19, 2.41, 1.28, 1.52, TRIM, 2),
      slab(-2.28, -2.1, 1.74, 1.98, LAMP, 2), slab(2.1, 2.28, 1.65, 1.95, TAIL, 2),
      ...tyres(draw, shape.wheels),
    ];
  },
  hotrod(shape) {
    const draw = pen({ scale: 52, ground: 116 }), { slab, shape2d, disc, shadow } = draw;
    return [
      shadow(2.3),
      slab(-1.95, 1.95, .45, .59, CARBON, 1),
      shape2d([[1.125, .6], [1.125, 1.2], [1.975, 1.015], [1.975, .685]], PAINT),
      slab(-.2, 1.15, .6, 1.2, PAINT, 3),
      ...cabin(draw, -.05, .95, 1.2, 1.56, .16, .06),
      slab(.07, .93, 1.55, 1.65, PAINT, 2),
      slab(-1.79, -.17, .6, 1.12, PAINT, 3),
      slab(-1.3, -.7, 1.11, 1.37, TRIM, 2), slab(-1.28, -.85, 1.37, 1.53, CARBON, 2),
      // Header stubs down the bonnet side, into the pipe along the sill.
      ...[0, 1, 2, 3].map(i => disc(-1.45 + i * .28, .84, .06, TRIM)),
      slab(-1.35, .65, .55, .69, TRIM, 3),
      slab(-1.93, -1.78, .55, 1.21, TRIM, 2),
      slab(-1.87, -1.69, .87, 1.09, LAMP, 4), slab(1.94, 2.02, .81, .95, TAIL, 1),
      ...tyres(draw, shape.wheels),
    ];
  },
  rig(shape) {
    const draw = pen({ scale: 32, ground: 128 }), { slab, shape2d, shadow } = draw;
    return [
      shadow(3.75),
      slab(-3.5, 3.6, .6, .9, CARBON, 2),
      slab(1.79, 2.71, .96, 1.08, TRIM, 1), slab(3.61, 3.65, .45, .95, CARBON, 1),
      slab(.25, 1.65, 1.025, 2.875, PAINT, 3),
      shape2d([[.25, 2.86], [.25, 2.97], [1.65, 3.37], [1.65, 2.86]], PAINT),
      slab(-1.55, .25, 1.025, 1.975, PAINT, 3),
      ...cabin(draw, -1.5, .2, 1.975, 2.725),
      slab(-1.44, .16, 1.96, 2.02, TRIM, 0),
      shape2d([[-1.53, 1.98], [-1.46, 1.98], [-1.22, 2.73], [-1.29, 2.73]], TRIM),
      slab(-.46, -.34, 1.975, 2.725, PAINT, 0),
      slab(-.29, -.01, 1.8, 1.88, TRIM, 1),
      slab(-1.315, .135, 2.72, 2.84, PAINT, 2), slab(-1.28, -1.18, 2.84, 2.91, AMBER, 1),
      shape2d([[-3.45, 1.03], [-3.45, 1.89], [-1.55, 1.975], [-1.55, 1.025]], PAINT),
      slab(.04, .22, 1.1, 3.4, TRIM, 2),
      slab(-3.56, -3.45, 1.035, 1.885, TRIM, 1), slab(-3.65, -3.4, .55, .85, TRIM, 2),
      slab(-.125, 1.225, .52, 1.12, TRIM, 8),
      slab(-1.2, -.4, .69, .85, TRIM, 1), slab(-1.13, -.47, .94, 1.06, '#59625f', 1),
      slab(-3.275, -1.725, 1.1, 1.345, PAINT, 3),
      slab(-3.325, -3.21, 1.08, 1.32, LAMP, 2), slab(3.6, 3.65, .7, .86, TAIL, 1),
      ...tyres(draw, shape.wheels),
    ];
  },
  micro(shape) {
    const draw = pen({ scale: 58, ground: 126 }), { slab, shape2d, shadow } = draw;
    return [
      shadow(1.35),
      shape2d([[-.8, .94], [-.5, 1.54], [.55, 1.54], [.7, .94]], GLASS),
      slab(.06, .14, .94, 1.54, PAINT, 1),
      slab(-.46, .52, 1.52, 1.6, CANVAS, 2),
      slab(-.3, .5, 1.6, 1.65, CARBON, 1), slab(-.25, .45, 1.65, 1.87, LEATHER, 2),
      slab(-.13, -.08, 1.65, 1.87, CARBON, 0), slab(.27, .32, 1.65, 1.87, CARBON, 0),
      shape2d([[-1.15, .43], [-1.15, .85], [-.5, .94], [.5, .94], [1.15, .88], [1.15, .4], [.5, .34], [-.5, .34]], PAINT),
      slab(-1.21, -1.11, .38, .46, TRIM, 1), slab(1.11, 1.21, .38, .46, TRIM, 1),
      slab(-1.2, -1.1, .64, .84, LAMP, 3), slab(1.1, 1.2, .68, .8, TAIL, 1),
      ...tyres(draw, shape.wheels),
    ];
  },
};

function accessories(entry, draw) {
  const { slab, shape2d, disc, px, py, size, l, cz, cabinLength, roofY, radius } = draw;
  if (entry.taxi) return [
    slab(-.25, .25, roofY + .04, roofY + .49, '#fff0b6'),
    `<text x="${px(0)}" y="${py(roofY + .18)}" text-anchor="middle" font-size="7" font-weight="900" fill="#172229">TAXI</text>`,
    ...Array.from({ length: 10 }, (_, i) => slab(-.8 + i * .17, -.64 + i * .17, .88 + (i % 2) * .14, 1.02 + (i % 2) * .14, CARBON, 0)),
  ];
  const rack = (front, rear) => slab(front, rear, roofY, roofY + .09, '#3a4441', 1);
  switch (entry.trim ?? entry.shape.name) {
    // A round bale lying across the rack shows its wrapped end from the side.
    case 'plains': return [
      rack(cz - .9, cz + .9),
      disc(cz + .05, roofY + .51, .42, '#d8b566'),
      disc(cz + .05, roofY + .51, .24, '#c4a058'),
      disc(cz + .05, roofY + .51, .08, '#d8b566'),
      slab(cz - .5, cz + .6, roofY + .09, roofY + .14, '#6b5a3c', 1),
    ];
    // A bicycle stands on the rack for the city: two wheels and a frame.
    case 'city': {
      const wheel = z => `<circle cx="${px(z)}" cy="${py(roofY + .42)}" r="${size(.32)}" fill="none" stroke="#2f3336" stroke-width="2.2"/>`;
      const tube = (a, b) => `<line x1="${px(a[0])}" y1="${py(a[1])}" x2="${px(b[0])}" y2="${py(b[1])}" stroke="#c9453f" stroke-width="2.4" stroke-linecap="round"/>`;
      return [
        rack(cz - .9, cz + .9),
        wheel(cz - .58), wheel(cz + .58),
        tube([cz - .58, roofY + .42], [cz - .2, roofY + .95]), tube([cz - .2, roofY + .95], [cz + .32, roofY + .95]),
        tube([cz + .32, roofY + .95], [cz + .58, roofY + .42]), tube([cz - .2, roofY + .95], [cz + .12, roofY + .42]), tube([cz + .12, roofY + .42], [cz + .58, roofY + .42]),
        slab(cz - .34, cz - .1, roofY + 1.02, roofY + 1.08, '#2f3336', 1),
      ];
    }
    case 'coast': return [
      rack(cz - .9, cz + .9),
      shape2d([[cz - 1.45, roofY + .09], [cz - 1.2, roofY + .3], [cz + 1.2, roofY + .3], [cz + 1.45, roofY + .09]], '#f5e8c8'),
    ];
    case 'desert': return [
      slab(l / 2 + .02, l / 2 + .32, 1.22 - radius, 1.22 + radius, '#303b36', 6),
      `<circle cx="${px(l / 2 + .17)}" cy="${py(1.22)}" r="${size(radius * .46)}" fill="#f5e8c8"/>`,
    ];
    case 'snow': return [rack(cz - .95, cz + .95), slab(cz - .85, cz + .95, roofY + .06, roofY + .44, '#48545c', 4)];
    case 'jungle': return [
      rack(cz - .95, cz + .95),
      slab(cz - .8, cz - .1, roofY + .06, roofY + .38, '#5f6b3f', 2),
      slab(cz + .15, cz + .9, roofY + .06, roofY + .42, '#c9b48b', 5),
    ];
    // The default car carries an empty rack: its kit changes with the scenery.
    case 'classic': return [rack(cz - .9, cz + .9)];
    case 'wagon': return [rack(cz - 1.1, cz + 1.1)];
    case 'pickup': return [
      slab(cz + cabinLength / 2, l / 2, 1.22, 1.62, 'var(--car-paint)', 2),
      slab(cz + cabinLength / 2 + .08, l / 2 - .08, 1.24, 1.32, '#414c4b', 1),
    ];
    case 'sports': return [
      slab(l / 2 - .5, l / 2 - .1, 1.24, 1.44, '#2f3a3c', 1),
      slab(l / 2 - .62, l / 2 + .02, 1.44, 1.53, '#2f3a3c', 2),
    ];
    default: return [];
  }
}
