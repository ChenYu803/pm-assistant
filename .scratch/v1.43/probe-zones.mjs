import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: ".scratch/v1.43/auth-state.json" });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const zones = await page.evaluate(() => {
  const out = [];
  const walk = (root) => {
    root.querySelectorAll("section,aside,main,div[class]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 200) return;
      const cs = getComputedStyle(el);
      out.push({
        cls: el.className.toString().slice(0, 60),
        bg: cs.backgroundColor,
        border: cs.borderTopColor + " " + cs.borderTopWidth,
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","),
      });
    });
  };
  walk(document);
  return out.filter((z) => z.cls.includes("workbench") || z.cls.includes("iteration")).slice(0, 24);
});
console.log(JSON.stringify(zones, null, 1));
await browser.close();
