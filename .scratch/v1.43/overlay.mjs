// Assessment B: overlay injection with console capture
import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';

const OUT = '.scratch/v1.43';
const WB = 'http://localhost:3000/projects/742e6b94-4638-4c25-80e7-9b66fac56d0b/iterations/019a722c-b732-4281-b785-2df18008f54e';
const EXE = 'D:/DevCache/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const CLI = '"C:/Users/Administrator/.agents/skills/impeccable/scripts/impeccable.cmd"';
const { chromium } = await import('playwright-core');

const out = { steps: [] };
const log = (k, v) => { out.steps.push({ step: k, ...v }); console.log('STEP', k, JSON.stringify(v)); };

// 1. start live-server in background with an explicit port (background mode keeps
// stdout open, so a blocking execSync never returns; explicit port removes the guesswork)
const PORT = 8411;
let startOut = null;
try {
  startOut = execSync(`${CLI} live-server --background --port=${PORT}`, { encoding: 'utf8', timeout: 25000 });
  out.startStdout = startOut;
} catch (e) {
  // ETIMEDOUT is expected here: the detached server holds stdout open.
  out.startError = { message: String(e.message), stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  out.startStdout = String(e.stdout || '');
}
console.log('LIVE-SERVER START:', JSON.stringify(out.startStdout || out.startError));

const m = (out.startStdout || '').match(/"port"\s*:\s*(\d+)/) || (out.startStdout || '').match(/localhost:(\d+)/);
const port = m ? Number(m[1]) : null;
out.port = port;
log('port', { port, declaredPort: PORT });

const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ['--window-size=1460,1060'] });
try {
  const ctx = await browser.newContext({ storageState: `${OUT}/auth-state.json`, viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const consoleMsgs = [];
  page.on('console', (msg) => consoleMsgs.push({ type: msg.type(), text: msg.text(), loc: msg.location() }));
  page.on('pageerror', (e) => consoleMsgs.push({ type: 'pageerror', text: String(e) }));

  await page.goto(WB, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // 2. preflight again in this tab
  out.preflight = await page.evaluate(() => {
    const r = {};
    document.title = 'A-preflight';
    r.titleOk = document.title === 'A-preflight';
    const s = document.createElement('script');
    s.textContent = 'window.__ap = 1;';
    document.head.appendChild(s);
    r.inlineScriptRan = window.__ap === 1;
    s.remove();
    return r;
  });
  log('preflight', out.preflight);

  if (port && out.preflight.inlineScriptRan) {
    // 3. inject detect.js
    const detectUrl = `http://localhost:${port}/detect.js`;
    out.injectUrl = detectUrl;
    // confirm server reachable first
    const health = await page.evaluate(async (u) => {
      try { const r = await fetch(u, { cache: 'no-store' }); return { ok: r.ok, status: r.status, len: (await r.text()).length }; }
      catch (e) { return { error: String(e) }; }
    }, detectUrl);
    log('detectjs-fetch', health);
    out.detectJsFetch = health;

    await page.evaluate((u) => {
      const s = document.createElement('script');
      s.id = 'impeccable-detect-injected';
      s.src = u;
      s.onload = () => console.log('impeccable:detect.js loaded');
      s.onerror = (e) => console.log('impeccable:detect.js FAILED ' + u);
      document.head.appendChild(s);
    }, detectUrl);

    await page.waitForTimeout(3500); // wait 2-3s+ for overlay to run
    await page.screenshot({ path: `${OUT}/B-workbench-overlay-1440.png` });

    // collect overlay artifacts in DOM
    out.overlayDom = await page.evaluate(() => {
      const sel = ['#impeccable-overlay', '[data-impeccable]', '[class*="impeccable"]', '#impeccable-detect-injected'];
      const found = {};
      for (const s of sel) found[s] = document.querySelectorAll(s).length;
      const bodyChildren = [...document.body.children].map((c) => ({
        tag: c.tagName, id: c.id || null, cls: typeof c.className === 'string' ? c.className.slice(0, 50) : null,
      }));
      return { counts: found, bodyChildren };
    });
    log('overlayDom', out.overlayDom);
  } else {
    log('overlay-skipped', { reason: !port ? 'no port from live-server' : 'mutation preflight failed' });
  }

  out.consoleAll = consoleMsgs.map((c) => ({ type: c.type, text: c.text }));
  out.consoleImpeccable = consoleMsgs.filter((c) => /impeccable/i.test(c.text) || /impeccable/i.test(c.loc?.url || ''));
  log('console-impeccable', { count: out.consoleImpeccable.length, sample: out.consoleImpeccable.slice(0, 25) });
} catch (e) {
  out.fatal = String(e && e.stack ? e.stack : e);
  console.log('FATAL', out.fatal);
} finally {
  await browser.close();
  // 4. always stop the server
  try {
    out.stopResult = spawnSync(CLI.replace(/"/g, ''), ['live-server', 'stop', '--keep-inject'], { encoding: 'utf8', timeout: 60000, shell: true });
    out.stopOutput = String(out.stopResult.stdout || '') + String(out.stopResult.stderr || '');
    out.stopExit = out.stopResult.status;
  } catch (e) {
    out.stopError = String(e);
  }
  console.log('STOP:', out.stopExit, out.stopOutput);
  fs.writeFileSync(`${OUT}/overlay-result.json`, JSON.stringify(out, null, 2));
}
console.log('WROTE overlay-result.json');
