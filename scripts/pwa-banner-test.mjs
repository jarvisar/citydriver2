import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const script = await readFile(new URL('../public/pwa-install.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/pwa-install.css', import.meta.url), 'utf8');
const browser = await chromium.launch(process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH }
  : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {});
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 851 } });
  await page.route('https://citydriver.test/', route => route.fulfill({ contentType: 'text/html', body:
    '<section id="welcome"><button id="start">Let’s drive</button></section><div id="pause-overlay" hidden><div class="pause-settings"></div></div>' }));
  async function setup() {
    await page.goto('https://citydriver.test/');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    assert.equal(await page.locator('#welcome button').count(), 1, 'The menu has one main action');
    assert.equal(await page.locator('#pwa-install-invitation').count(), 0, 'No automatic install invitation');
    assert.equal(await page.locator('.pwa-install-button').isVisible(), false, 'Installation stays in pause settings');
    await page.evaluate(() => { document.querySelector('#pause-overlay').hidden = false; });
  }
  await setup();
  const button = page.getByRole('button', { name: 'Install Citydriver' });
  const help = page.locator('#pwa-install-help');
  await button.click();
  assert.match(await help.textContent(), /browser menu/);
  assert.equal(await button.getAttribute('aria-expanded'), 'true');
  await button.focus();
  await page.keyboard.press('Space');
  assert.equal(await help.isVisible(), false, 'Keyboard toggles the instructions');
  assert.equal(await button.getAttribute('aria-expanded'), 'false');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.promptCalls = (window.promptCalls || 0) + 1; };
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await button.click();
  assert.equal(await page.evaluate(() => window.promptCalls), 1, 'Native prompt is used when available');
  await button.click();
  assert.equal(await help.isVisible(), true, 'A consumed prompt falls back to instructions');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { throw new Error('Unavailable'); };
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await button.click();
  assert.equal(await help.isVisible(), true, 'A failed prompt falls back to instructions');
  assert.equal(await button.isEnabled(), true);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  assert.equal(await button.isVisible(), false, 'Installed apps hide the option');

  await page.goto('https://citydriver.test/');
  await page.evaluate(() => Object.defineProperty(navigator, 'userAgent', { value: 'iPhone' }));
  await page.addScriptTag({ content: script });
  await page.evaluate(() => { document.querySelector('#pause-overlay').hidden = false; });
  await button.click();
  assert.match(await help.textContent(), /Safari, tap Share/);
  for (const mode of ['standalone', 'fullscreen']) {
    await page.goto('https://citydriver.test/');
    await page.evaluate(mode => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => query.includes(`(display-mode: ${mode})`) ? { matches: true } : original(query);
    }, mode);
    await page.addScriptTag({ content: script });
    assert.equal(await page.locator('.pwa-install').count(), 0, `No installation UI in ${mode} mode`);
  }
  console.log('PASS install settings: single menu action, no banner, native prompt, fallback, keyboard, iOS and installed states');
} finally { await browser.close(); }
