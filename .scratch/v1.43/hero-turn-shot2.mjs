import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const url = "http://localhost:3000/prototype/hero";
const shot = (page, name) => page.screenshot({ path: `.scratch/v1.43/hero-turn-${name}.png` });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1900);
await shot(page, "20-auto");

const box = await page.locator("[data-prototype] [role=group]").first().boundingBox();
const x = box.x + box.width * 0.55, y = box.y + box.height * 0.5;
await page.mouse.move(x, y);
await page.waitForTimeout(900);
await page.mouse.down();
await page.mouse.move(x - 100, y, { steps: 8 });
await page.waitForTimeout(80);
await shot(page, "21-drag-45");
console.log("angle", await page.evaluate(() => (document.querySelector("[data-face]").parentElement.style.transform.match(/rotateY\(([-\d.]+)deg\)/) || [])[1]));

// 底部刻度盘特写
await page.mouse.up();
await page.waitForTimeout(900);
const wrap = await page.locator("[data-platter]").boundingBox();
await page.screenshot({ path: ".scratch/v1.43/hero-turn-22-dial.png", clip: { x: wrap.x - 40, y: wrap.y - 90, width: wrap.width + 80, height: wrap.height + 120 } });
console.log("overflow", await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
await browser.close();
