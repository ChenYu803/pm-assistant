import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: ".scratch/v1.43/auth-state.json" });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => ({ ox: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
console.log("overflowX", info.ox);
await page.screenshot({ path: ".scratch/v1.43/dark-workbench2.png" });
// 右栏文件区切换一下，看 tab 选中态
await page.waitForTimeout(300);
await browser.close();
