import { chromium } from "playwright-core";
const EXE = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const b = await chromium.launch({ executablePath: EXE });
const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, storageState: ".scratch/v1.43/auth-state.json" });
const p = await c.newPage();
await p.goto("http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const dump = async (sel, label, props=["fontFamily","fontSize","fontWeight","color","backgroundColor","borderTopColor","transition","outline"]) => {
  const el = await p.$(sel);
  if (!el) return console.log(label.padEnd(26), "NOT FOUND");
  const v = await el.evaluate((n,ps)=>{const s=getComputedStyle(n);const o={};for(const k of ps)o[k]=s[k];return o;}, props);
  for (const k in v) if (v[k] && v[k]!=="none" && v[k]!=="rgba(0, 0, 0, 0)") console.log(label.padEnd(26), k.padEnd(15), String(v[k]).slice(0,90));
  console.log("");
};
await dump(".workbench-project strong","title strong");
await dump(".sessions-heading h2","sessions heading");
// hover probes
const hover = async (sel, label) => {
  const el = await p.$(sel); if (!el) return console.log(label, "NOT FOUND");
  const before = await el.evaluate(n=>getComputedStyle(n).backgroundColor);
  await el.hover(); await p.waitForTimeout(260);
  const after = await el.evaluate(n=>{const s=getComputedStyle(n);return [s.backgroundColor,s.color,s.borderTopColor];});
  console.log(label.padEnd(26), "bg:", before, "->", after[0], "| color ->", after[1], "| border ->", after[2]);
};
await hover(".stage-empty button","empty CTA hover");
await hover(".conversation-heading button","conv action btn hover");
await hover(".context-switch button:nth-child(2)","tab2 hover");
await hover(".workbench-back","back link hover");
await hover(".workbench-stage:nth-child(2)","stage2 hover");
await hover(".workbench-composer button","submit hover (disabled)");
// stage nav active vs idle bg
const stages = await p.$$eval(".workbench-stage", ns=>ns.map(n=>{const s=getComputedStyle(n);return {t:n.textContent.replace(/\s+/g," ").trim().slice(0,14), bg:s.backgroundColor, cur:n.getAttribute("aria-current")||n.dataset.state||n.className}}));
console.log("stages:", JSON.stringify(stages,null,0));
await b.close();
