import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, storageState: ".scratch/v1.43/auth-state.json" });
const p = await c.newPage();
await p.goto("http://localhost:3000/projects", { waitUntil: "networkidle" });
await p.waitForTimeout(900);
const r = await p.evaluate(() => {
  const g = (s) => { const e = document.querySelector(s); if (!e) return "MISSING"; const st = getComputedStyle(e); return `${st.backgroundColor} @ ${Math.round(e.getBoundingClientRect().width)}px`; };
  return {
    shell: g(".project-workspace-shell"),
    rail: g(".project-workspace-rail"),
    main: g(".project-workspace-main"),
    listPanel: g(".iteration-list-panel"),
    inner: g(".project-workspace-main > *"),
  };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
