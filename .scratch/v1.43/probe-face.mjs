import { chromium } from "playwright-core";
const exe = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
const info = await page.evaluate(() => {
  const stage = document.querySelector("[data-turntable]");
  const face = stage.querySelector("[class*='face']:not([class*='faceHead']):not([class*='faceFoot'])");
  const cs = getComputedStyle(face);
  const head = face.querySelector("[class*='faceHead']");
  const verb = face.querySelector("[class*='verb']");
  return {
    faceClass: face.className,
    faceOpacity: cs.opacity,
    faceFilter: cs.filter,
    faceBg: cs.backgroundImage.slice(0, 120),
    dimVar: cs.getPropertyValue("--dim"),
    contentVar: cs.getPropertyValue("--content"),
    headOpacity: getComputedStyle(head).opacity,
    verbOpacity: getComputedStyle(verb).opacity,
    verbColor: getComputedStyle(verb).color,
    drumTransform: getComputedStyle(document.querySelector("[class*='drum']")).transform,
    faceBox: face.getBoundingClientRect().toJSON(),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
