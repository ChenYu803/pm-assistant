// v1.41 #11：普通文件编辑、唯一上一版、撤回和事务回滚。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
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
const json = (body, headers = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
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
  const email = `verify-revision-${Date.now()}@test.local`;
  await page.goto(`${base}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", json({ name: "文件修订验证" }));
  const projectId = project.body?.id;
  const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "文件修订", goal: "验证一次撤回" }));
  const iterationId = iteration.body?.id;
  const session = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions`, { method: "POST" });
  const sessionId = session.body?.session?.id;
  check("创建项目、迭代与会话", project.status === 201 && iteration.status === 201 && session.status === 201);
  const oldWrite = await api(page, `/api/projects/${projectId}/files`, json({ filename: "需求分析.md", content: "# 旧入口", agent_type: "requirement_analyst" }));
  check(`旧写入 API 不能绕过产品迭代候选确认（HTTP ${oldWrite.status}）`, oldWrite.status === 409);

  const message = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions/${sessionId}/messages`, json({ content: "请给出需求分析候选" }));
  const candidate = message.body?.messages?.at(-1)?.candidate;
  const filename = "需求分析-文件修订验证.md";
  const created = await api(page, `/api/iterations/${iterationId}/sessions/${sessionId}/candidates/${candidate.id}`,
    json({ action: "write", filename, expectedOperation: "create" }));
  const fileId = created.body?.fileId;
  const pool = getMysqlPool();
  const state = async () => {
    const [files] = await pool.query("SELECT content, previous_content, version FROM project_files WHERE id = ?", [fileId]);
    const [changes] = await pool.query("SELECT operation, actor, iteration_number, content_revision FROM project_file_changes WHERE file_id = ? ORDER BY content_revision", [fileId]);
    return { file: files[0], changes };
  };
  const original = await state();
  check("创建得到修订 1 且没有备份", created.status === 200 && original.file?.previous_content === null && Number(original.file?.version) === 1);
  const path = `/api/iterations/${iterationId}/files/${fileId}`;
  const revise = (action, content, headers) => api(page, path, json({ projectId, action, ...(content !== undefined ? { content } : {}) }, headers));
  const noBackup = await revise("restore");
  check("无备份时撤回被拒绝", noBackup.status === 409 && (await state()).file.version === 1);
  const firstContent = "# 人工编辑一\n\n正文 A";
  const edited = await revise("edit", firstContent);
  const first = await state();
  check("用户编辑递增修订并保存唯一旧版", edited.status === 200 && first.file.content === firstContent && first.file.previous_content === original.file.content && Number(first.file.version) === 2);
  check("用户编辑有当前迭代来源", first.changes.at(-1).operation === "edit" && first.changes.at(-1).actor === "user" && Number(first.changes.at(-1).iteration_number) === 1);
  const secondContent = "# 人工编辑二\n\n正文 B";
  await revise("edit", secondContent);
  const second = await state();
  check("再次编辑替换唯一备份", second.file.content === secondContent && second.file.previous_content === firstContent && Number(second.file.version) === 3);
  const failedEdit = await revise("edit", "# 故障内容", { "x-pm-assistant-test-file-revision-failure": "1" });
  const afterFailure = await state();
  check("写入故障回滚正文、备份、修订和记录", failedEdit.status === 500 && JSON.stringify(afterFailure) === JSON.stringify(second));
  const restored = await revise("restore");
  const afterRestore = await state();
  check("撤回写入新的 restore 修订并消耗备份", restored.status === 200 && afterRestore.file.content === firstContent && afterRestore.file.previous_content === null && Number(afterRestore.file.version) === 4 && afterRestore.changes.at(-1).operation === "restore");
  check("撤回后不能重做", (await revise("restore")).status === 409 && JSON.stringify(await state()) === JSON.stringify(afterRestore));
  const failedRestore = await revise("edit", secondContent);
  const preRestoreFailure = await state();
  const forcedRestore = await revise("restore", undefined, { "x-pm-assistant-test-file-revision-failure": "1" });
  check("撤回故障也原子回滚", failedRestore.status === 200 && forcedRestore.status === 500 && JSON.stringify(await state()) === JSON.stringify(preRestoreFailure));
  const tooLarge = await revise("edit", "字".repeat(1100000));
  check("超过 3 MiB 的编辑被拒绝", tooLarge.status === 413 && JSON.stringify(await state()) === JSON.stringify(preRestoreFailure));

  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await page.locator(".workbench-grid").waitFor();
  await page.locator(".project-tree-name").filter({ hasText: filename }).click();
  await page.getByRole("dialog", { name: `预览 ${filename}` }).waitFor();
  await page.getByRole("button", { name: "编辑正文" }).waitFor();
  check("正式预览提供编辑和撤回入口", await page.getByRole("button", { name: "编辑正文" }).count() === 1 && await page.getByRole("button", { name: "撤回上次修改" }).isEnabled());
  if (process.env.CAPTURE_FILE_REVISIONS === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await page.screenshot({ path: ".impeccable/review/file-revisions-desktop.png", animations: "disabled" });
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
      await mobile.locator(".project-tree-name").filter({ hasText: filename }).click();
      await mobile.getByRole("button", { name: "编辑正文" }).waitFor();
      check("390px 文件编辑无横向溢出", await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await mobile.screenshot({ path: ".impeccable/review/file-revisions-mobile.png", animations: "disabled" });
    } finally { await mobileContext.close(); }
  }
  await page.getByRole("button", { name: "撤回上次修改" }).click();
  check("撤回前解释消耗备份", (await page.locator(".project-file-undo-confirm").textContent()).includes("不能重做"));
  await page.getByRole("button", { name: "确认撤回" }).click();
  await page.getByText("已撤回到上一版；本次撤回不能重做。").waitFor();
  check("界面撤回后显示无备份", await page.getByRole("button", { name: "撤回上次修改" }).isDisabled());
  await page.getByRole("button", { name: "编辑正文" }).click();
  await page.getByLabel("Markdown 正文").fill("# 界面编辑\n\n新正文");
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByText("修改已保存，可撤回到修改前的正文。").waitFor();
  check("界面编辑重新建立备份", (await state()).file.previous_content === firstContent);
} finally {
  await context.close();
  await browser.close();
  await closeMysqlPoolForTests();
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
