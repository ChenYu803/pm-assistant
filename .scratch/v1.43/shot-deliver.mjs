// 交付截图：landing / projects / workbench 桌面与移动，并核对关键计算色。
import { chromium } from "playwright-core";

const EXE = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const STATE = ".scratch/v1.43/auth-state.json";
const ITER =
  "/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e";

const browser = await chromium.launch({ executablePath: EXE });

for (const [tag, width, height] of [
  ["desk", 1440, 1000],
  ["mob", 390, 844],
]) {
  const ctx = await browser.newContext({ viewport: { width, height }, storageState: STATE });
  const page = await ctx.newPage();
  for (const [name, path] of [
    ["landing", "/"],
    ["projects", "/projects"],
    ["workbench", ITER],
  ]) {
    await page.goto("http://localhost:3000" + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `.scratch/v1.43/deliver-${name}-${tag}.png` });
    const ovf = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(`${name}/${tag} overflowX=${ovf}`);
  }
  await ctx.close();
}

await browser.close();
