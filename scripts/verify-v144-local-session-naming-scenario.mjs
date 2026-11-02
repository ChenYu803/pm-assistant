// 验证入口只使用浏览器和应用 API；模型行为从本机供应商 HTTP 请求观察。
import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";
import { requestRegistrationCode } from "./verify-email-fixture.mjs";
const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
const provider = process.env.V144_PROVIDER_ORIGIN;
const workflows = [];
let pass = 0;
let fail = 0;
function check(name, okay) { if (okay) { pass++; console.log('✅ ' + name); } else { fail++; throw new Error(name); } }
if (!base || !output || !/^http:\/\/127\.0\.0\.1:\d+$/.test(provider ?? "") || process.env.AI_MODE !== "replay") throw new Error("只能从隔离启动器运行");
await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(45000);
page.setDefaultNavigationTimeout(120000);
async function api(url, body, method = "POST") {
  const response = await page.request.fetch(base + url, { method, ...(body === undefined ? {} : { data: body }) });
  const text = await response.text();
  let resultBody = null;
  try { resultBody = text ? JSON.parse(text) : null; } catch { resultBody = text; }
  return { status: response.status(), body: resultBody };
}
let projectId;
let iterationId;
const sessionsPath = () => '/api/iterations/' + iterationId;
async function newSession(stage = "analysis") {
  const result = await api(sessionsPath() + '/stages/' + stage + '/sessions');
  check("通过 API 创建阶段会话", result.status === 201);
  return result.body.session.id;
}
async function readSession(id) { return (await api(sessionsPath() + '/sessions/' + id, undefined, "GET")).body; }
async function send(id, content, stage = "analysis") { return api(sessionsPath() + '/stages/' + stage + '/sessions/' + id + '/messages', { content }); }
async function requests() { return (await fetch(provider + '/requests')).json(); }
// 阶段证据单独落盘，避免 SSE 等待异常时只剩总运行器超时。
async function progress(phase) {
  await writeFile(join(output, 'scenario-progress.json'), JSON.stringify({ phase, pass, fail, workflows, updatedAt: new Date().toISOString() }, null, 2));
}
async function waitForWorkbenchReply(before) {
  await until(async () => (await requests()).length > before, '主回复没有到达本机 HTTP 供应商边界');
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('button.stop-generation-button'));
}
async function until(predicate, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(message);
}
try {
  await page.goto(base + '/register');
  await page.fill('#email', 'verify-v144-name-' + Date.now() + '@test.local');
  await page.locator('input[type="password"]').first().fill('verify-pass-1234');
  await page.locator('input[type="password"]').nth(1).fill('verify-pass-1234');
  await page.fill('#emailCode', await requestRegistrationCode(page.request, await page.inputValue('#email')));
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === '/projects');
  const project = await api('/api/projects', { name: '默认会话命名验证' });
  projectId = project.body.id;
  const iteration = await api('/api/projects/' + projectId + '/iterations', { displayName: '命名验证' });
  iterationId = iteration.body.id;
  check('用户注册并创建项目和迭代', project.status === 201 && iteration.status === 201);
  const id = await newSession();
  await page.goto(base + '/projects/' + projectId + '/iterations/' + iterationId);
  await page.locator('[data-session-id="' + id + '"]').click();
  await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('  Hello, 世界！后续正文');
  const firstRequestCount = (await requests()).length;
  await progress('first-browser-send');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await waitForWorkbenchReply(firstRequestCount);
  await progress('first-browser-reply-complete');
  const first = await readSession(id);
  check('浏览器发送后以原文前十字符命名并保留前导空格和标点', first.title === '  Hello, 世');
  await page.waitForFunction(() => document.querySelector('#conversation-title')?.textContent === '  Hello, 世');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#conversation-title')?.textContent === '  Hello, 世');
  check('刷新后会话标题与侧栏名称仍保留原文', await page.locator('[data-session-id="' + id + '"] strong').textContent() === '  Hello, 世');
  const renderedTitles = await page.evaluate((sessionId) => {
    const inspect = (element) => {
      const leading = document.createRange();
      leading.setStart(element.firstChild, 0);
      leading.setEnd(element.firstChild, 2);
      return { whiteSpace: getComputedStyle(element).whiteSpace, innerText: element.innerText, leadingSpaceWidth: leading.getBoundingClientRect().width };
    };
    return { sidebar: inspect(document.querySelector('[data-session-id="' + sessionId + '"] strong')), heading: inspect(document.querySelector('#conversation-title')) };
  }, id);
  await writeFile(join(output, 'first-title-rendering.json'), JSON.stringify(renderedTitles, null, 2));
  for (const [location, evidence] of Object.entries(renderedTitles)) {
    check('刷新后原文前导空格可见且 CSS 未被旧规则覆盖：' + location + ' ' + JSON.stringify(evidence), evidence.whiteSpace === 'pre' && evidence.innerText === '  Hello, 世' && evidence.leadingSpaceWidth > 0);
  }
  await progress('first-browser-title-persisted');
  const cases = [
    ['这是中文提示词用于命名测试', '这是中文提示词用于命'],
    ['abcdefghijklm', 'abcdefghij'],
    ['你好！', '你好！'],
    ['  !?，。abcdef后续', '  !?，。abcd'],
    ['😀😃😄😁😆😅😂🙂🙃😉后续', '😀😃😄😁😆😅😂🙂🙃😉'],
    ['👨‍👩‍👧‍👦123456789后续', '👨‍👩‍👧‍👦123456789'],
    ['é123456789后续', 'é123456789'],
    ['𠮷123456789后续', '𠮷123456789'],
    ['          后续正文', '          '],
    ['新会话', '新会话'],
  ];
  for (const [prompt, expected] of cases) {
    const sessionId = await newSession();
    const before = (await requests()).length;
    await progress('raw-prompt:' + JSON.stringify(prompt));
    const sent = await send(sessionId, prompt);
    check('首条提示词按完整字符命名：' + JSON.stringify(prompt), sent.status === 200 && (await readSession(sessionId)).title === expected);
    const history = await api(sessionsPath() + '/stages/analysis/sessions/' + sessionId + '/messages', undefined, 'GET');
    check('保存的首条用户提示词保留原文', history.body.messages.find((message) => message.role === 'user')?.content === prompt);
    const firstRequests = await requests();
    check('供应商 HTTP 边界只收到一次主回复请求', firstRequests.length === before + 1 && firstRequests.at(-1).stream === true && firstRequests.at(-1).messages.at(-1).content === prompt);
    check('后续提示词不反复命名', (await send(sessionId, '这是一条不会改变名称的后续提示词')).status === 200 && (await readSession(sessionId)).title === expected);
  }
  for (const stage of ['prototype', 'prd', 'tickets']) {
    const sessionId = await newSession(stage);
    check('四环阶段统一使用首条提示词规则：' + stage, (await send(sessionId, '1234567890后续', stage)).status === 200 && (await readSession(sessionId)).title === '1234567890');
  }
  const history = await api(sessionsPath() + '/stages/analysis/sessions/' + id + '/messages', undefined, 'GET');
  const originalUser = history.body.messages.find((message) => message.role === 'user');
  const edited = await api(sessionsPath() + '/sessions/' + id + '/messages/' + originalUser.id, { content: '编辑首条消息不改名' }, 'PATCH');
  check('编辑首条消息后保持已经确定的名称', edited.status === 200 && (await readSession(id)).title === '  Hello, 世');
  const regenerateId = edited.body.assistantMessage.id;
  check('重新生成后名称不变', (await api(sessionsPath() + '/stages/analysis/sessions/' + id + '/messages', { regenerateMessageId: regenerateId })).status === 200 && (await readSession(id)).title === '  Hello, 世');
  workflows.push('raw-first-prompt');
  await progress('raw-first-prompt');

  for (const manualTitle of ['已有人工名称', '新会话']) {
    const sessionId = await newSession();
    const renamed = await api(sessionsPath() + '/sessions/' + sessionId, { title: manualTitle }, 'PATCH');
    check('首条消息之前人工命名优先：' + manualTitle, renamed.status === 200 && (await send(sessionId, '不应该覆盖人工名称的第一条消息')).status === 200 && (await readSession(sessionId)).title === manualTitle);
  }
  await api(sessionsPath() + '/workbench', { stage: 'analysis', sessionId: id }, 'PATCH');
  await page.reload();
  await page.locator('[data-session-id="' + id + '"]').click();
  await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('本轮回复期间我要手动改名');
  await fetch(provider + '/hold');
  const requestCount = (await requests()).length;
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await until(async () => (await requests()).length === requestCount + 1, '主回复没有到达模型 HTTP 边界');
  await page.getByRole('button', { name: '修改会话名称', exact: true }).click();
  await page.getByRole('textbox', { name: '会话名称', exact: true }).fill('生成期间人工名称');
  const renamedDuring = page.waitForResponse((response) => response.url().endsWith('/sessions/' + id) && response.request().method() === 'PATCH');
  await page.getByRole('textbox', { name: '会话名称', exact: true }).press('Enter');
  check('生成期间人工改名 API 保存成功', (await renamedDuring).status() === 200);
  await page.waitForFunction(() => document.querySelector('#conversation-title')?.textContent === '生成期间人工名称');
  check('生成进行中可通过界面保存人工名称', (await readSession(id)).title === '生成期间人工名称');
  await fetch(provider + '/release');
  await waitForWorkbenchReply(requestCount);
  await page.waitForFunction(() => !document.querySelector('button.stop-generation-button'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#conversation-title')?.textContent === '生成期间人工名称');
  check('迟到回复和刷新不覆盖生成期间的人工改名', (await readSession(id)).title === '生成期间人工名称');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '修改会话名称', exact: true }).click();
  await page.getByRole('textbox', { name: '会话名称', exact: true }).fill('未保存的名称');
  await page.screenshot({ path: join(output, 'session-rename-mobile.png'), fullPage: true });
  check('窄屏改名表单无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole('textbox', { name: '会话名称', exact: true }).press('Escape');
  check('Escape 取消且焦点回到改名按钮', await page.getByRole('button', { name: '修改会话名称', exact: true }).evaluate((button) => button === document.activeElement) && (await readSession(id)).title === '生成期间人工名称');
  await page.setViewportSize({ width: 1440, height: 900 });
  workflows.push('manual-name-race');
  await progress('manual-name-race');

  const beforeInvalid = (await requests()).length;
  check('空白消息被拒绝且没有模型请求', (await send(id, '   ')).status === 400 && (await requests()).length === beforeInvalid);
  check('空名称被拒绝', (await api(sessionsPath() + '/sessions/' + id, { title: '   ' }, 'PATCH')).status === 400);
  check('超长人工名称被拒绝', (await api(sessionsPath() + '/sessions/' + id, { title: '名'.repeat(81) }, 'PATCH')).status === 400);
  const anonymous = await fetch(base + sessionsPath() + '/sessions/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '越权名称' }), redirect: 'manual' });
  check('未登录无法修改会话名称', anonymous.status === 401);
  const outsider = await browser.newPage();
  try {
    await outsider.goto(base + '/register', { timeout: 120000 });
    await outsider.fill('#email', 'verify-v144-outsider-' + Date.now() + '@test.local');
    await outsider.locator('input[type="password"]').first().fill('verify-pass-1234');
    await outsider.locator('input[type="password"]').nth(1).fill('verify-pass-1234');
    await outsider.fill('#emailCode', await requestRegistrationCode(outsider.request, await outsider.inputValue('#email')));
    await outsider.locator('form button[type="submit"]').click();
    await outsider.waitForURL((url) => url.pathname === '/projects');
    const denied = await outsider.request.patch(base + sessionsPath() + '/sessions/' + id, { data: { title: '越权名称' } });
    check('其他账号无法改名且原名不变', denied.status() === 404 && (await readSession(id)).title === '生成期间人工名称');
  } finally { await outsider.close(); }
  const iterationTwo = await api('/api/projects/' + projectId + '/iterations', { displayName: '归属检查' });
  check('不能通过其他迭代路径修改会话', (await api('/api/iterations/' + iterationTwo.body.id + '/sessions/' + id, { title: '错误归属' }, 'PATCH')).status === 404);
  workflows.push('rename-authorization');
  await progress('rename-authorization');

  const legacyProject = await api('/api/projects', { name: '已有资料与旧入口检查' });
  const record = await api('/api/projects/' + legacyProject.body.id + '/work-records', {});
  const recordId = record.body.id;
  const tab = await api('/api/work-records/' + recordId + '/tabs', { agent_type: 'requirement_analyst' });
  check('旧资料与需求分析 tab 创建成功', legacyProject.status === 201 && record.status === 201 && tab.status === 201 && typeof tab.body.tab?.id === 'string');
  const legacyTabId = tab.body.tab.id;
  const legacyTabs = await api('/api/work-records/' + recordId + '/tabs', undefined, 'GET');
  check('旧 tab 可从所属资料重新读取', legacyTabs.status === 200 && legacyTabs.body.some((item) => item.id === legacyTabId && item.agent_type === 'requirement_analyst'));
  await progress('legacy-tab-created');
  const legacyBefore = (await requests()).length;
  await page.goto(base + '/workspace/' + recordId);
  const legacyTab = page.getByRole('tab').filter({ hasText: tab.body.tab.display_name });
  await legacyTab.click();
  check('旧页面已选中刚创建的 tab', await legacyTab.getAttribute('aria-selected') === 'true');
  const legacyInput = page.getByPlaceholder('输入消息，Enter 发送，Shift+Enter 换行...');
  for (const prompt of ['旧入口首条提示词', '旧入口后续提示词']) {
    await legacyInput.fill(prompt);
    const beforeReply = (await requests()).length;
    await legacyInput.press('Enter');
    await until(async () => (await requests()).length > beforeReply, '旧入口主回复没有到达本机供应商');
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ state: 'visible' });
  }
  const legacyRequests = (await requests()).slice(legacyBefore);
  check('旧聊天浏览器两次发送只有两次主回复，没有隐藏命名请求', legacyRequests.length === 2 && legacyRequests.every((request) => request.stream === true));
  check('撤除命名不重命名已有迭代资料', (await api('/api/work-records/' + recordId, undefined, 'GET')).body.name === '未命名');
  const legacyRename = await api('/api/work-records/' + recordId, { name: '已有资料人工名称' }, 'PATCH');
  check('旧资料仍可人工改名并持久保存', legacyRename.status === 200 && (await api('/api/work-records/' + recordId, undefined, 'GET')).body.name === '已有资料人工名称');
  check('旧模型命名 API 与验证后门均已撤除', (await api('/api/work-records/' + recordId + '/auto-name', { tabId: legacyTabId })).status === 404 && (await api('/api/verify/conditional-auto-naming', { workRecordId: recordId, name: '迟到名称' })).status === 404);
  check('供应商只观察到主回复，没有摘要命名请求', (await requests()).every((request) => request.stream === true));
  workflows.push('legacy-no-hidden-naming');
  await progress('legacy-no-hidden-naming');
} catch (error) { if (!fail) fail++; await progress('failed'); console.error('❌ ' + (error.stack ?? error.message)); }
finally {
  await page.screenshot({ path: join(output, 'session-naming.png'), fullPage: true }).catch(() => {});
  await fetch(provider + '/release').catch(() => {});
  await browser.close();
  await writeFile(join(output, 'scenario-summary.json'), JSON.stringify({ pass, fail, aiMode: 'replay', workflows }, null, 2));
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
}
process.exit(fail > 0 ? 1 : 0);
