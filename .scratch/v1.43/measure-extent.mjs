import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://localhost:3000/prototype/hero", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const stage = document.querySelector("[data-turntable]");
  const drum = document.querySelector("[data-face]").parentElement;
  const faces = [...document.querySelectorAll("[data-face]")];
  const rail = document.querySelector("[data-index]") || document.querySelector("[role=tablist]")?.parentElement;
  const s = stage.getBoundingClientRect();
  const d = drum.getBoundingClientRect();
  return {
    stage: { x: s.x, w: s.width, right: s.right },
    drum: { x: d.x, w: d.width, right: d.right, cx: d.x + d.width / 2 },
    rail: rail ? { x: rail.getBoundingClientRect().x, w: rail.getBoundingClientRect().width } : null,
    railHtml: rail ? rail.className : null,
    faceClass: faces[0].className,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
