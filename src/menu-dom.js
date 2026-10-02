import { attribute, text } from './hud-dom.js';

const LABELS = {
  '#start span': 'start', '#free-drive span': 'free', '#demolition span': 'demolition', '#resume span': 'resume',
  '#taxi-retry': 'retry', '#taxi-keep': 'keep', '#demolition-retry': 'retry', '#demolition-taxi': 'taxi', '#demolition-keep': 'keep', '#end-run span': 'end',
  '#taxi-garage-results': 'garage',
  '#restart-run span': 'restart', '#switch-mode span': 'switchMode', '#other-run span': 'otherRun',
  '#change-car .panel-button-label': 'garage', '#autodrive .panel-button-label': 'autodrive', '#traffic .panel-button-label': 'traffic',
  '#drift-tap .panel-button-label': 'driftTap', '#vibration .panel-button-label': 'vibration',
  '#sound .panel-button-label': 'sound', '#open-world-map .panel-button-label': 'map', '#city-map-open span': 'map',
};

export function bindMenuControls(getControls) {
  const bindings = { start: 'start', 'free-drive': 'free', demolition: 'demolition', resume: 'resume',
    'taxi-retry': 'retry', 'taxi-keep': 'keep', 'demolition-retry': 'retry', 'demolition-taxi': 'taxi', 'demolition-keep': 'keep',
    'restart-run': 'restart', 'end-run': 'end', 'switch-mode': 'switchMode', 'other-run': 'otherRun', 'change-car': 'garage',
    'close-cars': 'back', 'taxi-garage-results': 'garage', 'close-world-map': 'back', 'open-world-map': 'map', 'city-map-open': 'map', 'city-map': 'map',
    autodrive: 'autodrive', traffic: 'traffic', 'drift-tap': 'driftTap', vibration: 'vibration', sound: 'sound', reset: 'reset' };
  for (const [id, key] of Object.entries(bindings)) document.getElementById(id).addEventListener('click', () => {
    const control = getControls()[key];
    if (!control.disabled) control.activate();
  });
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
  for (const [id, key] of [['autodrive', 'autodrive'], ['traffic', 'traffic'], ['drift-tap', 'driftTap'], ['vibration', 'vibration'], ['sound', 'sound']]) attribute(document.getElementById(id), 'aria-pressed', controls[key].toggle);
  text('current-car', controls.garage.value);
}
