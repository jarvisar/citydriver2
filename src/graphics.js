// Graphics quality: what each level renders, how a device's starting level is
// guessed, and the adaptive controller that keeps the frame rate near the
// display's refresh rate.
//
// A level changes the drawing buffer's density, the sun shadow's detail, and
// how much of the route stays built around the car. AO (soft shading) is a
// separate setting that no preset switches. The player's own choice always
// stands; without one it is on only on hardware that affords it comfortably
// (see setGpu), and the first thing given up if it proves too slow (see
// judge). While it is on it costs what the level can afford: it is drawn from
// the same drawing buffer, so it shrinks with `density`, and `aoQuality`
// bounds it on dense screens.
// Lighting and the city layout are identical at
// every level; distant models replace decoration outside the detail range. Nothing here
// changes the shader light counts, which would make the browser recompile every
// program mid-drive.

// `density` is a fraction of the device's own pixel ratio, not a ceiling on it:
// a ceiling leaves a 1x laptop panel, the display that needs help most, at
// exactly 1x on every level. A fraction removes pixels on every display.
//
// High keeps a wider square of detailed city blocks. Lower levels use fewer
// furnished blocks, with a cheap distant skyline covering the same camera views.
//
// The sun's shadow reaches `shadowDistance` metres from the camera, on a map
// `shadowMap` texels square. A lower level reaches less far rather than only
// blurring: its shadow pass draws fewer casters (about half of every frame's
// draws and triangles are that pass) and a texel stays 9-17 cm, where the old
// fixed reach blurred Basic's to 43. Without `shadowDetail` only buildings,
// trees, vehicles and tall posts cast: people, short street furniture and
// facade trim (window frames, sills, courses), whose shadows are a texel or
// two wide, do not (see SMALL_CASTERS in citydriver-world.js).
export const QUALITY_LEVELS = [
  { id: 'high', label: 'High', summary: 'Full detail · sharp shadows', density: 1, shadowMap: 2048, shadowDistance: 100, shadowDetail: true, chunks: { behind: 3, ahead: 5 }, antialias: true, aoQuality: 'high' },
  { id: 'balanced', label: 'Balanced', summary: '85% resolution · medium shadows', density: .85, shadowMap: 1536, shadowDistance: 80, shadowDetail: true, chunks: { behind: 2, ahead: 4 }, antialias: true, aoQuality: 'high' },
  { id: 'smooth', label: 'Smooth', summary: '70% resolution · nearer shadows', density: .7, shadowMap: 1024, shadowDistance: 60, shadowDetail: false, chunks: { behind: 2, ahead: 4 }, antialias: true, aoQuality: 'low' },
  { id: 'basic', label: 'Basic', summary: '50% resolution · near shadows · nearby detail', density: .5, shadowMap: 512, shadowDistance: 45, shadowDetail: false, chunks: { behind: 1, ahead: 3 }, antialias: false, aoQuality: 'low' },
];
// On a graphics card of its own (see dedicatedGpu) High's shadows reach to the
// fog and stay sharper. A headset draws every frame twice and can look any
// way: its shadows reach round the head (see fitSunShadowAround), and a
// standalone one's, from a phone's chip, are nearer and from big casters only.
export const DEDICATED_HIGH_SHADOWS = { shadowMap: 4096, shadowDistance: 140 };
export const HEADSET_SHADOWS = {
  dedicated: { shadowMap: 2048, shadowDistance: 90, shadowDetail: true },
  standalone: { shadowMap: 1024, shadowDistance: 50, shadowDetail: false },
};
// In a headset the controller steps through its own ladder, best rung first.
// A rung is a level (in VR that sets how much of the city is built and the sun's
// shadows) and the share of each eye's framebuffer drawn (XRView.requestViewportScale).
// .7 of each side is half the pixels, about a Quest's own resolution under the
// 1.5 framebuffer scale. A standalone headset stops at Balanced, since High draws
// half as far again for both eyes, and it starts one rung down. Smooth is left out
// because in a headset it draws the same city as Balanced. A pinned level only
// adapts the scale.
export const HEADSET_LADDERS = {
  standalone: [['balanced', 1], ['balanced', .85], ['basic', .85], ['basic', .7]],
  dedicated: [['high', 1], ['balanced', 1], ['balanced', .85], ['basic', .85], ['basic', .7]],
};
const HEADSET_SCALES = [1, .85, .7];
// The frame-rate cap's settings, as the pause menu's slider has them: null is
// Auto (see frameCap) and 0 uncapped, which in a browser is the display's own
// rate, the most requestAnimationFrame gives
export const FRAME_CAPS = [null, 30, 60, 72, 90, 120, 144, 0];
// A headset's refresh rate when the player hasn't picked one, and the rate it
// drops to if even the lowest rung can't hold it (see judgeHeadset)
export const HEADSET_RATE = 90, HEADSET_FALLBACK_RATE = 72;
const WORST = QUALITY_LEVELS.length - 1;
export const levelIndex = id => QUALITY_LEVELS.findIndex(level => level.id === id);

