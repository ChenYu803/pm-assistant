import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const url = "http://localhost:3000/prototype/hero";
const shot = (page, name) => page.screenshot({ path: `.scratch/v1.43/hero-cloth-${name}.png` });

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await shot(page, "01-rest");

// 载入自扫：等 0.9s 取一帧，此时「看不见的指针」正在第一行中段经过。
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(950);
await shot(page, "02-intro");

// 真实指针悬停：把鼠标停在第二行「孵化成」中间，等它弹到位。
await page.waitForTimeout(900);
const title = await page.locator("h1").boundingBox();
const hoverX = title.x + title.width * 0.22;
const hoverY = title.y + title.height * 0.62;
await page.mouse.move(hoverX, hoverY, { steps: 12 });
await page.waitForTimeout(320);
const hoverPeak = await page.evaluate(() => {
  const moved = Array.from(document.querySelectorAll("[data-cloth-char]")).map((el) => {
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform || "");
    return m ? Math.hypot(Number(m[1]), Number(m[2])) : 0;
  });
  return Math.max(...moved);
});
await shot(page, "03-hover");

// 扫过：从标题左侧快速划到右侧，取中段一帧。
await page.mouse.move(title.x - 60, title.y + title.height * 0.28, { steps: 4 });
for (let x = title.x - 60; x <= title.x + title.width + 40; x += 26) {
  await page.mouse.move(x, title.y + title.height * 0.3);
  await page.waitForTimeout(12);
}
await page.waitForTimeout(90);
await shot(page, "04-sweep");

const seen = await page.evaluate(() => {
  const chars = Array.from(document.querySelectorAll("[data-cloth-char]"));
  const moved = chars.map((el) => {
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform || "");
    const color = el.style.color;
    return { dx: m ? Math.abs(Number(m[1])) : 0, dy: m ? Math.abs(Number(m[2])) : 0, color };
  });
  return {
    chars: chars.length,
    maxDx: Math.max(...moved.map((m) => m.dx)),
    maxDy: Math.max(...moved.map((m) => m.dy)),
    hotChars: moved.filter((m) => m.color).length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await shot(page, "05-mobile");
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

console.log(JSON.stringify({ seen, mobileOverflow }, null, 2));
await browser.close();
