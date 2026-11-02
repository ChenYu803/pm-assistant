import { chromium } from "playwright-core";
const B = "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ storageState: ".scratch/v1.43/auth-state.json", viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto(B + "/projects", { waitUntil: "networkidle" });
await page.click(".project-workspace-more");
await page.waitForSelector(".project-workspace-menu", { state: "visible" });
const acts = page.locator(".project-workspace-menu-action");
const n = await acts.count();
console.log("menu actions:", n);
for (let i = 0; i < n; i++) {
  const a = acts.nth(i);
  const label = (await a.innerText()).trim();
  const before = await a.evaluate((el) => getComputedStyle(el).backgroundColor);
  await a.hover();
  await page.waitForTimeout(160);
  const after = await a.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
  console.log(`  ${label} | idle ${before} | hover ${after.bg} | text ${after.fg}`);
}
await page.screenshot({ path: ".scratch/v1.43/menu-hover-fixed.png", clip: { x: 0, y: 120, width: 420, height: 420 } });
await browser.close();
