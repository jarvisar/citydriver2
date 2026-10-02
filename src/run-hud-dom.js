import { $, text, hide, data, attribute, width } from './hud-dom.js';

// A run shows every panel. Free drive (see freeHudModel) shows only the task
// card, and only while it has something to say.
export function renderRunHud(model) {
  const task = model.running || Boolean(model.task);
  hide($('taxi-hud'), !model.running); hide($('taxi-task'), !task); hide($('taxi-dash'), !model.running);
  hide($('taxi-nav'), !task || !model.navigation);
  hide($('taxi-buttons'), !model.buttons); hide($('taxi-boost'), !model.boostVisible);
  if (model.buttons) {
    text('taxi-boost-state', model.boostState);
    data('taxi-buttons', 'boosting', model.boosting); data('taxi-buttons', 'drifting', model.drifting);
    data('taxi-buttons', 'stage', String(model.driftStage)); data('taxi-buttons', 'turbo', model.turbo);
    width('drift-charge-fill', `${Math.round(model.driftCharge * 100)}%`);
    const state = $('drift-state');
    text('drift-state', model.driftState ?? state.dataset.idle ?? '');
  }
  if (!task) return;
  if (model.running) {
    text('taxi-clock-label', model.clockLabel); text('taxi-clock', model.clock);
    data('taxi-clock', 'urgent', model.urgent); data('taxi-hud', 'overtime', model.overtime);
    text('taxi-cash', model.cash); attribute($('taxi-cash'), 'aria-label', model.cashLabel);
    text('taxi-fares', model.fares); text('taxi-speed', model.speed);
    width('taxi-boost-fill', `${model.boost * 100}%`);
    attribute($('taxi-boost'), 'aria-valuenow', Math.round(model.boost * 100));
    if ($('taxi-controller-boost').value !== model.boost) $('taxi-controller-boost').value = model.boost;
  }
  text('taxi-stage', model.stage); text('taxi-fare-status', model.fareStatus);
  text('taxi-task-title', model.title); text('taxi-task-detail', model.detail);
  data('taxi-task', 'stage', model.status); data('taxi-task', 'urgent', model.taskUrgent); data('taxi-task', 'arriving', model.arriving);
  data('taxi-task', 'info', model.info);
  text('taxi-combo', model.combo); text('taxi-party', model.party); data('taxi-party', 'band', model.band);
  text('taxi-next-stop', model.nextStop); data('taxi-next-stop', 'mood', model.mood);
  const progress = model.stopProgress, track = $('taxi-stop-progress').parentElement;
  hide(track, !progress?.visible);
  if (progress) {
    attribute(track, 'aria-label', progress.label); attribute(track, 'aria-valuenow', Math.round(progress.fraction * 100));
    width('taxi-stop-progress', `${progress.fraction * 100}%`);
  }
  const timer = model.timer;
  hide($('taxi-timer'), !timer); hide($('taxi-timer-fill').parentElement, !timer || timer.fraction === null);
  if (timer) {
    text('taxi-timer', timer.text); data('taxi-timer', 'rating', timer.tone); data('taxi-timer-fill', 'rating', timer.tone);
    attribute($('taxi-timer'), 'aria-label', timer.label);
    if (timer.fraction !== null) width('taxi-timer-fill', `${timer.fraction * 100}%`);
  }
  if (model.navigation) {
    text('taxi-nav-distance', model.navigation.distance); attribute($('taxi-nav'), 'aria-label', model.navigation.label);
  }
}

export function renderLocationHud(model) {
  text('distance', model.distance); text('city-heading', model.heading); text('city-location', model.place);
  text('world-map-here', model.place); text('city-cash', model.cash);
}
