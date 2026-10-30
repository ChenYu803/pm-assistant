import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('.', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless: true });
const specs = [
  ['home', '/'], ['brief', '/onboarding/brief'], ['scene-01', '/onboarding/scenes'],
  ...[2, 3, 4, 5, 6, 7].map((n) => [`scene-0${n}`, `/onboarding/scenes?scene=${n}`]),
  ['assessment', '/onboarding/assessment'], ['login', '/login'], ['register', '/register'],
];
for (const [name, route] of specs) {
  for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:3000${route}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${out}${name}-${device}.png`, fullPage: true });
    if (name === 'assessment') {
      await page.getByRole('button', { name: '开始测试' }).click();
      const questions = page.locator('[data-assessment-reveal]');
      for (let i = 0; i < await questions.count(); i++) {
        await questions.nth(i).locator('[role="radio"]').first().click();
      }
      await page.getByRole('button', { name: '查看测试结果' }).click();
      await page.getByRole('button', { name: '提交答案' }).click().catch(() => {});
      const modalButton = page.getByRole('button', { name: /查看结果|确认提交|提交答案|提交并查看/ });
      if (await modalButton.count()) await modalButton.last().click();
      await page.screenshot({ path: `${out}assessment-result-${device}.png`, fullPage: true });
    }
    await page.close();
  }
}
await browser.close();
