import test from 'node:test';
import assert from 'node:assert/strict';
import { DEDICATED_HIGH_SHADOWS, FRAME_CAPS, Graphics, HEADSET_LADDERS, HEADSET_RATE, HEADSET_SHADOWS, QUALITY_LEVELS, dedicatedGpu, detectLevel, gpuName, headsetBrowser, levelIndex, renderScale } from '../src/graphics.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), map };
}
const stored = storage => JSON.parse(storage.map.get('citydriver.graphics'));

// A stand-in device with a running clock, like requestAnimationFrame has.
// `rates` is either a fixed refresh rate or the frame rate this device reaches
// at each quality level, so dropping a level actually buys frames — the signal
// the controller is reading. A fixed rate models a display or browser cap, and
// `withAO` the rates while AO is on, where it costs something.
class Device {
  constructor(graphics, rates = 60, withAO = null) { this.graphics = graphics; this.rates = rates; this.withAO = withAO; this.time = 0; this.changes = 0; this.levels = []; this.steps = []; }
  get hz() {
    const rates = this.graphics.ambientOcclusion ? this.withAO ?? this.rates : this.rates;
    return typeof rates === 'number' ? rates : rates[levelIndex(this.graphics.levelId)];
  }
  run(seconds, { hz, active = true } = {}) {
    for (let remaining = seconds * 1000; remaining > 0;) {
      const step = 1000 / (hz ?? this.hz);
      this.time += step; remaining -= step;
      if (this.graphics.sample(this.time, active)) {
        this.changes++; this.levels.push(this.graphics.levelId);
        this.steps.push(`${this.graphics.levelId}${this.graphics.settings.ambientOcclusion ? '+ao' : '-ao'}`);
      }
    }
    return this;
  }
}
const graphicsAt = (level, options = {}) => new Graphics({ storage: memoryStorage(), detect: () => level, ...options });
// The card Chrome names on this machine: one of its own, so AO is on by default.
const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 (0x00002704) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const capableAt = (level, options = {}) => { const graphics = graphicsAt(level, options); graphics.setGpu(RTX); return graphics; };

test('quality levels get cheaper in every dimension, from high down to basic', () => {
  const AO_COST = { low: 0, high: 1 };
  assert.deepEqual(QUALITY_LEVELS.map(level => level.id), ['high', 'balanced', 'smooth', 'basic']);
  for (let i = 1; i < QUALITY_LEVELS.length; i++) {
    const previous = QUALITY_LEVELS[i - 1], level = QUALITY_LEVELS[i];
    assert.ok(level.density < previous.density, `${level.id} density`);
    assert.ok(level.shadowMap <= previous.shadowMap, `${level.id} shadow map`);
    assert.ok(level.shadowDistance < previous.shadowDistance, `${level.id} shadow reach`);
    assert.ok(Number(level.shadowDetail) <= Number(previous.shadowDetail), `${level.id} shadow casters`);
    assert.ok(level.chunks.behind <= previous.chunks.behind, `${level.id} chunks behind`);
    assert.ok(level.chunks.ahead <= previous.chunks.ahead, `${level.id} chunks ahead`);
    assert.ok(Number(level.antialias) <= Number(previous.antialias), `${level.id} antialiasing`);
    assert.ok(AO_COST[level.aoQuality] <= AO_COST[previous.aoQuality], `${level.id} AO budget`);
  }
  // The top level must draw everything, at the density the display asks for.
  assert.deepEqual({ ...QUALITY_LEVELS[0], id: undefined, label: undefined, summary: undefined },
    { id: undefined, label: undefined, summary: undefined, density: 1, shadowMap: 2048, shadowDistance: 100, shadowDetail: true, chunks: { behind: 3, ahead: 5 }, antialias: true, aoQuality: 'high' });
});

test('every level removes pixels, on a 1x panel as much as on a dense one', () => {
  // A ceiling on the pixel ratio alone does nothing here: clamping to 3, 2 and
  // 1.5 all leave a 1x laptop panel rendering at 1x, so three of the four
  // levels would be the same picture at the same price.
  for (const devicePixelRatio of [1, 1.25, 1.5, 2, 3]) {
    const scales = QUALITY_LEVELS.map(level => renderScale(level.density, devicePixelRatio));
    for (let i = 1; i < scales.length; i++) {
      assert.ok(scales[i] < scales[i - 1], `${devicePixelRatio}x: ${QUALITY_LEVELS[i].id} must draw fewer pixels than ${QUALITY_LEVELS[i - 1].id}`);
    }
    assert.equal(scales[0], devicePixelRatio, `${devicePixelRatio}x: full quality reaches native resolution`);
  }
  assert.equal(renderScale(1, 1), 1, 'full quality on a 1x panel is still 1x');
  assert.equal(renderScale(1, 3), 3, 'a 3x phone panel can render at native resolution');
  assert.equal(renderScale(2, 3), 3, 'density never exceeds native resolution');
  assert.equal(renderScale(.1, 2), 1, 'the minimum density is 50%');
});

