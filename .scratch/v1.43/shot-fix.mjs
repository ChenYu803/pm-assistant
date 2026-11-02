import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: ".scratch/v1.43/auth-state.json" });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/projects", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: ".scratch/v1.43/fix-projects.png" });

// 读实际计算颜色，确认两处淡字已加深
const probe = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { text: (el.textContent || "").trim().slice(0, 24), color: cs.color, size: cs.fontSize };
  };
  return {
    heading: pick(".project-workspace-heading p:not(.project-workspace-eyebrow)"),
    meta: pick(".iteration-project-meta"),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
console.log(JSON.stringify(probe, null, 2));

// 悬停取色：确认不再变白/变橙
const hovers = [];
for (const sel of [".project-workspace-select", ".new-session-button", ".workbench-stage", ".iteration-button-quiet"]) {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) { hovers.push({ sel, missing: true }); continue; }
  const base = await el.evaluate((n) => getComputedStyle(n).backgroundColor);
  await el.hover();
  await page.waitForTimeout(220);
  const hot = await el.evaluate((n) => getComputedStyle(n).backgroundColor);
  hovers.push({ sel, base, hot });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(120);
}
console.log(JSON.stringify(hovers, null, 2));
await browser.close();
