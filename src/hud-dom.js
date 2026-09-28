// Writes to the HUD, shared by the taxi and demolition views (a demolition run
// writes into the taxi's panels) and the street map. The HUD refreshes ten
// times a second, mostly with values it already shows, and rewriting an
// unchanged text, attribute or style still costs a style recalculation under
// its :has() rules, so each of these compares first.
export const $ = id => document.getElementById(id);
export const text = (id, value) => { const element = $(id), next = String(value); if (element.textContent !== next) element.textContent = next; };
export const hide = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };
export const data = (id, key, value) => { const element = $(id), next = String(value); if (element.dataset[key] !== next) element.dataset[key] = next; };
export const attribute = (element, name, value) => { const next = String(value); if (element.getAttribute(name) !== next) element.setAttribute(name, next); };
export const width = (id, value) => { const style = $(id).style; if (style.width !== value) style.width = value; };
export const compactCash = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
// Whole seconds as m:ss
export const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