test('detection tiers pointer devices on what they are, and touch devices cautiously', () => {
  // A tower with a discrete card and room to work starts at the top.
  assert.equal(detectLevel({ mobile: false, gpu: 'NVIDIA GeForce RTX 4070', cores: 16, memory: 8, pixels: 2e6 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: 'AMD Radeon RX 7800 XT', cores: 12, memory: 8, pixels: 2e6 }), 0);
  // A laptop's integrated chip does not, and neither does a thin machine.
  assert.equal(detectLevel({ mobile: false, gpu: 'Intel(R) UHD Graphics 620', cores: 8, memory: 8, pixels: 2e6 }), levelIndex('balanced'));
  assert.equal(detectLevel({ mobile: false, gpu: 'NVIDIA GeForce RTX 4070', cores: 16, memory: 8, pixels: 8.3e6 }), levelIndex('balanced'), 'a 4K panel is four 1080p frames');
  assert.equal(detectLevel({ mobile: false, gpu: 'Intel(R) HD Graphics 4000', cores: 2, memory: 4, pixels: 1e6 }), levelIndex('basic'));
  // Drawing on the processor needs the cheapest picture there is.
  assert.equal(detectLevel({ mobile: false, gpu: 'ANGLE (Google, SwiftShader Device)', cores: 16, memory: 8, pixels: 1e6 }), levelIndex('basic'));
  assert.equal(detectLevel({ mobile: false, gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)', cores: 16, memory: 8, pixels: 1e6 }), levelIndex('basic'));
  // Mesa drives plenty of discrete cards, and Apple's shared memory is not slow.
  assert.equal(detectLevel({ mobile: false, gpu: 'AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49), Mesa 23.0.4', cores: 16, memory: 8, pixels: 2e6 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: 'Apple M3 Pro', cores: 12, memory: 0, pixels: 2e6 }), 0);
  // Nothing to go on is not a reason to assume the worst.
  assert.equal(detectLevel({ mobile: false, gpu: '', cores: 0, memory: 0, pixels: 0 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: '', cores: 2, memory: 1, pixels: 0 }), levelIndex('smooth'));
  assert.equal(detectLevel({ mobile: true, cores: 8, memory: 8 }), levelIndex('balanced'));
  assert.equal(detectLevel({ mobile: true, cores: 6, memory: 0 }), levelIndex('balanced'), 'Safari reports no deviceMemory');
  assert.equal(detectLevel({ mobile: true, cores: 4, memory: 4 }), levelIndex('smooth'));
  assert.equal(detectLevel({ mobile: true, cores: 4, memory: 1 }), levelIndex('basic'));
  assert.equal(detectLevel({ mobile: true, cores: 2, memory: 0 }), levelIndex('basic'));
  assert.equal(detectLevel({ mobile: true, cores: 0, memory: 0 }), levelIndex('basic'));
  // A tablet that calls itself a desktop is still a touch device.
  assert.equal(detectLevel({ navigator: { userAgentData: { mobile: false } }, coarsePointer: true, cores: 4, memory: 4 }), levelIndex('smooth'));
  // A touchscreen laptop keeps its fine primary pointer, and is tiered as the
  // laptop it is rather than as a phone.
  assert.equal(detectLevel({ navigator: { userAgentData: { mobile: false } }, coarsePointer: false, gpu: 'Intel(R) Iris(R) Xe Graphics', cores: 4, memory: 4, pixels: 2e6 }), levelIndex('basic'));
});

test('a device that holds the refresh rate keeps its level, and a single hitch changes nothing', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const display = new Device(graphics, 60).run(40);
  assert.equal(display.changes, 0);
  assert.equal(graphics.levelId, 'high');
  display.run(.3, { hz: 12 }).run(40);
  assert.equal(display.changes, 0, 'one slow moment is not a slow device');
  assert.equal(graphics.levelId, 'high');
});

test('a slow device steps down one level at a time and never climbs back', () => {
  const graphics = graphicsAt(levelIndex('high'));
  // An older phone: each step down really does buy frames, and only the
  // cheapest level reaches the display's rate. AO remains off throughout.
  const phone = new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.deepEqual(phone.steps, ['balanced-ao', 'smooth-ao', 'basic-ao']);
  assert.equal(graphics.levelId, 'basic');
  // Recovering later must not undo a decision the player has settled into.
  phone.rates = 60;
  phone.run(200);
  assert.equal(graphics.levelId, 'basic');
});

test('a cautious start climbs while the device keeps up, one level at a time', () => {
  const graphics = graphicsAt(levelIndex('basic'));
  const display = new Device(graphics, 60).run(60);
  assert.deepEqual(display.levels, ['smooth', 'balanced', 'high']);
  assert.equal(graphics.levelId, 'high');
  assert.equal(display.changes, 3, 'it stops at the top');
});

test('a climb that turns out to be too much settles one level below it, for good', () => {
  const graphics = graphicsAt(levelIndex('smooth'));
  // This device runs the cheaper levels comfortably but cannot hold the two
  // heaviest ones, so the upward probe has to be given back.
  const device = new Device(graphics, [25, 41, 61, 61]).run(200);
  assert.equal(graphics.levelId, 'smooth');
  assert.deepEqual(device.steps, ['balanced-ao', 'smooth-ao'], 'one probe up, then the level back');
  device.run(400);
  assert.equal(graphics.levelId, 'smooth', 'no flicker between two levels');
  assert.equal(device.changes, 2);
});

test('a new route may reclaim one level, but not the whole ladder at once', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const heavy = new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.equal(graphics.levelId, 'basic');
  // A lighter route runs everything comfortably, but only one level comes back
  // per route change, so hopping between routes cannot flap the whole ladder.
  const light = new Device(graphics, 61);
  light.time = heavy.time;
  graphics.relax();
  light.run(200);
  assert.equal(graphics.levelId, 'smooth');
  graphics.relax();
  light.run(200);
  assert.equal(graphics.levelId, 'balanced');
  light.run(400);
  assert.equal(graphics.levelId, 'balanced', 'no further climb without another route change');
});

