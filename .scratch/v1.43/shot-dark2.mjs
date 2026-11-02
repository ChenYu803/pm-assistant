import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
for (const [name, url] of [["assessment", "http://localhost:3000/onboarding/assessment"], ["scenes", "http://localhost:3000/onboarding/scenes"], ["projects", "http://localhost:3000/projects"], ["profile", "http://localhost:3000/profile"]]) {
  const res = await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => ({
    ox: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    url: location.pathname,
    text: document.body.innerText.slice(0, 90).replace(/\n/g, " | "),
  }));
  console.log(name, res.status(), JSON.stringify(info));
  await page.screenshot({ path: `.scratch/v1.43/dark2-${name}.png`, fullPage: false });
}
await browser.close();
