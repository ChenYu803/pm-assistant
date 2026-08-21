// 消息交互批固定回放验证：复制/删除、替换式重新输出、停止生成、智能滚动、批量文件确认。
// 用法：node scripts/verify-message-interactions.mjs
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
  "VInteractionMessage",
  new mongoose.Schema({ role: String, content: String, tab_id: mongoose.Schema.Types.ObjectId, timestamp: Date }),
  "messages"
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

await page.addInitScript(() => {
  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (window.__verifySlowChat && url.endsWith("/chat")) {
      const headers = new Headers(init?.headers);
      headers.set("x-pm-verify-stream-delay", "1");
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
});

// 建立一个可复用的登录工作台。
const email = `verify-interactions-${Date.now()}@test.local`;
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
await page.fill('input[placeholder="输入项目名称"]', "消息交互验证");
await page.locator('form button[type="submit"]').click();
await page.getByRole("link", { name: /消息交互验证/ }).click();
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
const workRecord = await page.evaluate(async (id) => (await fetch(`/api/work-records/${id}`)).json(), workRecordId);
const projectId = workRecord.project_id;

async function lastAssistantId() {
  return page.evaluate(async (id) => {
    const data = await fetch(`/api/tabs/${id}/messages`).then((res) => res.json());
    return data.messages.filter((message) => message.role === "assistant").at(-1)?.id ?? null;
  }, tabId);
}

async function waitForStreamSettled() {
  await page.waitForFunction(
    () => {
      const streaming = [...document.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("停止生成")
      );
      return !streaming;
    },
    undefined,
    { polling: "raf", timeout: 30_000 }
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
}

async function waitForRegeneration(previousAssistantId) {
  await page.waitForFunction(
    async ({ id, previousId }) => {
      const data = await fetch(`/api/tabs/${id}/messages`).then((res) => res.json());
      const lastAssistant = data.messages.filter((message) => message.role === "assistant").at(-1);
      return lastAssistant && lastAssistant.id !== previousId;
    },
    { id: tabId, previousId: previousAssistantId },
    { polling: "raf", timeout: 30_000 }
  );
  await waitForStreamSettled();
}

// 复制：复制结果只保留用户可见正文，不泄漏 FILE/SCOPE 协议标记。
const copyMessage = await Message.create({
  role: "assistant",
  content: "可见正文\n%%%SCOPE_FROZEN%%%\n%%%FILE_BEGIN%%% notes.md\n文件正文\n%%%FILE_END%%%",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(),
});
await page.reload();
await page.waitForLoadState("networkidle");
await page.getByTestId("message-bubble").first().waitFor();
const initialFileDialog = page.getByRole("dialog");
if (await initialFileDialog.count()) {
  await initialFileDialog.getByRole("button", { name: "全部丢弃" }).click();
}
const copyBubble = page.locator(`[data-message-id="${copyMessage._id}"]`);
await copyBubble.hover();
await copyBubble.getByRole("button", { name: "复制" }).click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
check("复制按钮出现", true);
check("复制内容不含协议 marker", !/%%%/.test(copied), `(${copied})`);
check("复制内容保留正文", copied.includes("可见正文") && copied.includes("文件正文"));

// 首先丢弃历史 marker 的待确认文件，避免影响删除断言。
// 删除：确认弹窗后 API 删除，刷新也不再出现。
await copyBubble.hover();
await copyBubble.getByRole("button", { name: "删除" }).click();
await page.getByRole("alertdialog").waitFor();
await page.getByRole("alertdialog").getByRole("button", { name: "删除", exact: true }).click();
await page.waitForTimeout(400);
const remainingAfterDelete = await page.evaluate(async (id) => (await fetch(`/api/tabs/${id}/messages`)).json(), tabId);
check("删除消息确认弹窗出现", true);
check("删除后消息从历史消失", !remainingAfterDelete.messages.some((message) => message.id === copyMessage._id.toString()));

// 替换式重新输出：服务端移除最后一条 assistant，不新增 user，连续两次后数量仍不膨胀。
const priorReply = await Message.create({
  role: "assistant",
  content: "较早的 AI 回复，不应显示重新输出",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(Date.now() - 2000),
});
const regenerateUser = await Message.create({
  role: "user",
  content: "请生成第一版回复",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(),
});
const regenerateReply = await Message.create({
  role: "assistant",
  content: "旧回复，应被替换\n\n%%%FILE_BEGIN%%% legacy.md\n# Legacy\n旧回复写入的文件\n%%%FILE_END%%%",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(),
});
const legacyWrite = await page.evaluate(async (id) => {
  const res = await fetch(`/api/projects/${id}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "legacy.md",
      content: "# Legacy\n旧回复写入的文件",
      agent_type: "requirement_analyst",
    }),
  });
  return res.ok;
}, projectId);
check("旧回复文件已写入项目", legacyWrite);
await page.reload();
await page.waitForLoadState("networkidle");
const regenerateButtons = page.getByRole("button", { name: "重新输出" });
check("只有最后一条 AI 回复显示重新输出", (await regenerateButtons.count()) === 1);
const firstAssistantId = await lastAssistantId();
await regenerateButtons.click();
await waitForRegeneration(firstAssistantId);
const consistencyDialog = page.getByRole("dialog");
await consistencyDialog.getByText("已写入文件与新回复可能不同步").waitFor();
check("旧文件缺失时出现一致性提示", true);
check("一致性提示列出旧文件", (await consistencyDialog.getByText("legacy.md").count()) === 1);
await consistencyDialog.getByRole("button", { name: "更新文件" }).click();
const updateFileDialog = page.getByRole("dialog");
await updateFileDialog.getByRole("button", { name: /批量写入/ }).waitFor();
await updateFileDialog.getByRole("button", { name: /批量写入/ }).click();
await updateFileDialog.waitFor({ state: "hidden" });
const filesAfterUpdate = await page.evaluate(async (id) => (await fetch(`/api/projects/${id}/files`)).json(), projectId);
const updatedRequirementFile = filesAfterUpdate.find((file) => file.filename === "需求分析.md");
const updatedRequirementDetail = updatedRequirementFile
  ? await page.evaluate(async ({ projectId: id, fileId }) => (await fetch(`/api/projects/${id}/files/${fileId}`)).json(), {
      projectId,
      fileId: updatedRequirementFile.id,
    })
  : null;
check("选择更新后复用文件确认写入流程", updatedRequirementDetail?.content?.includes("本校大学生在毕业季") === true);
const afterFirstRegenerate = await page.evaluate(async (id) => (await fetch(`/api/tabs/${id}/messages`)).json(), tabId);
check("重新输出不新增用户消息", afterFirstRegenerate.messages.filter((message) => message.role === "user").length === 1);
check("重新输出替换旧 AI 回复", afterFirstRegenerate.messages.filter((message) => message.role === "assistant").length === 2 && !afterFirstRegenerate.messages.some((message) => message.content.includes("旧回复，应被替换")));

// 旧回复的文件都已通过更新流程写入，新回复仍输出同名文件时不应出现一致性提示。
const sameFilesAssistantId = await lastAssistantId();
await page.getByRole("button", { name: "重新输出" }).click();
await waitForRegeneration(sameFilesAssistantId);
await page.waitForTimeout(300);
const sameFilesDialog = page.getByRole("dialog");
check("新回复仍输出已写入文件时不出现一致性提示", (await sameFilesDialog.getByText("已写入文件与新回复可能不同步").count()) === 0);
if (await sameFilesDialog.count()) {
  await sameFilesDialog.getByRole("button", { name: "全部丢弃" }).click();
  await sameFilesDialog.waitFor({ state: "hidden" });
}

// 第二次构造一个已写入但新回复不再输出的文件，验证「保持不变」分支不触发写入。
const afterSameFilesRegenerate = await page.evaluate(async (id) => (await fetch(`/api/tabs/${id}/messages`)).json(), tabId);
const generatedReply = afterSameFilesRegenerate.messages.find(
  (message) => message.role === "assistant" && message.content.includes("本校大学生在毕业季")
);
if (generatedReply) await Message.deleteOne({ _id: generatedReply.id });
const keepUser = await Message.create({
  role: "user",
  content: "请重新生成另一版回复",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(Date.now() + 1000),
});
const keepReply = await Message.create({
  role: "assistant",
  content: "另一条旧回复\n\n%%%FILE_BEGIN%%% keep-old.md\n# Keep original\n保持分支的旧文件\n%%%FILE_END%%%",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(Date.now() + 2000),
});
await page.evaluate(async (id) => {
  await fetch(`/api/projects/${id}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "keep-old.md",
      content: "# Keep original\n保持分支的旧文件",
      agent_type: "requirement_analyst",
    }),
  });
}, projectId);
await page.reload();
await page.waitForLoadState("networkidle");
const keepAssistantId = await lastAssistantId();
await page.getByRole("button", { name: "重新输出" }).click();
await waitForRegeneration(keepAssistantId);
const keepDialog = page.getByRole("dialog");
await keepDialog.getByText("已写入文件与新回复可能不同步").waitFor();
await keepDialog.getByRole("button", { name: "保持不变" }).click();
await keepDialog.waitFor({ state: "hidden" });
await page.waitForTimeout(300);
check("选择保持后不打开文件写入确认", (await page.getByRole("dialog").count()) === 0);
const filesAfterKeep = await page.evaluate(async (id) => (await fetch(`/api/projects/${id}/files`)).json(), projectId);
const keptFile = filesAfterKeep.find((file) => file.filename === "keep-old.md");
const keptFileDetail = keptFile
  ? await page.evaluate(async ({ projectId: id, fileId }) => (await fetch(`/api/projects/${id}/files/${fileId}`)).json(), {
      projectId,
      fileId: keptFile.id,
    })
  : null;