test('a capped display gets its quality back instead of being stripped for nothing', () => {
  // 30 Hz throughout: nothing the controller gives up can improve a rate the
  // display sets. It probes two cheaper levels and restores the original.
  const graphics = graphicsAt(levelIndex('balanced'));
  const display = new Device(graphics, 30).run(90);
  assert.equal(graphics.levelId, 'balanced');
  assert.equal(graphics.settings.ambientOcclusion, false, 'quality recovery leaves AO off');
  assert.deepEqual(display.steps, ['smooth-ao', 'basic-ao', 'balanced-ao']);
  assert.ok(graphics.target <= 31 && graphics.target >= 29, `target follows the display: ${graphics.target}`);
  display.run(300);
  assert.equal(display.changes, 3, 'and it stops probing once it knows the rate');
});

test('a genuine improvement from stepping down is kept', () => {
  const graphics = graphicsAt(levelIndex('high'));
  // One level step buys enough frames to settle.
  const device = new Device(graphics, [30, 58, 60, 60]).run(200);
  assert.equal(graphics.levelId, 'balanced');
  assert.deepEqual(device.steps, ['balanced-ao']);
});

test('paused, hidden and route-change frames are excluded and restart the grace period', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const display = new Device(graphics, 20).run(30, { active: false });
  assert.equal(display.changes, 0);
  assert.equal(graphics.levelId, 'high');
  display.run(3, { hz: 20 });
  assert.equal(display.changes, 0, 'measuring restarts from the grace period');
});

test('a chosen level is pinned, adapts to nothing, and is remembered', () => {
  const storage = memoryStorage();
  const graphics = new Graphics({ storage, detect: () => levelIndex('smooth') });
  assert.equal(graphics.auto, true);
  graphics.setMode('high');
  assert.equal(graphics.auto, false);
  assert.equal(graphics.levelId, 'high');
  new Device(graphics, 8).run(120);
  assert.equal(graphics.levelId, 'high', 'a pinned level stays pinned');
  assert.deepEqual(stored(storage), { mode: 'high', level: 'high', density: null, ambientOcclusion: null, aoDropped: false, frameCap: null, headsetRate: null });

  const next = new Graphics({ storage, detect: () => levelIndex('basic') });
  assert.equal(next.mode, 'high');
  assert.equal(next.levelId, 'high');
  next.setMode('auto');
  assert.equal(next.auto, true);
  assert.equal(next.levelId, 'high', 'returning to auto continues from where it is');
});

test('auto remembers the level it settled on so the next visit starts there', () => {
  const storage = memoryStorage();
  const graphics = new Graphics({ storage, detect: () => levelIndex('high') });
  new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.equal(graphics.levelId, 'basic');
  assert.deepEqual(stored(storage), { mode: 'auto', level: 'basic', density: null, ambientOcclusion: null, aoDropped: false, frameCap: null, headsetRate: null }, 'no AO choice is saved as none');
  const next = new Graphics({ storage, detect: () => levelIndex('high') });
  assert.equal(next.auto, true);
  assert.equal(next.levelId, 'basic');
  assert.equal(next.settings.ambientOcclusion, false, 'and it is still off on the next visit');
});

test('the card is named the way each browser allows', () => {
  const RENDERER = 0x1F01, UNMASKED = 0x9246;
  const context = (renderer, unmasked) => ({ RENDERER, asked: [],
    getParameter(name) { return name === RENDERER ? renderer : name === UNMASKED ? unmasked : null; },
    getExtension(name) { this.asked.push(name); return unmasked === undefined ? null : { UNMASKED_RENDERER_WEBGL: UNMASKED }; } });
  // Chrome, Edge and the desktop app only name it through the extension.
  assert.equal(gpuName(context('WebKit WebGL', RTX)), RTX);
  assert.equal(gpuName(context('WebKit WebGL', 'Apple GPU')), 'Apple GPU', 'Safari');
  assert.equal(gpuName(context('WebKit WebGL')), 'WebKit WebGL', 'extension refused');
  // Firefox names it directly, and warns about the extension, so it is not asked.
  const firefox = context('NVIDIA GeForce GTX 980, or similar', 'unused');
  assert.equal(gpuName(firefox), 'NVIDIA GeForce GTX 980, or similar');
  assert.deepEqual(firefox.asked, []);
  assert.equal(gpuName(context(null)), '');
});

