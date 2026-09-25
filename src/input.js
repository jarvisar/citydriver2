import { GamepadInput } from './gamepad.js';
import { TouchStick } from './touch-stick.js';
import { KonamiCode } from './konami-code.js';
import { XRInput } from './xr-input.js';

export class Input {
  constructor(onAction, onControllerConnection = () => {}, onKonami = () => {}) {
    this.keys = new Set(); this.onAction = onAction;
    this.xr = new XRInput(onAction); this.xrActive = false;
    this.konami = new KonamiCode();
    this.touchStick = new TouchStick(document.querySelector('#touch-stick'), () => onAction('drive'), document.querySelector('#scene'));
    this.codes = { forward: ['KeyW', 'ArrowUp', 'Numpad8'], brake: ['KeyS', 'ArrowDown', 'Numpad2'], left: ['KeyA', 'ArrowLeft', 'Numpad4'], right: ['KeyD', 'ArrowRight', 'Numpad6'], handbrake: ['Space'], boost: ['ShiftLeft', 'ShiftRight'] };
    this.touchButtons = {};
    for (const action of ['boost', 'handbrake']) {
      const button = document.querySelector(`[data-drive-button="${action}"]`);
      if (!button) continue;
      button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); this.touchButtons[action] = true; });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => { this.touchButtons[action] = false; });
    }
    // The driving simulation reads this up to twelve times per displayed frame, so
    // it fills one reused record rather than building a fresh object each step.
    this.actions = Object.keys(this.codes);
    this.driving = Object.fromEntries([...this.actions.map(action => [action, false]), ['touchStick', null], ['touchDrive', null]]);
    this.gamepad = new GamepadInput(onAction, connected => {
      this.keys.clear(); this.touchStick.clear();
      document.body.dataset.controller = String(connected);
      onControllerConnection(connected);
    }, undefined, () => { this.clear(); onKonami(); });
    window.addEventListener('keydown', e => {
      // Native mixer sliders own their arrow, Home and End keys. Editing a
      // volume must not also accelerate the car or swallow keyboard access.
      if (e.target.matches?.('input, select, textarea') && !['Escape', 'KeyP'].includes(e.code)) return;
      // Let menu buttons keep their native keyboard activation.
      if (e.target.closest?.('button') && ['Space', 'Enter'].includes(e.code)) return;
      // The keyboard and controller sequences share the same hidden toggle.
      if (this.konami.keydown(e)) {
        e.preventDefault(); this.clear(); onKonami();
        return;
      }
      if (e.code === 'F3' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) onAction('fps');
        return;
      }
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) onAction('fullscreen');
        return;
      }
      // M opens and closes the city map, so it works with the map open too
      if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) onAction('map');
        return;
      }
      if (['KeyC', 'KeyG'].includes(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) onAction('car');
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      if (e.target.matches?.('input[type="range"]') && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.code)) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Numpad8', 'Numpad2', 'Numpad4', 'Numpad6', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat) {
        if ([...this.codes.forward, ...this.codes.brake].includes(e.code)) onAction('drive');
        if (['KeyP', 'Escape'].includes(e.code)) onAction('pause');
        if (e.code === 'KeyR') onAction('reset');
        if (e.code === 'KeyV') onAction('view');
        if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey) onAction('autodrive');
        if (e.code === 'KeyO' && !e.ctrlKey && !e.metaKey && !e.altKey) onAction('ambientOcclusion');
      }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());
  }
  get state() {
    const state = this.driving;
    let held = false;
    for (const action of this.actions) {
      const value = this.xrActive ? this.xr.state[action] || false : this.codes[action].some(code => this.keys.has(code)) || this.gamepad.state[action] || this.touchButtons[action] || false;
      state[action] = value;
      if (value && action !== 'boost' && action !== 'handbrake') held = true;
    }
    // Set iteration preserves press order. Overlapping A/D presses select the
    // newest direction immediately; releasing it restores the still-held key.
    if (!this.xrActive) {
      let steering = 0;
      for (const code of this.keys) {
        if (this.codes.left.includes(code)) steering = -1;
        if (this.codes.right.includes(code)) steering = 1;
      }
      if (steering) { state.left = steering < 0; state.right = steering > 0; }
    }
    state.touchStick = null; state.touchDrive = null;
    if (held || this.gamepad.connected || this.xrActive) this.touchStick.clear();
    else if (this.touchStick.engaged) state.touchStick = this.touchStick.vector;
    return state;
  }
  clear(options) { this.keys.clear(); this.touchButtons = {}; this.touchStick.clear(); this.gamepad.clear(options); this.xr.clear(); this.konami.reset(); }
}
