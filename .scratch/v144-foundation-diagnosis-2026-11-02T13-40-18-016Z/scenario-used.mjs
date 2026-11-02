// v1.41 #19：独立空 MySQL 库内的基础业务回放；由 launcher 提供环境并回收库。
// 唯一文件 fixture 只验证非空上下文和项目共享目录，不冒充用户确认后的产品产出。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.BASE_URL;
const output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0; let fail = 0;
const assertions = []; const workflows = []; const screenshots = [];
function check(name, okay) {
  assertions.push({ name, okay: Boolean(okay) });
  if (okay) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name}`); }
}
function requireOkay(name, okay) {
  check(name, okay);
  if (!okay) throw new Error(`关键事实不成立：${name}`);
}
async function api(page, path) {
  const response = await page.request.get(`${base}${path}`);
  if (!response.ok()) throw new Error(`GET ${path} 返回 ${response.status()}，停止此场景`);
  return response.json();
}
async function mutation(page, path, action, expected = 200) {
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() !== "GET");
  await action();
  const response = await pending;
  if (response.status() !== expected) throw new Error(`${response.request().method()} ${path} 返回 ${response.status()}，预期 ${expected}`);
  return response.json();
}
function stage(state, key) { return state.stages.find((item) => item.key === key); }
async function eventually(read, predicate, description) {
  const end = Date.now() + 15000;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < end);
  throw new Error(`等待超时：${description}`);
}

let browser; let connection; let page;
try {
  if (!base || !output || process.env.AI_MODE !== "replay") throw new Error("必须由基础回放 launcher 提供 BASE_URL、输出目录和 AI_MODE=replay");
  await mkdir(output, { recursive: true });
  const probe = await fetch(`${base}/api/verify/replay-mode`);
  requireOkay("发送聊天前确认服务端固定回放", probe.ok && (await probe.json()).aiMode === "replay");
  connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  });
  const [emptyUsers] = await connection.query("SELECT COUNT(*) AS total FROM users");
  requireOkay("浏览器回放开始前没有用户", Number(emptyUsers[0].total) === 0);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const prefix = `${viewport.width}×${viewport.height}`;
    const compact = viewport.width < 1100;
    const context = await browser.newContext({ viewport });
    // Next 开发指示器不是产品控件，避免它挡住移动端底部按钮。
    await context.addInitScript(() => {
      const insert = () => {
        if (!document.head || document.getElementById("verify-hide-next-indicator")) return;
        const style = document.createElement("style"); style.id = "verify-hide-next-indicator";
        style.textContent = "nextjs-portal { display: none !important; }"; document.head.appendChild(style);
      };
      new MutationObserver(insert).observe(document, { childList: true, subtree: true }); insert();
    });
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(120_000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const email = `verify-foundation-${viewport.width}-${randomUUID()}@test.local`;
    const password = "verify-pass-1234";
    const region = () => page.getByRole("navigation", { name: "工作台区域" });
    async function conversation() { if (compact) await region().getByRole("button", { name: "对话", exact: true }).click(); }
    async function sessions() { if (compact) await region().getByRole("button", { name: /阶段会话/ }).click(); }
    async function files() {
      if (compact) await region().getByRole("button", { name: /文件与上下文/ }).click();
      else if (await page.getByRole("button", { name: "展开文件区" }).isVisible()) await page.getByRole("button", { name: "展开文件区" }).click();
      await page.getByRole("tab", { name: /项目文件树/ }).click();
    }
    async function readyComposer() {
      await conversation();
      await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "会话加载完成并可输入");
    }
    async function snapshot(name) {
      const path = join(output, `foundation-${viewport.width}-${name}.png`);
      await page.screenshot({ path, animations: "disabled" }); screenshots.push(path);
    }
    const projectName = `基础回放项目 ${viewport.width}`;
    await page.goto(`${base}/register`);
    await page.fill("#email", email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('input[type="password"]').nth(1).fill(password);
    await mutation(page, "/api/auth/register", () => page.locator('form button[type="submit"]').click(), 201);
    await page.waitForURL((url) => url.pathname === "/projects");
    check(`${prefix} 正式注册成功进入项目页`, (await api(page, "/api/auth/session"))?.user?.email === email);
    await page.goto(`${base}/profile`);
    await page.getByRole("button", { name: /退出登录/ }).click();
    await page.waitForURL((url) => url.pathname === "/");
    check(`${prefix} 显式退出清除认证`, !(await api(page, "/api/auth/session"))?.user);
    await page.goto(`${base}/login`);
    await page.fill("#email", email); await page.fill("#password", password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((url) => url.pathname === "/projects");
    check(`${prefix} 原账号登录成功`, (await api(page, "/api/auth/session"))?.user?.email === email);
    await page.getByRole("button", { name: "新建一个项目", exact: true }).first().click();
    await page.getByRole("dialog", { name: "新建一个项目" }).getByRole("textbox").fill(projectName);
    const project = await mutation(page, "/api/projects", () => page.getByRole("button", { name: "创建项目", exact: true }).click(), 201);
    const projectId = project.id;
    const listPath = `/api/projects/${projectId}/iterations`;
    async function openCreate() {
      await page.getByRole("button", { name: "创建产品迭代", exact: true }).first().click();
      const drawer = page.getByRole("dialog", { name: "创建产品迭代", exact: true });
      await drawer.waitFor();
      check(`${prefix} 新建目标没有默认选项`, await drawer.getByRole("radio", { checked: true }).count() === 0);
      return drawer;
    }
    let drawer = await openCreate();
    await drawer.getByPlaceholder("例如：降低首次使用流失").fill("填写目标的第一轮");
    await drawer.getByText("填写本轮目标", { exact: true }).click();
    const goal = "明确校内闲置交易的基础范围";
    await drawer.getByPlaceholder("这一轮最想改变什么？").fill(goal);
    const first = await mutation(page, listPath, () => drawer.getByRole("button", { name: "创建并进入工作区" }).click(), 201);
    const firstRoute = `${base}/projects/${projectId}/iterations/${first.id}`;
    await page.waitForURL(firstRoute);
    check(`${prefix} 第一轮目标保存且稳定编号为 1`, first.goal === goal && first.iteration_number === 1);

    const statePath = '/api/iterations/' + first.id + '/workbench';
    const state = () => api(page, statePath);
    const legacy = page.getByRole('button', {name:'开始本阶段工作',exact:true});
    const replacement = page.getByRole('button', {name:'新建会话，开始这一阶段',exact:true});
    await replacement.waitFor();
    let legacyTimeout = '';
    try { await legacy.waitFor({state:'visible',timeout:1000}); }
    catch(error) { legacyTimeout = error.message.split('\n')[0]; }
    requireOkay(prefix + ' 复现原定位超时且旧按钮不存在', Boolean(legacyTimeout) && await legacy.count() === 0);
    requireOkay(prefix + ' 新空状态入口可见且可点击', await replacement.isVisible() && await replacement.isEnabled());
    const initial = await state();
    requireOkay(prefix + ' 初始四阶段未创建会话', initial.stages.length === 4 && initial.stages.every(item => item.sessions.length === 0 && item.status === 'not_started'));
    let mobileNavigation = null;
    if(compact) {
      mobileNavigation = {navigationVisible: await region().isVisible()};
      await sessions();
      const alternate = page.getByRole('button',{name:'新建会话',exact:true});
      mobileNavigation.sessionsReachable = await alternate.isVisible() && await alternate.isEnabled();
      await files();
      mobileNavigation.filesReachable = await page.getByRole('tab',{name:/项目文件树/}).isVisible();
      await conversation();
      mobileNavigation.conversationReachable = await replacement.isVisible();
      requireOkay(prefix + ' 原移动端区域切换路径仍然可用', Object.values(mobileNavigation).every(Boolean));
    }
    await snapshot('focused-before-create');
    const sessionPath = '/api/iterations/' + first.id + '/stages/analysis/sessions';
    const created = await mutation(page, sessionPath, () => replacement.click(), 201);
    await readyComposer();
    const after = await state();
    const analysis = stage(after,'analysis');
    requireOkay(prefix + ' 新入口成功创建真实会话并进入进行中', Boolean(created.session.id) && analysis.sessions.some(item=>item.id===created.session.id) && analysis.status==='in_progress');
    const [persisted] = await connection.execute('SELECT id FROM iteration_sessions WHERE id = ? AND iteration_id = ?',[created.session.id,first.id]);
    requireOkay(prefix + ' 会话已持久化且输入框可用', persisted.length===1 && await page.getByLabel('输入消息').isEnabled());
    await snapshot('focused-after-create');
    workflows.push({viewport,legacyTimeout,mobileNavigation,sessionCreated:true});
    await context.close();
  }
} catch(error) {
  check('定点核验中断：' + (error instanceof Error ? error.message : String(error)),false);
  if(page && output) await page.screenshot({path:join(output,'diagnosis-failure.png'),animations:'disabled'}).catch(()=>undefined);
} finally {
  if(browser) await browser.close();
  if(connection) await connection.end();
  if(output) await writeFile(join(output,'scenario-summary.json'),JSON.stringify({pass,fail,aiMode:'replay',workflows,screenshots,assertions},null,2));
}
process.exit(fail > 0 ? 1 : 0);
