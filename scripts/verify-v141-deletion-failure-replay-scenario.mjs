// v1.41 #22：桌面和 390px 两条连续正式 UI 流程，公开 API 探测，SQL 观察最终事实。
// 不建立业务 SQL 夹具；持锁仅用于确定性交错，故障通过已有开发 replay 钩子注入。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getMysqlAppConfig, getMysqlConnectionOptions } from "../src/lib/mysql-config.ts";

const base = process.env.BASE_URL; const output = process.env.V141_REPLAY_OUTPUT_DIR;
let pass = 0; let fail = 0; let browser; let connection; let page; let lock;
const assertions = []; const workflows = []; const screenshots = []; const evidence = []; const permissions = [];
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(JSON.parse(JSON.stringify(a)))) === JSON.stringify(canonical(JSON.parse(JSON.stringify(b))));
// 对响应中的原始字符串逐值核对，避免 JSON 转义双引号和换行造成假阴性。
const responseStrings = (value) => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(responseStrings) : value && typeof value === "object" ? Object.entries(value).flatMap(([key, item]) => [key, ...responseStrings(item)]) : [];
const leakedValues = (body, sentinels) => sentinels.filter((value) => value && responseStrings(body).some((text) => text.includes(value)));
function check(name, okay) { assertions.push({ name, okay: Boolean(okay) }); if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}`); } }
function requireOkay(name, okay) { check(name, okay); if (!okay) throw new Error(`关键事实不成立：${name}`); }
async function api(path, method = "GET", data, headers = {}, actor = page) {
  const response = await actor.request.fetch(`${base}${path}`, { method, data, headers, timeout: 60000 });
  const text = await response.text(); return { status: response.status(), body: text ? JSON.parse(text) : null };
}
async function get(path) { const result = await api(path); if (result.status !== 200) throw new Error(`GET ${path}: ${result.status}`); return result.body; }
async function mutation(path, action, expected = 200) {
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() !== "GET");
  await action(); const response = await pending;
  if (response.status() !== expected) throw new Error(`${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function eventually(read, predicate, description) {
  const end = Date.now() + 20000;
  do { const value = await read(); if (predicate(value)) return value; await new Promise((resolve) => setTimeout(resolve, 100)); } while (Date.now() < end);
  throw new Error(`等待超时：${description}`);
}
async function register(actor, email) {
  await actor.goto(`${base}/register`); await actor.fill("#email", email);
  await actor.locator('input[type="password"]').first().fill("verify-pass-1234"); await actor.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await actor.locator('form button[type="submit"]').click(); await actor.waitForURL((url) => url.pathname === "/projects");
}

try {
  if (!base || !output || process.env.AI_MODE !== "replay") throw new Error("必须通过独立 replay 入口运行");
  await mkdir(output, { recursive: true });
  const mdProbe = '# 权限探针\n\n含"引号"正文'; const htmlProbe = '<!doctype html>\n<html lang="zh"><body>权限探针</body></html>';
  requireOkay("权限泄露保护能识别嵌套响应中含换行和引号的MD及HTML原文", leakedValues({ error: "无权访问", nested: [mdProbe, { html: htmlProbe }] }, [mdProbe, htmlProbe]).length === 2 && leakedValues({ error: "无权访问" }, [mdProbe, htmlProbe]).length === 0);
  const mode = await fetch(`${base}/api/verify/replay-mode`);
  requireOkay("发送前正式服务确认 AI_MODE=replay", mode.ok && (await mode.json()).aiMode === "replay");
  const config = getMysqlConnectionOptions(getMysqlAppConfig());
  connection = await mysql.createConnection(config); lock = await mysql.createConnection(config);
  requireOkay("专项注册前独立数据库没有用户", Number((await connection.query("SELECT COUNT(*) AS n FROM users"))[0][0].n) === 0);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const prefix = `${viewport.width}×${viewport.height}`; const compact = viewport.width < 1100; const token = randomUUID();
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(() => {
      const insert = () => { if (!document.head || document.getElementById("verify-hide-next-indicator")) return; const style = document.createElement("style"); style.id = "verify-hide-next-indicator"; style.textContent = "nextjs-portal { display: none !important; }"; document.head.appendChild(style); };
      new MutationObserver(insert).observe(document, { childList: true, subtree: true }); insert();
    });
    page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000); const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await register(page, `verify-deletion-${viewport.width}-${token}@test.local`);
    await page.getByRole("button", { name: "新建一个项目", exact: true }).first().click();
    const projectName = `删除专项_${viewport.width}_${token}`;
    await page.getByRole("dialog", { name: "新建一个项目" }).getByRole("textbox").fill(projectName);
    const project = await mutation("/api/projects", () => page.getByRole("button", { name: "创建项目", exact: true }).click(), 201);
    const projectId = project.id; let iteration; let session; let key = "analysis"; const sessionIds = [];
    const root = () => `/api/iterations/${iteration.id}`;
    const sessionPath = () => `${root()}/sessions/${session.id}`;
    const messagesPath = () => `${root()}/stages/${key}/sessions/${session.id}/messages`;
    const assets = async () => {
      const facts = {};
      for (const table of ["project_files", "task_folders", "prototype_snapshots", "project_file_changes"]) facts[table] = (await connection.execute(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY id`, [projectId]))[0];
      return facts;
    };
    const processState = async () => {
      const state = {};
      for (const table of ["product_iterations", "iteration_stage_states", "iteration_sessions"]) {
        const where = table === "product_iterations" ? "project_id" : "iteration_id"; const value = table === "product_iterations" ? projectId : iteration.id;
        state[table] = (await connection.execute(`SELECT * FROM ${table} WHERE ${where} = ? ORDER BY ${table === "iteration_stage_states" ? "stage" : "id"}`, [value]))[0];
      }
      for (const table of ["iteration_session_messages", "iteration_session_context_files", "iteration_file_candidates", "iteration_task_set_candidates"]) {
        state[table] = (await connection.query(`SELECT * FROM ${table} WHERE session_id IN (?) ORDER BY ${table === "iteration_session_context_files" ? "session_id, file_id" : "id"}`, [sessionIds]))[0];
      }
      return state;
    };
    async function capture(name) { check(`${prefix} ${name}无水平溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const path = join(output, `deletion-${viewport.width}-${name}.png`); await page.screenshot({ path, animations: "disabled" }); screenshots.push(path); }
    async function conversation() { if (compact) await page.getByRole("navigation", { name: "工作台区域" }).getByRole("button", { name: "对话", exact: true }).click(); }
    async function files() { if (compact) await page.getByRole("navigation", { name: "工作台区域" }).getByRole("button", { name: /文件与上下文/ }).click(); else if (await page.getByRole("button", { name: "展开文件区" }).isVisible()) await page.getByRole("button", { name: "展开文件区" }).click(); await page.getByRole("tab", { name: /项目文件树/ }).click(); }
    async function openProject() { await page.goto(`${base}/projects`); await page.getByRole("button", { name: projectName, exact: true }).click(); }
    async function createIteration(name) {
      await openProject(); await page.getByRole("button", { name: "创建产品迭代", exact: true }).first().click();
      const drawer = page.getByRole("dialog", { name: "创建产品迭代", exact: true }); await drawer.getByPlaceholder("例如：降低首次使用流失").fill(name); await drawer.getByText("填写本轮目标", { exact: true }).click(); await drawer.getByPlaceholder("这一轮最想改变什么？").fill("删除过程保留成果，失败可重试");
      iteration = await mutation(`/api/projects/${projectId}/iterations`, () => drawer.getByRole("button", { name: "创建并进入工作区" }).click(), 201);
      await page.waitForURL(`${base}/projects/${projectId}/iterations/${iteration.id}`); await page.getByRole("region", { name: "四环阶段导航" }).waitFor(); key = "analysis"; session = null; return iteration;
    }
    async function stage(nextKey, label) {
      if (nextKey !== key) {
        await page.getByRole("region", { name: "四环阶段导航" }).getByRole("button", { name: new RegExp(label) }).click(); const skip = page.getByRole("button", { name: `继续进入${label}`, exact: true });
        await eventually(async () => ({ skip: await skip.isVisible(), state: await get(`${root()}/workbench`) }), (value) => value.skip || value.state.currentStage === nextKey, "目标阶段或提示");
        if (await skip.isVisible()) await skip.click(); await eventually(() => get(`${root()}/workbench`), (value) => value.currentStage === nextKey, "阶段保存"); key = nextKey;
      }
      await conversation(); session = (await get(`${root()}/workbench`)).stages.find((item) => item.key === key).sessions[0] ?? null;
      if (!session) { session = (await mutation(`${root()}/stages/${key}/sessions`, () => page.getByRole("button", { name: "开始本阶段工作" }).click(), 201)).session; sessionIds.push(session.id); }
      await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "可输入"); return session;
    }
    async function send(label, expected = 200, header) {
      await conversation(); if (header) await page.route(`${base}${messagesPath()}`, (route) => route.continue({ headers: { ...route.request().headers(), [header]: "1" } }), { times: 1 });
      await page.getByLabel("输入消息").fill(`${key === "tickets" ? "确认并输出完整任务集合" : "请生成本阶段完整成果"} ${token}_${label}`);
      const result = await mutation(messagesPath(), () => page.getByRole("button", { name: "发送消息", exact: true }).click(), expected);
      await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "生成结束"); return result;
    }
    async function writeCandidate(result, filename, operation, fault = false) {
      const candidate = result.messages.at(-1).candidate; requireOkay(`${prefix} ${operation}正式候选 pending`, candidate?.status === "pending");
      const card = page.getByRole("region", { name: "需求分析文件候选", exact: true }).last(); await card.getByLabel("文件名").fill(filename);
      const path = `${sessionPath()}/candidates/${candidate.id}`; const button = () => card.getByRole("button", { name: operation === "create" ? "确认创建" : "确认覆盖", exact: true });
      if (fault) {
        const before = await assets(); const candidates = (await connection.query("SELECT * FROM iteration_file_candidates WHERE session_id = ? ORDER BY id", [session.id]))[0];
        await page.route(`${base}${path}`, (route) => route.continue({ headers: { ...route.request().headers(), "x-pm-verify-candidate-write-fail": "1" } }), { times: 1 });
        await mutation(path, () => button().click(), 500);
        requireOkay(`${prefix} 普通${operation}真实事务失败资产、备份和来源不变`, equal(before, await assets()));
        requireOkay(`${prefix} 普通${operation}失败候选原样且确认入口可重试`, equal(candidates, (await connection.query("SELECT * FROM iteration_file_candidates WHERE session_id = ? ORDER BY id", [session.id]))[0]) && await button().isEnabled());
        await capture(`file-${operation}-retry`); evidence.push({ viewport, type: `file-${operation}-rollback`, before, after: await assets() });
      }
      const written = await mutation(path, () => button().click()); await card.getByText(`已保存到需求分析 / ${filename}`, { exact: true }).waitFor(); return { id: written.fileId, filename };
    }
    const owner = await createIteration("删除后保留成果"); const analysisSession = await stage("analysis", "需求分析");
    const file = await writeCandidate(await send("首个候选"), "需求分析-保留成果.md", "create", true);
    await writeCandidate(await send("覆盖候选"), file.filename, "overwrite", true);
    await files(); await page.locator(".project-tree-name").filter({ hasText: file.filename }).click();
    const preview = page.getByRole("dialog", { name: `预览 ${file.filename}`, exact: true }); await preview.getByRole("button", { name: "编辑正文", exact: true }).click(); await page.getByLabel("Markdown 正文").fill(`# 耐久正文\n\n${token}`);
    const editPath = `${root()}/files/${file.id}`; const beforeEdit = await assets();
    await page.route(`${base}${editPath}`, (route) => route.continue({ headers: { ...route.request().headers(), "x-pm-assistant-test-file-revision-failure": "1" } }), { times: 1 });
    await mutation(editPath, () => page.getByRole("button", { name: "保存修改", exact: true }).click(), 500);
    requireOkay(`${prefix} 普通编辑事务失败原正文备份修订来源不变`, equal(beforeEdit, await assets()));
    await mutation(editPath, () => page.getByRole("button", { name: "保存修改", exact: true }).click()); await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    // 正式上下文 API 建立引用，后续 SQL 只观察其生命周期。
    requireOkay(`${prefix} 正式上下文加入成功`, (await api(`${root()}/stages/analysis/sessions/${session.id}/context`, "POST", { fileId: file.id })).status === 200);
    await send("删除前未确认候选"); const sessionAssets = await assets();
    requireOkay(`${prefix} 删除前有非空旧版和未确认候选`, Boolean(sessionAssets.project_files.find((item) => item.id === file.id).previous_content) && (await connection.query("SELECT id FROM iteration_file_candidates WHERE session_id = ? AND status = 'pending'", [session.id]))[0].length > 0);
    // 真正发送进行中的 replay 请求；SQL 等待生成预留，而非手工插入 generating 夹具。
    let settled = false; const flight = api(messagesPath(), "POST", { content: "这是真实进行中的生成" }, { "x-pm-verify-stream-delay": "1" }).finally(() => { settled = true; });
    await eventually(async () => (await connection.query("SELECT id FROM iteration_session_messages WHERE session_id = ? AND status = 'generating'", [session.id]))[0], (rows) => rows.length === 1, "真实生成预留");
    const duringGeneration = await assets(); const duringProcess = await processState(); const duringCandidates = (await connection.query("SELECT * FROM iteration_file_candidates WHERE session_id = ? ORDER BY id", [session.id]))[0];
    const generationSessionDelete = await api(sessionPath(), "DELETE"); const generationIterationDelete = await api(root(), "DELETE");
    requireOkay(`${prefix} 真正 in-flight 生成同时阻止会话和迭代删除`, !settled && generationSessionDelete.status === 409 && generationIterationDelete.status === 409 && generationIterationDelete.body.reason === "generating");
    requireOkay(`${prefix} 生成中409完整会话消息上下文候选过程保持不变`, equal(duringProcess, await processState()) && equal(duringGeneration, await assets()));
    // 同一真实进行中请求也从项目列表的删除确认得到阻止和停止入口。
    const workbenchPage = page; page = await context.newPage(); page.setDefaultTimeout(20000); await openProject();
    const generatingRow = page.locator(`[data-iteration-id="${owner.id}"]`); await generatingRow.getByRole("button", { name: "删除后保留成果 更多功能", exact: true }).click(); await generatingRow.getByRole("button", { name: "删除产品迭代", exact: true }).click();
    const generatingDialog = page.getByRole("alertdialog", { name: "删除产品迭代？" }); await generatingDialog.waitFor(); await mutation(root(), () => generatingDialog.getByRole("button", { name: "确认删除迭代", exact: true }).click(), 409); await generatingDialog.getByRole("link", { name: "前往工作区停止生成", exact: true }).waitFor();
    requireOkay(`${prefix} 真实生成阻止迭代UI删除并保留对象和全部过程`, !settled && await generatingDialog.isVisible() && await generatingRow.count() === 1 && await page.locator(".iteration-toast").count() === 0 && equal(duringProcess, await processState())); await capture("iteration-generation-blocked"); await page.close(); page = workbenchPage;
    await page.reload(); if (compact) await page.getByRole("navigation", { name: "工作台区域" }).getByRole("button", { name: /阶段会话/ }).click();
    const sessionRow = () => page.locator(".session-list-item").filter({ has: page.locator(`[data-session-id="${analysisSession.id}"]`) });
    const sessionDialog = page.getByRole("alertdialog", { name: "删除阶段会话？" });
    await sessionRow().getByRole("button", { name: /^删除会话/ }).click(); await sessionDialog.waitFor();
    check(`${prefix} 真实生成中 UI 禁用删除并提供停止入口`, await sessionDialog.getByRole("button", { name: "确认删除会话", exact: true }).isDisabled()); await capture("generation-delete-blocked");
    await sessionDialog.getByRole("button", { name: "查看会话并停止生成", exact: true }).click(); await conversation();
    await mutation(`${sessionPath()}/stop`, () => page.getByRole("button", { name: "停止生成", exact: true }).click()); requireOkay(`${prefix} 停止真实请求后返回409且资产候选保留`, (await flight).status === 409 && equal(duringGeneration, await assets()) && equal(duringCandidates, (await connection.query("SELECT * FROM iteration_file_candidates WHERE session_id = ? ORDER BY id", [session.id]))[0]));
    // 真实事务持有项目、迭代、会话锁；公开删除必须 NOWAIT 立即冲突。
    await lock.beginTransaction(); await lock.query("SELECT id FROM projects WHERE id = ? FOR UPDATE", [projectId]); await lock.query("SELECT id FROM product_iterations WHERE id = ? FOR UPDATE", [owner.id]); await lock.query("SELECT id FROM iteration_sessions WHERE id = ? FOR UPDATE", [session.id]);
    try {
      const started = Date.now(); const lockedProcess = await processState(); const lockedAssets = await assets();
      const conflicts = await Promise.all([api(sessionPath(), "DELETE"), api(root(), "DELETE")]); const elapsedMs = Date.now() - started;
      requireOkay(`${prefix} 真正写入持锁同时阻止会话和迭代删除且不排队`, elapsedMs < 2500 && conflicts.every((item) => item.status === 409) && conflicts[1].body.reason === "writing");
      requireOkay(`${prefix} 写入锁冲突对象候选及资产逐字段保留`, equal(lockedProcess, await processState()) && equal(lockedAssets, await assets())); evidence.push({ viewport, type: "writing-lock", elapsedMs, conflicts });
    } finally { await lock.rollback(); }
    await page.reload(); if (compact) await page.getByRole("navigation", { name: "工作台区域" }).getByRole("button", { name: /阶段会话/ }).click();
    await sessionRow().getByRole("button", { name: /^删除会话/ }).click(); await sessionDialog.waitFor(); const copy = await sessionDialog.innerText();
    check(`${prefix} 停止后删除恢复且确认明确候选丢失和成果保留`, await sessionDialog.getByRole("button", { name: "确认删除会话", exact: true }).isEnabled() && ["未确认", "候选", "消息", "上下文", "项目文件", "变更记录"].every((text) => copy.includes(text))); await capture("session-delete-confirm");
    // 网络失败只验证弹窗行为；真实事务原子性由前后 SQL 与服务器故障钩子另证。
    await page.route(`${base}${sessionPath()}`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "删除未完成，请重试。" }) }), { times: 1 });
    await mutation(sessionPath(), () => sessionDialog.getByRole("button", { name: "确认删除会话", exact: true }).click(), 500); await sessionDialog.getByRole("alert").waitFor();
    check(`${prefix} 会话删除网络失败无假成功且可原位重试`, await sessionDialog.isVisible() && (await api(sessionPath())).status === 200); await capture("session-delete-retry");
    await mutation(sessionPath(), () => sessionDialog.getByRole("button", { name: "确认删除会话", exact: true }).click()); await sessionDialog.waitFor({ state: "hidden" });
    requireOkay(`${prefix} 会话删除清理消息上下文普通候选但保留全部成果`, (await api(sessionPath())).status === 404 && equal(sessionAssets, await assets()));
    for (const table of ["iteration_session_messages", "iteration_session_context_files", "iteration_file_candidates"]) requireOkay(`${prefix} 会话删除清空${table}`, (await connection.query(`SELECT * FROM ${table} WHERE session_id = ?`, [analysisSession.id]))[0].length === 0);
    check(`${prefix} 会话删除后历史来源保留精确会话名称快照及已删除状态`, (await get(`/api/projects/${projectId}/files/${file.id}/history`)).changes.filter((item) => item.actor === "agent").every((item) => item.sessionDeleted && item.sessionName === sessionAssets.project_file_changes.find((change) => change.id === item.id)?.session_name));
    await conversation(); await page.getByRole("button", { name: "开始本阶段工作", exact: true }).waitFor();
    const prototypeSession = await stage("prototype", "原型设计"); const beforeGeneration = await assets();
    const failed = await send("快照故障", 502, "x-pm-verify-snapshot-failure"); const failedMessage = failed.messages.at(-1);
    requireOkay(`${prefix} HTML快照真实提交故障回滚候选快照且消息 failed 可重试`, equal(beforeGeneration, await assets()) && failedMessage.status === "failed" && !failedMessage.candidate && (await connection.query("SELECT * FROM iteration_file_candidates WHERE session_id = ?", [prototypeSession.id]))[0].length === 0);
    const generationRetry = page.getByRole("button", { name: "重试生成", exact: true }).last(); await generationRetry.waitFor();
    check(`${prefix} HTML失败真实UI提供重试生成且无成功快照入口`, await generationRetry.isEnabled() && await page.getByRole("button", { name: "打开本轮 HTML 快照", exact: true }).count() === 0);
    await capture("generation-failure-retry"); await mutation(messagesPath(), () => generationRetry.click()); await eventually(() => page.getByLabel("输入消息").isEnabled(), Boolean, "同一失败消息重试完成");
    const snapshots = await get(`/api/projects/${projectId}/snapshots`); requireOkay(`${prefix} 生成重试只留下一个完整HTML快照`, snapshots.length === 1); const snapshotPath = `/api/projects/${projectId}/snapshots/${snapshots[0].id}`; const snapshot = await get(snapshotPath);
    const taskSession = await stage("tickets", "任务拆分");
    async function submitTask(fault, label) {
      const generated = await send(label); const candidate = generated.messages.at(-1).taskCandidate;
      requireOkay(`${prefix} ${label}正式任务候选 pending`, candidate?.status === "pending"); const path = `${sessionPath()}/task-candidates/${candidate.id}`; const card = page.getByRole("region", { name: "任务集合候选", exact: true }).last(); const button = () => card.getByRole("button", { name: "确认整套提交", exact: true });
      await button().waitFor(); if (fault) { const before = await assets(); await page.route(`${base}${path}`, (route) => route.continue({ headers: { ...route.request().headers(), "x-pm-assistant-test-task-failure": "1" } }), { times: 1 }); await mutation(path, () => button().click(), 500);
        requireOkay(`${prefix} ${label}真实整套故障没有半套文件夹序号快照或来源`, equal(before, await assets()) && (await get(path)).status === "pending" && await button().isEnabled()); await capture(`tasks-${label}-retry`); evidence.push({ viewport, type: `tasks-${label}-rollback`, before, after: await assets() }); }
      const result = await mutation(path, () => button().click()); await card.getByText("整套任务已提交到本迭代文件夹。", { exact: true }).waitFor(); return result;
    }
    const writtenTasks = await submitTask(true, "创建");
    // 回放默认任务重复发送内容可能相同，手动整套编辑形成实际非空旧集合。
    await page.getByRole("button", { name: "手动提出整套任务", exact: true }).click(); const field = page.locator("#task-body-1"); await field.fill(`${await field.inputValue()}\n\n耐久变更_${token}`);
    const proposalPath = `${sessionPath()}/task-candidates`; const proposal = await mutation(proposalPath, () => page.getByRole("button", { name: "生成整套待确认候选", exact: true }).click(), 201); const taskPath = `${proposalPath}/${proposal.candidateId}`;
    const taskCard = page.getByRole("region", { name: "任务集合候选", exact: true }).last(); await eventually(() => taskCard.locator("[data-status]").getAttribute("data-status"), (status) => status === "pending", "手动完整候选"); const beforeTasks = await assets();
    await page.route(`${base}${taskPath}`, (route) => route.continue({ headers: { ...route.request().headers(), "x-pm-assistant-test-task-failure": "1" } }), { times: 1 });
    await mutation(taskPath, () => taskCard.getByRole("button", { name: "确认整套提交", exact: true }).click(), 500); requireOkay(`${prefix} 任务整套修改故障不留下半成品且可重试`, equal(beforeTasks, await assets()) && (await get(taskPath)).status === "pending"); await capture("tasks-update-retry");
    await mutation(taskPath, () => taskCard.getByRole("button", { name: "确认整套提交", exact: true }).click()); await taskCard.getByText("整套任务已提交到本迭代文件夹。", { exact: true }).waitFor();
    await send("任务删除前未确认候选"); const beforeTaskDelete = await assets(); const pendingTask = (await connection.query("SELECT * FROM iteration_task_set_candidates WHERE session_id = ? AND status = 'pending'", [taskSession.id]))[0];
    const oldTaskSet = beforeTaskDelete.task_folders[0].previous_snapshot; const oldTaskFiles = typeof oldTaskSet === "string" ? JSON.parse(oldTaskSet) : oldTaskSet;
    requireOkay(`${prefix} 任务删除前旧集合非空且存在待确认候选`, pendingTask.length > 0 && Array.isArray(oldTaskFiles) && oldTaskFiles.length > 0);
    requireOkay(`${prefix} 任务会话删除只清理候选，非空旧集合原样保留`, (await api(sessionPath(), "DELETE")).status === 200 && (await connection.query("SELECT * FROM iteration_task_set_candidates WHERE session_id = ?", [taskSession.id]))[0].length === 0 && equal(beforeTaskDelete, await assets()));
    // 权限失败：每条公开请求前后保持项目级完整事实。
    const external = (await api("/api/projects", "POST", { name: "权限对照项目" })).body; const foreignIteration = (await api(`/api/projects/${external.id}/iterations`, "POST", { displayName: "权限对照", goal: "不能接管外来成果" })).body;
    const outsiderContext = await browser.newContext({ viewport }); const outsider = await outsiderContext.newPage(); outsider.setDefaultNavigationTimeout(60000); await register(outsider, `verify-deletion-outsider-${viewport.width}-${token}@test.local`);
    const permissionBefore = await assets(); const permissionProcess = await processState();
    const sentinels = [token, projectName, file.filename, "删除后保留成果", permissionBefore.project_files.find((item) => item.id === file.id).content, file.id, owner.id, prototypeSession.id, writtenTasks.folderId, snapshot.content];
    async function deny(label, path, method = "GET", data, actor = page, expected = 404) {
      const result = await api(path, method, data, {}, actor); const leaks = leakedValues(result.body, sentinels);
      permissions.push({ viewport, label, path, method, expected, status: result.status, body: result.body, leaks }); requireOkay(`${prefix} ${label}精确${expected}且无正文名称身份泄露`, result.status === expected && leaks.length === 0); return result;
    }
    for (const path of [root(), `/api/projects/${projectId}`]) await deny("跨用户删除", path, "DELETE", undefined, outsider);
    for (const path of [`/api/projects/${projectId}/files/${file.id}/history`, snapshotPath]) await deny("跨用户历史或快照读取", path, "GET", undefined, outsider);
    await deny("跨项目会话删除", `/api/iterations/${foreignIteration.id}/sessions/${prototypeSession.id}`, "DELETE"); await deny("跨项目文件修改", `/api/iterations/${foreignIteration.id}/files/${file.id}`, "POST", { projectId: external.id, action: "edit", content: "非法" }); await deny("跨项目快照读取", `/api/projects/${external.id}/snapshots/${snapshots[0].id}`);
    requireOkay(`${prefix} 所有权限失败后资产候选过程逐字段不变`, equal(permissionBefore, await assets()) && equal(permissionProcess, await processState())); await outsiderContext.close();
    const beforeIterationDelete = await assets();
    await openProject(); const row = page.locator(`[data-iteration-id="${owner.id}"]`); await row.getByRole("button", { name: "删除后保留成果 更多功能", exact: true }).click(); await row.getByRole("button", { name: "删除产品迭代", exact: true }).click(); const iterationDialog = page.getByRole("alertdialog", { name: "删除产品迭代？" }); await iterationDialog.waitFor();
    const iterationCopy = await iterationDialog.innerText(); check(`${prefix} 迭代删除确认明确保留资产旧集合及不可撤销`, ["消息", "候选", "项目文件", "备份", "任务旧集合", "HTML 快照", "变更记录", "无法撤销"].every((text) => iterationCopy.includes(text))); await capture("iteration-delete-confirm");
    await page.route(`${base}${root()}`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "删除未完成，请重试。" }) }), { times: 1 }); await mutation(root(), () => iterationDialog.getByRole("button", { name: "确认删除迭代", exact: true }).click(), 500); await iterationDialog.getByRole("alert").waitFor();
    check(`${prefix} 迭代删除网络失败弹窗对象保留无假成功`, await iterationDialog.isVisible() && await row.count() === 1 && await page.locator(".iteration-toast").count() === 0 && (await api(root())).status === 200); await capture("iteration-delete-retry");
    await mutation(root(), () => iterationDialog.getByRole("button", { name: "确认删除迭代", exact: true }).click()); await iterationDialog.waitFor({ state: "hidden" }); await row.waitFor({ state: "detached" });
    requireOkay(`${prefix} 迭代删除保留所有项目资产及非空备份快照来源`, (await api(root())).status === 404 && equal(beforeIterationDelete, await assets()) && Object.values(await processState()).every((rows) => rows.length === 0));
    const history = await get(`/api/projects/${projectId}/files/${file.id}/history`); requireOkay(`${prefix} 删除来源保留稳定编号名称且无跳转ID`, history.changes.every((item) => item.iterationDeleted && item.iterationId === null && item.iterationNumber === 1 && item.iterationName === "删除后保留成果"));
    const folders = await get(`/api/projects/${projectId}/task-folders`); requireOkay(`${prefix} 任务文件夹归档并失去活跃所属迭代`, folders.length === 1 && folders[0].archived && folders[0].ownerIterationId === null);
    await page.getByRole("tab", { name: /项目文件树/ }).click(); await page.getByText("已删除迭代 · 只读归档", { exact: true }).waitFor(); await capture("archived-readonly");
    await page.locator(".project-tree-name").filter({ hasText: file.filename }).click(); const readonly = page.getByRole("dialog", { name: `预览 ${file.filename}`, exact: true }); await readonly.getByRole("link", { name: `下载 ${file.filename}`, exact: true }).waitFor();
    check(`${prefix} 无迭代正文仍可预览下载且全部修改入口隐藏`, await readonly.getByRole("link", { name: `下载 ${file.filename}`, exact: true }).isVisible() && await readonly.getByRole("button", { name: "编辑正文", exact: true }).count() === 0 && await readonly.getByRole("button", { name: "撤回上次修改", exact: true }).count() === 0);
    await readonly.getByRole("tab", { name: "文件详情与来源", exact: true }).click(); await readonly.getByText(/迭代 01（已删除） · 删除后保留成果/).first().waitFor(); check(`${prefix} 已删除来源真实UI文本占位无跳转及改名删除`, await readonly.locator(`a[href*="${owner.id}"]`).count() === 0 && await readonly.getByRole("button", { name: "改名", exact: true }).count() === 0 && await readonly.getByRole("button", { name: "删除文件", exact: true }).count() === 0); await capture("deleted-source-placeholder"); await readonly.getByRole("button", { name: "关闭预览", exact: true }).click();
    await page.getByText("HTML 快照 · 项目全部版本", { exact: true }).click(); await page.locator(".snapshot-detail iframe").waitFor(); await page.frameLocator(".snapshot-detail iframe").getByRole("heading", { name: "校园二手", exact: true }).waitFor(); await capture("archived-html");
    const downloads = await Promise.all([page.request.get(`${base}/api/projects/${projectId}/files/${file.id}/download`), page.request.get(`${base}${snapshotPath}?mode=view`), page.request.get(`${base}${snapshotPath}?mode=download`)]);
    const mdContent = beforeIterationDelete.project_files.find((item) => item.id === file.id).content;
    requireOkay(`${prefix} 来源删除后MD下载HTML预览下载字节保留`, downloads.every((item) => item.status() === 200) && await downloads[0].text() === mdContent && await downloads[1].text() === snapshot.content && await downloads[2].text() === snapshot.content);
    const noIterationBefore = await assets();
    for (const [path, method, data] of [[`/api/projects/${projectId}/files/${file.id}`, "PATCH", { content: "非法" }], [`/api/projects/${projectId}/files/${file.id}`, "DELETE"], [`/api/projects/${projectId}/files`, "POST", { filename: "需求分析.md", content: "# 非法", agent_type: "requirement_analyst", source_message_id: randomUUID() }], [`/api/projects/${projectId}/ticket-sets`, "POST", { mode: "replace" }]]) requireOkay(`${prefix} 无迭代旧${method}入口守卫`, (await api(path, method, data)).status === 409);
    const record = (await api(`/api/projects/${projectId}/work-records`, "POST", { name: "旧接口守卫" })).body; const tab = (await api(`/api/work-records/${record.id}/tabs`, "POST", { agent_type: "requirement_analyst" })).body.tab;
    requireOkay(`${prefix} 无迭代旧上下文及HTML创建入口守卫`, (await api(`/api/tabs/${tab.id}/files`, "POST", { file_id: file.id })).status === 409 && (await api(`/api/projects/${projectId}/snapshots`, "POST", { content: "<!doctype html><html><body>非法</body></html>", tab_id: tab.id })).status === 409 && equal(noIterationBefore, await assets()));
    // 旧会话仍可对话，成果入口已退役；从公开 chat 创建真实非空消息和操作记录。
    const legacyChat = await page.request.post(`${base}/api/tabs/${tab.id}/chat`, { data: { content: `旧会话级联探针_${token}`, expectedVersion: tab.version, requestId: randomUUID() } }); const legacyReply = await legacyChat.text();
    requireOkay(`${prefix} 旧工作记录真实replay消息和操作创建完成`, legacyChat.status() === 200 && legacyReply.includes('"type":"done"'));
    async function legacyState() {
      const state = { work_records: (await connection.query("SELECT * FROM work_records WHERE id = ?", [record.id]))[0], tabs: (await connection.query("SELECT * FROM tabs WHERE id = ?", [tab.id]))[0] };
      for (const table of ["messages", "agent_file_contexts", "message_file_writes", "tab_operations"]) state[table] = (await connection.query(`SELECT * FROM ${table} WHERE tab_id = ? ORDER BY ${table === "agent_file_contexts" ? "file_id" : "id"}`, [tab.id]))[0];
      return state;
    }
    const oldProcess = await legacyState(); requireOkay(`${prefix} 项目删除前旧工作记录标签消息操作都非空`, oldProcess.work_records.length === 1 && oldProcess.tabs.length === 1 && oldProcess.messages.length === 2 && oldProcess.tab_operations.length > 0);
    const next = await createIteration("新迭代不能接管归档"); const nextSession = await stage("analysis", "需求分析"); const issue = beforeIterationDelete.project_files.find((item) => item.task_folder_id === writtenTasks.folderId); const guardBefore = await assets();
    requireOkay(`${prefix} 新迭代编号不复用且归档任务可加入上下文`, next.iteration_number === 2 && (await api(`${root()}/stages/analysis/sessions/${nextSession.id}/context`, "POST", { fileId: issue.id })).status === 200);
    for (const [action, method, extra, expected] of [["edit", "POST", { content: "非法接管" }, 403], ["rename", "PATCH", { filename: issue.filename.replace(/\.md$/, "接管.md") }, 403], ["delete", "DELETE", {}, 403], ["restore", "POST", {}, 409]]) requireOkay(`${prefix} 新迭代不能${action}归档任务`, (await api(`${root()}/files/${issue.id}`, method, { projectId, action, ...extra })).status === expected);
    requireOkay(`${prefix} 新迭代不能撤回归档整套且拒绝后资产原样`, (await api(`${root()}/task-folder`, "PATCH", { projectId, folderId: writtenTasks.folderId, action: "restore" })).status === 403 && equal(guardBefore, await assets()));
    // Agent 整套提交合同固定按当前迭代找文件夹，不接受目标 folderId；成功只能创建自己的集合。
    await stage("tickets", "任务拆分"); const ownTasks = await submitTask(false, "新迭代独立集合");
    const afterOwn = await assets(); requireOkay(`${prefix} 新迭代Agent只能写自己的集合且归档所有字段原样`, ownTasks.folderId !== writtenTasks.folderId && equal(guardBefore.task_folders, afterOwn.task_folders.filter((item) => item.id === writtenTasks.folderId)) && equal(guardBefore.project_files, afterOwn.project_files.filter((item) => item.task_folder_id !== ownTasks.folderId)) && equal(guardBefore.project_file_changes, afterOwn.project_file_changes.filter((item) => item.task_folder_id !== ownTasks.folderId)));
    await send("项目删除前新迭代待确认集合");
    // 项目级联在真实 DELETE 部分执行后注入故障，完整旧接口和新过程均须回滚。
    const cascadeBefore = await assets(); const cascadeProcess = await processState(); const cascadeLegacy = await legacyState(); const deleteFailure = await api(`/api/projects/${projectId}`, "DELETE", undefined, { "x-pm-assistant-test-cascade-fail-after": "project-files" });
    requireOkay(`${prefix} 项目级联真实故障全部文件来源及新旧过程回滚可重试`, deleteFailure.status === 500 && deleteFailure.body.code === "CASCADE_DELETE_FAILED" && equal(cascadeBefore, await assets()) && equal(cascadeProcess, await processState()) && equal(cascadeLegacy, await legacyState()) && (await api(`/api/projects/${projectId}`)).status === 200);
    evidence.push({ viewport, type: "project-cascade-rollback", before: cascadeBefore, after: await assets(), processBefore: cascadeProcess, processAfter: await processState(), legacyBefore: cascadeLegacy, legacyAfter: await legacyState() });
    const deleted = await api(`/api/projects/${projectId}`, "DELETE"); requireOkay(`${prefix} 只有删除项目才清理全部项目资产来源和新旧过程`, deleted.status === 200 && (await api(`/api/projects/${projectId}`)).status === 404 && Object.values(await assets()).every((rows) => rows.length === 0) && Object.values(await processState()).every((rows) => rows.length === 0) && Object.values(await legacyState()).every((rows) => rows.length === 0));
    requireOkay(`${prefix} 项目删除不会影响另一项目及迭代`, (await api(`/api/projects/${external.id}`)).status === 200 && (await api(`/api/iterations/${foreignIteration.id}`)).status === 200);
    check(`${prefix} 连续流程浏览器无未捕获异常`, errors.length === 0); workflows.push({ viewport, projectId, deletedIterationId: owner.id, replacementIterationId: next.id, sessionIds, fileId: file.id, folderId: writtenTasks.folderId, snapshotId: snapshots[0].id, projectDeleted: true }); await context.close();
  }
} catch (error) { check(`专项回放中断：${error instanceof Error ? error.message : String(error)}`, false); if (page && output) await page.screenshot({ path: join(output, "deletion-failure.png"), animations: "disabled" }).catch(() => undefined); }
finally {
  if (lock) { await lock.rollback(); await lock.end(); } if (browser) await browser.close(); if (connection) await connection.end();
  if (output) { await writeFile(join(output, "failure-facts.json"), JSON.stringify(evidence, null, 2)); await writeFile(join(output, "permission-matrix.json"), JSON.stringify(permissions, null, 2)); await writeFile(join(output, "scenario-summary.json"), JSON.stringify({ pass, fail, aiMode: "replay", workflows, screenshots, assertions }, null, 2)); }
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
