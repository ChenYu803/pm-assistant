// v1.3 #04 固定回放：项目文件、上下文、快照、消息来源与 tickets 版本交付。
// 前置：dev server 运行，已执行 db:init；禁止使用 AI_MODE=live。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") {
  console.error("❌ 验证要求 AI_MODE=replay，拒绝调用真实模型");
  process.exit(1);
}
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const email = `verify-artifacts-${Date.now()}@test.local`;
const password = "verify-pass-1234";
await assertPlaywrightAvailable(chromium);
let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.error(`  ❌ ${name}${detail ? `：${detail}` : ""}`); }
}

async function api(page, path, init) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, init);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return {
      status: response.status,
      body,
      headers: Object.fromEntries(response.headers.entries()),
    };
  }, { path, init });
}

async function chat(page, tabId, content, requestId, expectedVersion) {
  return page.evaluate(async ({ tabId, content, requestId, expectedVersion }) => {
    const response = await fetch(`/api/tabs/${tabId}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, requestId, expectedVersion }) });
    const text = await response.text();
    return { status: response.status, events: text.split("\n\n").filter(Boolean).map((event) => JSON.parse(event.replace(/^data: /, ""))) };
  }, { tabId, content, requestId, expectedVersion });
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

  const project = await api(page, "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "成果验证项目" }) });
  const record = await api(page, `/api/projects/${project.body.id}/work-records`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "验证工作记录" }) });
  const tab = await api(page, `/api/work-records/${record.body.id}/tabs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_type: "requirement_analyst" }) });
  const first = await chat(page, tab.body.id, "分析校园失物招领需求", `artifact-${Date.now()}`, 0);
  const sourceId = first.events.find((event) => event.type === "done")?.messageId;
  check("回放生成可作为文件来源", first.status === 200 && Boolean(sourceId));

  const write = await api(page, `/api/projects/${project.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "需求分析.md", content: "## 1. 用户需要发布失物信息", agent_type: "requirement_analyst", source_message_id: sourceId }) });
  const append = await api(page, `/api/projects/${project.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "需求分析.md", content: "## 1. 用户需要寻找失物", agent_type: "requirement_analyst", source_message_id: sourceId }) });
  const edited = await api(page, `/api/projects/${project.body.id}/files/${write.body?.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `${write.body?.content}\n\n用户补充说明` }) });
  const files = await api(page, `/api/projects/${project.body.id}/files`);
  const loaded = await api(page, `/api/tabs/${tab.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: write.body?.id }) });
  const contextFiles = await api(page, `/api/tabs/${tab.body.id}/files`);
  check("文件写入、需求分析追加、手工更新、来源记录与上下文加载完整", write.status === 201 && append.status === 201 && append.body?.content.includes("## 2. 用户需要寻找失物") && edited.status === 200 && edited.body?.version === 3 && write.body?.messageFileWrite?.fileVersion === 1 && files.body?.some((file) => file.id === write.body.id) && loaded.status === 201 && contextFiles.body?.files?.some((file) => file.id === write.body.id));

  const removed = await api(page, `/api/tabs/${tab.body.id}/files/${write.body?.id}`, { method: "DELETE" });
  const contextAfterRemoval = await api(page, `/api/tabs/${tab.body.id}/files`);
  const reloaded = await api(page, `/api/tabs/${tab.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: write.body?.id }) });
  const workingDoc = await api(page, `/api/projects/${project.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "需求分析-工作文档（验证）.md", content: "# 中间过程", agent_type: "requirement_analyst", source_message_id: sourceId }) });
  const workingDocLoad = await api(page, `/api/tabs/${tab.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: workingDoc.body?.id }) });
  const invalidFilename = await api(page, `/api/projects/${project.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "README.md", content: "# 不允许", agent_type: "requirement_analyst" }) });
  const oversized = await api(page, `/api/projects/${project.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "原型.md", content: "x".repeat(3 * 1024 * 1024 + 1), agent_type: "prototype" }) });
  check("上下文移除、工作文档隔离、白名单和 3 MiB 限制保持契约", removed.status === 200 && !contextAfterRemoval.body?.files?.some((file) => file.id === write.body.id) && reloaded.status === 201 && workingDoc.status === 201 && !workingDoc.body?.content.startsWith("<!--") && workingDocLoad.status === 400 && invalidFilename.status === 400 && oversized.status === 413);

  const failedWriteName = "原型.md";
  const failedWrite = await api(page, `/api/projects/${project.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-verify-mysql-write-fail": "1" }, body: JSON.stringify({ filename: failedWriteName, content: "# 失败事务", agent_type: "requirement_analyst", source_message_id: sourceId }) });
  const filesAfterFailedWrite = await api(page, `/api/projects/${project.body.id}/files`);
  check("来源记录写入失败时不留下半套文件", failedWrite.status === 500 && !filesAfterFailedWrite.body?.some((file) => file.filename === failedWriteName));

  const otherProject = await api(page, "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "跨项目边界验证" }) });
  const otherFile = await api(page, `/api/projects/${otherProject.body?.id}/files`, { method: "POST", headers: { "Content-Type": "application/json", "x-pm-assistant-test-system-write": "1" }, body: JSON.stringify({ filename: "prd.md", content: "# 其他项目", agent_type: "mvp_prd" }) });
  const crossRead = await api(page, `/api/projects/${project.body.id}/files/${otherFile.body?.id}`);
  const crossPatch = await api(page, `/api/projects/${project.body.id}/files/${otherFile.body?.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "越权修改" }) });
  const crossDownload = await api(page, `/api/projects/${project.body.id}/files/${otherFile.body?.id}/download`);
  const crossPolish = await api(page, `/api/projects/${project.body.id}/files/${otherFile.body?.id}/polish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "越权润色" }) });
  const crossLoad = await api(page, `/api/tabs/${tab.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: otherFile.body?.id }) });
  const crossDelete = await api(page, `/api/projects/${project.body.id}/files/${otherFile.body?.id}`, { method: "DELETE" });
  check("跨项目文件读取、修改、下载、润色、加载和删除均被拒绝", otherProject.status === 201 && otherFile.status === 201 && [crossRead, crossPatch, crossDownload, crossPolish, crossLoad, crossDelete].every((response) => response.status === 404));

  const snapshot = await api(page, `/api/projects/${project.body.id}/snapshots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tab_id: tab.body.id, content: "<!doctype html><title>原型</title>" }) });
  const snapshots = await api(page, `/api/projects/${project.body.id}/snapshots`);
  const snapshotDetail = await api(page, `/api/projects/${project.body.id}/snapshots/${snapshot.body?.id}`);
  check("HTML 快照独立版本保存且可回看", snapshot.status === 201 && snapshots.body?.[0]?.id === snapshot.body?.id && snapshotDetail.body?.content.includes("原型"));
  const fileTreeAfterSnapshot = await api(page, `/api/projects/${project.body.id}/files`);
  check("HTML 快照不进入普通文件树或 Agent 上下文", !fileTreeAfterSnapshot.body?.some((file) => file.filename.endsWith(".html")) && !contextFiles.body?.files?.some((file) => file.filename.endsWith(".html")));

  const ticketsTab = await api(page, `/api/work-records/${record.body.id}/tabs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_type: "ticket_splitter" }) });
  const ticketReply = await chat(page, ticketsTab.body.id, "拆成一张任务", `tickets-${Date.now()}`, 0);
  const ticketSourceId = ticketReply.events.find((event) => event.type === "done")?.messageId;
  const candidates = [{ filename: "issues/01-lost-found.md", content: "# 失物招领\n\n**What to build:** 用户可以发布失物信息。\n\n**Blocked by:** None\n\n## 验收标准\n\n- [ ] 可发布" }];
  const replace = await api(page, `/api/projects/${project.body.id}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "replace", source_message_id: ticketSourceId, candidates }) });
  const save = await api(page, `/api/projects/${project.body.id}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "save", source_message_id: ticketSourceId, candidates }) });
  const tickets = await api(page, `/api/projects/${project.body.id}/ticket-sets`);
  const download = await api(page, `/api/projects/${project.body.id}/ticket-sets/1/download`);
  check("tickets 整套替换、另存与下载保持版本契约", replace.status === 201 && save.status === 201 && tickets.body?.versions?.length === 2 && download.status === 200 && download.body?.files?.length === 1 && download.headers["content-disposition"]?.includes("tickets-v1.json"));
  const incompleteTickets = await api(page, `/api/projects/${project.body.id}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "replace", source_message_id: ticketSourceId, candidates: [{ filename: "issues/02-skipped.md", content: candidates[0].content }] }) });
  const ticketsAfterRejectedDelivery = await api(page, `/api/projects/${project.body.id}/ticket-sets`);
  check("tickets 拒绝非连续候选且保留已有完整版本", incompleteTickets.status === 400 && ticketsAfterRejectedDelivery.body?.versions?.length === 2 && ticketsAfterRejectedDelivery.body?.versions.every((set) => set.files.length === 1));
  const nearLimitTicket = `${candidates[0].content}\n${"x".repeat(3 * 1024 * 1024 - Buffer.byteLength(candidates[0].content, "utf8") - 1)}`;
  const oversizedDeliveredTicket = await api(page, `/api/projects/${project.body.id}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "save", source_message_id: ticketSourceId, candidates: [{ filename: "issues/01-near-limit.md", content: nearLimitTicket }] }) });
  const ticketsAfterOversizedDelivery = await api(page, `/api/projects/${project.body.id}/ticket-sets`);
  check("changelog 注入后的 ticket 仍受 3 MiB 限制且不留下半套版本", oversizedDeliveredTicket.status === 413 && ticketsAfterOversizedDelivery.body?.versions?.length === 2);

  connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  const [fileRows] = await connection.query("SELECT id, project_id, version FROM project_files WHERE project_id = ?", [project.body.id]);
  const [writeRows] = await connection.query("SELECT message_id, tab_id, project_file_id, file_version FROM message_file_writes WHERE project_id = ?", [project.body.id]);
  const [contextRows] = await connection.query("SELECT tab_id, file_id FROM agent_file_contexts WHERE tab_id = ?", [tab.body.id]);
  const [snapshotRows] = await connection.query("SELECT project_id, tab_id, version FROM prototype_snapshots WHERE project_id = ?", [project.body.id]);
  check("MySQL 可观察关联、版本与来源记录完整", fileRows.length >= 3 && writeRows.length >= 3 && contextRows.length === 1 && snapshotRows[0]?.tab_id === tab.body.id && snapshotRows[0]?.version === 1);
} finally {
  await connection?.end();
  await context.close();
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
