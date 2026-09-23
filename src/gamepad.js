import { KonamiCode } from './konami-code.js';

const CODE_BUTTONS = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 1: 'KeyB', 0: 'KeyA' };
const deadzone = (value = 0, threshold = .12) => Math.abs(value) <= threshold ? 0 : Math.sign(value) * Math.min(1, (Math.abs(value) - threshold) / (1 - threshold));
const buttonValue = (pad, index) => {
  const button = pad.buttons[index];
  return button ? Math.min(1, Math.max(0, button.value ?? Number(button.pressed))) : 0;
};

// Use the browser's standard Xbox / PlayStation layout, with the same indices
// as a best-effort fallback for handhelds exposing an unmapped gamepad.
export class GamepadInput {
  constructor(onAction, onConnection, getGamepads = () => navigator.getGamepads?.() ?? [], onKonami = () => {}) {
    this.onAction = onAction; this.onConnection = onConnection; this.getGamepads = getGamepads;
    this.index = null; this.connected = false; this.state = {}; this.scroll = 0;
    this.previousButtons = []; this.requireNeutral = false;
    this.konami = new KonamiCode(); this.onKonami = onKonami;
  }
  clear({ preserveKonami = false } = {}) {
    this.state = {}; this.requireNeutral = true;
    if (!preserveKonami) this.konami.reset();
  }
  // `menu` is 'pause' for the pause screen and the results card, 'welcome' for
  // the title screen, truthy for a modal chooser, and false during a drive.
  update({ blocked = false, paused = false, menu = false } = {}) {
    let pads;
    try { pads = Array.from(this.getGamepads()).filter(pad => pad?.connected); }
    catch { pads = []; } // Unsupported or restricted Gamepad API: keep other inputs available.
    const pad = pads.find(pad => pad.index === this.index) ?? pads.find(pad => pad.mapping === 'standard') ?? pads[0];
    if ((pad?.index ?? null) !== this.index) {
      this.index = pad?.index ?? null; this.state = {}; this.previousButtons = [];
      this.konami.reset();
      // A replacement controller must start at rest; the first can start with Gas.
      this.requireNeutral = this.connected;
    }
    if (Boolean(pad) !== this.connected) {
      this.connected = Boolean(pad); this.onConnection(this.connected);
    }
    if (!pad) { this.state = {}; this.scroll = 0; return; }
    // The right stick scrolls a long menu, so read-only panels are reachable too.
    this.scroll = menu ? deadzone(pad.axes[3], .2) : 0;
    const buttons = pad.buttons.map((_, index) => buttonValue(pad, index) > .5);
    // Treat stick directions as menu buttons so they fire once per tilt. The two
    // axes stay apart so a grid of cards can be crossed by row as well as along.
    buttons[17] = (pad.axes[0] ?? 0) < -.5;
    buttons[18] = (pad.axes[0] ?? 0) > .5;
    buttons[19] = (pad.axes[1] ?? 0) < -.5;
    buttons[20] = (pad.axes[1] ?? 0) > .5;
    const pressed = index => buttons[index] && !this.previousButtons[index];
    const steer = deadzone(pad.axes[0]);
    const state = {
      forward: Math.max(deadzone(buttonValue(pad, 7), .08), buttonValue(pad, 0)),
      brake: Math.max(deadzone(buttonValue(pad, 6), .08), buttonValue(pad, 1)),
      left: Math.max(-steer, buttonValue(pad, 14), 0),
      right: Math.max(steer, buttonValue(pad, 15), 0),
      boost: buttonValue(pad, 5),
      handbrake: buttonValue(pad, 13),
    };
    const active = Object.values(state).some(Boolean) || buttons.some(Boolean);
    if (blocked || this.requireNeutral) {
      if (blocked) this.konami.reset();
      this.state = {}; this.scroll = 0; this.previousButtons = buttons;
      this.requireNeutral = blocked || active;
      return;
    }
    // D-pad directions, then the east and south face buttons (B/A or Circle/Cross).
    // Menus keep their normal navigation; held buttons count only once.
    if (paused || menu) this.konami.reset();
    else {
      const presses = buttons.flatMap((down, index) => down && pressed(index) && index < 17 ? [index] : []);
      if (presses.length > 1) this.konami.reset();
      else if (presses.length === 1 && this.konami.press(CODE_BUTTONS[presses[0]] ?? 'Other')) {
        this.previousButtons = buttons; this.clear(); this.onKonami();
        return;
      }
    }
    // Sample once per display frame, including while paused, so held shortcuts
    // fire once and Start can resume the game without a keyboard or touchscreen.
    this.state = paused ? {} : state;
    const pause = pressed(9), view = pressed(2), reset = pressed(3), nextJourney = pressed(5);
    const map = pressed(8), fullscreen = pressed(4), fps = pressed(11), car = pressed(10);
    const back = pressed(1), confirm = pressed(0), autodrive = pressed(12);
    const previous = pressed(14) || pressed(17), next = pressed(15) || pressed(18);
    const up = pressed(12) || pressed(19), down = pressed(13) || pressed(20);
    this.previousButtons = buttons;
    if (fps) this.onAction('fps');
    if (fullscreen) { this.onAction('fullscreen'); return; }
    // A chooser takes the whole pad. The pause screen only borrows the
    // directions and A, so the shortcuts below still work from it.
    if (menu && menu !== 'pause' && menu !== 'welcome') {
      this.state = {};
      if (map || car || back) this.onAction('menuClose');
      else if (previous) this.onAction('menuPrevious');
      else if (next) this.onAction('menuNext');
      else if (up) this.onAction('menuUp');
      else if (down) this.onAction('menuDown');
      else if (confirm) this.onAction('menuConfirm');
      return;
    }
    // The title screen is a menu with the car cruising behind it: the D-pad and
    // face buttons choose, and only the gas pedal takes the wheel.
    if (menu === 'welcome') {
      this.state = { forward: deadzone(buttonValue(pad, 7), .08) };
      if (this.state.forward) this.onAction('drive');
      else if (car) this.onAction('car');
      else if (previous) this.onAction('menuPrevious');
      else if (next) this.onAction('menuNext');
      else if (up) this.onAction('menuUp');
      else if (down) this.onAction('menuDown');
      else if (confirm || pause) this.onAction('menuConfirm');
      else if (view) this.onAction('view');
      return;
    }
    if (map) { this.onAction('map'); return; }
    if (car) { this.onAction('car'); return; }
    if (pause) { this.onAction('pause'); return; }
    if (nextJourney) { this.onAction('nextJourney'); return; }
    if (paused) {
      // Paused, the D-pad and sticks move the pause screen's focus ring rather
      // than the car, so resume, the garage and the graphics settings are all
      // reachable without a keyboard or a touchscreen.
      if (menu !== 'pause') return;
      if (previous) this.onAction('menuPrevious');
      else if (next) this.onAction('menuNext');
      else if (up) this.onAction('menuUp');
      else if (down) this.onAction('menuDown');
      else if (confirm) this.onAction('menuConfirm');
      else if (back) this.onAction('menuClose');
      return;
    }
    if (state.forward || state.brake) this.onAction('drive');
    if (autodrive) this.onAction('autodrive');
    if (view) this.onAction('view');
    if (reset) this.onAction('reset');
  }
}