// A headset's own browser (Quest, Pico, Wolvic) runs on a phone chip, even
// though a Quest reports a desktop user agent and a fine pointer. Only the user
// agent tells it apart.
export function headsetBrowser(nav = globalThis.navigator ?? {}) {
  return /OculusBrowser|PicoBrowser|Wolvic|\bVR Safari\b|Mobile VR/.test(nav.userAgent ?? '');
}

const MIN_DENSITY = .5;
export function renderScale(density, devicePixelRatio = globalThis.devicePixelRatio || 1) {
  return devicePixelRatio * Math.max(MIN_DENSITY, Math.min(1, density));
}

// Multiplying native density alone still overloads 3x phones and 4K displays.
// Presets bound both pixel density and total framebuffer area. An explicit
// slider choice can still request native resolution, independently of Auto.
export const PIXEL_BUDGETS = {
  high: { ratio: 2, pixels: 3840000 }, balanced: { ratio: 1.5, pixels: 2073600 },
  smooth: { ratio: 1.25, pixels: 1280000 }, basic: { ratio: 1, pixels: 640000 },
};
export function drawingPixelRatio(settings, devicePixelRatio, width, height) {
  const native = renderScale(settings.density, devicePixelRatio);
  if (settings.customDensity) return native;
  const budget = PIXEL_BUDGETS[settings.id] ?? PIXEL_BUDGETS.high;
  return Math.min(native, budget.ratio, Math.sqrt(budget.pixels / Math.max(1, width * height)));
}

// Measure over windows long enough to average a stutter, and ignore the first
// moments after any change while buffers, shaders and streaming settle.
const WINDOW_MS = 1500, SETTLE_MS = 2000, FIRST_SETTLE_MS = 4000;
// 59.5 would read a 59.94 Hz display as slow; 0.92 leaves room for that and for
// the odd dropped frame without reacting to a single hitch.
const SLOW = .92, FAST = .97;
const SLOW_WINDOWS = 2, FAST_WINDOWS = 4;
// A step down that changes almost nothing means something other than the scene
// is setting the pace: a capped display, a busy CPU, or a throttled browser.
// It takes two such steps to say so: one ineffective level change is not
// enough to conclude that cheaper graphics cannot help this device.
const WORTHWHILE = 1.04, GIVE_UP_AFTER = 2;

const STORAGE_KEY = 'citydriver.graphics';

function readStored(storage) {
  try { return JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') ?? {}; }
  catch { return {}; }
}
function writeStored(storage, value) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* private mode, quota, or no storage */ }
}
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// Whatever the machine is, it is drawing this scene on the CPU and needs the
// cheapest picture there is.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;
// The integrated chips that ship in laptops and small desktops. Apple's are
// deliberately absent — they share memory with the CPU but are not slow — and
// so is Mesa, which drives plenty of discrete cards on Linux.
const INTEGRATED_RENDERER = /intel|\buhd\b|\biris\b|hd graphics|vega \d|radeon\(tm\) graphics/i;

// The graphics card's name, as the browser gives it: Chrome, Edge and the
// desktop app give the real one (through WEBGL_debug_renderer_info), Firefox a
// near one ("NVIDIA GeForce GTX 980, or similar"), Safari just "Apple GPU".
export function gpuName(gl) {
  const name = String(gl.getParameter(gl.RENDERER) ?? '');
  // Chrome only names it through the extension (Firefox has the real one in
  // RENDERER, and warns about the extension).
  if (name !== 'WebKit WebGL') return name;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '') : name;
}

