// v1.41 #13：任务文件夹归属、跨迭代只读、整套撤回和删除归档。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getMysqlPool, closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") { console.error("❌ 本验证要求 AI_MODE=replay"); process.exit(1); }
const base = process.env.BASE_URL || "http://localhost:3000";
let pass = 0; let fail = 0;
function check(name, okay) { if (okay) { pass++; console.log(`✅ ${name}`); } else { fail++; console.error(`❌ ${name}`); } }
const json = (body, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    const text = await response.text();
    try { return { status: response.status, body: JSON.parse(text) }; } catch { return { status: response.status, body: text }; }
  }, { path, init });
}

await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage(); page.setDefaultTimeout(15000);
try {
  const email = `verify-task-folder-${Date.now()}@test.local`;
  await page.goto(`${base}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", json({ name: "任务归属验证" }));
  const projectId = project.body?.id;
  const first = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "首轮", goal: "建立任务" }));
  const second = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "次轮", goal: "只读任务" }));
  const firstId = first.body?.id; const secondId = second.body?.id;
  check("创建两个稳定编号的产品迭代", first.status === 201 && second.status === 201 && first.body.iteration_number === 1 && second.body.iteration_number === 2);
  const firstFolder = await api(page, `/api/iterations/${firstId}/task-folder`, json({ projectId }));
  const folderId = firstFolder.body?.id;
  check("所属迭代建立唯一任务文件夹", firstFolder.status === 201 && Boolean(folderId));
  check("重复建立同一迭代文件夹被拒绝", (await api(page, `/api/iterations/${firstId}/task-folder`, json({ projectId }))).status === 409);
  const secondFolder = await api(page, `/api/iterations/${secondId}/task-folder`, json({ projectId }));
  check("其他迭代只能建立自己的文件夹", secondFolder.status === 201 && secondFolder.body.id !== folderId);
  const folders = await api(page, `/api/projects/${projectId}/task-folders`);
  check("文件夹列表保留不可转移的归属", folders.body.length === 2 && folders.body[0].ownerIterationId === firstId && folders.body[1].ownerIterationId === secondId);

  const pool = getMysqlPool(); const fileId = randomUUID();
  const filename = "issues/iteration-1/01-首个任务.md";
  await pool.execute("INSERT INTO project_files (id, project_id, filename, content, version, task_folder_id, issue_number) VALUES (?, ?, ?, ?, 1, ?, 1)",
    [fileId, projectId, filename, "# 首个任务", folderId]);
  await pool.execute("UPDATE task_folders SET next_issue_number = 2 WHERE id = ?", [folderId]);
  await pool.execute(`INSERT INTO project_file_changes (id, project_id, file_id, operation, filename, content_revision, actor, iteration_id, iteration_number, iteration_name)
    VALUES (?, ?, ?, 'create', ?, 1, 'user', ?, 1, '首轮')`, [randomUUID(), projectId, fileId, filename, firstId]);
  const list = await api(page, `/api/projects/${projectId}/files`);
  check("目录标明任务文件夹和所属迭代", list.body.find((item) => item.id === fileId)?.taskFolderId === folderId && list.body.find((item) => item.id === fileId)?.taskOwnerIterationId === firstId);
  check("其他迭代可读取任务正文", (await api(page, `/api/projects/${projectId}/files/${fileId}`)).body?.content === "# 首个任务");
  const download = await page.request.get(`${base}/api/projects/${projectId}/files/${fileId}/download`);
  check("其他迭代可下载任务文件", download.status() === 200 && (await download.text()).includes("# 首个任务"));

  const session = await api(page, `/api/iterations/${secondId}/stages/analysis/sessions`, { method: "POST" });
  const contextPath = `/api/iterations/${secondId}/stages/analysis/sessions/${session.body?.session?.id}/context`;
  const loaded = await api(page, contextPath, json({ fileId }));
  check("其他迭代可加载任务文件到当前会话", loaded.status === 200 && (await api(page, contextPath)).body.fileIds.includes(fileId));

  const issuePath = (iterationId) => `/api/iterations/${iterationId}/files/${fileId}`;
  check("其他迭代不能编辑", (await api(page, issuePath(secondId), json({ projectId, action: "edit", content: "# 篡改" }))).status === 403);
  check("其他迭代不能重命名", (await api(page, issuePath(secondId), json({ projectId, action: "rename", filename: "issues/iteration-1/01-篡改.md" }, "PATCH"))).status === 403);
  check("其他迭代不能删除", (await api(page, issuePath(secondId), json({ projectId }, "DELETE"))).status === 403);
  check("其他迭代不能整套撤回", (await api(page, `/api/iterations/${secondId}/task-folder`, json({ projectId, folderId, action: "restore" }, "PATCH"))).status === 403);
  check("旧文件修改 API 不能绕过任务归属", (await api(page, `/api/projects/${projectId}/files/${fileId}`, json({ content: "# 篡改" }, "PATCH"))).status !== 200);
  check("旧整套交付 API 不接管新任务文件夹", (await api(page, `/api/projects/${projectId}/ticket-sets`, json({ mode: "replace", source_message_id: randomUUID(), candidates: [] }))).status === 409);

  const failedEdit = json({ projectId, action: "edit", content: "# 故障中的修改" });
  failedEdit.headers["x-pm-assistant-test-file-revision-failure"] = "1";
  check("任务编辑故障返回失败", (await api(page, issuePath(firstId), failedEdit)).status === 500);
  const [afterFailure] = await pool.query("SELECT f.content, f.version, t.previous_snapshot FROM project_files f JOIN task_folders t ON t.id = f.task_folder_id WHERE f.id = ?", [fileId]);
  check("任务编辑故障回滚正文、修订和整套备份", afterFailure[0].content === "# 首个任务" && afterFailure[0].version === 1 && afterFailure[0].previous_snapshot === null);

  const changed = await api(page, issuePath(firstId), json({ projectId, action: "edit", content: "# 所属迭代修改" }));
  check("所属迭代可编辑任务正文", changed.status === 200 && changed.body.content === "# 所属迭代修改");
  const [afterEdit] = await pool.query("SELECT content, version FROM project_files WHERE id = ?", [fileId]);
  const [snapshot] = await pool.query("SELECT previous_snapshot, next_issue_number FROM task_folders WHERE id = ?", [folderId]);
  check("编辑以整套旧集合保存唯一撤回目标", afterEdit[0].version === 2 && JSON.stringify(snapshot[0].previous_snapshot).includes("# 首个任务") && snapshot[0].next_issue_number === 2);
  check("系统序号不能被重命名", (await api(page, issuePath(firstId), json({ projectId, action: "rename", filename: "issues/iteration-1/02-换号.md" }, "PATCH"))).status === 400);
  const renamed = await api(page, issuePath(firstId), json({ projectId, action: "rename", filename: "issues/iteration-1/01-新描述.md" }, "PATCH"));
  check("所属迭代只能修改序号后描述", renamed.status === 200 && renamed.body.filename.endsWith("01-新描述.md"));
  const restoredRename = await api(page, `/api/iterations/${firstId}/task-folder`, json({ projectId, folderId, action: "restore" }, "PATCH"));
  const [afterRestore] = await pool.query("SELECT filename, content, version FROM project_files WHERE id = ?", [fileId]);
  check("整套撤回恢复前次改名且保留当前正文修订", restoredRename.status === 200 && afterRestore[0].filename === filename && afterRestore[0].content === "# 所属迭代修改" && afterRestore[0].version === 2);
  check("整套撤回机会被消耗", (await api(page, `/api/iterations/${firstId}/task-folder`, json({ projectId, folderId, action: "restore" }, "PATCH"))).status === 409);
  const deleted = await api(page, issuePath(firstId), json({ projectId }, "DELETE"));
  check("所属迭代可删除单个 issue", deleted.status === 200 && deleted.body.deleted);
  const deletedDirectory = await api(page, `/api/projects/${projectId}/files`);
  check("已删除占位保留原任务文件夹身份", deletedDirectory.body.find((item) => item.id === fileId)?.taskFolderId === folderId);
  await page.goto(`${base}/projects/${projectId}/iterations/${firstId}`);
  await page.locator(".workbench-grid").waitFor();
  await page.getByRole("tab", { name: /项目文件树/ }).click();
  await page.getByText("本迭代 · 可修改").first().waitFor();
  const deletedFolder = page.locator(".workbench-context .project-tree-folder").filter({ hasText: "迭代 01" }).first();
  check("已删除占位仍显示在原任务文件夹中", await deletedFolder.locator(".project-tree-name.deleted").filter({ hasText: "首个任务" }).count() === 1);
  const restoredDelete = await api(page, `/api/iterations/${firstId}/task-folder`, json({ projectId, folderId, action: "restore" }, "PATCH"));
  const [restoredRows] = await pool.query("SELECT id, issue_number, version FROM project_files WHERE id = ?", [fileId]);
  check("整套撤回恢复被删 issue 的稳定身份和序号", restoredDelete.status === 200 && restoredRows[0].id === fileId && restoredRows[0].issue_number === 1 && restoredRows[0].version === 3);
  const [groups] = await pool.query("SELECT task_change_group_id FROM project_file_changes WHERE file_id = ? AND task_change_group_id IS NOT NULL", [fileId]);
  check("任务操作具有可追溯的变更组", groups.length >= 4 && groups.every((row) => row.task_change_group_id));

  await page.goto(`${base}/projects/${projectId}/iterations/${firstId}`);
  await page.locator(".workbench-grid").waitFor();
  await page.getByRole("tab", { name: /项目文件树/ }).click();
  await page.getByText("本迭代 · 可修改").first().waitFor();
  const ownTree = page.locator(".workbench-context .project-tree");
  check("正式文件树显示本迭代可修改状态", (await ownTree.innerText()).includes("本迭代 · 可修改"));
  await ownTree.locator(".project-tree-name").filter({ hasText: "首个任务" }).click();
  await page.getByRole("button", { name: "编辑正文" }).waitFor();
  check("所属迭代预览提供编辑入口", await page.getByRole("button", { name: "编辑正文" }).count() === 1);
  await page.getByRole("tab", { name: "文件详情与来源" }).click();
  await page.getByRole("button", { name: "改名" }).waitFor();
  check("所属迭代详情提供改名和删除入口", await page.getByRole("button", { name: "改名" }).count() === 1 && await page.getByRole("button", { name: "删除文件" }).count() === 1);
  await page.getByRole("button", { name: "关闭预览" }).click();

  await page.goto(`${base}/projects/${projectId}/iterations/${secondId}`);
  await page.locator(".workbench-grid").waitFor();
  await page.getByRole("tab", { name: /项目文件树/ }).click();
  const tree = page.locator(".workbench-context .project-tree");
  await tree.getByText("其他迭代 · 只读").first().waitFor();
  check("正式文件树显示其他迭代只读状态", (await tree.innerText()).includes("其他迭代 · 只读"));
  await tree.locator(".project-tree-name").filter({ hasText: "首个任务" }).click();
  check("只读预览仍提供下载但无编辑入口", await page.getByRole("button", { name: "编辑正文" }).count() === 0 && await page.getByRole("link", { name: /下载/ }).count() > 0);
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.screenshot({ path: join(tmpdir(), "v141-task-folder-desktop.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workbench-context").screenshot({ path: join(tmpdir(), "v141-task-folder-mobile.png"), animations: "disabled" });

  check("删除所属迭代成功", (await api(page, `/api/iterations/${firstId}`, { method: "DELETE" })).status === 200);
  const archived = await api(page, `/api/projects/${projectId}/task-folders`);
  check("所属迭代删除后文件夹只读归档", archived.body.find((folder) => folder.id === folderId)?.archived === true);
  check("归档 issue 仍可读取", (await api(page, `/api/projects/${projectId}/files/${fileId}`)).status === 200);
  check("归档 issue 不允许其他迭代修改", (await api(page, issuePath(secondId), json({ projectId, action: "edit", content: "# 篡改" }))).status === 403);
  await api(page, `/api/iterations/${secondId}`, { method: "DELETE" });
  check("所有迭代删除后旧整套交付仍不能覆盖归档", (await api(page, `/api/projects/${projectId}/ticket-sets`, json({ mode: "replace", source_message_id: randomUUID(), candidates: [] }))).status === 409);
  const third = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "第三轮", goal: "新任务" }));
  check("新迭代编号不复用且不能接管归档", third.body.iteration_number === 3 && (await api(page, issuePath(third.body.id), json({ projectId, action: "edit", content: "# 篡改" }))).status === 403);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/projects/${projectId}/iterations/${third.body.id}`);
  await page.getByRole("tab", { name: /项目文件树/ }).click();
  await page.getByText("已删除迭代 · 只读归档").first().waitFor();
  check("正式文件树显示已删除迭代只读归档", (await page.locator(".project-tree").innerText()).includes("已删除迭代 · 只读归档"));
} finally {
  await context.close(); await browser.close(); await closeMysqlPoolForTests();
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
