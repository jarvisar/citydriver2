(() => {
  const appDisplay = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)');
  let installed = false;
  const isInstalled = () => installed || appDisplay.matches || navigator.standalone === true;
  const parent = document.querySelector('#pause-overlay .pause-settings');
  if (isInstalled() || !parent) return;

  let installPrompt;
  const container = document.createElement('div');
  container.className = 'pwa-install';
  container.innerHTML = '<button type="button" class="pwa-install-button" aria-controls="pwa-install-help" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Install Citydriver</span></button><p id="pwa-install-help" class="pwa-install-help" role="status" hidden></p>';
  parent.append(container);
  const button = container.querySelector('button');
  const help = container.querySelector('p');
  for (const type of ['keydown', 'keyup']) container.addEventListener(type, event => event.stopPropagation());

  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function showHelp() {
    help.textContent = ios
      ? 'In Safari, tap Share, then Add to Home Screen.'
      : 'Open your browser menu and choose Install app or Add to Home screen.';
    help.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  }
  button.addEventListener('click', async () => {
    if (!installPrompt) {
      if (help.hidden) showHelp();
      else { help.hidden = true; button.setAttribute('aria-expanded', 'false'); }
      return;
    }
    const prompt = installPrompt;
    installPrompt = undefined;
    button.disabled = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch { showHelp(); }
    finally { button.disabled = false; }
  });
  window.addEventListener('beforeinstallprompt', event => {
    if (isInstalled()) return;
    event.preventDefault();
    installPrompt = event;
    help.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });
  function hideInstalledControls() {
    installed = true;
    installPrompt = undefined;
    container.hidden = true;
  }
  window.addEventListener('appinstalled', hideInstalledControls);
  appDisplay.addEventListener('change', () => { if (isInstalled()) hideInstalledControls(); });
})();