check("选择保持后旧文件内容不变", keptFileDetail?.content?.includes("保持分支的旧文件") === true);

const secondRegenerateAssistantId = await lastAssistantId();
await page.getByRole("button", { name: "重新输出" }).click();
await waitForRegeneration(secondRegenerateAssistantId);
const afterSecondRegenerate = await page.evaluate(async (id) => (await fetch(`/api/tabs/${id}/messages`)).json(), tabId);
check("可以连续重新输出且历史不膨胀", afterSecondRegenerate.messages.filter((message) => message.role === "user").length === 2 && afterSecondRegenerate.messages.filter((message) => message.role === "assistant").length === 2);
await page.waitForTimeout(300);
const secondRegenerateDialog = page.getByRole("dialog");
if (await secondRegenerateDialog.count()) {
  await secondRegenerateDialog.getByRole("button", { name: "全部丢弃" }).click();
  await secondRegenerateDialog.waitFor({ state: "hidden" });
}

// 旧回复含有但从未写入项目的文件，不应触发一致性提示。
const unwrittenUser = await Message.create({
  role: "user",
  content: "请再生成一版但先不要写入旧文件",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(Date.now() + 3000),
});
const unwrittenReply = await Message.create({
  role: "assistant",
  content: "未写入的旧回复\n\n%%%FILE_BEGIN%%% unwritten-old.md\n# Unwritten\n未落盘文件\n%%%FILE_END%%%",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(Date.now() + 4000),
});
await page.reload();
await page.waitForLoadState("networkidle");
const unwrittenHistoryDialog = page.getByRole("dialog");
if (await unwrittenHistoryDialog.count()) {
  await unwrittenHistoryDialog.getByRole("button", { name: "全部丢弃" }).click();
  await unwrittenHistoryDialog.waitFor({ state: "hidden" });
}
const unwrittenAssistantId = await lastAssistantId();
await page.getByRole("button", { name: "重新输出" }).click();
await waitForRegeneration(unwrittenAssistantId);
await page.waitForTimeout(300);
const unwrittenRegenerateDialog = page.getByRole("dialog");
check("旧文件未写入时不出现一致性提示", (await unwrittenRegenerateDialog.getByText("已写入文件与新回复可能不同步").count()) === 0);
if (await unwrittenRegenerateDialog.count()) {
  await unwrittenRegenerateDialog.getByRole("button", { name: "全部丢弃" }).click();
  await unwrittenRegenerateDialog.waitFor({ state: "hidden" });
}

