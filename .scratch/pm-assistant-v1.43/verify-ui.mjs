import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const base = 'http://127.0.0.1:3001';
const out = '.scratch/pm-assistant-v1.43/evidence/after';
await mkdir(out, { recursive:true });
const browser = await chromium.launch({ channel:'msedge', headless:true });
const errors = [];
for (const [name, path, viewport, reduced] of [
  ['login-desktop','/login',{width:1440,height:900},false],
  ['register-mobile','/register',{width:390,height:844},false],
  ['brief-mobile-reduced','/onboarding/brief',{width:390,height:844},true],
  ['scene-mobile-reduced','/onboarding/scenes?scene=2',{width:390,height:844},true],
]) {
  const context = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(base + path, { waitUntil:'domcontentloaded', timeout:15000 });
  await page.waitForTimeout(500);
  if (name.startsWith('scene')) {
    const options = page.locator('[role="group"] button'); await options.first().waitFor(); await options.first().click({ force:true });
    await page.getByRole('button',{name:/提交我的判断/}).click({ force:true });
    await page.getByText('查看判断依据与答案',{exact:true}).waitFor({ timeout:8000 });
    await page.getByText('查看判断依据与答案',{exact:true}).click();
  }
  await page.screenshot({ path:`${out}/${name}.png`, fullPage:true, animations:'disabled' });
  const facts = await page.evaluate(() => ({ width:innerWidth, scrollWidth:document.documentElement.scrollWidth, hidden:[...document.querySelectorAll('*')].filter(e => getComputedStyle(e).opacity === '0').length, title:document.title }));
  console.log(name, JSON.stringify(facts));
  await context.close();
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
