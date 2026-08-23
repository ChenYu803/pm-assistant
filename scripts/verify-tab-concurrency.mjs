// v1.2 #07 固定回放：tab 版本、幂等键与多窗口冲突。
// 用法：AI_MODE=replay node scripts/verify-tab-concurrency.mjs
// 前置：dev server 运行在 localhost:3000，MongoDB 可连；禁止使用 AI_MODE=live。
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.AI_MODE === "live") {
  console.error("❌ 验证拒绝 AI_MODE=live；请使用 AI_MODE=replay");
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const envRaw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
);
if (!env.MONGODB_URI) {
  console.error("❌ MONGODB_URI 缺失");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${detail ? ` ${detail}` : ""}`);
  }
};

const TAB_CONFLICT_MESSAGE = "此标签页正在被其他窗口修改";

await mongoose.connect(env.MONGODB_URI);
const Message = mongoose.model(
  "VTabConcurrencyMessage",
  new mongoose.Schema(
    {
      role: String,
      content: String,
      timestamp: Date,
      tab_id: mongoose.Schema.Types.ObjectId,
      status: String,
      request_id: String,
      replacement_target_id: mongoose.Schema.Types.ObjectId,
    },
    { collection: "messages" }
  )
);
const Tab = mongoose.model(
  "VTabConcurrencyTab",
  new mongoose.Schema(
    {
      display_name: String,
      version: Number,
      active_operation_id: String,
    },
    { collection: "tabs" }
  )
);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext();
const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);

const api = (pathname, init = {}) =>
  page.evaluate(
    async ({ pathname: requestPath, init: requestInit }) => {
      const response = await fetch(requestPath, requestInit);
      return {
        status: response.status,
        ok: response.ok,
        text: await response.text(),
      };
    },
    { pathname, init }
  );

const readTabs = async (workRecordId) => {
  const result = await api(`/api/work-records/${workRecordId}/tabs`);
  if (!result.ok) throw new Error("无法读取标签页");
  return JSON.parse(result.text);
};

const readMessages = async (tabId) => {
  const result = await api(`/api/tabs/${tabId}/messages`);
  if (!result.ok) throw new Error("无法读取消息");
  return JSON.parse(result.text);
};

const messageIdsFromSse = (text) => [
  ...new Set(
    [...text.matchAll(/"messageId":"([0-9a-f]{24})"/g)].map((match) => match[1])
  ),
];

const waitForTabIdle = async (tabId) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const tab = await Tab.findById(tabId).lean();
    if (tab && !tab.active_operation_id) return tab;
    await page.waitForTimeout(100);
  }
  throw new Error("tab 操作锁未释放");
};

const postChat = (tabId, body, headers = {}) =>
  api(`/api/tabs/${tabId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

// 建立登录工作台。
const email = `verify-tab-concurrency-${Date.now()}@test.local`;
const password = "verify-pass-1234";
await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.locator('input[type="password"]').first().fill(password);
await page.locator('input[type="password"]').nth(1).fill(password);
await page.locator('form button[type="submit"]').click();
await page.waitForURL((url) => url.pathname !== "/register");
if (page.url().includes("/login")) {
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("/login"));
}
await page.goto(`${BASE}/projects`);
await page.getByRole("button", { name: "新建项目" }).click();
await page.fill('input[placeholder="输入项目名称"]', "标签页并发回放验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /标签页并发回放验证/ }).click();
await page.waitForURL((url) => /\/projects\/[0-9a-f]{24}$/.test(url.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "创建", exact: true }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((url) => url.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");

const initialTab = (await readTabs(workRecordId))[0];
if (!initialTab?.id || !Number.isSafeInteger(initialTab.version)) {
  throw new Error("无法取得带版本的当前 tab");
}
const tabId = initialTab.id;

console.log("\n#07 tab 并发与幂等操作");
check("新建 tab 暴露可用版本", initialTab.version === 0);

const firstRequestId = `same-send-${Date.now()}`;
const firstContent = "同 requestId 只提交一次";
const duplicateResponses = await page.evaluate(
  async ({ id, requestId, content, expectedVersion }) =>
    Promise.all(
      [0, 1].map(async () => {
        const response = await fetch(`/api/tabs/${id}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-pm-verify-stream-delay": "1",
          },
          body: JSON.stringify({ content, requestId, expectedVersion }),
        });
        return {
          status: response.status,
          text: await response.text(),
        };
      })
    ),
  {
    id: tabId,
    requestId: firstRequestId,
    content: firstContent,
    expectedVersion: initialTab.version,
  }
);
const firstResponseIds = duplicateResponses.flatMap((response) =>
  messageIdsFromSse(response.text)
);
const firstAssistantId = firstResponseIds[0];
await waitForTabIdle(tabId);
const sameRequestAssistants = await Message.find({
  tab_id: new mongoose.Types.ObjectId(tabId),
  request_id: firstRequestId,
}).lean();
const sameRequestUsers = await Message.find({
  tab_id: new mongoose.Types.ObjectId(tabId),
  role: "user",
  content: firstContent,
}).lean();
check(
  "重复 requestId 的 SSE 返回同一正式消息",
  duplicateResponses.every((response) => response.status === 200) &&
    firstResponseIds.length >= 2 &&
    new Set(firstResponseIds).size === 1
);
check(
  "重复发送只写入一组用户和 assistant 消息",
  sameRequestAssistants.length === 1 && sameRequestUsers.length === 1
);
check(
  "流式操作结束后 tab 锁释放且版本推进两次",
  (await Tab.findById(tabId).lean())?.active_operation_id === undefined &&
    (await Tab.findById(tabId).lean())?.version === initialTab.version + 2
);

const staleResult = await postChat(tabId, {
  content: "过期版本不能写入",
  requestId: `stale-${Date.now()}`,
  expectedVersion: initialTab.version,
});
const staleMessages = await readMessages(tabId);
check(
  "过期版本返回明确 HTTP 409 冲突",
  staleResult.status === 409 &&
    JSON.parse(staleResult.text).error === TAB_CONFLICT_MESSAGE
);
check(
  "过期版本不写入新的消息",
  !staleMessages.messages.some((message) => message.content === "过期版本不能写入")
);

await page.locator("textarea").fill("来自过期窗口的发送");
await page.getByRole("button", { name: "发送" }).click();
const conflictText = page.getByText(TAB_CONFLICT_MESSAGE, { exact: true });
const conflictVisible = await conflictText
  .waitFor({ state: "visible" })
  .then(() => true)
  .catch(() => false);
const refreshButton = page.getByRole("button", { name: "刷新标签页" });
const refreshVisible = await refreshButton
  .waitFor({ state: "visible" })
  .then(() => true)
  .catch(() => false);
check(
  "UI 展示指定冲突提示且不自动合并",
  conflictVisible
);
check(
  "UI 提供用户手动刷新入口",
  refreshVisible
);
if (refreshVisible) await refreshButton.click();
await page.waitForTimeout(300);
check(
  "手动刷新后冲突提示消失",
  refreshVisible && !(await conflictText.isVisible())
);

const afterFirst = (await readTabs(workRecordId)).find((tab) => tab.id === tabId);
const regenerateResult = await postChat(tabId, {
  regenerate: true,
  messageId: firstAssistantId,
  requestId: `regenerate-${Date.now()}`,
  expectedVersion: afterFirst.version,
});
const regeneratedIds = messageIdsFromSse(regenerateResult.text);
await waitForTabIdle(tabId);
check(
  "重生成使用版本和幂等键并产生一个新结果",
  regenerateResult.status === 200 && regeneratedIds.length === 1
);

const editedContent = "编辑后的唯一内容";
const afterRegenerate = (await readTabs(workRecordId)).find(
  (tab) => tab.id === tabId
);
const originalUser = await Message.findOne({
  tab_id: new mongoose.Types.ObjectId(tabId),
  role: "user",
  content: firstContent,
}).lean();
const editResult = await postChat(tabId, {
  content: editedContent,
  editMessageId: originalUser?._id.toString(),
  requestId: `edit-${Date.now()}`,
  expectedVersion: afterRegenerate.version,
});
await waitForTabIdle(tabId);
const messagesAfterEdit = await readMessages(tabId);
check(
  "编辑重发使用相同并发协议并替换可见历史",
  editResult.status === 200 &&
    messagesAfterEdit.messages.some(
      (message) => message.role === "user" && message.content === editedContent
    ) &&
    !messagesAfterEdit.messages.some(
      (message) => message.role === "user" && message.content === firstContent
    )
);

const afterEdit = (await readTabs(workRecordId)).find((tab) => tab.id === tabId);
const assistantToDelete = messagesAfterEdit.messages.find(
  (message) => message.role === "assistant" && message.status === "completed"
);
const deleteRequest = {
  messageId: assistantToDelete?.id,
  requestId: `delete-${Date.now()}`,
  expectedVersion: afterEdit.version,
};
const deleteResponses = await page.evaluate(
  async ({ id, body }) =>
    Promise.all(
      [0, 1].map(async () => {
        const response = await fetch(`/api/tabs/${id}/messages`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      })
    ),
  { id: tabId, body: deleteRequest }
);
const messagesAfterDelete = await readMessages(tabId);
check(
  "重复删除返回同一成功结果且不重复执行",
  deleteResponses.every((response) => response.status === 200) &&
    !messagesAfterDelete.messages.some((message) => message.id === assistantToDelete?.id)
);

const afterDelete = (await readTabs(workRecordId)).find((tab) => tab.id === tabId);
const truncateContent = "用于编辑截断的独立消息";
const truncateSeed = await postChat(tabId, {
  content: truncateContent,
  requestId: `truncate-seed-${Date.now()}`,
  expectedVersion: afterDelete.version,
});
await waitForTabIdle(tabId);
const afterTruncateSeed = (await readTabs(workRecordId)).find(
  (tab) => tab.id === tabId
);
check(
  "截断前的独立对话通过相同版本协议创建",
  truncateSeed.status === 200
);
const messagesBeforeTruncate = await readMessages(tabId);
const userToTruncate = messagesBeforeTruncate.messages.find(
  (message) => message.role === "user" && message.content === truncateContent
);
const truncateRequest = {
  fromMessageId: userToTruncate?.id,
  requestId: `truncate-${Date.now()}`,
  expectedVersion: afterTruncateSeed.version,
};
const truncateResponses = await page.evaluate(
  async ({ id, body }) =>
    Promise.all(
      [0, 1].map(async () => {
        const response = await fetch(`/api/tabs/${id}/messages`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      })
    ),
  { id: tabId, body: truncateRequest }
);
const messagesAfterTruncate = await readMessages(tabId);
check(
  "编辑截断重复请求只执行一次",
  truncateResponses.every((response) => response.status === 200) &&
    !messagesAfterTruncate.messages.some((message) => message.id === userToTruncate?.id)
);

const renameBase = (await readTabs(workRecordId)).find((tab) => tab.id === tabId);
const renameResponses = await page.evaluate(
  async ({ id, expectedVersion }) =>
    Promise.all(
      ["窗口 A", "窗口 B"].map(async (display_name, index) => {
        const response = await fetch(`/api/tabs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name,
            expectedVersion,
            requestId: `rename-${Date.now()}-${index}`,
          }),
        });
        return { status: response.status, body: await response.json() };
      })
    ),
  { id: tabId, expectedVersion: renameBase.version }
);
const renamedTab = await Tab.findById(tabId).lean();
const successfulRename = renameResponses.find((response) => response.status === 200);
check(
  "不同窗口的同版本 tab 更新只允许一个提交",
  renameResponses.filter((response) => response.status === 200).length === 1 &&
    renameResponses.filter((response) => response.status === 409).length === 1
);
check(
  "tab 冲突不会静默覆盖已成功的数据",
  renamedTab?.display_name === successfulRename?.body?.display_name &&
    !renamedTab?.active_operation_id
);

await browser.close();
await mongoose.disconnect();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