test('only a graphics card of its own counts as dedicated', () => {
  for (const name of [RTX, 'NVIDIA GeForce RTX 3060 Laptop GPU/PCIe/SSE2', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x00001C03) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'NVIDIA GeForce GTX 980, or similar', 'NVIDIA TITAN Xp', 'ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49), Mesa 23.0.4', 'AMD Radeon Pro 5500M OpenGL Engine',
    'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)']) {
    assert.equal(dedicatedGpu(name), true, name);
  }
  for (const name of ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX Vega 11 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Custom GPU 0405 (radeonsi, vangogh, LLVM 15.0.7, DRM 3.49)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'Apple GPU', 'Adreno (TM) 740', 'Mali-G78 MC24', 'NVIDIA GeForce GT 1030',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'WebKit WebGL', '']) {
    assert.equal(dedicatedGpu(name), false, name);
  }
});

test('AO is on by default only on a dedicated card in a machine that starts at Balanced or better', () => {
  assert.equal(graphicsAt(0).ambientOcclusion, false, 'off until the card drawing the game is known');
  assert.equal(capableAt(0).ambientOcclusion, true);
  assert.equal(capableAt(levelIndex('balanced')).settings.ambientOcclusion, true, 'a 4K panel on a discrete card');
  assert.equal(capableAt(levelIndex('smooth')).ambientOcclusion, false, 'a discrete card in a thin machine');
  assert.equal(capableAt(levelIndex('basic')).ambientOcclusion, false);
  for (const name of ['Apple GPU', 'Adreno (TM) 740', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'WebKit WebGL', '']) {
    const graphics = graphicsAt(0);
    graphics.setGpu(name);
    assert.equal(graphics.ambientOcclusion, false, name);
  }
  // No preset switches it, and the default is never saved as a choice.
  const storage = memoryStorage();
  const graphics = capableAt(0, { storage });
  for (const mode of ['basic', 'smooth', 'balanced', 'high', 'auto']) {
    graphics.setMode(mode);
    assert.equal(graphics.settings.ambientOcclusion, true, mode);
    assert.equal(stored(storage).ambientOcclusion, null);
  }
  assert.equal(graphicsAt(0, { storage }).ambientOcclusion, false, 'the next visit decides again, on its own card');
});

test('an explicit AO choice survives presets and reloads, whatever the card', () => {
  for (const at of [graphicsAt, capableAt]) {
    const storage = memoryStorage();
    const graphics = at(0, { storage });
    for (const enabled of [false, true, false]) {
      // (twice, where the default already matches)
      while (graphics.aoChoice !== enabled) graphics.toggleAmbientOcclusion();
      for (const mode of ['high', 'balanced', 'smooth', 'basic', 'auto']) {
        graphics.setMode(mode);
        assert.equal(graphics.settings.ambientOcclusion, enabled, mode);
        assert.equal(stored(storage).ambientOcclusion, enabled);
        assert.equal(graphicsAt(0, { storage }).ambientOcclusion, enabled, 'saved independent choice');
        assert.equal(capableAt(0, { storage }).ambientOcclusion, enabled, 'over the default');
      }
    }
  }
});

test('custom density is remembered, survives Auto adjustments, and resets with presets', () => {
  const storage = memoryStorage();
  const graphics = graphicsAt(0, { storage });
  graphics.setDensity(.83);
  assert.equal(graphics.settings.density, .83);
  assert.equal(graphics.mode, 'auto');
  new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.equal(graphics.levelId, 'basic');
  assert.equal(graphics.settings.density, .83);
  const next = graphicsAt(0, { storage });
  assert.equal(next.settings.density, .83);
  next.toggleAmbientOcclusion();
  assert.equal(next.settings.density, .83, 'AO does not reset density');
  for (const level of QUALITY_LEVELS) {
    next.setDensity(.83);
    next.setMode(level.id);
    assert.equal(next.settings.density, level.density);
    assert.equal(stored(storage).density, null);
  }
  next.setDensity(1);
  next.setMode('auto');
  assert.equal(next.settings.density, .5, 'Auto restores the current level default');
});

test('density validates saved values and clamps user choices to the slider limits', () => {
  for (const density of [null, '0.8', -1, .49, 1.01]) {
    const storage = memoryStorage({ 'citydriver.graphics': JSON.stringify({ density }) });
    assert.equal(graphicsAt(1, { storage }).settings.density, .85);
  }
  const graphics = graphicsAt(0);
  graphics.setDensity(5);
  assert.equal(graphics.settings.density, 1);
  graphics.setDensity(0);
  assert.equal(graphics.settings.density, .5);
  assert.equal(graphics.setDensity(NaN), false);
  assert.equal(graphics.setDensity(Infinity), false);
  assert.equal(graphics.settings.density, .5);
});

