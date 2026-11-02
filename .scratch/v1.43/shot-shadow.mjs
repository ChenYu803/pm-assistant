// 截 onboarding 两个页面，确认硬阴影换成软高度后不再像脏块。
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const shots = [
  ["shadow-assessment", "http://localhost:3000/onboarding/assessment"],
  ["shadow-scenes", "http://localhost:3000/onboarding/scenes"],
  ["shadow-brief", "http://localhost:3000/onboarding/brief"],
];

for (const [name, url] of shots) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `.scratch/v1.43/${name}.png` });
  console.log("shot", name);
}

await browser.close();
