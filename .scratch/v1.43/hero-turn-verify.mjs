import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const url = "http://localhost:3000/prototype/hero";
const shot = (page, name) => page.screenshot({ path: `.scratch/v1.43/hero-turn-${name}.png` });

const readAngle = () => {
  const drum = document.querySelector("[data-face]")?.parentElement?.parentElement;
  const m = (drum?.style.transform || "").match(/rotateY\(([-\d.]+)deg\)/);
  return m ? parseFloat(m[1]) : null;
};

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

// 1) 无操作自转：量角速度
await page.waitForTimeout(700);
const a0 = await page.evaluate(readAngle);
const t0 = Date.now();
await page.waitForTimeout(2400);
const a1 = await page.evaluate(readAngle);
const t1 = Date.now();
const speed = (a0 - a1) / ((t1 - t0) / 1000);
console.log("auto:", { a0, a1, degPerSec: +speed.toFixed(2), secPerFace: +(90 / Math.abs(speed)).toFixed(1) });
await shot(page, "10-auto");

// 2) 指针进入 → 停到最近一面
const box = await page.locator("[data-prototype] [role=group]").first().boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
await page.waitForTimeout(1100);
const aHover1 = await page.evaluate(readAngle);
await page.waitForTimeout(900);
const aHover2 = await page.evaluate(readAngle);
console.log("hover:", { aHover1, aHover2, stopped: aHover1 === aHover2, detent: Math.abs(aHover1 % 90) });

// 3) 拖动灵敏度：100px 应转 ≈ 100/宽*182
const w = await page.evaluate(() => document.querySelector("[data-face]")?.parentElement?.clientWidth);
const x = box.x + box.width * 0.6, y = box.y + box.height * 0.5;
await page.mouse.move(x, y);
await page.mouse.down();
await page.mouse.move(x - 100, y, { steps: 8 });
await page.waitForTimeout(60);
const aDrag = await page.evaluate(readAngle);
console.log("drag:", { drumWidth: w, angleDelta: +(aDrag - aHover2).toFixed(2), expectPer100px: +((100 / Math.max(240, w)) * 182).toFixed(2) });
await shot(page, "11-drag100");
await page.mouse.up();
await page.waitForTimeout(1200);

// 4) 离开后自动恢复
const aLeaveStart = await page.evaluate(readAngle);
await page.mouse.move(10, 10);
await page.waitForTimeout(5200);
const aLeaveEnd = await page.evaluate(readAngle);
console.log("resume:", { aLeaveStart, aLeaveEnd, moving: Math.abs(aLeaveEnd - aLeaveStart) > 1 });

// 5) reduced-motion 不转、不动
const rm = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const p2 = await rm.newPage();
await p2.goto(url, { waitUntil: "networkidle" });
await p2.waitForTimeout(600);
const r0 = await p2.evaluate(readAngle);
await p2.waitForTimeout(1500);
const r1 = await p2.evaluate(readAngle);
console.log("reduced:", { r0, r1, static: r0 === r1 });

console.log("overflow", await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
await browser.close();
