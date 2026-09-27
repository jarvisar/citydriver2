import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// A taxi run in the chase view: seed 4817's opening street in the first golden
// hour, a moment after pulling away (the arrow key on desktop, the touch stick on a phone)
const server = await createServer({ server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
  args: ['--enable-webgl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
});
try {
  await mkdir(new URL('../public/screenshots/', import.meta.url), { recursive: true });
  for (const [name, width, height, mobile] of [['desktop', 1280, 800, false], ['mobile', 540, 960, true]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    // (no first-visit hints over the view)
    await page.addInitScript(() => { try { localStorage.setItem('citydriver-mouse-look', 'known'); localStorage.setItem('citydriver-control-help-dismissed', 'true'); } catch { /* Storage is optional. */ } });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=4817`);
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    await page.locator('#loading').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    await page.click('#start');
    await page.waitForTimeout(1500);
    const shot = () => page.screenshot({ path: fileURLToPath(new URL(`../public/screenshots/${name}.jpg`, import.meta.url)), type: 'jpeg', quality: 85 });
    if (mobile) {
      const cdp = await page.context().newCDPSession(page), x = Math.round(width * .72), y = height - 170;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 8 }] }); await page.waitForTimeout(16); }
      await page.waitForTimeout(1300);
      await shot();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(1300);
      await shot();
      await page.keyboard.up('ArrowUp');
    }
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
