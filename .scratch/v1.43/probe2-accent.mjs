// Assessment B: accent/token resolution + disabled-state detail pass
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

  out.tokens = await page.evaluate(() => {
    const scope = document.querySelector('.iteration-workbench');
    const s = scope ? getComputedStyle(scope) : null;
    const names = ['--work-paper', '--work-bone', '--work-ink', '--work-type', '--work-panel', '--work-surface', '--work-muted', '--work-line', '--work-coral', '--work-accent', '--work-focus', '--work-success'];
    const declared = {};
    for (const n of names) declared[n] = s ? s.getPropertyValue(n).trim() : null;
    // resolve accent to concrete rgb via a probe inside the scope
    let accentRgb = null;
    if (scope) {
      const p = document.createElement('span');
      p.style.color = 'var(--work-accent)';
      scope.appendChild(p);
      accentRgb = getComputedStyle(p).color;
      p.remove();
    }
    return { scopeFound: !!scope, declared, accentRgbOnScope: accentRgb };
  });

  // elements that actually render accent text
  out.accentUsage = await page.evaluate(() => {
    const accent = (() => {
      const scope = document.querySelector('.iteration-workbench');
      const p = document.createElement('span');
      p.style.color = 'var(--work-accent)';
      scope.appendChild(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    })();
    const hits = [];
    for (const el of document.querySelectorAll('.iteration-workbench *')) {
      const s = getComputedStyle(el);
      if (s.color === accent && (el.textContent || '').trim()) {
        hits.push({
          tag: el.tagName,
          cls: typeof el.className === 'string' ? el.className.slice(0, 70) : '',
          text: (el.textContent || '').trim().slice(0, 28),
          fontSize: s.fontSize, fontWeight: s.fontWeight,
          opacity: s.opacity,
        });
      }
      if (hits.length >= 14) break;
    }
    return { accentRgb: accent, hits };
  });

  // full disabled inventory with opacity + effective color
  out.disabled = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.iteration-workbench button')].filter(
      (b) => b.disabled || b.getAttribute('aria-disabled') === 'true',
    );
    return list.map((b) => {
      const s = getComputedStyle(b);
      // walk ancestors for opacity that actually dims rendered text
      let op = 1, node = b;
      while (node && node !== document.documentElement) {
        op *= parseFloat(getComputedStyle(node).opacity || '1');
        node = node.parentElement;
      }
      return {
        text: (b.textContent || '').trim().slice(0, 20),
        cls: typeof b.className === 'string' ? b.className.slice(0, 60) : '',
        disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'),
        selfOpacity: s.opacity, effectiveOpacity: op,
        color: s.color, bg: s.backgroundColor, borderColor: s.borderTopColor,
        borderWidth: s.borderTopWidth, cursor: s.cursor, fontSize: s.fontSize, fontWeight: s.fontWeight,
      };
    });
  });

  // borders of the three zones: where does the 1px come from?
  out.zoneBorders = await page.evaluate(() => {
    const zones = { '.workbench-sessions': '.workbench-sessions', '.workbench-conversation': '.workbench-conversation', '.workbench-context': '.workbench-context' };
    const res = {};
    for (const [k, sel] of Object.entries(zones)) {
      const el = document.querySelector(sel);
      if (!el) { res[k] = null; continue; }
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      res[k] = {
        bg: s.backgroundColor, color: s.color,
        borderTop: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        borderRight: `${s.borderRightWidth} ${s.borderRightStyle} ${s.borderRightColor}`,
        borderBottom: `${s.borderBottomWidth} ${s.borderBottomStyle} ${s.borderBottomColor}`,
        borderLeft: `${s.borderLeftWidth} ${s.borderLeftStyle} ${s.borderLeftColor}`,
        boxShadow: s.boxShadow,
        rect: { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) },
      };
    }
    return res;
  });

  // stage bar geometry + all tabs incl. 5th
  out.stageTabs = await page.evaluate(() => {
    const bar = document.querySelector('.workbench-stage-bar') || document.querySelector('[class*="stage-bar"]');
    const tabs = [...document.querySelectorAll('.workbench-stage')];
    return {
      barFound: !!bar,
      barCls: bar ? bar.className : null,
      count: tabs.length,
      tabs: tabs.map((t) => {
        const s = getComputedStyle(t);
        return {
          text: (t.textContent || '').trim().slice(0, 26),
          cls: t.className, cursor: s.cursor,
          color: s.color, bg: s.backgroundColor,
          borderBottom: `${s.borderBottomWidth} ${s.borderBottomStyle} ${s.borderBottomColor}`,
          fontSize: s.fontSize, fontWeight: s.fontWeight, opacity: s.opacity,
          ariaSelected: t.getAttribute('aria-selected'),
        };
      }),
    };
  });

  await page.screenshot({ path: `${OUT}/B-workbench-full-1440.png`, fullPage: true });
} catch (e) {
  out.fatal = String(e && e.stack ? e.stack : e);
} finally {
  fs.writeFileSync(`${OUT}/probe2-result.json`, JSON.stringify(out, null, 2));
  await browser.close();
}
console.log('WROTE probe2-result.json');
