// 前后对比用：同一视口、同一滚动位置截同一批页面。
// 用法：node shot-compare.mjs before|after
import { chromium } from "playwright-core";

const tag = process.argv[2] || "before";
const EXE = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const STATE = ".scratch/v1.43/auth-state.json";
const ITER =
  "/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e";

const pages = [
  ["projects", "/projects"],
  ["workbench", ITER],
  ["assessment", "/onboarding/assessment"],
  ["brief", "/onboarding/brief"],
];

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: STATE });
const page = await ctx.newPage();

for (const [name, path] of pages) {
  await page.goto("http://localhost:3000" + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `.scratch/v1.43/cmp-${tag}-${name}.png` });
  console.log(`cmp-${tag}-${name}.png`);
}

await browser.close();
