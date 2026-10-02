// The garage's paint counter. Twelve mixed colours keep a repainted car inside
// the game's slightly dusty, faceted palette; the custom well covers anything
// else. One colour dresses the whole garage rather than a car at a time, and
// Default hands every car the finish it arrived in back. It is saved with
// the fleet, since a new colour costs PAINT_PRICE.
export const PAINTS = [
  { name: 'Sunset Coral', color: '#d96143' },
  { name: 'Signal Red', color: '#b8232f' },
  { name: 'Clementine', color: '#e08a33' },
  { name: 'Desert Mustard', color: '#e0b44a' },
  { name: 'Sage Green', color: '#78977b' },
  { name: 'Forest Green', color: '#3f6b4a' },
  { name: 'Sea Glass', color: '#6fa9c2' },
  { name: 'Midnight Blue', color: '#2f4a6d' },
  { name: 'Alpine Ice', color: '#9fc4d5' },
  { name: 'Deep Plum', color: '#6b4a6b' },
  { name: 'Bone White', color: '#e7e3d5' },
  { name: 'Graphite', color: '#4a5257' },
];

// The one swatch that is not a colour: it clears whatever the garage is wearing.
export const DEFAULT_PAINT = 'default';
export const DEFAULT_PAINT_NAME = 'Each car’s own colour';
// The Konami code's paint: the car runs through every hue (see
// ActorMotion.updatePaint). Its swatch is a wheel of them.
export const RAINBOW_PAINT = 'rainbow', RAINBOW_NAME = 'Rainbow';
export const RAINBOW_SWATCH = 'conic-gradient(#ff4d4d, #ffd84d, #5ee05e, #4dd8ff, #6a5cff, #ff4dd2, #ff4d4d)';
// A new colour costs this much (going back to the cars' own is free)
export const PAINT_PRICE = 100;

const HEX = /^#[0-9a-f]{6}$/i;
export const isPaint = value => typeof value === 'string' && HEX.test(value);
// A swatch either names a colour or asks for the cars' own finishes back.
export const readPaint = value => (isPaint(value) ? value.toLowerCase() : null);
export const paintName = color => PAINTS.find(paint => paint.color === color)?.name ?? null;
