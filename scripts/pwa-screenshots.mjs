import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  await mkdir(new URL('../public/screenshots/', import.meta.url), { recursive: true });
  for (const [name, width, height, mobile] of [['desktop', 1280, 800, false], ['mobile', 540, 960, true]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=4817`);
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    await page.locator('#loading').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: fileURLToPath(new URL(`../public/screenshots/${name}.jpg`, import.meta.url)), type: 'jpeg', quality: 85 });
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
