// Assessment B: does hardcoded #d76a52 render anywhere? + computed placeholder/muted audit
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
  await page.waitForTimeout(3000);

  out.stylesheets = await page.evaluate(() => [...document.styleSheets].map((s) => s.href || '(inline)'));

  out.hardcodedAccentRendered = await page.evaluate(() => {
    const target = 'rgb(215, 106, 82)'; // #d76a52
    const hits = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.color === target && (el.textContent || '').trim()) {
        hits.push({ tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '', text: (el.textContent || '').trim().slice(0, 30), fontSize: s.fontSize });
      }
    }
    // also any border/background using it
    const bgs = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.backgroundColor === target || s.borderTopColor === target) {
        bgs.push({ tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '', bg: s.backgroundColor, bc: s.borderTopColor });
        if (bgs.length > 8) break;
      }
    }
    return { textHits: hits, borderOrBgHits: bgs };
  });

  // muted token actual usages: which elements render #b1ab98
  out.mutedRendered = await page.evaluate(() => {
    const target = 'rgb(177, 171, 152)';
    const cls = new Map();
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.color === target && (el.textContent || '').trim()) {
        const k = (typeof el.className === 'string' && el.className ? el.className : el.tagName) + ' | ' + s.fontSize + '/' + s.fontWeight;
        cls.set(k, (cls.get(k) || 0) + 1);
      }
    }
    return [...cls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => ({ key: k, count: n }));
  });

  // placeholder across textareas (compare token vs actual)
  out.placeholders = await page.evaluate(() => [...document.querySelectorAll('textarea,input')].map((el) => {
    const s = getComputedStyle(el);
    const ph = getComputedStyle(el, '::placeholder');
    return {
      tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0, 40) : '',
      placeholderAttr: (el.getAttribute('placeholder') || '').slice(0, 24),
      color: s.color, bg: s.backgroundColor, phColor: ph.color, phOpacity: ph.opacity,
      fontSize: s.fontSize,
    };
  }));

  // effective (composited) color of disabled button text over its own bg
  out.disabledComposite = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.disabled);
    if (!b) return null;
    const s = getComputedStyle(b);
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const eff = 0.48;
    const [cr, cg, cb] = parse(s.color);
    const [br, bg2, bb] = parse(s.backgroundColor);
    const blend = (fg, bg) => Math.round(fg * eff + bg * (1 - eff));
    return {
      rawColor: s.color, rawBg: s.backgroundColor, opacity: s.opacity,
      textOverOwnBgComposite: `rgb(${blend(cr, br)}, ${blend(cg, bg2)}, ${blend(cb, bb)})`,
      bgOverPageComposite: `rgb(${blend(br, 23)}, ${blend(bg2, 23)}, ${blend(bb, 19)})`,
      pageBg: 'rgb(23, 23, 19)',
    };
  });

  // stage bar container real class
  out.stageBarContainer = await page.evaluate(() => {
    const first = document.querySelector('.workbench-stage');
    if (!first) return null;
    const p = first.parentElement;
    const gp = p?.parentElement;
    return {
      parentCls: p ? (typeof p.className === 'string' ? p.className : '') : null,
      grandParentCls: gp ? (typeof gp.className === 'string' ? gp.className : '') : null,
      parentTag: p?.tagName, childCount: p?.children.length,
    };
  });

  await page.screenshot({ path: `${OUT}/B-workbench-1440-final.png` });
} catch (e) { out.fatal = String(e && e.stack ? e.stack : e); }
finally { fs.writeFileSync(`${OUT}/probe3-result.json`, JSON.stringify(out, null, 2)); await browser.close(); }
console.log('WROTE probe3-result.json');
