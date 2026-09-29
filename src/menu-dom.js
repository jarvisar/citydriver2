import { attribute, text } from './hud-dom.js';

const LABELS = {
  '#start span': 'start', '#free-drive span': 'free', '#demolition span': 'demolition', '#resume span': 'resume',
  '#taxi-retry': 'retry', '#taxi-free': 'free', '#demolition-retry': 'retry', '#demolition-taxi': 'taxi', '#demolition-free': 'free',
  '#taxi-fleet-results': 'fleet', '#pause-fleet > span:first-child': 'fleet',
  '#restart-run span': 'restart', '#switch-mode span': 'switchMode', '#other-run span': 'otherRun',
  '#change-car .panel-button-label': 'garage', '#autodrive .panel-button-label': 'autodrive', '#traffic .panel-button-label': 'traffic',
  '#sound .panel-button-label': 'sound', '#open-world-map .panel-button-label': 'map', '#city-map-open span': 'map',
};

export function bindMenuControls(getControls) {
  const bindings = { start: 'start', 'free-drive': 'free', demolition: 'demolition', resume: 'resume',
    'taxi-retry': 'retry', 'taxi-free': 'free', 'demolition-retry': 'retry', 'demolition-taxi': 'taxi', 'demolition-free': 'free',
    'restart-run': 'restart', 'switch-mode': 'switchMode', 'other-run': 'otherRun', 'change-car': 'garage',
    'close-cars': 'back', 'close-fleet': 'back', 'close-world-map': 'back', 'open-world-map': 'map', 'city-map-open': 'map', 'city-map': 'map',
    autodrive: 'autodrive', traffic: 'traffic', sound: 'sound', reset: 'reset' };
  for (const [id, key] of Object.entries(bindings)) document.getElementById(id).addEventListener('click', () => {
    const control = getControls()[key];
    if (!control.disabled) control.activate();
  });
  for (const button of document.querySelectorAll('[data-open-fleet]')) button.addEventListener('click', () => getControls().fleet.activate());
}

export function renderMenuControls(controls) {
  for (const [selector, key] of Object.entries(LABELS)) {
    const label = document.querySelector(selector);
    if (label.textContent !== controls[key].label) label.textContent = controls[key].label;
  }
  for (const [id, key] of [['change-car', 'garage'], ['autodrive', 'autodrive'], ['traffic', 'traffic']]) {
    const button = document.getElementById(id);
    if (button.disabled !== controls[key].disabled) button.disabled = controls[key].disabled;
  }
  for (const id of ['autodrive', 'traffic', 'sound']) attribute(document.getElementById(id), 'aria-pressed', controls[id].toggle);
  text('current-car', controls.garage.value);
}
