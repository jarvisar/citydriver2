const deadzone = (value = 0, threshold = .18) => Math.abs(value) <= threshold ? 0 : Math.sign(value) * Math.min(1, (Math.abs(value) - threshold) / (1 - threshold));
const button = (pad, index) => pad?.buttons[index]?.value ?? Number(pad?.buttons[index]?.pressed ?? false);

// XR controllers belong to the session, not navigator.getGamepads(). These
// indices are the xr-standard layout, including its empty touchpad slots.
export class XRInput {
  constructor(onAction) {
    this.onAction = onAction;
    this.state = {};
    this.previous = {};
    this.sources = [];
    this.requireNeutral = true;
  }
  clear() { this.state = {}; this.requireNeutral = true; }
  update(sources = [], { blocked = false, paused = false } = {}) {
    const controllers = Array.from(sources).filter(source => source.gamepad?.mapping === 'xr-standard' && !source.hand);
    if (this.sources.some(source => !controllers.includes(source)) || controllers.some(source => !this.sources.includes(source))) this.clear();
    this.sources = controllers;
    const left = controllers.find(source => source.handedness === 'left')?.gamepad;
    const right = controllers.find(source => source.handedness === 'right')?.gamepad;
    const steer = deadzone(left?.axes[2] ?? right?.axes[2]);
    const state = {
      forward: deadzone(button(right, 0), .08),
      brake: deadzone(button(left, 0), .08),
      left: Math.max(0, -steer), right: Math.max(0, steer),
      handbrake: Math.max(button(left, 1), button(right, 1)) > .5,
    };
    const buttons = {
      view: button(right, 4) > .5, pause: button(right, 5) > .5 || button(left, 3) > .5,
      reset: button(left, 4) > .5, exitVR: button(left, 5) > .5,
      recenterVR: button(right, 3) > .5,
      vrMenuPrevious: (left?.axes[3] ?? right?.axes[3] ?? 0) < -.5,
      vrMenuNext: (left?.axes[3] ?? right?.axes[3] ?? 0) > .5,
    };
    const pressed = Object.keys(buttons).filter(action => buttons[action] && !this.previous[action]);
    this.previous = buttons;
    // Pause must remain reachable while a trigger/stick is held after focus
    // changes. Driving still requires neutral, and blocked sessions consume
    // every edge so system-menu presses cannot leak back into the game.
    if (!blocked) for (const action of ['exitVR', 'pause', 'recenterVR']) {
      if (pressed.includes(action)) { this.state = {}; this.onAction(action); return; }
    }
    const active = Object.values(state).some(Boolean) || Object.values(buttons).some(Boolean);
    if (blocked || this.requireNeutral) {
      this.state = {}; this.requireNeutral = blocked || active;
      return;
    }
    this.state = paused ? {} : state;
    if (paused) {
      if (pressed.includes('vrMenuPrevious')) this.onAction('vrMenuPrevious');
      if (pressed.includes('vrMenuNext')) this.onAction('vrMenuNext');
      if (pressed.includes('view')) this.onAction('vrMenuConfirm');
      if (pressed.includes('reset')) this.onAction('reset');
      return;
    }
    if (pressed.includes('view')) this.onAction('view');
    if (pressed.includes('reset')) { this.onAction('reset'); return; }
    if (!paused && (state.forward || state.brake)) this.onAction('drive');
  }
}
