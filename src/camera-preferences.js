export const CAMERA_VIEWS = [
  { height: 165, label: 'Far view' }, { height: 75, label: 'Close view' },
  { height: 115, label: 'Third-person view', thirdPerson: true },
  { height: 115, label: 'First-person view', firstPerson: true },
];
export const CAMERA_ZOOM_MIN = .45, CAMERA_ZOOM_MAX = 6;
export const CAMERA_INPUTS = ['mouse', 'touch', 'controller'];
const KEY = 'citydriver.camera';
// Saves before version 2 used six views. Removed overhead seats take the nearest remaining one.
const LEGACY_VIEWS = [0, 0, 1, 1, 2, 3];
const validZoom = value => Number.isFinite(value) && value >= CAMERA_ZOOM_MIN && value <= CAMERA_ZOOM_MAX;
const validView = value => Number.isInteger(value) && value >= 0 && value < CAMERA_VIEWS.length;

// Only deliberate choices are saved: the title camera, collision pull-ins and
// headset views never overwrite the player's driving/walking preferences.
export class CameraPreferences {
  constructor(storage) {
    this.listeners = new Set();
    let saved;
    try { this.storage = storage ?? globalThis.localStorage; saved = JSON.parse(this.storage?.getItem(KEY) ?? 'null'); } catch { /* Optional storage. */ }
    this.inputs = Object.fromEntries(CAMERA_INPUTS.map(input => {
      const value = saved?.inputs?.[input];
      return [input, { sensitivity: Number.isFinite(value?.sensitivity) && value.sensitivity >= .25 && value.sensitivity <= 2 ? value.sensitivity : 1,
        invertY: value?.invertY === true }];
    }));
    this.profiles = Object.fromEntries(['driving', 'walking'].map(mode => {
      const value = saved?.profiles?.[mode];
      const view = saved?.version === 2 ? value?.view : Number.isInteger(value?.view) ? LEGACY_VIEWS[value.view] : undefined;
      return [mode, { view: validView(view) ? view : 2, zoom: validZoom(value?.zoom) ? value.zoom : 1 }];
    }));
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save() {
    try { this.storage?.setItem(KEY, JSON.stringify({ version: 2, inputs: this.inputs, profiles: this.profiles })); } catch { /* Works for this visit. */ }
    for (const fn of this.listeners) fn();
  }
  setInput(input, values) {
    if (!CAMERA_INPUTS.includes(input)) return;
    const current = this.inputs[input];
    if (Number.isFinite(values.sensitivity)) current.sensitivity = Math.max(.25, Math.min(2, values.sensitivity));
    if (typeof values.invertY === 'boolean') current.invertY = values.invertY;
    this.save();
  }
  setProfile(mode, values) {
    const current = this.profiles[mode];
    if (!current) return;
    let changed = false;
    for (const [key, valid] of [['view', validView], ['zoom', validZoom]]) {
      if (valid(values[key]) && current[key] !== values[key]) { current[key] = values[key]; changed = true; }
    }
    if (changed) this.save();
  }
  resetInput(input) { this.setInput(input, { sensitivity: 1, invertY: false }); }
  // Call at input boundaries; never scale tracked head motion or vehicle controls.
  look(input, yaw, pitch, apply) {
    const setting = this.inputs[input];
    apply(yaw * setting.sensitivity, pitch * setting.sensitivity * (setting.invertY ? -1 : 1));
  }
}
