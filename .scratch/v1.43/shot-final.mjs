import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
for (const [tag, w, h] of [["desk", 1440, 1000], ["mob", 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  for (const [name, url] of [["landing", "http://localhost:3000/"], ["login", "http://localhost:3000/login"], ["assessment", "http://localhost:3000/onboarding/assessment"]]) {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const ox = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(tag, name, "overflowX=", ox);
    await page.screenshot({ path: `.scratch/v1.43/final-${tag}-${name}.png`, fullPage: false });
  }
  await ctx.close();
}
await browser.close();
