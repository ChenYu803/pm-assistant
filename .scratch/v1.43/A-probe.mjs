import { chromium } from "playwright-core";
const EXE = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const b = await chromium.launch({ executablePath: EXE });
const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, storageState: ".scratch/v1.43/auth-state.json" });
const p = await c.newPage();
await p.goto("http://localhost:3000/projects", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);

const probe = async (sel, label) => {
  const el = await p.$(sel);
  if (!el) return console.log(label, "-> NOT FOUND");
  const cs = await el.evaluate((n) => {
    const s = getComputedStyle(n);
    return { bg: s.backgroundColor, color: s.color, border: s.borderColor, fs: s.fontSize, ff: s.fontFamily.slice(0,30) };
  });
  console.log(label, JSON.stringify(cs));
};
await probe(".iteration-row", "row(normal)");
await probe(".iteration-updated", "updated");
await probe(".iteration-goal.empty", "goal-empty");
const row = await p.$(".iteration-row");
await row.hover();
await p.waitForTimeout(300);
await probe(".iteration-row", "row(hover)");
await probe(".iteration-updated", "updated(hover)");
console.log("--- geometry ---");
console.log(await p.$eval(".iteration-row", (n) => { const r = n.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }));
await b.close();
