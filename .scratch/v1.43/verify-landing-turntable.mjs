import { chromium } from "playwright-core";
const exe = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const angle = () => page.evaluate(() => {
  const drum = document.querySelector("[data-turntable] [class*='__drum']");
  const m = getComputedStyle(drum).transform.match(/matrix3d\(([^)]+)\)/);
  if (!m) return null;
  const v = m[1].split(",").map(Number);
  return (Math.atan2(v[2], v[0]) * 180) / Math.PI; // rotateY 分量
});
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });

// 1) 自转
const a0 = await angle(); await page.waitForTimeout(2000); const a1 = await angle();
console.log("自转速度 °/s:", ((a0 - a1) / 2).toFixed(2));

// 2) 悬停停到档位
const box = await page.locator("[data-turntable]").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 40);
await page.waitForTimeout(1500);
const aHover = await angle();
console.log("悬停角度:", aHover?.toFixed(2), "是 90 的倍数:", Math.abs(((aHover % 90) + 90) % 90) < 0.6 || Math.abs(Math.abs(((aHover % 90) + 90) % 90) - 90) < 0.6);

// 3) 拖动灵敏度：拖 100px
const before = await angle();
await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
await page.mouse.down();
for (let i = 1; i <= 10; i += 1) { await page.mouse.move(box.x + box.width * 0.4 + i * 10, box.y + box.height * 0.5); await page.waitForTimeout(12); }
const during = await angle();
await page.mouse.up();
console.log("拖 100px 转过:", Math.abs(during - before).toFixed(2), "°");
await page.waitForTimeout(1400);
const settled = await angle();
console.log("松手吸附后:", settled?.toFixed(2));

// 4) 索引跳面
await page.locator("[data-turntable] [class*='__index'] button").nth(2).click();
await page.waitForTimeout(1200);
console.log("索引第 3 面 aria-pressed:", await page.evaluate(() => [...document.querySelectorAll("[data-turntable] [class*='__index'] button")].map((b) => b.getAttribute("aria-pressed"))));
console.log("跳到第 3 面角度:", (await angle())?.toFixed(2));

// 5) 键盘
await page.locator("[data-turntable] [class*='__drum']").focus();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(1200);
console.log("键盘右移后角度:", (await angle())?.toFixed(2));

// 6) 溢出
console.log("横向溢出:", await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));

// 7) 手机
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(900);
console.log("手机横向溢出:", await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
await page.screenshot({ path: ".scratch/v1.43/landing-v143-mobile.png" });

// 8) reduced motion
const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
const rm = await ctx.newPage();
await rm.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await rm.waitForTimeout(1200);
const r0 = await rm.evaluate(() => getComputedStyle(document.querySelector("[data-turntable] [class*='__drum']")).transform);
await rm.waitForTimeout(1200);
const r1 = await rm.evaluate(() => getComputedStyle(document.querySelector("[data-turntable] [class*='__drum']")).transform);
console.log("reduced-motion 静止:", r0 === r1);
await ctx.close();
await browser.close();
