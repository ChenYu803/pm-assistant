import { chromium } from "playwright-core";
const EXE = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const b = await chromium.launch({ executablePath: EXE });
const c = await b.newContext({ viewport:{width:1440,height:1000}, storageState: ".scratch/v1.43/auth-state.json" });
const p = await c.newPage();
const info = async (url, sels) => {
  await p.goto(url, { waitUntil:"networkidle" }); await p.waitForTimeout(900);
  console.log("--- "+url);
  for (const s of sels) {
    const el = await p.$(s);
    if (!el) { console.log("  "+s.padEnd(34)+" NOT FOUND"); continue; }
    const v = await el.evaluate(n=>{const c=getComputedStyle(n);return {color:c.color,bg:c.backgroundColor,font:c.fontFamily.slice(0,28),size:c.fontSize,br:c.borderRadius};});
    console.log("  "+s.padEnd(34)+JSON.stringify(v));
  }
};
await info("http://localhost:3000/projects", [".iteration-updated",".iteration-goal.empty",".iteration-row",".iteration-section-head h3",".iteration-eyebrow",".iteration-button-primary"]);
await p.screenshot({ path: ".scratch/v1.43/A-projects-fresh.png" });
await info("http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b", [".iteration-project-head h2",".iteration-button-primary",".iteration-iteration-row",".iteration-row"]);
await p.screenshot({ path: ".scratch/v1.43/A-projectdetail.png" });
// open the overflow menu to capture the cream shadow
try {
  const btn = await p.$(".iteration-menu-trigger, .iteration-row-menu button, [aria-label*='更多'], .iteration-more");
  if (btn) { await btn.click(); await p.waitForTimeout(400); await p.screenshot({ path: ".scratch/v1.43/A-menu.png" }); console.log("menu captured"); }
  else console.log("menu trigger not found; listing buttons:", JSON.stringify(await p.$$eval("button",ns=>ns.map(n=>n.className||n.textContent.trim().slice(0,12)).slice(0,20))));
} catch(e) { console.log("menu err", e.message); }
await b.close();
