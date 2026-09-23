import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Rasterize the city mark; no new artwork or image dependency.
const browser = await chromium.launch(process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH }
  : process.platform === 'win32'
    ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }
    : {});
try {
  const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, maskable] of [
    ['icon-192', 192, false], ['icon-512', 512, false],
    ['icon-maskable-512', 512, true], ['apple-touch-icon', 180, true],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#20323d}body{display:grid;place-items:center}svg{width:${maskable ? 80 : 100}%;height:${maskable ? 80 : 100}%}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../public/icons/${name}.png`, import.meta.url)) });
  }
} finally { await browser.close(); }
