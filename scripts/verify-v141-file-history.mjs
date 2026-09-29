// v1.41 #12：文件详情、改名、删除占位与本轮写入。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getMysqlPool, closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") { console.error("❌ 本验证要求 AI_MODE=replay"); process.exit(1); }
const base = process.env.BASE_URL || "http://localhost:3000";
let pass = 0;
let fail = 0;
function check(name, okay) {
  if (okay) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name}`); }
}
const json = (body, method = "POST", headers = {}) => ({ method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, init });
}

await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
try {
  const email = `verify-history-${Date.now()}@test.local`;
  await page.goto(`${base}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", json({ name: "文件来源验证" }));
  const projectId = project.body?.id;
  const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "首轮命名", goal: "验证来源" }));
  const iterationId = iteration.body?.id;
  const session = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions`, { method: "POST" });
  const sessionId = session.body?.session?.id;
  check("创建项目、迭代与会话", project.status === 201 && iteration.status === 201 && session.status === 201);
  const message = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions/${sessionId}/messages`, json({ content: "请给出需求分析候选" }));
  const candidate = message.body?.messages?.at(-1)?.candidate;
  const firstPath = "需求分析-文件来源验证.md";
  const created = await api(page, `/api/iterations/${iterationId}/sessions/${sessionId}/candidates/${candidate.id}`,
    json({ action: "write", filename: firstPath, expectedOperation: "create" }));
  const fileId = created.body?.fileId;
  const filePath = `/api/iterations/${iterationId}/files/${fileId}`;
  const historyPath = `/api/projects/${projectId}/files/${fileId}/history`;
  const pool = getMysqlPool();
  check("Agent 候选写入正式文件", created.status === 200 && Boolean(fileId));
  const initial = await api(page, historyPath);
  check("创建来源含迭代、阶段和会话快照", initial.status === 200 && initial.body.createdBy.actor === "agent" && initial.body.createdBy.iterationName === "首轮命名" && initial.body.createdBy.sessionName);
  const edited = await api(page, filePath, json({ projectId, action: "edit", content: "# 人工正文\n\n测试" }));
  const wrongBranch = await api(page, filePath, json({ projectId, action: "rename", filename: "PRD-错误树枝.md" }, "PATCH"));
  const samePath = await api(page, filePath, json({ projectId, action: "rename", filename: firstPath }, "PATCH"));
  check("编辑可用，改名不能换树枝或原名提交", edited.status === 200 && wrongBranch.status === 400 && samePath.status === 409);
  const beforeRename = await pool.query("SELECT version, content FROM project_files WHERE id = ?", [fileId]);
  const renamedPath = "需求分析-已改名.md";
  const failedRename = await api(page, filePath, json({ projectId, action: "rename", filename: renamedPath }, "PATCH", { "x-pm-assistant-test-file-identity-failure": "1" }));
  const afterFailed = await api(page, historyPath);
  check("改名故障回滚路径与记录", failedRename.status === 500 && afterFailed.body.filename === firstPath && afterFailed.body.changes.length === 2);
  const renamed = await api(page, filePath, json({ projectId, action: "rename", filename: renamedPath }, "PATCH"));
  const afterRename = await api(page, historyPath);
  const [renamedRows] = await pool.query("SELECT version, content, previous_content FROM project_files WHERE id = ?", [fileId]);
  check("改名保留身份、正文修订与备份", renamed.status === 200 && renamedRows[0].version === beforeRename[0][0].version && renamedRows[0].content === beforeRename[0][0].content && renamedRows[0].previous_content !== null);
  check("时间线区分用户编辑与重命名", afterRename.body.changes.at(-1).operation === "rename" && afterRename.body.changes.at(-1).actor === "user" && afterRename.body.lastContentChange.operation === "edit" && afterRename.body.changes.at(-1).previousFilename === firstPath);
  const writes = await api(page, `/api/iterations/${iterationId}/writes`);
  check("本轮写入汇总按文件身份聚合", writes.status === 200 && writes.body.some((entry) => entry.fileId === fileId && entry.filename === renamedPath && entry.changes.length === 3));
  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await page.locator(".workbench-grid").waitFor();
  await page.locator(".project-tree-name").filter({ hasText: renamedPath }).click();
  await page.getByRole("tab", { name: "文件详情与来源" }).click();
  await page.getByText("创建来源").waitFor();
  check("正式详情显示来源且隐藏数字修订号", await page.getByText("创建来源").count() === 1 && !(await page.locator(".project-file-details").innerText()).includes("修订 2"));
  if (process.env.CAPTURE_FILE_HISTORY === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await page.screenshot({ path: ".impeccable/review/file-history-desktop.png", animations: "disabled" });
  }
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const mobile = await mobileContext.newPage();
    await mobile.goto(`${base}/login`);
    await mobile.fill("#email", email);
    await mobile.locator('input[type="password"]').fill("verify-pass-1234");
    await mobile.locator('form button[type="submit"]').click();
    await mobile.waitForURL((url) => url.pathname === "/projects");
    await mobile.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
    await mobile.locator(".workbench-grid").waitFor();
    await mobile.getByRole("button", { name: "展开文件区" }).click();
    await mobile.locator(".project-tree-name").filter({ hasText: renamedPath }).click();
    await mobile.getByRole("tab", { name: "文件详情与来源" }).click();
    await mobile.getByText("创建来源").waitFor();
    check("390px 文件详情无横向溢出", await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (process.env.CAPTURE_FILE_HISTORY === "1") await mobile.screenshot({ path: ".impeccable/review/file-history-mobile.png", animations: "disabled" });
  } finally { await mobileContext.close(); }
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.getByRole("tab", { name: "本轮写入" }).click();
  await page.getByText(renamedPath, { exact: true }).waitFor();
  check("正式工作台可查看本轮写入", await page.locator(".iteration-write-summary li").filter({ hasText: renamedPath }).count() === 1);
  if (process.env.CAPTURE_FILE_HISTORY === "1") await page.screenshot({ path: ".impeccable/review/file-writes-desktop.png", animations: "disabled" });
  await page.getByRole("tab", { name: /项目文件树/ }).click();
  await page.locator(".project-tree-name").filter({ hasText: renamedPath }).click();
  await page.getByRole("tab", { name: "文件详情与来源" }).click();
  await page.getByRole("button", { name: "删除文件", exact: true }).waitFor();
  await page.getByRole("button", { name: "删除文件", exact: true }).click();
  check("删除确认说明不可恢复范围", (await page.getByRole("alertdialog", { name: "确认删除文件" }).innerText()).includes("无法恢复"));
  await page.getByRole("button", { name: "确认永久删除" }).click();
  await page.getByText("已删除 · 查看来源记录").waitFor();
  const [remaining] = await pool.query("SELECT id FROM project_files WHERE id = ?", [fileId]);
  const deletedHistory = await api(page, historyPath);
  const content = await api(page, `/api/projects/${projectId}/files/${fileId}`);
  const download = await page.request.get(`${base}/api/projects/${projectId}/files/${fileId}/download`);
  check("删除清空正文与备份，预览和下载均不可取回", remaining.length === 0 && content.status === 404 && download.status() === 404);
  check("删除占位保留完整来源时间线", deletedHistory.status === 200 && deletedHistory.body.deleted && deletedHistory.body.changes.at(-1).operation === "delete" && deletedHistory.body.changes.length === 4);
  const deletedWrites = await api(page, `/api/iterations/${iterationId}/writes`);
  check("本轮写入保留已删除文件", deletedWrites.body.some((entry) => entry.fileId === fileId && entry.deleted));
  const retainedId = randomUUID();
  await pool.execute("INSERT INTO project_files (id, project_id, filename, content, version) VALUES (?, ?, ?, ?, 1)",
    [retainedId, projectId, "需求分析-保留来源.md", "# 保留正文"]);
  await pool.execute(`INSERT INTO project_file_changes
    (id, project_id, file_id, operation, filename, content_revision, actor, iteration_id, iteration_number, iteration_name)
    VALUES (?, ?, ?, 'create', ?, 1, 'user', ?, 1, '首轮命名')`,
    [randomUUID(), projectId, retainedId, "需求分析-保留来源.md", iterationId]);
  const legacyId = randomUUID();
  await pool.execute("INSERT INTO project_files (id, project_id, filename, content, version) VALUES (?, ?, ?, ?, 1)",
    [legacyId, projectId, "需求分析-早期文件.md", ""]);
  const legacyHistory = await api(page, `/api/projects/${projectId}/files/${legacyId}/history`);
  check("没有创建记录的早期文件不伪造创建来源", legacyHistory.status === 200 && legacyHistory.body.createdBy === null);
  await api(page, `/api/iterations/${iterationId}/files/${legacyId}`, json({ projectId, action: "edit", content: "# 新正文" }));
  const emptyBackupHistory = await api(page, `/api/projects/${projectId}/files/${legacyId}/history`);
  check("空字符串上一版仍是可撤回目标", emptyBackupHistory.body.canUndo === true);
  const removed = await api(page, `/api/iterations/${iterationId}`, { method: "DELETE" });
  const orphanHistory = await api(page, historyPath);
  check("来源迭代删除后保留编号和名称快照", removed.status === 200 && orphanHistory.body.changes.every((entry) => entry.iterationDeleted && entry.iterationId === null && entry.iterationName === "首轮命名"));
  const directory = await api(page, `/api/projects/${projectId}/files`);
  check("存活文件的最近正文来源标记已删除迭代", directory.body.find((entry) => entry.id === retainedId)?.lastContentIteration === "迭代 01（已删除）");
} finally {
  await context.close();
  await browser.close();
  await closeMysqlPoolForTests();
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