test('?ao=0 starts every level without soft shading, and can still be switched back', () => {
  const storage = memoryStorage({ 'citydriver.graphics': JSON.stringify({ mode: 'auto', level: 'high', ambientOcclusion: true }) });
  const graphics = new Graphics({ storage, detect: () => 0, ambientOcclusion: false });
  assert.equal(graphics.settings.ambientOcclusion, false, 'the URL beats a remembered choice');
  graphics.setMode('balanced');
  assert.equal(stored(storage).ambientOcclusion, true, 'for this visit only');
  assert.equal(graphics.toggleAmbientOcclusion(), true);
  assert.equal(graphics.settings.ambientOcclusion, true);
  // It beats the default too, which then stays for the next visit to decide.
  const fresh = memoryStorage();
  const capable = capableAt(0, { storage: fresh, ambientOcclusion: false });
  assert.equal(capable.ambientOcclusion, false);
  new Device(capable, 30).run(60);
  assert.equal(capable.ambientOcclusion, false);
  assert.equal(stored(fresh).ambientOcclusion, null);
  assert.equal(stored(fresh).aoDropped, false, 'off by the URL, so never dropped');
  assert.equal(capableAt(0, { storage: fresh }).ambientOcclusion, true);
});

test('changes reach listeners, and unusable storage never breaks the game', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const graphics = new Graphics({ storage: broken, detect: () => levelIndex('smooth') });
  const seen = [];
  const stop = graphics.onChange(settings => seen.push(settings.density));
  graphics.setMode('high');
  assert.deepEqual(seen, [1]);
  stop();
  graphics.setMode('basic');
  assert.deepEqual(seen, [1], 'listeners can be removed');
  assert.equal(graphics.levelId, 'basic');
});

test('a stored level that no longer exists falls back to detection', () => {
  const storage = memoryStorage({ 'citydriver.graphics': JSON.stringify({ mode: 'ludicrous', level: 'ludicrous' }) });
  const graphics = new Graphics({ storage, detect: () => levelIndex('smooth') });
  assert.equal(graphics.auto, true);
  assert.equal(graphics.levelId, 'smooth');
  assert.equal(graphics.setMode('ludicrous'), false);
  assert.equal(graphics.levelId, 'smooth');
});

test('Auto adjustments and route changes never change the AO choice', () => {
  for (const enabled of [false, true]) {
    const graphics = graphicsAt(0, { ambientOcclusion: enabled });
    const device = new Device(graphics, [22, 31, 43, 61]).run(60);
    assert.equal(graphics.levelId, 'basic');
    assert.equal(graphics.ambientOcclusion, enabled);
    graphics.relax();
    device.rates = 61; device.run(90);
    assert.equal(graphics.levelId, 'smooth');
    assert.equal(graphics.ambientOcclusion, enabled);
    graphics.setMode('high'); graphics.setMode('auto');
    new Device(graphics, 30).run(90);
    assert.equal(graphics.levelId, 'high', 'a capped display restores quality');
    assert.equal(graphics.ambientOcclusion, enabled);
  }
});

test('legacy preset and adaptive AO defaults are no choice, and an opt-in era false is kept', () => {
  for (const ambientOcclusion of [null, undefined, 'true']) {
    const storage = memoryStorage({ 'citydriver.graphics': JSON.stringify({
      mode: 'high', level: 'high', ambientOcclusion, softShading: true,
    }) });
    assert.equal(graphicsAt(0, { storage }).ambientOcclusion, false, 'no opt-in');
    assert.equal(capableAt(0, { storage }).ambientOcclusion, true, 'so the default applies');
  }
  // While AO was opt-in every save held false, chosen or not. It might be a
  // choice, and a saved choice always wins.
  const opted = memoryStorage({ 'citydriver.graphics': JSON.stringify({ mode: 'auto', level: 'high', density: null, ambientOcclusion: false }) });
  assert.equal(capableAt(0, { storage: opted }).ambientOcclusion, false);
  const storage = memoryStorage({ 'citydriver.graphics': JSON.stringify({ ambientOcclusion: true }) });
  assert.equal(graphicsAt(0, { storage }).ambientOcclusion, true, 'explicit opt-in is preserved');
});

test('AO on by default is the first thing given up for frame rate, and stays given up', () => {
  const storage = memoryStorage();
  const graphics = capableAt(0, { storage });
  // AO is what this device cannot afford: without it, High holds the display's rate.
  const device = new Device(graphics, 61, 40).run(120);
  assert.deepEqual(device.steps, ['high-ao'], 'the level is kept');
  assert.equal(graphics.settings.ambientOcclusion, false);
  assert.deepEqual(stored(storage), { mode: 'auto', level: 'high', density: null, ambientOcclusion: null, aoDropped: true, frameCap: null, headsetRate: null },
    'remembered as the default giving way, not as a choice');
  const next = capableAt(0, { storage });
  assert.equal(next.ambientOcclusion, false, 'the next visit starts without it');
  new Device(next, 61, 40).run(120);
  assert.equal(next.levelId, 'high');
  // The player can still have it, and then keeps it however slow it is.
  assert.equal(next.toggleAmbientOcclusion(), true);
  const chosen = new Device(next, 61, 40).run(120);
  assert.equal(next.ambientOcclusion, true);
  assert.equal(chosen.steps[0], 'balanced+ao', 'levels give way instead');
  assert.equal(capableAt(0, { storage }).ambientOcclusion, true);
});

