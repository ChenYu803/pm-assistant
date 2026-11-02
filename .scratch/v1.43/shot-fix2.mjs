import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: ".scratch/v1.43/auth-state.json" });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e", { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
await page.screenshot({ path: ".scratch/v1.43/fix-workbench.png" });

const sels = [".new-session-button", ".workbench-stage", ".workbench-quiet-button", ".conversation-heading button", ".session-row"];
const out = [];
for (const sel of sels) {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) { out.push({ sel, missing: true }); continue; }
  const base = await el.evaluate((n) => { const c = getComputedStyle(n); return c.backgroundColor + " | " + c.color + " | " + c.borderColor; });
  await el.hover({ force: true });
  await page.waitForTimeout(200);
  const hot = await el.evaluate((n) => { const c = getComputedStyle(n); return c.backgroundColor + " | " + c.color + " | " + c.borderColor; });
  out.push({ sel, base, hot });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(100);
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
