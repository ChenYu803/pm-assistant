// v1.2 #05/#06 固定回放：服务端消息事实源、停止恢复、重生成与编辑重发。
// 用法：AI_MODE=replay node scripts/verify-message-recovery.mjs
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
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` ${detail}` : ""}`);
  }
};

await mongoose.connect(env.MONGODB_URI);
const Message = mongoose.model(
  "VMessageRecovery",
  new mongoose.Schema(
    {
      role: String,
      content: String,
      timestamp: Date,
      tab_id: mongoose.Schema.Types.ObjectId,
      status: String,
      error_message: String,
      request_id: String,
      replacement_target_id: mongoose.Schema.Types.ObjectId,
      replacement_commit_message_id: mongoose.Schema.Types.ObjectId,
      superseded_by_message_id: mongoose.Schema.Types.ObjectId,
      replacement_committed: Boolean,
      replacement_kind: String,
      replacement_user_message_id: mongoose.Schema.Types.ObjectId,
    },
    { collection: "messages" }
  )
);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext();
const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);
await page.addInitScript(() => {
  window.__verifyStreamMode = "normal";
  window.__verifyForceError = null;
  window.__verifyChatRequests = [];
  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.endsWith("/chat")) {
      const headers = new Headers(init?.headers);
      if (window.__verifyStreamMode === "slow") {
        headers.set("x-pm-verify-stream-delay", "1");
      }
      if (window.__verifyForceError) {
        headers.set("x-pm-verify-force-error", window.__verifyForceError);
      }
      if (typeof init?.body === "string") {
        try {
          window.__verifyChatRequests.push(JSON.parse(init.body));
        } catch {
          // 只记录 JSON 请求体；验证不改变真实请求。
        }
      }
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
});

const setReplayMode = (streamMode, forceError = null) =>
  page.evaluate(
    ({ streamMode: nextStreamMode, forceError: nextForceError }) => {
      window.__verifyStreamMode = nextStreamMode;
      window.__verifyForceError = nextForceError;
    },
    { streamMode, forceError }
  );

const readMessages = () =>
  page.evaluate(async (id) => {
    const res = await fetch(`/api/tabs/${id}/messages`);
    return res.json();
  }, tabId);

const waitForMessage = async (predicate, label, context = {}) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const data = await readMessages();
    const found = data.messages.find((message) =>
      predicate(data.messages, message, context)
    );
    if (found) return found;
    await page.waitForTimeout(100);
  }
  throw new Error(`${label} 未找到目标消息`);
};

const sendUiMessage = async (content) => {
  const textarea = page.locator("textarea");
  await textarea.fill(content);
  await page.getByRole("button", { name: "发送" }).click();
};

const dismissFileDialog = async () => {
  const dialog = page.getByRole("dialog").filter({ hasText: "Agent 产出文件" });
  // 历史消息扫描会在刷新后的下一轮任务中触发确认框，先让该任务落定。
  await page.waitForTimeout(100);
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "全部丢弃" }).click();
    await dialog.waitFor({ state: "hidden" });
  }
};

// 建立登录工作台。
const email = `verify-message-recovery-${Date.now()}@test.local`;
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
await page.fill('input[placeholder="输入项目名称"]', "消息恢复回放验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /消息恢复回放验证/ }).click();
await page.waitForURL((url) => /\/projects\/[0-9a-f]{24}$/.test(url.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "创建", exact: true }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((url) => url.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");
const tabs = await page.evaluate(
  async (id) => (await fetch(`/api/work-records/${id}/tabs`)).json(),
  workRecordId
);
const tabId = tabs[0]?.id;
if (!tabId || !/^[0-9a-f]{24}$/.test(tabId)) {
  throw new Error("无法取得当前 tabId");
}

console.log("\n#05 服务端消息事实源");

await setReplayMode("slow");
await sendUiMessage("服务端 ID 生成验证");
const generating = await waitForMessage(
  (messages, message) =>
    message.role === "assistant" &&
    message.status === "generating",
  "生成中消息"
);
check("生成开始即有正式 assistant ID", /^[0-9a-f]{24}$/.test(generating.id));
check("生成中状态由服务端消息列表返回", generating.status === "generating");
check(
  "生成中 UI 只渲染正式 ID 气泡",
  (await page.locator(`[data-message-id="${generating.id}"]`).count()) === 1
);
await page.reload();
await page.waitForLoadState("networkidle");
const completed = await waitForMessage(
  (_messages, message, context) =>
    message.id === context.messageId && message.status === "completed",
  "完成消息",
  { messageId: generating.id }
);
await dismissFileDialog();
check("完成状态与初始正式 ID 一致", completed.id === generating.id);
check(
  "传输提前结束后 UI 从服务端完成状态恢复",
  await page
    .waitForFunction(
      (messageId) => {
        const bubble = document.querySelector(`[data-message-id="${messageId}"]`);
        return Boolean(bubble && !bubble.textContent?.includes("正在生成"));
      },
      generating.id,
      { timeout: 3_000 }
    )
    .then(() => true)
    .catch(() => false)
);
check(
  "刷新后完成消息不重复",
  (await page.locator(`[data-message-id="${generating.id}"]`).count()) === 1
);
await dismissFileDialog();

await setReplayMode("normal", "zero-token");
await sendUiMessage("零 token 失败验证");
const zeroFailure = await waitForMessage(
  (_messages, message) => message.role === "assistant" && message.status === "failed",
  "零 token 失败消息"
);
check("零 token 失败保留正式空 assistant", zeroFailure.content === "");
check(
  "零 token 失败 UI 显示失败状态",
  (await page.locator(`[data-message-id="${zeroFailure.id}"]`).getByText("生成失败").count()) === 1
);
await page.reload();
await page.waitForLoadState("networkidle");
check(
  "零 token 失败刷新后不重复",
  (await page.locator(`[data-message-id="${zeroFailure.id}"]`).count()) === 1
);
await dismissFileDialog();

await setReplayMode("slow");
await sendUiMessage("停止生成 partial 验证");
const interrupted = await waitForMessage(
  (_messages, message) => message.role === "assistant" && message.status === "generating",
  "待停止消息"
);
await waitForMessage(
  (_messages, message, context) =>
    message.id === context.messageId && message.content.length > 0,
  "已生成 partial 消息",
  { messageId: interrupted.id }
);
await page.getByRole("button", { name: "停止生成" }).click();
const interruptedFinal = await waitForMessage(
  (_messages, message, context) =>
    message.id === context.messageId && message.status === "interrupted",
  "中断消息",
  { messageId: interrupted.id }
);
check("停止把 partial 保存在同一正式消息", interruptedFinal.content.length > 0);
await page.reload();
await page.waitForLoadState("networkidle");
check(
  "中断消息刷新后仍只显示一次",
  (await page.locator(`[data-message-id="${interrupted.id}"]`).count()) === 1
);
await dismissFileDialog();

console.log("\n#06 重生成与编辑恢复");

await setReplayMode("normal");
await sendUiMessage("用于重生成的原始回复");
const originalAssistant = await waitForMessage(
  (messages, message, context) => {
    const userIndex = messages.findIndex(
      (item) => item.role === "user" && item.content === context.userContent
    );
    return (
      userIndex >= 0 &&
      messages[userIndex + 1]?.id === message.id &&
      message.role === "assistant" &&
      message.status === "completed"
    );
  },
  "原始回复",
  { userContent: "用于重生成的原始回复" }
);
await dismissFileDialog();
await setReplayMode("normal", "zero-token");
const originalBubble = page.locator(`[data-message-id="${originalAssistant.id}"]`);
await originalBubble.hover();
await originalBubble.getByRole("button", { name: "重新输出" }).click();
const regenerateFailure = await waitForMessage(
  (_messages, message, context) =>
    message.role === "assistant" &&
    message.status === "failed" &&
    message.replacesMessageId === context.originalAssistantId,
  "重生成失败候选",
  { originalAssistantId: originalAssistant.id }
);
const afterRegenerateFailure = await readMessages();
check(
  "重生成失败保留旧 assistant",
  afterRegenerateFailure.messages.some((message) => message.id === originalAssistant.id)
);
check(
  "重生成失败候选提供重试入口",
  (await page.locator(`[data-message-id="${regenerateFailure.id}"]`).getByRole("button", { name: "重试" }).count()) === 1
);

await setReplayMode("normal");
const regenerateFailureBubble = page.locator(`[data-message-id="${regenerateFailure.id}"]`);
await regenerateFailureBubble.hover();
await regenerateFailureBubble.getByRole("button", { name: "重试" }).click();
const regenerated = await waitForMessage(
  (_messages, message, context) =>
    message.role === "assistant" &&
    message.status === "completed" &&
    message.replacesMessageId === context.originalAssistantId,
  "重生成成功消息",
  { originalAssistantId: originalAssistant.id }
);
await dismissFileDialog();
const afterRegenerateSuccess = await readMessages();
check(
  "重生成成功后旧新 assistant 不同时可见",
  !afterRegenerateSuccess.messages.some((message) => message.id === originalAssistant.id) &&
    afterRegenerateSuccess.messages.filter((message) => message.id === regenerated.id).length === 1
);

await sendUiMessage("编辑前用户问题");
const editTargetUser = await waitForMessage(
  (_messages, message) => message.role === "user" && message.content === "编辑前用户问题",
  "待编辑用户消息"
);
await waitForMessage(
  (messages, message, context) => {
    const userIndex = messages.findIndex(
      (item) => item.role === "user" && item.content === context.userContent
    );
    return messages[userIndex + 1]?.id === message.id && message.status === "completed";
  },
  "编辑前回复",
  { userContent: "编辑前用户问题" }
);
await dismissFileDialog();
await sendUiMessage("编辑后的旧历史应保留");
const laterUser = await waitForMessage(
  (_messages, message) => message.role === "user" && message.content === "编辑后的旧历史应保留",
  "后续用户消息"
);
await waitForMessage(
  (messages, message, context) => {
    const userIndex = messages.findIndex(
      (item) => item.role === "user" && item.content === context.userContent
    );
    return messages[userIndex + 1]?.id === message.id && message.status === "completed";
  },
  "后续回复",
  { userContent: "编辑后的旧历史应保留" }
);
await dismissFileDialog();

await setReplayMode("normal", "zero-token");
const editTargetBubble = page.locator(`[data-message-id="${editTargetUser.id}"]`);
await editTargetBubble.hover();
await editTargetBubble.getByRole("button", { name: "编辑" }).click();
await page.locator("textarea").fill("编辑后用户问题");
await page.getByRole("button", { name: "重新发送" }).click();
const editFailure = await waitForMessage(
  (_messages, message) =>
    message.role === "assistant" &&
    message.status === "failed" &&
    message.replacementKind === "edit",
  "编辑重发失败候选"
);
const afterEditFailure = await readMessages();
check(
  "编辑重发失败不静默删除原消息和后续历史",
  afterEditFailure.messages.some((message) => message.id === editTargetUser.id) &&
    afterEditFailure.messages.some((message) => message.id === laterUser.id)
);

await setReplayMode("normal");
const editFailureBubble = page.locator(`[data-message-id="${editFailure.id}"]`);
await editFailureBubble.hover();
await editFailureBubble.getByRole("button", { name: "重试" }).click();
const editedAssistant = await waitForMessage(
  (_messages, message) =>
    message.role === "assistant" &&
    message.status === "completed" &&
    message.replacementKind === "edit",
  "编辑重发成功消息"
);
await dismissFileDialog();
const afterEditSuccess = await readMessages();
check(
  "编辑重发成功后才替换后续历史",
  afterEditSuccess.messages.some(
    (message) => message.role === "user" && message.content === "编辑后用户问题"
  ) &&
    !afterEditSuccess.messages.some((message) => message.id === editTargetUser.id) &&
    !afterEditSuccess.messages.some((message) => message.id === laterUser.id) &&
    afterEditSuccess.messages.some((message) => message.id === editedAssistant.id)
);

const retryAttempts = await Message.find({
  _id: { $in: [regenerateFailure.id, regenerated.id, editFailure.id, editedAssistant.id] },
})
  .lean()
  .exec();
check(
  "失败与重试使用不同 requestId",
  new Set(retryAttempts.map((message) => message.request_id).filter(Boolean)).size === retryAttempts.length
);

await setReplayMode("normal", "zero-token");
await sendUiMessage("连续失败重试验证");
const firstRetryFailure = await waitForMessage(
  (messages, message, context) => {
    const userIndex = messages.findIndex(
      (item) => item.role === "user" && item.content === context.userContent
    );
    return messages[userIndex + 1]?.id === message.id && message.status === "failed";
  },
  "首次失败消息",
  { userContent: "连续失败重试验证" }
);
await setReplayMode("normal", "zero-token");
const firstRetryBubble = page.locator(`[data-message-id="${firstRetryFailure.id}"]`);
await firstRetryBubble.hover();
await firstRetryBubble.getByRole("button", { name: "重试" }).click();
const secondRetryFailure = await waitForMessage(
  (_messages, message, context) =>
    message.status === "failed" &&
    message.replacesMessageId === context.replacesMessageId,
  "第二次失败消息",
  { replacesMessageId: firstRetryFailure.id }
);
await setReplayMode("normal");
const secondRetryBubble = page.locator(`[data-message-id="${secondRetryFailure.id}"]`);
await secondRetryBubble.hover();
await secondRetryBubble.getByRole("button", { name: "重试" }).click();
const completedRetry = await waitForMessage(
  (_messages, message, context) =>
    message.status === "completed" &&
    message.replacesMessageId === context.replacesMessageId,
  "连续重试成功消息",
  { replacesMessageId: firstRetryFailure.id }
);
await dismissFileDialog();
const afterRepeatedRetry = await readMessages();
check(
  "连续重试成功后不保留更早失败候选",
  !afterRepeatedRetry.messages.some((message) => message.id === firstRetryFailure.id) &&
    !afterRepeatedRetry.messages.some((message) => message.id === secondRetryFailure.id) &&
    afterRepeatedRetry.messages.some((message) => message.id === completedRetry.id)
);

await sendUiMessage("requestId 幂等重放验证");
const idempotentAssistant = await waitForMessage(
  (messages, message, context) => {
    const userIndex = messages.findIndex(
      (item) => item.role === "user" && item.content === context.userContent
    );
    return messages[userIndex + 1]?.id === message.id && message.status === "completed";
  },
  "幂等验证消息",
  { userContent: "requestId 幂等重放验证" }
);
await dismissFileDialog();
const idempotentBefore = await readMessages();
const latestRequest = await page.evaluate(() => window.__verifyChatRequests.at(-1));
const idempotentReplay = await page.evaluate(async ({ id, body }) => {
  const response = await fetch(`/api/tabs/${id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, body: await response.text() };
}, { id: tabId, body: latestRequest });
const idempotentAfter = await readMessages();
check(
  "同一 requestId 重放不新增 assistant",
  idempotentReplay.ok &&
    idempotentReplay.body.includes(idempotentAssistant.id) &&
    idempotentAfter.messages.length === idempotentBefore.messages.length
);

const concurrentRequestId = `request-concurrent-${Date.now()}`;
const concurrentContent = "同 requestId 并发验证";
const concurrentResponses = await page.evaluate(
  async ({ id, content, requestId }) =>
    Promise.all(
      [0, 1].map(async () => {
        const response = await fetch(`/api/tabs/${id}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, requestId }),
        });
        await response.text();
        return response.ok;
      })
    ),
  { id: tabId, content: concurrentContent, requestId: concurrentRequestId }
);
const concurrentAssistants = await Message.find({
  tab_id: new mongoose.Types.ObjectId(tabId),
  request_id: concurrentRequestId,
}).lean();
const concurrentUsers = await Message.find({
  tab_id: new mongoose.Types.ObjectId(tabId),
  role: "user",
  content: concurrentContent,
}).lean();
check(
  "并发同 requestId 只提交一组消息",
  concurrentResponses.every(Boolean) &&
    concurrentAssistants.length === 1 &&
    concurrentUsers.length === 1
);

await browser.close();
await mongoose.disconnect();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
