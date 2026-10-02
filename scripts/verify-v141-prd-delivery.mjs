// v1.41 #10：PRD 六章候选、树枝权限、纯正文与原子交付。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { getMysqlPool, closeMysqlPoolForTests } from "../src/lib/mysql.ts";
import { extractMarkdownCandidate, validPrdStructure } from "../src/lib/mysql-iteration-candidates.ts";
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

const prd = [
  "# 校园点餐 PRD", "## 1. 概念", "核心用户是学生。", "## 2. Out of Scope", "暂不做配送。",
  "## 3. 页面清单", "## 菜单页", "用户浏览菜品。", "## 4. 实体级数据模型", "订单包含菜品和状态。",
  "## 5. 用户流程 + 验收标准", "## 用户流程：下单", "#### 验收标准", "下单后可见订单。",
  "## 6. 文案基调", "简洁清楚。",
].join("\n");
check("完整六章可成为候选", validPrdStructure(prd) && extractMarkdownCandidate(`%%%FILE_BEGIN%%% PRD-校园点餐.md\n${prd}\n%%%FILE_END%%%`, "prd")?.content === prd);
check("缺章、空章、错序及其他树枝不会成为 PRD 候选", [
  prd.replace("## 6. 文案基调\n简洁清楚。", ""),
  prd.replace("## 2. Out of Scope\n暂不做配送。", "## 2. Out of Scope"),
  prd.replace("## 2. Out of Scope\n暂不做配送。", "## 2. Out of Scope\n### 暂缓事项\n<!-- 尚未填写 -->"),
  prd.replace("## 1. 概念", "## 2. 概念"),
  `${prd}\n## 7. 额外章节\n不应出现。`,
].every((content) => !validPrdStructure(content)) && !extractMarkdownCandidate(`%%%FILE_BEGIN%%% 原型-越界.md\n${prd}\n%%%FILE_END%%%`, "prd"));

