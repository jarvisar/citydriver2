import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Rasterize the web app's favicon for the desktop packages. electron-builder
// converts electron/build/icon.png into .ico (Windows) and .icns (macOS) itself.
// Re-run after changing public/favicon.svg: npm run electron:icons
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch(process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH }
  : process.platform === 'win32' && existsSync(chrome) ? { executablePath: chrome } : {});
try {
  const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  const target = new URL('../electron/build/', import.meta.url);
  await mkdir(target, { recursive: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const size = 1024;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:transparent}body{display:grid;place-items:center}svg{width:100%;height:100%}</style>${svg}`);
  await page.screenshot({ path: fileURLToPath(new URL('icon.png', target)), omitBackground: true });
  console.log(`Wrote ${fileURLToPath(new URL('icon.png', target))} (${size}x${size})`);
} finally { await browser.close(); }