// Graphics cards of their own, known to draw well past 60 frames a second:
// NVIDIA's RTX cards and GTX 960 on, AMD's Radeon RX, Pro and VII cards,
// Intel's Arc A and B cards, and Apple's Pro, Max and Ultra chips.
const DEDICATED = [
  /\bRTX\b/, /\bGTX (9[6-8]0|10[5-8]0|16[5-6]0)/, /\bTITAN\b/i,
  /\bRadeon (RX|Pro|VII)\b/, /\bArc\b(\(TM\))? [AB]\d{3}/, /\bApple M\d+ (Pro|Max|Ultra)\b/,
];
// And what those match that isn't one: the graphics built into AMD's
// processors ("Radeon RX Vega 11 Graphics").
const BUILT_IN = [/\bVega \d+ Graphics\b/, /\bRX Vega (3|6|8|9|10|11)\b/];

// Whether a card is a dedicated one (see DEDICATED). Nothing else is taken to
// be: phones and tablets, the Steam Deck, graphics built into a processor,
// software drawing, and anything the browser won't name.
export function dedicatedGpu(name) {
  return DEDICATED.some(pattern => pattern.test(name)) && !BUILT_IN.some(pattern => pattern.test(name));
}

// What the browser will actually draw with. Cores and memory cannot tell a
// laptop's integrated chip from the discrete card in a tower, and that is the
// difference this scene feels most, so ask the GPU for its own name.
export function probeRenderer(createCanvas = () => globalThis.document?.createElement('canvas')) {
  try {
    const canvas = createCanvas();
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!gl) return '';
    const name = gpuName(gl);
    // Release it at once: browsers allow only a handful of live contexts, and
    // the game still needs one of them.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

// How many pixels the display would ask for at full density. A 4K panel is four
// 1080p frames, which is a bigger difference between two desktops than anything
// their processors report.
function displayPixels() {
  const screen = globalThis.screen;
  if (!screen?.width) return 0;
  const ratio = globalThis.devicePixelRatio || 1;
  return screen.width * screen.height * ratio * ratio;
}

// Phones, tablets and headsets. A coarse primary pointer also catches tablets
// that report themselves as desktops. A touchscreen laptop keeps a fine primary
// pointer and is tiered with the other laptops.
export function mobileDevice(hints = {}) {
  const nav = hints.navigator ?? globalThis.navigator ?? {};
  const coarsePointer = hints.coarsePointer ?? Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);
  return hints.mobile ?? (headsetBrowser(nav) || nav.userAgentData?.mobile === true || coarsePointer);
}
// A first guess from what the browser will tell us. Deliberately cautious: the
// controller below raises the level within a few seconds when the device turns
// out to be quick, which looks better than starting too high and stuttering
// through the first corner. Desktops are tiered too, so a thin laptop with an
// integrated chip does not start where a tower with a discrete card does.
export function detectLevel(hints = {}) {
  const nav = hints.navigator ?? globalThis.navigator ?? {};
  const mobile = mobileDevice(hints);
  const cores = hints.cores ?? nav.hardwareConcurrency ?? 0;
  // Safari reports no deviceMemory at all, so absent is treated as "unknown"
  // rather than "small"; getting it wrong costs a few seconds of adapting.
  const memory = hints.memory ?? nav.deviceMemory ?? 0;
  if (mobile) {
    if (cores >= 6 && (memory === 0 || memory >= 4)) return 1;
    if (cores >= 4 && memory !== 0 && memory < 2) return WORST;
    if (cores >= 4) return 2;
    return WORST;
  }
  const gpu = hints.gpu ?? probeRenderer();
  if (SOFTWARE_RENDERER.test(gpu)) return WORST;
  // One step down per signal that this is not a machine built to draw. Each is
  // weak on its own and none is worth much argument: a level costs a few
  // seconds to win back, and stuttering through the opening mile does not.
  let steps = 0;
  if (INTEGRATED_RENDERER.test(gpu)) steps++;
  if (cores !== 0 && cores <= 4) steps++;
  if (memory !== 0 && memory <= 4) steps++;
  if ((hints.pixels ?? displayPixels()) >= 4e6) steps++;
  return Math.min(steps, WORST);
}

