import { chromium } from "playwright-core";
const exe = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe });
for (const [url, tag] of [["http://localhost:3000/", "landing"], ["http://localhost:3000/prototype/hero", "proto"]]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "networkidle" });
  // 悬停把它停到最近的档位，避免停在任意角度
  const stage = page.locator("[data-turntable]");
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.waitForTimeout(1600);
  await stage.screenshot({ path: `.scratch/v1.43/stage-${tag}-detent.png` });
  console.log(tag, await page.evaluate(() => {
    const f = document.querySelector("[data-turntable] [class*='__face']");
    const drums = [...document.querySelectorAll("[data-turntable] [class*='drum']")].map((el) => [el.className, getComputedStyle(el).transform]);
    return { face: f.className, content: getComputedStyle(f).getPropertyValue("--content"), dim: getComputedStyle(f).getPropertyValue("--dim"), drums };
  }));
  await page.close();
}
await browser.close();
