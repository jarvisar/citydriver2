// The manifest requests fullscreen at launch. If the browser falls back to an
// app window, the Fullscreen API needs a user gesture before it can hide chrome.
// Only while `wanted()` (the Auto-fullscreen switch).
export function setupPwaFullscreen(wanted = () => true) {
  if (window.citydriverDesktop) return;
  const matches = mode => window.matchMedia(`(display-mode: ${mode})`).matches;
  const installed = matches('standalone') || matches('minimal-ui') || navigator.standalone === true;
  if (!installed || matches('fullscreen')) return;
  const request = document.documentElement.requestFullscreen ?? document.documentElement.webkitRequestFullscreen;
  if (!request) return;

  const remove = () => {
    window.removeEventListener('pointerup', enter, true);
    window.removeEventListener('keydown', enter, true);
  };
  function enter(event) {
    if (!event.isTrusted || (event.type === 'keydown' && (event.repeat || event.ctrlKey || event.metaKey || event.altKey || ['Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)))) return;
    remove();
    // Let an explicit fullscreen control handle the request itself.
    if (event.code === 'KeyF' || event.key === 'F11' || event.target.closest?.('#auto-fullscreen, .vr-entry')) return;
    if (!wanted() || document.fullscreenElement || document.webkitFullscreenElement || matches('fullscreen')) return;
    try {
      Promise.resolve(request.call(document.documentElement, { navigationUI: 'hide' })).catch(() => {});
    } catch { /* Some platforms offer no programmatic fullscreen; keep playing. */ }
  }
  window.addEventListener('pointerup', enter, true);
  window.addEventListener('keydown', enter, true);
}
