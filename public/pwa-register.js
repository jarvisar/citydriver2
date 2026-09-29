// This script is injected into production builds only.
if ('serviceWorker' in navigator && window.isSecureContext) {
  const workerUrl = new URL('sw.js', document.currentScript.src);
  const CHECK_EVERY = 10 * 60 * 1000;
  // A first visit gets a controller too, which is not an update.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  let shown = false;

  // Only on the title and pause screens, never over a drive. Both are in the
  // menus the controller can reach.
  function showUpdate(registration) {
    if (shown) return;
    shown = true;
    for (const parent of document.querySelectorAll('#welcome, #pause-overlay .pause-header')) {
      const notice = document.createElement('div');
      notice.className = 'update-notice';
      notice.innerHTML = '<span role="status">Update available</span><button type="button">Reload</button>';
      for (const type of ['keydown', 'keyup']) notice.addEventListener(type, event => event.stopPropagation());
      notice.querySelector('button').addEventListener('click', () => {
        reloading = true;
        for (const button of document.querySelectorAll('.update-notice button')) button.disabled = true;
        // With no waiting worker another tab already took the update.
        if (registration.waiting) registration.waiting.postMessage('activate-update');
        else location.reload();
      });
      const hint = parent.querySelector(':scope > .controller-hint');
      parent.insertBefore(notice, hint);
    }
  }

  window.addEventListener('load', async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' });
    } catch (error) {
      console.warn('Offline play is unavailable:', error);
      return;
    }
    const ready = () => {
      if (registration.waiting && navigator.serviceWorker.controller) showUpdate(registration);
    };
    ready();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') ready(); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) location.reload();
      else if (hadController) showUpdate(registration);
    });

    // The browser only looks for a new sw.js on navigation, so keep asking
    // while the tab stays open.
    let checked = Date.now();
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - checked < 60_000) return;
      checked = Date.now();
      registration.update().catch(() => {});
    };
    setInterval(check, CHECK_EVERY);
    document.addEventListener('visibilitychange', check);
  }, { once: true });
}
