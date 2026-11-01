// v1.43 只采集界面：临时本机账号，不调用模型；完成后清理本次数据。
import nextEnv from '@next/env';
import { chromium } from 'playwright-core';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd(), true);
if (!['localhost', '127.0.0.1', '::1'].includes(process.env.MYSQL_HOST)) throw new Error('仅允许本机数据库');
const { getMysqlPool, closeMysqlPoolForTests } = await import('../../src/lib/mysql.ts').catch(() => import('../../../src/lib/mysql.ts'));
const out = '.scratch/v1.43/evidence/private';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width:1440, height:900 }, reducedMotion:'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const email = `visual-v143-${randomUUID()}@test.local`;
const password = randomUUID();
let userId; let projectId; let iterationId;
const report = { captures:[], errors:[], cleanup:false };
page.on('pageerror', error => report.errors.push(error.message));
await page.addInitScript(() => {
  const observer = new MutationObserver(() => {
    if (document.head && !document.getElementById('audit-hide-dev')) {
      const style = document.createElement('style'); style.id='audit-hide-dev';
      style.textContent='nextjs-portal { display:none!important }'; document.head.append(style);
    }
  }); observer.observe(document, {childList:true,subtree:true});
});
async function capture(name) {
  await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'});
  report.captures.push({name,url:page.url(), geometry:await page.evaluate(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,fonts:document.fonts.status}))});
}
async function post(path, data) {
  const res=await page.request.post(`http://127.0.0.1:3000${path}`,{data});
  if (!res.ok()) throw new Error(`${path}: ${res.status()}`);
  return res.json();
}
try {
  const account = await post('/api/auth/register',{email,password}); userId=account.id;
  await page.goto('http://127.0.0.1:3000/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/projects');
  await page.getByRole('button',{name:'新建一个项目',exact:true}).first().waitFor();
  await capture('projects-empty-desktop');
  const project = await post('/api/projects',{name:'大学生 AI 学习助手'}); projectId=project.id;
  const iteration = await post(`/api/projects/${projectId}/iterations`,{displayName:'首次体验与核心流程',goal:'帮助新用户更快完成第一轮产品实践。'}); iterationId=iteration.id;
  await page.reload(); await page.getByRole('button',{name:'创建产品迭代',exact:true}).first().waitFor();
  await capture('projects-desktop');
  await page.getByRole('button',{name:'创建产品迭代',exact:true}).first().click();
  await page.getByRole('dialog').waitFor(); await capture('iteration-create-desktop');
  await page.keyboard.press('Escape');
  await page.goto(`http://127.0.0.1:3000/projects/${projectId}/iterations/${iterationId}`);
  await page.locator('.workbench-grid').waitFor();
  await page.waitForFunction(()=>!document.body.innerText.includes('正在加载工作台'));
  await capture('workbench-desktop');
  const start = page.getByRole('button',{name:'开始阶段会话',exact:true});
  if (await start.count()) { await start.click(); await page.locator('[aria-label="输入消息"]').waitFor(); await capture('workbench-session-desktop'); }
  await page.setViewportSize({width:390,height:844});
  await capture('workbench-mobile');
  await page.goto('http://127.0.0.1:3000/profile');
  await page.getByRole('heading',{name:'个人主页'}).waitFor();
  await capture('profile-mobile');
  await page.setViewportSize({width:1440,height:900}); await capture('profile-desktop');
} catch(error) { report.errors.push(error.message); }
finally {
  if(projectId) {
    const res=await page.request.delete(`http://127.0.0.1:3000/api/projects/${projectId}`);
    if(!res.ok()) report.errors.push(`临时项目清理失败: ${res.status()}`);
  }
  if(userId) {
    await getMysqlPool().execute('DELETE FROM users WHERE id = ? AND email = ?', [userId,email]);
    const [rows]=await getMysqlPool().execute('SELECT id FROM users WHERE id = ?', [userId]);
    report.cleanup=rows.length===0;
  }
  await browser.close(); await closeMysqlPoolForTests();
  await writeFile(`${out}/summary.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
