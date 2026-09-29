import { carArt } from './car-art.js';
import { fleetMoney } from './chooser-model.js';

export { fleetMoney } from './chooser-model.js';

export function setupTaxiFleet(menu) {
  const dialog = document.querySelector('#taxi-fleet-dialog');
  const cards = dialog.querySelector('.taxi-fleet-cards');
  const liveries = dialog.querySelector('#fleet-liveries');
  function render() {
    const model = menu.model();
    dialog.querySelector('#fleet-balance').textContent = model.balance;
    dialog.querySelector('#fleet-note').textContent = model.note;
    dialog.querySelector('#fleet-save').hidden = model.saved;
    cards.innerHTML = model.cabs.map(({ id, price, title, description, index, label, owned, current, action, accessibilityLabel, paint, disabled, savings, progress, stats }) =>
      `<article class="taxi-fleet-card" data-selected="${current}" style="--car-paint:${paint}">
        <div class="fleet-card-top"><span>0${index + 1} / ${title}</span><span>${current ? 'SELECTED' : owned ? 'OWNED' : fleetMoney(price)}</span></div>
        ${carArt(id)}<h3>${label}</h3><p class="fleet-description">${description}</p>
        <dl class="fleet-stats">${stats.map(([label, value, level]) => `<div><dt>${label}</dt><dd>${value}</dd><span aria-hidden="true"><i style="width:${Math.min(1, level) * 100}%"></i></span></div>`).join('')}</dl>
        <p class="fleet-progress">${progress}</p>
        ${!owned ? `<progress max="${price}" value="${savings}" aria-label="Savings toward ${label}"></progress>` : ''}
        <button type="button" data-fleet-car="${id}" aria-label="${accessibilityLabel}" aria-pressed="${current}" ${disabled ? 'disabled' : ''}>${action}</button>
      </article>`).join('');
    if (liveries && model.liveries.length) {
      liveries.innerHTML = model.liveries.map(({ id, current, disabled, swatch, accessibilityLabel }) =>
        `<button type="button" class="paint-swatch fleet-livery" role="radio" aria-checked="${current}" data-livery="${id}" data-locked="${disabled}"
          style="--swatch:${swatch}" aria-label="${accessibilityLabel}" title="${accessibilityLabel}" ${disabled ? 'disabled' : ''}><span class="paint-chip" aria-hidden="true"></span></button>`).join('');
      dialog.querySelector('#fleet-livery-name').textContent = model.liveryName;
      dialog.querySelector('#fleet-career').textContent = model.career;
    }
    document.querySelector('#taxi-result-bank').textContent = `Fleet bank ${model.balance}`;
  }
  menu.subscribe(feedback => { render(); dialog.querySelector('#fleet-feedback').textContent = feedback; });
  cards.addEventListener('click', event => {
    const button = event.target.closest('[data-fleet-car]');
    if (!button || !menu.chooseCab(button.dataset.fleetCar)) return;
    cards.querySelector(`[data-fleet-car="${button.dataset.fleetCar}"]`).focus();
  });
  liveries?.addEventListener('click', event => {
    const button = event.target.closest('[data-livery]');
    if (!button || !menu.chooseLivery(button.dataset.livery)) return;
    liveries.querySelector(`[data-livery="${button.dataset.livery}"]`).focus();
  });
  render();
  return { render };
}
