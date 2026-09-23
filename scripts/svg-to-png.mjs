import { chromium } from '@playwright/test';
const [, , ...files] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
for (const file of files) {
  await page.goto(`file://${file}`);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.screenshot({ path: file.replace(/\.svg$/, '.png'), fullPage: false });
  console.log('wrote', file.replace(/\.svg$/, '.png'));
}
await browser.close();
