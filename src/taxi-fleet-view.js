import { CARS } from './cars.js';
import { carArt } from './car-art.js';
import { TAXI_FLEET } from './taxi-fleet.js';
import { LIVERIES, DRIVER_RANKS, rankIndex } from './taxi-career.js';

export const fleetMoney = amount => `$${amount.toLocaleString('en-US')}`;

export function setupTaxiFleet(fleet, { running, onChange, career = null, onLivery = null }) {
  const dialog = document.querySelector('#taxi-fleet-dialog');
  const cards = dialog.querySelector('.taxi-fleet-cards');
  const liveries = dialog.querySelector('#fleet-liveries');
  function render() {
    dialog.querySelector('#fleet-balance').textContent = fleetMoney(fleet.balance);
    dialog.querySelector('#fleet-note').textContent = running() ? 'Cab changes apply to your next run.' : 'Fares and goal bonuses bank as you drive.';
    dialog.querySelector('#fleet-save').hidden = fleet.saved;
    const paint = fleet.liveryColor;
    cards.innerHTML = TAXI_FLEET.map(({ id, price, title, description }, index) => {
      const entry = CARS[id], owned = fleet.owned.has(id), selected = fleet.selected === id;
      const short = Math.max(0, price - fleet.balance);
      const action = selected ? 'Selected for next run' : owned ? 'Select cab' : `Buy & select · ${fleetMoney(price)}`;
      const stats = [['Top speed', `${Math.round(entry.stats.topSpeed * 2.23694)} mph`, entry.stats.topSpeed / 55],
        ['Acceleration', `${entry.stats.acceleration} m/s²`, entry.stats.acceleration / 42],
        ['Handling', `${entry.stats.grip.toFixed(2)}×`, entry.stats.grip / 1.8],
        ['Braking', `${entry.stats.braking} m/s²`, entry.stats.braking / 38]];
      return `<article class="taxi-fleet-card" data-selected="${selected}" style="--car-paint:${paint ?? entry.paint}">
        <div class="fleet-card-top"><span>0${index + 1} / ${title}</span><span>${selected ? 'SELECTED' : owned ? 'OWNED' : fleetMoney(price)}</span></div>
        ${carArt(id)}<h3>${entry.name}</h3><p class="fleet-description">${description}</p>
        <dl class="fleet-stats">${stats.map(([label, value, level]) => `<div><dt>${label}</dt><dd>${value}</dd><span aria-hidden="true"><i style="width:${level * 100}%"></i></span></div>`).join('')}</dl>
        <p class="fleet-progress">${owned ? index === 0 ? 'Included with your fleet' : 'Yours for every taxi run' : short ? `${fleetMoney(short)} to go` : 'Ready for an upgrade'}</p>
        ${!owned ? `<progress max="${price}" value="${Math.min(price, fleet.balance)}" aria-label="Savings toward ${entry.name}"></progress>` : ''}
        <button type="button" data-fleet-car="${id}" aria-label="${entry.name}: ${action}" aria-pressed="${selected}" ${!owned && short ? 'disabled' : ''}>${action}</button>
      </article>`;
    }).join('');
    renderCareer();
    document.querySelector('#taxi-result-bank').textContent = `Fleet ${fleetMoney(fleet.balance)}`;
  }
  // Liveries come with rank, so the row doubles as the career's progress bar:
  // every locked swatch names the rank that opens it.
  function renderCareer() {
    if (!liveries || !career) return;
    const rank = career.rank;
    liveries.innerHTML = LIVERIES.map(livery => {
      const unlocked = career.unlocked(livery.id), selected = fleet.livery === livery.id;
      const label = unlocked ? livery.name : `${livery.name}: unlocks at ${DRIVER_RANKS[rankIndex(livery.rank)].name} rank`;
      return `<button type="button" class="paint-swatch fleet-livery" role="radio" aria-checked="${selected}" data-livery="${livery.id}" data-locked="${!unlocked}"
        style="--swatch:${livery.color ?? CARS.taxi.paint}" aria-label="${label}" title="${label}" ${unlocked ? '' : 'disabled'}><span class="paint-chip" aria-hidden="true"></span></button>`;
    }).join('');
    const next = LIVERIES.find(livery => !career.unlocked(livery.id));
    dialog.querySelector('#fleet-livery-name').textContent = [`${LIVERIES.find(livery => livery.id === fleet.livery)?.name ?? LIVERIES[0].name} livery`,
      next ? `${next.name} at ${DRIVER_RANKS[rankIndex(next.rank)].name}` : 'Every livery unlocked'].join(' · ');
    dialog.querySelector('#fleet-career').textContent = [rank.name, `${fleetMoney(career.earnings)} career`, `${career.fares} fare${career.fares === 1 ? '' : 's'}`,
      rank.next ? `${fleetMoney(rank.next.earnings - career.earnings)} to ${rank.next.name}` : 'Top rank'].join(' · ');
  }
  cards.addEventListener('click', event => {
    const button = event.target.closest('[data-fleet-car]');
    if (!button) return;
    const id = button.dataset.fleetCar;
    const owned = fleet.owned.has(id);
    if (!(owned ? fleet.select(id) : fleet.buy(id))) return;
    render();
    dialog.querySelector('#fleet-feedback').textContent = `${CARS[id].name} ${owned ? 'selected' : 'purchased'} for your next run.`;
    cards.querySelector(`[data-fleet-car="${id}"]`).focus();
    onChange();
  });
  liveries?.addEventListener('click', event => {
    const button = event.target.closest('[data-livery]');
    if (!button || !fleet.setLivery(button.dataset.livery, career)) return;
    render();
    dialog.querySelector('#fleet-feedback').textContent = `${LIVERIES.find(livery => livery.id === fleet.livery).name} livery selected.`;
    liveries.querySelector(`[data-livery="${fleet.livery}"]`).focus();
    onLivery?.(fleet.liveryColor); onChange();
  });
  render();
  return { render };
}
