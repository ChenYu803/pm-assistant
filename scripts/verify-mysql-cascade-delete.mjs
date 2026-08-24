// v1.3 #06 固定回放：MySQL 项目/工作记录级联删除、事务回滚与重复删除。
// 用法：AI_MODE=replay CASCADE_DELETE_TEST_HOOKS=1 npm run verify:mysql-cascade-delete
// 前置：验证服务也必须以 AI_MODE=replay CASCADE_DELETE_TEST_HOOKS=1 启动，并已执行 db:init。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.AI_MODE !== "replay") {
  console.error("❌ 验证要求 AI_MODE=replay，拒绝调用真实模型");
  process.exit(1);
}
if (process.env.CASCADE_DELETE_TEST_HOOKS !== "1") {
  console.error("❌ 验证需要 CASCADE_DELETE_TEST_HOOKS=1");
  process.exit(1);
}

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const email = `verify-mysql-cascade-${Date.now()}@test.local`;
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

async function chat(page, tabId, content, requestId) {
  return page.evaluate(async ({ tabId, content, requestId }) => {
    const response = await fetch(`/api/tabs/${tabId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, requestId, expectedVersion: 0 }),
    });
    const text = await response.text();
    return {
      status: response.status,
      events: text.split("\n\n").filter(Boolean).map((event) => JSON.parse(event.replace(/^data: /, ""))),
    };
  }, { tabId, content, requestId });
}

async function counts(connection, projectId, workRecordId, tabId) {
  const queries = [
    ["projects", "SELECT COUNT(*) AS count FROM projects WHERE id = ?", [projectId]],
    ["workRecords", "SELECT COUNT(*) AS count FROM work_records WHERE project_id = ?", [projectId]],
    ["tabs", "SELECT COUNT(*) AS count FROM tabs WHERE work_record_id = ?", [workRecordId]],
    ["messages", "SELECT COUNT(*) AS count FROM messages WHERE tab_id = ?", [tabId]],
    ["contexts", "SELECT COUNT(*) AS count FROM agent_file_contexts WHERE tab_id = ?", [tabId]],
    ["operations", "SELECT COUNT(*) AS count FROM tab_operations WHERE tab_id = ?", [tabId]],
    ["files", "SELECT COUNT(*) AS count FROM project_files WHERE project_id = ?", [projectId]],
    ["snapshots", "SELECT COUNT(*) AS count FROM prototype_snapshots WHERE project_id = ?", [projectId]],
    ["writes", "SELECT COUNT(*) AS count FROM message_file_writes WHERE project_id = ?", [projectId]],
    ["workRecordTabs", "SELECT COUNT(*) AS count FROM tabs WHERE work_record_id = ?", [workRecordId]],
  ];
  const result = {};
  for (const [name, sql, values] of queries) {
    const [rows] = await connection.query(sql, values);
    result[name] = Number(rows[0]?.count ?? 0);
  }
  return result;
}

async function createTopology(page, label) {
  const project = await api(page, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `${label}项目` }),
  });
  const workRecord = await api(page, `/api/projects/${project.body?.id}/work-records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `${label}工作记录` }),
  });
  const tab = await api(page, `/api/work-records/${workRecord.body?.id}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "requirement_analyst" }),
  });
  const reply = await chat(page, tab.body?.id, "分析校园失物招领需求", `cascade-${label}-${Date.now()}`);
  const sourceMessageId = reply.events?.find((event) => event.type === "done")?.messageId;
  const file = await api(page, `/api/projects/${project.body?.id}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "需求分析.md",
      content: "## 用户需要发布失物信息",
      agent_type: "requirement_analyst",
      source_message_id: sourceMessageId,
    }),
  });
  const context = await api(page, `/api/tabs/${tab.body?.id}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: file.body?.id }),
  });
  const snapshot = await api(page, `/api/projects/${project.body?.id}/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tab_id: tab.body?.id, content: "<!doctype html><title>级联删除</title>" }),
  });
  check(
    `${label}夹具完整创建关联数据`,
    project.status === 201 && workRecord.status === 201 && tab.status === 201 &&
      reply.status === 200 && Boolean(sourceMessageId) && file.status === 201 &&
      context.status === 201 && snapshot.status === 201
  );
  return {
    projectId: project.body?.id,
    workRecordId: workRecord.body?.id,
    tabId: tab.body?.id,
    fileId: file.body?.id,
  };
}

