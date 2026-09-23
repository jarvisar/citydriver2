// Graphics quality: what each level renders, how a device's starting level is
// guessed, and the adaptive controller that keeps the frame rate near the
// display's refresh rate.
//
// A level changes the drawing buffer's density, the sun shadow's detail, and
// how much of the route stays built around the car. AO is a separate, opt-in
// setting that neither presets nor Auto switch on or off. While it is on it
// costs what the level can afford: it is drawn from the same drawing buffer, so
// it shrinks with `density`, and `aoQuality` bounds it on dense screens.
// Lighting and the city layout are identical at
// every level; distant models replace decoration outside the detail range. Nothing here
// changes the shader light counts, which would make the browser recompile every
// program mid-drive.

// `density` is a fraction of the device's own pixel ratio, not a ceiling on it.
// A ceiling did nothing on the displays that need the help most: clamping to 3,
// 2 and 1.5 all leave a 1x laptop panel rendering at exactly 1x, so three of
// the four levels were the same picture at the same price. A fraction removes
// pixels on every display.
//
// High keeps a wider square of detailed city blocks. Lower levels use fewer
// furnished blocks, with a cheap distant skyline covering the same camera views.
export const QUALITY_LEVELS = [
  { id: 'high', label: 'High', summary: 'Full detail · sharp shadows', density: 1, shadowMap: 2048, chunks: { behind: 3, ahead: 5 }, antialias: true, aoQuality: 'high' },
  { id: 'balanced', label: 'Balanced', summary: '85% resolution · medium shadows', density: .85, shadowMap: 1536, chunks: { behind: 2, ahead: 4 }, antialias: true, aoQuality: 'high' },
  { id: 'smooth', label: 'Smooth', summary: '70% resolution · softer shadows', density: .7, shadowMap: 1024, chunks: { behind: 2, ahead: 4 }, antialias: true, aoQuality: 'low' },
  { id: 'basic', label: 'Basic', summary: '50% resolution · simple shadows · nearby detail', density: .5, shadowMap: 512, chunks: { behind: 1, ahead: 3 }, antialias: false, aoQuality: 'low' },
];
const WORST = QUALITY_LEVELS.length - 1;
export const levelIndex = id => QUALITY_LEVELS.findIndex(level => level.id === id);

// Density is a fraction of native resolution, including on high-density screens.
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

