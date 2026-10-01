// v1.41 #15：整套撤回、失败回滚、恢复来源、唯一快照与正式界面反馈；不调用模型。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { getMysqlPool, closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") { console.error("❌ 本验证要求 AI_MODE=replay"); process.exit(1); }
const base = process.env.BASE_URL || "http://localhost:3000";
let pass = 0; let fail = 0;
function check(name, okay) { if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}`); } }
const json = (body, method = "POST", headers = {}) => ({ method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init); const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, init });
}
const ticket = (number, suffix, content) => `%%%FILE_BEGIN%%% issues/${String(number).padStart(2, "0")}-${suffix}.md\n# ${String(number).padStart(2, "0")} — ${suffix}\n\n**What to build:** ${content}\n\n**Blocked by:** None\n\n## 验收标准\n- [ ] 用户能看到操作后的完整结果。\n%%%FILE_END%%%`;
const block = (issue, suffix = issue.filename.split("/").at(-1).replace(/^\d+-|\.md$/g, ""), content = issue.content) => `%%%FILE_BEGIN%%% issues/${String(issue.issue_number).padStart(2, "0")}-${suffix}.md\n${content}\n%%%FILE_END%%%`;

await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage(); page.setDefaultTimeout(20000);
try {
  await page.goto(`${base}/register`);
  await page.fill("#email", `verify-task-undo-${Date.now()}@test.local`);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", json({ name: "整套任务撤回验证" }));
  const projectId = project.body.id;
  const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "撤回首轮", goal: "验证整个任务集合" }));
  const iterationId = iteration.body.id;
  const other = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "只读次轮", goal: "权限边界" }));
  const session = await api(page, `/api/iterations/${iterationId}/stages/tickets/sessions`, { method: "POST" });
  const sessionId = session.body.session.id;
  const folder = await api(page, `/api/iterations/${iterationId}/task-folder`, json({ projectId }));
  const folderId = folder.body.id;
  const folderPath = `/api/iterations/${iterationId}/task-folder`;
  const candidatePath = `/api/iterations/${iterationId}/sessions/${sessionId}/task-candidates`;
  const pool = getMysqlPool();
  const issues = async () => (await pool.query("SELECT id, issue_number, filename, content, version FROM project_files WHERE task_folder_id = ? ORDER BY issue_number", [folderId]))[0];
  const changes = async () => (await pool.query("SELECT * FROM project_file_changes WHERE task_folder_id = ? ORDER BY change_sequence", [folderId]))[0];
  const snapshot = async () => (await pool.query("SELECT previous_snapshot, next_issue_number FROM task_folders WHERE id = ?", [folderId]))[0][0];
  const restore = (headers = {}) => api(page, folderPath, json({ projectId, folderId, action: "restore" }, "PATCH", headers));
  const propose = async (content) => {
    const result = await api(page, candidatePath, json({ content }));
    if (result.status !== 201) throw new Error(`候选创建失败：${JSON.stringify(result)}`);
    return result.body.candidateId;
  };
  const commit = async (content) => {
    const id = await propose(content);
    const review = await api(page, `${candidatePath}/${id}`);
    const result = await api(page, `${candidatePath}/${id}`, json({ action: "write", expectedFingerprint: review.body.fingerprint }));
    if (result.status !== 200) throw new Error(`整套提交失败：${JSON.stringify(result)}`);
  };
  const openTree = async () => {
    const toggle = page.getByRole("button", { name: "展开文件区" });
    if (await page.getByRole("navigation", { name: "工作台区域" }).isVisible()) await page.getByRole("navigation", { name: "工作台区域" }).getByRole("button", { name: /文件与上下文/ }).click();
    else if (await toggle.count()) await toggle.click();
    await page.getByRole("tab", { name: /项目文件树/ }).click();
    // 其他迭代可能尚无所属文件夹，等待文件树本身而非当前文件夹。
    await page.locator(".project-tree").waitFor();
    await page.getByText("正在加载任务文件夹…", { exact: true }).waitFor({ state: "hidden" });
  };
  const undoButton = page.getByRole("button", { name: "撤回上次任务修改", exact: true });
  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await openTree();
  check("无快照保留禁用入口并说明原因", await undoButton.isDisabled() && (await page.locator(".project-tree").innerText()).includes("没有可撤回的旧集合"));
  check("无快照撤回请求拒绝且无变更记录", (await restore()).status === 409 && (await changes()).length === 0);
  await propose([ticket(1, "正文更新", "原始正文一"), ticket(2, "将被删除", "原始正文二"), ticket(3, "仅改名字", "原始正文三"), ticket(4, "保持不变", "原始正文四")].join("\n\n"));
  await page.reload(); await openTree();
  await page.getByRole("region", { name: "任务集合候选" }).last().getByRole("button", { name: "确认整套提交" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "撤回上次任务修改" && !button.disabled));
  check("首次整套提交无需刷新即建立撤回机会", await undoButton.isEnabled());
  const initial = await issues();
  await page.reload(); await openTree();
  await propose([block(initial[0], "正文与名称都改变", initial[0].content + "\n\n本轮补充正文。"),
    block(initial[2], "只改后缀的名称"), block(initial[3]), ticket(5, "本轮新增", "新增任务正文")].join("\n\n"));
  await page.reload(); await openTree();
  const candidate = page.getByRole("region", { name: "任务集合候选" }).last();
  await candidate.getByRole("button", { name: "确认整套提交" }).click();
  await candidate.getByText("整套任务已提交到本迭代文件夹。", { exact: true }).waitFor();
  await page.locator(".project-tree-name").filter({ hasText: "本轮新增" }).waitFor();
  check("正式整套提交后无需刷新即可撤回", await undoButton.isEnabled());
  const mixed = await issues(); const beforeChanges = await changes(); const beforeSnapshot = await snapshot();
  check("混合集合包含更新、删除、改名、新增与保留", mixed.length === 4 && mixed[0].version === 2 && !mixed.some((issue) => issue.id === initial[1].id) && mixed.some((issue) => issue.issue_number === 5));
  check("跨迭代不可消耗旧集合", (await api(page, `/api/iterations/${other.body.id}/task-folder`, json({ projectId, folderId, action: "restore" }, "PATCH"))).status === 403 && JSON.stringify(await snapshot()) === JSON.stringify(beforeSnapshot));
  const anonymous = await browser.newContext();
  const unauthorized = await anonymous.request.patch(`${base}${folderPath}`, { data: { projectId, folderId, action: "restore" } });
  check("未登录不能撤回", unauthorized.status() === 401);
  await anonymous.close();
  await undoButton.click();
  const confirmation = page.locator(".task-folder-undo-confirm");
  check("确认标出所属文件夹和整套恢复后果", (await confirmation.innerText()).includes("迭代 01") && (await confirmation.innerText()).includes("移除新增 issue") && (await confirmation.innerText()).includes("不能重做"));
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  check("取消撤回不改变正文、快照或来源", JSON.stringify(await issues()) === JSON.stringify(mixed) && JSON.stringify(await snapshot()) === JSON.stringify(beforeSnapshot) && (await changes()).length === beforeChanges.length);
  await undoButton.click();
  await mkdir(".impeccable/review", { recursive: true });
  await confirmation.screenshot({ path: ".impeccable/review/task-undo-confirm-desktop.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  // 窄屏需要显式切到文件区；区域切换保留已打开的整套撤回确认。
  await page.getByRole("navigation", { name: "工作台区域" }).getByRole("button", { name: /文件与上下文/ }).click();
  await confirmation.screenshot({ path: ".impeccable/review/task-undo-confirm-mobile.png", animations: "disabled" });
  check("390px 确认区无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // 用正式回放故障入口验证写入后事务回滚，界面保留确认供重试。
  await page.route(`**/api/iterations/${iterationId}/task-folder`, async (route) => {
    const response = await route.fetch({ headers: { ...route.request().headers(), "x-pm-assistant-test-task-failure": "1" } });
    await route.fulfill({ response });
  });
  await confirmation.getByRole("button", { name: "确认撤回整套" }).click();
  await page.getByRole("alert").filter({ hasText: "撤回任务集合失败，原集合未改变" }).waitFor();
  check("失败后集合、修订、路径、快照、序号及来源整体回滚", JSON.stringify(await issues()) === JSON.stringify(mixed) && JSON.stringify(await snapshot()) === JSON.stringify(beforeSnapshot) && (await changes()).length === beforeChanges.length);
  check("失败后保留原确认且可以重试", await confirmation.getByRole("button", { name: "确认撤回整套" }).isEnabled());
  await page.unroute(`**/api/iterations/${iterationId}/task-folder`);
  await confirmation.getByRole("button", { name: "确认撤回整套" }).click();
  const result = page.locator(".task-folder-restore-result");
  await result.getByText("整套任务已恢复。旧集合已消耗，本次撤回不能重做。", { exact: true }).waitFor();
  const restored = await issues(); const restoreChanges = (await changes()).slice(beforeChanges.length);
  check("完整恢复旧集合稳定身份、序号、路径与正文", restored.length === initial.length && restored.every((issue) => initial.some((old) => old.id === issue.id && old.issue_number === issue.issue_number && old.filename === issue.filename && old.content === issue.content)));
  check("更新正文及恢复被删项产生递增 restore 修订", restored[0].version === 3 && restored[1].version === 2 && restoreChanges.filter((change) => change.operation === "restore").length === 2);
  check("纯改名恢复和未变项不增加正文修订", restored[2].version === 1 && restored[3].version === 1 && restoreChanges.some((change) => change.file_id === initial[2].id && change.operation === "rename" && change.content_revision === null) && !restoreChanges.some((change) => change.file_id === initial[3].id));
  check("本轮新增项移除且保留删除记录", !restored.some((issue) => issue.issue_number === 5) && restoreChanges.some((change) => change.operation === "delete" && change.file_id === mixed.find((issue) => issue.issue_number === 5).id));
  check("恢复记录同属一个新变更组并归因用户", restoreChanges.length === 4 && new Set(restoreChanges.map((change) => change.task_change_group_id)).size === 1 && restoreChanges[0].task_change_group_id !== beforeChanges.at(-1).task_change_group_id && restoreChanges.every((change) => change.actor === "user" && change.session_id === null && change.message_id === null));
  check("快照消耗但序号计数器不倒退", (await snapshot()).previous_snapshot === null && (await snapshot()).next_issue_number === 6);
  const restoreSummary = await result.locator(".task-set-summary").innerText();
  check("结果反馈分别说明恢复被删、还原正文、改名和移除新增", /恢复被删\s+1/.test(restoreSummary) && /还原正文\s+1/.test(restoreSummary) && /恢复文件名\s+2/.test(restoreSummary) && /移除新增\s+1/.test(restoreSummary));
  await result.getByText("查看恢复明细", { exact: true }).click();
  check("恢复明细包含恢复项与不变项且无内部修订号", await result.locator(".task-set-row").count() === 5 && (await result.innerText()).includes("保持不变") && !(await result.innerText()).includes("修订"));
  await result.screenshot({ path: ".impeccable/review/task-undo-result-mobile.png", animations: "disabled" });
  check("390px 结果区无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 900 });
  await result.screenshot({ path: ".impeccable/review/task-undo-result-desktop.png", animations: "disabled" });
  check("消耗后入口禁用且没有重做入口", await undoButton.isDisabled() && await page.getByRole("button", { name: /重做/ }).count() === 0);
  const afterRestoreChanges = (await changes()).length;
  check("重复撤回被拒绝且不再新增来源或修订", (await restore()).status === 409 && (await changes()).length === afterRestoreChanges && JSON.stringify(await issues()) === JSON.stringify(restored));
  const detail = await api(page, `/api/projects/${projectId}/files/${initial[0].id}/history`);
  check("详情最近正文来源指向用户撤回", detail.status === 200 && detail.body.lastContentChange.operation === "restore" && detail.body.lastContentChange.actor === "user" && !detail.body.canUndo);
  const downloaded = await page.request.get(`${base}/api/projects/${projectId}/files/${initial[0].id}/download`);
  check("下载使用恢复后的纯正文", downloaded.status() === 200 && (await downloaded.text()) === initial[0].content);
  await page.reload(); await openTree();
  check("刷新后无快照状态保持", await undoButton.isDisabled() && (await page.locator(".project-tree").innerText()).includes("没有可撤回的旧集合"));
  const issuePath = `/api/iterations/${iterationId}/files/${initial[0].id}`;
  await api(page, issuePath, json({ projectId, action: "edit", content: initial[0].content + "\n\n修改甲" }));
  await api(page, issuePath, json({ projectId, action: "edit", content: initial[0].content + "\n\n修改乙" }));
  const beforeConcurrentChanges = (await changes()).length;
  const concurrent = await Promise.all([restore(), restore()]);
  check("并发撤回仅一个成功，其余看到已消耗快照", concurrent.map((response) => response.status).sort().join(",") === "200,409");
  const concurrentResult = concurrent.find((response) => response.status === 200).body;
  check("API 返回实际恢复明细与不可撤回状态", concurrentResult.canUndo === false && concurrentResult.folderId === folderId && concurrentResult.entries.filter((entry) => entry.change === "content").length === 1);
  check("成功修改替换唯一快照，仅恢复紧邻旧集合", (await issues())[0].content === initial[0].content + "\n\n修改甲" && (await changes()).length === beforeConcurrentChanges + 1 && (await snapshot()).previous_snapshot === null);
  const beforeRename = await issues();
  await api(page, issuePath, json({ projectId, action: "rename", filename: "issues/iteration-1/01-改名后撤回.md" }, "PATCH"));
  const renameResult = await restore();
  check("纯改名整套撤回返回改名明细且修订保持", renameResult.body.entries.filter((entry) => entry.change === "rename").length === 1 && (await issues())[0].version === beforeRename[0].version && (await issues())[0].filename === initial[0].filename);
  await commit("%%%TASK_SET_EMPTY%%%");
  check("清空后仍有非空撤回快照", (await issues()).length === 0 && (await snapshot()).previous_snapshot !== null);
  const emptyRestore = await restore();
  check("清空后的整套撤回恢复全部稳定身份", emptyRestore.status === 200 && emptyRestore.body.entries.every((entry) => entry.change === "restored") && (await issues()).every((issue) => beforeRename.some((old) => old.id === issue.id)));
  await commit((await issues()).map((issue) => block(issue)).join("\n\n"));
  check("无实际差异提交不制造撤回机会", (await snapshot()).previous_snapshot === null && (await restore()).status === 409);
  await commit([...(await issues()).map((issue) => block(issue)), ticket(5, "新增仍不复用", "新的任务正文")].join("\n\n"));
  check("撤回删除新增项后下一次新建序号不复用", (await issues()).at(-1).issue_number === 6);
  await restore();
  await page.reload(); await openTree();
  const treeCount = await page.locator(".project-tree-folder > summary small").first().innerText();
  check("文件夹当前集合计数不包含已删除占位", treeCount === "4 个 issue");
  await page.goto(`${base}/projects/${projectId}/iterations/${other.body.id}`); await openTree();
  check("其他迭代没有撤回入口", await undoButton.count() === 0 && (await page.locator(".project-tree").innerText()).includes("其他迭代 · 只读"));
  // 用另一文件夹的首次写入验证 [] 是有效旧集合，而不是“没有快照”。
  const otherSession = await api(page, `/api/iterations/${other.body.id}/stages/tickets/sessions`, { method: "POST" });
  const otherPath = `/api/iterations/${other.body.id}/sessions/${otherSession.body.session.id}/task-candidates`;
  const firstCandidate = await api(page, otherPath, json({ content: ticket(1, "首次任务", "首次正文") }));
  const firstReview = await api(page, `${otherPath}/${firstCandidate.body.candidateId}`);
  const firstWritten = await api(page, `${otherPath}/${firstCandidate.body.candidateId}`, json({ action: "write", expectedFingerprint: firstReview.body.fingerprint }));
  const firstUndo = await api(page, `/api/iterations/${other.body.id}/task-folder`, json({ projectId, folderId: firstWritten.body.folderId, action: "restore" }, "PATCH"));
  check("首次整套写入可撤回到空集合", firstUndo.status === 200 && firstUndo.body.entries.length === 1 && firstUndo.body.entries[0].change === "removed");
  await api(page, issuePath, json({ projectId, action: "edit", content: "# 归档前的最后修改" }));
  await api(page, `/api/iterations/${iterationId}`, { method: "DELETE" });
  check("所属迭代删除后旧快照保留且其他迭代不能撤回归档", (await snapshot()).previous_snapshot !== null && (await api(page, `/api/iterations/${other.body.id}/task-folder`, json({ projectId, folderId, action: "restore" }, "PATCH"))).status === 403);
  console.log(`验收项目：${base}/projects/${projectId}/iterations/${other.body.id}`);
} finally { await context.close(); await browser.close(); await closeMysqlPoolForTests(); }
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
