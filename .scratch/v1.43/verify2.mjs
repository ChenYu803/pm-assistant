import { chromium } from "playwright-core";
const exe = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const drum = page.locator('[data-turntable] div[role="group"][tabindex="0"]');
const angle = () => page.evaluate(() => {
  const el = document.querySelector('[data-turntable] div[role="group"][tabindex="0"]');
  const m = getComputedStyle(el).transform.match(/matrix3d\(([^)]+)\)/);
  if (!m) return null;
  const v = m[1].split(",").map(Number);
  return (Math.atan2(v[8], v[0]) * 180) / Math.PI;
});
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
const a0 = await angle(); await page.waitForTimeout(2000); const a1 = await angle();
console.log("自转 °/s:", ((a0 - a1) / 2).toFixed(2), "| a0", a0?.toFixed(2), "a1", a1?.toFixed(2));

const box = await page.locator("[data-turntable]").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 40);
await page.waitForTimeout(1600);
const aHover = await angle();
const mod = ((aHover % 90) + 90) % 90;
console.log("悬停:", aHover.toFixed(2), "距档位:", Math.min(mod, 90 - mod).toFixed(2));

const before = await angle();
await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
await page.mouse.down();
for (let i = 1; i <= 10; i += 1) { await page.mouse.move(box.x + box.width * 0.4 + i * 10, box.y + box.height * 0.5); await page.waitForTimeout(12); }
const during = await angle();
await page.mouse.up();
console.log("拖 100px 转过:", Math.abs(during - before).toFixed(2), "°");
await page.waitForTimeout(1500);
console.log("吸附后:", (await angle()).toFixed(2));

await page.locator("[data-turntable] [class*='__index'] button").nth(2).click();
await page.waitForTimeout(1300);
console.log("索引:", await page.evaluate(() => [...document.querySelectorAll("[data-turntable] [class*='__index'] button")].map((b) => b.getAttribute("aria-pressed"))), "角度:", (await angle()).toFixed(2));

await drum.focus();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(1300);
console.log("键盘右移:", (await angle()).toFixed(2));
console.log("横向溢出 1440:", await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1000);
console.log("横向溢出 390:", await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
await page.screenshot({ path: ".scratch/v1.43/landing-v143-mobile.png" });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForTimeout(600);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);
await page.mouse.move(200, 120);
await page.waitForTimeout(900);
await page.screenshot({ path: ".scratch/v1.43/landing-v143-desktop.png" });

const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
const rm = await ctx.newPage();
await rm.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await rm.waitForTimeout(1200);
const r0 = await rm.evaluate(() => getComputedStyle(document.querySelector('[data-turntable] div[role="group"][tabindex="0"]')).transform);
await rm.waitForTimeout(1200);
const r1 = await rm.evaluate(() => getComputedStyle(document.querySelector('[data-turntable] div[role="group"][tabindex="0"]')).transform);
console.log("reduced-motion 静止:", r0 === r1);
await ctx.close();
await browser.close();