test('a single hitch does not cost AO, and levels go only once it has gone', () => {
  const graphics = capableAt(0);
  const display = new Device(graphics, 60).run(40).run(.3, { hz: 12 }).run(40);
  assert.equal(display.changes, 0);
  assert.equal(graphics.settings.ambientOcclusion, true);
  // Dropping AO helps, but not enough: then the levels step down as before.
  const phone = new Device(capableAt(0), [30, 61, 61, 61], [20, 45, 61, 61]).run(120);
  assert.deepEqual(phone.steps, ['high-ao', 'balanced-ao']);
});

test('AO dropped on a capped display comes back with the level, once dropping bought nothing', () => {
  const graphics = capableAt(0);
  const display = new Device(graphics, 30).run(90);
  assert.deepEqual(display.steps, ['high-ao', 'balanced-ao', 'high+ao']);
  assert.ok(graphics.target <= 31 && graphics.target >= 29, `target follows the display: ${graphics.target}`);
  display.run(300);
  assert.equal(display.changes, 3, 'and it stops probing once it knows the rate');
  assert.equal(graphics.aoDropped, false);
});

test('AO never comes back by climbing', () => {
  // A cautious start at Balanced: AO goes, then the level climbs without it.
  const graphics = capableAt(levelIndex('balanced'));
  const device = new Device(graphics, 61, 40).run(200);
  assert.deepEqual(device.steps, ['balanced-ao', 'high-ao']);
  assert.equal(graphics.ambientOcclusion, false);
});

test('a pinned level keeps its level, but AO on by default still gives way', () => {
  const graphics = capableAt(0);
  graphics.setMode('high');
  const device = new Device(graphics, 61, 40).run(120);
  assert.deepEqual(device.steps, ['high-ao']);
  device.rates = 8; device.withAO = 8;
  device.run(120);
  assert.equal(graphics.levelId, 'high', 'nothing else adapts');
  assert.equal(device.changes, 1);
  // At a capped rate dropping AO buys nothing, and a pinned level has nothing
  // else to try, so it comes straight back.
  const capped = capableAt(0);
  capped.setMode('balanced');
  const display = new Device(capped, 30).run(200);
  assert.deepEqual(display.steps, ['balanced-ao', 'balanced+ao']);
  assert.equal(capped.levelId, 'balanced');
  // A pinned level with AO chosen, or not on at all, is not even measured.
  for (const pinned of [graphicsAt(0), capableAt(0, { ambientOcclusion: true })]) {
    pinned.setMode('high');
    new Device(pinned, 8).run(120);
    assert.equal(pinned.fps, undefined);
  }
});

test('a lower level reaches less far with its shadows instead of only blurring them, so a texel stays about the same size', () => {
  // The sphere a 16:9 chase lens fits is about .86 of the reach wide, and the
  // map covers it with a fade band beyond (see fitSunShadow).
  const texel = ({ shadowMap, shadowDistance }) => 2 * .86 * shadowDistance / .9 / shadowMap;
  for (const level of QUALITY_LEVELS) {
    const size = texel(level);
    assert.ok(size > .08 && size < .2, `${level.id}: ${(size * 100).toFixed(1)} cm texels`);
  }
  assert.ok(texel(QUALITY_LEVELS[levelIndex('basic')]) < .43 / 2, 'Basic less than half the old 43 cm');
});

test('High sharpens its shadows on a dedicated card, and a headset never draws more than its level', () => {
  const plain = graphicsAt(0), dedicated = capableAt(0);
  assert.deepEqual(plain.shadows, { shadowMap: 2048, shadowDistance: 100, shadowDetail: true });
  assert.deepEqual(dedicated.shadows, { ...DEDICATED_HIGH_SHADOWS, shadowDetail: true });
  assert.ok(dedicated.settings.shadowMap === 4096 && dedicated.settings.shadowDistance > 100);
  dedicated.setMode('balanced');
  assert.equal(dedicated.settings.shadowMap, 1536, 'only High changes');
  // A standalone headset (a phone's chip) and one on a PC's card
  const seen = [];
  plain.onChange((settings, reason) => seen.push(reason));
  plain.setHeadset(true);
  assert.deepEqual(plain.shadows, HEADSET_SHADOWS.standalone);
  assert.deepEqual(seen, ['headset']);
  plain.setHeadset(true);
  assert.deepEqual(seen, ['headset'], 'no change, no news');
  dedicated.setMode('high'); dedicated.setHeadset(true);
  assert.deepEqual(dedicated.shadows, HEADSET_SHADOWS.dedicated);
  for (const level of QUALITY_LEVELS) {
    for (const graphics of [graphicsAt(0), capableAt(0)]) {
      graphics.setMode(level.id); graphics.setHeadset(true);
      const { shadowMap, shadowDistance, shadowDetail } = graphics.settings;
      assert.ok(shadowMap <= level.shadowMap || (level.id === 'high' && shadowMap <= DEDICATED_HIGH_SHADOWS.shadowMap), level.id);
      assert.ok(shadowDistance <= level.shadowDistance && Number(shadowDetail) <= Number(level.shadowDetail), level.id);
      graphics.setHeadset(false);
    }
  }
  plain.setHeadset(false);
  assert.deepEqual(plain.shadows, { shadowMap: 2048, shadowDistance: 100, shadowDetail: true }, 'back on the page');
});

