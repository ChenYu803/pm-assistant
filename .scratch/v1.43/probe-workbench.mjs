// Assessment B: mutation preflight + palette facts (read-only measurement pass)
import fs from 'node:fs';

const OUT = '.scratch/v1.43';
const WB = 'http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e';
const EXE = 'D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

const { chromium } = await import('playwright-core');

const result = { preflight: {}, palette: {}, overflow: {}, errors: [] };

const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ['--window-size=1460,1060'] });

try {
  const ctx = await browser.newContext({
    storageState: `${OUT}/auth-state.json`,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await ctx.newPage();
  const consoleAll = [];
  page.on('console', (m) => consoleAll.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => result.errors.push(String(e)));

  const resp = await page.goto(WB, { waitUntil: 'domcontentloaded', timeout: 60000 });
  result.preflight.status = resp?.status() ?? null;
  result.preflight.url = page.url();
  await page.waitForTimeout(3500);

  // ---- mutation preflight ----
  result.preflight.mutation = await page.evaluate(() => {
    const out = {};
    try {
      document.title = 'A-preflight';
      out.titleWrite = document.title === 'A-preflight';
      out.titleReadBack = document.title;
    } catch (e) { out.titleError = String(e); }
    try {
      const s = document.createElement('script');
      s.textContent = 'window.__aProbe = 42;';
      document.head.appendChild(s);
      out.scriptAppended = true;
      out.scriptRan = window.__aProbe === 42;
      s.remove();
    } catch (e) { out.scriptError = String(e); }
    try {
      const d = document.createElement('div');
      d.id = '__aProbeDiv';
      d.textContent = 'probe';
      document.body.appendChild(d);
      out.domAppended = !!document.getElementById('__aProbeDiv');
      d.remove();
    } catch (e) { out.domError = String(e); }
    return out;
  });

  result.preflight.csp = await page.evaluate(async () => {
    const metas = [...document.querySelectorAll('meta[http-equiv]')].map((m) => ({
      equiv: m.getAttribute('http-equiv'), content: m.getAttribute('content'),
    }));
    let scriptSrcLoaded = null;
    try {
      scriptSrcLoaded = await new Promise((res) => {
        const s = document.createElement('script');
        s.src = 'data:text/javascript,window.__aSrcProbe=7';
        s.onload = () => res(window.__aSrcProbe === 7);
        s.onerror = () => res(false);
        document.head.appendChild(s);
        setTimeout(() => res(false), 1500);
      });
    } catch (e) { scriptSrcLoaded = 'error:' + String(e); }
    return { metaHttpEquiv: metas, dataUriScriptExecuted: scriptSrcLoaded };
  });

  await page.screenshot({ path: `${OUT}/B-workbench-1440.png`, fullPage: false });

  // ---- palette facts ----
  result.palette = await page.evaluate(() => {
    const cs = (el, pseudo) => {
      if (!el) return null;
      const s = getComputedStyle(el, pseudo || null);
      return {
        color: s.color, backgroundColor: s.backgroundColor,
        borderColor: s.borderTopColor, borderWidth: s.borderTopWidth,
        borderStyle: s.borderTopStyle, fontFamily: s.fontFamily,
        fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight,
        opacity: s.opacity,
      };
    };
    const rgb = (el, prop, pseudo) => {
      if (!el) return null;
      return getComputedStyle(el, pseudo || null)[prop];
    };
    const out = {};

    // structural discovery of the workbench shell
    const shell = document.querySelector('.workbench-sessions')?.parentElement;
    out.shellClass = shell?.className ?? null;
    out.shellChildren = shell ? [...shell.children].map((c) => ({
      tag: c.tagName, cls: typeof c.className === 'string' ? c.className : '(non-string)',
      rect: { w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) },
    })) : null;

    // three zones
    const zones = {};
    const left = document.querySelector('.workbench-sessions');
    const mid = document.querySelector('.workbench-conversation')
      || document.querySelector('[class*="workbench-conversation"]')
      || [...(shell?.children ?? [])][1];
    const right = [...(shell?.children ?? [])].at(-1);
    zones.left = { selector: '.workbench-sessions', found: !!left, style: cs(left) };
    zones.middle = {
      selector: mid ? (mid.className || mid.tagName) : null, found: !!mid, style: cs(mid),
    };
    zones.right = {
      selector: right ? (typeof right.className === 'string' ? right.className : right.tagName) : null,
      found: !!right, style: cs(right),
    };
    out.zones = zones;

    // stage bar tabs
    const stageCandidates = [
      '.workbench-stage-bar [role="tab"]', '.workbench-stage [role="tab"]',
      '[class*="stage"] [role="tab"]', '[class*="stage-tab"]', '[class*="stage"] button',
    ];
    out.stageTabs = stageCandidates.map((sel) => {
      const els = [...document.querySelectorAll(sel)];
      return {
        selector: sel, count: els.length,
        samples: els.slice(0, 4).map((el) => ({
          text: (el.textContent || '').trim().slice(0, 24),
          cls: typeof el.className === 'string' ? el.className : '',
          ariaSelected: el.getAttribute('aria-selected'),
          disabled: el.disabled ?? null,
          style: cs(el),
        })),
      };
    }).filter((s) => s.count > 0);

    // stage status text
    out.stageStatus = [...document.querySelectorAll('[class*="stage-status"], [class*="status"], [data-stage-status]')]
      .slice(0, 8).map((el) => ({
        cls: typeof el.className === 'string' ? el.className : '',
        text: (el.textContent || '').trim().slice(0, 30),
        style: cs(el),
      }));

    // composer textarea + placeholder
    const ta = document.querySelector('.workbench-composer textarea') || document.querySelector('textarea');
    out.textarea = {
      selector: ta ? (ta.closest('.workbench-composer') ? '.workbench-composer textarea' : 'textarea') : null,
      found: !!ta,
      style: cs(ta),
      placeholderPseudo: cs(ta, '::placeholder'),
      placeholderAttr: ta?.getAttribute('placeholder') ?? null,
    };

    // disabled buttons
    out.disabledButtons = [...document.querySelectorAll('button:disabled, button[disabled], [aria-disabled="true"] button')]
      .slice(0, 8).map((el) => ({
        cls: typeof el.className === 'string' ? el.className : '',
        text: (el.textContent || '').trim().slice(0, 24),
        style: cs(el),
        childColor: el.firstElementChild ? cs(el.firstElementChild)?.color : null,
      }));

    // tokens on :root / body
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    out.tokens = {
      rootWorkAccent: rootStyle.getPropertyValue('--work-accent').trim(),
      rootWorkAccentStrong: rootStyle.getPropertyValue('--work-accent-strong').trim(),
      rootBg: rootStyle.getPropertyValue('--work-bg').trim(),
      rootSurface: rootStyle.getPropertyValue('--work-surface').trim(),
      rootText: rootStyle.getPropertyValue('--work-text').trim(),
      rootMuted: rootStyle.getPropertyValue('--work-muted').trim(),
      bodyColor: bodyStyle.color,
      bodyBackground: bodyStyle.backgroundColor,
      htmlColorScheme: rootStyle.colorScheme,
    };
    // every --work-* token actually defined
    const decls = {};
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules ?? []) {
        if (r.style && r.selectorText && /:root|html|body/.test(r.selectorText)) {
          for (const p of r.style) if (p.startsWith('--work-')) decls[p] = r.style.getPropertyValue(p).trim();
        }
      }
    }
    out.workTokenDeclarations = decls;
    return out;
  });

  // resolve computed accent color of an element using var(--work-accent)
  result.palette.accentResolved = await page.evaluate(() => {
    const out = { probe: null, elementsUsingAccent: [] };
    const probe = document.createElement('span');
    probe.style.color = 'var(--work-accent)';
    document.body.appendChild(probe);
    out.probe = getComputedStyle(probe).color;
    probe.remove();
    for (const el of document.querySelectorAll('*')) {
      const c = getComputedStyle(el).color;
      if (c === out.probe) {
        out.elementsUsingAccent.push({
          tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
          text: (el.textContent || '').trim().slice(0, 30),
        });
        if (out.elementsUsingAccent.length >= 10) break;
      }
    }
    return out;
  });

  result.consoleSample = consoleAll.slice(-25);

  // ---- overflow measurements ----
  const overflow = async (label, url, pw) => {
    const p = await pw.newPage();
    await p.setViewportSize({ width: 1440, height: 1000 });
    const r = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(2500);
    const m1440 = await p.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      url: location.href,
    }));
    await p.screenshot({ path: `${OUT}/B-${label}-1440.png` });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(1200);
    const m390 = await p.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      url: location.href,
    }));
    await p.screenshot({ path: `${OUT}/B-${label}-390.png` });
    await p.close();
    return { status: r?.status() ?? null, at1440: m1440, at390: m390 };
  };

  result.overflow.projects = await overflow('projects', 'http://localhost:3000/projects', ctx);
  result.overflow.workbench = await overflow('workbench-closed', WB, ctx);

  // anonymous login page
  const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  result.overflow.login = await overflow('login', 'http://localhost:3000/login', anon);
  await anon.close();
} catch (e) {
  result.fatal = String(e && e.stack ? e.stack : e);
} finally {
  fs.writeFileSync(`${OUT}/probe-result.json`, JSON.stringify(result, null, 2));
  await browser.close();
}
console.log('WROTE probe-result.json');
