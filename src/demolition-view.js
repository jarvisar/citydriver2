import { demolitionRank, money } from './demolition-run.js';
import { FloatingLabels } from './floating-labels.js';

const $ = id => document.getElementById(id);
const compactCash = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const compact = value => value >= 1000 ? compactCash.format(value) : money(value);
// As TaxiView's: the HUD refreshes ten times a second, so nothing is written
// that is already there
const text = (id, value) => { const element = $(id), next = String(value); if (element.textContent !== next) element.textContent = next; };
const hide = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };
const data = (id, key, value) => { const element = $(id), next = String(value); if (element.dataset[key] !== next) element.dataset[key] = next; };
const attribute = (element, name, value) => { const next = String(value); if (element.getAttribute(name) !== next) element.setAttribute(name, next); };
const width = (id, value) => { const style = $(id).style; if (style.width !== value) style.width = value; };
const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const day = date => { const parsed = new Date(`${date}T12:00:00`); return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

// What each blow's number looks like as it floats up off the wreckage: the
// run's orange for damage, hotter for a car written off, red for a fine and
// green for time won
const LABEL_STYLES = {
  smash: { colour: '#ffc07a', size: 2.4 }, dent: { colour: '#ffc07a', size: 2.4 },
  wreck: { colour: '#ff8a2a', size: 3.3, caption: 'WRECKED' }, penalty: { colour: '#ff6d5e', size: 3, caption: 'PEDESTRIAN' },
  bonus: { colour: '#8ff0b0', size: 2.6 },
};
export class DemolitionView {
  constructor(scene) {
    this.labels = new FloatingLabels(scene, 'demolition-labels');
    this.shown = 0;
  }
  // A stand-in for the labels' program, compiled with the city
  warmupObjects() { return this.labels.warmupObjects(); }
  reset() { this.labels.reset(); this.shown = 0; }
  // A blow's price (or a fine, or time won) rising off where it landed
  pop(event) {
    const style = LABEL_STYLES[event.kind] ?? LABEL_STYLES.smash;
    const amount = event.kind === 'penalty' ? `−$${event.fine.toLocaleString('en-US')}` : event.kind === 'bonus' ? `+${event.seconds}s` : `$${event.value.toLocaleString('en-US')}`;
    // (a blow in a chain says what it was multiplied by)
    const times = ['smash', 'dent', 'wreck'].includes(event.kind) && event.multiplier > 1 ? `×${event.multiplier}` : '';
    const caption = [style.caption, times].filter(Boolean).join(' ');
    this.labels.pop({ x: event.x, y: event.y, z: event.z, amount, caption, colour: style.colour, size: style.size });
  }
  // `camera`, if given, keeps near labels small
  render(origin, time, camera = null) { this.labels.render(origin, time, camera); }
  // The driving HUD, in the taxi's panels: the clock and the banked damage
  // top left, the chain where the fare would be, the boost as a taxi has it
  hud(run, vehicle) {
    const running = run.running;
    hide($('taxi-hud'), !running); hide($('taxi-task'), !running); hide($('taxi-nav'), true);
    hide($('taxi-buttons'), !running); hide($('taxi-boost'), !running); hide($('taxi-dash'), !running);
    if (!running) { this.shown = run.score; return; }
    text('taxi-clock', Math.ceil(run.timeLeft)); data('taxi-clock', 'urgent', String(run.timeLeft <= 10));
    // The total counts up to what the chains bank, like a till
    this.shown = run.score < this.shown ? run.score : Math.min(run.score, this.shown + Math.max(900, (run.score - this.shown) * .35));
    text('taxi-cash', compact(this.shown)); attribute($('taxi-cash'), 'aria-label', `Damage ${money(run.score)}`);
    text('taxi-fares', `${run.smashed + run.carsHit} smashed`);
    text('taxi-speed', Math.round(Math.abs(vehicle.speed) * 2.23694));
    width('taxi-boost-fill', `${run.boost * 100}%`);
    attribute($('taxi-boost'), 'aria-valuenow', String(Math.round(run.boost * 100)));
    if ($('taxi-controller-boost').value !== run.boost) $('taxi-controller-boost').value = run.boost;
    text('taxi-boost-state', run.boostActive ? 'Boosting' : run.boost < .1 ? 'Release to fill' : 'Hold');
    data('taxi-buttons', 'boosting', String(run.boostActive)); data('taxi-buttons', 'drifting', String(vehicle.drifting));
    data('taxi-task', 'stage', 'demolition'); data('taxi-task', 'urgent', 'false'); data('taxi-task', 'arriving', 'false');
    hide($('taxi-stop-progress').parentElement, true);
    // The chain: its multiplier, its hits, the pot it would bank now, and how
    // long it waits for the next smash, draining along the top edge
    const chain = run.chain > 0;
    text('taxi-stage', chain ? `Chain ×${run.multiplier}` : 'Demolition');
    hide($('taxi-timer'), !chain); hide($('taxi-timer-fill').parentElement, !chain);
    text('taxi-timer', `${run.chain} hit${run.chain === 1 ? '' : 's'}`);
    attribute($('taxi-timer'), 'aria-label', `${run.chain} hits in the chain`);
    data('taxi-timer', 'rating', 'chain'); data('taxi-timer-fill', 'rating', 'chain');
    width('taxi-timer-fill', `${run.chainLeft * 100}%`);
    text('taxi-fare-status', chain ? money(run.pending) : '');
    const recent = run.last && run.elapsed - run.last.at < 2.5 ? run.last : null;
    text('taxi-task-title', recent ? recent.label : 'Smash everything');
    text('taxi-party', recent ? `+${money(recent.value)}` : ''); data('taxi-party', 'band', recent ? 'damage' : '');
    text('taxi-next-stop', !chain ? '' : run.nextStep ? `${run.nextStep} more for ×${run.multiplier + 1}` : 'Top multiplier');
    text('taxi-combo', '');
    const detail = chain ? '' : 'Wreck cars and street furniture · Mind the pedestrians';
    if ($('taxi-task-detail').textContent !== detail) $('taxi-task-detail').textContent = detail;
  }
  // The table as a list: place, damage, rating and day, `current` marked
  scoreList(scores, current = -1) {
    if (!scores.length) return '<li class="demolition-score-empty">No runs yet. Every smash counts.</li>';
    return scores.map((entry, index) => `<li data-current="${index === current}"><span>${index + 1}</span><strong>${money(entry.score)}</strong>`
      + `<span class="demolition-score-rank">${demolitionRank(entry.score).badge}</span><small>${day(entry.date)}</small></li>`).join('');
  }
  // The pause screen's table
  scores(run) {
    const records = run.records;
    $('demolition-scores').innerHTML = this.scoreList(records.scores);
    text('scores-summary', records.runs ? `${records.runs} run${records.runs === 1 ? '' : 's'} · ${money(records.lifetime)} of damage in all` : '');
  }
  results(run) {
    const rank = demolitionRank(run.score), summary = run.summary, records = run.records;
    $('demolition-result-time').textContent = clock(Math.round(run.elapsed));
    $('demolition-result-score').textContent = money(run.score);
    $('demolition-result-rank').dataset.license = rank.id;
    $('demolition-rank-badge').textContent = rank.badge;
    $('demolition-rank-name').textContent = rank.name;
    const improved = run.score > 0 && rank.rank > demolitionRank(run.previousBest).rank;
    $('demolition-rank-next').textContent = [summary?.best ? 'New high score!' : improved && 'Best rating yet!',
      rank.next ? `${money(rank.next.min - Math.max(0, run.score))} more for ${rank.next.name}` : 'The top rating'].filter(Boolean).join(' · ');
    const tiles = [['smashed', 'Smashed', run.smashed], ['wrecked', 'Cars', run.wrecked], ['takedowns', 'Takedowns', run.takedowns],
      ['chain', 'Chain', run.bestMultiplier > 1 ? `×${run.bestMultiplier}` : run.bestChain || '–'], ['bank', 'Best bank', run.bestBank ? compact(run.bestBank) : '–'],
      ['fines', 'Fines', run.people]];
    $('demolition-result-stats').innerHTML = tiles.map(([id, label, value]) =>
      `<li data-stat="${id}" data-bad="${id === 'fines' && run.people > 0}"><strong>${value}</strong><span>${label}</span></li>`).join('');
    const placement = summary?.placement ?? -1;
    $('demolition-result-scores').innerHTML = `<div class="taxi-result-heading"><span>High scores</span><span>${placement >= 0 ? `#${placement + 1} of ${records.scores.length}` : `Best ${money(records.best)}`}</span></div>`
      + `<ol class="demolition-score-list">${this.scoreList(records.scores, placement)}</ol>`;
    $('demolition-result-best').textContent = `${records.runs} run${records.runs === 1 ? '' : 's'}`;
    $('demolition-result-total').textContent = `${money(records.lifetime)} of damage in all`;
    $('demolition-results').hidden = false;
  }
  dispose() {
    this.labels.dispose();
  }
}
