import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ executablePath: 'D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless: true });
for (const [name, route] of [['login', '/login'], ['register', '/register']]) {
  for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:3000${route}`, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: `${out}${name}-${device}.png`, fullPage: true });
    await page.close();
  }
}
for (const [name, route] of [['scene-01-feedback', '/onboarding/scenes'], ...[2, 3, 4, 5, 6, 7].map(n => [`scene-0${n}-feedback`, `/onboarding/scenes?scene=${n}`])]) {
  for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:3000${route}`, { waitUntil: 'domcontentloaded' });
    if (name === 'scene-01-feedback') {
      await page.getByRole('checkbox').first().check();
      await page.getByRole('button', { name: /提交我的判断/ }).click();
    } else {
      await page.locator('[data-motion-key*="-options"] button').first().click();
      await page.getByRole('button', { name: /提交我的判断/ }).click();
    }
    await page.screenshot({ path: `${out}${name}-${device}.png`, fullPage: true });
    await page.close();
  }
}
await browser.close();
