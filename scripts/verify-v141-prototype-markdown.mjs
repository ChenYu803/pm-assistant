// v1.41 #09：原型 Markdown 候选确认、纯正文、上下文边界与 HTML 快照隔离。
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
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  }, { path, init });
}

await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
try {
  const email = `verify-prototype-markdown-${Date.now()}@test.local`;
  await page.goto(`${base}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", json({ name: "原型 Markdown 验证" }));
  const projectId = project.body?.id;
  const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "原型交付迭代", goal: "交付结构化原型" }));
  const iterationId = iteration.body?.id;
  const session = await api(page, `/api/iterations/${iterationId}/stages/prototype/sessions`, { method: "POST" });
  const sessionId = session.body?.session?.id;
  check("建立原型阶段会话", project.status === 201 && iteration.status === 201 && session.status === 201);
  const messagesPath = `/api/iterations/${iterationId}/stages/prototype/sessions/${sessionId}/messages`;
  const candidatePath = (id) => `/api/iterations/${iterationId}/sessions/${sessionId}/candidates/${id}`;
  const decision = (id, body, headers) => api(page, candidatePath(id), json(body, headers));
  const directory = () => api(page, `/api/projects/${projectId}/files`);
  const pool = getMysqlPool();

  const first = await api(page, messagesPath, json({ content: "请交付结构化原型" }));
  const firstCandidate = first.body?.messages?.at(-1)?.candidate;
  check("原型回复产生会话内 Markdown 候选", first.status === 200 && firstCandidate?.status === "pending" && firstCandidate?.suggestedFilename.startsWith("原型-"));
  check("候选正文不暴露协议标记", first.body?.messages?.at(-1)?.displayContent?.includes("请审阅") && !first.body.messages.at(-1).displayContent.includes("%%%FILE_BEGIN%%%"));
  check("未确认不产生文件或变更记录", (await directory()).body?.length === 0 && Number((await pool.query("SELECT COUNT(*) AS count FROM project_file_changes WHERE project_id = ?", [projectId]))[0][0].count) === 0);
  const wrongBranch = await decision(firstCandidate.id, { action: "write", filename: "需求分析-越界.md", expectedOperation: "create" });
  check("原型候选不能写到需求分析树枝", wrongBranch.status === 400);
  const discarded = await decision(firstCandidate.id, { action: "discard" });
  check("放弃后候选保留状态但不产生文件", discarded.status === 200 && (await api(page, messagesPath)).body?.messages?.at(-1)?.candidate?.status === "discarded" && (await directory()).body?.length === 0);

  const second = await api(page, messagesPath, json({ content: "请再交付一份结构化原型 Markdown" }));
  const candidate = second.body?.messages?.at(-1)?.candidate;
  const filename = "原型-校园二手交易验收.md";
  const failed = await decision(candidate.id, { action: "write", filename, expectedOperation: "create" }, { "x-pm-verify-candidate-write-fail": "1" });
  check("写入故障回滚且候选可以重试", failed.status === 500 && (await directory()).body?.length === 0 && (await api(page, messagesPath)).body?.messages?.at(-1)?.candidate?.status === "pending");

  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await page.locator(".workbench-grid").waitFor();
  const card = page.getByRole("region", { name: "原型文件候选" }).last();
  await card.getByLabel("文件名").fill(filename);
  check("候选界面展示原型树枝与创建动作", await card.getByRole("button", { name: "确认创建" }).count() === 1 && (await card.textContent()).includes(`原型 / ${filename}`));
  await card.getByRole("button", { name: "预览完整 Markdown" }).click();
  check("确认前可以预览结构化正文", await card.locator(".analysis-candidate-preview h1").count() === 1);
  if (process.env.CAPTURE_PROTOTYPE_MARKDOWN === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await card.screenshot({ path: ".impeccable/review/prototype-markdown-candidate-desktop.png", animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await card.screenshot({ path: ".impeccable/review/prototype-markdown-candidate-mobile.png", animations: "disabled" });
    check("390px 候选区无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await card.getByRole("button", { name: "确认创建" }).click();
  await card.getByText(`已保存到原型 / ${filename}`).waitFor();
  const [written] = await pool.query("SELECT id, content, previous_content, version FROM project_files WHERE project_id = ? AND BINARY filename = BINARY ?", [projectId, filename]);
  check("确认写入纯 Markdown 首版", written.length === 1 && written[0].content === candidate.content && !written[0].content.includes("changelog:") && written[0].previous_content === null && Number(written[0].version) === 1);
  const [changes] = await pool.query("SELECT stage, operation, message_id FROM project_file_changes WHERE file_id = ?", [written[0].id]);
  check("变更记录归因原型阶段和原始消息", changes.length === 1 && changes[0].stage === "prototype" && changes[0].operation === "create" && changes[0].message_id === second.body.assistantMessage.id);
  check("确认不自动完成或冻结阶段", (await api(page, `/api/iterations/${iterationId}/workbench`)).body?.stages?.find((stage) => stage.key === "prototype")?.status === "in_progress");
  const contextPath = `/api/iterations/${iterationId}/stages/prototype/sessions/${sessionId}/context`;
  const loaded = await api(page, contextPath, json({ fileId: written[0].id }));
  check("原型 Markdown 可手动加入当前会话上下文", loaded.status === 200 && loaded.body?.fileIds?.includes(written[0].id));
  const laterSession = await api(page, `/api/iterations/${iterationId}/stages/prd/sessions`, { method: "POST" });
  const laterPath = `/api/iterations/${iterationId}/stages/prd/sessions/${laterSession.body?.session?.id}/context`;
  const laterBefore = await api(page, laterPath);
  const laterLoaded = await api(page, laterPath, json({ fileId: written[0].id }));
  check("后续阶段会话可按需加载原型 Markdown", laterSession.status === 201 && laterBefore.body?.fileIds?.length === 0 && laterLoaded.status === 200 && laterLoaded.body?.fileIds?.includes(written[0].id));

  const jointFailure = await api(page, messagesPath, json({ content: "请同时交付结构化原型和 HTML 快照" }, { "x-pm-verify-snapshot-failure": "1" }));
  const jointHistory = await api(page, messagesPath);
  const afterJointFailure = await api(page, `/api/projects/${projectId}/snapshots?iterationId=${iterationId}`);
  check("同轮快照故障回滚 Markdown 候选", jointFailure.status === 502 && !jointHistory.body?.messages?.at(-1)?.candidate && afterJointFailure.body?.length === 0 && (await directory()).body?.length === 1);
  const both = await api(page, messagesPath, json({ content: "请同时交付结构化原型和 HTML 快照" }));
  const bothMessage = both.body?.messages?.at(-1);
  const snapshots = await api(page, `/api/projects/${projectId}/snapshots?iterationId=${iterationId}`);
  check("同轮 HTML 快照与 Markdown 候选各自保存", both.status === 200 && bothMessage?.candidate?.status === "pending" && snapshots.body?.some((snapshot) => snapshot.messageId === both.body.assistantMessage.id));
  check("同轮聊天隐藏两类源码且不会自动覆盖文件", !bothMessage?.displayContent?.includes("%%%FILE_BEGIN%%%") && !bothMessage?.displayContent?.includes("<html") && (await directory()).body?.length === 1);
  const completed = await api(page, `/api/iterations/${iterationId}/stages/prototype/complete`, { method: "POST" });
  const overwrite = await decision(bothMessage.candidate.id, { action: "write", filename, expectedOperation: "overwrite" });
  const [updated] = await pool.query("SELECT content, previous_content, version FROM project_files WHERE id = ?", [written[0].id]);
  check("阶段完成后仍能确认覆盖且保留唯一上一版", completed.status === 200 && overwrite.status === 200 && updated[0].previous_content === written[0].content && Number(updated[0].version) === 2);
  check("覆盖不改变已完成阶段状态", (await api(page, `/api/iterations/${iterationId}/workbench`)).body?.stages?.find((stage) => stage.key === "prototype")?.status === "completed");
} finally {
  await context.close();
  await browser.close();
  await closeMysqlPoolForTests();
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
