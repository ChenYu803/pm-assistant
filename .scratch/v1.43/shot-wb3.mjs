import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: ".scratch/v1.43/auth-state.json" });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/projects", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.getByRole("button", { name: "暗色验收项目" }).first().click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: "创建产品迭代" }).first().click();
await page.waitForTimeout(1000);
const drawer = page.locator('[role="dialog"]').first();
await page.screenshot({ path: ".scratch/v1.43/dark-iter-drawer.png" });
await drawer.locator("input").first().fill("暗色验收迭代");
// 选 B 暂不填写
await drawer.getByText("暂不填写", { exact: false }).first().click();
await page.waitForTimeout(400);
const confirm = page.getByRole("button", { name: /确认暂不填写/ });
if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(500); }
const createBtn = drawer.getByRole("button", { name: /创建并进入工作区/ });
console.log("createBtn:", await createBtn.count());
await createBtn.first().click();
await page.waitForTimeout(7000);
console.log("url:", page.url());
await page.screenshot({ path: ".scratch/v1.43/dark-workbench.png" });
console.log("body:", (await page.evaluate(() => document.body.innerText)).replace(/\n/g, " | ").slice(0, 400));
await browser.close();