export class Graphics {
  constructor({ storage = defaultStorage(), ambientOcclusion = null, detect = detectLevel, mobile = mobileDevice() } = {}) {
    const stored = readStored(storage);
    this.storage = storage; this.mobile = mobile;
    this.listeners = new Set();
    this.detected = detect();
    const storedLevel = levelIndex(stored.level);
    this.level = storedLevel === -1 ? this.detected : storedLevel;
    this.mode = QUALITY_LEVELS.some(level => level.id === stored.mode) ? stored.mode : 'auto';
    if (this.mode !== 'auto') this.level = levelIndex(this.mode);
    // AO follows a saved true or false, the player's own choice, whatever the
    // hardware, and otherwise the device's default (see setGpu). Every save
    // from when AO was opt-in holds false, chosen or not: it is kept, since it
    // might be a choice. (The older preset defaults, null and softShading, are
    // none.) `?ao=0` turns it off for this visit, unsaved.
    this.aoChoice = typeof stored.ambientOcclusion === 'boolean' ? stored.ambientOcclusion : null;
    this.aoVisit = ambientOcclusion;
    this.aoCapable = false; this.dedicated = false; this.headset = false;
    // xrScale is the share of each eye's framebuffer drawn. page holds the page's
    // level and controller state while a headset is on.
    this.xrScale = 1; this.page = this.ladder = null;
    // The default proved too slow here, so the next visit starts without it.
    this.aoDropped = stored.aoDropped === true;
    this.densityOverride = Number.isFinite(stored.density) && stored.density >= MIN_DENSITY && stored.density <= 1 ? stored.density : null;
    // The player's frame-rate cap and headset refresh rate, null for none (Auto)
    this.capChoice = FRAME_CAPS.includes(stored.frameCap) ? stored.frameCap : null;
    this.rateChoice = Number.isFinite(stored.headsetRate) && stored.headsetRate > 0 ? stored.headsetRate : null;
    this.cap = null;
    // Never probe above the level a downgrade settled on, so quality ratchets
    // one way and the picture cannot flicker between two levels all drive.
    this.ceiling = 0;
    this.target = 60;
    this.cascade = null;
    this.suspend(FIRST_SETTLE_MS);
  }

  get auto() { return this.mode === 'auto'; }
  get levelId() { return QUALITY_LEVELS[this.level].id; }
  get ambientOcclusion() { return this.aoVisit ?? this.aoChoice ?? (this.aoCapable && !this.aoDropped); }
  // On only because it is the default: the one thing the controller may take.
  get aoByDefault() { return this.aoVisit === null && this.aoChoice === null && this.ambientOcclusion; }
  get settings() {
    return { ...QUALITY_LEVELS[this.level], ...this.shadows, density: this.densityOverride ?? QUALITY_LEVELS[this.level].density,
      customDensity: this.densityOverride !== null, ambientOcclusion: this.ambientOcclusion };
  }
  // The level's shadow, sharpened on a dedicated card, lightened in a headset
  // (see HEADSET_SHADOWS): never more than the level's own. Below High a phone
  // keeps only the big casters. Shadows a texel or two wide don't show on a phone
  // screen, and at Balanced most of the shadow pass was window trim and people.
  get shadows() {
    const level = QUALITY_LEVELS[this.level];
    let { shadowMap, shadowDistance, shadowDetail } = this.dedicated && level.id === 'high' ? { ...level, ...DEDICATED_HIGH_SHADOWS } : level;
    if (this.mobile && level.id !== 'high') shadowDetail = false;
    if (this.headset) {
      const cap = HEADSET_SHADOWS[this.dedicated ? 'dedicated' : 'standalone'];
      shadowMap = Math.min(shadowMap, cap.shadowMap); shadowDistance = Math.min(shadowDistance, cap.shadowDistance);
      shadowDetail &&= cap.shadowDetail;
    }
    return { shadowMap, shadowDistance, shadowDetail };
  }
  // Antialiasing belongs to the WebGL context, which cannot be reconfigured
  // without rebuilding it, so it follows the level this page started on.
  get antialias() { return QUALITY_LEVELS[this.level].antialias; }

  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  // `reason` is 'auto' when the controller decided on its own, so the game can
  // say so rather than letting the picture change without explanation.
  announce(reason) { for (const listener of this.listeners) listener(this.settings, reason, this); }

