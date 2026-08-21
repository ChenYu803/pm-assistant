// 编辑并重新发送固定回放验证：用户消息编辑入口、取消无副作用、历史截断和无重复用户消息。
// 用法：node scripts/verify-edit-resend.mjs
// 前置：dev server 运行在 localhost:3000，MongoDB 可连，默认 AI_MODE=replay。
import { chromium } from "playwright-core";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  console.error("MONGODB_URI 缺失");
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
  "VEditResendMessage",
  new mongoose.Schema({
    role: String,
    content: String,
    tab_id: mongoose.Schema.Types.ObjectId,
    timestamp: Date,
  }),
  "messages"
);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext();
const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

// 建立一个可复用的登录工作台。
const email = `verify-edit-resend-${Date.now()}@test.local`;
const password = "verify-pass-1234";
await page.goto(`${BASE}/register`);
await page.fill("#email", email);
await page.fill('input[type="password"]', password);
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
await page.fill('input[placeholder="输入项目名称"]', "编辑重发验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /编辑重发验证/ }).click();
await page.waitForURL((url) => /\/projects\/[0-9a-f]{24}$/.test(url.pathname));
await page.getByRole("button", { name: "新建工作记录" }).first().click();
await page.getByRole("button", { name: "创建", exact: true }).click();
await page.getByRole("link", { name: /未命名/ }).click();
await page.waitForURL((url) => url.pathname.startsWith("/workspace/"));
const workRecordId = page.url().split("/").pop();
await page.getByRole("button", { name: /需求分析/ }).first().click();
await page.waitForLoadState("networkidle");

const tabs = await page.evaluate(async (id) => (await fetch(`/api/work-records/${id}/tabs`)).json(), workRecordId);
const tabId = tabs[0].id;
const baseTime = Date.now();
const cancelUser = await Message.create({
  role: "user",
  content: "取消编辑前的内容",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(baseTime + 1),
});
const cancelReply = await Message.create({
  role: "assistant",
  content: "取消编辑前的回复",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(baseTime + 2),
});
const targetUser = await Message.create({
  role: "user",
  content: "原始问题",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(baseTime + 3),
});
const targetReply = await Message.create({
  role: "assistant",
  content: "原始回复",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(baseTime + 4),
});
const futureUser = await Message.create({
  role: "user",
  content: "后续消息，应被移除",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(baseTime + 5),
});
const futureReply = await Message.create({
  role: "assistant",
  content: "后续回复，应被移除",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(baseTime + 6),
});

const readMessages = () =>
  page.evaluate(async (id) => (await fetch(`/api/tabs/${id}/messages`)).json(), tabId);
async function discardFileDialogIfPresent() {
  const discardButton = page.getByRole("button", { name: "全部丢弃" });
  try {
    await discardButton.waitFor({ state: "visible", timeout: 2000 });
    await discardButton.click();
  } catch {
    // 本次回复没有文件 marker 时没有确认弹窗。
  }
}

await page.reload();
await page.waitForLoadState("networkidle");
const cancelBubble = page.locator(`[data-message-id="${cancelUser._id}"]`);
const targetBubble = page.locator(`[data-message-id="${targetUser._id}"]`);
const targetReplyBubble = page.locator(`[data-message-id="${targetReply._id}"]`);
await cancelBubble.hover();
await targetReplyBubble.hover();
check("用户消息出现编辑按钮", (await cancelBubble.getByRole("button", { name: "编辑" }).count()) === 1);
check("AI 消息不出现编辑按钮", (await targetReplyBubble.getByRole("button", { name: "编辑" }).count()) === 0);

const beforeCancel = await readMessages();
await cancelBubble.getByRole("button", { name: "编辑" }).click();
await page.locator("textarea").fill("取消后的临时修改");
await page.getByRole("button", { name: "取消编辑", exact: true }).click();
const afterCancel = await readMessages();
check(
  "取消编辑后输入框恢复原草稿",
  (await page.locator("textarea").inputValue()) === ""
);
check(
  "取消编辑不改变消息历史",
  JSON.stringify(beforeCancel.messages) === JSON.stringify(afterCancel.messages)
);

await targetBubble.hover();
await targetBubble.getByRole("button", { name: "编辑" }).click();
check("编辑时输入框回填原消息", (await page.locator("textarea").inputValue()) === "原始问题");
await page.locator("textarea").fill("修订后的问题");
const editChatRequests = [];
page.on("request", (request) => {
  if (request.method() !== "POST" || !request.url().endsWith("/chat")) return;
  try {
    editChatRequests.push(JSON.parse(request.postData() ?? "{}"));
  } catch {
    // 请求体不是 JSON 时由后续消息断言报告失败。
  }
});
await page.getByRole("button", { name: "重新发送", exact: true }).click();

await page.waitForFunction(async (id) => {
  const data = await fetch(`/api/tabs/${id}/messages`).then((res) => res.json());
  return data.messages.some((message) => message.role === "user" && message.content === "修订后的问题") &&
    data.messages.filter((message) => message.role === "assistant").length >= 2 &&
    !data.messages.some((message) => message.content === "后续回复，应被移除");
}, tabId);
await discardFileDialogIfPresent();
const afterEdit = await readMessages();
const finalMessages = afterEdit.messages;
check(
  "编辑重发后保留编辑前的历史",
  finalMessages.some((message) => message.id === cancelUser._id.toString()) &&
    finalMessages.some((message) => message.id === cancelReply._id.toString())
);
check(
  "编辑重发移除目标及其后的消息",
  !finalMessages.some((message) => [targetUser, targetReply, futureUser, futureReply].some((item) => message.id === item._id.toString()))
);
check(
  "重发请求使用编辑后的内容",
  editChatRequests.some((body) => body.content === "修订后的问题")
);
check(
  "重发历史只有一条修订后的用户消息",
  finalMessages.filter((message) => message.role === "user").length === 2 &&
    finalMessages.filter((message) => message.content === "修订后的问题").length === 1 &&
    !finalMessages.some((message) => message.content === "原始问题"),
  `(用户消息 ${finalMessages.filter((message) => message.role === "user").length} 条)`
);
check(
  "编辑重发生成新的 AI 回复",
  finalMessages.filter((message) => message.role === "assistant").length === 2,
  `(AI 消息 ${finalMessages.filter((message) => message.role === "assistant").length} 条)`
);

// 发送后不刷新页面，用户消息也应拿到真实 id 并立即可编辑。
await page.locator("textarea").fill("发送后立即编辑");
await page.getByRole("button", { name: "发送", exact: true }).click();
await page.waitForFunction(async (id) => {
  const data = await fetch(`/api/tabs/${id}/messages`).then((res) => res.json());
  return data.messages.some((message) => message.role === "user" && message.content === "发送后立即编辑") &&
    data.messages.filter((message) => message.role === "assistant").length >= 3;
}, tabId);
await discardFileDialogIfPresent();
const immediateMessages = await readMessages();
const immediateUser = immediateMessages.messages.find(
  (message) => message.role === "user" && message.content === "发送后立即编辑"
);
const immediateBubble = page.locator(`[data-message-id="${immediateUser?.id ?? "missing"}"]`);
await immediateBubble.hover();
check(
  "发送后不刷新即可编辑用户消息",
  Boolean(immediateUser) && (await immediateBubble.getByRole("button", { name: "编辑" }).count()) === 1
);
await immediateBubble.getByRole("button", { name: "编辑" }).click();
check("即时编辑回填发送内容", (await page.locator("textarea").inputValue()) === "发送后立即编辑");
await page.getByRole("button", { name: "取消编辑", exact: true }).click();

await Message.deleteMany({ tab_id: new mongoose.Types.ObjectId(tabId) });
await browser.close();
await mongoose.disconnect();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
