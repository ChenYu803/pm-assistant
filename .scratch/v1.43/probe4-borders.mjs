// Assessment B: explain 0.8px computed borders (zoom / DPR) + zone separator facts
import fs from 'node:fs';
const OUT = '.scratch/v1.43';
const WB = 'http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e';
const EXE = 'D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const { chromium } = await import('playwright-core');
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ['--window-size=1460,1060'] });
try {
  const ctx = await browser.newContext({ storageState: `${OUT}/auth-state.json`, viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(WB, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  out.env = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    htmlZoom: getComputedStyle(document.documentElement).zoom,
    bodyZoom: getComputedStyle(document.body).zoom,
    scale: getComputedStyle(document.querySelector('.iteration-workbench')).zoom,
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    innerWidth: window.innerWidth,
  }));
  // border widths of reference elements + their source rules
  out.borders = await page.evaluate(() => {
    const probe = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        sel,
        top: s.borderTopWidth, right: s.borderRightWidth, bottom: s.borderBottomWidth, left: s.borderLeftWidth,
        style: s.borderTopStyle, color: s.borderTopColor,
      };
    };
    return {
      stageNav: probe('.workbench-stage-nav'),
      contextRail: probe('.workbench-context'),
      sessionsRail: probe('.workbench-sessions'),
      conversation: probe('.workbench-conversation'),
      textarea: probe('.workbench-composer textarea'),
      gridGap: (() => { const g = document.querySelector('.workbench-grid'); if (!g) return null; const s = getComputedStyle(g); return { columnGap: s.columnGap, rowGap: s.rowGap, cols: s.gridTemplateColumns, bg: s.backgroundColor }; })(),
      composer: (() => { const c = document.querySelector('.workbench-composer'); if (!c) return null; const s = getComputedStyle(c); return { bg: s.backgroundColor, borderTop: s.borderTopWidth + ' ' + s.borderTopColor }; })(),
    };
  });
  // where the accent-split lives: list every rendered text color that is a coral
  out.corals = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('.iteration-workbench *')) {
      if (!(el.textContent || '').trim()) continue;
      const c = getComputedStyle(el).color;
      if (/^rgb\((2[0-5]\d), (1[0-9]\d|1[0-9]\d), (8\d|9\d|1[0-2]\d)\)$/.test(c)) {
        const k = c + ' :: ' + (typeof el.className === 'string' && el.className ? el.className.split(/\s+/)[0] : el.tagName) + ' ' + getComputedStyle(el).fontSize;
        seen.set(k, (seen.get(k) || 0) + 1);
      }
    }
    return [...seen.entries()].map(([k, n]) => ({ key: k, count: n }));
  });
} catch (e) { out.fatal = String(e && e.stack ? e.stack : e); }
finally { fs.writeFileSync(`${OUT}/probe4-result.json`, JSON.stringify(out, null, 2)); await browser.close(); }
console.log(JSON.stringify(out, null, 2));
