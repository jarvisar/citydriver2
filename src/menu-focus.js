// Controller navigation for every menu: the title screen, the pause screen, the
// results card and the choosers. Anything focusable that is laid out and
// enabled is reachable, so new controls need no list to join.
const FOCUSABLE = 'button, select, input:not([type="hidden"]), a[href], [tabindex]:not([tabindex="-1"])';
const DIRECTIONS = { menuUp: [0, -1], menuDown: [0, 1], menuPrevious: [-1, 0], menuNext: [1, 0] };

export function menuTargets(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(element => !element.disabled
    && !element.closest('[inert]') && element.getClientRects().length
    && element.checkVisibility?.({ visibilityProperty: true }) !== false);
}

// Left and right change a slider or a list in place, since each fills its own
// row. The custom paint well sits in a row of swatches, so left and right pass
// it by and A turns its hue instead: no native picker is ever needed.
function adjust(element, step, { colour = false } = {}) {
  if (element.matches('input[type="range"]')) {
    if (element.matches('[data-audio-channel]')) element.value = Math.max(0, Math.min(100, Number(element.value) + step * 5));
    else if (step > 0) element.stepUp(); else element.stepDown();
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (element.matches('select')) {
    const count = element.options.length;
    element.selectedIndex = (element.selectedIndex + step + count) % count;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (colour && element.matches('input[type="color"]')) {
    element.value = rotateHue(element.value, step * 20);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

export function rotateHue(hex, degrees) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  // A grey has no hue to turn, so it starts from red at a usable saturation.
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : .6;
  let h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60 + degrees) % 360 + 360) % 360;
  const light = d ? l : Math.min(.7, Math.max(.3, l));
  const c = (1 - Math.abs(2 * light - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = light - c / 2;
  const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[rr, gg, bb].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// The nearest control in the pressed direction. Up and down favour controls
// that share a column, so a right-aligned list still sits in the column above
// it; left and right only move along a row.
function nearest(current, targets, [dx, dy], root) {
  const a = current.getBoundingClientRect();
  let best = null, bestCost = Infinity;
  for (const target of targets) {
    if (target === current) continue;
    const b = target.getBoundingClientRect();
    const along = dx ? (b.left + b.width / 2 - (a.left + a.width / 2)) * dx : (b.top + b.height / 2 - (a.top + a.height / 2)) * dy;
    if (along < 4) continue;
    const gap = Math.max(0, dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : (dy > 0 ? b.top - a.bottom : a.top - b.bottom));
    const [lowA, highA, lowB, highB] = dx ? [a.top, a.bottom, b.top, b.bottom] : [a.left, a.right, b.left, b.right];
    const across = Math.max(0, lowB - highA, lowA - highB);
    // Left and right stay on their row; off its end they step in reading order.
    if (dx && across > 0) continue;
    const offset = Math.abs((lowB + highB) / 2 - (lowA + highA) / 2);
    // A pinned header only looks close because the list scrolled beneath it,
    // so it comes after everything that scrolls.
    const cost = gap + across * 3 + offset * .05 + (pinned(target, root) && !pinned(current, root) ? 1e5 : 0);
    if (cost < bestCost) { bestCost = cost; best = target; }
  }
  return best;
}

function pinned(element, root) {
  for (let node = element; node && node !== root; node = node.parentElement) {
    if (/sticky|fixed/.test(getComputedStyle(node).position)) return true;
  }
  return false;
}

export function moveMenuFocus(root, name) {
  const targets = menuTargets(root);
  if (!targets.length) return;
  const index = targets.indexOf(document.activeElement);
  if (index < 0) { targets[0].focus(); return; }
  const current = targets[index], direction = DIRECTIONS[name];
  if (!direction) return;
  if (direction[0] && adjust(current, direction[0])) return;
  const target = nearest(current, targets, direction, root);
  // Past the edge, carry on in reading order and wrap round the ends.
  const step = direction[0] + direction[1];
  (target ?? targets[(index + step + targets.length) % targets.length]).focus();
}

// A presses the focused control. Lists and the paint well have no useful
// native popup on a controller, so A steps them forward instead.
export function confirmMenuFocus(root, fallback) {
  const current = document.activeElement;
  if (!root.contains(current) || !menuTargets(root).includes(current)) { (fallback ?? menuTargets(root)[0])?.focus(); return; }
  if (current.matches('select, input[type="color"]')) adjust(current, 1, { colour: true });
  else if (!current.matches('input[type="range"]')) current.click();
}

// Scroll whichever part of the menu actually scrolls.
export function scrollMenu(root, amount) {
  if (!amount) return;
  const start = root.contains(document.activeElement) ? document.activeElement : root;
  for (let element = start; element; element = element === root ? null : element.parentElement) {
    if (element.scrollHeight > element.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(element).overflowY)) { element.scrollBy(0, amount); return; }
  }
  root.scrollBy(0, amount);
}
