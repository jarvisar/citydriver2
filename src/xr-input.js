const deadzone = (value = 0, threshold = .18) => Math.abs(value) <= threshold ? 0 : Math.sign(value) * Math.min(1, (Math.abs(value) - threshold) / (1 - threshold));
const button = (pad, index) => pad?.buttons[index]?.value ?? Number(pad?.buttons[index]?.pressed ?? false);
// Either stick walks a menu: whichever is pushed further.
const stick = (left, right, axis) => {
  const a = left?.axes[axis] ?? 0, b = right?.axes[axis] ?? 0;
  return Math.abs(a) >= Math.abs(b) ? a : b;
};

// XR controllers belong to the session, not navigator.getGamepads(). These
// indices are the xr-standard layout, including its empty touchpad slots.
// The grips are the pad's bumpers: left drifts, right boosts. B and Y both
// pause, so no single press leaves the headset; Exit VR is in the pause menu.
export class XRInput {
  constructor(onAction) {
    this.onAction = onAction;
    this.state = {};
    this.previous = {};
    this.sources = [];
    this.requireNeutral = true;
  }
  clear() { this.state = {}; this.requireNeutral = true; }
  // `paused` is true while a headset menu is up: the pause menu, a chooser,
  // the results or the title. The drive is still, and the sticks walk the menu.
  update(sources = [], { blocked = false, paused = false } = {}) {
    const controllers = Array.from(sources).filter(source => source.gamepad?.mapping === 'xr-standard' && !source.hand);
    if (this.sources.some(source => !controllers.includes(source)) || controllers.some(source => !this.sources.includes(source))) this.clear();
    const lost = this.sources.length > 0 && !controllers.length;
    this.sources = controllers;
    // Putting the controllers down (or picking up hands) pauses the drive, as
    // a gamepad's disconnecting does, and hands can then work the menu.
    if (lost && !paused && !blocked) this.onAction('pause');
    const left = controllers.find(source => source.handedness === 'left')?.gamepad;
    const right = controllers.find(source => source.handedness === 'right')?.gamepad;
    const steer = deadzone(left?.axes[2] ?? right?.axes[2]);
    const state = {
      forward: deadzone(button(right, 0), .08),
      brake: deadzone(button(left, 0), .08),
      left: Math.max(0, -steer), right: Math.max(0, steer),
      handbrake: button(left, 1) > .5,
      boost: button(right, 1) > .5,
    };
    const buttons = {
      view: button(right, 4) > .5, pause: button(right, 5) > .5 || button(left, 5) > .5 || button(left, 3) > .5,
      reset: button(left, 4) > .5, recenterVR: button(right, 3) > .5,
      vrMenuPrevious: stick(left, right, 3) < -.5, vrMenuNext: stick(left, right, 3) > .5,
      vrMenuLeft: stick(left, right, 2) < -.5, vrMenuRight: stick(left, right, 2) > .5,
    };
    const pressed = Object.keys(buttons).filter(action => buttons[action] && !this.previous[action]);
    this.previous = buttons;
    // Pause must remain reachable while a trigger/stick is held after focus
    // changes. Driving still requires neutral, and blocked sessions consume
    // every edge so system-menu presses cannot leak back into the game.
    if (!blocked) for (const action of ['pause', 'recenterVR']) {
      if (pressed.includes(action)) { this.state = {}; this.onAction(action); return; }
    }
    const active = Object.values(state).some(Boolean) || Object.values(buttons).some(Boolean);
    if (blocked || this.requireNeutral) {
      this.state = {}; this.requireNeutral = blocked || active;
      return;
    }
    this.state = paused ? {} : state;
    if (paused) {
      // A or X selects, as across Quest menus (the trigger points and selects).
      for (const action of ['vrMenuPrevious', 'vrMenuNext', 'vrMenuLeft', 'vrMenuRight']) if (pressed.includes(action)) this.onAction(action);
      if (pressed.includes('view') || pressed.includes('reset')) this.onAction('vrMenuConfirm');
      return;
    }
    if (pressed.includes('view')) this.onAction('view');
    if (pressed.includes('reset')) { this.onAction('reset'); return; }
    if (state.forward || state.brake) this.onAction('drive');
  }
}
