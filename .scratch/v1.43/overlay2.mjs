// Assessment B: overlay run 2 - resolve each console finding to a concrete element
import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
const OUT = '.scratch/v1.43';
const WB = 'http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e';
const EXE = 'D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const CLI = '"C:/Users/Administrator/.agents/skills/impeccable/scripts/impeccable.cmd"';
const PORT = 8412;
const { chromium } = await import('playwright-core');

const out = {};
try {
  out.startStdout = execSync(`${CLI} live-server --background --port=${PORT}`, { encoding: 'utf8', timeout: 20000 });
} catch (e) { out.startStdout = String(e.stdout || ''); out.startErr = String(e.message); }
console.log('START:', out.startStdout);

const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ['--window-size=1460,1060'] });
const findings = [];
try {
  const ctx = await browser.newContext({ storageState: `${OUT}/auth-state.json`, viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('console', async (msg) => {
    const text = msg.text();
    if (!/low-contrast|anti-pattern|impeccable/i.test(text)) return;
    const rec = { type: msg.type(), text };
    try {
      const args = msg.args();
      rec.argCount = args.length;
      // last arg is typically the offending node
      for (let i = args.length - 1; i >= 0; i--) {
        const a = args[i];
        const info = await a.evaluate((el) => {
          if (!el || el.nodeType !== 1) return null;
          const s = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const path = [];
          let n = el;
          while (n && n.nodeType === 1 && path.length < 4) {
            path.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
            n = n.parentElement;
          }
          // effective background: walk up until non-transparent
          let bgNode = el, bg = s.backgroundColor, depth = 0;
          while (bgNode && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && depth < 8) {
            bgNode = bgNode.parentElement;
            if (bgNode) { bg = getComputedStyle(bgNode).backgroundColor; depth++; }
          }
          return {
            sel: path.join(' > '),
            tag: el.tagName, cls: typeof el.className === 'string' ? el.className : '',
            text: (el.textContent || '').trim().slice(0, 40),
            color: s.color, bg, effectiveBgFrom: bgNode ? (bgNode.className || bgNode.tagName) : null,
            fontSize: s.fontSize, fontWeight: s.fontWeight,
            disabled: el.disabled ?? null,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            visible: rect.width > 0 && rect.height > 0,
          };
        }).catch(() => null);
        if (info) { rec.element = info; break; }
      }
    } catch (e) { rec.argErr = String(e.message).slice(0, 120); }
    findings.push(rec);
  });

  await page.goto(WB, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate((u) => {
    const s = document.createElement('script');
    s.src = u;
    s.id = 'impeccable-detect-injected';
    document.head.appendChild(s);
  }, `http://localhost:${PORT}/detect.js`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/B-overlay-full-1440.png` });

  // also capture overlay panel text (the visible card list)
  out.overlayPanelText = await page.evaluate(() => [...document.querySelectorAll('.impeccable-overlay')].map((d) => (d.innerText || '').slice(0, 1200)));
  out.overlayHtml = await page.evaluate(() => {
    const d = document.querySelector('.impeccable-overlay');
    return d ? d.outerHTML.slice(0, 2500) : null;
  });
} catch (e) { out.fatal = String(e && e.stack ? e.stack : e); }
finally {
  await browser.close();
  const stop = spawnSync(CLI.replace(/"/g, ''), ['live-server', 'stop', '--keep-inject'], { shell: true, encoding: 'utf8', timeout: 60000 });
  out.stopped = { exit: stop.status, output: String(stop.stdout || '') + String(stop.stderr || '') };
  out.findings = findings;
  fs.writeFileSync(`${OUT}/overlay2-result.json`, JSON.stringify(out, null, 2));
}
console.log('STOPPED:', JSON.stringify(out.stopped));
console.log('findings:', findings.length);
for (const f of findings) console.log(JSON.stringify(f));
