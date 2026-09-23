// This script is injected into production builds only.
if ('serviceWorker' in navigator && window.isSecureContext) {
  const workerUrl = new URL('sw.js', document.currentScript.src);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' })
      .catch(error => console.warn('Offline play is unavailable:', error));
  }, { once: true });
}
