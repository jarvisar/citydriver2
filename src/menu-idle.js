import { CAMERA_VIEWS } from './camera-preferences.js';

const IDLE_DELAY = 60_000, FADE_TIME = 450;

export function setupMenuIdle({ app, welcome, fade, rendering, enabled }) {
  const scenicView = rendering.viewIndex, chaseView = CAMERA_VIEWS.findIndex(view => view.thirdPerson);
  let lastActivity = null, idle = false, returnView = scenicView, nextSwitch = Infinity, transition = null;
  let focus = null;
  const schedule = now => { nextSwitch = now + 12_000 + Math.random() * 12_000; };

  function wake() {
    lastActivity = performance.now();
    if (!idle) return false;
    idle = false;
    app.classList.remove('menu-idle'); welcome.inert = false;
    rendering.setView(returnView);
    focus?.focus({ preventScroll: true }); focus = null;
    transition = null; nextSwitch = Infinity; fade.style.opacity = '0';
    return true;
  }
  function stop() { wake(); lastActivity = null; }
  // (until when the click of a tap that woke the menu is swallowed)
  let swallow = -Infinity;
  function activity(event) {
    if (event.type === 'click' && performance.now() < swallow) { swallow = -Infinity; event.preventDefault(); event.stopImmediatePropagation(); return; }
    const woke = wake();
    // A tap on the sleeping menu should not become a driving gesture.
    if (woke && ['pointerdown', 'keydown', 'click', 'wheel'].includes(event.type)) {
      event.preventDefault(); event.stopImmediatePropagation();
      // (nor its click, which comes once the menu is awake: on a phone it
      // pressed whatever button was under the finger, and started a drive)
      if (event.type === 'pointerdown') swallow = performance.now() + 1000;
    }
  }
  for (const name of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup', 'wheel', 'click', 'focusin']) {
    window.addEventListener(name, activity, { capture: true });
  }
  for (const name of ['focus', 'blur', 'resize', 'gamepadconnected', 'gamepaddisconnected']) window.addEventListener(name, stop);
  document.addEventListener('visibilitychange', stop);

  function gamepadActive() {
    try {
      return Array.from(navigator.getGamepads?.() ?? []).some(pad => pad?.connected && (
        pad.axes.some(axis => Math.abs(axis) > .2) || pad.buttons.some(button => button.pressed || button.value > .08)));
    } catch { return false; }
  }
  function update(now) {
    if (!enabled()) { if (lastActivity !== null) stop(); return false; }
    if (lastActivity === null) lastActivity = now;
    // Read before menu navigation so a sleeping menu cannot confirm an unseen button.
    if (gamepadActive()) return wake();
    if (!idle && now - lastActivity >= IDLE_DELAY) {
      idle = true; returnView = rendering.viewIndex;
      focus = welcome.contains(document.activeElement) ? document.activeElement : null;
      welcome.inert = true; app.classList.add('menu-idle'); schedule(now);
    }
    if (!idle) return false;
    if (!transition && now >= nextSwitch) {
      transition = { at: now, switched: false, view: rendering.viewIndex === scenicView ? chaseView : scenicView };
    }
    if (transition) {
      const elapsed = now - transition.at;
      if (!transition.switched && elapsed >= FADE_TIME) {
        rendering.setView(transition.view); transition.switched = true;
        // Hold the dark frame for the new camera even after a slow frame.
        transition.at = now - FADE_TIME; fade.style.opacity = '1';
      } else if (elapsed >= FADE_TIME * 2) {
        fade.style.opacity = '0'; transition = null; schedule(now);
      } else {
        const amount = Math.max(0, Math.min(1, transition.switched ? 2 - elapsed / FADE_TIME : elapsed / FADE_TIME));
        fade.style.opacity = String(amount * amount * (3 - 2 * amount));
      }
    }
    return false;
  }
  return { update, stop };
}
