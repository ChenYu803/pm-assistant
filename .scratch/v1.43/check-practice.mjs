import { chromium } from "playwright-core";
const exe = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
console.log("main is scroller:", await page.evaluate(() => {
  const main = document.querySelector("main");
  const cs = getComputedStyle(main);
  return { overflow: cs.overflowY, clientHeight: main.clientHeight, scrollHeight: main.scrollHeight, attr: main.dataset.motion };
}));
const target = await page.evaluate(() => {
  const main = document.querySelector("main");
  const p = document.querySelector("#practice");
  return p.offsetTop - 200;
});
for (const y of [target, target + 700, target + 1400]) {
  await page.evaluate((v) => { document.querySelector("main").scrollTop = v; }, y);
  await page.waitForTimeout(500);
  console.log("scrollTop", Math.round(y), "phase", await page.evaluate(() => document.querySelector("#practice").dataset.phase), "progress", await page.evaluate(() => document.querySelector("#practice").dataset.progress));
}
await page.evaluate(() => { document.querySelector("main").scrollTop = 0; });
await page.waitForTimeout(300);
const box = await page.locator("[data-turntable]").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
await page.waitForTimeout(1800);
await page.screenshot({ path: ".scratch/v1.43/final-hero-desktop.png" });
await browser.close();
