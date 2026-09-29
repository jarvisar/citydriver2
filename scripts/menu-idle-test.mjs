import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const out = '.scratch/menu-idle';
await mkdir(out, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null, hmr: false }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
    args: ['--ignore-gpu-blocklist'],
  });
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile });
    page.setDefaultTimeout(90000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic', ambientOcclusion: false }));
      localStorage.setItem('citydriver.camera', JSON.stringify({ profiles: { driving: { view: 5, zoom: 2.5 } } }));
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=4817&ao=0`);
    await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'));
    // Advance wall time without rendering thousands of intervening city frames.
    await page.evaluate(() => {
      const now = performance.now.bind(performance);
      window.idleTestElapsed = 0;
      performance.now = () => now() + window.idleTestElapsed;
    });
    const advance = async ms => {
      await page.evaluate(ms => { window.idleTestElapsed += ms; }, ms);
      await page.waitForTimeout(100);
    };
    const state = () => page.evaluate(() => ({
      idle: document.querySelector('#app').classList.contains('menu-idle'),
      opacity: Number(getComputedStyle(document.querySelector('#welcome')).opacity),
      inert: document.querySelector('#welcome').inert,
      fade: Number(document.querySelector('#menu-view-fade').style.opacity),
      view: window.__citydriver.rendering.viewIndex,
      started: window.__citydriver.started,
      saved: localStorage.getItem('citydriver.camera'),
    }));
    await page.focus('#start');
    const initial = await state();
    await advance(59_000);
    assert.equal((await state()).idle, false, 'menu stays visible before 60 seconds');
    await page.mouse.move(10, 10);
    await advance(59_000);
    assert.equal((await state()).idle, false, 'movement restarts the whole idle delay');
    await advance(1_100);
    assert.equal((await state()).idle, true);
    await page.waitForTimeout(1400);
    assert.equal((await state()).opacity, 0);
    assert.equal((await state()).inert, true);
    await page.screenshot({ path: `${out}/${mobile ? 'phone' : 'desktop'}-scenic.png` });
    await advance(25_000);
    await advance(200);
    assert.ok((await state()).fade > 0, 'camera fades before changing');
    await advance(500);
    assert.equal((await state()).view, 4, 'default third-person view');
    await advance(500);
    assert.equal((await state()).fade, 0);
    assert.equal((await state()).saved, initial.saved);
    await page.screenshot({ path: `${out}/${mobile ? 'phone' : 'desktop'}-chase.png` });
    await advance(25_000); await advance(500); await advance(500);
    assert.equal((await state()).view, initial.view, 'returns to the original title view');

    if (mobile) await page.touchscreen.tap(200, 400);
    else await page.keyboard.press('Enter');
    assert.equal((await state()).idle, false);
    assert.equal((await state()).started, false, 'first press only wakes the menu');
    await page.waitForTimeout(300);
    assert.equal((await state()).opacity, 1);
    assert.equal((await state()).inert, false);

    // Waking halfway through a transition must cancel its delayed camera change.
    await advance(60_100); await advance(25_000); await advance(100);
    await page.mouse.wheel(0, 1);
    await advance(1000);
    assert.equal((await state()).idle, false);
    assert.equal((await state()).view, initial.view);
    assert.equal((await state()).fade, 0);

    await page.evaluate(() => {
      window.idleTestPad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      navigator.getGamepads = () => [window.idleTestPad];
    });
    await page.waitForTimeout(150);
    await advance(60_100);
    assert.equal((await state()).idle, true, 'resting controller does not prevent idle');
    await page.evaluate(() => { window.idleTestPad.buttons[0] = { pressed: true, value: 1 }; });
    await page.waitForTimeout(150);
    assert.equal((await state()).idle, false);
    assert.equal((await state()).started, false, 'controller confirm wakes without starting');
    await page.evaluate(() => { window.idleTestPad.buttons[0] = { pressed: false, value: 0 }; });
    await page.waitForTimeout(150);

    await page.keyboard.press('KeyG');
    await advance(90_000);
    assert.equal((await state()).idle, false, 'garage stays visible');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.click('#free-drive');
    assert.equal((await state()).view, 5, 'starting restores the saved driving view');
    await advance(90_000);
    assert.equal((await state()).idle, false, 'driving never idles');
    assert.equal((await state()).view, 5);
    await page.keyboard.press('Escape');
    await advance(90_000);
    assert.equal((await state()).idle, false, 'pause menu stays visible');
    assert.equal((await state()).saved, initial.saved);
    assert.deepEqual(errors, []);
    console.log(`${mobile ? 'Phone' : 'Desktop'}: idle timing, fades, both cameras, wake input, controller, garage and driving passed.`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); }
