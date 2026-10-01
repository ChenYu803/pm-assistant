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
    await page.getByRole("link", { name: "返回迭代管理" }).click();
    drawer = await openCreate();
    await drawer.getByPlaceholder("例如：降低首次使用流失").fill("暂不填目标的第二轮");
    await drawer.getByText("填写本轮目标", { exact: true }).click();
    const draftGoal = "返回后需要保留的目标草稿";
    await drawer.getByPlaceholder("这一轮最想改变什么？").fill(draftGoal);
    await drawer.getByText("暂不填写", { exact: true }).click();
    const risk = page.getByRole("dialog", { name: "暂不填写本轮目标？", exact: true });
    await risk.waitFor();
    check(`${prefix} 暂不填写先明确展示已知与未知边界`, await risk.getByText("Agent 已知", { exact: true }).isVisible() && await risk.getByText("Agent 未知", { exact: true }).isVisible());
    await risk.getByRole("button", { name: "返回重新选择" }).click();
    check(`${prefix} 风险返回保留选择与名称`, await drawer.getByRole("radio", { name: /暂不填写/ }).isChecked() && await drawer.getByPlaceholder("例如：降低首次使用流失").inputValue() === "暂不填目标的第二轮");
    await drawer.getByText("填写本轮目标", { exact: true }).click();
    check(`${prefix} 风险返回保留目标草稿`, await drawer.getByPlaceholder("这一轮最想改变什么？").inputValue() === draftGoal);
    await drawer.getByText("暂不填写", { exact: true }).click();
    await risk.getByRole("button", { name: "确认暂不填写" }).click();
    // 再切换一次选项，证明确认在本次创建中生效且不会重复弹窗。
    await drawer.getByText("填写本轮目标", { exact: true }).click();
    await drawer.getByText("暂不填写", { exact: true }).click();
    check(`${prefix} 确认后本次创建不重复警告`, !await risk.isVisible());
    const second = await mutation(page, listPath, () => drawer.getByRole("button", { name: "创建并进入工作区" }).click(), 201);
    await page.waitForURL(`${base}/projects/${projectId}/iterations/${second.id}`);
    check(`${prefix} 第二轮目标为空且编号递增`, second.goal === null && second.iteration_number === 2);
    await page.getByRole("link", { name: "返回迭代管理" }).click();
    const firstRow = page.getByRole("listitem").filter({ hasText: "填写目标的第一轮" });
    await firstRow.getByRole("button", { name: "编辑迭代" }).click();
    const edit = page.getByRole("dialog", { name: "编辑产品迭代" });
    check(`${prefix} 稳定编号展示为只读`, await edit.getByLabel("稳定编号").isDisabled());
    await edit.getByPlaceholder("例如：降低首次使用流失").fill("第一轮更名后");
    const renamed = await mutation(page, `/api/iterations/${first.id}`, () => edit.getByRole("button", { name: "保存修改" }).click());
    check(`${prefix} 展示名称可改且稳定编号不变`, renamed.display_name === "第一轮更名后" && renamed.iteration_number === 1);
    await page.getByRole("listitem").filter({ hasText: "第一轮更名后" }).getByRole("button", { name: "进入工作区" }).click();
    await page.waitForURL(firstRoute);
    const statePath = `/api/iterations/${first.id}/workbench`;
    const state = () => api(page, statePath);
    await page.getByRole("button", { name: "开始本阶段工作" }).waitFor();
    const initial = await state();
    check(`${prefix} 四环初始未开始且无会话`, initial.stages.length === 4 && initial.stages.every((item) => item.status === "not_started" && item.sessions.length === 0));
    const nav = page.getByRole("region", { name: "四环阶段导航" });
    for (const label of ["需求分析", "原型设计", "PRD", "任务拆分"]) check(`${prefix} ${label}一级导航可见`, await nav.getByRole("button", { name: new RegExp(label) }).isVisible());
    await nav.getByRole("button", { name: /PRD/ }).click();
    await page.getByRole("button", { name: "返回需求分析", exact: true }).click();
    check(`${prefix} 跳过前置环节的提示允许返回`, (await state()).currentStage === "analysis");
    for (const [label, key] of [["任务拆分", "tickets"], ["原型设计", "prototype"], ["PRD", "prd"]]) {
      await mutation(page, statePath, async () => {
        await nav.getByRole("button", { name: new RegExp(label) }).click();
        await page.getByRole("button", { name: `继续进入${label}`, exact: true }).click();
      });
      check(`${prefix} 可直接进入空${label}`, (await state()).currentStage === key && await page.getByRole("button", { name: "开始本阶段工作" }).isVisible());
    }
    await mutation(page, statePath, () => nav.getByRole("button", { name: /需求分析/ }).click());
    const afterNavigation = await state();
    const [emptyFiles] = await connection.execute("SELECT COUNT(*) AS total FROM project_files WHERE project_id = ?", [projectId]);
    requireOkay(`${prefix} 空阶段来回导航不建会话、不变状态、不写文件`, afterNavigation.stages.every((item) => item.sessions.length === 0 && item.status === "not_started") && Number(emptyFiles[0].total) === 0);
    await snapshot("empty-navigation");
    const sessionPath = `/api/iterations/${first.id}/stages/analysis/sessions`;
    const created = await mutation(page, sessionPath, () => page.getByRole("button", { name: "开始本阶段工作" }).click(), 201);
    const firstSession = created.session;
    await page.locator(`[data-session-id="${firstSession.id}"][aria-current="page"]`).waitFor({ state: "attached" });
    await readyComposer();
    check(`${prefix} 显式创建会话进入进行中`, stage(await state(), "analysis").status === "in_progress");
    await mutation(page, `/api/iterations/${first.id}/stages/analysis/complete`, () => page.getByRole("button", { name: "完成本阶段", exact: true }).click());
    await page.getByRole("button", { name: "重新打开阶段" }).waitFor();
    requireOkay(`${prefix} 零写入也能完成阶段`, stage(await state(), "analysis").status === "completed" && (await api(page, `/api/projects/${projectId}/files`)).length === 0);
    await page.reload(); await conversation();
    await page.getByRole("button", { name: "重新打开阶段" }).waitFor();
    check(`${prefix} 刷新保持完成状态和输入锁定`, stage(await state(), "analysis").status === "completed" && await page.getByLabel("输入消息").isDisabled());
    await mutation(page, statePath, () => page.getByRole("button", { name: "重新打开阶段" }).click());
    await readyComposer();
    check(`${prefix} 显式重新打开恢复进行中`, stage(await state(), "analysis").status === "in_progress");
    // 在所有空导航与零写入断言通过后，才建立非空目录/上下文夹具。
    const fixtureId = randomUUID(); const filename = "需求分析-基础回放上下文夹具.md";
    const fixtureContent = "# 上下文隔离夹具\n\n只用于证明项目目录共享和会话引用独立，不是产品成果写入验收。";
    await connection.execute("INSERT INTO project_files (id, project_id, filename, content, version) VALUES (?, ?, ?, ?, 1)", [fixtureId, projectId, filename, fixtureContent]);
    console.log(`夹具说明：${prefix} 插入一份正式命名 Markdown，仅用于非空上下文与共享目录验收。`);
    await page.reload(); await readyComposer();
    await files();
    await page.getByRole("button", { name: `加入当前上下文：${filename}`, exact: true }).waitFor();
    await mutation(page, `/api/iterations/${first.id}/stages/analysis/sessions/${firstSession.id}/context`, () => page.getByRole("button", { name: `加入当前上下文：${filename}`, exact: true }).click());
    await conversation();
    const firstMessage = `会话一独立消息 ${viewport.width}`;
    await page.getByLabel("输入消息").fill(firstMessage);
    await mutation(page, `${sessionPath}/${firstSession.id}/messages`, () => page.getByRole("button", { name: "发送消息", exact: true }).click());
    await readyComposer();
    const firstDraft = "会话一未发送草稿";
    await page.getByLabel("输入消息").fill(firstDraft);
    await sessions();
    const secondCreated = await mutation(page, sessionPath, () => page.getByRole("button", { name: "新建会话", exact: true }).click(), 201);
    const secondSession = secondCreated.session;
    await page.locator(`[data-session-id="${secondSession.id}"][aria-current="page"]`).waitFor({ state: "attached" });
    await readyComposer();
    check(`${prefix} 新会话输入和消息为空`, await page.getByLabel("输入消息").inputValue() === "" && (await api(page, `${sessionPath}/${secondSession.id}/messages`)).messages.length === 0);
    await files(); await page.getByRole("tab", { name: /当前上下文/ }).click();
    await page.getByText("当前上下文为空，Agent 看得到文件目录，但看不到文件正文。", { exact: true }).waitFor();
    check(`${prefix} 新会话不继承另一会话上下文`, (await api(page, `${sessionPath}/${secondSession.id}/context`)).fileIds.length === 0);
    await conversation();
    const delayedPath = `${sessionPath}/${secondSession.id}/messages`;
    await page.route(`**${delayedPath}`, (route) => route.continue({ headers: { ...route.request().headers(), "x-pm-verify-stream-delay": "1" } }));
    const secondMessage = `会话二独立消息 ${viewport.width}`;
    await page.getByLabel("输入消息").fill(secondMessage);
    const generationResponse = page.waitForResponse((response) => new URL(response.url()).pathname === delayedPath && response.request().method() === "POST");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
    const busy = await eventually(state, (value) => stage(value, "analysis").generatingSessionIds.includes(secondSession.id), "第二会话生成事实");
    check(`${prefix} 生成状态仅属于第二会话`, stage(busy, "analysis").generatingSessionIds.length === 1 && !stage(busy, "analysis").generatingSessionIds.includes(firstSession.id));
    await mutation(page, `/api/iterations/${first.id}/sessions/${secondSession.id}/stop`, () => page.getByRole("button", { name: "停止生成", exact: true }).click());
    const stoppedResponse = await generationResponse;
    if (stoppedResponse.status() !== 409) throw new Error(`停止回放生成响应为 ${stoppedResponse.status()}，预期 409`);
    await page.unroute(`**${delayedPath}`);
    await readyComposer();
    const secondDraft = "会话二未发送草稿";
    await page.getByLabel("输入消息").fill(secondDraft);
    async function selectSession(session) {
      await sessions(); await page.locator(`[data-session-id="${session.id}"]`).click();
      await page.locator(`[data-session-id="${session.id}"][aria-current="page"]`).waitFor({ state: "attached" });
      await readyComposer();
    }
    await selectSession(firstSession);
    const firstHistory = await api(page, `${sessionPath}/${firstSession.id}/messages`);
    const secondHistory = await api(page, delayedPath);
    check(`${prefix} 两会话消息和过程状态独立`, firstHistory.messages.filter((item) => item.role === "user").map((item) => item.content).join("") === firstMessage && secondHistory.messages.filter((item) => item.role === "user").map((item) => item.content).join("") === secondMessage && firstHistory.messages.some((item) => item.role === "assistant" && item.status === "completed") && secondHistory.messages.some((item) => item.role === "assistant" && item.status === "failed"));
    check(`${prefix} 切回会话一恢复独立草稿`, await page.getByLabel("输入消息").inputValue() === firstDraft);
    check(`${prefix} 会话一对话正文不显示会话二消息`, await page.locator(".message-content").filter({ hasText: firstMessage }).isVisible() && await page.locator(".message-content").filter({ hasText: secondMessage }).count() === 0);
    await files(); await page.getByRole("tab", { name: /当前上下文/ }).click();
    check(`${prefix} 切回会话一恢复已加载文件`, await page.getByRole("button", { name: `从当前上下文移除 ${filename}` }).isVisible() && (await api(page, `${sessionPath}/${firstSession.id}/context`)).fileIds.includes(fixtureId));
    await selectSession(secondSession);
    check(`${prefix} 切回会话二恢复独立草稿`, await page.getByLabel("输入消息").inputValue() === secondDraft);
    check(`${prefix} 会话二对话正文不显示会话一消息`, await page.locator(".message-content").filter({ hasText: secondMessage }).isVisible() && await page.locator(".message-content").filter({ hasText: firstMessage }).count() === 0);
    await snapshot("sessions");
    for (const iteration of [second, first]) {
      await page.goto(`${base}/projects/${projectId}/iterations/${iteration.id}`);
      await page.getByRole("region", { name: "四环阶段导航" }).waitFor();
      await files();
      await page.getByRole("button", { name: new RegExp(`^${filename.replaceAll(".", "\\.")}`) }).waitFor();
      check(`${prefix} 迭代 ${iteration.iteration_number} 可见同一项目文件`, (await api(page, `/api/projects/${projectId}/files`)).some((entry) => entry.id === fixtureId && entry.filename === filename));
    }
    await snapshot("shared-files");
    check(`${prefix} 文件视图无横向溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const [finalFiles] = await connection.execute("SELECT id, filename, content, version FROM project_files WHERE project_id = ?", [projectId]);
    const [changes] = await connection.execute("SELECT COUNT(*) AS total FROM project_file_changes WHERE project_id = ?", [projectId]);
    check(`${prefix} 导航、候选、切会话和切迭代均未自动写入文件`, finalFiles.length === 1 && finalFiles[0].id === fixtureId && finalFiles[0].content === fixtureContent && Number(finalFiles[0].version) === 1 && Number(changes[0].total) === 0);
    const [persisted] = await connection.execute("SELECT s.id, m.role, m.status, m.content FROM iteration_sessions s JOIN iteration_session_messages m ON m.session_id = s.id WHERE s.iteration_id = ?", [first.id]);
    check(`${prefix} 数据库最终消息事实与两会话 API 一致`, persisted.length === 4 && persisted.some((row) => row.id === firstSession.id && row.role === "assistant" && row.status === "completed") && persisted.some((row) => row.id === secondSession.id && row.role === "assistant" && row.status === "failed"));
    const [refs] = await connection.execute("SELECT session_id, file_id FROM iteration_session_context_files WHERE session_id IN (?, ?)", [firstSession.id, secondSession.id]);
    check(`${prefix} 数据库引用只属于会话一`, refs.length === 1 && refs[0].session_id === firstSession.id && refs[0].file_id === fixtureId);
    const [numbers] = await connection.execute("SELECT iteration_number FROM product_iterations WHERE project_id = ? ORDER BY iteration_number", [projectId]);
    const [counter] = await connection.execute("SELECT next_iteration_number FROM projects WHERE id = ?", [projectId]);
    check(`${prefix} 最终两个编号为 1/2 且下一编号为 3`, numbers.map((row) => Number(row.iteration_number)).join(",") === "1,2" && Number(counter[0].next_iteration_number) === 3);
    check(`${prefix} 浏览器无运行时错误`, errors.length === 0);
    workflows.push({ viewport, projectId, iterationIds: [first.id, second.id], sessionIds: [firstSession.id, secondSession.id], fixtureId, fixturePurpose: "非空上下文隔离与项目级目录共享；不验收产品成果写入" });
    await context.close();
  }
} catch (error) {
  check(`回放中断：${error instanceof Error ? error.message : String(error)}`, false);
  if (page && output) await page.screenshot({ path: join(output, "foundation-failure.png"), animations: "disabled" }).catch(() => undefined);
} finally {
  if (browser) await browser.close();
  if (connection) await connection.end();
  if (output) await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", workflows, screenshots, assertions }, null, 2), "utf8");
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
