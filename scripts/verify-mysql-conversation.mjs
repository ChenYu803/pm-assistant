// v1.3 #03 固定回放：MySQL 消息事实源、恢复、替换链与 tab 并发。
// 前置：dev server 运行，已执行 db:init；禁止使用 AI_MODE=live。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";

if (process.env.AI_MODE === "live") {
  console.error("❌ 验证拒绝 AI_MODE=live；请使用 AI_MODE=replay");
  process.exit(1);
}

nextEnv.loadEnvConfig(process.cwd());
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const email = `verify-conversation-${Date.now()}@test.local`;
const password = "verify-pass-1234";
let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? `：${detail}` : ""}`);
  }
}

async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, init });
}

async function chat(page, tabId, body, headers = {}) {
  return page.evaluate(async ({ tabId, body, headers }) => {
    const response = await fetch(`/api/tabs/${tabId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const events = text
      .split("\n\n")
      .filter(Boolean)
      .map((event) => JSON.parse(event.replace(/^data: /, "")));
    return { status: response.status, events };
  }, { tabId, body, headers });
}

async function waitForMessage(page, tabId, predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await api(page, `/api/tabs/${tabId}/messages`);
    const match = result.body?.messages?.find(predicate);
    if (match) return { result, message: match };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { result: null, message: null };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
let connection;
try {
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/projects");

  const project = await api(page, "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "对话验证项目" }) });
  const workRecord = await api(page, `/api/projects/${project.body.id}/work-records`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "未命名" }) });
  const tab = await api(page, `/api/work-records/${workRecord.body.id}/tabs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_type: "requirement_analyst" }) });
  const tabId = tab.body.id;
  check("MySQL 工作区创建成功", project.status === 201 && workRecord.status === 201 && tab.status === 201);

  const firstRequest = `first-${Date.now()}`;
  const first = await chat(page, tabId, { content: "请分析一个校园二手交易需求", requestId: firstRequest, expectedVersion: 0 });
  const firstDone = first.events.find((event) => event.type === "done");
  check("发送后建立并完成正式 assistant 消息", first.status === 200 && Boolean(first.events.find((event) => event.type === "start")) && firstDone?.status === "completed");

  const refresh = await api(page, `/api/tabs/${tabId}/messages`);
  check("刷新后每条消息只显示一次", refresh.status === 200 && refresh.body.messages.length === 2 && new Set(refresh.body.messages.map((message) => message.id)).size === 2);

  const failed = await chat(page, tabId, { content: "触发零 token 失败", requestId: `failed-${Date.now()}`, expectedVersion: refresh.body.tabVersion }, { "x-pm-verify-force-error": "zero-token" });
  const failedEvent = failed.events.find((event) => event.type === "error");
  check("零 token 失败保留正式失败消息", failed.status === 200 && failedEvent?.status === "failed" && failedEvent?.content === "");

  const afterFailed = await api(page, `/api/tabs/${tabId}/messages`);
  const retry = await chat(page, tabId, { retryMessageId: failedEvent?.messageId, requestId: `retry-${Date.now()}`, expectedVersion: afterFailed.body.tabVersion });
  check("失败消息可重试", retry.status === 200 && retry.events.some((event) => event.type === "done"));

  const afterRetry = await api(page, `/api/tabs/${tabId}/messages`);
  const latestAssistant = [...afterRetry.body.messages].reverse().find((message) => message.role === "assistant" && message.status === "completed");
  const regenerate = await chat(page, tabId, { regenerate: true, messageId: latestAssistant?.id, requestId: `regenerate-${Date.now()}`, expectedVersion: afterRetry.body.tabVersion });
  check("重生成成功后替换旧历史", regenerate.status === 200 && regenerate.events.some((event) => event.type === "done"));

  const afterRegenerate = await api(page, `/api/tabs/${tabId}/messages`);
  const editableUser = [...afterRegenerate.body.messages].reverse().find((message) => message.role === "user");
  const edit = await chat(page, tabId, { editMessageId: editableUser?.id, content: "改为分析校园二手书交易需求", requestId: `edit-${Date.now()}`, expectedVersion: afterRegenerate.body.tabVersion });
  const afterEdit = await api(page, `/api/tabs/${tabId}/messages`);
  check("编辑重发成功后以新用户消息替换旧历史", edit.status === 200 && edit.events.some((event) => event.type === "done") && afterEdit.body.messages.some((message) => message.content === "改为分析校园二手书交易需求"));

  const stopVersion = afterEdit.body.tabVersion;
  const slowRequest = `stop-${Date.now()}`;
  await page.evaluate(({ tabId, slowRequest, stopVersion }) => {
    void fetch(`/api/tabs/${tabId}/chat`, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-verify-stream-delay": "1" }, body: JSON.stringify({ content: "请输出足够长的回放内容用于停止", requestId: slowRequest, expectedVersion: stopVersion }) });
  }, { tabId, slowRequest, stopVersion });
  const generating = await waitForMessage(page, tabId, (message) => message.status === "generating");
  const stopped = generating.message ? await api(page, `/api/tabs/${tabId}/messages`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: generating.message.id, requestId: `stop-operation-${Date.now()}`, expectedVersion: generating.result.body.tabVersion }) }) : { status: 0, body: null };
  const afterStop = await api(page, `/api/tabs/${tabId}/messages`);
  check("停止生成持久化为中断且保留已有内容", stopped.status === 200 && afterStop.body.messages.some((message) => message.id === generating.message?.id && message.status === "interrupted"));

  const conflictVersion = afterStop.body.tabVersion;
  const [left, right] = await Promise.all([0, 1].map((index) => chat(page, tabId, { content: `并发冲突 ${index}`, requestId: `conflict-${Date.now()}-${index}`, expectedVersion: conflictVersion })));
  check("多窗口同版本写入只有一个成功", [left, right].filter((result) => result.status === 200).length === 1 && [left, right].filter((result) => result.status === 409).length === 1);

  connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  const [messageRows] = await connection.query("SELECT id, tab_id, request_id, status FROM messages WHERE tab_id = ?", [tabId]);
  const [operationRows] = await connection.query("SELECT request_id, status, tab_version FROM tab_operations WHERE tab_id = ?", [tabId]);
  check("MySQL 可观察消息与操作记录完整", messageRows.length >= 6 && operationRows.length >= 6 && messageRows.every((row) => row.tab_id === tabId));
} finally {
  await connection?.end();
  await context.close();
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
