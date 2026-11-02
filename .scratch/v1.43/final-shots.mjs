import { chromium } from "playwright-core";
const exe = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
// 指到转台上：停在最近档位，正是用户第一次摸到时看到的样子
const box = await page.locator("[data-turntable]").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
await page.waitForTimeout(1800);
await page.screenshot({ path: ".scratch/v1.43/final-hero-desktop.png" });
// 拨到第 3 面，确认换面
await page.locator("[data-turntable] [class*='__index'] button").nth(2).click();
await page.waitForTimeout(1400);
await page.screenshot({ path: ".scratch/v1.43/final-hero-face3.png" });
// 产品实践区滚动接力
for (const offset of [0, 600, 1200, 1800]) {
  await page.evaluate((y) => {
    const el = document.querySelector("#practice");
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + y);
  }, offset);
  await page.waitForTimeout(400);
  console.log("scroll +" + offset, "phase=", await page.evaluate(() => document.querySelector("#practice").dataset.phase), "progress=", await page.evaluate(() => document.querySelector("#practice").dataset.progress));
}
await browser.close();
