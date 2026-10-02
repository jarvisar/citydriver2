// Sound character is independent of the handling model: each car keeps its
// voice, and its gearing comes from how fast the car really goes (see
// gearRatios in model.js). `gears` is how many the sound shifts through,
// `pops` how much a lift-off crackles.
const tourer = { idle: 820, redline: 4200, cylinders: 4, gears: 5, body: 1, rasp: .65, intake: .6, pops: 0, harmonics: [1, .52, .28, .16, .09, .055, .025] };
const voice = changes => ({ ...tourer, ...changes });
export const ENGINES = {
  // The garage's wagons
  coast: voice({}),
  desert: voice({ idle: 730, cylinders: 6, body: 1.35, rasp: .8 }),
  snow: voice({ idle: 780, rasp: .4, intake: .4 }),
  jungle: voice({ idle: 710, redline: 3700, gears: 4, body: 1.5, rasp: .9 }),
  plains: voice({ idle: 740, cylinders: 6, body: 1.2, rasp: .5 }),
  city: voice({ idle: 850, body: .8, rasp: .35, intake: .4 }),
  // A big six with some bark: the cab is the car heard most
  taxi: voice({ idle: 760, redline: 5600, cylinders: 6, body: 1.1, rasp: .75, intake: .85, harmonics: [1, .4, .3, .14, .08, .04] }),
  hatchback: voice({ idle: 920, redline: 5200, body: .6, rasp: .85, intake: .9, harmonics: [1, .35, .42, .15, .13, .06] }),
  sedan: voice({ idle: 720, redline: 4600, cylinders: 6, rasp: .35, harmonics: [1, .25, .15, .08, .04] }),
  wagon: voice({ idle: 780, body: 1.2, rasp: .55 }),
  pickup: voice({ idle: 640, cylinders: 8, gears: 4, body: 1.8, rasp: 1.1, harmonics: [1, .7, .22, .3, .12, .1, .05] }),
  van: voice({ idle: 680, redline: 3500, body: 1.5, rasp: 1.2, intake: .3 }),
  sports: voice({ idle: 980, redline: 6500, cylinders: 6, gears: 6, body: .85, rasp: 1, intake: 1.4, pops: .6, harmonics: [1, .6, .38, .26, .18, .12, .075, .04] }),
  exotic: voice({ idle: 850, redline: 6800, cylinders: 16, gears: 7, body: 1.3, rasp: .7, intake: 1.4, pops: .4, harmonics: [1, .4, .24, .14, .08, .04] }),
  // `open` marks a car with no cabin, so first person hears it unfiltered.
  formula: voice({ idle: 1800, redline: 12500, cylinders: 8, gears: 7, body: .5, rasp: .9, intake: 1.8, pops: .5, harmonics: [1, .48, .24, .13, .06, .03], open: true }),
  buggy: voice({ idle: 900, redline: 5200, body: .7, rasp: 1.3, intake: 1.1, harmonics: [1, .45, .5, .2, .18, .08], open: true }),
  monster: voice({ idle: 700, redline: 4800, cylinders: 8, gears: 4, body: 1.9, rasp: 1.35, intake: 1.2, harmonics: [1, .72, .25, .32, .14, .1, .05] }),
  hotrod: voice({ idle: 760, redline: 6200, cylinders: 8, gears: 4, body: 1.6, rasp: 1.4, intake: 1.7, pops: 1, harmonics: [1, .75, .3, .34, .16, .12, .07, .04], open: true }),
  rig: voice({ idle: 600, redline: 2300, cylinders: 6, gears: 8, body: 2, rasp: .9, intake: .25, harmonics: [1, .8, .35, .3, .1, .05] }),
  // A slow-revving diesel, lower than the truck's
  bus: voice({ idle: 560, redline: 2200, cylinders: 6, gears: 6, body: 2.1, rasp: .8, intake: .2, harmonics: [1, .85, .4, .26, .12, .05] }),
  micro: voice({ idle: 1100, redline: 6000, gears: 4, body: .45, rasp: 1.1, intake: .7, harmonics: [1, .3, .5, .12, .2, .05] }),
  // No gears: a turbine that spools with the rotor, under the blades' beat,
  // `rotor` times a second at full speed (see DriveSoundModel)
  helicopter: voice({ idle: 1200, redline: 2800, cylinders: 6, gears: 1, body: .55, rasp: .3, intake: .5, harmonics: [1, .3, .45, .12, .2, .06], rotor: 17 }),
  // The plane's flat four the same way, its revs following the engine's
  // power, and the propeller's blades beating faster than a rotor's
  plane: voice({ idle: 950, redline: 2700, cylinders: 4, gears: 1, body: .8, rasp: .75, intake: .6, harmonics: [1, .45, .35, .2, .12, .06], rotor: 38 }),
  // On foot (see Walker): no engine at all, only footsteps
  walker: voice({ rasp: 0, intake: 0, silent: true }),
};
const ALIASES = { auto: 'city', taxiGT: 'sports', taxiFormula: 'formula', demolition: 'rig' };
export const engineFor = car => ENGINES[ALIASES[car] ?? car] ?? ENGINES.city;

// The key of the game's cues (F major), so a run of them always agrees
export const ROOT = 53;

export const MIX_PRESETS = {
  balanced: { master: .72, engine: .8, road: .7, ambience: .85, traffic: .65, cues: .7, night: false },
  scenic: { master: .72, engine: .42, road: .5, ambience: 1, traffic: .45, cues: .7, night: false },
  night: { master: .55, engine: .6, road: .45, ambience: .65, traffic: .4, cues: .7, night: true },
};
export const MIX_CHANNELS = ['master', 'engine', 'road', 'ambience', 'traffic', 'cues'];
export function sanitizeMix(value) {
  const mix = { ...MIX_PRESETS.balanced };
  if (!value || typeof value !== 'object') return mix;
  for (const channel of MIX_CHANNELS) if (typeof value[channel] === 'number' && Number.isFinite(value[channel])) mix[channel] = Math.max(0, Math.min(1, value[channel]));
  if (typeof value.night === 'boolean') mix.night = value.night;
  return mix;
}
