// v1.41 #07：从真实阶段会话回放候选、放弃、故障回滚、创建与覆盖。
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
  const email = `verify-candidate-${Date.now()}@test.local`;
  await page.goto(`${base}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", json({ name: "候选写入验证" }));
  const projectId = project.body?.id;
  const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "验证迭代", goal: "交付需求分析" }));
  const iterationId = iteration.body?.id;
  const session = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions`, { method: "POST" });
  const sessionId = session.body?.session?.id;
  check("已创建项目、迭代与需求分析会话", project.status === 201 && iteration.status === 201 && session.status === 201);
  const messagesPath = `/api/iterations/${iterationId}/stages/analysis/sessions/${sessionId}/messages`;
  const directoryPath = `/api/projects/${projectId}/files`;
  const generate = (content) => api(page, messagesPath, json({ content }));
  const candidatePath = (candidateId) => `/api/iterations/${iterationId}/sessions/${sessionId}/candidates/${candidateId}`;
  const decision = (candidateId, body, headers) => api(page, candidatePath(candidateId), json(body, headers));
  const directory = () => api(page, directoryPath);
  const pool = getMysqlPool();

  const first = await generate("请提出一份需求分析候选");
  const firstCandidate = first.body?.messages?.at(-1)?.candidate;
  check("Agent 回复产生会话内候选", first.status === 200 && firstCandidate?.status === "pending" && firstCandidate.suggestedFilename.startsWith("需求分析-"));
  check("生成候选没有修改项目目录", (await directory()).body?.length === 0);
  const [beforeChanges] = await pool.query("SELECT COUNT(*) AS count FROM project_file_changes WHERE project_id = ?", [projectId]);
  check("生成候选没有变更记录", Number(beforeChanges[0].count) === 0);

  const regenerated = await api(page, messagesPath, json({ regenerateMessageId: first.body?.assistantMessage?.id }));
  const regeneratedCandidate = regenerated.body?.messages?.at(-1)?.candidate;
  check("重新生成替换候选但不写文件", regenerated.status === 200 && regeneratedCandidate?.id !== firstCandidate.id && (await directory()).body?.length === 0);
  const oldCandidate = await decision(firstCandidate.id, { action: "discard" });
  check("旧候选在重新生成后失效", oldCandidate.status === 404);
  const discarded = await decision(regeneratedCandidate.id, { action: "discard" });
  const afterDiscard = await api(page, messagesPath);
  check("放弃状态可刷新恢复且目录不变", discarded.status === 200 && afterDiscard.body?.messages?.at(-1)?.candidate?.status === "discarded" && (await directory()).body?.length === 0);

  const second = await generate("再提出一份可交付的完整候选");
  const candidate = second.body?.messages?.at(-1)?.candidate;
  const filename = "需求分析-AI校内闲置交易验证.md";
  check("第二份候选仍然待确认", second.status === 200 && candidate?.status === "pending");
  const invalid = await decision(candidate.id, { action: "write", filename: "原型-越界.md", expectedOperation: "create" });
  check("跨树枝文件名被拒绝", invalid.status === 400 && (await directory()).body?.length === 0);
  const failure = await decision(candidate.id, { action: "write", filename, expectedOperation: "create" }, { "x-pm-verify-candidate-write-fail": "1" });
  const afterFailure = await api(page, messagesPath);
  check("故障注入后候选可重试", failure.status === 500 && afterFailure.body?.messages?.at(-1)?.candidate?.status === "pending");
  check("故障注入未留下文件或变更", (await directory()).body?.length === 0 && Number((await pool.query("SELECT COUNT(*) AS count FROM project_file_changes WHERE project_id = ?", [projectId]))[0][0].count) === 0);

  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await page.locator(".workbench-grid").waitFor();
  const card = page.getByRole("region", { name: "需求分析文件候选" }).last();
  await card.getByLabel("文件名").fill(filename);
  check("界面区分创建并展示目标路径", await card.getByRole("button", { name: "确认创建" }).count() === 1 && (await card.textContent()).includes(`需求分析 / ${filename}`));
  await card.getByRole("button", { name: "预览完整 Markdown" }).click();
  check("候选正文可在确认前预览", await card.locator(".analysis-candidate-preview h1").count() === 1);
  if (process.env.CAPTURE_FIRST_FILE_CANDIDATE === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await page.screenshot({ path: ".impeccable/review/first-file-candidate-desktop.png", animations: "disabled" });
  }
  await card.getByRole("button", { name: "确认创建" }).click();
  await card.getByText(`已保存到需求分析 / ${filename}`).waitFor();
  const [created] = await pool.query("SELECT id, content, previous_content, version FROM project_files WHERE project_id = ? AND filename = ?", [projectId, filename]);
  check("界面确认后写入纯 Markdown 首版", created.length === 1 && created[0].content.startsWith("# 需求分析") && !created[0].content.includes("changelog:") && created[0].previous_content === null && Number(created[0].version) === 1);
  await page.locator(".project-tree-name").filter({ hasText: filename }).waitFor();
  check("项目文件树出现新文件", await page.locator(".project-tree-name").filter({ hasText: filename }).count() === 1);
  const [createChanges] = await pool.query("SELECT operation, actor, iteration_number, session_id, message_id, content_revision FROM project_file_changes WHERE file_id = ?", [created[0].id]);
  check("创建记录保存真实 Agent 来源", createChanges.length === 1 && createChanges[0].operation === "create" && createChanges[0].actor === "agent" && createChanges[0].session_id === sessionId && createChanges[0].message_id === second.body.assistantMessage.id && Number(createChanges[0].content_revision) === 1);
  const duplicate = await decision(candidate.id, { action: "write", filename, expectedOperation: "overwrite" });
  check("同一候选不能再次写入", duplicate.status === 409);

  const third = await generate("请给出更新后的需求分析候选");
  const overwriteCandidate = third.body?.messages?.at(-1)?.candidate;
  const staleOperation = await decision(overwriteCandidate.id, { action: "write", filename, expectedOperation: "create" });
  check("目标路径操作类型变化时拒绝旧确认", staleOperation.status === 409 && (await api(page, messagesPath)).body?.messages?.at(-1)?.candidate?.status === "pending");
  await page.reload();
  await page.locator(".workbench-grid").waitFor();
  const overwriteCard = page.getByRole("region", { name: "需求分析文件候选" }).last();
  await overwriteCard.getByLabel("文件名").fill(filename);
  check("刷新后同路径明确显示覆盖", await overwriteCard.getByRole("button", { name: "确认覆盖" }).count() === 1);
  const overwritten = await decision(overwriteCandidate.id, { action: "write", filename, expectedOperation: "overwrite" });
  const [latest] = await pool.query("SELECT content, previous_content, version FROM project_files WHERE id = ?", [created[0].id]);
  check("覆盖原子替换正文并保留唯一旧版", overwritten.status === 200 && latest[0].previous_content === created[0].content && Number(latest[0].version) === 2);
  const [allChanges] = await pool.query("SELECT operation, content_revision FROM project_file_changes WHERE file_id = ? ORDER BY content_revision", [created[0].id]);
  check("覆盖追加来源记录与递增修订", allChanges.length === 2 && allChanges[1].operation === "overwrite" && Number(allChanges[1].content_revision) === 2);
  const mobilePending = await generate("请再提出一份待确认候选，检查移动端审阅");
  check("移动端检查使用真实待确认候选", mobilePending.status === 200 && mobilePending.body?.messages?.at(-1)?.candidate?.status === "pending");
  const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await otherContext.newPage();
  await mobile.goto(`${base}/login`);
  await mobile.fill("#email", email);
  await mobile.locator('input[type="password"]').fill("verify-pass-1234");
  await mobile.locator('form button[type="submit"]').click();
  await mobile.waitForURL((url) => url.pathname === "/projects");
  await mobile.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await mobile.locator(".workbench-grid").waitFor();
  await mobile.getByRole("region", { name: "需求分析文件候选" }).last().getByRole("button", { name: "预览完整 Markdown" }).click();
  check("390px 候选无横向溢出", await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (process.env.CAPTURE_FIRST_FILE_CANDIDATE === "1") await mobile.screenshot({ path: ".impeccable/review/first-file-candidate-mobile.png", animations: "disabled", fullPage: true });
  const completed = await api(page, `/api/iterations/${iterationId}/stages/analysis/complete`, { method: "POST" });
  const caseFilename = "需求分析-ai校内闲置交易验证.md";
  const caseWrite = await decision(mobilePending.body.messages.at(-1).candidate.id, { action: "write", filename: caseFilename, expectedOperation: "create" });
  check("精确路径区分英文字母大小写", caseWrite.status === 200 && caseWrite.body.operation === "create" && (await directory()).body.filter((file) => file.filename === filename || file.filename === caseFilename).length === 2);
  const workbench = await api(page, `/api/iterations/${iterationId}/workbench`);
  check("完成阶段后仍可确认原会话候选且状态不改变", completed.status === 200 && caseWrite.status === 200 && workbench.body.stages.find((stage) => stage.key === "analysis")?.status === "completed");
  await otherContext.close();
} finally {
  await context.close();
  await browser.close();
  await closeMysqlPoolForTests();
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