await Message.deleteMany({
  tab_id: new mongoose.Types.ObjectId(tabId),
  role: "assistant",
  content: { $regex: "本校大学生在毕业季" },
});
await Message.deleteMany({ _id: { $in: [priorReply._id, regenerateUser._id, regenerateReply._id, keepUser._id, keepReply._id, unwrittenUser._id, unwrittenReply._id] } });

// 批量确认：同一回复的两个文件只出现一个列表弹窗，取消一个后只写入另一个。
const batchMessage = await Message.create({
  role: "assistant",
  content: "两个文件：\n\n%%%FILE_BEGIN%%% issues/01-first.md\n# First\n%%%FILE_END%%%\n\n%%%FILE_BEGIN%%% issues/02-second.md\n# Second\n%%%FILE_END%%%",
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(),
});
await page.reload();
await page.waitForLoadState("networkidle");
const batchDialog = page.getByRole("dialog");
await batchDialog.waitFor();
const batchCheckboxes = batchDialog.getByRole("checkbox");
check("多个文件共用一个确认弹窗", (await batchCheckboxes.count()) === 2);
await batchDialog.getByRole("checkbox", { name: "选择 issues/02-second.md" }).uncheck();
await batchDialog.getByRole("button", { name: /批量写入/ }).click();
await page.waitForTimeout(600);
const savedFiles = await page.evaluate(async (id) => (await fetch(`/api/projects/${id}/files`)).json(), projectId);
check("批量确认只写入勾选文件", savedFiles.some((file) => file.filename === "issues/01-first.md"));
check("未勾选文件不落盘", !savedFiles.some((file) => file.filename === "issues/02-second.md"));

