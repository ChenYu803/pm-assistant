// v1.41 #17：固定回放验证迭代删除、事务互斥、成果生命周期和正式界面。
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { getMysqlPool, closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { deleteMysqlProductIteration } from "../src/lib/mysql-account-workspace.ts";
import { deleteMysqlProjectCascade } from "../src/lib/mysql-cascade-delete.ts";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") { console.error("❌ 本验证要求 AI_MODE=replay"); process.exit(1); }
const base = process.env.BASE_URL || "http://localhost:3000";
let pass = 0; let fail = 0;
function check(name, okay) { if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}`); } }
const json = (body, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, { cache: "no-store", ...init }); const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, init });
}
async function register(page, email) {
  await page.goto(`${base}/register`); await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click(); await page.waitForURL((url) => url.pathname === "/projects");
}
await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage(); page.setDefaultTimeout(15000);
const browserErrors = []; page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text()); });
const pool = getMysqlPool();
try {
  const email = `verify-iteration-delete-${Date.now()}@test.local`; await register(page, email);
  const project = await api(page, "/api/projects", json({ name: "迭代删除与成果归档验证" }));
  const projectId = project.body.id;
  const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "保留成果的首轮", goal: "验证迭代删除边界" }));
  const iterationId = iteration.body.id; const root = `/api/iterations/${iterationId}`;
  const ownerId = (await pool.query("SELECT user_id FROM projects WHERE id = ?", [projectId]))[0][0].user_id;
  const create = async (stage = "analysis") => (await api(page, `${root}/stages/${stage}/sessions`, { method: "POST" })).body.session.id;
  const sessionId = await create(); const otherSessionId = await create();
  const taskSessionId = await create("tickets"); const prototypeSessionId = await create("prototype");
  const sessions = [sessionId, otherSessionId, taskSessionId, prototypeSessionId];
  const sessionPath = `${root}/sessions/${sessionId}`;
  const generate = () => api(page, `${root}/stages/analysis/sessions/${sessionId}/messages`, json({ content: "请提出一份完整的需求分析候选" }));
  const first = await generate(); const candidate = first.body.messages.at(-1).candidate;
  const write = (id, operation) => api(page, `${sessionPath}/candidates/${id}`, json({ action: "write", filename: "需求分析-保留成果.md", expectedOperation: operation }));
  const written = await write(candidate.id, "create"); const fileId = written.body.fileId;
  const second = await generate(); await write(second.body.messages.at(-1).candidate.id, "overwrite"); await generate();
  await api(page, `${root}/stages/analysis/sessions/${sessionId}/context`, json({ fileId }));
  check("真实候选创建及覆盖，唯一上一版与待确认候选就绪", written.status === 200 && (await pool.query("SELECT previous_content FROM project_files WHERE id = ?", [fileId]))[0][0].previous_content !== null);
  const taskPath = `${root}/sessions/${taskSessionId}`;
  const proposal = "%%%FILE_BEGIN%%% issues/01-首项.md\n# 01 — 首项\n\n**What to build:** 用户可执行任务。\n\n**Blocked by:** None\n\n## 验收标准\n- [ ] 可以完成。\n%%%FILE_END%%%";
  const task = await api(page, `${taskPath}/task-candidates`, json({ content: proposal }));
  const review = await api(page, `${taskPath}/task-candidates/${task.body.candidateId}`);
  const taskWritten = await api(page, `${taskPath}/task-candidates/${task.body.candidateId}`, json({ action: "write", expectedFingerprint: review.body.fingerprint }));
  const folderId = taskWritten.body.folderId;
  let files = (await api(page, `/api/projects/${projectId}/files`)).body;
  const issue = files.find((item) => item.taskFolderId === folderId);
  const changedTask = await api(page, `${root}/files/${issue.id}`, json({ projectId, action: "edit", content: "# 01 — 首项\n\n**What to build:** 用户可执行改进任务。\n\n**Blocked by:** None\n\n## 验收标准\n- [ ] 可以完成。" }));
  await api(page, `${taskPath}/task-candidates`, json({ content: proposal }));
  check("任务整套提交与手动修改建立唯一旧集合", taskWritten.status === 200 && changedTask.status === 200 && (await pool.query("SELECT previous_snapshot FROM task_folders WHERE id = ?", [folderId]))[0][0].previous_snapshot !== null);
  await api(page, `${root}/stages/prototype/sessions/${prototypeSessionId}/messages`, json({ content: "请生成可视化 HTML 原型" }));
  const snapshots = (await api(page, `/api/projects/${projectId}/snapshots?iterationId=${iterationId}`)).body;
  const snapshot = snapshots.find((item) => item.sessionId === prototypeSessionId);
  if (!snapshot) throw new Error("原型回放未生成 HTML 快照");
  const snapshotPath = `/api/projects/${projectId}/snapshots/${snapshot.id}`;
  const snapshotContent = (await api(page, snapshotPath)).body.content;
  const assets = async () => Object.fromEntries(await Promise.all(["project_files", "task_folders", "prototype_snapshots", "project_file_changes"].map(async (table) => [table, (await pool.query(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY id`, [projectId]))[0]])));
  const processState = async () => ({
    iteration: (await pool.query("SELECT * FROM product_iterations WHERE id = ?", [iterationId]))[0],
    stages: (await pool.query("SELECT * FROM iteration_stage_states WHERE iteration_id = ? ORDER BY stage", [iterationId]))[0],
    sessions: (await pool.query("SELECT * FROM iteration_sessions WHERE iteration_id = ? ORDER BY id", [iterationId]))[0],
    ...Object.fromEntries(await Promise.all(["iteration_session_messages", "iteration_session_context_files", "iteration_file_candidates", "iteration_task_set_candidates"].map(async (table) => [table, (await pool.query(`SELECT * FROM ${table} WHERE session_id IN (?) ORDER BY ${table === "iteration_session_context_files" ? "session_id, file_id" : "id"}`, [sessions]))[0]]))),
  });
  const beforeAssets = JSON.stringify(await assets());
  const outsider = await browser.newContext(); const stranger = await outsider.newPage();
  try {
    await stranger.goto(base); check("未登录不能删除迭代", (await api(stranger, root, { method: "DELETE" })).status === 401);
    await register(stranger, `verify-iteration-outsider-${Date.now()}@test.local`);
    check("跨账号删除被拒绝，所有者迭代保留", (await api(stranger, root, { method: "DELETE" })).status === 404 && (await api(page, root)).status === 200);
  } finally { await outsider.close(); }
  // 已完成事务的生成预留代表进行中的请求，覆盖同阶段非当前会话及其他阶段。
  for (const blockedSession of [otherSessionId, prototypeSessionId, taskSessionId]) {
    const messageId = randomUUID();
    await pool.execute("INSERT INTO iteration_session_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'assistant', '', 'generating', ?)", [messageId, blockedSession, new Date()]);
    const before = JSON.stringify(await processState());
    const blocked = await api(page, root, { method: "DELETE" });
    check(`非当前/跨阶段生成阻止删除 ${blockedSession === otherSessionId ? "analysis" : blockedSession === prototypeSessionId ? "prototype" : "tickets"}`, blocked.status === 409 && blocked.body.reason === "generating" && JSON.stringify(await processState()) === before && JSON.stringify(await assets()) === beforeAssets);
    if (blocked.status !== 409) throw new Error("正在生成的迭代未被阻止；确认 BASE_URL 服务已加载最新产品代码后再运行");
    await pool.execute("DELETE FROM iteration_session_messages WHERE id = ?", [messageId]);
  }
  // 独立连接分别持项目、迭代、非当前会话锁，避免只测第一把锁。
  for (const [table, id] of [["projects", projectId], ["product_iterations", iterationId], ["iteration_sessions", otherSessionId]]) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction(); await connection.query(`SELECT id FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
      const deleting = api(page, root, { method: "DELETE" });
      const conflict = await Promise.race([deleting, new Promise((resolve) => setTimeout(() => resolve(null), 2500))]);
      check(`${table} 写入锁立即 409，不排队后自动删除`, conflict?.status === 409 && conflict.body.reason === "writing");
      await connection.rollback();
      if (!conflict) { await deleting; throw new Error("删除请求排队等待写入锁，夹具可能被删"); }
      check(`${table} 冲突保留候选和资产`, (await api(page, root)).status === 200 && JSON.stringify(await assets()) === beforeAssets);
    } finally { await connection.rollback(); connection.release(); }
  }
  // 验证进程包装连接：归属查询建立 RR 快照后，其他事务提交生成预留。
  const originalGetConnection = pool.getConnection;
  const deletingConnection = await originalGetConnection.call(pool); const generatingConnection = await originalGetConnection.call(pool);
  const originalQuery = deletingConnection.query; let supplied = false; let injected = false; const raceMessage = randomUUID();
  try {
    await deletingConnection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    deletingConnection.query = async function (sql, values) {
      const result = await originalQuery.call(this, sql, values);
      if (!injected && typeof sql === "string" && sql.includes("SELECT i.project_id") && result[0].length) {
        await generatingConnection.beginTransaction();
        await generatingConnection.query("SELECT id FROM projects WHERE id = ? FOR UPDATE", [projectId]);
        await generatingConnection.query("SELECT id FROM product_iterations WHERE id = ? FOR UPDATE", [iterationId]);
        await generatingConnection.query("SELECT id FROM iteration_sessions WHERE id = ? FOR UPDATE", [otherSessionId]);
        await generatingConnection.execute("INSERT INTO iteration_session_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'assistant', '', 'generating', ?)", [raceMessage, otherSessionId, new Date()]);
        await generatingConnection.commit(); injected = true;
      }
      return result;
    };
    pool.getConnection = async function () { if (!supplied) { supplied = true; return deletingConnection; } return originalGetConnection.call(this); };
    const result = await deleteMysqlProductIteration(iterationId, ownerId);
    check("RR 归属快照后提交生成仍被当前读阻止", injected && result === "generating" && (await api(page, root)).status === 200);
  } finally {
    pool.getConnection = originalGetConnection; deletingConnection.query = originalQuery;
    if (!supplied) deletingConnection.release(); await generatingConnection.rollback(); generatingConnection.release();
    await pool.execute("DELETE FROM iteration_session_messages WHERE id = ?", [raceMessage]);
  }
  // 真 DELETE 执行后抛错：整个迭代级联过程必须回滚，产品不增加故障注入入口。
  const failingConnection = await originalGetConnection.call(pool); const originalExecute = failingConnection.execute; supplied = false; let deletedThenFailed = false;
  const beforeRollback = JSON.stringify(await processState());
  try {
    failingConnection.execute = async function (sql, values) {
      const result = await originalExecute.call(this, sql, values);
      if (typeof sql === "string" && sql.startsWith("DELETE FROM product_iterations")) { deletedThenFailed = true; throw new Error("验证事务回滚"); }
      return result;
    };
    pool.getConnection = async function () { if (!supplied) { supplied = true; return failingConnection; } return originalGetConnection.call(this); };
    let threw = false; try { await deleteMysqlProductIteration(iterationId, ownerId); } catch { threw = true; }
    check("实际 DELETE 后故障回滚迭代及全部过程", threw && deletedThenFailed && JSON.stringify(await processState()) === beforeRollback && JSON.stringify(await assets()) === beforeAssets);
  } finally { pool.getConnection = originalGetConnection; failingConnection.execute = originalExecute; if (!supplied) failingConnection.release(); }
  await page.goto(`${base}/projects/${projectId}`);
  const row = page.locator(`[data-iteration-id="${iterationId}"]`);
  const more = row.getByRole("button", { name: "保留成果的首轮 更多功能" });
  const openDelete = async () => { await more.click(); await row.getByRole("button", { name: "删除产品迭代", exact: true }).click(); await dialog.waitFor(); };
  const dialog = page.getByRole("alertdialog", { name: "删除产品迭代？" }); await openDelete();
  const copy = await dialog.innerText();
  check("确认完整说明丢失范围、成果保留、不可撤销和编号不复用", ["阶段会话", "消息", "上下文", "候选", "项目文件", "备份", "任务旧集合", "HTML 快照", "变更记录", "无法撤销", "不会复用"].every((text) => copy.includes(text)));
  check("默认聚焦取消，危险面板为不透明背景", await dialog.getByRole("button", { name: "取消", exact: true }).evaluate((node) => node === document.activeElement) && await dialog.evaluate((node) => !["transparent", "rgba(0, 0, 0, 0)"].includes(getComputedStyle(node).backgroundColor)));
  await page.keyboard.press("Shift+Tab"); check("确认框键盘焦点留在弹层", await dialog.evaluate((node) => node.contains(document.activeElement)));
  await mkdir(".impeccable/review", { recursive: true });
  await page.screenshot({ path: ".impeccable/review/iteration-delete-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: ".impeccable/review/iteration-delete-mobile.png", fullPage: true });
  check("移动删除确认无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= 390));
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  check("取消保留迭代且恢复更多按钮焦点", (await api(page, root)).status === 200 && await more.evaluate((node) => node === document.activeElement));
  await openDelete();
  await page.route(`**${root}`, async (route) => route.request().method() === "DELETE" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "删除未完成，请重试。" }) }) : route.continue());
  await dialog.getByRole("button", { name: "确认删除迭代" }).click(); await dialog.getByRole("alert").waitFor();
  check("500 保留对象和确认框，未显示成功", await row.count() === 1 && await dialog.isVisible() && await page.locator(".iteration-toast").count() === 0);
  await page.unroute(`**${root}`);
  const pending = randomUUID(); await pool.execute("INSERT INTO iteration_session_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'assistant', '', 'generating', ?)", [pending, prototypeSessionId, new Date()]);
  await dialog.getByRole("button", { name: "确认删除迭代" }).click(); await dialog.getByRole("link", { name: "前往工作区停止生成" }).waitFor();
  check("生成 409 保留对象、无成功提示并提供停止入口", await dialog.isVisible() && await row.count() === 1 && await page.locator(".iteration-toast").count() === 0 && (await api(page, root)).status === 200);
  await pool.execute("DELETE FROM iteration_session_messages WHERE id = ?", [pending]);
  await dialog.getByRole("button", { name: "确认删除迭代" }).click(); await dialog.waitFor({ state: "hidden" }); await row.waitFor({ state: "detached" });
  const remainingState = await processState();
  const deletedIteration = await api(page, root); const deletedSession = await api(page, sessionPath);
  const cleaned = Object.values(remainingState).every((rows) => rows.length === 0) && deletedIteration.status === 404 && deletedSession.status === 404;
  check("成功删除迭代、阶段、全部会话消息候选和上下文", cleaned);
  if (!cleaned) console.error("清理诊断", JSON.stringify({ counts: Object.fromEntries(Object.entries(remainingState).map(([key, rows]) => [key, rows.length])), iteration: deletedIteration, session: deletedSession }));
  check("文件正文/唯一备份、任务旧集合、HTML 及变更记录逐字段完全保留", JSON.stringify(await assets()) === beforeAssets);
  check("删除的上下文与普通/整套候选入口不能继续加载或写入", (await api(page, `${root}/stages/analysis/sessions/${sessionId}/context`, json({ fileId }))).status === 404 && (await write(candidate.id, "overwrite")).status === 404 && (await api(page, `${taskPath}/task-candidates/${task.body.candidateId}`, json({ action: "write", expectedFingerprint: review.body.fingerprint }))).status === 404);
  const history = (await api(page, `/api/projects/${projectId}/files/${fileId}/history`)).body;
  check("来源保留稳定编号名称快照且删除迭代无跳转 ID", history.changes.every((change) => change.iterationDeleted && change.iterationId === null && change.iterationNumber === 1 && change.iterationName === "保留成果的首轮"));
  files = (await api(page, `/api/projects/${projectId}/files`)).body;
  const folders = (await api(page, `/api/projects/${projectId}/task-folders`)).body;
  check("已删除所属迭代任务文件夹和文件都标记归档", folders.some((folder) => folder.id === folderId && folder.archived) && files.find((file) => file.id === issue.id).taskArchived);
  const nextIteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "新轮仅加载归档", goal: "验证归档只读" }));
  const nextId = nextIteration.body.id; const nextRoot = `/api/iterations/${nextId}`;
  check("删除后迭代编号递增不复用", nextIteration.body.iteration_number === 2);
  const nextSession = (await api(page, `${nextRoot}/stages/analysis/sessions`, { method: "POST" })).body.session.id;
  const loadedArchive = await api(page, `${nextRoot}/stages/analysis/sessions/${nextSession}/context`, json({ fileId: issue.id }));
  check("有效新会话可加载只读归档文件", loadedArchive.status === 200 && loadedArchive.body.fileIds.includes(issue.id));
  for (const [action, method, body] of [["edit", "POST", { action: "edit", content: "非法接管" }], ["rename", "PATCH", { action: "rename", filename: issue.filename.replace("首项", "接管") }], ["delete", "DELETE", {}], ["restore", "POST", { action: "restore" }]]) {
    const result = await api(page, `${nextRoot}/files/${issue.id}`, json({ projectId, ...body }, method));
    check(`新迭代不能 ${action} 归档 issue`, [403, 409].includes(result.status));
  }
  check("新迭代不能撤回归档任务整套", (await api(page, `${nextRoot}/task-folder`, json({ projectId, folderId, action: "restore" }, "PATCH"))).status === 403);
  check("归档权限拒绝未更改项目资产", JSON.stringify(await assets()) === beforeAssets);
  await api(page, nextRoot, { method: "DELETE" });
  await page.reload(); await page.getByRole("tab", { name: /^项目文件树/ }).click();
  await page.getByText("已删除迭代 · 只读归档", { exact: true }).first().waitFor();
  check("无当前迭代 UI 保留归档说明且不能加载上下文", await page.getByText("此处为只读浏览。编辑成果或加入 Agent 上下文，请先进入产品迭代工作区。", { exact: true }).isVisible() && await page.getByRole("button", { name: /^加入当前上下文/ }).count() === 0);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.locator(".project-tree-folder").first().scrollIntoViewIfNeeded(); await page.screenshot({ path: ".impeccable/review/iteration-archive-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator(".project-tree-folder").first().scrollIntoViewIfNeeded(); await page.screenshot({ path: ".impeccable/review/iteration-archive-mobile.png", fullPage: true });
  check("移动归档树无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= 390));
  await page.getByRole("button", { name: /需求分析-保留成果\.md/ }).click();
  const preview = page.getByRole("dialog", { name: "预览 需求分析-保留成果.md" }); await preview.getByRole("link", { name: "下载 需求分析-保留成果.md" }).waitFor();
  check("无当前迭代 Markdown 预览下载可用、正文编辑撤回隐藏", await preview.getByRole("link", { name: "下载 需求分析-保留成果.md" }).isVisible() && await preview.getByRole("button", { name: "编辑正文" }).count() === 0 && await preview.getByRole("button", { name: "撤回上次修改" }).count() === 0);
  await preview.getByRole("tab", { name: "文件详情与来源" }).click(); await preview.getByText(/迭代 01（已删除） · 保留成果的首轮/).first().waitFor();
  check("详情已删除来源为文本且改名/删除隐藏", await preview.locator(`a[href*="${iterationId}"]`).count() === 0 && await preview.getByRole("button", { name: "改名", exact: true }).count() === 0 && await preview.getByRole("button", { name: "删除文件" }).count() === 0);
  await preview.getByRole("button", { name: "关闭预览" }).click();
  await page.getByText("HTML 快照 · 项目全部版本", { exact: true }).click(); await page.getByRole("link", { name: "下载 HTML" }).waitFor();
  check("最后迭代删除后 HTML 正式入口仍能预览和下载", await page.getByRole("link", { name: "下载 HTML" }).isVisible() && await page.locator('iframe[title*="HTML 快照"]').count() === 1);
  const mdDownload = await page.request.get(`${base}/api/projects/${projectId}/files/${fileId}/download`);
  const htmlView = await page.request.get(`${base}${snapshotPath}?mode=view`); const htmlDownload = await page.request.get(`${base}${snapshotPath}?mode=download`);
  check("删除最后迭代后普通 MD 下载及 HTML 字节保留", mdDownload.status() === 200 && htmlView.status() === 200 && htmlDownload.status() === 200 && await htmlView.text() === snapshotContent && await htmlDownload.text() === snapshotContent);
  const record = await api(page, `/api/projects/${projectId}/work-records`, json({ name: "旧入口绕过验证" }));
  const tab = await api(page, `/api/work-records/${record.body.id}/tabs`, json({ agent_type: "requirement_analyst" }));
  const tabId = tab.body.tab.id;
  check("历史计数仍在且旧工作记录不能绕过无当前迭代编辑", (await pool.query("SELECT next_iteration_number FROM projects WHERE id = ?", [projectId]))[0][0].next_iteration_number > 1 && (await api(page, `/api/projects/${projectId}/files/${fileId}`, json({ content: "非法改写" }, "PATCH"))).status === 409);
  check("无当前迭代旧删除入口拒绝", (await api(page, `/api/projects/${projectId}/files/${fileId}`, { method: "DELETE" })).status === 409);
  check("无当前迭代旧创建入口拒绝", (await api(page, `/api/projects/${projectId}/files`, json({ filename: "需求分析.md", content: "# 非法创建", agent_type: "requirement_analyst", source_message_id: randomUUID() }))).status === 409);
  check("旧 tab 无法加载项目成果绕过阶段会话", (await api(page, `/api/tabs/${tabId}/files`, json({ file_id: fileId }))).status === 409 && (await api(page, `/api/tabs/${tabId}/files`)).body.files.length === 0);
  check("旧 HTML 创建入口不能绕过无当前迭代保护", (await api(page, `/api/projects/${projectId}/snapshots`, json({ content: "<!doctype html><html><body>非法新增</body></html>", tab_id: tabId }))).status === 409);
  check("所有无当前迭代拒绝均保持项目资产原样", JSON.stringify(await assets()) === beforeAssets);
  check("正式界面没有未捕获 console 异常", browserErrors.length === 0);
  // 主验收项目留给人工浏览归档；独立项目以同样真实路径证明项目删除的最终清理。
  const cleanupProjectId = (await api(page, "/api/projects", json({ name: "项目删除清理验证" }))).body.id;
  const cleanupIterationId = (await api(page, `/api/projects/${cleanupProjectId}/iterations`, json({ displayName: "完整清理", goal: "验证项目级联" }))).body.id;
  const cleanupRoot = `/api/iterations/${cleanupIterationId}`;
  const cleanupSession = (await api(page, `${cleanupRoot}/stages/analysis/sessions`, { method: "POST" })).body.session.id;
  const cleanupGenerated = await api(page, `${cleanupRoot}/stages/analysis/sessions/${cleanupSession}/messages`, json({ content: "请提出一份完整的需求分析候选" }));
  await api(page, `${cleanupRoot}/sessions/${cleanupSession}/candidates/${cleanupGenerated.body.messages.at(-1).candidate.id}`, json({ action: "write", filename: "需求分析-清理验证.md", expectedOperation: "create" }));
  const cleanupFileId = (await api(page, `/api/projects/${cleanupProjectId}/files`)).body[0].id;
  await api(page, `${cleanupRoot}/stages/analysis/sessions/${cleanupSession}/context`, json({ fileId: cleanupFileId }));
  await api(page, `${cleanupRoot}/stages/analysis/sessions/${cleanupSession}/messages`, json({ content: "请提出一份完整的需求分析候选" }));
  const cleanupTaskSession = (await api(page, `${cleanupRoot}/stages/tickets/sessions`, { method: "POST" })).body.session.id;
  const cleanupTaskPath = `${cleanupRoot}/sessions/${cleanupTaskSession}/task-candidates`;
  const cleanupTask = await api(page, cleanupTaskPath, json({ content: proposal }));
  const cleanupReview = await api(page, `${cleanupTaskPath}/${cleanupTask.body.candidateId}`);
  await api(page, `${cleanupTaskPath}/${cleanupTask.body.candidateId}`, json({ action: "write", expectedFingerprint: cleanupReview.body.fingerprint }));
  await api(page, cleanupTaskPath, json({ content: proposal }));
  const cleanupPrototype = (await api(page, `${cleanupRoot}/stages/prototype/sessions`, { method: "POST" })).body.session.id;
  await api(page, `${cleanupRoot}/stages/prototype/sessions/${cleanupPrototype}/messages`, json({ content: "请生成可视化 HTML 原型" }));
  const cleanupCounts = async () => Promise.all(["project_files", "task_folders", "prototype_snapshots", "project_file_changes"].map(async (table) => Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`, [cleanupProjectId]))[0][0].n)));
  check("项目最终清理夹具包含真实文件、任务集合、HTML 和来源", (await cleanupCounts()).every((n) => n > 0));
  // 项目删除在资产清理中途失败：独立连接使用当前读验证新工作台及资产整体恢复。
  const cleanupSessions = [cleanupSession, cleanupTaskSession, cleanupPrototype];
  const cleanupSnapshot = async () => {
    const connection = await pool.getConnection();
    try {
      const snapshot = {};
      const selections = [
        ["projects", "id = ?", [cleanupProjectId], "id"],
        ["product_iterations", "project_id = ?", [cleanupProjectId], "id"],
        ["iteration_stage_states", "iteration_id = ?", [cleanupIterationId], "stage"],
        ["iteration_sessions", "iteration_id = ?", [cleanupIterationId], "id"],
        ...["iteration_session_messages", "iteration_session_context_files", "iteration_file_candidates", "iteration_task_set_candidates"].map((table) => [table, "session_id IN (?)", [cleanupSessions], table === "iteration_session_context_files" ? "session_id, file_id" : "id"]),
        ...["project_files", "task_folders", "prototype_snapshots", "project_file_changes"].map((table) => [table, "project_id = ?", [cleanupProjectId], "id"]),
      ];
      for (const [table, where, values, order] of selections) {
        snapshot[table] = (await connection.query(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} FOR SHARE`, values))[0];
      }
      return snapshot;
    } finally { connection.release(); }
  };
  const cleanupBeforeRollback = await cleanupSnapshot();
  let projectDeletionFailed = false;
  try { await deleteMysqlProjectCascade(cleanupProjectId, ownerId, { failAfterStep: "project-files" }); }
  catch (error) { projectDeletionFailed = error.message.includes("project-files"); }
  check("项目资产清理故障逐字段回滚全部迭代、阶段、会话消息候选上下文与资产", projectDeletionFailed && Object.values(cleanupBeforeRollback).every((rows) => rows.length > 0) && JSON.stringify(await cleanupSnapshot()) === JSON.stringify(cleanupBeforeRollback));
  const deletedProject = await api(page, `/api/projects/${cleanupProjectId}`, { method: "DELETE" });
  check("只有删除项目才完整清理项目文件、任务集合、HTML 和永久来源", deletedProject.status === 200 && (await cleanupCounts()).every((n) => n === 0) && JSON.stringify(await assets()) === beforeAssets);
  const deletedProcessCounts = await Promise.all(["iteration_session_messages", "iteration_session_context_files", "iteration_file_candidates", "iteration_task_set_candidates"].map(async (table) => Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id IN (?)`, [[cleanupSession, cleanupTaskSession, cleanupPrototype]]))[0][0].n)));
  check("项目删除同时完整清理阶段会话的消息、候选与上下文", deletedProcessCounts.every((n) => n === 0));
  if (deletedProcessCounts.some((n) => n > 0)) console.error("项目过程清理诊断", JSON.stringify(deletedProcessCounts));
  console.log(`验收账号：${email}；验收项目：${base}/projects/${projectId}；四张截图：.impeccable/review/iteration-{delete,archive}-{desktop,mobile}.png`);
} catch (error) { check("验证流程完整运行", false); console.error(error); }
finally { await context.close(); await browser.close(); await closeMysqlPoolForTests(); }
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
