import { chromium } from "playwright-core";
const EXE = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const OUT = ".scratch/v1.43/";
const AUTH = { storageState: OUT + "auth-state.json" };
const PROJ = "742e6b94-4638-4c25-80e7-9b66fac56d0b";
const ITER = "019a722c-b732-4281-b785-2df18008f54e";
const WB = `http://localhost:3000/projects/${PROJ}/iterations/${ITER}`;

const b = await chromium.launch({ executablePath: EXE });

async function shot(name, url, { auth = true, viewport = { width: 1440, height: 1000 }, act } = {}) {
  const c = await b.newContext({ viewport, ...(auth ? AUTH : {}) });
  const p = await c.newPage();
  try {
    await p.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) { console.log("nav", name, e.message.slice(0, 80)); }
  await p.waitForTimeout(1800);
  if (act) await act(p);
  await p.screenshot({ path: OUT + name + ".png" });
  console.log("ok", name, await p.title());
  await c.close();
}

// workbench desktop
await shot("A-wb-1440", WB);
// workbench with stage hover
await shot("A-wb-hover", WB, { act: async (p) => {
  const el = await p.$(".workbench-stage:nth-child(2)");
  if (el) await el.hover();
  await p.waitForTimeout(400);
}});
// workbench focused stage (keyboard)
await shot("A-wb-focus", WB, { act: async (p) => {
  await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); await p.keyboard.press("Tab");
  await p.waitForTimeout(300);
}});
// workbench mobile
await shot("A-wb-390", WB, { viewport: { width: 390, height: 844 } });
// projects page
await shot("A-projects-1440", "http://localhost:3000/projects");
// projects page - zoomed on the iteration list area to inspect panel separation
await shot("A-proj-hover", "http://localhost:3000/projects", { act: async (p) => {
  const el = await p.$(".iteration-row");
  if (el) { await el.hover(); }
  await p.waitForTimeout(500);
}});
await shot("A-projects-390", "http://localhost:3000/projects", { viewport: { width: 390, height: 844 } });
// login / register
await shot("A-login", "http://localhost:3000/login", { auth: false });
await shot("A-register", "http://localhost:3000/register", { auth: false });
// onboarding brief
await shot("A-brief", "http://localhost:3000/onboarding/brief");
// landing reference
await shot("A-landing", "http://localhost:3000/", { auth: false });
// workbench drawer (new session) to see modal surfaces
await shot("A-wb-drawer", WB, { act: async (p) => {
  const btn = await p.$("text=新建会话");
  if (btn) { await btn.click(); await p.waitForTimeout(900); }
}});
await b.close();
