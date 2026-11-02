import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:3000/prototype/hero", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1800);
await page.screenshot({ path: ".scratch/v1.43/hero-turn-23-mobile.png" });
console.log("overflow", await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
await browser.close();
