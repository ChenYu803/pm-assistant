// v1.41 #06：在发送提示词边界核对目录、正文与会话引用，并回放正式上下文区域。
import { chromium } from "playwright-core";
import nextEnv from "@next/env";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMysqlIterationPrompt } from "../src/lib/mysql-iteration-workbench.ts";
import { closeMysqlPoolForTests, getMysqlPool } from "../src/lib/mysql.ts";
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
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, init });
}
const json = (body, headers = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
try {
  const email = `verify-v141-context-${Date.now()}@test.local`;
  await page.goto(`${base}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const [users] = await getMysqlPool().query("SELECT id FROM users WHERE email = ?", [email]);
  const userId = users[0]?.id;
  const project = await api(page, "/api/projects", json({ name: "上下文读取边界验证" }));
  const projectId = project.body?.id;
  const first = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "第一轮", goal: "核对当前文件范围" }));
  const second = await api(page, `/api/projects/${projectId}/iterations`, json({ displayName: "第二轮", goal: "覆盖共享文件" }));
  const iterationId = first.body?.id;
  const session = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions`, { method: "POST" });
  const sessionId = session.body?.session?.id;
  check("项目、迭代和阶段会话已创建", project.status === 201 && first.status === 201 && second.status === 201 && session.status === 201);

  const file = await api(page, `/api/projects/${projectId}/files`, json({ filename: "原型.md", content: "# 旧版正文 UNIQUE_CONTEXT_OLD", agent_type: "prototype" }, { "x-pm-assistant-test-system-write": "1" }));
  const fileId = file.body?.id;
  check("创建共享项目文件", file.status === 201 && typeof fileId === "string");
  const working = await api(page, `/api/projects/${projectId}/files`, json({ filename: "需求分析-工作文档（回放）.md", content: "# 过程秘密 UNIQUE_CONTEXT_INTERNAL", agent_type: "requirement_analyst" }, { "x-pm-assistant-test-system-write": "1" }));
  check("创建阶段过程文件夹具", working.status === 201);

  const path = `/api/iterations/${iterationId}/stages/analysis/sessions/${sessionId}/context`;
  const empty = await buildMysqlIterationPrompt(iterationId, sessionId, userId, "analysis");
  const workbench = await api(page, `/api/iterations/${iterationId}/workbench`);
  check("空上下文 API 不返回文件引用", (await api(page, path)).body?.fileIds?.length === 0 && workbench.status === 200);
  check("空上下文提示词只有工作范围与轻量目录", empty?.prompt.includes("核对当前文件范围") && empty.prompt.includes("路径：原型.md") && empty.prompt.includes("当前修订：r1") && empty.prompt.includes("最近正文写入迭代：未记录") && !empty.prompt.includes("UNIQUE_CONTEXT_OLD"));
  check("过程文件不进入目录或提示词", !empty?.prompt.includes("需求分析-工作文档（回放）.md") && !empty?.prompt.includes("UNIQUE_CONTEXT_INTERNAL"));
  check("阶段文件产出协议仍在提示词中", empty?.prompt.includes("%%%FILE_BEGIN%%%") && empty.prompt.includes("%%%FILE_END%%%"));

  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await page.locator(".workbench-grid").waitFor();
  await page.getByRole("tab", { name: /项目文件树/ }).click();
  await page.locator(".workbench-context .project-tree-name").filter({ hasText: "原型.md" }).click();
  await page.getByRole("dialog", { name: "预览 原型.md" }).getByText("旧版正文 UNIQUE_CONTEXT_OLD").waitFor();
  await page.getByRole("button", { name: "关闭预览" }).click();
  check("预览没有创建上下文引用", (await api(page, path)).body?.fileIds?.length === 0);
  await page.getByRole("tab", { name: /当前上下文/ }).click();
  check("空上下文解释正文边界", await page.getByText("当前上下文为空，Agent 看得到文件目录，但看不到文件正文。").count() === 1);
  await page.getByRole("button", { name: "加入当前上下文：原型.md" }).click();
  await page.getByRole("button", { name: "从当前上下文移除 原型.md" }).waitFor();
  if (process.env.CAPTURE_MANUAL_CONTEXT === "1") {
    const desktop = join(tmpdir(), "v141-manual-context-desktop.png");
    const mobile = join(tmpdir(), "v141-manual-context-mobile.png");
    await page.screenshot({ path: desktop, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: mobile, animations: "disabled", fullPage: true });
    await page.locator(".project-file-row").screenshot({ path: join(tmpdir(), "v141-manual-context-mobile-row.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log(`截图: ${desktop} | ${mobile}`);
  }
  check("只有上下文区域的加载创建引用", (await api(page, path)).body?.fileIds?.includes(fileId));
  const loaded = await buildMysqlIterationPrompt(iterationId, sessionId, userId, "analysis");
  check("已加载提示词包含当前正文与同版修订摘要", loaded?.prompt.includes("UNIQUE_CONTEXT_OLD") && loaded.prompt.includes("当前修订：r1"));

  const otherSession = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions`, { method: "POST" });
  const otherPath = `/api/iterations/${iterationId}/stages/analysis/sessions/${otherSession.body.session.id}/context`;
  check("同阶段其他会话不继承引用", (await api(page, otherPath)).body?.fileIds?.length === 0);
  const isolated = await buildMysqlIterationPrompt(iterationId, otherSession.body.session.id, userId, "analysis");
  check("其他会话的提示词不读取当前文件正文", !isolated?.prompt.includes("UNIQUE_CONTEXT_OLD"));
  const update = await api(page, `/api/projects/${projectId}/files/${fileId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", "x-current-iteration-id": second.body.id },
    body: JSON.stringify({ content: "# 新版正文 UNIQUE_CONTEXT_NEW" }),
  });
  check("另一迭代覆盖文件后内容修订递增", update.status === 200 && update.body?.version === 2);
  const overwritten = await buildMysqlIterationPrompt(iterationId, sessionId, userId, "analysis");
  check("下一轮读取覆盖后的正文与修订", overwritten?.prompt.includes("UNIQUE_CONTEXT_NEW") && overwritten.prompt.includes("当前修订：r2") && !overwritten.prompt.includes("UNIQUE_CONTEXT_OLD"));
  await page.getByRole("button", { name: "从当前上下文移除 原型.md" }).click();
  check("移除后引用消失", (await api(page, path)).body?.fileIds?.length === 0);
  const removed = await buildMysqlIterationPrompt(iterationId, sessionId, userId, "analysis");
  check("移除后下一轮不注入正文", !removed?.prompt.includes("UNIQUE_CONTEXT_NEW") && removed?.prompt.includes("路径：原型.md"));
} finally {
  await context.close();
  await browser.close();
  await closeMysqlPoolForTests();
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
