// v1.41 #04：通过正式页面、公开 API 和 MySQL 检查阶段状态；只使用固定回放。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.BASE_URL || "http://localhost:3000";
let pass = 0;
let fail = 0;
function check(name, condition, detail = "") {
  if (condition) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.error(`  ❌ ${name}${detail ? `：${detail}` : ""}`); }
}
async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    return { status: response.status, body: await response.json() };
  }, { path, init });
}
function stage(state, key) { return state.body?.stages?.find((item) => item.key === key); }

if (process.env.AI_MODE !== "replay") throw new Error("#04 验证要求 AI_MODE=replay");
await assertPlaywrightAvailable(chromium, { channel: "msedge" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let connection;
try {
  await page.goto(`${base}/register`);
  await page.fill("#email", `verify-v141-stage-${Date.now()}@test.local`);
  await page.locator('input[type="password"]').first().fill("verify-pass-1234");
  await page.locator('input[type="password"]').nth(1).fill("verify-pass-1234");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");
  const project = await api(page, "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "阶段状态验收" }) });
  const projectId = project.body?.id;
  const created = await api(page, `/api/projects/${projectId}/iterations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "第一轮", goal: null }) });
  const iterationId = created.body?.id;
  check("创建独立的产品迭代", project.status === 201 && created.status === 201 && Boolean(iterationId));
  const workbenchPath = `/api/iterations/${iterationId}/workbench`;
  const completePath = `/api/iterations/${iterationId}/stages/analysis/complete`;
  const initial = await api(page, workbenchPath);
  check("四环初始均为未开始", initial.body?.stages?.length === 4 && initial.body.stages.every((item) => item.status === "not_started"));
  check("未打开会话不能直接完成", (await api(page, completePath, { method: "POST" })).status === 409);

  await page.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await page.locator(".workbench-grid").waitFor();
  await page.getByRole("button", { name: "开始本阶段工作" }).click();
  await page.locator('.workbench-stage[aria-current="step"] .stage-status').getByText("进行中").waitFor();
  let state = await api(page, workbenchPath);
  const firstSessionId = stage(state, "analysis")?.sessions?.[0]?.id;
  check("显式建会话使阶段持久进入进行中", Boolean(firstSessionId) && stage(state, "analysis")?.status === "in_progress");
  await page.getByRole("button", { name: "完成本阶段" }).click();
  await page.locator('.workbench-stage[aria-current="step"] .stage-status').getByText("已完成").waitFor();
  check("零文件写入也能完成", stage(await api(page, workbenchPath), "analysis")?.status === "completed" && (await api(page, `/api/projects/${projectId}/files`)).body?.length === 0);
  const blockedSend = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions/${firstSessionId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "不应写入" }) });
  check("已完成阶段拒绝直接生成", blockedSend.status === 409);
  await page.reload();
  await page.getByRole("button", { name: "重新打开阶段" }).waitFor();
  check("刷新后仍显示完成态且输入锁定", await page.getByRole("textbox", { name: "输入消息" }).isDisabled());
  await page.getByRole("button", { name: "重新打开阶段" }).click();
  await page.locator('.workbench-stage[aria-current="step"] .stage-status').getByText("进行中").waitFor();
  check("明确重新打开恢复进行中", stage(await api(page, workbenchPath), "analysis")?.status === "in_progress");

  await api(page, completePath, { method: "POST" });
  const added = await api(page, `/api/iterations/${iterationId}/stages/analysis/sessions`, { method: "POST" });
  const activeId = added.body?.session?.id;
  check("已完成阶段新建会话也重新进入进行中", added.status === 201 && stage(await api(page, workbenchPath), "analysis")?.status === "in_progress");
  await page.reload();
  await page.locator(".workbench-grid").waitFor();
  await page.evaluate(({ path }) => {
    window.stagePendingRequest = fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-verify-stream-delay": "1" }, body: JSON.stringify({ content: "请给出回放回答" }) })
      .then(async (response) => ({ status: response.status, body: await response.json() }));
  }, { path: `/api/iterations/${iterationId}/stages/analysis/sessions/${activeId}/messages` });
  await page.waitForFunction(async ({ path, sessionId }) => {
    const state = await (await fetch(path)).json();
    return state.stages.find((item) => item.key === "analysis")?.generatingSessionIds.includes(sessionId);
  }, { path: workbenchPath, sessionId: activeId });
  check("生成中服务端拒绝完成", (await api(page, completePath, { method: "POST" })).status === 409);

  const observer = await context.newPage();
  await observer.goto(`${base}/projects/${projectId}/iterations/${iterationId}`);
  await observer.locator(".workbench-grid").waitFor();
  await observer.locator(".session-row").filter({ hasText: "新会话" }).click();
  check("另一会话生成时显示原因并禁用完成", await observer.getByText(/「请给出回放回答」正在生成/).count() === 1 && await observer.getByRole("button", { name: "完成本阶段" }).isDisabled());
  if (process.env.CAPTURE_STAGE_STATUS === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await observer.screenshot({ path: ".impeccable/review/stage-generating-desktop.png", animations: "disabled" });
  }
  await observer.setViewportSize({ width: 390, height: 844 });
  check("移动端生成提示可见且无横向溢出", await observer.getByRole("button", { name: "查看会话" }).isVisible() && await observer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (process.env.CAPTURE_STAGE_STATUS === "1") await observer.screenshot({ path: ".impeccable/review/stage-generating-mobile.png", animations: "disabled" });
  await observer.getByRole("button", { name: "查看会话" }).click();
  check("生成提示能跳到对应会话", await observer.locator('.session-row[aria-current="page"] strong').textContent() === "请给出回放回答" && await observer.getByRole("button", { name: "停止生成" }).isVisible() && await observer.getByRole("button", { name: "查看会话" }).count() === 0);
  if (process.env.CAPTURE_STAGE_STATUS === "1") await observer.screenshot({ path: ".impeccable/review/stage-generating-selected-mobile.png", animations: "disabled" });
  await observer.getByRole("button", { name: "停止生成" }).click();
  const stopped = await page.evaluate(() => window.stagePendingRequest);
  await observer.waitForFunction(() => {
    const button = document.querySelector(".stage-complete-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const completionEnabled = await observer.getByRole("button", { name: "完成本阶段" }).isEnabled();
  const remainingGenerating = stage(await api(page, workbenchPath), "analysis")?.generatingSessionIds.length;
  check("停止生成保留原消息且恢复完成入口", stopped.status === 409 && completionEnabled && remainingGenerating === 0, `HTTP ${stopped.status}，按钮可用 ${completionEnabled}，生成会话 ${remainingGenerating}`);
  check("停止后会话标题仍能指向用户问题", stage(await api(page, workbenchPath), "analysis")?.sessions?.[0]?.title === "请给出回放回答");

  const messagePath = `/api/iterations/${iterationId}/stages/analysis/sessions/${activeId}/messages`;
  await api(page, messagePath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "保留这一版回复" }) });
  const beforeRegenerate = (await api(page, messagePath)).body?.messages ?? [];
  const previousReply = [...beforeRegenerate].reverse().find((message) => message.role === "assistant" && message.status === "completed");
  const previousQuestion = beforeRegenerate.find((message) => message.role === "user" && message.content === "保留这一版回复");
  check("同轮用户消息与回复保持严格时间顺序", Boolean(previousQuestion && previousReply) && new Date(previousQuestion.createdAt).valueOf() < new Date(previousReply.createdAt).valueOf() && beforeRegenerate.indexOf(previousQuestion) < beforeRegenerate.indexOf(previousReply));
  await page.evaluate(({ path, messageId }) => {
    window.stagePendingRequest = fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-verify-stream-delay": "1" }, body: JSON.stringify({ regenerateMessageId: messageId }) })
      .then(async (response) => ({ status: response.status, body: await response.json() }));
  }, { path: messagePath, messageId: previousReply?.id });
  await page.waitForFunction(async ({ path, sessionId }) => {
    const state = await (await fetch(path)).json();
    return state.stages.find((item) => item.key === "analysis")?.generatingSessionIds.includes(sessionId);
  }, { path: workbenchPath, sessionId: activeId });
  const stopRegenerate = await api(page, `/api/iterations/${iterationId}/sessions/${activeId}/stop`, { method: "POST" });
  const regenerateResult = await page.evaluate(() => window.stagePendingRequest);
  const afterRegenerate = (await api(page, messagePath)).body?.messages ?? [];
  check("停止重新生成保留旧回复且无失败占位", stopRegenerate.status === 200 && regenerateResult.status === 409 && afterRegenerate.length === beforeRegenerate.length && afterRegenerate.some((message) => message.id === previousReply?.id), JSON.stringify({ stopStatus: stopRegenerate.status, regenerateStatus: regenerateResult.status, regenerateError: regenerateResult.body?.error, before: beforeRegenerate.map((message) => ({ id: message.id, role: message.role, status: message.status })), after: afterRegenerate.map((message) => ({ id: message.id, role: message.role, status: message.status })), previousReplyId: previousReply?.id }));

  await observer.getByRole("button", { name: "完成本阶段" }).click();
  check("停止后可以完成", stage(await api(page, workbenchPath), "analysis")?.status === "completed");
  if (process.env.CAPTURE_STAGE_STATUS === "1") {
    await mkdir(".impeccable/review", { recursive: true });
    await observer.screenshot({ path: ".impeccable/review/stage-status-desktop.png", animations: "disabled" });
  }
  await observer.setViewportSize({ width: 390, height: 844 });
  check("移动端状态与动作无横向溢出", await observer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) && await observer.getByRole("button", { name: "重新打开阶段" }).isVisible());
  if (process.env.CAPTURE_STAGE_STATUS === "1") await observer.screenshot({ path: ".impeccable/review/stage-status-mobile.png", animations: "disabled" });

  const another = await api(page, `/api/projects/${projectId}/iterations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "第二轮", goal: null }) });
  check("其他迭代仍从四环未开始起步", another.status === 201 && (await api(page, `/api/iterations/${another.body?.id}/workbench`)).body?.stages?.every((item) => item.status === "not_started") && stage(await api(page, workbenchPath), "analysis")?.status === "completed");

  connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || "3306"), database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD });
  const [rows] = await connection.query("SELECT stage, status FROM iteration_stage_states WHERE iteration_id = ?", [iterationId]);
  check("MySQL 持久事实只记录当前阶段已完成", rows.length === 1 && rows[0].stage === "requirements" && rows[0].status === "completed");
} finally {
  await connection?.end();
  await context.close();
  await browser.close();
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
