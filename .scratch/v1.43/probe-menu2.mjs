import { chromium } from "playwright-core";
const B = "http://localhost:3000";
const PID = "742e6b94-4638-4c25-80e7-9b66fac56d0b";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ storageState: ".scratch/v1.43/auth-state.json", viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto(B + "/projects/" + PID, { waitUntil: "networkidle" });
const more = page.locator("button[aria-label*='更多'], .iteration-more, .iteration-row-more").first();
const cnt = await more.count();
console.log("iteration more buttons:", cnt);
if (cnt) {
  await more.click();
  await page.waitForSelector(".iteration-menu", { state: "visible" });
  const acts = page.locator(".iteration-menu-action");
  const n = await acts.count();
  for (let i = 0; i < n; i++) {
    const a = acts.nth(i);
    const label = (await a.innerText()).trim();
    await a.hover();
    await page.waitForTimeout(160);
    const st = await a.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    console.log(`  ${label} | hover ${st.bg} | text ${st.fg}`);
  }
  await page.screenshot({ path: ".scratch/v1.43/menu2-hover-fixed.png", clip: { x: 420, y: 100, width: 620, height: 460 } });
}
await browser.close();