  // AO is saved as the player's choice (null for none), never the default.
  save() {
    writeStored(this.storage, { mode: this.mode, level: QUALITY_LEVELS[this.page?.level ?? this.level].id, density: this.densityOverride, ambientOcclusion: this.aoChoice, aoDropped: this.aoDropped,
      frameCap: this.capChoice, headsetRate: this.rateChoice });
  }

  // The card drawing the game, as its own context names it (see gpuName): made
  // after the level is chosen, since the level decides its antialiasing. AO is
  // on by default only on a card of its own (see dedicatedGpu) in a machine
  // detection starts at Balanced or better: phones, integrated and unknown
  // graphics, and thin machines start without it. High's shadows reach farther
  // on one too (see DEDICATED_HIGH_SHADOWS). Call it before the first frame.
  setGpu(name) {
    this.dedicated = dedicatedGpu(name);
    this.aoCapable = this.dedicated && this.detected <= levelIndex('balanced');
  }

  // A headset session starts or ends. In a headset, shadows follow HEADSET_SHADOWS
  // and quality follows HEADSET_LADDERS, measured against the headset's refresh
  // rate. The page's level and controller state come back when it ends, and
  // nothing the ladder decides is saved.
  setHeadset(presenting, { frameRate, scalable = true } = {}) {
    if (presenting === this.headset) return;
    this.headset = presenting;
    if (presenting) {
      this.page = { level: this.level, ceiling: this.ceiling, target: this.target, cascade: this.cascade };
      this.cascade = null; this.target = frameRate || 72; this.scalable = scalable;
      this.climbHeadset();
    } else {
      ({ level: this.level, ceiling: this.ceiling, target: this.target, cascade: this.cascade } = this.page);
      this.page = this.ladder = null; this.xrScale = 1;
    }
    this.suspend();
    this.announce('headset');
  }
  // The headset's refresh rate, once known or changed. The ladder may climb
  // again at a new rate.
  setHeadsetRate(frameRate) {
    if (!this.headset || !frameRate || frameRate === this.target) return;
    this.target = frameRate; this.ceilingRung = 0; this.cascade = null; this.suspend();
  }
  // The rate to ask a headset for: the player's, else HEADSET_RATE
  get headsetRate() { return this.rateChoice ?? HEADSET_RATE; }
  chooseHeadsetRate(rate) {
    this.rateChoice = rate;
    this.save();
    this.announce('headset-rate');
  }
  // The page's frame-rate cap in fps, or null for the display's own rate.
  // Without a choice, a machine with no graphics card of its own (phones,
  // tablets, built-in graphics) draws an even share of a fast display near 60:
  // 60 on 120 Hz, 72 on 144. A 90 Hz display is left alone, since 60 there
  // comes out as alternating 11 and 22 ms frames. A card of its own draws at
  // the display's rate. `display` is the measured refresh rate, if known yet.
  frameCap(display) {
    let cap = this.capChoice === null ? null : this.capChoice || null;
    if (this.capChoice === null && !this.dedicated && display) {
      for (let n = 2; display / n >= 55; n++) if (cap === null || Math.abs(display / n - 60) < Math.abs(cap - 60)) cap = display / n;
    }
    if (cap !== this.cap) { this.cap = cap; this.suspend(); this.announce('frame-cap'); }
    return cap;
  }
  chooseFrameCap(cap) {
    if (!FRAME_CAPS.includes(cap)) return false;
    this.capChoice = cap;
    this.suspend();
    this.save();
    this.announce('frame-cap');
    return true;
  }
  // Start on the ladder at the page's level or below. A standalone headset starts
  // one rung below the top and climbs from there, like the page does.
  climbHeadset() {
    let rungs = !this.auto ? HEADSET_SCALES.map(scale => [this.page.level, scale])
      : HEADSET_LADDERS[this.dedicated ? 'dedicated' : 'standalone'].map(([id, scale]) => [levelIndex(id), scale]);
    // Without viewport scaling each level is one rung at full scale
    if (!this.scalable) rungs = rungs.filter(([level], i) => rungs.findIndex(([other]) => other === level) === i).map(([level]) => [level, 1]);
    const below = rungs.findIndex(([level]) => level >= this.page.level);
    this.ladder = rungs; this.ceilingRung = 0; this.cascade = null;
    // (a pinned level without viewport scaling is a ladder of one rung)
    this.setRung(Math.min(rungs.length - 1, Math.max(this.dedicated ? 0 : 1, below === -1 ? rungs.length - 1 : below)));
  }
  setRung(rung) {
    [this.level, this.xrScale] = this.ladder[rung];
    this.rung = rung;
    return true;
  }
  // Same rules as the page: two slow windows step down, four fast ones step up,
  // and never back above a rung that was too slow. If giving up rungs doesn't
  // help, something else sets the pace, so the last useful rung comes back and
  // the rate it reaches becomes the target.
  judgeHeadset(fps) {
    if (fps < this.target * SLOW) {
      this.fast = 0;
      if (++this.slow < SLOW_WINDOWS) return false;
      this.slow = 0;
      let spent = this.rung >= this.ladder.length - 1;
      if (this.cascade) {
        if (fps >= this.cascade.fps * WORTHWHILE) this.cascade = { rung: this.rung, fps, failures: 0 };
        else if (++this.cascade.failures >= GIVE_UP_AFTER) spent = true;
      }
      if (!spent) {
        this.cascade ??= { rung: this.rung, fps, failures: 0 };
        this.ceilingRung = this.rung + 1;
        return this.moveRung(this.rung + 1);
      }
      // Out of rungs, or they bought nothing. With no rate chosen the headset
      // drops to HEADSET_FALLBACK_RATE (see setHeadsetRate) and tries again there.
      if (this.rateChoice === null && this.lowerHeadsetRate?.()) { this.cascade = null; this.suspend(); return true; }
      const rung = this.cascade?.rung ?? this.rung;
      this.cascade = null; this.target = Math.max(24, fps); this.ceilingRung = rung;
      return rung !== this.rung && this.moveRung(rung);
    }
    this.slow = 0;
    if (fps < this.target * FAST) { this.fast = 0; this.cascade = null; return false; }
    this.cascade = null;
    if (++this.fast < FAST_WINDOWS || this.rung <= this.ceilingRung) return false;
    this.fast = 0;
    return this.moveRung(this.rung - 1);
  }
  moveRung(rung) {
    this.setRung(rung);
    this.suspend();
    this.announce('headset');
    return true;
  }

