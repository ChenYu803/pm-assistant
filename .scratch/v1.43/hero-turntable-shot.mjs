import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const url = "http://localhost:3000/prototype/hero";
const shot = (page, name) => page.screenshot({ path: `.scratch/v1.43/hero-turn-${name}.png` });

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const status = await page.goto(url, { waitUntil: "networkidle" });
console.log("status", status?.status(), "url", page.url());
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
await shot(page, "01-rest");

const box = await page.locator("[data-prototype] [role=group]").first().boundingBox();
console.log("drum box", box);

// 拖到 45°：看侧面受光与台面投影
await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.5);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.72 - 70, box.y + box.height * 0.5, { steps: 10 });
await page.waitForTimeout(120);
await shot(page, "02-mid-drag");

// 继续拖过 90°，松手吸附到第 2 面
await page.mouse.move(box.x + box.width * 0.72 - 170, box.y + box.height * 0.5, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(900);
await shot(page, "03-snapped-face2");

const state = await page.evaluate(() => {
  const drum = document.querySelector("[data-face]")?.parentElement?.parentElement;
  const faces = Array.from(document.querySelectorAll("[data-face]"));
  return {
    drumTransform: drum?.style.transform,
    dims: faces.map((f) => f.style.getPropertyValue("--dim")),
    pressed: Array.from(document.querySelectorAll("[aria-pressed]")).map((b) => b.getAttribute("aria-pressed")),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});
console.log(JSON.stringify(state, null, 2));

// 索引直跳第 4 面
await page.locator("button[aria-pressed]").nth(3).click();
await page.waitForTimeout(900);
await shot(page, "04-index-face4");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await shot(page, "05-mobile");
console.log("mobile overflow", await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));

await browser.close();
