import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: ".scratch/v1.43/auth-state.json" });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/projects", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.getByRole("button", { name: "暗色验收项目" }).first().click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: "创建产品迭代" }).first().click();
await page.waitForTimeout(1200);
const dlg = page.locator('[role="dialog"]').first();
if (await dlg.count()) {
  console.log("dlg:", (await dlg.innerText()).replace(/\n/g, " | ").slice(0, 200));
  const inp = dlg.locator("input, textarea");
  if (await inp.count()) await inp.first().fill("暗色验收迭代");
  await page.screenshot({ path: ".scratch/v1.43/dark-iter-dialog.png" });
  const btn = dlg.getByRole("button", { name: /创建|确定|开始/ }).last();
  await btn.click();
  await page.waitForTimeout(6000);
}
console.log("url:", page.url());
await page.screenshot({ path: ".scratch/v1.43/dark-workbench.png" });
console.log("body:", (await page.evaluate(() => document.body.innerText)).replace(/\n/g, " | ").slice(0, 400));
await browser.close();