// 加入长历史消息，把聊天区撑出滚动范围，再验证用户上翻时不被新 token 拉回底部。
await Message.deleteOne({ _id: batchMessage._id });
await Message.create({
  role: "user",
  content: "历史消息内容。".repeat(180),
  tab_id: new mongoose.Types.ObjectId(tabId),
  timestamp: new Date(),
});
await page.reload();
await page.waitForLoadState("networkidle");
const chatScroller = page.locator("div.min-h-0.flex-1.overflow-y-auto.px-4.py-6");
await chatScroller.evaluate((element) => {
  element.scrollTop = 0;
  element.dispatchEvent(new Event("scroll", { bubbles: true }));
});

// 流式期间用受控回放流制造一个可观察窗口，验证输入可编辑和停止按钮。
await page.evaluate(() => { window.__verifySlowChat = true; });
const textarea = page.locator("textarea");
const priorReplayCount = await page.evaluate(
  () => document.body.innerText.split("本校大学生在毕业季").length - 1
);
await textarea.fill("测试停止");
await page.getByRole("button", { name: "发送" }).click();
await page.getByRole("button", { name: "停止生成" }).waitFor();
await page.waitForFunction(
  (previous) => document.body.innerText.split("本校大学生在毕业季").length - 1 > previous,
  priorReplayCount
);
const scrolledWhileReading = await chatScroller.evaluate((element) => element.scrollTop);
check("向上翻历史时新 token 不强制滚动", scrolledWhileReading < 20);
check("流式期间输入框保持可编辑", !(await textarea.isDisabled()));
await textarea.fill("等待中的下一条消息");
const stopButton = page.getByRole("button", { name: "停止生成" });
await stopButton.click();
await stopButton.waitFor({ state: "hidden" });
await page.waitForTimeout(600);
check("停止后保留 partial 并标注中断", (await page.getByText("[回复已中断]").count()) > 0);
await page.reload();
await page.waitForLoadState("networkidle");
check("停止后刷新仍保留 partial", (await page.getByText("[回复已中断]").count()) > 0);

const restoredScroller = page.locator("div.min-h-0.flex-1.overflow-y-auto.px-4.py-6");
await restoredScroller.evaluate((element) => {
  element.scrollTop = element.scrollHeight;
  element.dispatchEvent(new Event("scroll", { bubbles: true }));
});
await page.evaluate(() => { window.__verifySlowChat = false; });
const completedTextarea = page.locator("textarea");
const messagesBeforeCompletion = await page.evaluate(
  async (id) => (await fetch(`/api/tabs/${id}/messages`)).json(),
  tabId
);
const assistantsBeforeCompletion = messagesBeforeCompletion.messages.filter(
  (message) => message.role === "assistant"
).length;
await completedTextarea.fill("等待正常完成");
await page.getByRole("button", { name: "发送" }).click();
await page.waitForFunction(
  async ({ id, count }) => {
    const data = await fetch(`/api/tabs/${id}/messages`).then((res) => res.json());
    return data.messages.filter((message) => message.role === "assistant").length > count;
  },
  { id: tabId, count: assistantsBeforeCompletion }
);
await waitForStreamSettled();
await page.waitForFunction(
  (selector) => {
    const element = document.querySelector(selector);
    return element && element.scrollHeight - element.scrollTop - element.clientHeight <= 96;
  },
  "div.min-h-0.flex-1.overflow-y-auto.px-4.py-6",
  { polling: "raf" }
);
const bottomDistance = await restoredScroller.evaluate(
  (element) => element.scrollHeight - element.scrollTop - element.clientHeight
);
check("回到接近底部后恢复自动跟随", bottomDistance <= 96, `(距离=${bottomDistance})`);
check(
  "生成完成后停止按钮消失",
  (await page.getByRole("button", { name: "停止生成" }).count()) === 0
);
const completionDialog = page.getByRole("dialog").filter({
  hasText: "Agent 产出文件",
});
await completionDialog
  .waitFor({ state: "visible", timeout: 5000 })
  .catch(() => undefined);
if (await completionDialog.isVisible()) {
  await completionDialog.getByRole("button", { name: "全部丢弃" }).click();
  await completionDialog.waitFor({ state: "hidden" });
}
const messagesBeforeNextSend = await page.evaluate(
  async (id) => (await fetch(`/api/tabs/${id}/messages`)).json(),
  tabId
);
await completedTextarea.fill("完成后立即发送");
const sendButton = page.getByRole("button", { name: "发送" });
check("生成完成后发送按钮恢复可用", await sendButton.isEnabled());
await page.getByRole("button", { name: "发送" }).click();
await page.waitForFunction(
  async ({ id, count }) => {
    const data = await fetch(`/api/tabs/${id}/messages`).then((res) => res.json());
    return data.messages.length > count;
  },
  { id: tabId, count: messagesBeforeNextSend.messages.length }
);
check("生成完成后可直接发送下一条消息", true);

await browser.close();
await mongoose.disconnect();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
