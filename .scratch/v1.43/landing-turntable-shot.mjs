import { chromium } from "playwright-core";

const exe = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const out = ".scratch/v1.43";

const shot = async (page, name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name); };

const browser = await chromium.launch({ executablePath: exe });

// 桌面
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await desktop.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await desktop.waitForTimeout(2200);
await shot(desktop, "landing-turntable-01-rest");

const readTurn = () => desktop.evaluate(() => {
  const drum = document.querySelector("[data-turntable] [data-drum]") ?? document.querySelector("[data-turntable] > div:nth-child(2) > div > div");
  return drum ? getComputedStyle(drum).transform : "none";
});
console.log("overlap:", await desktop.evaluate(() => {
  const stage = document.querySelector("[data-turntable]");
  const idx = stage?.querySelector("[class*='index']");
  if (!stage || !idx) return "missing";
  const a = stage.getBoundingClientRect(); const b = idx.getBoundingClientRect();
  return { stageRight: Math.round(a.right), indexLeft: Math.round(b.left) };
}));

// 拖动一次，看是否真的转了
const box = await desktop.locator("[data-turntable]").boundingBox();
await desktop.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
await desktop.mouse.down();
for (let i = 0; i <= 12; i += 1) {
  await desktop.mouse.move(box.x + box.width * 0.5 + i * 6, box.y + box.height * 0.45);
  await desktop.waitForTimeout(16);
}
await shot(desktop, "landing-turntable-02-drag");
await desktop.mouse.up();
await desktop.waitForTimeout(1200);
await shot(desktop, "landing-turntable-03-after-drag");
console.log("transform after drag:", await readTurn());

// 滚动到 practice 区，确认接力没坏
await desktop.evaluate(() => document.querySelector("#practice")?.scrollIntoView({ block: "start" }));
await desktop.waitForTimeout(700);
await shot(desktop, "landing-turntable-04-practice");
console.log("practice phase:", await desktop.evaluate(() => document.querySelector("#practice")?.getAttribute("data-phase")));

console.log("overflow desktop:", await desktop.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));

// 手机
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await mobile.waitForTimeout(1800);
await shot(mobile, "landing-turntable-05-mobile");
console.log("overflow mobile:", await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));

// reduced motion
const reduced = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
const page = await reduced.newPage();
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const t0 = await page.evaluate(() => getComputedStyle(document.querySelector("[data-turntable] [class*='drum']")).transform);
await page.waitForTimeout(1200);
const t1 = await page.evaluate(() => getComputedStyle(document.querySelector("[data-turntable] [class*='drum']")).transform);
console.log("reduced static:", t0 === t1);
await reduced.close();

await browser.close();
