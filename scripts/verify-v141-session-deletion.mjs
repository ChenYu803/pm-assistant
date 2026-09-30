// v1.41 #16：会话删除、生成/写入互斥、成果保留与正式界面；固定回放，不调用真实模型。
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { getMysqlPool, closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { deleteMysqlIterationSession } from "../src/lib/mysql-iteration-workbench.ts";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") { console.error("❌ 本验证要求 AI_MODE=replay"); process.exit(1); }
const base = process.env.BASE_URL || "http://localhost:3000";
let pass = 0; let fail = 0;
function check(name, okay) { if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}`); } }
const json = (body, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init); const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, init });
}
await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage(); page.setDefaultTimeout(15000);
try {
  await page.goto(`${base}/register`);
  await page.fill("#email", `verify-session-delete-${Date.now()}@test.local`);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", json({ name: "阶段会话删除验证" }));
  const projectId = project.body.id;
  const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "保留成果的首轮", goal: "验证会话删除边界" }));
  const iterationId = iteration.body.id; const root = `/api/iterations/${iterationId}`;
  const create = async (stage = "analysis") => (await api(page, `${root}/stages/${stage}/sessions`, { method: "POST" })).body.session.id;
  const sessionId = await create(); const otherId = await create();
  const path = `${root}/sessions/${sessionId}`;
  const pool = getMysqlPool();
  const count = async (table, id = sessionId) => Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id = ?`, [id]))[0][0].n);
  const generate = () => api(page, `${root}/stages/analysis/sessions/${sessionId}/messages`, json({ content: "请提出一份完整的需求分析候选" }));
  const first = await generate(); const candidate = first.body.messages.at(-1).candidate;
  const write = (id, operation) => api(page, `${path}/candidates/${id}`, json({ action: "write", filename: "需求分析-保留成果.md", expectedOperation: operation }));
  const written = await write(candidate.id, "create");
  check("候选确认写入项目文件", written.status === 200);
  const second = await generate();
  await write(second.body.messages.at(-1).candidate.id, "overwrite");
  await generate();
  const fileId = written.body.fileId;
  await api(page, `${root}/stages/analysis/sessions/${sessionId}/context`, json({ fileId }, "POST"));
  const asset = async () => (await pool.query("SELECT id, filename, content, previous_content, version FROM project_files WHERE id = ?", [fileId]))[0][0];
  const changes = async () => (await pool.query("SELECT * FROM project_file_changes WHERE project_id = ? ORDER BY change_sequence", [projectId]))[0];
  const beforeFile = await asset(); const beforeChanges = await changes();
  const historyPath = `/api/projects/${projectId}/files/${fileId}/history`;
  const beforeHistory = await api(page, historyPath);
  check("删除前来源详情记录存续会话和上一版", beforeHistory.status === 200 && beforeHistory.body.canUndo && beforeHistory.body.changes.every((change) => change.sessionDeleted === false));
  const anotherIteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "隔离删除验证", goal: "验证 UUID 归属" }));
  check("同账号跨迭代 UUID 删除返回 404", (await api(page, `/api/iterations/${anotherIteration.body.id}/sessions/${sessionId}`, { method: "DELETE" })).status === 404 && (await api(page, path)).status === 200);
  check("会话包含消息、上下文与未确认候选", await count("iteration_session_messages") > 0 && await count("iteration_session_context_files") === 1 && await count("iteration_file_candidates") === 3);
  // 确定性交错：删除事务的归属查询先建立 RR 快照，另一连接再提交生成预留。
  // 只在验证进程包装连接，产品无故障注入；后续当前读必须看见新预留并拒绝删除。
  const raceSession = await create(); const raceMessage = randomUUID();
  const ownerId = (await pool.query("SELECT user_id FROM projects WHERE id = ?", [projectId]))[0][0].user_id;
  const originalGetConnection = pool.getConnection;
  const deletingConnection = await originalGetConnection.call(pool);
  const generatingConnection = await originalGetConnection.call(pool);
  const originalQuery = deletingConnection.query;
  let injected = false; let supplied = false;
  try {
    await deletingConnection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    deletingConnection.query = async function (sql, values) {
      const result = await originalQuery.call(this, sql, values);
      if (!injected && typeof sql === "string" && sql.includes("SELECT i.project_id") && sql.includes("JOIN iteration_sessions") && result[0].length) {
        await generatingConnection.beginTransaction();
        await generatingConnection.query("SELECT id FROM projects WHERE id = ? FOR UPDATE", [projectId]);
        await generatingConnection.query("SELECT id FROM product_iterations WHERE id = ? FOR UPDATE", [iterationId]);
        await generatingConnection.query("SELECT id FROM iteration_sessions WHERE id = ? FOR UPDATE", [raceSession]);
        await generatingConnection.execute("INSERT INTO iteration_session_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'assistant', '', 'generating', ?)", [raceMessage, raceSession, new Date()]);
        await generatingConnection.commit();
        injected = true;
      }
      return result;
    };
    pool.getConnection = async function () {
      if (!supplied) { supplied = true; return deletingConnection; }
      return originalGetConnection.call(this);
    };
    const result = await deleteMysqlIterationSession(iterationId, raceSession, ownerId);
    check("RR 快照建立后提交的生成预留仍阻止删除", injected && result === "generating" && (await api(page, `${root}/sessions/${raceSession}`)).status === 200 && await count("iteration_session_messages", raceSession) === 1);
  } finally {
    pool.getConnection = originalGetConnection;
    deletingConnection.query = originalQuery;
    if (!supplied) deletingConnection.release();
    await generatingConnection.rollback(); generatingConnection.release();
    await pool.execute("DELETE FROM iteration_session_messages WHERE id = ? AND session_id = ?", [raceMessage, raceSession]);
    await api(page, `${root}/sessions/${raceSession}`, { method: "DELETE" });
  }
  const pendingId = randomUUID();
  await pool.execute("INSERT INTO iteration_session_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'assistant', '', 'generating', ?)", [pendingId, sessionId, new Date()]);
  const blocked = await api(page, path, { method: "DELETE" });
  check("生成中服务端拒绝删除并给出停止或等待动作", blocked.status === 409 && /停止|等待/.test(blocked.body.error));
  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  const row = page.locator(".session-list-item").filter({ has: page.locator(`[data-session-id="${sessionId}"]`) });
  await row.getByRole("button", { name: /^删除会话/ }).click();
  const dialog = page.getByRole("alertdialog", { name: "删除阶段会话？" });
  await dialog.waitFor();
  check("生成中确认禁用，提供查看生成会话入口", await dialog.getByRole("button", { name: "确认删除会话" }).isDisabled() && await dialog.getByRole("button", { name: "查看会话并停止生成" }).count() === 1);
  await dialog.getByRole("button", { name: "查看会话并停止生成" }).click();
  const stopped = page.waitForResponse((response) => response.url().endsWith(`${path}/stop`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  check("停止请求成功完成", (await stopped).status() === 200);
  await page.locator(".stop-generation-button").waitFor({ state: "hidden" });
  await page.locator(".stage-generation-note").waitFor({ state: "hidden" });
  check("停止后会话与候选仍保留", (await api(page, path)).status === 200 && await count("iteration_file_candidates") === 3);
  // 删除另一条会话时，当前会话的草稿、选择和上下文不能被一起清空。
  const spareId = await create();
  await page.reload();
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="输入消息"]').disabled);
  const draft = "这份当前草稿应在删除其他会话后保留";
  await page.getByRole("textbox", { name: "输入消息" }).fill(draft);
  const spareRow = page.locator(".session-list-item").filter({ has: page.locator(`[data-session-id="${spareId}"]`) });
  await spareRow.getByRole("button", { name: /^删除会话/ }).click();
  await dialog.getByRole("button", { name: "确认删除会话" }).click(); await dialog.waitFor({ state: "hidden" });
  const currentContext = await api(page, `${root}/stages/analysis/sessions/${sessionId}/context`);
  check("删除非当前会话保留当前草稿、选择与上下文", await page.getByRole("textbox", { name: "输入消息" }).inputValue() === draft && await page.locator(`[data-session-id="${sessionId}"]`).getAttribute("aria-current") === "page" && currentContext.body.fileIds.includes(fileId));
  // 模拟确认写入事务正在持有项目、迭代和会话锁，删除须立即冲突，不能排队后静默删除。
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("SELECT id FROM projects WHERE id = ? FOR UPDATE", [projectId]);
    await connection.query("SELECT id FROM product_iterations WHERE id = ? FOR UPDATE", [iterationId]);
    await connection.query("SELECT id FROM iteration_sessions WHERE id = ? FOR UPDATE", [sessionId]);
    const deleting = api(page, path, { method: "DELETE" });
    const conflict = await Promise.race([deleting, new Promise((resolve) => setTimeout(() => resolve(null), 2500))]);
    check("写入中立即拒绝删除并说明等待后重试", conflict?.status === 409 && /等待|重试/.test(conflict.body.error));
    await connection.rollback();
    // 红阶段可能排队删除，等待收尾后直接退出，避免用已删除夹具继续浏览器验证。
    if (!conflict) { await deleting; throw new Error("删除请求在写入锁释放后才执行，写入互斥未实现"); }
  } finally { await connection.rollback(); connection.release(); }
  await row.getByRole("button", { name: /^删除会话/ }).click(); await dialog.waitFor();
  const copy = await dialog.innerText();
  check("确认区分丢失内容、保留成果与不可撤销", ["消息", "过程状态", "上下文", "未确认", "项目文件", "上一版", "变更记录", "无法撤销"].every((text) => copy.includes(text)));
  check("默认焦点落在取消", await dialog.getByRole("button", { name: "取消", exact: true }).evaluate((node) => node === document.activeElement));
  check("确认框使用不透明背景", await dialog.evaluate((node) => !["transparent", "rgba(0, 0, 0, 0)"].includes(getComputedStyle(node).backgroundColor)));
  await mkdir(".impeccable/review", { recursive: true });
  await page.screenshot({ path: ".impeccable/review/session-delete-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/session-delete-mobile.png", fullPage: true });
  check("390px 确认区没有横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= 390));
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  check("取消不删除会话", (await api(page, path)).status === 200);
  await row.getByRole("button", { name: /^删除会话/ }).click();
  await page.route(`**${path}`, async (route) => route.request().method() === "DELETE" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "删除未完成，请重试。" }) }) : route.continue());
  await dialog.getByRole("button", { name: "确认删除会话" }).click();
  await dialog.getByRole("alert").waitFor();
  check("删除失败保留确认和会话，可原位重试", await dialog.isVisible() && (await api(page, path)).status === 200);
  await page.unroute(`**${path}`);
  await dialog.getByRole("button", { name: "确认删除会话" }).click(); await dialog.waitFor({ state: "hidden" });
  check("确认后会话消失，其他会话保留", await row.count() === 0 && (await api(page, path)).status === 404 && (await api(page, `${root}/sessions/${otherId}`)).status === 200);
  check("消息、上下文与候选由事务级联清理", await count("iteration_session_messages") === 0 && await count("iteration_session_context_files") === 0 && await count("iteration_file_candidates") === 0);
  check("项目正文、上一版与修订不受会话删除影响", JSON.stringify(await asset()) === JSON.stringify(beforeFile));
  check("来源记录原样保留名称和消息快照", beforeChanges.length === 2 && JSON.stringify(await changes()) === JSON.stringify(beforeChanges) && beforeChanges.every((change) => change.session_name && change.message_id));
  const afterHistory = await api(page, historyPath);
  check("删除后来源详情保留快照并标记会话已删除", afterHistory.status === 200 && afterHistory.body.canUndo && afterHistory.body.changes.length === beforeHistory.body.changes.length && afterHistory.body.changes.every((change, index) => change.sessionDeleted === true && change.sessionName === beforeHistory.body.changes[index].sessionName && change.id === beforeHistory.body.changes[index].id));
  const restored = await api(page, `${root}/files/${fileId}`, json({ projectId, action: "restore" }));
  check("会话删除后上一版仍可实际撤回", restored.status === 200 && (await asset()).content === beforeFile.previous_content && (await api(page, historyPath)).body.canUndo === false);
  check("已删除会话上下文与候选 API 不可再访问", (await api(page, `${root}/stages/analysis/sessions/${sessionId}/context`)).status === 404 && (await write(candidate.id, "overwrite")).status === 404);
  const otherRow = page.locator(".session-list-item").filter({ has: page.locator(`[data-session-id="${otherId}"]`) });
  await otherRow.getByRole("button", { name: /^删除会话/ }).click();
  await dialog.getByRole("button", { name: "确认删除会话" }).click(); await dialog.waitFor({ state: "hidden" });
  check("最后一个会话删除后可重新开始，无残留输入或上下文", await page.getByRole("button", { name: "开始本阶段工作" }).isVisible() && await page.getByRole("textbox", { name: "输入消息" }).inputValue() === "");
  check("删除所有会话不自动完成或重置阶段", (await api(page, `${root}/workbench`)).body.stages.find((stage) => stage.key === "analysis").status === "in_progress");
  await page.reload(); await page.getByRole("button", { name: "开始本阶段工作" }).waitFor();
  check("刷新不恢复已删除会话", await page.locator(".session-row").count() === 0);
  await page.getByRole("button", { name: "开始本阶段工作" }).click(); await page.getByText("这个会话还没有消息", { exact: true }).waitFor();
  check("删除后可新建独立空会话", await page.locator(".session-row").count() === 1);
  // 任务阶段的手动整套候选也随会话删除，项目级整套撤回快照保留。
  const taskSession = await create("tickets"); const taskPath = `${root}/sessions/${taskSession}`;
  const proposal = "%%%FILE_BEGIN%%% issues/01-首项.md\n# 01 — 首项\n\n**What to build:** 用户可执行任务。\n\n**Blocked by:** None\n\n## 验收标准\n- [ ] 可以完成。\n%%%FILE_END%%%";
  const task = await api(page, `${taskPath}/task-candidates`, json({ content: proposal }));
  const review = await api(page, `${taskPath}/task-candidates/${task.body.candidateId}`);
  const taskWritten = await api(page, `${taskPath}/task-candidates/${task.body.candidateId}`, json({ action: "write", expectedFingerprint: review.body.fingerprint }));
  await api(page, `${taskPath}/task-candidates`, json({ content: proposal }));
  const folder = async () => (await pool.query("SELECT * FROM task_folders WHERE id = ?", [taskWritten.body.folderId]))[0][0];
  const folderBefore = await folder();
  await api(page, `${root}/stages/tickets/complete`, { method: "POST" });
  await api(page, taskPath, { method: "DELETE" });
  check("任务会话候选删除，正式文件夹与整套旧集合保留", await count("iteration_task_set_candidates", taskSession) === 0 && JSON.stringify(await folder()) === JSON.stringify(folderBefore) && folderBefore.previous_snapshot !== null);
  check("删除完成阶段的会话不改变已完成状态", (await api(page, `${root}/workbench`)).body.stages.find((stage) => stage.key === "tickets").status === "completed");
  // HTML 是项目独立资产；通过真实回放生成快照，删除会话后仍可回看和下载。
  const prototypeSession = await create("prototype");
  await api(page, `${root}/stages/prototype/sessions/${prototypeSession}/messages`, json({ content: "请生成可视化 HTML 原型" }));
  const snapshotsPath = `/api/projects/${projectId}/snapshots?iterationId=${iterationId}`;
  const snapshotsBefore = await api(page, snapshotsPath);
  const snapshot = snapshotsBefore.body.find((item) => item.sessionId === prototypeSession);
  if (!snapshot) throw new Error("原型回放未生成 HTML 快照，无法验证资产保留");
  const snapshotPath = `/api/projects/${projectId}/snapshots/${snapshot.id}`;
  const snapshotBefore = await api(page, snapshotPath);
  const deletedPrototype = await api(page, `${root}/sessions/${prototypeSession}`, { method: "DELETE" });
  const snapshotAfter = await api(page, snapshotPath);
  const preview = await page.request.get(`${base}${snapshotPath}?mode=view`);
  const download = await page.request.get(`${base}${snapshotPath}?mode=download`);
  check("原型会话删除后 HTML 列表、详情、预览与下载保留", deletedPrototype.status === 200 && await count("iteration_session_messages", prototypeSession) === 0 && JSON.stringify((await api(page, snapshotsPath)).body) === JSON.stringify(snapshotsBefore.body) && JSON.stringify(snapshotAfter.body) === JSON.stringify(snapshotBefore.body) && preview.status() === 200 && download.status() === 200 && await preview.text() === snapshotBefore.body.content && await download.text() === snapshotBefore.body.content);
  // 其他用户即使知道 UUID 也不能删除成果所属会话。
  const outsider = await browser.newContext(); const stranger = await outsider.newPage();
  try {
    await stranger.goto(base);
    check("未登录不能删除", (await api(stranger, `${root}/sessions/${otherId}`, { method: "DELETE" })).status === 401);
    await stranger.goto(`${base}/register`); await stranger.fill("#email", `verify-session-outsider-${Date.now()}@test.local`);
    await stranger.locator('input[type="password"]').first().fill("verify-pass-1234"); await stranger.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
    await stranger.locator('form button[type="submit"]').click(); await stranger.waitForURL((url) => url.pathname === "/projects");
    const liveId = (await api(page, `${root}/workbench`)).body.stages.find((stage) => stage.key === "analysis").sessions[0].id;
    check("其他账号删除请求返回 404，所有者会话保留", (await api(stranger, `${root}/sessions/${liveId}`, { method: "DELETE" })).status === 404 && (await api(page, `${root}/sessions/${liveId}`)).status === 200);
  } finally { await outsider.close(); }
  console.log(`验收项目：${base}/projects/${projectId}/iterations/${iterationId}`);
} finally { await context.close(); await browser.close(); await closeMysqlPoolForTests(); }
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
