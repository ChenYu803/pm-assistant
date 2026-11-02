import { chromium } from "playwright-core";
const EXE = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const b = await chromium.launch({ executablePath: EXE });
for (const vp of [{width:1440,height:1000,tag:"desktop"},{width:390,height:844,tag:"mobile"}]) {
  const c = await b.newContext({ viewport:{width:vp.width,height:vp.height}, storageState: ".scratch/v1.43/auth-state.json" });
  const p = await c.newPage();
  await p.goto("http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const info = await p.evaluate(() => {
    const vis = n => { const r=n.getBoundingClientRect(); const s=getComputedStyle(n); return r.width>1&&r.height>1&&s.visibility!=="hidden"&&s.display!=="none"&&r.top<innerHeight; };
    const all = [...document.querySelectorAll("a,button,summary,input,textarea,[tabindex]:not([tabindex='-1'])")].filter(vis);
    const heads = [...document.querySelectorAll("h1,h2,h3,h4")].filter(vis).map(n=>n.tagName+":"+n.textContent.trim().slice(0,16));
    const lands = [...document.querySelectorAll("main,nav,aside,header,section[aria-label],section[aria-labelledby],[role]")].map(n=>n.tagName+(n.getAttribute("role")?"[role="+n.getAttribute("role")+"]":"")+(n.getAttribute("aria-label")?"["+n.getAttribute("aria-label")+"]":"")).slice(0,20);
    const unlabeledBtn = all.filter(n=>(n.tagName==="BUTTON"||n.tagName==="A") && !n.textContent.trim() && !n.getAttribute("aria-label") && !n.getAttribute("title")).length;
    return { count: all.length, labels: all.map(n=>(n.textContent||n.getAttribute("aria-label")||n.tagName).replace(/\s+/g," ").trim().slice(0,20)), heads, lands, unlabeledBtn };
  });
  console.log("==== "+vp.tag+" intera: "+info.count+" | unlabeled: "+info.unlabeledBtn);
  console.log("labels:", JSON.stringify(info.labels));
  console.log("heads:", JSON.stringify(info.heads));
  console.log("landmarks:", JSON.stringify(info.lands));
  await c.close();
}
await b.close();