function allProjectDataRemoved(result) {
  return ["projects", "workRecords", "tabs", "messages", "contexts", "operations", "files", "snapshots", "writes"]
    .every((key) => result[key] === 0);
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

  connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const workRecordCase = await createTopology(page, "工作记录删除");
  const workDelete = await api(page, `/api/work-records/${workRecordCase.workRecordId}`, { method: "DELETE" });
  const afterWorkDelete = await counts(connection, workRecordCase.projectId, workRecordCase.workRecordId, workRecordCase.tabId);
  const repeatedWorkDelete = await api(page, `/api/work-records/${workRecordCase.workRecordId}`, { method: "DELETE" });
  check("工作记录删除清理 tab、消息、上下文、操作与来源", workDelete.status === 200 && afterWorkDelete.workRecordTabs === 0 && afterWorkDelete.messages === 0 && afterWorkDelete.contexts === 0 && afterWorkDelete.operations === 0 && afterWorkDelete.writes === 0);
  check("工作记录删除保留项目级文件和快照", afterWorkDelete.projects === 1 && afterWorkDelete.files === 1 && afterWorkDelete.snapshots === 1);
  check("工作记录旧 URL 与重复删除一致返回不存在", (await api(page, `/api/work-records/${workRecordCase.workRecordId}`)).status === 404 && repeatedWorkDelete.status === 404 && repeatedWorkDelete.body?.code === "RESOURCE_NOT_FOUND");

  const rollbackCase = await createTopology(page, "故障回滚");
  const beforeRollback = await counts(connection, rollbackCase.projectId, rollbackCase.workRecordId, rollbackCase.tabId);
  const failedDelete = await api(page, `/api/projects/${rollbackCase.projectId}`, {
    method: "DELETE",
    headers: { "x-pm-assistant-test-cascade-fail-after": "agent-file-contexts" },
  });
  const afterRollback = await counts(connection, rollbackCase.projectId, rollbackCase.workRecordId, rollbackCase.tabId);
  const retryDelete = await api(page, `/api/projects/${rollbackCase.projectId}`, { method: "DELETE" });
  check("中途故障返回失败且事务完整回滚", failedDelete.status === 500 && JSON.stringify(beforeRollback) === JSON.stringify(afterRollback));
  check("故障后重试可安全完成删除", retryDelete.status === 200 && allProjectDataRemoved(await counts(connection, rollbackCase.projectId, rollbackCase.workRecordId, rollbackCase.tabId)));

  const projectCase = await createTopology(page, "项目删除");
  const projectDelete = await api(page, `/api/projects/${projectCase.projectId}`, { method: "DELETE" });
  const afterProjectDelete = await counts(connection, projectCase.projectId, projectCase.workRecordId, projectCase.tabId);
  const repeatedProjectDelete = await api(page, `/api/projects/${projectCase.projectId}`, { method: "DELETE" });
  const oldProject = await api(page, `/api/projects/${projectCase.projectId}`);
  const oldWorkRecord = await api(page, `/api/work-records/${projectCase.workRecordId}`);
  const oldMessages = await api(page, `/api/tabs/${projectCase.tabId}/messages`);
  check("项目删除清理全部 MySQL 关联表", projectDelete.status === 200 && projectDelete.body?.mode === "transaction" && allProjectDataRemoved(afterProjectDelete));
  check("项目删除后旧 URL 一致不可访问且重复请求可观察", oldProject.status === 404 && oldWorkRecord.status === 404 && oldMessages.status === 404 && repeatedProjectDelete.status === 404 && repeatedProjectDelete.body?.code === "RESOURCE_NOT_FOUND");
} finally {
  await connection?.end();
  await context.close();
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
