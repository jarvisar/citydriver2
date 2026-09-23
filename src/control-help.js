const storageKey = 'citydriver-control-help-dismissed';
let dismissed = false;
let drivingHelpStarted = false;
try { dismissed = localStorage.getItem(storageKey) === 'true'; } catch { /* Storage is optional. */ }

export const controlHelpDismissed = () => dismissed;

export function updateControlHelp(speed) {
  if (dismissed || drivingHelpStarted || Math.abs(speed) < .5) return;
  drivingHelpStarted = true;
  // Use elapsed time so the hint lasts five seconds even at low frame rates.
  setTimeout(() => { document.body.dataset.drivingHelpExpired = 'true'; }, 5000);
}

export function setupControlHelp() {
  document.body.dataset.controlHelpDismissed = String(dismissed);
  for (const help of document.querySelectorAll('.touch-hint, .controller-hint, #stick-help, .controls > span:first-child')) {
    help.setAttribute('data-control-help', '');
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'dismiss-control-help';
    close.setAttribute('aria-label', 'Dismiss control help');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    // Keyboard activation should dismiss help without triggering driving shortcuts.
    for (const type of ['keydown', 'keyup']) close.addEventListener(type, event => event.stopPropagation());
    close.addEventListener('click', event => {
      event.stopPropagation(); dismissed = true;
      document.body.dataset.controlHelpDismissed = 'true';
      try { localStorage.setItem(storageKey, 'true'); } catch { /* Still dismiss for this visit. */ }
    });
    help.append(close);
  }
}