  setMode(mode) {
    const index = levelIndex(mode);
    if (mode !== 'auto' && index === -1) return false;
    this.mode = mode;
    // A fresh choice clears adaptive history and the density override.
    // The independent AO choice stays as the player left it. In a headset this
    // resets the page's state and the ladder starts again from the choice.
    const page = this.page ?? this;
    page.ceiling = 0; page.cascade = null; page.target = 60;
    this.densityOverride = null;
    if (index !== -1) page.level = index;
    if (this.headset) this.climbHeadset();
    this.suspend();
    this.save();
    this.announce('mode');
    return true;
  }

  setDensity(density) {
    if (!Number.isFinite(density)) return false;
    // Keep an explicit choice even if Auto later changes the underlying level.
    this.densityOverride = Math.max(MIN_DENSITY, Math.min(1, density));
    this.suspend();
    this.save();
    this.announce('density');
    return true;
  }

  // The player's own choice from here on, over the default and `?ao=0` alike.
  toggleAmbientOcclusion() {
    const enabled = !this.ambientOcclusion;
    this.aoChoice = enabled; this.aoVisit = null;
    this.suspend();
    this.save();
    this.announce('ambient-occlusion');
    return enabled;
  }

  // Put back everything a descent gave up, AO included, once that descent has
  // proved it was not buying anything.
  restore({ level, aoDropped }) {
    const next = Math.max(0, Math.min(WORST, level));
    const changed = next !== this.level || aoDropped !== this.aoDropped;
    this.level = next;
    this.aoDropped = aoDropped;
    this.ceiling = next;
    if (!changed) return false;
    this.suspend();
    this.save();
    this.announce('auto');
    return true;
  }