test('Auto caps a machine without a card of its own at an even share near 60, and a chosen cap wins', () => {
  const laptop = graphicsAt(levelIndex('balanced'));
  assert.equal(laptop.frameCap(null), null, 'nothing until the display is measured');
  assert.equal(laptop.frameCap(60), null);
  assert.equal(laptop.frameCap(90), null, 'a 90 Hz display is left alone');
  assert.equal(laptop.frameCap(120), 60);
  assert.equal(laptop.frameCap(144), 72);
  assert.equal(laptop.frameCap(240), 60);
  assert.equal(capableAt(0).frameCap(144), null, 'a card of its own draws at the display rate');
  const storage = memoryStorage(), chosen = new Graphics({ storage, detect: () => 1 });
  assert.deepEqual(FRAME_CAPS, [null, 30, 60, 72, 90, 120, 144, 0]);
  assert.equal(chosen.chooseFrameCap(30), true);
  assert.equal(chosen.frameCap(144), 30);
  assert.equal(stored(storage).frameCap, 30);
  chosen.chooseFrameCap(0);
  assert.equal(chosen.frameCap(120), null, 'uncapped');
  assert.equal(chosen.chooseFrameCap(55), false, 'only the slider\'s stops');
  assert.equal(new Graphics({ storage, detect: () => 1 }).capChoice, 0, 'remembered');
  chosen.setMode('high');
  assert.equal(chosen.capChoice, 0, 'a preset leaves it alone');
});

test('a cap under the target becomes it: 30 held is not slow', () => {
  const capped = graphicsAt(levelIndex('high'));
  capped.chooseFrameCap(30); capped.frameCap(60);
  assert.equal(new Device(capped, 30).run(60).changes, 0);
  const uncapped = graphicsAt(levelIndex('high'));
  assert.ok(new Device(uncapped, 30).run(60).changes > 0, 'without the cap 30 is slow');
});

test('a headset asks for 90 Hz unless the player picks a rate, and drops to 72 only when no rung holds 90', () => {
  const graphics = graphicsAt(levelIndex('balanced'));
  assert.equal(graphics.headsetRate, HEADSET_RATE);
  graphics.setHeadset(true, { frameRate: 90 });
  const headset = new Headset(graphics, () => 75, 90);
  let lowered = 0;
  graphics.lowerHeadsetRate = () => { if (headset.hz === 72) return false; lowered++; headset.hz = 72; graphics.setHeadsetRate(72); return true; };
  headset.run(90);
  assert.equal(lowered, 1);
  assert.equal(graphics.target, 72);
  assert.deepEqual([graphics.levelId, graphics.xrScale], HEADSET_LADDERS.standalone[0], 'and at 72 it climbs back to the top');
  // A rate the player picked is kept, whatever it costs
  const pinned = graphicsAt(levelIndex('balanced'));
  pinned.chooseHeadsetRate(90);
  assert.equal(pinned.headsetRate, 90);
  pinned.setHeadset(true, { frameRate: 90 });
  pinned.lowerHeadsetRate = () => { throw new Error('a chosen rate is not lowered'); };
  new Headset(pinned, () => 75, 90).run(90);
  assert.equal(pinned.rateChoice, 90);
});

test('a phone keeps only the big shadow casters below High, where a desktop keeps them all', () => {
  const phone = graphicsAt(levelIndex('balanced'), { mobile: true }), desktop = graphicsAt(levelIndex('balanced'), { mobile: false });
  assert.equal(phone.settings.shadowDetail, false);
  assert.equal(desktop.settings.shadowDetail, true);
  assert.deepEqual([phone.settings.shadowMap, phone.settings.shadowDistance], [desktop.settings.shadowMap, desktop.settings.shadowDistance], 'as sharp and as far');
  phone.setMode('high');
  assert.equal(phone.settings.shadowDetail, true, 'High is High');
});

// A headset: frames come at its refresh rate, or late. `rate(levelId, scale)`
// is what each rung could reach unbounded.
class Headset {
  constructor(graphics, rate, hz = 72) { this.graphics = graphics; this.rate = rate; this.hz = hz; this.time = 0; this.rungs = []; }
  run(seconds) {
    for (let remaining = seconds * 1000; remaining > 0;) {
      const step = 1000 / Math.min(this.hz, this.rate(this.graphics.levelId, this.graphics.xrScale));
      this.time += step; remaining -= step;
      if (this.graphics.sample(this.time, true)) this.rungs.push(`${this.graphics.levelId}@${this.graphics.xrScale}`);
    }
    return this;
  }
}
const QUEST_3 = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/39.2.0.0.56.754450099 Chrome/136.0.7103.177 VR Safari/537.36';

