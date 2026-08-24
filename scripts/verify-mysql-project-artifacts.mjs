// v1.3 #04 固定回放：项目文件、上下文、快照、消息来源与 tickets 版本交付。
// 前置：dev server 运行，已执行 db:init；禁止使用 AI_MODE=live。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") {
  console.error("❌ 验证要求 AI_MODE=replay，拒绝调用真实模型");
  process.exit(1);
}
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const email = `verify-artifacts-${Date.now()}@test.local`;
const password = "verify-pass-1234";
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
    return { status: response.status, body: text ? JSON.parse(text) : null };
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
  const edited = await api(page, `/api/projects/${project.body.id}/files/${write.body?.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `${write.body?.content}\n\n用户补充说明` }) });
  const files = await api(page, `/api/projects/${project.body.id}/files`);
  const loaded = await api(page, `/api/tabs/${tab.body.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: write.body?.id }) });
  const contextFiles = await api(page, `/api/tabs/${tab.body.id}/files`);
  check("文件写入、手工更新、来源记录与上下文加载完整", write.status === 201 && edited.status === 200 && edited.body?.version === 2 && write.body?.messageFileWrite?.fileVersion === 1 && files.body?.some((file) => file.id === write.body.id) && loaded.status === 201 && contextFiles.body?.files?.some((file) => file.id === write.body.id));

  const snapshot = await api(page, `/api/projects/${project.body.id}/snapshots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tab_id: tab.body.id, content: "<!doctype html><title>原型</title>" }) });
  const snapshots = await api(page, `/api/projects/${project.body.id}/snapshots`);
  const snapshotDetail = await api(page, `/api/projects/${project.body.id}/snapshots/${snapshot.body?.id}`);
  check("HTML 快照独立版本保存且可回看", snapshot.status === 201 && snapshots.body?.[0]?.id === snapshot.body?.id && snapshotDetail.body?.content.includes("原型"));

  const ticketsTab = await api(page, `/api/work-records/${record.body.id}/tabs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_type: "ticket_splitter" }) });
  const ticketReply = await chat(page, ticketsTab.body.id, "拆成一张任务", `tickets-${Date.now()}`, 0);
  const ticketSourceId = ticketReply.events.find((event) => event.type === "done")?.messageId;
  const candidates = [{ filename: "issues/01-lost-found.md", content: "# 失物招领\n\n## 验收标准\n\n- [ ] 可发布" }];
  const replace = await api(page, `/api/projects/${project.body.id}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "replace", source_message_id: ticketSourceId, candidates }) });
  const save = await api(page, `/api/projects/${project.body.id}/ticket-sets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "save", source_message_id: ticketSourceId, candidates }) });
  const tickets = await api(page, `/api/projects/${project.body.id}/ticket-sets`);
  const download = await api(page, `/api/projects/${project.body.id}/ticket-sets/1/download`);
  check("tickets 整套替换、另存与下载保持版本契约", replace.status === 201 && save.status === 201 && tickets.body?.versions?.length === 2 && download.status === 200 && download.body?.files?.length === 1);

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
