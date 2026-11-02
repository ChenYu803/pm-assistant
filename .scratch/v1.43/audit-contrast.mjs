// DOM 全域对比度审计：把每段可见文字与其"实际背景色"比对，报 <4.5（小字）/ <3（大字）的项。
import { chromium } from "playwright-core";

const EXE = "D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const BASE = "http://localhost:3000";
const STATE = ".scratch/v1.43/auth-state.json";
const ITER = "/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e";

const routes = [
  ["workbench", ITER],
  ["projects", "/projects"],
  ["project-detail", "/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b"],
  ["profile", "/profile"],
  ["login", "/login"],
  ["register", "/register"],
  ["brief", "/onboarding/brief"],
  ["assessment", "/onboarding/assessment"],
  ["scenes", "/onboarding/scenes"],
  ["landing", "/"],
];

const audit = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  // 逐层向上合成背景（处理半透明层）
  const effBg = (el) => {
    const stack = [];
    let n = el;
    while (n && n.nodeType === 1) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 0.999) break;
      }
      n = n.parentElement;
    }
    let base = { r: 23, g: 23, b: 19, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) < 0.15) continue;
    // 只取直接含文字的元素
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > innerHeight * 3) continue; // 仅首屏与近屏
    const fgRaw = parse(st.color);
    if (!fgRaw) continue;
    const bg = effBg(el);
    const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
    const size = parseFloat(st.fontSize);
    const weight = Number(st.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const cr = ratio(fg, bg);
    if (cr >= need) continue;
    const key = text.slice(0, 24) + "|" + Math.round(size);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      text: text.slice(0, 40),
      cls: (el.className && String(el.className).slice(0, 60)) || el.tagName.toLowerCase(),
      size: Math.round(size),
      need,
      cr: Number(cr.toFixed(2)),
      fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`,
      bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
    });
  }
  return out.sort((a, b) => a.cr - b.cr).slice(0, 24);
};

const W = Number(process.argv[2] || 1440);
const browser = await chromium.launch({ executablePath: EXE });

for (const [name, path] of routes) {
  const ctx = await browser.newContext({ viewport: { width: W, height: W < 600 ? 844 : 1000 }, storageState: STATE });
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const rows = await page.evaluate(audit);
  const ovf = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(`\n== ${name} (${path}) overflowX=${ovf} 低对比项=${rows.length}`);
  for (const r of rows) console.log(`  ${String(r.cr).padStart(5)} : ${r.text}  [${r.cls}] ${r.size}px ${r.fg} on ${r.bg}`);
  await page.screenshot({ path: `.scratch/v1.43/audit-${name}-${W}.png` });
  await ctx.close();
}

await browser.close();