test('a headset\'s own browser is tiered as the phone chip it is, whatever it calls itself', () => {
  assert.equal(headsetBrowser({ userAgent: QUEST_3 }), true);
  assert.equal(headsetBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/136.0 Safari/537.36' }), false);
  // A Quest 3 calls itself desktop Linux, with a fine pointer and an Adreno a
  // desktop would start at High
  const quest = { navigator: { userAgent: QUEST_3, userAgentData: { mobile: false } }, coarsePointer: false, gpu: 'Adreno (TM) 740', pixels: 1.9e6 };
  assert.equal(detectLevel({ ...quest, cores: 6, memory: 8 }), levelIndex('balanced'));
  assert.equal(detectLevel({ ...quest, cores: 8, memory: 4 }), levelIndex('balanced'), 'a Quest 2');
  assert.equal(detectLevel({ ...quest, navigator: { userAgent: '', userAgentData: { mobile: false } }, cores: 6, memory: 8 }), 0, 'a desktop with that chip would start at the top');
});

test('a standalone headset starts a rung down its own ladder and climbs while it keeps the refresh rate', () => {
  const graphics = graphicsAt(levelIndex('high'));
  graphics.setHeadset(true, { frameRate: 72 });
  assert.deepEqual([graphics.levelId, graphics.xrScale], HEADSET_LADDERS.standalone[1], 'Balanced at .85, High left for the page');
  assert.equal(graphics.target, 72);
  const headset = new Headset(graphics, () => 72).run(60);
  assert.deepEqual(headset.rungs, ['balanced@1'], 'up to the top, and no further');
  graphics.setHeadset(false);
  assert.equal(graphics.levelId, 'high'); assert.equal(graphics.xrScale, 1); assert.equal(graphics.target, 60);
});

test('a headset that cannot keep up steps down its ladder, and never climbs back above what proved too much', () => {
  const storage = memoryStorage(), graphics = new Graphics({ storage, detect: () => levelIndex('balanced') });
  graphics.setHeadset(true, { frameRate: 90 });
  // A Quest 2: Balanced is too many draws, and even Basic too many pixels
  const rate = (level, scale) => (level === 'basic' ? 80 : 60) * (scale < .8 ? 1.3 : 1);
  const headset = new Headset(graphics, rate, 90).run(30);
  assert.deepEqual(headset.rungs, ['basic@0.85', 'basic@0.7']);
  headset.rate = () => 200;
  headset.run(120);
  assert.equal(`${graphics.levelId}@${graphics.xrScale}`, 'basic@0.7', 'ratcheted: the rung that failed stays given up');
  assert.equal(headset.rungs.length, 2);
  // Nothing the headset decided is the page's
  assert.equal(storage.map.has('citydriver.graphics'), false);
  graphics.setHeadset(false);
  assert.equal(graphics.levelId, 'balanced');
  // Frames something else caps (an emulator on a 60 Hz desktop claiming 72):
  // two rungs given up for nothing come back, and 60 is the target
  const capped = graphicsAt(levelIndex('balanced'));
  capped.setHeadset(true, { frameRate: 72 });
  const emulator = new Headset(capped, () => 60).run(60);
  assert.deepEqual(emulator.rungs, ['basic@0.85', 'basic@0.7', 'balanced@0.85']);
  assert.ok(Math.abs(capped.target - 60) < .5, `target follows the frames: ${capped.target}`);
  emulator.run(120);
  assert.equal(emulator.rungs.length, 3, 'and it stops there');
});

test('in a headset a pinned level keeps its level and adapts only its scale, and a view that cannot scale keeps whole levels', () => {
  const pinned = graphicsAt(levelIndex('high'));
  pinned.setMode('high'); pinned.setHeadset(true, { frameRate: 72 });
  const headset = new Headset(pinned, (level, scale) => scale < 1 ? 72 : 60).run(60);
  assert.deepEqual(headset.rungs, ['high@1', 'high@0.85'], 'the player chose the level; the scale is the headset\'s');
  // A browser without XRView.requestViewportScale: its rungs are whole levels
  const whole = graphicsAt(levelIndex('balanced'));
  whole.setHeadset(true, { frameRate: 72, scalable: false });
  assert.deepEqual([whole.levelId, whole.xrScale], ['basic', 1]);
  assert.deepEqual(whole.ladder, [[levelIndex('balanced'), 1], [levelIndex('basic'), 1]]);
  // A PC's card starts at the top of its own ladder, where the page was
  const card = capableAt(levelIndex('high'));
  card.setHeadset(true, { frameRate: 90 });
  assert.deepEqual([card.levelId, card.xrScale], HEADSET_LADDERS.dedicated[0]);
});