await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
try {
  await page.goto(`${base}/register`);
  await page.fill("#email", `verify-prd-${Date.now()}@test.local`);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", json({ name: "PRD 交付验证" }));
  const projectId = project.body?.id;
  const iteration = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "PRD 迭代", goal: "交付 PRD" }));
  const iterationId = iteration.body?.id;
  const session = await api(page, `/api/iterations/${iterationId}/stages/prd/sessions`, { method: "POST" });
  const sessionId = session.body?.session?.id;
  check("建立 PRD 阶段会话", project.status === 201 && iteration.status === 201 && session.status === 201);
  const messagesPath = `/api/iterations/${iterationId}/stages/prd/sessions/${sessionId}/messages`;
  const decision = (id, body, headers) => api(page, `/api/iterations/${iterationId}/sessions/${sessionId}/candidates/${id}`, json(body, headers));
  const directory = () => api(page, `/api/projects/${projectId}/files`);
  const pool = getMysqlPool();

  const first = await api(page, messagesPath, json({ content: "请输出完整六章 PRD" }));
  const firstCandidate = first.body?.messages?.at(-1)?.candidate;
  check("回复产生完整六章会话候选", first.status === 200 && firstCandidate?.status === "pending" && firstCandidate?.suggestedFilename === "PRD-在线点餐.md" && validPrdStructure(firstCandidate.content));
  check("聊天正文隐藏文件标记", !first.body?.messages?.at(-1)?.displayContent?.includes("%%%FILE_BEGIN%%%"));
  check("未确认不进入目录、上下文或变更记录", (await directory()).body?.length === 0
    && (await api(page, `/api/iterations/${iterationId}/stages/prd/sessions/${sessionId}/context`)).body?.fileIds?.length === 0
    && Number((await pool.query("SELECT COUNT(*) AS count FROM project_file_changes WHERE project_id = ?", [projectId]))[0][0].count) === 0);
  check("其他树枝文件名被拒绝", (await decision(firstCandidate.id, { action: "write", filename: "原型-越界.md", expectedOperation: "create" })).status === 400);
  const discarded = await decision(firstCandidate.id, { action: "discard" });
  check("放弃候选不写入项目", discarded.status === 200 && (await directory()).body?.length === 0 && (await api(page, messagesPath)).body?.messages?.at(-1)?.candidate?.status === "discarded");

  const second = await api(page, messagesPath, json({ content: "请继续输出完整六章 PRD" }));
  const candidate = second.body?.messages?.at(-1)?.candidate;
  const filename = "PRD-校园点餐验收.md";
  const failed = await decision(candidate.id, { action: "write", filename, expectedOperation: "create" }, { "x-pm-verify-candidate-write-fail": "1" });
  check("故障回滚并保留候选", failed.status === 500 && (await directory()).body?.length === 0 && (await api(page, messagesPath)).body?.messages?.at(-1)?.candidate?.status === "pending");

  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await page.locator(".workbench-grid").waitFor();
  const prdStage = page.locator(".workbench-stage").filter({ hasText: "PRD" });
  if (await prdStage.getAttribute("aria-current") !== "step") {
    await prdStage.click();
    const continuePrd = page.getByRole("button", { name: "继续进入PRD" });
    if (await continuePrd.isVisible()) await continuePrd.click();
  }
  const card = page.getByRole("region", { name: "PRD文件候选" }).last();
  await card.waitFor();
  await prdStage.click();
  check("重复点击当前阶段不打断候选预览", await card.isVisible() && await page.getByRole("button", { name: "继续进入PRD" }).count() === 0);
  await card.getByLabel("文件名").fill(filename);
  check("候选卡片显示 PRD 树枝和创建路径", await card.getByRole("button", { name: "确认创建" }).count() === 1 && (await card.textContent()).includes(`PRD / ${filename}`));
  await card.getByRole("button", { name: "预览完整 Markdown" }).click();
  check("确认前可预览六章内容", await card.locator(".analysis-candidate-preview h2").count() >= 6);
  if (process.env.CAPTURE_PRD_DELIVERY === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await card.screenshot({ path: ".impeccable/review/prd-candidate-desktop.png", animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await card.screenshot({ path: ".impeccable/review/prd-candidate-mobile.png", animations: "disabled" });
    check("390px 候选无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await card.getByRole("button", { name: "确认创建" }).click();
  await card.getByText(`已保存到PRD / ${filename}`).waitFor();
  const [written] = await pool.query("SELECT id, content, previous_content, version FROM project_files WHERE project_id = ? AND BINARY filename = BINARY ?", [projectId, filename]);
  check("确认创建纯 Markdown 和首版修订", written.length === 1 && written[0].content === candidate.content && written[0].previous_content === null && Number(written[0].version) === 1 && !written[0].content.includes("changelog:"));
  const [changes] = await pool.query("SELECT stage, operation, message_id FROM project_file_changes WHERE file_id = ?", [written[0].id]);
  check("变更记录归因 PRD 会话和原消息", changes.length === 1 && changes[0].stage === "prd" && changes[0].operation === "create" && changes[0].message_id === second.body.assistantMessage.id);
  check("文件进入项目树 PRD 树枝", (await directory()).body?.some((file) => file.id === written[0].id && file.filename === filename));

  const third = await api(page, messagesPath, json({ content: "请再次输出完整六章 PRD" }));
  const overwriteCandidate = third.body?.messages?.at(-1)?.candidate;
  check("新候选仍待确认且不会自动覆盖", overwriteCandidate?.status === "pending" && (await pool.query("SELECT version FROM project_files WHERE id = ?", [written[0].id]))[0][0].version === 1);
  const wrongOperation = await decision(overwriteCandidate.id, { action: "write", filename, expectedOperation: "create" });
  check("操作类型变化须重新确认", wrongOperation.status === 409 && wrongOperation.body?.operation === "overwrite");
  const overwrite = await decision(overwriteCandidate.id, { action: "write", filename, expectedOperation: "overwrite" });
  const [updated] = await pool.query("SELECT content, previous_content, version FROM project_files WHERE id = ?", [written[0].id]);
  check("确认覆盖递增修订并只保留上一版", overwrite.status === 200 && updated[0].content === overwriteCandidate.content && updated[0].previous_content === written[0].content && Number(updated[0].version) === 2);
  check("确认不自动完成 PRD 阶段", (await api(page, `/api/iterations/${iterationId}/workbench`)).body?.stages?.find((stage) => stage.key === "prd")?.status === "in_progress");
} finally {
  await context.close();
  await browser.close();
  await closeMysqlPoolForTests();
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