  // A new route is a different amount of work, so allow one step better than
  // the last one settled on. Lifting it a step at a time keeps route hopping
  // from walking the whole ladder up and back down. The measured target is kept:
  // the display's own limit did not change with the route.
  relax() {
    if (this.ceiling > 0) this.ceiling--;
    this.cascade = null;
    this.suspend();
  }

  // Pause measuring: after a change, and whenever the drive is not running.
  suspend(settle = SETTLE_MS) {
    this.settle = settle; this.startedAt = null; this.windowStart = null;
    this.frames = 0; this.slow = 0; this.fast = 0;
  }

  // One sample per displayed frame. `active` is false while paused, hidden or
  // changing route, when frame times say nothing about how the scene performs.
  // A pinned level adapts to nothing, but AO that is only the default still
  // goes if it proves too slow.
  sample(timestamp, active) {
    if (!this.headset && !this.auto && !this.aoByDefault && !this.cascade) return false;
    if (!active) { this.startedAt = null; this.windowStart = null; this.frames = 0; return false; }
    this.startedAt ??= timestamp;
    if (timestamp - this.startedAt < this.settle) return false;
    if (this.windowStart === null) { this.windowStart = timestamp; this.frames = 0; return false; }
    this.frames++;
    const elapsed = timestamp - this.windowStart;
    if (elapsed < WINDOW_MS) return false;
    const fps = this.frames * 1000 / elapsed;
    this.windowStart = timestamp; this.frames = 0;
    this.fps = fps;
    return this.judge(fps);
  }

  judge(fps) {
    if (this.headset) return this.judgeHeadset(fps);
    // (a cap under the target is the target: 30 fps held is not slow)
    const target = Math.min(this.target, this.cap ?? Infinity);
    if (fps < target * SLOW) {
      this.fast = 0;
      if (++this.slow < SLOW_WINDOWS) return false;
      this.slow = 0;
      if (this.cascade) {
        if (fps >= this.cascade.fps * WORTHWHILE) {
          // That step worked. Judge the next one against what this one bought,
          // not against the rate before it: a big early saving must not go on
          // excusing three later steps that save nothing.
          this.cascade = { level: this.level, aoDropped: this.aoDropped, fps, failures: 0 };
        } else if (++this.cascade.failures >= GIVE_UP_AFTER || !this.auto) {
          // Giving up detail twice over bought nothing (once, for a pinned
          // level, which has only AO to give). Go back to the last state that
          // was worth reaching and measure against the rate this device
          // actually delivers.
          const cascade = this.cascade;
          this.cascade = null;
          this.target = Math.max(24, fps);
          return this.restore(cascade);
        }
      }
      // AO nobody chose goes first: it is drawn on top of the level, a second
      // pass over the whole scene, and so the least picture to give up.
      const dropAO = this.aoByDefault;
      if (dropAO || (this.auto && this.level < WORST)) {
        this.cascade ??= { level: this.level, aoDropped: this.aoDropped, fps, failures: 0 };
        return dropAO ? this.dropAmbientOcclusion() : this.change(this.level + 1);
      }
      this.cascade = null;
      this.target = Math.max(24, fps);
      return false;
    }
    this.slow = 0;
    if (fps < target * FAST) { this.fast = 0; this.cascade = null; return false; }
    this.cascade = null;
    if (!this.auto || ++this.fast < FAST_WINDOWS || this.level <= this.ceiling) return false;
    this.fast = 0;
    return this.change(this.level - 1);
  }

  // AO nobody chose, given up for frame rate (see judge). Later visits start
  // without it too, unless the descent it began proves it bought nothing (see
  // restore). It never comes back by climbing, only by the player's choice.
  dropAmbientOcclusion() {
    this.aoDropped = true;
    this.suspend();
    this.save();
    this.announce('auto');
    return true;
  }

  change(level) {
    const next = Math.max(0, Math.min(WORST, level));
    if (next === this.level) return false;
    if (next > this.level) this.ceiling = next;
    this.level = next;
    this.suspend();
    this.save();
    this.announce('auto');
    return true;
  }
}
