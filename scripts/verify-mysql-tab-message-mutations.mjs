// v1.3 #08 固定回放：MySQL tab 删除、消息删除与用户消息截断。
// 用法：AI_MODE=replay CASCADE_DELETE_TEST_HOOKS=1 npm run verify:mysql-tab-message-mutations
// 前置：验证服务也必须以 AI_MODE=replay CASCADE_DELETE_TEST_HOOKS=1 启动，并已执行 db:init。
import { chromium } from "playwright-core";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";
import { assertPlaywrightAvailable } from "./verify-mysql-fixtures.mjs";

if (process.env.AI_MODE !== "replay") {
  console.error("❌ 验证要求 AI_MODE=replay，拒绝调用真实模型");
  process.exit(1);
}
if (process.env.CASCADE_DELETE_TEST_HOOKS !== "1") {
  console.error("❌ 验证需要 CASCADE_DELETE_TEST_HOOKS=1");
  process.exit(1);
}

nextEnv.loadEnvConfig(process.cwd());
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const email = `verify-tab-message-mutations-${Date.now()}@test.local`;
const password = "verify-pass-1234";
await assertPlaywrightAvailable(chromium);
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

async function chat(page, tabId, content, requestId, expectedVersion) {
  return page.evaluate(async ({ tabId, content, requestId, expectedVersion }) => {
    const response = await fetch(`/api/tabs/${tabId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, requestId, expectedVersion }),
    });
    const text = await response.text();
    return {
      status: response.status,
      events: text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace(/^data: /, ""))),
    };
  }, { tabId, content, requestId, expectedVersion });
}

async function waitForGeneratingMessage(page, tabId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await api(page, `/api/tabs/${tabId}/messages`);
    const message = current.body?.messages?.find((item) => item.status === "generating");
    if (message) return { current, message };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { current: null, message: null };
}

async function tabCounts(connection, tabId) {
  const queries = [
    ["tabs", "SELECT COUNT(*) AS count FROM tabs WHERE id = ?", [tabId]],
    ["messages", "SELECT COUNT(*) AS count FROM messages WHERE tab_id = ?", [tabId]],
    ["contexts", "SELECT COUNT(*) AS count FROM agent_file_contexts WHERE tab_id = ?", [tabId]],
    ["writes", "SELECT COUNT(*) AS count FROM message_file_writes WHERE tab_id = ?", [tabId]],
    ["operations", "SELECT COUNT(*) AS count FROM tab_operations WHERE tab_id = ?", [tabId]],
    ["tombstones", "SELECT COUNT(*) AS count FROM tab_deletion_operations WHERE tab_id = ?", [tabId]],
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
  const first = await chat(page, tab.body?.id, `${label}第一轮`, `mutation-${label}-1-${Date.now()}`, 0);
  const firstDone = first.events?.find((event) => event.type === "done");
  const second = await chat(
    page,
    tab.body?.id,
    `${label}第二轮`,
    `mutation-${label}-2-${Date.now()}`,
    firstDone?.tabVersion
  );
  const secondDone = second.events?.find((event) => event.type === "done");
  const messages = await api(page, `/api/tabs/${tab.body?.id}/messages`);
  const sourceMessageId = messages.body?.messages?.find((message) => message.id === firstDone?.messageId)?.id;
  const file = await api(page, `/api/projects/${project.body?.id}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "需求分析.md",
      content: `# ${label}`,
      agent_type: "requirement_analyst",
      source_message_id: sourceMessageId,
    }),
  });
  const context = await api(page, `/api/tabs/${tab.body?.id}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: file.body?.id }),
  });
  check(
    `${label}夹具创建消息、来源和上下文`,
    project.status === 201 && workRecord.status === 201 && tab.status === 201 &&
      first.status === 200 && second.status === 200 && Boolean(secondDone) &&
      messages.status === 200 && messages.body?.messages?.length === 4 &&
      file.status === 201 && context.status === 201
  );
  return {
    projectId: project.body?.id,
    tabId: tab.body?.id,
    fileId: file.body?.id,
    tabVersion: messages.body?.tabVersion,
    messages: messages.body?.messages ?? [],
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
let otherContext;
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

  const single = await createTopology(page, "单条删除");
  const targetAssistant = single.messages.find((message) => message.role === "assistant");
  const laterUser = single.messages.filter((message) => message.role === "user")[1];
  await connection.execute(
    "UPDATE messages SET replacement_target_id = ? WHERE id = ?",
    [targetAssistant?.id, laterUser?.id]
  );
  await connection.execute(
    `UPDATE tabs
     SET scope_frozen = TRUE,
         freeze_status = 'frozen',
         freeze_message_id = ?,
         freeze_filename = '需求分析.md',
         freeze_document_digest = 'test-digest'
     WHERE id = ?`,
    [targetAssistant?.id, single.tabId]
  );
  await connection.execute(
    `UPDATE project_files
     SET freeze_binding_tab_id = ?,
         freeze_binding_document_digest = 'test-digest',
         freeze_binding_locked_at = NOW(3)
     WHERE id = ?`,
    [single.tabId, single.fileId]
  );
  const deleteRequestId = `delete-message-${Date.now()}`;
  const deleted = await api(page, `/api/tabs/${single.tabId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: targetAssistant?.id,
      expectedVersion: single.tabVersion,
      requestId: deleteRequestId,
    }),
  });
  const deletedReplay = await api(page, `/api/tabs/${single.tabId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: targetAssistant?.id,
      expectedVersion: single.tabVersion,
      requestId: deleteRequestId,
    }),
  });
  const afterSingle = await api(page, `/api/tabs/${single.tabId}/messages`);
  const [referenceRows] = await connection.query(
    "SELECT replacement_target_id FROM messages WHERE id = ?",
    [laterUser?.id]
  );
  const [targetWriteRows] = await connection.query(
    "SELECT COUNT(*) AS count FROM message_file_writes WHERE message_id = ?",
    [targetAssistant?.id]
  );
  const [freezeRows] = await connection.query(
    "SELECT scope_frozen, freeze_status, freeze_message_id FROM tabs WHERE id = ?",
    [single.tabId]
  );
  const [bindingRows] = await connection.query(
    "SELECT freeze_binding_tab_id FROM project_files WHERE id = ?",
    [single.fileId]
  );
  check(
    "删除单条消息只清理目标来源、替换引用和冻结关联",
    deleted.status === 200 && afterSingle.body?.messages?.length === 3 &&
      referenceRows[0]?.replacement_target_id === null && Number(targetWriteRows[0]?.count) === 0 &&
      !freezeRows[0]?.scope_frozen && freezeRows[0]?.freeze_status === "idle" &&
      freezeRows[0]?.freeze_message_id === null && bindingRows[0]?.freeze_binding_tab_id === null
  );
  check(
    "删除单条消息的同一 requestId 返回同一结果",
    deletedReplay.status === 200 && deletedReplay.body?.tabVersion === deleted.body?.tabVersion
  );

  const truncated = await createTopology(page, "编辑截断");
  const truncateTarget = truncated.messages.find((message) => message.role === "user");
  await connection.execute(
    "UPDATE messages SET replacement_target_id = id WHERE id = ?",
    [truncateTarget?.id]
  );
  const truncateRequestId = `truncate-${Date.now()}`;
  const truncate = await api(page, `/api/tabs/${truncated.tabId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromMessageId: truncateTarget?.id,
      expectedVersion: truncated.tabVersion,
      requestId: truncateRequestId,
    }),
  });
  const afterTruncate = await api(page, `/api/tabs/${truncated.tabId}/messages`);
  check(
    "编辑截断包含目标用户消息及其后全部历史",
    truncate.status === 200 && truncate.body?.deletedCount === 4 && afterTruncate.body?.messages?.length === 0
  );

  const nonUser = await createTopology(page, "非用户截断");
  const assistantStart = nonUser.messages.find((message) => message.role === "assistant");
  const nonUserRequestId = `non-user-${Date.now()}`;
  const nonUserTruncate = await api(page, `/api/tabs/${nonUser.tabId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromMessageId: assistantStart?.id,
      expectedVersion: nonUser.tabVersion,
      requestId: nonUserRequestId,
    }),
  });
  const nonUserReplay = await api(page, `/api/tabs/${nonUser.tabId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromMessageId: assistantStart?.id,
      expectedVersion: nonUser.tabVersion,
      requestId: nonUserRequestId,
    }),
  });
  check(
    "非用户消息不能作为截断起点，结果可重放",
    nonUserTruncate.status === 409 && nonUserTruncate.body?.error === "只能编辑用户消息" &&
      nonUserReplay.status === 409 && nonUserReplay.body?.tabVersion === nonUserTruncate.body?.tabVersion
  );

  const conflictRequestId = `conflict-${Date.now()}`;
  const conflict = await api(page, `/api/tabs/${nonUser.tabId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: nonUser.messages[0]?.id,
      expectedVersion: nonUser.tabVersion - 1,
      requestId: conflictRequestId,
    }),
  });
  const conflictReplay = await api(page, `/api/tabs/${nonUser.tabId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: nonUser.messages[0]?.id,
      expectedVersion: nonUser.tabVersion - 1,
      requestId: conflictRequestId,
    }),
  });
  check(
    "过期版本返回明确冲突且相同 requestId 可重放",
    conflict.status === 409 && conflict.body?.code === "TAB_VERSION_CONFLICT" &&
      conflictReplay.status === 409 && conflictReplay.body?.currentVersion === conflict.body?.currentVersion
  );

  otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto(`${BASE}/register`);
  await otherPage.fill("#email", `verify-tab-message-other-${Date.now()}@test.local`);
  await otherPage.locator('input[type="password"]').first().fill(password);
  await otherPage.locator('input[type="password"]').nth(1).fill(password);
  await otherPage.locator('form button[type="submit"]').click();
  await otherPage.waitForURL((url) => url.pathname === "/projects");
  const forbidden = await api(otherPage, `/api/tabs/${nonUser.tabId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: nonUser.messages[0]?.id,
      expectedVersion: nonUser.tabVersion,
      requestId: `ownership-${Date.now()}`,
    }),
  });
  check("跨用户不能删除其他人的消息", forbidden.status === 404);
  const forbiddenTabDelete = await api(otherPage, `/api/tabs/${nonUser.tabId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedVersion: nonUser.tabVersion,
      requestId: `tab-ownership-${Date.now()}`,
    }),
  });
  check("跨用户不能删除其他人的 tab", forbiddenTabDelete.status === 404);

  const generatingCase = await createTopology(page, "生成删除互斥");
  await page.evaluate(({ tabId, expectedVersion, requestId }) => {
    void fetch(`/api/tabs/${tabId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pm-verify-stream-delay": "1",
      },
      body: JSON.stringify({
        content: "请输出足够长的回放内容，用于验证删除与生成互斥",
        expectedVersion,
        requestId,
      }),
    });
  }, {
    tabId: generatingCase.tabId,
    expectedVersion: generatingCase.tabVersion,
    requestId: `generating-${Date.now()}`,
  });
  const generating = await waitForGeneratingMessage(page, generatingCase.tabId);
  const deleteDuringGeneration = await api(page, `/api/tabs/${generatingCase.tabId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedVersion: generating.current?.body?.tabVersion,
      requestId: `delete-generating-${Date.now()}`,
    }),
  });
  const stoppedGeneration = generating.message
    ? await api(page, `/api/tabs/${generatingCase.tabId}/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: generating.message.id,
          expectedVersion: generating.current?.body?.tabVersion,
          requestId: `stop-generating-${Date.now()}`,
        }),
      })
    : { status: 0, body: null };
  const afterGeneratingDelete = await api(page, `/api/tabs/${generatingCase.tabId}/messages`);
  check(
    "生成中的 tab 拒绝删除，不会留下删除后继续写入的残留",
    deleteDuringGeneration.status === 409 && deleteDuringGeneration.body?.code === "TAB_VERSION_CONFLICT" &&
      stoppedGeneration.status === 200 && afterGeneratingDelete.status === 200 &&
      afterGeneratingDelete.body?.messages?.some((message) => message.id === generating.message?.id && message.status === "interrupted")
  );

  const messageRollback = await createTopology(page, "消息回滚");
  const messageRollbackTarget = messageRollback.messages.find((message) => message.role === "assistant");
  const beforeMessageRollback = await tabCounts(connection, messageRollback.tabId);
  const failedMessageDelete = await api(page, `/api/tabs/${messageRollback.tabId}/messages`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-pm-assistant-test-tab-message-mutation-fail-after": "message-file-writes",
    },
    body: JSON.stringify({
      messageId: messageRollbackTarget?.id,
      expectedVersion: messageRollback.tabVersion,
      requestId: `message-rollback-${Date.now()}`,
    }),
  });
  const afterMessageRollback = await tabCounts(connection, messageRollback.tabId);
  const messageRetryState = await api(page, `/api/tabs/${messageRollback.tabId}/messages`);
  const retriedMessageDelete = await api(page, `/api/tabs/${messageRollback.tabId}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: messageRollbackTarget?.id,
      expectedVersion: messageRetryState.body?.tabVersion,
      requestId: `message-retry-${Date.now()}`,
    }),
  });
  check(
    "消息删除中途失败时消息、来源和上下文整体回滚",
    failedMessageDelete.status === 500 && beforeMessageRollback.messages === afterMessageRollback.messages &&
      beforeMessageRollback.writes === afterMessageRollback.writes &&
      beforeMessageRollback.contexts === afterMessageRollback.contexts
  );
  check("消息删除失败后可用新 requestId 手动重试", retriedMessageDelete.status === 200);

  const tabRollback = await createTopology(page, "标签页回滚");
  await connection.execute(
    `UPDATE project_files
     SET freeze_binding_tab_id = ?,
         freeze_binding_document_digest = 'test-digest',
         freeze_binding_locked_at = NOW(3)
     WHERE id = ?`,
    [tabRollback.tabId, tabRollback.fileId]
  );
  const beforeTabRollback = await tabCounts(connection, tabRollback.tabId);
  const tabDeleteRequestId = `delete-tab-${Date.now()}`;
  const failedTabDelete = await api(page, `/api/tabs/${tabRollback.tabId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-pm-assistant-test-tab-message-mutation-fail-after": "message-file-writes",
    },
    body: JSON.stringify({ expectedVersion: tabRollback.tabVersion, requestId: tabDeleteRequestId }),
  });
  const afterTabRollback = await tabCounts(connection, tabRollback.tabId);
  const tabDelete = await api(page, `/api/tabs/${tabRollback.tabId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersion: tabRollback.tabVersion, requestId: tabDeleteRequestId }),
  });
  const tabDeleteReplay = await api(page, `/api/tabs/${tabRollback.tabId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersion: tabRollback.tabVersion, requestId: tabDeleteRequestId }),
  });
  const afterTabDelete = await tabCounts(connection, tabRollback.tabId);
  const [deletedBindingRows] = await connection.query(
    "SELECT freeze_binding_tab_id FROM project_files WHERE id = ?",
    [tabRollback.fileId]
  );
  check(
    "tab 删除中途失败时所有关联数据与版本整体回滚",
    failedTabDelete.status === 500 && JSON.stringify(beforeTabRollback) === JSON.stringify(afterTabRollback)
  );
  check(
    "tab 删除清理消息、来源、上下文和操作记录，并保留重放结果",
    tabDelete.status === 200 && afterTabDelete.tabs === 0 && afterTabDelete.messages === 0 &&
      afterTabDelete.contexts === 0 && afterTabDelete.writes === 0 && afterTabDelete.operations === 0 &&
      afterTabDelete.tombstones === 1 && deletedBindingRows[0]?.freeze_binding_tab_id === null
  );
  check(
    "已删除 tab 的同一 requestId 返回原结果而不重复执行",
    tabDeleteReplay.status === 200 && tabDeleteReplay.body?.tabVersion === tabDelete.body?.tabVersion
  );
} finally {
  await connection?.end();
  await otherContext?.close();
  await context.close();
  await browser.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
