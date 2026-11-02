import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://localhost:3000/prototype/hero", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const out = await page.evaluate(() => {
  const drum = document.querySelector("[data-face]").parentElement;
  const faces = [...document.querySelectorAll("[data-face]")];
  const index = document.querySelector('[aria-label="直接跳到某一面"]');
  const hintBox = index.getBoundingClientRect();
  const orig = drum.style.transform;
  let maxRight = -1e9, minLeft = 1e9, atRight = 0, atLeft = 0;
  for (let a = 0; a <= 90; a += 5) {
    drum.style.transform = `translateZ(calc(var(--r) * -1)) rotateX(-7deg) rotateY(${-a}deg)`;
    const rs = faces.map((f) => f.getBoundingClientRect());
    const right = Math.max(...rs.map((r) => r.right));
    const left = Math.min(...rs.map((r) => r.left));
    if (right > maxRight) { maxRight = right; atRight = -a; }
    if (left < minLeft) { minLeft = left; atLeft = -a; }
  }
  drum.style.transform = orig;
  return { maxRight, atRight, minLeft, atLeft, indexLeft: hintBox.left, stageLeft: document.querySelector("[data-turntable]").getBoundingClientRect().left };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
