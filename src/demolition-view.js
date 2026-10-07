import { demolitionRank, money, contractProgress as progress, CONTRACT_SECONDS } from './demolition-run.js';
import { demolitionResultModel } from './result-model.js';
import { demolitionHudModel } from './run-hud-model.js';
import { renderRunHud } from './run-hud-dom.js';
import { FloatingLabels } from './floating-labels.js';
import { $, text, compactCash, clock, OnceHints } from './hud-dom.js';

const compact = value => value >= 1000 ? compactCash.format(value) : money(value);
const day = date => { const parsed = new Date(`${date}T12:00:00`); return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
// Hints for new players, each shown once in the task card's last line
export const HINTS = {
  chain: 'Smash things one after another to build a chain',
  bank: 'Stop smashing for a moment to bank the chain',
  time: 'Takedowns and contracts add time',
};
const HINTS_KEY = 'citydriver-demolition-hints';

// What each blow's number looks like as it floats up over the truck: the
// run's orange for damage, hotter for a car written off, red for a fine and
// green for time won
const LABEL_STYLES = {
  smash: { colour: '#ffc07a' }, dent: { colour: '#ffc07a' },
  wreck: { colour: '#ff8a2a', caption: 'WRECKED' }, penalty: { colour: '#ff6d5e', caption: 'PEDESTRIAN' },
  bonus: { colour: '#8ff0b0', caption: 'TAKEDOWN' }, contract: { colour: '#8ff0b0', caption: 'CONTRACT' },
};
export class DemolitionView {
  constructor(scene, storage = null) {
    this.labels = new FloatingLabels(scene, 'demolition-labels');
    this.storage = storage; this.shown = 0;
  }
  // A stand-in for the labels' program, compiled with the city
  warmupObjects() { return this.labels.warmupObjects(); }
  reset() { this.labels.reset(); this.shown = 0; }
  // A blow's price (or a fine, or time won) rising over the truck. False with popups off.
  pop(event) {
    const style = LABEL_STYLES[event.kind] ?? LABEL_STYLES.smash;
    const amount = event.kind === 'penalty' ? event.fine ? `−$${event.fine.toLocaleString('en-US')}` : 'CHAIN LOST'
      : event.kind === 'bonus' || event.kind === 'contract' ? event.seconds ? `+${event.seconds}s` : 'DONE' : `$${event.value.toLocaleString('en-US')}`;
    // (a blow in a chain says what it was multiplied by)
    const times = ['smash', 'dent', 'wreck'].includes(event.kind) && event.multiplier > 1 ? `×${event.multiplier}` : '';
    const caption = [style.caption, times].filter(Boolean).join(' ');
    return this.labels.pop({ amount, caption, colour: style.colour });
  }
  // Over the player's car; `camera`, if given, keeps near labels small
  render(vehicle, time, camera = null) { this.labels.render(time, camera, vehicle.car, vehicle.spec?.height); }
  // The driving HUD, in the taxi's panels: the clock and the banked damage
  // top left, the chain where the fare would be, the boost as a taxi has it
  buildHud(run, vehicle) {
    this.hudModel = demolitionHudModel(run, vehicle, { shownCash: this.shown, hint: id => this.hint(id) });
    this.shown = this.hudModel.shownCash;
    return this.hudModel;
  }
  hud(run, vehicle) {
    const model = this.buildHud(run, vehicle);
    renderRunHud(model);
    return model;
  }
  hint(id) {
    this.hints ??= new OnceHints(HINTS, HINTS_KEY, this.storage);
    return this.hints.get(id);
  }
  // The table as a list: place, damage, rating and day, `current` marked
  scoreList(scores, current = -1) {
    if (!scores.length) return '<li class="demolition-score-empty">No runs yet. Every smash counts.</li>';
    return scores.map((entry, index) => `<li data-current="${index === current}"><span>${index + 1}</span><strong>${money(entry.score)}</strong>`
      + `<span class="demolition-score-rank">${demolitionRank(entry.score).badge}</span><small>${day(entry.date)}</small></li>`).join('');
  }
  // The pause screen's contracts, in the taxi goals' list
  contracts(run) {
    const contracts = run.status === 'idle' ? [] : run.contracts ?? [];
    $('shift-goals').innerHTML = contracts.map(contract => `<li data-done="${contract.done}"><span class="goal-check" aria-hidden="true">${contract.done ? '✓' : '○'}</span>`
      + `<span class="goal-copy"><strong>${contract.text}</strong><small>${contract.done ? 'Done' : `${progress(contract)} · +${CONTRACT_SECONDS}s`}</small></span></li>`).join('');
    text('goals-summary', contracts.length ? `${run.contractsDone} of ${contracts.length} · Each adds ${CONTRACT_SECONDS} seconds` : '');
  }
  // The pause screen's table
  scores(run) {
    const records = run.records;
    $('demolition-scores').innerHTML = this.scoreList(records.scores);
    text('scores-summary', records.runs ? `${records.runs} run${records.runs === 1 ? '' : 's'} · ${money(records.lifetime)} of damage in all` : '');
  }
  // (`saving`: what the balance is going toward, see savingFor)
  results(run, saving = '') {
    const model = demolitionResultModel(run), { rank } = model, summary = run.summary, records = run.records;
    $('demolition-result-time').textContent = clock(Math.round(run.elapsed));
    $('demolition-result-score').textContent = model.cash;
    $('demolition-result-rank').dataset.license = rank.id;
    $('demolition-rank-badge').textContent = rank.badge;
    $('demolition-rank-name').textContent = model.name;
    $('demolition-rank-next').textContent = model.next;
    // (contracts as a tile: listed, they made the card taller than a
    // laptop's screen once the high score table was full)
    const tiles = [['smashed', 'Smashed', run.smashed + run.wrecked], ['takedowns', 'Takedowns', run.takedowns],
      ['chain', 'Chain', run.bestMultiplier > 1 ? `×${run.bestMultiplier}` : run.bestChain || '–'], ['bank', 'Best bank', run.bestBank ? compact(run.bestBank) : '–'],
      ['contracts', 'Contracts', `${run.contractsDone}/${run.contracts?.length ?? 0}`], ['fines', 'Fines', run.fineCount]];
    $('demolition-result-stats').innerHTML = tiles.map(([id, label, value]) =>
      `<li data-stat="${id}" data-bad="${id === 'fines' && run.fineCount > 0}"><strong>${value}</strong><span>${label}</span></li>`).join('');
    const placement = summary?.placement ?? -1;
    $('demolition-result-scores').innerHTML = `<div class="taxi-result-heading"><span>High scores</span><span>${placement >= 0 ? `#${placement + 1} of ${records.scores.length}` : `Best ${money(records.best)}`}</span></div>`
      + `<ol class="demolition-score-list">${this.scoreList(records.scores, placement)}</ol>`;
    $('demolition-result-best').textContent = `${records.runs} run${records.runs === 1 ? '' : 's'} · ${compact(records.lifetime)} of damage in all`;
    // (the contractor's cut, paid into the fleet balance as each chain banked)
    $('demolition-result-total').textContent = [run.paid && `+${money(run.paid)} to your balance`, saving].filter(Boolean).join(' · ');
    $('demolition-results').hidden = false;
  }
  dispose() {
    this.labels.dispose();
  }
}
