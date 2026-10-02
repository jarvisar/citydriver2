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
// Hint flags must stay writable even when a save holds valid JSON of the wrong kind.
export function readHintFlags(key, storage) {
  try {
    const data = JSON.parse(storage?.getItem(key) ?? 'null');
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* Optional storage. */ }
  return {};
}
// Hints for new players, `texts` by id: each is shown once, for `seconds`,
// and remembered in `storage` under `key`
export class OnceHints {
  constructor(texts, key, storage, seconds = 7) {
    this.texts = texts; this.key = key; this.storage = storage; this.seconds = seconds; this.seen = null; this.showing = null; this.until = 0;
  }
  // The hint for `id` if it has not been shown before (or is showing now), else ''
  get(id) {
    if (!this.seen) {
      this.seen = new Set();
      try { for (const seen of JSON.parse(this.storage?.getItem(this.key) ?? '[]')) this.seen.add(seen); } catch { /* Optional storage. */ }
    }
    const now = performance.now() / 1000;
    if (this.showing && now < this.until) return id === this.showing ? this.texts[id] : '';
    this.showing = null;
    if (!id || !this.texts[id] || this.seen.has(id)) return '';
    this.seen.add(id); this.showing = id; this.until = now + this.seconds;
    try { this.storage?.setItem(this.key, JSON.stringify([...this.seen])); } catch { /* Optional storage. */ }
    return this.texts[id];
  }
}