// What the browser will actually draw with. Cores and memory cannot tell a
// laptop's integrated chip from the discrete card in a tower, and that is the
// difference this scene feels most, so ask the GPU for its own name.
export function probeRenderer(createCanvas = () => globalThis.document?.createElement('canvas')) {
  try {
    const canvas = createCanvas();
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!gl) return '';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    // Release it at once: browsers allow only a handful of live contexts, and
    // the game still needs one of them.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' ? name : '';
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

// A first guess from what the browser will tell us. Deliberately cautious on
// touch devices: the controller below raises the level within a few seconds
// when the device turns out to be quick, which looks better than starting too
// high and stuttering through the first corner. The same now goes for anything
// with a mouse, which used to start at the top whatever it was — so a thin
// laptop with an integrated chip began exactly where a tower with a discrete
// card did, and only found out the difference by stuttering through that corner.
export function detectLevel(hints = {}) {
  const nav = hints.navigator ?? globalThis.navigator ?? {};
  // A coarse primary pointer covers phones and tablets, including the tablets
  // that report themselves as desktops; a touchscreen laptop still has a fine
  // primary pointer and is tiered with the other laptops below.
  const coarsePointer = hints.coarsePointer ?? Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);
  const mobile = hints.mobile ?? (nav.userAgentData?.mobile === true || coarsePointer);
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
  constructor({ storage = defaultStorage(), ambientOcclusion = null, detect = detectLevel } = {}) {
    const stored = readStored(storage);
    this.storage = storage;
    this.listeners = new Set();
    this.detected = detect();
    const storedLevel = levelIndex(stored.level);
    this.level = storedLevel === -1 ? this.detected : storedLevel;
    this.mode = QUALITY_LEVELS.some(level => level.id === stored.mode) ? stored.mode : 'auto';
    if (this.mode !== 'auto') this.level = levelIndex(this.mode);
    // AO defaults off, independently of quality. Preserve an explicit saved
    // choice; old preset/adaptive defaults (null and softShading) do not opt in.
    // `?ao=0` overrides a remembered choice for this visit.
    this.ambientOcclusion = ambientOcclusion ?? (stored.ambientOcclusion === true);
    this.densityOverride = Number.isFinite(stored.density) && stored.density >= MIN_DENSITY && stored.density <= 1 ? stored.density : null;
    // Never probe above the level a downgrade settled on, so quality ratchets
    // one way and the picture cannot flicker between two levels all drive.
    this.ceiling = 0;
    this.target = 60;
    this.cascade = null;
    this.suspend(FIRST_SETTLE_MS);
  }

  get auto() { return this.mode === 'auto'; }
  get levelId() { return QUALITY_LEVELS[this.level].id; }
  get settings() {
    return { ...QUALITY_LEVELS[this.level], density: this.densityOverride ?? QUALITY_LEVELS[this.level].density,
      customDensity: this.densityOverride !== null, ambientOcclusion: this.ambientOcclusion };
  }
  // Antialiasing belongs to the WebGL context, which cannot be reconfigured
  // without rebuilding it, so it follows the level this page started on.
  get antialias() { return QUALITY_LEVELS[this.level].antialias; }

  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  // `reason` is 'auto' when the controller decided on its own, so the game can
  // say so rather than letting the picture change without explanation.
  announce(reason) { for (const listener of this.listeners) listener(this.settings, reason, this); }

  save() {
    writeStored(this.storage, { mode: this.mode, level: this.levelId, density: this.densityOverride, ambientOcclusion: this.ambientOcclusion });
  }

  setMode(mode) {
    const index = levelIndex(mode);
    if (mode !== 'auto' && index === -1) return false;
    this.mode = mode === 'auto' ? 'auto' : mode;
    // A fresh choice clears adaptive history and the density override.
    // The independent AO choice stays as the player left it.
    this.ceiling = 0; this.cascade = null; this.target = 60;
    this.densityOverride = null;
    if (index !== -1) this.level = index;
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

  toggleAmbientOcclusion() {
    const enabled = !this.ambientOcclusion;
    this.ambientOcclusion = enabled;
    this.suspend();
    this.save();
    this.announce('ambient-occlusion');
    return enabled;
  }

  // Put back everything a descent gave up, once that descent has proved it was
  // not buying anything.
  restore({ level }) {
    const next = Math.max(0, Math.min(WORST, level));
    const changed = next !== this.level;
    this.level = next;
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
  sample(timestamp, active) {
    if (!this.auto) return false;
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
    if (fps < this.target * SLOW) {
      this.fast = 0;
      if (++this.slow < SLOW_WINDOWS) return false;
      this.slow = 0;
      if (this.cascade) {
        if (fps >= this.cascade.fps * WORTHWHILE) {
          // That step worked. Judge the next one against what this one bought,
          // not against the rate before it: a big early saving must not go on
          // excusing three later steps that save nothing.
          this.cascade = { level: this.level, fps, failures: 0 };
        } else if (++this.cascade.failures >= GIVE_UP_AFTER) {
          // Giving up detail twice over bought nothing. Go back to the last
          // state that was worth reaching and measure against the rate this
          // device actually delivers.
          const cascade = this.cascade;
          this.cascade = null;
          this.target = Math.max(24, fps);
          return this.restore(cascade);
        }
      }
      if (this.level < WORST) {
        this.cascade ??= { level: this.level, fps, failures: 0 };
        return this.change(this.level + 1);
      }
      this.cascade = null;
      this.target = Math.max(24, fps);
      return false;
    }
    this.slow = 0;
    if (fps < this.target * FAST) { this.fast = 0; this.cascade = null; return false; }
    this.cascade = null;
    if (++this.fast < FAST_WINDOWS || this.level <= this.ceiling) return false;
    this.fast = 0;
    return this.change(this.level - 1);
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
